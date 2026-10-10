// Вкладка «Элементы SOAM»: классификации по колонкам — для сверки со схемой QRG. SVG-схема — этап 2.
import { t, tx } from '../i18n.js';
import { taxonomy, osf, barrier, element } from '../taxonomy.js';
import { escapeHtml } from '../ui.js';
import { otherSafetyIssues } from '../rules.js';

const COLUMNS = ['other', 'OSF', 'CC', 'HI', 'BAR'];

export async function renderTab(container, ctx) {
  const tax = taxonomy();
  const o = ctx.occurrence;
  const classes = await ctx.store.byIndex('classification', 'occurrenceId', ctx.id);
  const factById = Object.fromEntries(ctx.facts.map((f) => [f.id, f]));
  const other = otherSafetyIssues(ctx.facts);

  const node = (c) => {
    const f = factById[c.factId];
    const cls = ['node', c.element.toLowerCase(), c.barrierState || '', c.otherSystem ? 'dashed' : '', c.confirmed === false ? 'unconfirmed' : ''].join(' ');
    let head = '';
    if (c.element === 'OSF') head = (c.osfCodes || []).map((k) => `<span class="code" title="${escapeHtml(osf(k) ? tx(osf(k)) : '')}">${k}</span>`).join('/ ');
    if (c.element === 'CC' && c.ccCategory) head = `<span class="small muted">${escapeHtml(tx(tax._cc[c.ccCategory]))}</span><br>`;
    if (c.element === 'BAR') head = `<span class="small muted">${c.barrierType ? escapeHtml(tx(barrier(c.barrierType))) : ''}${c.barrierState ? ' · ' + t('barrier.' + c.barrierState) : ''}</span><br>`;
    return `<div class="${cls}">${head}${head && c.element === 'OSF' ? ' ' : ''}${escapeHtml(f ? f.text : c.factId)}</div>`;
  };

  const col = (key) => {
    const items = classes
      .filter((c) => key === 'other' ? (c.element === 'OSF' && c.otherSystem) : (c.element === key && !(key === 'OSF' && c.otherSystem)))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (key === 'other' && !items.length) return '';
    const title = key === 'other' ? t('soam.otherSystem') : tx(element(key));
    return `<div class="soam-col"><h3>${escapeHtml(title)}</h3>${items.map(node).join('') || '<p class="muted small">—</p>'}</div>`;
  };

  container.innerHTML = `
    <p class="small muted">${t('occ.soamNote')} · ${t('occ.counts', { facts: ctx.facts.length, classes: classes.length, links: (await ctx.store.byIndex('link', 'occurrenceId', ctx.id)).length })}</p>
    <div class="grid soam-grid">
      ${COLUMNS.map(col).join('')}
      <div class="soam-col"><h3>${t('type.' + (o.type || 'unknown'))}</h3>
        ${(o.outcome || []).map((x) => `<div class="node outcome">${escapeHtml(x)}</div>`).join('') || '<p class="muted small">—</p>'}
      </div>
    </div>
    ${other.length ? `<div class="card"><h3>${t('sort.otherTitle')}</h3><p class="small muted">${t('sort.otherNote')}</p>
      <ul>${other.map((f) => `<li>${escapeHtml(f.text)}</li>`).join('')}</ul></div>` : ''}`;
}
