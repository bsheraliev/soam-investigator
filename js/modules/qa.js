// Вкладка «QA»: контрольный список качества SOAM (12 пунктов, QRG стр. 53), сводка готовности, перевод в «Завершено».
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml, toast, nowIso } from '../ui.js';
import { canTransition } from '../rules.js';

export async function renderTab(container, ctx) {
  const tax = taxonomy();
  const qa = ctx.qa || { occurrenceId: ctx.id, items: {} };
  const r = ctx.readiness;
  const o = ctx.occurrence;
  const canFinish = canTransition(o.status, 'completed', r.ok);

  container.innerHTML = `
    <div class="two-col">
      <div class="card">
        <h3>${t('qa.title')} <span class="muted">${r.qaDone}/${r.qaTotal}</span></h3>
        <p class="small muted">${t('qa.hint')}</p>
        <ol class="qa">${tax.qa_checklist.map((item) => {
          const st = qa.items[item.id] || {};
          return `<li>
            <label class="check"><input type="checkbox" data-qa="${item.id}" ${st.checked ? 'checked' : ''}> <span>${escapeHtml(tx(item))}</span></label>
            <input class="qa-note" data-note="${item.id}" placeholder="${t('qa.note')}" value="${escapeHtml(st.note || '')}">
          </li>`;
        }).join('')}</ol>
      </div>
      <div>
        <div class="card readiness ${r.ok ? 'ok' : 'bad'}">
          <h3>${t('qa.readiness')}</h3>
          <ul class="plain">
            <li>${r.unsorted ? '✗' : '✓'} ${t('qa.r.unsorted', { n: r.unsorted })}</li>
            <li>${r.noClassifications ? '✗' : '✓'} ${t('qa.r.classifications')}</li>
            <li>${r.unconfirmed ? '✗' : '✓'} ${t('qa.r.unconfirmed', { n: r.unconfirmed })}</li>
            <li>${r.uncovered.length ? '✗' : '✓'} ${t('qa.r.coverage', { n: r.uncovered.length, total: r.required })}</li>
            <li>${r.qaDone === r.qaTotal ? '✓' : '✗'} ${t('qa.r.qa', { done: r.qaDone, total: r.qaTotal })}</li>
          </ul>
          <p>${r.ok ? t('qa.ready') : t('qa.notReady')}</p>
          ${o.status === 'completed' ? `<p><strong>${t('status.completed')}</strong> · ${escapeHtml((o.completedAt || '').slice(0, 10))}</p>` : `
          <div class="btn-row">
            <button class="btn" id="finish" ${canFinish ? '' : 'disabled'}>${t('qa.finish')}</button>
          </div>
          ${!canFinish && r.ok ? `<p class="small muted">${t('qa.needStatusActions', { status: t('status.actions') })}</p>` : ''}`}
        </div>
      </div>
    </div>`;

  const save = async () => {
    const items = {};
    container.querySelectorAll('[data-qa]').forEach((cb) => {
      const id = cb.dataset.qa;
      const note = container.querySelector(`[data-note="${id}"]`).value.trim();
      items[id] = { checked: cb.checked, note };
    });
    await ctx.store.put('qa', { occurrenceId: ctx.id, items, updatedAt: nowIso() });
  };
  container.querySelectorAll('[data-qa]').forEach((cb) => cb.addEventListener('change', async () => { await save(); ctx.refresh(); }));
  container.querySelectorAll('[data-note]').forEach((inp) => inp.addEventListener('change', save));
  const fin = container.querySelector('#finish');
  if (fin) fin.addEventListener('click', async () => {
    if (!confirm(t('qa.confirmFinish'))) return;
    await ctx.store.put('occurrence', { ...o, status: 'completed', completedAt: nowIso(), updatedAt: nowIso() });
    toast(t('qa.finished')); ctx.refresh();
  });
}
