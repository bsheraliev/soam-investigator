// Слой БД: SQLite (node:sqlite, локально и в тестах) или PostgreSQL (DATABASE_URL, Render + Neon).
// Один API: q(sql, params) → строки, run(sql, params) → { changes }. Плейсхолдеры — «?», для Postgres переписываются в $n.
// Даты — ISO-строки, JSON — текст: так схема одинакова в обоих движках.

const MIGRATIONS = [
  // 1 — исходная схема
  `CREATE TABLE IF NOT EXISTS organisation (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS app_user (
     id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisation(id),
     email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
     role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS session (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_user(id),
     expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS occurrence_case (
     id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisation(id),
     title TEXT NOT NULL, status TEXT, type TEXT, severity TEXT, date TEXT,
     bundle TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS occurrence_case_org ON occurrence_case(org_id);
   CREATE TABLE IF NOT EXISTS audit (
     id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL,
     case_id TEXT, details TEXT, at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS audit_org ON audit(org_id, at);`,
];

function toPg(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function openSqlite(path) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return {
    kind: 'sqlite',
    async q(sql, params = []) { return db.prepare(sql).all(...params); },
    async run(sql, params = []) { const r = db.prepare(sql).run(...params); return { changes: Number(r.changes) }; },
    async exec(sql) { db.exec(sql); },
    async close() { db.close(); },
  };
}

async function openPg(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  return {
    kind: 'pg',
    async q(sql, params = []) { return (await pool.query(toPg(sql), params)).rows; },
    async run(sql, params = []) { const r = await pool.query(toPg(sql), params); return { changes: r.rowCount || 0 }; },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
}

async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const rows = await db.q('SELECT v FROM schema_version');
  let v = rows.length ? Number(rows[0].v) : 0;
  if (!rows.length) await db.run('INSERT INTO schema_version (v) VALUES (?)', [0]);
  while (v < MIGRATIONS.length) {
    for (const stmt of MIGRATIONS[v].split(';').map((s) => s.trim()).filter(Boolean)) await db.exec(stmt);
    v += 1;
    await db.run('UPDATE schema_version SET v = ?', [v]);
  }
  return v;
}

/** DATABASE_URL → Postgres; иначе SQLite по пути (по умолчанию память — для тестов). */
export async function openDb({ databaseUrl = process.env.DATABASE_URL, sqlitePath = ':memory:' } = {}) {
  const db = databaseUrl ? await openPg(databaseUrl) : await openSqlite(sqlitePath);
  db.schemaVersion = await migrate(db);
  return db;
}
