// Вкладка «Меры»: меры безопасности, покрытие барьеров и OSF (правило 4), адресация (правило 5), SMARTER.
import { newId } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy, osf, barrier } from '../taxonomy.js';
import { escapeHtml, toast, formValues, nowIso, short } from '../ui.js';
import { coverage, validateAction, ACTION_STATUSES, SMARTER_CODES, needsAction } from '../rules.js';

let editing = null;

function targetLabel(c, factById) {
  const f = factById[c.factId];
  const head = c.element === 'OSF' ? (c.osfCodes || []).join('/') : (c.barrierState ? t('barrier.' + c.barrierState) : t('barrier.unset'));
  return `<span class="tag">${c.element}${head ? ' · ' + escapeHtml(head) : ''}</span> ${escapeHtml(short(f ? f.text : c.factId, 90))}`;
}

function formHtml(a, targets, factById) {
  const tax = taxonomy();
  const sel = new Set(a.addresses || []);
  const sm = a.smarter || {};
  return `
  <form id="actForm" class="card form">
    <h3>${a.id ? t('actions.edit') : t('actions.add')}</h3>
    <label class="field"><span>${t('actions.text')} *</span><textarea name="text" rows="3" required>${escapeHtml(a.text || '')}</textarea></label>
    <fieldset class="field"><legend>${t('actions.addresses')} *</legend>
      <p class="small muted">${t('actions.addressesHint')}</p>
      <div class="checklist">${targets.map((c) => `<label class="check"><input type="checkbox" name="addresses" data-multi value="${escapeHtml(c.id)}" ${sel.has(c.id) ? 'checked' : ''}> ${targetLabel(c, factById)}</label>`).join('') || `<p class="muted small">${t('actions.noTargets')}</p>`}</div>
    </fieldset>
    <div class="row">
      <label class="field"><span>${t('actions.responsible')} *</span><input name="responsible" maxlength="200" value="${escapeHtml(a.responsible || '')}" placeholder="${t('actions.responsiblePlaceholder')}"></label>
      <label class="field"><span>${t('actions.due')}</span><input name="due" type="date" value="${escapeHtml(a.due || '')}"></label>
      <label class="field"><span>${t('field.status')}</span><select name="status">${ACTION_STATUSES.map((s) => `<option value="${s}" ${(a.status || 'planned') === s ? 'selected' : ''}>${t('actions.status.' + s)}</option>`).join('')}</select></label>
    </div>
    <fieldset class="field"><legend>SMARTER <span class="muted small">(QRG, p.52)</span></legend>
      <div class="checklist cols">${tax.safety_actions.smarter.map((s) => `<label class="check"><input type="checkbox" name="smarter_${s.code}" ${sm[s.code] ? 'checked' : ''}> <strong>${s.code.replace(/\d/, '')}</strong> — ${escapeHtml(tx(s))}</label>`).join('')}</div>
    </fieldset>
    <details class="hint"><summary>${t('actions.checklist')} <span class="muted small">(QRG, p.51)</span></summary>
      <ul>${tax.safety_actions.checklist.map((c) => `<li>${escapeHtml(tx(c))}</li>`).join('')}</ul></details>
    <div class="btn-row">
      <button class="btn" type="submit">${t('btn.save')}</button>
      <button class="btn secondary" type="button" id="actCancel">${t('btn.cancel')}</button>
      ${a.id ? `<button class="btn danger" type="button" id="actDelete">${t('btn.delete')}</button>` : ''}
    </div>
  </form>`;
}

export async function renderTab(container, ctx) {
  const [classes, actions] = await Promise.all([
    ctx.store.byIndex('classification', 'occurrenceId', ctx.id),
    ctx.store.byIndex('action', 'occurrenceId', ctx.id),
  ]);
  actions.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const factById = Object.fromEntries(ctx.facts.map((f) => [f.id, f]));
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const targets = classes.filter((c) => c.element === 'OSF' || c.element === 'BAR').sort((a, b) => a.element.localeCompare(b.element) || (a.order || 0) - (b.order || 0));
  const cov = coverage(classes, actions);
  const a = editing || {};

  container.innerHTML = `
    <div class="card coverage ${cov.ok ? 'ok' : 'bad'}">
      <h3>${t('actions.coverage')}</h3>
      <p>${cov.ok ? t('actions.coverageOk', { n: cov.required.length }) : t('actions.coverageBad', { n: cov.uncovered.length, total: cov.required.length })}</p>
      ${cov.uncovered.length ? `<ul class="plain">${cov.uncovered.map((c) => `<li>${targetLabel(c, factById)}</li>`).join('')}</ul>` : ''}
      <p class="small muted">${t('actions.rule4')}</p>
    </div>
    <div class="two-col">
      <div>${formHtml(a, targets, factById)}</div>
      <div class="card">
        <h3>${t('actions.list')} <span class="muted">(${actions.length})</span></h3>
        ${actions.length ? `<ol class="actions">${actions.map((x) => `<li class="link-row" data-id="${escapeHtml(x.id)}">
          <div>${escapeHtml(x.text)}</div>
          <div class="small muted">${escapeHtml(x.responsible || '')}${x.due ? ' · ' + escapeHtml(x.due) : ''} · ${t('actions.status.' + (x.status || 'planned'))}
            · SMARTER ${SMARTER_CODES.filter((k) => x.smarter && x.smarter[k]).length}/7</div>
          <div class="small">${(x.addresses || []).map((id) => byId[id] ? `<span class="tag">${byId[id].element}${byId[id].element === 'OSF' ? ' ' + (byId[id].osfCodes || []).join('/') : ''}</span>` : '').join(' ')}</div>
        </li>`).join('')}</ol>` : `<p class="muted">${t('actions.empty')}</p>`}
      </div>
    </div>`;

  const form = container.querySelector('#actForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const rec = {
      ...a, id: a.id || newId(), occurrenceId: ctx.id,
      text: v.text, addresses: v.addresses || [], responsible: v.responsible, due: v.due, status: v.status,
      smarter: Object.fromEntries(SMARTER_CODES.map((k) => [k, !!v['smarter_' + k]])),
      seq: a.seq ?? (actions.length ? Math.max(...actions.map((x) => x.seq || 0)) + 1 : 1),
      createdAt: a.createdAt || nowIso(), updatedAt: nowIso(),
    };
    const errors = validateAction(rec);
    if (errors.length) { toast(t('actions.err.' + errors[0])); return; }
    await ctx.store.put('action', rec);
    editing = null; toast(t('toast.saved')); ctx.refresh();
  });
  form.querySelector('#actCancel').addEventListener('click', () => { editing = null; ctx.refresh(); });
  const del = form.querySelector('#actDelete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(t('actions.confirmDelete'))) return;
    await ctx.store.del('action', a.id); editing = null; toast(t('toast.deleted')); ctx.refresh();
  });
  container.querySelectorAll('li.link-row').forEach((li) => li.addEventListener('click', () => {
    editing = actions.find((x) => x.id === li.dataset.id) || null; ctx.refresh();
  }));
}

export function reset() { editing = null; }
