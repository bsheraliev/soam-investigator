// Запуск: PORT (Render задаёт сам), DATABASE_URL (Postgres) или SQLITE_PATH (по умолчанию server/data/soam.sqlite).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const sqlitePath = process.env.SQLITE_PATH || resolve(here, '../data/soam.sqlite');
if (!process.env.DATABASE_URL) mkdirSync(dirname(sqlitePath), { recursive: true });

const db = await openDb({ sqlitePath });
const app = createApp(db);
const port = Number(process.env.PORT || 8160);
app.listen(port, () => console.log(`SOAM Investigator API: http://localhost:${port}/api/health · БД: ${db.kind} (схема ${db.schemaVersion})`));
