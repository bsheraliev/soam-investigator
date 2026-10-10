// Вкладка «QA»: контрольный список качества SOAM (12 пунктов, QRG стр. 53), открытые вопросы (QA № 4),
// ключевые уроки и распространение (QA № 12), сводка готовности, перевод в «Завершено».
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml, toast, nowIso, short } from '../ui.js';
import { canTransition, openFollowUps } from '../rules.js';

export async function renderTab(container, ctx) {
  const tax = taxonomy();
  const qa = ctx.qa || { occurrenceId: ctx.id, items: {} };
  const r = ctx.readiness;
  const o = ctx.occurrence;
  const canFinish = canTransition(o.status, 'completed', r.ok);
  const open = openFollowUps(ctx.facts);
  const closed = ctx.facts.filter((f) => f.followUp && f.followUp.status === 'closed' && f.followUp.question);

  container.innerHTML = `
    <div class="two-col">
      <div>
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
        <div class="card">
          <h3>${t('qa.followUps')} <span class="muted">(${open.length})</span></h3>
          ${open.length ? `<ul class="plain">${open.map((f) => `<li><strong>?</strong> ${escapeHtml(f.followUp.question || '—')} <span class="small muted">— ${escapeHtml(short(f.text, 70))}</span>
            <button class="link" data-close="${escapeHtml(f.id)}">${t('qa.followUpClose')}</button></li>`).join('')}</ul>` : `<p class="muted small">${t('qa.followUpsNone')}</p>`}
          ${closed.length ? `<p class="small muted">${closed.map((f) => `✓ ${escapeHtml(f.followUp.question)} (${t('qa.followUpClosed')})`).join('<br>')}</p>` : ''}
        </div>
      </div>
      <div>
        <div class="card readiness ${r.ok ? 'ok' : 'bad'}">
          <h3>${t('qa.readiness')}</h3>
          <ul class="plain">
            <li>${r.unsorted ? '✗' : '✓'} ${t('qa.r.unsorted', { n: r.unsorted })}</li>
            <li>${r.noClassifications ? '✗' : '✓'} ${t('qa.r.classifications')}</li>
            <li>${r.unconfirmed ? '✗' : '✓'} ${t('qa.r.unconfirmed', { n: r.unconfirmed })}</li>
            <li>${r.followUps ? '✗' : '✓'} ${t('qa.r.followUps', { n: r.followUps })}</li>
            <li>${r.uncovered.length ? '✗' : '✓'} ${t('qa.r.coverage', { n: r.uncovered.length, total: r.required })}</li>
            <li>${r.noLessons ? '✗' : '✓'} ${t('qa.r.lessons')}</li>
            <li>${r.qaDone === r.qaTotal ? '✓' : '✗'} ${t('qa.r.qa', { done: r.qaDone, total: r.qaTotal })}</li>
          </ul>
          <p>${r.ok ? t('qa.ready') : t('qa.notReady')}</p>
          ${o.status === 'completed' ? `<p><strong>${t('status.completed')}</strong> · ${escapeHtml((o.completedAt || '').slice(0, 10))}</p>` : `
          <div class="btn-row">
            <button class="btn" id="finish" ${canFinish ? '' : 'disabled'}>${t('qa.finish')}</button>
          </div>
          ${!canFinish && r.ok ? `<p class="small muted">${t('qa.needStatusActions', { status: t('status.actions') })}</p>` : ''}`}
        </div>
        <form class="card form" id="lessonsForm">
          <h3>${t('qa.lessons')}</h3>
          <p class="small muted">${t('qa.lessonsHint')}</p>
          <label class="field"><span>${t('qa.lessonsField')}</span><textarea name="lessons" rows="4">${escapeHtml((o.lessons || []).join('\n'))}</textarea></label>
          <label class="field"><span>${t('qa.disseminated')}</span><textarea name="disseminated" rows="2">${escapeHtml(o.disseminated || '')}</textarea></label>
          <div class="btn-row"><button class="btn" type="submit">${t('btn.save')}</button></div>
        </form>
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
  container.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    const f = ctx.facts.find((x) => x.id === b.dataset.close);
    await ctx.store.put('fact', { ...f, followUp: { ...f.followUp, status: 'closed', closedAt: nowIso() } });
    ctx.refresh();
  }));
  container.querySelector('#lessonsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = e.target;
    await ctx.store.put('occurrence', { ...o, lessons: fd.lessons.value.split('\n').map((s) => s.trim()).filter(Boolean), disseminated: fd.disseminated.value.trim(), updatedAt: nowIso() });
    toast(t('toast.saved')); ctx.refresh();
  });
  const fin = container.querySelector('#finish');
  if (fin) fin.addEventListener('click', async () => {
    if (!confirm(t('qa.confirmFinish'))) return;
    const fresh = await ctx.store.get('occurrence', ctx.id);
    await ctx.store.put('occurrence', { ...fresh, status: 'completed', completedAt: nowIso(), updatedAt: nowIso() });
    toast(t('qa.finished')); ctx.refresh();
  });
}
