// HTTP API: организации → пользователи (роли admin / investigator / reader) → дела (пакеты JSON того же формата,
// что экспорт в приложении) + журнал действий. Фабрика createApp(db) — чтобы тесты поднимали сервер на SQLite в памяти.
import express from 'express';
import { readFileSync } from 'node:fs';
import { validatePortable } from '../../js/bundle.js';
import { actionsRegistry, actionOverdue, osfStats } from '../../js/rules.js';

// Коды OSF — из той же таксономии, что в приложении.
const OSF_CODES = JSON.parse(readFileSync(new URL('../../data/taxonomy.json', import.meta.url), 'utf8')).osf.map((o) => o.code);
import { ROLES, MAX_PASSWORD, validPassword, hashPassword, verifyPassword, newToken, tokenHash, uuid, nowIso, sessionExpiry } from './auth.js';
import { limiter, envInt } from './limiter.js';
import { createAi } from './ai.js';

const BODY_LIMIT = process.env.BODY_LIMIT || '30mb'; // дело с вложениями (до 5 МБ каждое, base64)

class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (status, code, extra) => { throw new HttpError(status, code, extra); };

function cors(allowed) {
  const list = (allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (list.includes('*') || list.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

// Защита от перебора паролей: 10 неудачных попыток на пару IP+почта → блок на 15 минут; регистрация — 20 в час на IP.
const LOGIN_MAX = envInt('LOGIN_MAX_ATTEMPTS', 10), LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REG_MAX = envInt('REGISTER_MAX_PER_HOUR', 20), REG_WINDOW_MS = 60 * 60 * 1000;
const blocked = (retryAfterSec) => bad(429, 'too-many-attempts', { retryAfterSec });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const titleOf = (occ) => (typeof occ.title === 'string' ? occ.title : (occ.title && (occ.title.ru || occ.title.en)) || '');

export function createApp(db, { allowedOrigins = process.env.ALLOWED_ORIGINS, allowRegistration = process.env.ALLOW_REGISTRATION !== 'false', ai = createAi() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render: реальный IP клиента в X-Forwarded-For
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors(allowedOrigins));
  app.use(express.json({ limit: BODY_LIMIT }));
  const loginLimit = limiter(LOGIN_MAX, LOGIN_WINDOW_MS);
  const registerLimit = limiter(REG_MAX, REG_WINDOW_MS);

  const audit = (orgId, userId, action, caseId = null, details = null) =>
    db.run('INSERT INTO audit (id, org_id, user_id, action, case_id, details, at) VALUES (?,?,?,?,?,?,?)',
      [uuid(), orgId, userId, action, caseId, details ? JSON.stringify(details) : null, nowIso()]);

  const publicUser = (u) => ({ id: u.id, orgId: u.org_id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.created_at });

  async function issueSession(user) {
    const token = newToken();
    await db.run('INSERT INTO session (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)', [tokenHash(token), user.id, sessionExpiry(), nowIso()]);
    const org = (await db.q('SELECT * FROM organisation WHERE id = ?', [user.org_id]))[0];
    return { token, user: publicUser(user), organisation: { id: org.id, name: org.name } };
  }

  // --- аутентификация
  const auth = (...roles) => wrap(async (req, res, next) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) bad(401, 'unauthorized');
    const rows = await db.q(`SELECT u.*, s.expires_at FROM session s JOIN app_user u ON u.id = s.user_id WHERE s.token_hash = ?`, [tokenHash(m[1])]);
    const u = rows[0];
    if (!u || u.expires_at < nowIso()) bad(401, 'unauthorized');
    if (u.disabled) bad(403, 'disabled');
    if (roles.length && !roles.includes(u.role)) bad(403, 'forbidden');
    req.user = u;
    req.tokenHash = tokenHash(m[1]);
    next();
  });

  app.get('/api/health', wrap(async (req, res) => {
    res.json({ ok: true, db: db.kind, schema: db.schemaVersion, registration: allowRegistration, ai: { enabled: ai.enabled, provider: ai.provider, model: ai.model } });
  }));

  // --- AI-подсказка по одному факту (этап 5). Принимаются только обезличенные данные (occurrence.anonymised), никаких вложений.
  const aiLimit = limiter(envInt('AI_MAX_PER_HOUR', 60), 60 * 60 * 1000);
  app.post('/api/ai/suggest', auth('admin', 'investigator'), wrap(async (req, res) => {
    if (!ai.enabled) bad(503, 'ai-disabled');
    const { fact, context, lang } = req.body || {};
    if (!fact || typeof fact.text !== 'string' || !fact.text.trim()) bad(400, 'fact');
    if (!context || !context.anonymised) bad(400, 'not-anonymised');
    const key = `${req.user.org_id}|${req.user.id}`;
    aiLimit.check(key, blocked);
    aiLimit.hit(key);
    let suggestion;
    try {
      suggestion = await ai.suggest({ fact: { text: fact.text.slice(0, 2000), source: str(fact.source, 300), shelo: fact.shelo || null }, context: { title: str(context.title, 300), type: context.type, outcome: (context.outcome || []).slice(0, 10).map((s) => str(s, 300)), otherFacts: (context.otherFacts || []).slice(0, 30).map((s) => str(s, 300)) }, lang: lang === 'en' ? 'en' : 'ru' });
    } catch (e) {
      await audit(req.user.org_id, req.user.id, 'ai.error', null, { provider: ai.provider, error: String(e.message).slice(0, 100) });
      bad(502, 'ai-failed', { reason: String(e.message).slice(0, 100) });
    }
    await audit(req.user.org_id, req.user.id, 'ai.suggest', context.caseId ? String(context.caseId) : null, { provider: ai.provider, elements: suggestion.elements.map((e) => e.element) });
    res.json({ provider: ai.provider, model: ai.model, suggestion });
  }));

  // Регистрация организации вместе с первым администратором.
  app.post('/api/auth/register', wrap(async (req, res) => {
    if (!allowRegistration) bad(403, 'registration-closed');
    registerLimit.check(req.ip, blocked);
    const { organisation, name, email, password } = req.body || {};
    const orgName = str(organisation, 200), userName = str(name, 200);
    if (!orgName) bad(400, 'organisation');
    if (!userName) bad(400, 'name');
    if (!isEmail(email)) bad(400, 'email');
    if (!validPassword(password)) bad(400, 'password');
    registerLimit.hit(req.ip);
    const mail = email.trim().toLowerCase();
    if ((await db.q('SELECT id FROM app_user WHERE email = ?', [mail])).length) bad(409, 'email-taken');
    const orgId = uuid(), userId = uuid(), now = nowIso();
    await db.run('INSERT INTO organisation (id, name, created_at) VALUES (?,?,?)', [orgId, orgName, now]);
    await db.run('INSERT INTO app_user (id, org_id, email, name, password_hash, role, disabled, created_at) VALUES (?,?,?,?,?,?,0,?)',
      [userId, orgId, mail, userName, hashPassword(password), 'admin', now]);
    await audit(orgId, userId, 'org.register', null, { organisation: orgName });
    const user = (await db.q('SELECT * FROM app_user WHERE id = ?', [userId]))[0];
    res.status(201).json(await issueSession(user));
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const mail = isEmail(email) ? email.trim().toLowerCase() : '';
    const key = `${req.ip}|${mail}`;
    loginLimit.check(key, blocked);
    const user = mail ? (await db.q('SELECT * FROM app_user WHERE email = ?', [mail]))[0] : null;
    const pwd = typeof password === 'string' ? password.slice(0, MAX_PASSWORD) : '';
    if (!user || !verifyPassword(pwd, user.password_hash)) { loginLimit.hit(key); bad(401, 'bad-credentials'); }
    if (user.disabled) bad(403, 'disabled');
    loginLimit.reset(key);
    await db.run('DELETE FROM session WHERE expires_at < ?', [nowIso()]); // чистим просроченные сессии
    await audit(user.org_id, user.id, 'login');
    res.json(await issueSession(user));
  }));

  app.post('/api/auth/logout', auth(), wrap(async (req, res) => {
    await db.run('DELETE FROM session WHERE token_hash = ?', [req.tokenHash]);
    res.json({ ok: true });
  }));

  app.get('/api/me', auth(), wrap(async (req, res) => {
    const org = (await db.q('SELECT * FROM organisation WHERE id = ?', [req.user.org_id]))[0];
    res.json({ user: publicUser(req.user), organisation: { id: org.id, name: org.name } });
  }));

  app.post('/api/auth/password', auth(), wrap(async (req, res) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(String(current || '').slice(0, MAX_PASSWORD), req.user.password_hash)) bad(401, 'bad-credentials');
    if (!validPassword(next)) bad(400, 'password');
    await db.run('UPDATE app_user SET password_hash = ? WHERE id = ?', [hashPassword(next), req.user.id]);
    await db.run('DELETE FROM session WHERE user_id = ? AND token_hash <> ?', [req.user.id, req.tokenHash]);
    await audit(req.user.org_id, req.user.id, 'password.change');
    res.json({ ok: true });
  }));

  // --- пользователи организации (только admin)
  app.get('/api/users', auth('admin'), wrap(async (req, res) => {
    const rows = await db.q('SELECT * FROM app_user WHERE org_id = ? ORDER BY created_at', [req.user.org_id]);
    res.json({ users: rows.map(publicUser) });
  }));

  app.post('/api/users', auth('admin'), wrap(async (req, res) => {
    const { name, email, password, role } = req.body || {};
    const userName = str(name, 200);
    if (!userName) bad(400, 'name');
    if (!isEmail(email)) bad(400, 'email');
    if (!validPassword(password)) bad(400, 'password');
    if (!ROLES.includes(role)) bad(400, 'role');
    const mail = email.trim().toLowerCase();
    if ((await db.q('SELECT id FROM app_user WHERE email = ?', [mail])).length) bad(409, 'email-taken');
    const id = uuid();
    await db.run('INSERT INTO app_user (id, org_id, email, name, password_hash, role, disabled, created_at) VALUES (?,?,?,?,?,?,0,?)',
      [id, req.user.org_id, mail, userName, hashPassword(password), role, nowIso()]);
    await audit(req.user.org_id, req.user.id, 'user.create', null, { userId: id, role });
    res.status(201).json({ user: publicUser((await db.q('SELECT * FROM app_user WHERE id = ?', [id]))[0]) });
  }));

  app.patch('/api/users/:id', auth('admin'), wrap(async (req, res) => {
    const u = (await db.q('SELECT * FROM app_user WHERE id = ? AND org_id = ?', [req.params.id, req.user.org_id]))[0];
    if (!u) bad(404, 'not-found');
    const { role, disabled, password } = req.body || {};
    const nextRole = role === undefined ? u.role : role;
    const nextDisabled = disabled === undefined ? !!u.disabled : !!disabled;
    if (!ROLES.includes(nextRole)) bad(400, 'role');
    if (u.id === req.user.id && (nextRole !== 'admin' || nextDisabled)) bad(400, 'self-lockout');
    await db.run('UPDATE app_user SET role = ?, disabled = ? WHERE id = ?', [nextRole, nextDisabled ? 1 : 0, u.id]);
    if (password !== undefined) {
      if (!validPassword(password)) bad(400, 'password');
      await db.run('UPDATE app_user SET password_hash = ? WHERE id = ?', [hashPassword(password), u.id]);
      await db.run('DELETE FROM session WHERE user_id = ?', [u.id]);
    }
    if (nextDisabled) await db.run('DELETE FROM session WHERE user_id = ?', [u.id]);
    await audit(req.user.org_id, req.user.id, 'user.update', null, { userId: u.id, role: nextRole, disabled: nextDisabled, password: password !== undefined });
    res.json({ user: publicUser((await db.q('SELECT * FROM app_user WHERE id = ?', [u.id]))[0]) });
  }));

  // --- дела: пакет целиком, оптимистическая блокировка по version
  const caseMeta = (r) => ({ id: r.id, title: r.title, status: r.status, type: r.type, severity: r.severity, date: r.date, version: Number(r.version), updatedAt: r.updated_at, updatedBy: r.updated_by });

  app.get('/api/cases', auth(), wrap(async (req, res) => {
    const rows = await db.q('SELECT id, title, status, type, severity, date, version, updated_at, updated_by FROM occurrence_case WHERE org_id = ? ORDER BY updated_at DESC', [req.user.org_id]);
    res.json({ cases: rows.map(caseMeta) });
  }));

  app.get('/api/cases/:id', auth(), wrap(async (req, res) => {
    const r = (await db.q('SELECT * FROM occurrence_case WHERE id = ? AND org_id = ?', [req.params.id, req.user.org_id]))[0];
    if (!r) bad(404, 'not-found');
    res.json({ ...caseMeta(r), bundle: JSON.parse(r.bundle) });
  }));

  app.put('/api/cases/:id', auth('admin', 'investigator'), wrap(async (req, res) => {
    const { bundle, baseVersion } = req.body || {};
    const errors = validatePortable(bundle);
    if (errors.length) bad(400, 'bundle', { errors });
    if (bundle.occurrence.id !== req.params.id) bad(400, 'id-mismatch');
    const existing = (await db.q('SELECT org_id, version FROM occurrence_case WHERE id = ?', [req.params.id]))[0];
    if (existing && existing.org_id !== req.user.org_id) bad(403, 'forbidden');
    if (existing && Number(baseVersion) !== Number(existing.version)) bad(409, 'version-conflict', { version: Number(existing.version) });
    const o = bundle.occurrence;
    const version = existing ? Number(existing.version) + 1 : 1;
    const now = nowIso();
    const text = JSON.stringify(bundle);
    if (existing) {
      await db.run('UPDATE occurrence_case SET title = ?, status = ?, type = ?, severity = ?, date = ?, bundle = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?',
        [titleOf(o), o.status || null, o.type || null, o.severity || null, o.date || null, text, version, now, req.user.id, o.id]);
    } else {
      await db.run('INSERT INTO occurrence_case (id, org_id, title, status, type, severity, date, bundle, version, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [o.id, req.user.org_id, titleOf(o), o.status || null, o.type || null, o.severity || null, o.date || null, text, version, now, req.user.id]);
    }
    await audit(req.user.org_id, req.user.id, existing ? 'case.update' : 'case.create', o.id, { version, status: o.status || null, bytes: text.length });
    res.status(existing ? 200 : 201).json({ id: o.id, version, updatedAt: now });
  }));

  // Резервная копия всех дел организации (admin): массив пакетов того же формата, что экспорт в приложении.
  app.get('/api/export', auth('admin'), wrap(async (req, res) => {
    const rows = await db.q('SELECT * FROM occurrence_case WHERE org_id = ? ORDER BY updated_at', [req.user.org_id]);
    const org = (await db.q('SELECT * FROM organisation WHERE id = ?', [req.user.org_id]))[0];
    await audit(req.user.org_id, req.user.id, 'org.export', null, { cases: rows.length });
    res.setHeader('Content-Disposition', `attachment; filename="soam-${org.id.slice(0, 8)}-${nowIso().slice(0, 10)}.json"`);
    res.type('application/json');
    // Пакеты в БД уже лежат как JSON-текст — склеиваем строки, не разбирая и не сериализуя их заново (память на бесплатном тарифе).
    const head = JSON.stringify({ format: 'soam-investigator/organisation', exportedAt: nowIso(), organisation: { id: org.id, name: org.name } }).slice(0, -1);
    const cases = rows.map((r) => JSON.stringify(caseMeta(r)).slice(0, -1) + ',"bundle":' + r.bundle + '}').join(',');
    res.send(head + ',"cases":[' + cases + ']}');
  }));

  // Восстановление из резервной копии (admin): файл формата /api/export. Дело берётся, если его нет
  // или версия в файле выше серверной; дела других организаций и битые пакеты пропускаются с отчётом.
  app.post('/api/import', auth('admin'), express.json({ limit: process.env.IMPORT_LIMIT || '200mb' }), wrap(async (req, res) => {
    const body = req.body || {};
    if (body.format !== 'soam-investigator/organisation' || !Array.isArray(body.cases)) bad(400, 'format');
    const result = { imported: 0, updated: 0, skipped: 0, errors: [] };
    for (const c of body.cases) {
      const bundle = c && c.bundle;
      const errors = validatePortable(bundle);
      if (errors.length || !c.id || bundle.occurrence.id !== c.id) { result.errors.push({ id: c && c.id, errors: errors.length ? errors : ['id-mismatch'] }); continue; }
      const existing = (await db.q('SELECT org_id, version FROM occurrence_case WHERE id = ?', [c.id]))[0];
      const incoming = Number(c.version) || 1;
      if (existing && (existing.org_id !== req.user.org_id || incoming <= Number(existing.version))) { result.skipped += 1; continue; }
      const o = bundle.occurrence;
      const version = existing ? Math.max(Number(existing.version) + 1, incoming) : incoming;
      const now = nowIso();
      const text = JSON.stringify(bundle);
      if (existing) {
        await db.run('UPDATE occurrence_case SET title = ?, status = ?, type = ?, severity = ?, date = ?, bundle = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?',
          [titleOf(o), o.status || null, o.type || null, o.severity || null, o.date || null, text, version, now, req.user.id, o.id]);
        result.updated += 1;
      } else {
        await db.run('INSERT INTO occurrence_case (id, org_id, title, status, type, severity, date, bundle, version, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [o.id, req.user.org_id, titleOf(o), o.status || null, o.type || null, o.severity || null, o.date || null, text, version, now, req.user.id]);
        result.imported += 1;
      }
    }
    await audit(req.user.org_id, req.user.id, 'org.import', null, { imported: result.imported, updated: result.updated, skipped: result.skipped, errors: result.errors.length });
    res.json(result);
  }));

  app.delete('/api/cases/:id', auth('admin'), wrap(async (req, res) => {
    const r = await db.run('DELETE FROM occurrence_case WHERE id = ? AND org_id = ?', [req.params.id, req.user.org_id]);
    if (!r.changes) bad(404, 'not-found');
    await audit(req.user.org_id, req.user.id, 'case.delete', req.params.id);
    res.json({ ok: true });
  }));

  // --- сводки по всем делам организации (из пакетов; та же логика rules.js, что в приложении)
  // Тестовые кейсы из QRG (occurrence.isTestCase) в сводки не входят, если не запрошено ?tests=1.
  const orgBundles = async (orgId, includeTests = false) => (await db.q('SELECT id, title, bundle FROM occurrence_case WHERE org_id = ?', [orgId]))
    .map((r) => ({ id: r.id, title: r.title, bundle: JSON.parse(r.bundle) }))
    .filter((c) => includeTests || !(c.bundle.occurrence && c.bundle.occurrence.isTestCase));
  const wantTests = (req) => req.query.tests === '1';

  const actionsSummary = (cases) => {
    const today = new Date().toISOString().slice(0, 10);
    const all = [];
    for (const c of cases) {
      const classById = Object.fromEntries((c.bundle.classifications || []).map((x) => [x.id, x]));
      for (const a of c.bundle.actions || []) {
        all.push({
          id: a.id, caseId: c.id, caseTitle: c.title, text: a.text, responsible: a.responsible || '', due: a.due || null, status: a.status || 'planned',
          addresses: (a.addresses || []).map((id) => classById[id]).filter(Boolean).map((x) => `${x.element}${x.element === 'OSF' ? ' ' + (x.osfCodes || []).join('/') : ''}`),
        });
      }
    }
    const actions = actionsRegistry(all, today).map((a) => ({ ...a, overdue: actionOverdue(a, today) }));
    return { today, actions, overdue: actions.filter((a) => a.overdue).length, open: actions.filter((a) => a.status !== 'done').length };
  };
  const osfSummary = (cases) => {
    const classes = cases.flatMap((c) => (c.bundle.classifications || []).map((x) => ({ ...x, occurrenceId: c.id })));
    const withOsf = new Set(classes.filter((x) => x.element === 'OSF').map((x) => x.occurrenceId)).size;
    return { stats: osfStats(classes, OSF_CODES), casesWithOsf: withOsf, cases: cases.length };
  };

  // Одна выборка и один разбор пакетов на обе сводки (клиент запрашивает их вместе).
  app.get('/api/stats', auth(), wrap(async (req, res) => {
    const cases = await orgBundles(req.user.org_id, wantTests(req));
    res.json({ actions: actionsSummary(cases), osf: osfSummary(cases) });
  }));
  app.get('/api/stats/actions', auth(), wrap(async (req, res) => res.json(actionsSummary(await orgBundles(req.user.org_id, wantTests(req))))));
  app.get('/api/stats/osf', auth(), wrap(async (req, res) => res.json(osfSummary(await orgBundles(req.user.org_id, wantTests(req))))));

  app.get('/api/audit', auth('admin', 'investigator'), wrap(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const params = [req.user.org_id];
    let sql = 'SELECT a.id, a.user_id, u.name AS user_name, a.action, a.case_id, a.details, a.at FROM audit a LEFT JOIN app_user u ON u.id = a.user_id WHERE a.org_id = ?';
    if (req.query.caseId) { sql += ' AND a.case_id = ?'; params.push(String(req.query.caseId)); }
    sql += ' ORDER BY a.at DESC LIMIT ' + limit;
    const rows = await db.q(sql, params);
    res.json({ audit: rows.map((r) => ({ id: r.id, userId: r.user_id, userName: r.user_name, action: r.action, caseId: r.case_id, details: r.details ? JSON.parse(r.details) : null, at: r.at })) });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not-found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...(err.extra || {}) });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too-large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'json' });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
