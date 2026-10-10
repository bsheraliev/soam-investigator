// Главная: список дел в локальной базе.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { severity } from '../taxonomy.js';
import { escapeHtml, toast } from '../app.js';

export async function render(view) {
  const store = await db();
  const list = (await store.all('occurrence')).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const rows = list.map((o) => {
    const sev = o.severity ? severity(o.severity) : null;
    return `<tr class="link-row" data-id="${escapeHtml(o.id)}">
      <td>${escapeHtml(tx(o.title))}${o.isTestCase ? ` <span class="tag">${t('home.testCase')}</span>` : ''}</td>
      <td>${escapeHtml(o.date || '')}</td>
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
      ${list.length ? `<table>
        <thead><tr><th>${t('field.title')}</th><th>${t('field.date')}</th><th>${t('field.type')}</th><th>${t('field.severity')}</th><th>${t('field.status')}</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>`
        : `<p class="muted">${t('home.empty')}</p>`}
      <div class="btn-row">
        <a class="btn secondary" href="#/cases">${t('home.loadCases')}</a>
      </div>
    </div>
    <p class="small muted">${t('home.stage0note')}</p>`;

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
