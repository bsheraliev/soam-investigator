// Главная: реестр дел в локальной базе.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { severity } from '../taxonomy.js';
import { escapeHtml, toast, fmtDateTime } from '../ui.js';
import { getSession, api, pullOccurrence } from './sync.js';

let query = '';

/** Дела организации на сервере (если выполнен вход на экране «Сервер»). */
async function serverCasesHtml(localById) {
  const session = getSession();
  if (!session || !session.token) return '';
  let cases;
  try { cases = (await api('GET', '/api/cases')).cases; } catch (e) {
    return `<div class="card"><h3>${t('home.serverCases', { org: escapeHtml(session.org.name) })}</h3><p class="muted small">${t('sync.err.' + (e.code || 'generic'))}</p></div>`;
  }
  const state = (c) => {
    const o = localById[c.id];
    if (!o) return `<span class="tag">${t('home.notLocal')}</span>`;
    const v = o.remote && o.remote.version;
    return v === c.version ? `<span class="tag ok">${t('sync.inSync', { v: c.version })}</span>` : `<span class="tag warn">${t('sync.remoteNewer', { v: c.version, mine: v || '—' })}</span>`;
  };
  return `<div class="card">
    <h3>${t('home.serverCases', { org: escapeHtml(session.org.name) })} <span class="muted">(${cases.length})</span></h3>
    ${cases.length ? `<table><thead><tr><th>${t('field.title')}</th><th>${t('field.status')}</th><th>${t('sync.updated')}</th><th>${t('home.localState')}</th><th></th></tr></thead><tbody>
      ${cases.map((c) => `<tr><td>${localById[c.id] ? `<a href="#/occurrence/${encodeURIComponent(c.id)}">${escapeHtml(c.title)}</a>` : escapeHtml(c.title)}</td><td>${c.status ? t('status.' + c.status) : '—'}</td>
        <td class="nowrap">${escapeHtml(fmtDateTime(c.updatedAt))}</td><td>${state(c)}</td>
        <td><button class="btn secondary small" data-pull="${escapeHtml(c.id)}">${t('sync.pull')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('sync.none')}</p>`}
  </div>`;
}

export async function render(view) {
  const store = await db();
  const all = (await store.all('occurrence')).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const q = query.toLowerCase();
  const list = q ? all.filter((o) => tx(o.title).toLowerCase().includes(q) || (o.place || '').toLowerCase().includes(q)) : all;

  const rows = list.map((o) => {
    const sev = o.severity ? severity(o.severity) : null;
    return `<tr class="link-row" data-id="${escapeHtml(o.id)}">
      <td>${escapeHtml(tx(o.title)) || t('occ.untitled')}${o.mode === 'pirate' ? ` <span class="tag q">PIRATe</span>` : ''}${o.isTestCase ? ` <span class="tag">${t('home.testCase')}</span>` : ''}</td>
      <td>${escapeHtml(String(o.date || '').slice(0, 10))}</td>
      <td>${escapeHtml(t('type.' + (o.type || 'unknown')))}</td>
      <td>${sev ? `<span class="tag sev" title="${escapeHtml(tx(sev))}">${sev.code}</span>` : '<span class="muted">—</span>'}</td>
      <td>${escapeHtml(t('status.' + (o.status || 'draft')))}</td>
      <td><button class="btn secondary small" data-del="${escapeHtml(o.id)}">${t('btn.delete')}</button></td>
    </tr>`;
  }).join('');

  view.innerHTML = `
    <h1>${t('home.title')}</h1>
    <p class="lead">${t('home.lead')}</p>
    <div class="card">
      <div class="btn-row top">
        <a class="btn" href="#/occurrence/new">＋ ${t('home.new')}</a>
        <a class="btn secondary" href="#/occurrence/new?mode=pirate" title="${t('occ.modeHint')}">＋ ${t('home.newPirate')}</a>
        <a class="btn secondary" href="#/cases">${t('home.loadCases')}</a>
        <label class="btn secondary" for="importFile">${t('import.button')}</label>
        <input id="importFile" type="file" accept="application/json,.json" hidden>
        <input id="search" class="search" type="search" placeholder="${t('home.search')}" value="${escapeHtml(query)}">
      </div>
      ${list.length ? `<table>
        <thead><tr><th>${t('field.title')}</th><th>${t('field.date')}</th><th>${t('field.type')}</th><th>${t('field.severity')}</th><th>${t('field.status')}</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>`
        : `<p class="muted">${all.length ? t('home.noMatch') : t('home.empty')}</p>`}
    </div>
    ${await serverCasesHtml(Object.fromEntries(all.map((o) => [o.id, o])))}`;

  view.querySelectorAll('[data-pull]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; await pullOccurrence(store, b.dataset.pull); render(view); }));

  view.querySelector('#search').addEventListener('input', (e) => { query = e.target.value; render(view); view.querySelector('#search').focus(); });
  view.querySelector('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { validatePortable, fromPortable } = await import('../bundle.js');
      const p = JSON.parse(await file.text());
      const errors = validatePortable(p);
      if (errors.length) {
        const code = errors[0];
        toast(t(['format', 'schema-newer'].includes(code) ? 'import.err.' + code : 'import.err.generic', { code }));
        return;
      }
      const existing = await store.get('occurrence', p.occurrence.id);
      let newId = null;
      if (existing && !confirm(t('import.replace', { title: tx(existing.title) }))) newId = crypto.randomUUID();
      const bundle = fromPortable(p, { newId });
      const id = await store.importOccurrence(bundle);
      toast(t('import.done'));
      location.hash = `#/occurrence/${encodeURIComponent(id)}`;
    } catch (err) {
      toast(t('import.err.format') + ' (' + err.message + ')');
    }
  });
  view.querySelectorAll('tr.link-row').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      location.hash = `#/occurrence/${encodeURIComponent(tr.dataset.id)}`;
    });
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm.deleteOccurrence'))) return;
      await store.deleteOccurrence(b.dataset.del);
      toast(t('toast.deleted'));
      render(view);
    });
  });
}
