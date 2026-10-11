// Обезличивание дела перед передачей наружу (другой организации, в учебные материалы, в AI на этапе 5).
// Чистые функции без DOM и БД — покрыты тестами. Вложения в обезличенную копию не попадают (содержимое файлов не проверить).

/** Автоматические правила: что заменяем без словаря. Порядок важен — почта раньше «слов с цифрами». */
export const AUTO_RULES = [
  { key: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, label: 'ПОЧТА' },
  // телефон: не меньше 9 цифр и не дата вида 2026-10-01 / 2026-10-01T10:00
  { key: 'phone', re: /(?<!\d)(?:\+?\d[\d\s()-]{7,}\d)(?!\d)/g, label: 'ТЕЛЕФОН', test: (m) => m.replace(/\D/g, '').length >= 9 && !/^\d{4}-\d\d-\d\d/.test(m) },
  { key: 'registration', re: /\b(?:EY|EX|UP|UK|RA|VP|VQ|4K|EK|UN|TC|A6|9K)-[A-Z0-9]{3,5}\b/g, label: 'БОРТ' },
  { key: 'callsign', re: /\b[A-Z]{3}\d{1,4}[A-Z]?\b/g, label: 'РЕЙС' },
];

/**
 * Словарь замен из текста «оригинал → замена» (по строке на пару; разделитель «→», «=>» или табуляция).
 * Пустая замена → «[СКРЫТО]». Длинные оригиналы заменяются первыми, чтобы «Иванов И. И.» не ломался заменой «Иванов».
 */
export function parseDictionary(text, { redacted = '[СКРЫТО]' } = {}) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.split(/\s*(?:→|=>|\t)\s*/);
    const from = (m[0] || '').trim();
    if (!from) continue;
    out.push({ from, to: (m[1] || '').trim() || redacted });
  }
  return out.sort((a, b) => b.from.length - a.from.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Обезличить строку: сначала словарь (без учёта регистра), затем автоправила. Возвращает { text, counts }. */
export function anonymiseText(text, dict = [], { auto = true, labels = {} } = {}) {
  if (typeof text !== 'string' || !text) return { text, counts: {} };
  const counts = {};
  let out = text;
  for (const d of dict) {
    const re = new RegExp(escapeRe(d.from), 'gi');
    out = out.replace(re, () => { counts[d.from] = (counts[d.from] || 0) + 1; return d.to; });
  }
  if (auto) {
    for (const r of AUTO_RULES) {
      out = out.replace(r.re, (m) => { if (m.startsWith('[') || (r.test && !r.test(m))) return m; counts[r.key] = (counts[r.key] || 0) + 1; return `[${labels[r.key] || r.label}]`; });
    }
  }
  return { text: out, counts };
}

const TEXT_FIELDS = {
  occurrence: ['title', 'place', 'investigateReason', 'participants', 'disseminated'],
  occurrenceLists: ['outcome', 'lessons'],
  fact: ['text', 'source'],
  event: ['description'],
  classification: ['note'],
  action: ['text', 'responsible'],
};

/**
 * Обезличенная копия переносимого пакета (формат toPortable). Вложения удаляются (остаётся только их число),
 * тексты проходят через anonymiseText; остальное (коды, связи, статусы, даты) сохраняется. Возвращает { bundle, counts, removedAttachments }.
 */
export function anonymiseBundle(p, dict = [], opts = {}) {
  const total = {};
  const add = (c) => { for (const [k, v] of Object.entries(c)) total[k] = (total[k] || 0) + v; };
  const str = (s) => { const r = anonymiseText(s, dict, opts); add(r.counts); return r.text; };
  const list = (arr) => (Array.isArray(arr) ? arr.map(str) : arr);
  let removed = 0;
  const occ = { ...p.occurrence };
  for (const f of TEXT_FIELDS.occurrence) if (typeof occ[f] === 'string') occ[f] = str(occ[f]);
  if (occ.title && typeof occ.title === 'object') occ.title = Object.fromEntries(Object.entries(occ.title).map(([k, v]) => [k, str(v)]));
  for (const f of TEXT_FIELDS.occurrenceLists) occ[f] = list(occ[f]);
  delete occ.remote;
  delete occ.anonDict; // сама таблица замен содержит оригиналы — в копию не попадает
  occ.anonymised = { at: new Date().toISOString(), dictionaryEntries: dict.length };
  const facts = (p.facts || []).map((f) => {
    const n = (f.attachments || []).length; removed += n;
    const out = { ...f, attachments: [], attachmentsRemoved: n || undefined };
    for (const k of TEXT_FIELDS.fact) if (typeof out[k] === 'string') out[k] = str(out[k]);
    if (out.followUp && out.followUp.question) out.followUp = { ...out.followUp, question: str(out.followUp.question) };
    return out;
  });
  const events = (p.events || []).map((e) => ({ ...e, description: str(e.description) }));
  const classifications = (p.classifications || []).map((c) => (c.note ? { ...c, note: str(c.note) } : c));
  const actions = (p.actions || []).map((a) => { const o = { ...a }; for (const k of TEXT_FIELDS.action) if (typeof o[k] === 'string') o[k] = str(o[k]); return o; });
  const qa = p.qa ? { ...p.qa, items: Object.fromEntries(Object.entries(p.qa.items || {}).map(([k, v]) => [k, v && v.note ? { ...v, note: str(v.note) } : v])) } : p.qa;
  return { bundle: { ...p, occurrence: occ, facts, events, classifications, actions: actions, qa }, counts: total, removedAttachments: removed };
}
