// Тесты API (node:test, без зависимостей): SQLite в памяти, сервер на свободном порту, запросы через fetch.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server, base, db;
const api = async (method, path, { body, token } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* пусто */ }
  return { status: res.status, json };
};
const bundle = (id, extra = {}) => ({
  format: 'soam-investigator/occurrence', schema: 1, appVersion: 'test',
  occurrence: { id, title: 'Дело ' + id, type: 'incident', severity: 'B', status: 'analysis', date: '2026-10-01T10:00', ...extra },
  facts: [{ id: id + ':f1', occurrenceId: id, text: 'факт', contributes: true }],
  classifications: [{ id: id + ':c1', occurrenceId: id, factId: id + ':f1', element: 'HI', confirmed: true }],
  events: [], links: [], actions: [], qa: null,
});

// Один и тот же набор сценариев гоняется на SQLite (как локально) и на PGlite (Postgres в WASM — как на Render + Neon).
for (const kind of ['sqlite', 'pglite']) describe(`API на ${kind}`, () => {
  before(async () => {
    if (kind === 'pglite') {
      // настоящий Postgres (WASM) без сервера — проверяем диалект SQL, который пойдёт на Render + Neon
      const { PGlite } = await import('@electric-sql/pglite');
      const pg = new PGlite();
      db = await openDb({ client: { query: async (sql, params) => { const r = await pg.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows || 0 }; }, end: () => pg.close() } });
    } else db = await openDb({ databaseUrl: '', sqlitePath: ':memory:' });
    const app = createApp(db, { allowedOrigins: 'https://example.org', allowRegistration: true });
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server.close(); await db.close(); });

  const A = { organisation: 'АГА РТ', name: 'Админ', email: 'admin@aga.tj', password: 'secret-123' };
  let adminTok, invTok, readerTok, otherTok;

  test('health и CORS', async () => {
    const h = await api('GET', '/api/health');
    assert.equal(h.status, 200); assert.equal(h.json.db, kind === 'pglite' ? 'pg' : 'sqlite'); assert.equal(h.json.schema, 1);
    const pre = await fetch(base + '/api/health', { method: 'OPTIONS', headers: { Origin: 'https://example.org' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://example.org');
    const bad = await fetch(base + '/api/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });

  test('регистрация организации с администратором, вход, /me', async () => {
    const r = await api('POST', '/api/auth/register', { body: A });
    assert.equal(r.status, 201); assert.ok(r.json.token); assert.equal(r.json.user.role, 'admin'); assert.equal(r.json.organisation.name, 'АГА РТ');
    adminTok = r.json.token;
    assert.equal((await api('POST', '/api/auth/register', { body: A })).json.error, 'email-taken');
    assert.equal((await api('POST', '/api/auth/register', { body: { ...A, email: 'x@y.z', password: 'short' } })).json.error, 'password');
    assert.equal((await api('POST', '/api/auth/login', { body: { email: A.email, password: 'wrong' } })).status, 401);
    const l = await api('POST', '/api/auth/login', { body: { email: 'ADMIN@aga.tj', password: A.password } });
    assert.equal(l.status, 200); assert.ok(l.json.token);
    const me = await api('GET', '/api/me', { token: l.json.token });
    assert.equal(me.json.user.email, 'admin@aga.tj');
    assert.equal((await api('GET', '/api/me')).status, 401);
    assert.equal((await api('GET', '/api/me', { token: 'bogus' })).status, 401);
  });

  test('пользователи: только admin создаёт; роли; отключение убивает сессии; нельзя запереть себя', async () => {
    const inv = await api('POST', '/api/users', { token: adminTok, body: { name: 'Расследователь', email: 'inv@aga.tj', password: 'secret-123', role: 'investigator' } });
    assert.equal(inv.status, 201);
    const rd = await api('POST', '/api/users', { token: adminTok, body: { name: 'Читатель', email: 'rd@aga.tj', password: 'secret-123', role: 'reader' } });
    assert.equal(rd.status, 201);
    assert.equal((await api('POST', '/api/users', { token: adminTok, body: { name: 'x', email: 'x@aga.tj', password: 'secret-123', role: 'boss' } })).json.error, 'role');
    invTok = (await api('POST', '/api/auth/login', { body: { email: 'inv@aga.tj', password: 'secret-123' } })).json.token;
    readerTok = (await api('POST', '/api/auth/login', { body: { email: 'rd@aga.tj', password: 'secret-123' } })).json.token;
    assert.equal((await api('GET', '/api/users', { token: invTok })).status, 403);
    assert.equal((await api('GET', '/api/users', { token: adminTok })).json.users.length, 3);
    const self = await api('PATCH', `/api/users/${(await api('GET', '/api/me', { token: adminTok })).json.user.id}`, { token: adminTok, body: { role: 'reader' } });
    assert.equal(self.json.error, 'self-lockout');
    const off = await api('PATCH', `/api/users/${rd.json.user.id}`, { token: adminTok, body: { disabled: true } });
    assert.equal(off.json.user.disabled, true);
    assert.equal((await api('GET', '/api/me', { token: readerTok })).status, 401, 'сессия отключённого удалена');
    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'rd@aga.tj', password: 'secret-123' } })).json.error, 'disabled');
    await api('PATCH', `/api/users/${rd.json.user.id}`, { token: adminTok, body: { disabled: false } });
    readerTok = (await api('POST', '/api/auth/login', { body: { email: 'rd@aga.tj', password: 'secret-123' } })).json.token;
  });

  test('дела: создание, список, чтение, конфликт версий, права, изоляция организаций, удаление', async () => {
    const c1 = await api('PUT', '/api/cases/case-1', { token: invTok, body: { bundle: bundle('case-1') } });
    assert.equal(c1.status, 201); assert.equal(c1.json.version, 1);
    assert.equal((await api('PUT', '/api/cases/case-2', { token: readerTok, body: { bundle: bundle('case-2') } })).status, 403, 'reader не пишет');
    assert.equal((await api('PUT', '/api/cases/case-x', { token: invTok, body: { bundle: bundle('case-1') } })).json.error, 'id-mismatch');
    const broken = await api('PUT', '/api/cases/case-3', { token: invTok, body: { bundle: { occurrence: { id: 'case-3' }, facts: [], classifications: [{ id: 'c', factId: 'nope' }] } } });
    assert.equal(broken.json.error, 'bundle'); assert.ok(broken.json.errors.includes('classification-orphan'));

    const list = await api('GET', '/api/cases', { token: readerTok });
    assert.equal(list.json.cases.length, 1); assert.equal(list.json.cases[0].title, 'Дело case-1'); assert.equal(list.json.cases[0].severity, 'B');
    const got = await api('GET', '/api/cases/case-1', { token: readerTok });
    assert.equal(got.json.bundle.facts[0].text, 'факт'); assert.equal(got.json.version, 1);

    const stale = await api('PUT', '/api/cases/case-1', { token: invTok, body: { bundle: bundle('case-1', { status: 'actions' }), baseVersion: 0 } });
    assert.equal(stale.status, 409); assert.equal(stale.json.version, 1);
    const upd = await api('PUT', '/api/cases/case-1', { token: invTok, body: { bundle: bundle('case-1', { status: 'actions' }), baseVersion: 1 } });
    assert.equal(upd.status, 200); assert.equal(upd.json.version, 2);
    assert.equal((await api('GET', '/api/cases/case-1', { token: adminTok })).json.status, 'actions');

    // другая организация ничего не видит и не перезаписывает
    const other = await api('POST', '/api/auth/register', { body: { organisation: 'АНСП', name: 'Иной', email: 'o@ansp.tj', password: 'secret-123' } });
    otherTok = other.json.token;
    assert.equal((await api('GET', '/api/cases', { token: otherTok })).json.cases.length, 0);
    assert.equal((await api('GET', '/api/cases/case-1', { token: otherTok })).status, 404);
    assert.equal((await api('PUT', '/api/cases/case-1', { token: otherTok, body: { bundle: bundle('case-1'), baseVersion: 2 } })).status, 403);

    assert.equal((await api('DELETE', '/api/cases/case-1', { token: invTok })).status, 403, 'удаляет только admin');
    assert.equal((await api('DELETE', '/api/cases/case-1', { token: otherTok })).status, 404);
    assert.equal((await api('DELETE', '/api/cases/case-1', { token: adminTok })).status, 200);
    assert.equal((await api('GET', '/api/cases', { token: adminTok })).json.cases.length, 0);
  });

  test('журнал действий: по организации, фильтр по делу, reader не видит', async () => {
    const all = await api('GET', '/api/audit', { token: adminTok });
    assert.equal(all.status, 200);
    const actions = all.json.audit.map((a) => a.action);
    for (const k of ['org.register', 'login', 'user.create', 'user.update', 'case.create', 'case.update', 'case.delete']) assert.ok(actions.includes(k), 'нет ' + k);
    assert.ok(!actions.includes('org.register') || all.json.audit.every((a) => a.userName !== 'Иной'), 'чужая организация не попадает');
    const byCase = await api('GET', '/api/audit?caseId=case-1', { token: invTok });
    assert.equal(byCase.json.audit.length, 3);
    assert.equal(byCase.json.audit[0].action, 'case.delete');
    assert.equal((await api('GET', '/api/audit', { token: readerTok })).status, 403);
  });

  test('смена пароля, выход', async () => {
    assert.equal((await api('POST', '/api/auth/password', { token: invTok, body: { current: 'wrong', next: 'new-secret-1' } })).status, 401);
    assert.equal((await api('POST', '/api/auth/password', { token: invTok, body: { current: 'secret-123', next: 'new-secret-1' } })).status, 200);
    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'inv@aga.tj', password: 'new-secret-1' } })).status, 200);
    assert.equal((await api('POST', '/api/auth/logout', { token: invTok })).status, 200);
    assert.equal((await api('GET', '/api/me', { token: invTok })).status, 401);
  });

  test('сводки организации: реестр мер с просрочкой и статистика OSF', async () => {
    const full = (id, actions, osfCodes) => ({
      ...bundle(id),
      classifications: [
        { id: id + ':c1', occurrenceId: id, factId: id + ':f1', element: 'OSF', osfCodes, confirmed: true },
        { id: id + ':c2', occurrenceId: id, factId: id + ':f1', element: 'BAR', barrierType: 'Detection', barrierState: 'failed', confirmed: true },
      ],
      actions,
    });
    const put = (id, b) => api('PUT', `/api/cases/${id}`, { token: otherTok, body: { bundle: b } });
    assert.equal((await put('s-1', full('s-1', [
      { id: 'a1', occurrenceId: 's-1', text: 'Просроченная', addresses: ['s-1:c1'], responsible: 'Отдел', due: '2000-01-01', status: 'planned' },
      { id: 'a2', occurrenceId: 's-1', text: 'Выполненная', addresses: ['s-1:c2'], responsible: 'Отдел', due: '2000-01-01', status: 'done' },
    ], ['TR', 'WM']))).status, 201);
    assert.equal((await put('s-2', full('s-2', [
      { id: 'a3', occurrenceId: 's-2', text: 'В срок', addresses: ['s-2:c1', 's-2:c2'], responsible: 'ОрВД', due: '2999-01-01', status: 'in_progress' },
    ], ['TR']))).status, 201);

    const acts = await api('GET', '/api/stats/actions', { token: otherTok });
    assert.equal(acts.status, 200);
    assert.deepEqual(acts.json.actions.map((a) => a.text), ['Просроченная', 'В срок', 'Выполненная']);
    assert.equal(acts.json.overdue, 1); assert.equal(acts.json.open, 2);
    assert.equal(acts.json.actions[0].overdue, true); assert.equal(acts.json.actions[0].caseTitle, 'Дело s-1');
    assert.deepEqual(acts.json.actions[1].addresses, ['OSF TR', 'BAR']);

    // тестовый кейс из QRG не входит в сводки без ?tests=1
    assert.equal((await put('s-test', { ...full('s-test', [{ id: 'at', occurrenceId: 's-test', text: 'Тестовая', addresses: ['s-test:c1'], responsible: 'x', due: '2000-01-01', status: 'planned' }], ['TR']), occurrence: { ...bundle('s-test').occurrence, isTestCase: true } })).status, 201);
    assert.equal((await api('GET', '/api/stats', { token: otherTok })).json.osf.cases, 2, 'тестовый кейс исключён');
    assert.equal((await api('GET', '/api/stats?tests=1', { token: otherTok })).json.osf.cases, 3, 'с ?tests=1 включён');
    assert.equal((await api('GET', '/api/stats/actions', { token: otherTok })).json.overdue, 1, 'просроченная тестовая не считается');
    await api('DELETE', '/api/cases/s-test', { token: otherTok });

    const osf = await api('GET', '/api/stats/osf', { token: otherTok });
    assert.equal(osf.json.stats.length, 12);
    assert.equal(osf.json.stats[0].code, 'TR'); assert.equal(osf.json.stats[0].n, 2);
    assert.equal(osf.json.stats[1].code, 'WM'); assert.equal(osf.json.stats[1].n, 1);
    assert.equal(osf.json.casesWithOsf, 2); assert.equal(osf.json.cases, 2);
    // чужая организация: ноль
    assert.equal((await api('GET', '/api/stats/osf', { token: adminTok })).json.cases, 0);
  });

  test('резервная копия организации (admin): все дела пакетами, чужая организация не попадает', async () => {
    assert.equal((await api('GET', '/api/export', { token: 'bogus-token' })).status, 401);
    const rdr = await api('GET', '/api/export', { token: readerTok });
    assert.equal(rdr.status, 403);
    const exp = await api('GET', '/api/export', { token: otherTok });
    assert.equal(exp.status, 200); assert.equal(exp.json.format, 'soam-investigator/organisation');
    assert.ok(exp.json.exportedAt && exp.json.cases[1].bundle.classifications.length === 2, 'склеенный JSON разбирается целиком');
    const combined = await api('GET', '/api/stats', { token: otherTok });
    assert.equal(combined.json.actions.overdue, 1); assert.equal(combined.json.osf.stats[0].code, 'TR');
    assert.equal(exp.json.organisation.name, 'АНСП'); assert.equal(exp.json.cases.length, 2);
    assert.equal(exp.json.cases[0].bundle.occurrence.id, 's-1'); assert.equal(exp.json.cases[0].version, 1);
    const mine = await api('GET', '/api/export', { token: adminTok });
    assert.equal(mine.json.cases.length, 0);
    const au = await api('GET', '/api/audit', { token: otherTok });
    assert.ok(au.json.audit.some((a) => a.action === 'org.export'));
  });

  test('восстановление из резервной копии (admin): новые дела, более новые версии, пропуск старых и чужих, отчёт об ошибках', async () => {
    // в организации «АНСП» (otherTok) лежат s-1 v1 и s-2 v1; в «АГА РТ» (adminTok) — ничего
    assert.equal((await api('POST', '/api/import', { token: readerTok, body: { format: 'soam-investigator/organisation', cases: [] } })).status, 403);
    assert.equal((await api('POST', '/api/import', { token: otherTok, body: { format: 'x', cases: [] } })).json.error, 'format');
    const file = {
      format: 'soam-investigator/organisation', exportedAt: 'x', organisation: { id: 'any', name: 'any' },
      cases: [
        { id: 's-1', version: 1, bundle: bundle('s-1') },                       // та же версия → пропуск
        { id: 's-2', version: 5, bundle: bundle('s-2', { status: 'completed' }) }, // новее → обновление до версии 5
        { id: 's-9', version: 3, bundle: bundle('s-9') },                       // новое → вставка с версией 3
        { id: 's-bad', version: 1, bundle: { occurrence: { id: 's-bad' }, facts: [], classifications: [{ id: 'c', factId: 'nope' }] } }, // битый пакет
        { id: 's-mis', version: 1, bundle: bundle('s-other') },                 // id не совпадает
      ],
    };
    const r = await api('POST', '/api/import', { token: otherTok, body: file });
    assert.equal(r.status, 200);
    assert.equal(r.json.imported, 1); assert.equal(r.json.updated, 1); assert.equal(r.json.skipped, 1); assert.equal(r.json.errors.length, 2);
    assert.equal((await api('GET', '/api/cases/s-2', { token: otherTok })).json.version, 5);
    assert.equal((await api('GET', '/api/cases/s-2', { token: otherTok })).json.status, 'completed');
    assert.equal((await api('GET', '/api/cases/s-9', { token: otherTok })).json.version, 3);
    // чужая организация: s-1 принадлежит «АНСП» — для «АГА РТ» пропуск, не перезапись
    const foreign = await api('POST', '/api/import', { token: adminTok, body: { ...file, cases: [{ id: 's-1', version: 99, bundle: bundle('s-1') }] } });
    assert.equal(foreign.json.skipped, 1); assert.equal(foreign.json.imported, 0);
    assert.equal((await api('GET', '/api/cases/s-1', { token: otherTok })).json.version, 1);
    const au = await api('GET', '/api/audit', { token: otherTok });
    assert.ok(au.json.audit.some((a) => a.action === 'org.import' && a.details.updated === 1));
    await api('DELETE', '/api/cases/s-9', { token: otherTok });
  });

  test('перебор паролей: после 10 неудач — 429 даже с верным паролем; заголовки безопасности', async () => {
    const body = { email: 'rd@aga.tj', password: 'wrong' };
    for (let i = 0; i < 10; i++) assert.equal((await api('POST', '/api/auth/login', { body })).status, 401);
    const blocked = await api('POST', '/api/auth/login', { body: { email: 'rd@aga.tj', password: 'secret-123' } });
    assert.equal(blocked.status, 429); assert.equal(blocked.json.error, 'too-many-attempts'); assert.ok(blocked.json.retryAfterSec > 0);
    // другая почта с того же IP не заблокирована
    assert.equal((await api('POST', '/api/auth/login', { body: { email: A.email, password: A.password } })).status, 200);
    assert.equal((await api('POST', '/api/auth/register', { body: { ...A, email: 'x@y.z', password: 'p'.repeat(201) } })).json.error, 'password', 'слишком длинный пароль');
    const h = await fetch(base + '/api/health');
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff'); assert.equal(h.headers.get('cache-control'), 'no-store'); assert.equal(h.headers.get('x-powered-by'), null);
  });

  test('ограничитель: блок на полное окно от последней неудачи, снятие по времени и сброс при успехе; нулевой лимит из env не ломает', async () => {
    const { limiter, envInt } = await import('../src/limiter.js');
    let now = 1_000_000; const clock = () => now;
    const L = limiter(3, 1000, clock);
    const isBlocked = (k) => { let b = null; L.check(k, (s) => { b = s; }); return b; };
    L.hit('k'); now += 900; L.hit('k'); now += 50; L.hit('k'); // третья неудача на 950 мс — окно продлевается от неё
    assert.equal(isBlocked('k'), 1, 'заблокирован, retryAfter ≈ 1 с');
    now += 600; assert.ok(isBlocked('k'), 'через 600 мс после 3-й неудачи всё ещё блок (исходное окно уже истекло бы)');
    now += 500; assert.equal(isBlocked('k'), null, 'окно от последней неудачи истекло — снято');
    L.hit('k'); L.hit('k'); L.hit('k'); assert.ok(isBlocked('k')); L.reset('k'); assert.equal(isBlocked('k'), null, 'сброс при успешном входе');
    assert.equal(isBlocked('other'), null);
    process.env.X_TEST_LIMIT = '0'; assert.equal(envInt('X_TEST_LIMIT', 10), 10);
    process.env.X_TEST_LIMIT = 'abc'; assert.equal(envInt('X_TEST_LIMIT', 10), 10);
    process.env.X_TEST_LIMIT = '7'; assert.equal(envInt('X_TEST_LIMIT', 10), 7);
    delete process.env.X_TEST_LIMIT;
  });

  test('AI-подсказка: выключено → 503; заглушка → строгий JSON по таксономии; только обезличенные данные; reader → 403; журнал без текста', async () => {
    const { createAi, parseJson, normalise, buildPrompt } = await import('../src/ai.js');
    assert.equal(createAi({ provider: 'none' }).enabled, false);
    assert.equal(createAi({ provider: 'gemini', apiKey: '' }).enabled, false, 'без ключа выключено');
    assert.equal(createAi({ provider: 'claude', apiKey: 'k' }).model, 'claude-haiku-5-5');
    assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
    const n = normalise({ contributes: 'yes', elements: [{ element: 'OSF', osfCodes: ['TR', 'XX'] }, { element: 'ZZ' }, { element: 'BAR', barrierType: 'nope', barrierState: 'failed' }], hiRewrite: ' x ', questions: ['q', 5] });
    assert.deepEqual(n.elements.map((e) => e.element), ['OSF', 'BAR']); assert.deepEqual(n.elements[0].osfCodes, ['TR']); assert.equal(n.elements[1].barrierType, null); assert.equal(n.hiRewrite, 'x'); assert.deepEqual(n.questions, ['q']);
    assert.ok(buildPrompt({ fact: { text: 'x' } }).includes('TR — Training'), 'таксономия в промпте');

    const ctx = { anonymised: true, title: 'Дело', type: 'incident', outcome: ['исход'], otherFacts: ['факт 2'], caseId: 's-1' };
    assert.equal((await api('POST', '/api/ai/suggest', { token: otherTok, body: { fact: { text: 'x' }, context: ctx } })).json.error, 'ai-disabled', 'по умолчанию выключено');

    const appAi = createApp(db, { allowRegistration: true, ai: createAi({ provider: 'mock' }) });
    const s = await new Promise((r) => { const x = appAi.listen(0, () => r(x)); });
    const call = (token, body) => fetch(`http://127.0.0.1:${s.address().port}/api/ai/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
    const h = await fetch(`http://127.0.0.1:${s.address().port}/api/health`).then((r) => r.json());
    assert.equal(h.ai.enabled, true); assert.equal(h.ai.provider, 'mock');
    assert.equal((await call(readerTok, { fact: { text: 'x' }, context: ctx })).status, 403);
    assert.equal((await call(otherTok, { fact: { text: 'x' }, context: { ...ctx, anonymised: false } })).json.error, 'not-anonymised');
    assert.equal((await call(otherTok, { fact: { text: '' }, context: ctx })).json.error, 'fact');
    const r = await call(otherTok, { fact: { text: 'Диспетчер не прошёл обучение по новой процедуре, предупреждение не обнаружено' }, context: ctx });
    assert.equal(r.status, 200); assert.equal(r.json.provider, 'mock');
    const els = r.json.suggestion.elements.map((e) => e.element);
    assert.ok(els.includes('HI') && els.includes('OSF') && els.includes('BAR'), els.join());
    assert.equal(r.json.suggestion.elements.find((e) => e.element === 'OSF').osfCodes[0], 'TR');
    assert.ok(r.json.suggestion.hiRewrite, 'нейтральная формулировка');
    const au = await api('GET', '/api/audit?caseId=s-1', { token: otherTok });
    const rec = au.json.audit.find((a) => a.action === 'ai.suggest');
    assert.ok(rec && rec.details.provider === 'mock' && !JSON.stringify(rec.details).includes('Диспетчер'), 'в журнале нет текста факта');
    s.close();
  });

  test('регистрация закрыта флагом', async () => {
    const closed = createApp(db, { allowRegistration: false });
    const s = await new Promise((r) => { const x = closed.listen(0, () => r(x)); });
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(A) });
    assert.equal(res.status, 403);
    s.close();
  });
});
