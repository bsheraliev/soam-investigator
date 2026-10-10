// Service worker: кэш оболочки приложения для работы офлайн.
// При любом изменении кэшируемых файлов — поднять CACHE_VERSION.
const CACHE_VERSION = '0.3.5';
const CACHE_NAME = `soam-investigator-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/i18n.js',
  './js/taxonomy.js',
  './js/ui.js',
  './js/rules.js',
  './js/bundle.js',
  './js/modules/home.js',
  './js/modules/about.js',
  './js/modules/cases.js',
  './js/modules/occurrence.js',
  './js/modules/occurrence-form.js',
  './js/modules/facts.js',
  './js/modules/timeline.js',
  './js/modules/sort.js',
  './js/modules/chart.js',
  './js/modules/actions.js',
  './js/modules/qa.js',
  './js/modules/report.js',
  './js/modules/registry.js',
  './data/taxonomy.json',
  './data/i18n/ru.json',
  './data/i18n/tj.json',
  './data/i18n/en.json',
  './data/cases/index.json',
  './data/cases/bac111-1990.json',
  './data/cases/bangkok-1999.json',
  './data/cases/hamilton-2015.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' — мимо HTTP-кэша браузера, иначе в новую версию попадают старые файлы
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Оболочка: сначала кэш, потом сеть (и обновление кэша). Чужие домены не трогаем.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Ищем только в текущем кэше: caches.match() смотрит во все, включая ещё не удалённый старый.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(req, { ignoreSearch: true })).then((cached) => {
      const fromNet = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fromNet;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
