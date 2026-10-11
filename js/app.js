// Инициализация, хеш-роутер, service worker, язык.
import { initI18n, setLang, getLang, t, applyDom, onLangChange } from './i18n.js';
import { loadTaxonomy } from './taxonomy.js';
import { escapeHtml, toast } from './ui.js';
import * as home from './modules/home.js';
import * as about from './modules/about.js';
import * as registry from './modules/registry.js';
import * as sync from './modules/sync.js';
import * as cases from './modules/cases.js';
import * as occurrence from './modules/occurrence.js';
import * as occurrenceForm from './modules/occurrence-form.js';

export const APP_VERSION = '0.5.14';
export { escapeHtml, toast };

const ROUTES = [
  { path: /^\/?$/, module: home },
  { path: /^\/cases$/, module: cases },
  { path: /^\/occurrence\/new$/, module: occurrenceForm },
  { path: /^\/occurrence\/([^/]+)(?:\/([a-z]+))?$/, module: occurrence },
  { path: /^\/registry$/, module: registry },
  { path: /^\/sync$/, module: sync },
  { path: /^\/about$/, module: about },
];

const NAV = [
  { href: '#/', key: 'nav.home' },
  { href: '#/registry', key: 'nav.registry' },
  { href: '#/cases', key: 'nav.cases' },
  { href: '#/sync', key: 'nav.sync' },
  { href: '#/about', key: 'nav.about' },
];

const view = document.getElementById('view');

// Доступность: кликабельные строки списков и узлы схемы получают фокус и срабатывают по Enter / Space.
function makeFocusable(root) {
  root.querySelectorAll('.link-row:not([tabindex])').forEach((r) => { r.tabIndex = 0; r.setAttribute('role', 'button'); });
}
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches && n.matches('.link-row:not([tabindex])')) { n.tabIndex = 0; n.setAttribute('role', 'button'); } makeFocusable(n); }
}).observe(view, { childList: true, subtree: true });
view.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const target = e.target.closest('.link-row, [data-node][tabindex]');
  if (!target || target !== e.target) return; // клавиши внутри полей и кнопок не трогаем
  e.preventDefault();
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // у SVG-элементов нет click()
});

function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.split('?')[0];
}

export async function render() {
  const path = currentPath();
  for (const r of ROUTES) {
    const m = path.match(r.path);
    if (m) {
      view.innerHTML = '';
      try {
        await r.module.render(view, ...m.slice(1).map((x) => (x === undefined ? x : decodeURIComponent(x))));
      } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="card"><h2>${t('error.title')}</h2><p class="muted">${escapeHtml(e.message)}</p></div>`;
      }
      applyDom(view);
      markNav(path);
      window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = `<div class="card"><h2>${t('error.notFound')}</h2><p><a href="#/">${t('nav.home')}</a></p></div>`;
  markNav(path);
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map((n) => `<a href="${n.href}" data-i18n="${n.key}">${t(n.key)}</a>`).join('');
}

function markNav(path) {
  document.querySelectorAll('#nav a').forEach((a) => {
    const p = a.getAttribute('href').replace(/^#/, '');
    a.classList.toggle('active', p === '/' ? path === '/' || path.startsWith('/occurrence') : path.startsWith(p));
  });
}

function updateOffline() {
  document.getElementById('offlineBadge').hidden = navigator.onLine;
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'VERSION') {
        document.getElementById('versionLabel').textContent = `v${APP_VERSION} · sw ${e.data.version}`;
      }
    });
    const ask = () => navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('GET_VERSION');
    if (navigator.serviceWorker.controller) ask();
    navigator.serviceWorker.addEventListener('controllerchange', ask);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) toast(t('app.updated'));
      });
    });
  } catch (e) {
    console.warn('sw:', e.message);
  }
}

async function main() {
  document.getElementById('versionLabel').textContent = `v${APP_VERSION}`;
  await initI18n();
  await loadTaxonomy();
  const sel = document.getElementById('langSelect');
  sel.value = getLang();
  sel.addEventListener('change', () => setLang(sel.value));
  onLangChange(() => { buildNav(); applyDom(document); render(); });
  buildNav();
  applyDom(document);
  window.addEventListener('hashchange', render);
  window.addEventListener('online', updateOffline);
  window.addEventListener('offline', updateOffline);
  updateOffline();
  await render();
  registerSW();
}

main().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="card"><h2>Ошибка запуска</h2><p>${escapeHtml(e.message)}</p></div>`;
});
