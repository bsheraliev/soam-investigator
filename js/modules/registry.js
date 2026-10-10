// «Реестр мер»: все меры безопасности по всем делам в локальной базе со сроками и просрочкой; статистика по кодам OSF.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy, osf } from '../taxonomy.js';
import { escapeHtml, short } from '../ui.js';
import { actionsRegistry, actionOverdue, osfStats, ACTION_STATUSES } from '../rules.js';

let filter = 'open'; // open | overdue | all

export async function render(view) {
  const store = await db();
  const today = new Date().toISOString().slice(0, 10);
  const [occurrences, actions, classes] = await Promise.all([store.all('occurrence'), store.all('action'), store.all('classification')]);
  const occById = Object.fromEntries(occurrences.map((o) => [o.id, o]));
  const classById = Object.fromEntries(classes.map((c) => [c.id, c]));

  const all = actionsRegistry(actions, today);
  const overdue = all.filter((a) => actionOverdue(a, today));
  const list = filter === 'all' ? all : filter === 'overdue' ? overdue : all.filter((a) => a.status !== 'done');

  const rows = list.map((a) => {
    const o = occById[a.occurrenceId];
    const late = actionOverdue(a, today);
    const targets = (a.addresses || []).map((id) => classById[id]).filter(Boolean)
      .map((c) => `${c.element}${c.element === 'OSF' ? ' ' + (c.osfCodes || []).join('/') : ''}`).join(', ');
    return `<tr class="${late ? 'overdue' : ''}">
      <td>${o ? `<a href="#/occurrence/${encodeURIComponent(o.id)}/actions">${escapeHtml(short(tx(o.title), 60)) || t('occ.untitled')}</a>` : '—'}</td>
      <td>${escapeHtml(a.text)}</td>
      <td class="small muted">${escapeHtml(targets)}</td>
      <td>${escapeHtml(a.responsible || '')}</td>
      <td class="nowrap">${escapeHtml(a.due || '—')}${late ? ` <span class="tag warn">${t('registry.overdue')}</span>` : ''}</td>
      <td>${t('actions.status.' + (a.status || 'planned'))}</td>
    </tr>`;
  }).join('');

  const codes = taxonomy().osf.map((o) => o.code);
  const stats = osfStats(classes, codes);
  const max = Math.max(1, ...stats.map((s) => s.n));
  const osfOccurrences = new Set(classes.filter((c) => c.element === 'OSF').map((c) => c.occurrenceId)).size;

  view.innerHTML = `
    <h1>${t('registry.title')}</h1>
    <p class="lead">${t('registry.lead')}</p>
    <div class="card">
      <div class="btn-row top">
        ${[['open', t('registry.filterOpen', { n: all.filter((a) => a.status !== 'done').length })], ['overdue', t('registry.filterOverdue', { n: overdue.length })], ['all', t('registry.filterAll', { n: all.length })]]
          .map(([k, label]) => `<button class="btn ${filter === k ? '' : 'secondary'} small" data-filter="${k}">${label}</button>`).join('')}
      </div>
      ${list.length ? `<table>
        <thead><tr><th>${t('registry.occurrence')}</th><th>${t('actions.text')}</th><th>${t('actions.addresses')}</th><th>${t('actions.responsible')}</th><th>${t('actions.due')}</th><th>${t('field.status')}</th></tr></thead>
        <tbody>${rows}</tbody></table>` : `<p class="muted">${t('registry.empty')}</p>`}
    </div>
    <div class="card">
      <h2>${t('registry.osfTitle')}</h2>
      <p class="small muted">${t('registry.osfLead', { n: osfOccurrences, total: occurrences.length })}</p>
      ${classes.some((c) => c.element === 'OSF') ? `<table class="stats">${stats.map((s) => `<tr><td class="nowrap"><strong>${s.code}</strong></td><td class="small">${escapeHtml(tx(osf(s.code)))}</td><td class="bar-cell"><div class="bar" style="width:${Math.round(100 * s.n / max)}%"></div></td><td class="nowrap">${s.n}</td></tr>`).join('')}</table>` : `<p class="muted">${t('registry.osfEmpty')}</p>`}
    </div>`;

  view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(view); }));
}
