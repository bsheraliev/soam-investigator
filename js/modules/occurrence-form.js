// Карточка события: создание (#/occurrence/new) и правка (вкладка «Событие»).
import { db, newId } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml, toast, formValues, nowIso } from '../ui.js';
import { STATUSES, canTransition, severityRequired } from '../rules.js';

const TYPES = ['accident', 'incident'];

function formHtml(o, ready = false) {
  const tax = taxonomy();
  const isNew = !o.id;
  const statusOptions = STATUSES.map((s) => {
    const allowed = s === o.status || canTransition(o.status || 'draft', s, ready);
    return `<option value="${s}" ${s === (o.status || 'draft') ? 'selected' : ''} ${allowed ? '' : 'disabled'}>${t('status.' + s)}${s === 'completed' ? ' — ' + t('status.completedLocked') : ''}</option>`;
  }).join('');
  return `
  <form id="occForm" class="card form">
    <label class="field"><span>${t('field.title')} *</span>
      <input name="title" required maxlength="200" value="${escapeHtml(tx(o.title))}" placeholder="${t('occ.titlePlaceholder')}"></label>
    <div class="row">
      <label class="field"><span>${t('field.date')}</span><input name="date" type="datetime-local" value="${escapeHtml(o.date || '')}"></label>
      <label class="field"><span>${t('field.place')}</span><input name="place" maxlength="200" value="${escapeHtml(o.place || '')}"></label>
    </div>
    <fieldset class="field"><legend>${t('field.type')} *</legend>
      ${TYPES.map((k) => `<label class="radio"><input type="radio" name="type" value="${k}" ${o.type === k ? 'checked' : ''} required> ${t('type.' + k)}</label>`).join('')}
      <p class="small muted">${t('occ.typeHint')}</p>
    </fieldset>
    <fieldset class="field" id="severityBox"><legend>${t('field.severity')} <span id="sevReq">*</span></legend>
      <p class="small muted">${t('occ.severityHint')}</p>
      ${tax.severity.map((s) => `<label class="radio block"><input type="radio" name="severity" value="${s.code}" ${o.severity === s.code ? 'checked' : ''}> <strong>${s.code}</strong> — ${escapeHtml(tx(s))}</label>`).join('')}
      <label class="radio block"><input type="radio" name="severity" value="" ${!o.severity ? 'checked' : ''}> ${t('occ.severityNone')}</label>
    </fieldset>
    <fieldset class="field"><legend>${t('occ.investigate')}</legend>
      <label class="radio"><input type="radio" name="investigate" value="yes" ${o.investigate === true ? 'checked' : ''}> ${t('occ.investigateYes')}</label>
      <label class="radio"><input type="radio" name="investigate" value="no" ${o.investigate === false ? 'checked' : ''}> ${t('occ.investigateNo')}</label>
      <label class="radio"><input type="radio" name="investigate" value="" ${o.investigate == null ? 'checked' : ''}> ${t('occ.investigateUndecided')}</label>
      <label class="field"><span>${t('occ.investigateReason')}</span><textarea name="investigateReason" rows="2">${escapeHtml(o.investigateReason || '')}</textarea></label>
    </fieldset>
    <label class="field"><span>${t('occ.outcome')}</span>
      <textarea name="outcome" rows="3" placeholder="${t('occ.outcomePlaceholder')}">${escapeHtml((o.outcome || []).join('\n'))}</textarea></label>
    <label class="field"><span>${t('field.status')}</span><select name="status" ${isNew ? 'disabled' : ''}>${statusOptions}</select>
      ${!isNew ? `<span class="small muted">${t('occ.statusHint')}</span>` : ''}</label>
    <div class="btn-row">
      <button class="btn" type="submit">${isNew ? t('btn.create') : t('btn.save')}</button>
      ${isNew ? `<a class="btn secondary" href="#/">${t('btn.cancel')}</a>` : ''}
    </div>
  </form>`;
}

function bindSeverity(form) {
  const upd = () => {
    const type = formValues(form).type;
    const req = severityRequired({ type });
    form.querySelector('#sevReq').hidden = !req;
    form.querySelector('#severityBox').classList.toggle('optional', !req);
  };
  form.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', upd));
  upd();
}

async function save(form, o, ready = false) {
  const v = formValues(form);
  if (!v.title) { toast(t('occ.err.title')); return null; }
  if (!v.type) { toast(t('occ.err.type')); return null; }
  if (severityRequired({ type: v.type }) && !v.severity) { toast(t('occ.err.severity')); return null; }
  const store = await db();
  const now = nowIso();
  const next = {
    ...o,
    id: o.id || newId(),
    title: v.title,
    date: v.date,
    place: v.place,
    type: v.type,
    severity: v.severity || null,
    investigate: v.investigate === 'yes' ? true : v.investigate === 'no' ? false : null,
    investigateReason: v.investigateReason,
    outcome: v.outcome.split('\n').map((s) => s.trim()).filter(Boolean),
    status: o.id ? (v.status || o.status) : 'draft',
    createdAt: o.createdAt || now,
    updatedAt: now,
  };
  if (o.id && next.status !== o.status && !canTransition(o.status, next.status, ready)) {
    toast(t('occ.err.status')); return null;
  }
  if (next.status === 'completed' && o.status !== 'completed') next.completedAt = now;
  await store.put('occurrence', next);
  return next;
}

/** #/occurrence/new */
export async function render(view) {
  view.innerHTML = `<h1>${t('occ.newTitle')}</h1>${formHtml({ status: 'draft' })}`;
  const form = view.querySelector('#occForm');
  bindSeverity(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = await save(form, {});
    if (o) {
      toast(t('toast.saved'));
      location.hash = `#/occurrence/${encodeURIComponent(o.id)}/facts`;
    }
  });
}

/** Вкладка «Событие» */
export async function renderTab(container, ctx) {
  const ready = !!(ctx.readiness && ctx.readiness.ok);
  container.innerHTML = formHtml(ctx.occurrence, ready) + `
    <div class="card">
      <h3>${t('occ.dangerZone')}</h3>
      <button class="btn danger" id="delOcc">${t('btn.deleteOccurrence')}</button>
    </div>`;
  const form = container.querySelector('#occForm');
  bindSeverity(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = await save(form, ctx.occurrence, ready);
    if (o) { toast(t('toast.saved')); ctx.refresh(); }
  });
  container.querySelector('#delOcc').addEventListener('click', async () => {
    if (!confirm(t('confirm.deleteOccurrence'))) return;
    await ctx.store.deleteOccurrence(ctx.id);
    toast(t('toast.deleted'));
    location.hash = '#/';
  });
}
