// Вкладка «Хронология»: события по времени, привязка к фактам.
import { newId } from '../db.js';
import { t } from '../i18n.js';
import { escapeHtml, toast, formValues, fmtDateTime, short } from '../ui.js';
import { sortEvents } from '../rules.js';

let editing = null;

function formHtml(ev, facts) {
  return `
  <form id="evForm" class="card form">
    <h3>${ev.id ? t('timeline.edit') : t('timeline.add')}</h3>
    <div class="row">
      <label class="field"><span>${t('timeline.time')}</span><input name="time" type="datetime-local" step="1" value="${escapeHtml(ev.time || '')}"></label>
    </div>
    <label class="field"><span>${t('timeline.description')} *</span><textarea name="description" rows="2" required>${escapeHtml(ev.description || '')}</textarea></label>
    ${facts.length ? `<fieldset class="field"><legend>${t('timeline.facts')}</legend>
      <div class="checklist">${facts.map((f) => `<label class="check"><input type="checkbox" name="factIds" data-multi value="${escapeHtml(f.id)}" ${(ev.factIds || []).includes(f.id) ? 'checked' : ''}> ${escapeHtml(short(f.text, 100))}</label>`).join('')}</div>
    </fieldset>` : ''}
    <div class="btn-row">
      <button class="btn" type="submit">${t('btn.save')}</button>
      <button class="btn secondary" type="button" id="evCancel">${t('btn.cancel')}</button>
      ${ev.id ? `<button class="btn danger" type="button" id="evDelete">${t('btn.delete')}</button>` : ''}
    </div>
  </form>`;
}

export async function renderTab(container, ctx) {
  const events = sortEvents(await ctx.store.byIndex('event', 'occurrenceId', ctx.id));
  const facts = [...ctx.facts].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const factById = Object.fromEntries(facts.map((f) => [f.id, f]));
  const ev = editing || {};
  container.innerHTML = `
    <div class="two-col">
      <div>${formHtml(ev, facts)}</div>
      <div class="card">
        <h3>${t('timeline.list')} <span class="muted">(${events.length})</span></h3>
        ${events.length ? `<ol class="timeline">${events.map((e) => `
          <li class="link-row" data-id="${escapeHtml(e.id)}">
            <time>${escapeHtml(fmtDateTime(e.time)) || '—'}</time>
            <div>${escapeHtml(e.description)}
              ${(e.factIds || []).length ? `<div class="small muted">${e.factIds.map((id) => factById[id] ? '• ' + escapeHtml(short(factById[id].text, 70)) : '').join('<br>')}</div>` : ''}
            </div></li>`).join('')}</ol>` : `<p class="muted">${t('timeline.empty')}</p>`}
      </div>
    </div>`;

  const form = container.querySelector('#evForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (!v.description) { toast(t('timeline.err.description')); return; }
    await ctx.store.put('event', {
      ...ev, id: ev.id || newId(), occurrenceId: ctx.id,
      time: v.time, description: v.description, factIds: v.factIds || [],
      seq: ev.seq ?? (events.length ? Math.max(...events.map((x) => x.seq || 0)) + 1 : 1),
    });
    editing = null; toast(t('toast.saved')); ctx.refresh();
  });
  form.querySelector('#evCancel').addEventListener('click', () => { editing = null; ctx.refresh(); });
  const del = form.querySelector('#evDelete');
  if (del) del.addEventListener('click', async () => {
    await ctx.store.del('event', ev.id);
    editing = null; toast(t('toast.deleted')); ctx.refresh();
  });
  container.querySelectorAll('li.link-row').forEach((li) => li.addEventListener('click', () => {
    editing = events.find((x) => x.id === li.dataset.id) || null;
    ctx.refresh();
  }));
}

export function reset() { editing = null; }
