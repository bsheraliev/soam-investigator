// Дело на вкладках: Событие · Факты · Хронология · Сортировка · Схема · Меры · QA.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { severity, taxonomy } from '../taxonomy.js';
import { escapeHtml } from '../ui.js';
import { unsortedFacts, readiness } from '../rules.js';
import * as eventTab from './occurrence-form.js';
import * as factsTab from './facts.js';
import * as timelineTab from './timeline.js';
import * as sortTab from './sort.js';
import * as chartTab from './chart.js';
import * as actionsTab from './actions.js';
import * as qaTab from './qa.js';

const TABS = { event: eventTab, facts: factsTab, timeline: timelineTab, sort: sortTab, chart: chartTab, actions: actionsTab, qa: qaTab };
const ORDER = ['event', 'facts', 'timeline', 'sort', 'chart', 'actions', 'qa'];

export async function render(view, id, tab = 'event') {
  if (tab === 'soam') tab = 'chart';
  if (!TABS[tab]) tab = 'event';
  const store = await db();
  const o = await store.get('occurrence', id);
  if (!o) {
    view.innerHTML = `<div class="card"><h2>${t('error.notFound')}</h2><p><a href="#/">${t('nav.home')}</a></p></div>`;
    return;
  }
  const [facts, classifications, actions, qa] = await Promise.all([
    store.byIndex('fact', 'occurrenceId', id),
    store.byIndex('classification', 'occurrenceId', id),
    store.byIndex('action', 'occurrenceId', id),
    store.get('qa', id),
  ]);
  const qaIds = taxonomy().qa_checklist.map((q) => q.id);
  const ready = readiness({ facts, classifications, actions, qa, qaIds });
  const sev = o.severity ? severity(o.severity) : null;
  const base = `#/occurrence/${encodeURIComponent(id)}`;
  const badge = (k) => {
    if (k === 'facts' && facts.length) return `<span class="count">${facts.length}</span>`;
    if (k === 'sort' && ready.unsorted) return `<span class="count warn">${ready.unsorted}</span>`;
    if (k === 'actions' && ready.uncovered.length) return `<span class="count warn">${ready.uncovered.length}</span>`;
    if (k === 'qa') return `<span class="count ${ready.ok ? 'ok' : ''}">${ready.qaDone}/${ready.qaTotal}</span>`;
    return '';
  };

  view.innerHTML = `
    <div class="occ-head">
      <h1>${escapeHtml(tx(o.title)) || t('occ.untitled')}</h1>
      <p>
        <span class="tag">${t('type.' + (o.type || 'unknown'))}</span>
        ${o.date ? `<span class="tag">${escapeHtml(String(o.date).replace('T', ' '))}</span>` : ''}
        ${o.place ? `<span class="tag">${escapeHtml(o.place)}</span>` : ''}
        ${sev ? `<span class="tag sev" title="${escapeHtml(tx(sev))}">${sev.code}</span>` : ''}
        <span class="tag ${o.status === 'completed' ? 'ok' : ''}">${t('status.' + (o.status || 'draft'))}</span>
        ${o.isTestCase ? `<span class="tag">${t('home.testCase')}</span>` : ''}
      </p>
    </div>
    <nav class="tabs">
      ${ORDER.map((k) => `<a href="${base}/${k}" class="${k === tab ? 'active' : ''}">${t('tab.' + k)} ${badge(k)}</a>`).join('')}
    </nav>
    <section id="tabBody"></section>`;

  const ctx = {
    store, occurrence: o, id, facts, classifications, actions, qa, readiness: ready, base,
    refresh: () => render(view, id, tab),
  };
  await TABS[tab].renderTab(view.querySelector('#tabBody'), ctx);
}
