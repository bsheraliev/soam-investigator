// Безголовый прогон тестов приложения: поднимает статический сервер из корня репозитория,
// открывает tests/index.html в Chromium и ждёт итог «N / M пройдено». Код выхода 1, если не все зелёные.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`${base}/tests/index.html`);
await page.waitForFunction(() => /^\d+ \/ \d+/.test(document.getElementById('summary').textContent), null, { timeout: 120000 });
const summary = await page.textContent('#summary');
const failed = await page.$$eval('li.fail', (els) => els.map((e) => e.textContent));
await browser.close();
server.close();

console.log(summary);
for (const f of failed) console.log('  ' + f);
const m = summary.match(/^(\d+) \/ (\d+)/);
const ok = m && m[1] === m[2] && failed.length === 0;
if (!ok) { console.log('Ошибки страницы:'); for (const e of errors) console.log('  ' + e); }
process.exit(ok ? 0 : 1);
