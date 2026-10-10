// Тесты API (node:test, без зависимостей): SQLite в памяти, сервер на свободном порту, запросы через fetch.
import { test, before, after } from 'node:test';
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

before(async () => {
  db = await openDb({ databaseUrl: '', sqlitePath: ':memory:' });
  const app = createApp(db, { allowedOrigins: 'https://example.org', allowRegistration: true });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

const A = { organisation: 'АГА РТ', name: 'Админ', email: 'admin@aga.tj', password: 'secret-123' };
let adminTok, invTok, readerTok, otherTok;

test('health и CORS', async () => {
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200); assert.equal(h.json.db, 'sqlite'); assert.equal(h.json.schema, 1);
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

  const osf = await api('GET', '/api/stats/osf', { token: otherTok });
  assert.equal(osf.json.stats.length, 12);
  assert.equal(osf.json.stats[0].code, 'TR'); assert.equal(osf.json.stats[0].n, 2);
  assert.equal(osf.json.stats[1].code, 'WM'); assert.equal(osf.json.stats[1].n, 1);
  assert.equal(osf.json.casesWithOsf, 2); assert.equal(osf.json.cases, 2);
  // чужая организация: ноль
  assert.equal((await api('GET', '/api/stats/osf', { token: adminTok })).json.cases, 0);
});

test('регистрация закрыта флагом', async () => {
  const closed = createApp(db, { allowRegistration: false });
  const s = await new Promise((r) => { const x = closed.listen(0, () => r(x)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(A) });
  assert.equal(res.status, 403);
  s.close();
});
