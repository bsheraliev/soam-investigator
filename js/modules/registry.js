// «Реестр мер»: меры безопасности со сроками и просрочкой; статистика по кодам OSF.
// Область: дела в этом браузере (всегда) или все дела организации с сервера (если выполнен вход на экране «Сервер»).
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy, osf } from '../taxonomy.js';
import { escapeHtml, short, toast } from '../ui.js';
import { actionsRegistry, actionOverdue, osfStats, ACTION_STATUSES } from '../rules.js';
import { getSession, api } from './sync.js';

let filter = 'open'; // open | overdue | all
let scope = 'local'; // local | server

/** Данные из локальной базы — в том же виде, что отдаёт сервер. */
async function localData() {
  const store = await db();
  const today = new Date().toISOString().slice(0, 10);
  const [occurrences, actions, classes] = await Promise.all([store.all('occurrence'), store.all('action'), store.all('classification')]);
  const occById = Object.fromEntries(occurrences.map((o) => [o.id, o]));
  const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
  const all = actions.map((a) => ({
    ...a, caseTitle: occById[a.occurrenceId] ? tx(occById[a.occurrenceId].title) : '—', caseId: a.occurrenceId, local: true,
    addresses: (a.addresses || []).map((id) => classById[id]).filter(Boolean).map((c) => `${c.element}${c.element === 'OSF' ? ' ' + (c.osfCodes || []).join('/') : ''}`),
  }));
  const codes = taxonomy().osf.map((o) => o.code);
  return {
    actions: actionsRegistry(all, today).map((a) => ({ ...a, overdue: actionOverdue(a, today) })),
    stats: osfStats(classes, codes),
    casesWithOsf: new Set(classes.filter((c) => c.element === 'OSF').map((c) => c.occurrenceId)).size,
    cases: occurrences.length,
  };
}

async function serverData() {
  const { actions, osf } = await api('GET', '/api/stats'); // одна выборка на обе сводки
  return { actions: actions.actions, stats: osf.stats, casesWithOsf: osf.casesWithOsf, cases: osf.cases };
}

export async function render(view) {
  const session = getSession();
  const connected = !!(session && session.token);
  if (!connected) scope = 'local';
  let data;
  try {
    data = scope === 'server' ? await serverData() : await localData();
  } catch (e) {
    toast(t('sync.err.' + (e.code || 'generic')) + (e.code === 'unauthorized' ? '' : ''));
    scope = 'local'; data = await localData();
  }

  const all = data.actions;
  const overdue = all.filter((a) => a.overdue);
  const list = filter === 'all' ? all : filter === 'overdue' ? overdue : all.filter((a) => a.status !== 'done');

  const rows = list.map((a) => `<tr class="${a.overdue ? 'overdue' : ''}">
      <td>${a.local ? `<a href="#/occurrence/${encodeURIComponent(a.caseId)}/actions">${escapeHtml(short(a.caseTitle, 60))}</a>` : escapeHtml(short(a.caseTitle, 60))}</td>
      <td>${escapeHtml(a.text)}</td>
      <td class="small muted">${escapeHtml((a.addresses || []).join(', '))}</td>
      <td>${escapeHtml(a.responsible || '')}</td>
      <td class="nowrap">${escapeHtml(a.due || '—')}${a.overdue ? ` <span class="tag warn">${t('registry.overdue')}</span>` : ''}</td>
      <td>${t('actions.status.' + (ACTION_STATUSES.includes(a.status) ? a.status : 'planned'))}</td>
    </tr>`).join('');

  const max = Math.max(1, ...data.stats.map((s) => s.n));

  view.innerHTML = `
    <h1>${t('registry.title')}</h1>
    <p class="lead">${t('registry.lead')}</p>
    ${connected ? `<div class="card"><div class="btn-row top">
      <button class="btn ${scope === 'local' ? '' : 'secondary'} small" data-scope="local">${t('registry.scopeLocal')}</button>
      <button class="btn ${scope === 'server' ? '' : 'secondary'} small" data-scope="server">${t('registry.scopeServer', { org: escapeHtml(session.org.name) })}</button>
    </div></div>` : ''}
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
      <p class="small muted">${t('registry.osfLead', { n: data.casesWithOsf, total: data.cases })}</p>
      ${data.stats.some((s) => s.n) ? `<table class="stats">${data.stats.map((s) => `<tr><td class="nowrap"><strong>${s.code}</strong></td><td class="small">${escapeHtml(tx(osf(s.code)))}</td><td class="bar-cell"><div class="bar" style="width:${Math.round(100 * s.n / max)}%"></div></td><td class="nowrap">${s.n}</td></tr>`).join('')}</table>` : `<p class="muted">${t('registry.osfEmpty')}</p>`}
    </div>`;

  view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(view); }));
  view.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; render(view); }));
}
