// Тестовые кейсы из QRG: загрузка в локальную базу.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { escapeHtml, toast } from '../ui.js';

async function loadIndex() {
  const r = await fetch('data/cases/index.json');
  if (!r.ok) throw new Error('data/cases/index.json');
  return (await r.json()).cases;
}

export async function render(view) {
  const [cases, store] = await Promise.all([loadIndex(), db()]);
  const present = new Set((await store.all('occurrence')).map((o) => o.id));

  view.innerHTML = `
    <h1>${t('cases.title')}</h1>
    <p class="lead">${t('cases.lead')}</p>
    <div class="grid">
      ${cases.map((c) => `
        <div class="card">
          <h3>${escapeHtml(tx(c.title))}</h3>
          <p class="small muted">${t('cases.source', { page: c.qrg_page })} · ${t('type.' + c.type)}<br>
            ${t('cases.counts', { facts: c.facts, links: c.links })}</p>
          <div class="btn-row">
            <button class="btn" data-load="${escapeHtml(c.file)}">${present.has(c.id) ? t('btn.reload') : t('btn.load')}</button>
            ${present.has(c.id) ? `<a class="btn secondary" href="#/occurrence/${encodeURIComponent(c.id)}">${t('btn.open')}</a>` : ''}
          </div>
        </div>`).join('')}
    </div>`;

  view.querySelectorAll('[data-load]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await fetch('data/cases/' + b.dataset.load);
        const bundle = await r.json();
        const id = await store.importOccurrence(bundle);
        toast(t('toast.caseLoaded'));
        location.hash = `#/occurrence/${encodeURIComponent(id)}`;
      } catch (e) {
        toast(t('error.title') + ': ' + e.message);
        b.disabled = false;
      }
    });
  });
}
