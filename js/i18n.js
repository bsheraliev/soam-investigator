// Интерфейсные строки: data/i18n/<lang>.json. Порядок подстановки: выбранный язык → en → сам ключ.
// Для записей таксономии ({en, ru, tj}) — функция tx().

export const LANGS = ['ru', 'tj', 'en'];
const STORAGE_KEY = 'soam.lang';
const dicts = {};
let lang = 'ru';
const listeners = new Set();

export function getLang() { return lang; }

export async function setLang(next) {
  if (!LANGS.includes(next)) next = 'ru';
  await load(next);
  if (next !== 'en') await load('en');
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* приватный режим */ }
  document.documentElement.lang = next;
  for (const fn of listeners) fn(next);
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function initI18n() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  await setLang(saved || 'ru');
}

async function load(l) {
  if (dicts[l]) return dicts[l];
  const res = await fetch(`data/i18n/${l}.json`);
  if (!res.ok) throw new Error(`i18n: не найден словарь ${l}`);
  dicts[l] = await res.json();
  return dicts[l];
}

/** Строка интерфейса по ключу с подстановкой {name}. */
export function t(key, params) {
  let s = (dicts[lang] && dicts[lang][key]) ?? (dicts.en && dicts.en[key]) ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Текст записи таксономии на текущем языке; пустой перевод → английский оригинал. */
export function tx(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return (entry[lang] && entry[lang].trim()) || entry.en || '';
}

/** Проставляет переводы элементам с data-i18n внутри root. */
export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}
