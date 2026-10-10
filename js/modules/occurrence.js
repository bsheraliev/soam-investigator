// Просмотр дела (этап 0): карточка события и элементы SOAM по колонкам — для сверки со схемой QRG.
// Редактирование фактов, хронология, сортировка — этап 1. SOAM Chart (SVG) — этап 2.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { osf, severity, element } from '../taxonomy.js';
import { escapeHtml } from '../app.js';

const COLUMNS = ['other', 'OSF', 'CC', 'HI', 'BAR'];

export async function render(view, id) {
  const store = await db();
  const o = await store.get('occurrence', id);
  if (!o) {
    view.innerHTML = `<div class="card"><h2>${t('error.notFound')}</h2></div>`;
    return;
  }
  const [facts, classes, links] = await Promise.all([
    store.byIndex('fact', 'occurrenceId', id),
    store.byIndex('classification', 'occurrenceId', id),
    store.byIndex('link', 'occurrenceId', id),
  ]);
  const factById = Object.fromEntries(facts.map((f) => [f.id, f]));
  const sev = o.severity ? severity(o.severity) : null;

  const col = (key) => {
    const items = classes
      .filter((c) => key === 'other' ? (c.element === 'OSF' && c.otherSystem) : (c.element === key && !(key === 'OSF' && c.otherSystem)))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (key === 'other' && !items.length) return '';
    const title = key === 'other' ? t('soam.otherSystem') : tx(element(key));
    return `<div class="soam-col"><h3>${escapeHtml(title)}</h3>${items.map((c) => node(c)).join('') || `<p class="muted small">—</p>`}</div>`;
  };

  const node = (c) => {
    const f = factById[c.factId];
    const cls = ['node', c.element.toLowerCase(), c.barrierState || '', (c.otherSystem ? 'dashed' : '')].join(' ');
    const codes = (c.osfCodes || []).map((k) => {
      const e = osf(k);
      return `<span class="code" title="${escapeHtml(e ? tx(e) : '')}">${k}</span>`;
    }).join('/ ');
    return `<div class="${cls}">${codes ? codes + ' ' : ''}${escapeHtml(f ? f.text : c.factId)}</div>`;
  };

  view.innerHTML = `
    <h1>${escapeHtml(tx(o.title))}</h1>
    <div class="card">
      <p>
        <span class="tag">${t('type.' + (o.type || 'unknown'))}</span>
        <span class="tag">${escapeHtml(o.date || '')}</span>
        ${o.place ? `<span class="tag">${escapeHtml(o.place)}</span>` : ''}
        ${sev ? `<span class="tag sev">${sev.code} · ${escapeHtml(tx(sev))}</span>` : `<span class="tag muted">${t('field.severity')}: —</span>`}
        <span class="tag">${t('status.' + (o.status || 'draft'))}</span>
        ${o.isTestCase ? `<span class="tag">${t('home.testCase')}</span>` : ''}
      </p>
      <p class="small muted">${t('occ.counts', { facts: facts.length, classes: classes.length, links: links.length })}</p>
    </div>

    <h2>${t('occ.soamElements')}</h2>
    <p class="small muted">${t('occ.soamNote')}</p>
    <div class="grid">
      ${COLUMNS.map(col).join('')}
      <div class="soam-col"><h3>${t('type.' + (o.type || 'unknown'))}</h3>
        ${(o.outcome || []).map((x) => `<div class="node outcome">${escapeHtml(x)}</div>`).join('') || '<p class="muted small">—</p>'}
      </div>
    </div>`;
}
