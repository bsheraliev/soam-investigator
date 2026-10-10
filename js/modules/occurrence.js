// Дело на вкладках: Событие · Факты · Хронология · Сортировка · Элементы SOAM.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { severity } from '../taxonomy.js';
import { escapeHtml } from '../ui.js';
import { unsortedFacts, contributingFacts, otherSafetyIssues } from '../rules.js';
import * as eventTab from './occurrence-form.js';
import * as factsTab from './facts.js';
import * as timelineTab from './timeline.js';
import * as sortTab from './sort.js';
import * as soamTab from './soam-view.js';

const TABS = {
  event: eventTab,
  facts: factsTab,
  timeline: timelineTab,
  sort: sortTab,
  soam: soamTab,
};

export async function render(view, id, tab = 'event') {
  if (!TABS[tab]) tab = 'event';
  const store = await db();
  const o = await store.get('occurrence', id);
  if (!o) {
    view.innerHTML = `<div class="card"><h2>${t('error.notFound')}</h2><p><a href="#/">${t('nav.home')}</a></p></div>`;
    return;
  }
  const facts = await store.byIndex('fact', 'occurrenceId', id);
  const sev = o.severity ? severity(o.severity) : null;
  const base = `#/occurrence/${encodeURIComponent(id)}`;
  const counts = {
    facts: facts.length,
    unsorted: unsortedFacts(facts).length,
    contributing: contributingFacts(facts).length,
    other: otherSafetyIssues(facts).length,
  };

  view.innerHTML = `
    <div class="occ-head">
      <h1>${escapeHtml(tx(o.title)) || t('occ.untitled')}</h1>
      <p>
        <span class="tag">${t('type.' + (o.type || 'unknown'))}</span>
        ${o.date ? `<span class="tag">${escapeHtml(String(o.date).replace('T', ' '))}</span>` : ''}
        ${o.place ? `<span class="tag">${escapeHtml(o.place)}</span>` : ''}
        ${sev ? `<span class="tag sev" title="${escapeHtml(tx(sev))}">${sev.code}</span>` : ''}
        <span class="tag">${t('status.' + (o.status || 'draft'))}</span>
        ${o.isTestCase ? `<span class="tag">${t('home.testCase')}</span>` : ''}
      </p>
    </div>
    <nav class="tabs">
      ${['event', 'facts', 'timeline', 'sort', 'soam'].map((k) => `
        <a href="${base}/${k}" class="${k === tab ? 'active' : ''}">${t('tab.' + k)}${k === 'facts' && counts.facts ? ` <span class="count">${counts.facts}</span>` : ''}${k === 'sort' && counts.unsorted ? ` <span class="count warn">${counts.unsorted}</span>` : ''}</a>`).join('')}
    </nav>
    <section id="tabBody"></section>`;

  const ctx = {
    store, occurrence: o, id, facts, counts, base,
    refresh: () => render(view, id, tab),
  };
  await TABS[tab].renderTab(view.querySelector('#tabBody'), ctx);
}
