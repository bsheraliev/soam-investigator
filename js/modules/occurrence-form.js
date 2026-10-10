// Карточка события: создание (#/occurrence/new) и правка (вкладка «Событие»).
import { db, newId } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml, toast, formValues, nowIso, fmtDateTime } from '../ui.js';
import { STATUSES, canTransition, severityRequired, investigationAdvice, isPirate } from '../rules.js';

const TYPES = ['accident', 'incident'];
const MODES = ['soam', 'pirate'];
const PIRATE_REASONS = ['forecast', 'change', 'repetitive'];

function formHtml(o, ready = false) {
  const tax = taxonomy();
  const isNew = !o.id;
  const pirate = isPirate(o);
  const statusOptions = STATUSES.map((s) => {
    const allowed = s === o.status || canTransition(o.status || 'draft', s, ready);
    return `<option value="${s}" ${s === (o.status || 'draft') ? 'selected' : ''} ${allowed ? '' : 'disabled'}>${t('status.' + s)}${s === 'completed' ? ' — ' + t('status.completedLocked') : ''}</option>`;
  }).join('');
  return `
  <form id="occForm" class="card form">
    <fieldset class="field"><legend>${t('occ.mode')}</legend>
      ${MODES.map((m) => `<label class="radio"><input type="radio" name="mode" value="${m}" ${(o.mode || 'soam') === m ? 'checked' : ''} ${isNew ? '' : 'disabled'}> ${t('mode.' + m)}</label>`).join('')}
      <p class="small muted">${t('occ.modeHint')}</p>
    </fieldset>
    <div id="pirateOnly" ${pirate ? '' : 'hidden'}>
      <details class="hint"><summary>${t('occ.pirateGuide')} <span class="muted small">(QRG, стр. 54–56)</span></summary>
        <p>${escapeHtml(tx(tax.pirate.intro))}</p>
        <ol>${tax.pirate.steps.map((s) => `<li>${escapeHtml(tx(s))}</li>`).join('')}</ol>
      </details>
      <fieldset class="field"><legend>${t('occ.pirateReason')}</legend>
        ${PIRATE_REASONS.map((r) => `<label class="radio block"><input type="radio" name="pirateReason" value="${r}" ${o.pirateReason === r ? 'checked' : ''}> ${t('pirate.reason.' + r)}</label>`).join('')}
      </fieldset>
      <label class="field"><span>${t('occ.participants')}</span><textarea name="participants" rows="2" placeholder="${t('occ.participantsPlaceholder')}">${escapeHtml(o.participants || '')}</textarea></label>
    </div>
    <label class="field"><span>${t('field.title')} *</span>
      <input name="title" required maxlength="200" value="${escapeHtml(tx(o.title))}" placeholder="${pirate ? t('occ.titlePlaceholderPirate') : t('occ.titlePlaceholder')}"></label>
    <div class="row">
      <label class="field"><span>${t('field.date')}</span><input name="date" type="datetime-local" value="${escapeHtml(o.date || '')}"></label>
      <label class="field"><span>${t('field.place')}</span><input name="place" maxlength="200" value="${escapeHtml(o.place || '')}"></label>
    </div>
    <fieldset class="field"><legend>${t('field.type')} *</legend>
      ${TYPES.map((k) => `<label class="radio"><input type="radio" name="type" value="${k}" ${o.type === k ? 'checked' : ''} required> ${t('type.' + k)}</label>`).join('')}
      <p class="small muted">${t('occ.typeHint')}</p>
    </fieldset>
    <div id="soamOnly" ${pirate ? 'hidden' : ''}>
    <fieldset class="field" id="severityBox"><legend>${t('field.severity')} <span id="sevReq">*</span></legend>
      <p class="small muted">${t('occ.severityHint')}</p>
      ${tax.severity.map((s) => `<label class="radio block"><input type="radio" name="severity" value="${s.code}" ${o.severity === s.code ? 'checked' : ''}> <strong>${s.code}</strong> — ${escapeHtml(tx(s))}</label>`).join('')}
      <label class="radio block"><input type="radio" name="severity" value="" ${!o.severity ? 'checked' : ''}> ${t('occ.severityNone')}</label>
    </fieldset>
    <fieldset class="field"><legend>${t('occ.investigate')}</legend>
      <div class="hint" id="adviceBox"></div>
      <label class="radio"><input type="radio" name="investigate" value="yes" ${o.investigate === true ? 'checked' : ''}> ${t('occ.investigateYes')}</label>
      <label class="radio"><input type="radio" name="investigate" value="no" ${o.investigate === false ? 'checked' : ''}> ${t('occ.investigateNo')}</label>
      <label class="radio"><input type="radio" name="investigate" value="" ${o.investigate == null ? 'checked' : ''}> ${t('occ.investigateUndecided')}</label>
      <label class="field"><span>${t('occ.investigateReason')}</span><textarea name="investigateReason" rows="2">${escapeHtml(o.investigateReason || '')}</textarea></label>
    </fieldset>
    </div>
    <label class="field"><span id="outcomeLabel">${pirate ? t('occ.scenarioOutcome') : t('occ.outcome')}</span>
      <textarea name="outcome" rows="3" placeholder="${pirate ? t('occ.scenarioOutcomePlaceholder') : t('occ.outcomePlaceholder')}">${escapeHtml((o.outcome || []).join('\n'))}</textarea></label>
    <label class="field"><span>${t('field.status')}</span><select name="status" ${isNew ? 'disabled' : ''}>${statusOptions}</select>
      ${!isNew ? `<span class="small muted">${t('occ.statusHint')}</span>` : ''}</label>
    <div class="btn-row">
      <button class="btn" type="submit">${isNew ? t('btn.create') : t('btn.save')}</button>
      ${isNew ? `<a class="btn secondary" href="#/">${t('btn.cancel')}</a>` : ''}
    </div>
  </form>`;
}

/** Рекомендация методологии о расследовании (QRG, стр. 7) — по типу и тяжести, с учётом принятого решения. */
export function adviceHtml(o) {
  const { level, conflict } = investigationAdvice(o);
  const key = { required: 'occ.advice.required', recommended: 'occ.advice.recommended', cost_benefit: 'occ.advice.costBenefit', unknown: 'occ.advice.unknown', pirate: 'occ.advice.pirate' }[level];
  let html = `<strong>${t('occ.advice.label')}:</strong> ${t(key, { severity: o.severity || '' })}`;
  if (level === 'cost_benefit') html += `<ul><li>${t('occ.advice.cb1')}</li><li>${t('occ.advice.cb2')}</li></ul>`;
  if (conflict) html += `<p class="warn">${t('occ.advice.conflict')}</p>`;
  return html;
}

function bindSeverity(form) {
  const upd = () => {
    const v = formValues(form);
    const pirate = v.mode === 'pirate';
    form.querySelector('#soamOnly').hidden = pirate;
    form.querySelector('#pirateOnly').hidden = !pirate;
    form.querySelector('#outcomeLabel').textContent = pirate ? t('occ.scenarioOutcome') : t('occ.outcome');
    form.title.placeholder = pirate ? t('occ.titlePlaceholderPirate') : t('occ.titlePlaceholder');
    const req = severityRequired({ type: v.type, mode: v.mode });
    form.querySelector('#sevReq').hidden = !req;
    form.querySelector('#severityBox').classList.toggle('optional', !req);
    form.querySelector('#adviceBox').innerHTML = adviceHtml({
      type: v.type, mode: v.mode,
      severity: v.severity || null,
      investigate: v.investigate === 'yes' ? true : v.investigate === 'no' ? false : null,
    });
  };
  form.querySelectorAll('input[name=mode], input[name=type], input[name=severity], input[name=investigate]').forEach((r) => r.addEventListener('change', upd));
  upd();
}

async function save(form, o, ready = false) {
  const v = formValues(form);
  if (!v.title) { toast(t('occ.err.title')); return null; }
  if (!v.type) { toast(t('occ.err.type')); return null; }
  const mode = o.id ? (o.mode || 'soam') : (v.mode || 'soam');
  if (severityRequired({ type: v.type, mode }) && !v.severity) { toast(t('occ.err.severity')); return null; }
  const store = await db();
  const now = nowIso();
  const next = {
    ...o,
    id: o.id || newId(),
    mode,
    pirateReason: mode === 'pirate' ? (v.pirateReason || null) : undefined,
    participants: mode === 'pirate' ? v.participants : undefined,
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
  const pirate = /mode=pirate/.test(location.hash);
  view.innerHTML = `<h1>${pirate ? t('occ.newTitlePirate') : t('occ.newTitle')}</h1>${formHtml({ status: 'draft', mode: pirate ? 'pirate' : 'soam' })}`;
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
  const sync = await import('./sync.js');
  const connected = sync.isConnected();
  container.innerHTML = formHtml(ctx.occurrence, ready) + `
    <div class="card">
      <h3>${t('export.button')}</h3>
      <p class="small muted">${t('export.hint')}</p>
      <button class="btn secondary" id="expOcc">${t('export.button')}</button>
      ${connected ? `<button class="btn secondary" id="pushOcc">${t('sync.pushButton')}</button>
      <p class="small muted">${ctx.occurrence.remote ? t('sync.remoteInfo', { v: ctx.occurrence.remote.version, at: escapeHtml(fmtDateTime(ctx.occurrence.remote.at)) }) : t('sync.notRemote')}</p>` : ''}
    </div>
    <div class="card">
      <h3>${t('occ.dangerZone')}</h3>
      <button class="btn danger" id="delOcc">${t('btn.deleteOccurrence')}</button>
    </div>`;
  container.querySelector('#expOcc').addEventListener('click', async () => {
    const { toPortable } = await import('../bundle.js');
    const bundle = await ctx.store.exportOccurrence(ctx.id);
    const portable = await toPortable(bundle, ctx.appVersion);
    const blob = new Blob([JSON.stringify(portable, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = ('soam-' + tx(ctx.occurrence.title)).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  const pushBtn = container.querySelector('#pushOcc');
  if (pushBtn) pushBtn.addEventListener('click', async () => { pushBtn.disabled = true; await sync.pushOccurrence(ctx.store, ctx.id); ctx.refresh(); });
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
