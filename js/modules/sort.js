// Вкладка «Сортировка»: тест вклада (правило 1) и классификация с контрольным вопросом (правило 2).
import { newId } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy, checkQuestion, osf, barrier, element } from '../taxonomy.js';
import { escapeHtml, toast, formValues, short } from '../ui.js';
import { canClassify, validateClassification, unsortedFacts } from '../rules.js';

let selectedId = null;   // выбранный факт
let editingCls = null;   // классификация в форме (null — новая)

const ELEMENTS = ['HI', 'CC', 'OSF', 'BAR'];

function chip(f) {
  if (f.contributes === true) return `<span class="tag ok">${t('sort.contributes')}</span>`;
  if (f.contributes === false) return `<span class="tag">${t('sort.other')}</span>`;
  return `<span class="tag warn">${t('sort.unsorted')}</span>`;
}

function subcategoryLabel(c) {
  const tax = taxonomy();
  if (c.element === 'CC') return c.ccCategory ? tx(tax._cc[c.ccCategory]) : '';
  if (c.element === 'OSF') return (c.osfCodes || []).join(' / ');
  if (c.element === 'BAR') return [c.barrierType ? tx(barrier(c.barrierType)) : '', c.barrierState ? t('barrier.' + c.barrierState) : t('barrier.unset')].filter(Boolean).join(' · ');
  return '';
}

// ---- подсказки по элементам (всё из таксономии QRG)
function hiHint() {
  const tax = taxonomy();
  return `<div class="hint"><ul>${tax.hi_guidance.map((g) => `<li>${escapeHtml(tx(g))}</li>`).join('')}</ul></div>`;
}
function ccControls(c) {
  const tax = taxonomy();
  return `<label class="field"><span>${t('sort.ccCategory')} *</span>
    <select name="ccCategory" id="ccSel"><option value="">—</option>
      ${tax.contextual_conditions.map((x) => `<option value="${x.code}" ${c.ccCategory === x.code ? 'selected' : ''}>${escapeHtml(tx(x))}</option>`).join('')}
    </select></label><div id="ccHint">${c.ccCategory ? ccHint(c.ccCategory) : ''}</div>`;
}
function ccHint(code) {
  const cat = taxonomy()._cc[code];
  if (!cat) return '';
  const by = (k) => cat.examples.filter((e) => e.kind === k).map((e) => `<li>${escapeHtml(tx(e))}</li>`).join('');
  return `<details class="hint" open><summary>${t('sort.examples')} — ${escapeHtml(tx(cat))} <span class="muted small">(QRG, p.${cat.qrg_page})</span></summary>
    <div class="three-col">
      <div><strong>${t('cc.error')}</strong><ul>${by('error')}</ul></div>
      <div><strong>${t('cc.common')}</strong><ul>${by('common')}</ul></div>
      <div><strong>${t('cc.non_compliance')}</strong><ul>${by('non_compliance')}</ul></div>
    </div></details>`;
}
function osfControls(c) {
  const tax = taxonomy();
  const sel = new Set(c.osfCodes || []);
  return `<fieldset class="field"><legend>${t('sort.osfCodes')} *</legend>
    <div class="checklist cols">${tax.osf.map((o) => `<label class="check"><input type="checkbox" name="osfCodes" data-multi value="${o.code}" ${sel.has(o.code) ? 'checked' : ''}> <strong>${o.code}</strong> ${escapeHtml(tx(o))}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" name="otherSystem" ${c.otherSystem ? 'checked' : ''}> ${t('sort.otherSystem')}</label>
  </fieldset><div id="osfHint">${[...sel].map(osfHint).join('')}</div>`;
}
function osfHint(code) {
  const o = osf(code);
  if (!o) return '';
  return `<details class="hint" open><summary><strong>${o.code}</strong> ${escapeHtml(tx(o))} <span class="muted small">(QRG, p.${o.qrg_page})</span></summary>
    <p>${escapeHtml(tx(o.definition))}</p>
    <div class="two-col">
      <div><strong>${t('osf.issues')}</strong><ul>${o.issues.map((i) => `<li>${escapeHtml(tx(i))}</li>`).join('')}</ul></div>
      <div><strong>${t('osf.consequences')}</strong><ul>${o.consequences.map((i) => `<li>${escapeHtml(tx(i))}</li>`).join('')}</ul></div>
    </div></details>`;
}
function barControls(c) {
  const tax = taxonomy();
  return `<label class="field"><span>${t('sort.barrierType')} *</span>
    <select name="barrierType" id="barSel"><option value="">—</option>
      ${tax.barriers.map((b) => `<option value="${b.code}" ${c.barrierType === b.code ? 'selected' : ''}>${escapeHtml(tx(b))}</option>`).join('')}
    </select></label>
    <div id="barHint">${c.barrierType ? barHint(c.barrierType) : ''}</div>
    <fieldset class="field"><legend>${t('sort.barrierState')} *</legend>
      ${tax.barrier_states.map((s) => `<label class="radio block"><input type="radio" name="barrierState" value="${s.code}" ${c.barrierState === s.code ? 'checked' : ''}> <strong>${t('barrier.' + s.code)}</strong> — ${escapeHtml(tx(s))}</label>`).join('')}
    </fieldset>
    <label class="check"><input type="checkbox" name="otherSystem" ${c.otherSystem ? 'checked' : ''}> ${t('sort.otherSystem')}</label>`;
}
function barHint(code) {
  const b = barrier(code);
  if (!b) return '';
  return `<details class="hint" open><summary>${escapeHtml(tx(b))} <span class="muted small">(QRG, p.${b.qrg_page})</span></summary>
    <p>${escapeHtml(tx(b.definition))}</p><ul>${b.examples.map((e) => `<li>${escapeHtml(tx(e))}</li>`).join('')}</ul></details>`;
}

function clsFormHtml(c) {
  const el = c.element || '';
  const q = el ? checkQuestion(el) : null;
  return `
  <form id="clsForm" class="card form">
    <h3>${c.id ? t('sort.editCls') : t('sort.addCls')}</h3>
    <fieldset class="field"><legend>${t('sort.element')} *</legend>
      ${ELEMENTS.map((k) => `<label class="radio"><input type="radio" name="element" value="${k}" ${el === k ? 'checked' : ''}> ${escapeHtml(tx(element(k)))}</label>`).join('')}
    </fieldset>
    <div id="elBody">
      ${q ? `<div class="check-question"><strong>${t('sort.checkQuestion', { n: q.code })}</strong><p>${escapeHtml(tx(q))}</p>${q.note ? `<p class="small muted">${escapeHtml(tx(q.note))}</p>` : ''}</div>` : ''}
      ${el === 'HI' ? hiHint() : el === 'CC' ? ccControls(c) : el === 'OSF' ? osfControls(c) : el === 'BAR' ? barControls(c) : `<p class="muted">${t('sort.pickElement')}</p>`}
    </div>
    <label class="field"><span>${t('sort.note')}</span><textarea name="note" rows="2">${escapeHtml(c.note || '')}</textarea></label>
    <label class="check confirm"><input type="checkbox" name="confirmed" ${c.confirmed ? 'checked' : ''}> <strong>${t('sort.confirm')}</strong></label>
    <div class="btn-row">
      <button class="btn" type="submit">${t('btn.save')}</button>
      <button class="btn secondary" type="button" id="clsCancel">${t('btn.cancel')}</button>
      ${c.id ? `<button class="btn danger" type="button" id="clsDelete">${t('btn.delete')}</button>` : ''}
    </div>
  </form>`;
}

export async function renderTab(container, ctx) {
  const tax = taxonomy();
  const facts = [...ctx.facts].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  if (!facts.length) {
    container.innerHTML = `<div class="card"><p class="muted">${t('sort.noFacts')}</p><a class="btn" href="${ctx.base}/facts">${t('tab.facts')}</a></div>`;
    return;
  }
  if (!selectedId || !facts.some((f) => f.id === selectedId)) {
    selectedId = (unsortedFacts(facts)[0] || facts[0]).id;
    editingCls = null;
  }
  const f = facts.find((x) => x.id === selectedId);
  const allCls = await ctx.store.byIndex('classification', 'occurrenceId', ctx.id);
  const cls = allCls.filter((c) => c.factId === f.id).sort((a, b) => (a.order || 0) - (b.order || 0));

  container.innerHTML = `
    <div class="two-col sort">
      <div class="card fact-list">
        <h3>${t('facts.list')} <span class="muted small">${t('sort.progress', { done: facts.length - unsortedFacts(facts).length, total: facts.length })}</span></h3>
        <ul class="plain">${facts.map((x, i) => `<li class="link-row ${x.id === selectedId ? 'selected' : ''}" data-id="${escapeHtml(x.id)}">
          <span class="muted">${i + 1}.</span> ${escapeHtml(short(x.text, 80))} ${chip(x)}</li>`).join('')}</ul>
      </div>
      <div>
        <div class="card">
          <p class="fact-text">${escapeHtml(f.text)}</p>
          <p class="small muted">${f.shelo ? `SHEL/O: ${f.shelo} · ` : ''}${escapeHtml(f.source || '')}</p>
          <div class="check-question"><strong>${t('sort.contributionTest')}</strong><p>${escapeHtml(tx(tax.contribution_test))}</p>
            <div class="btn-row">
              <button class="btn ${f.contributes === true ? '' : 'secondary'}" data-ct="yes">${t('sort.yes')}</button>
              <button class="btn ${f.contributes === false ? '' : 'secondary'}" data-ct="no">${t('sort.no')}</button>
            </div>
            ${f.contributes === false ? `<p class="small muted">${t('sort.otherNote')}</p>` : ''}
          </div>
        </div>
        ${canClassify(f) ? `
          <div class="card">
            <h3>${t('sort.classifications')} <span class="muted">(${cls.length})</span></h3>
            ${cls.length ? `<ul class="plain">${cls.map((c) => `<li class="link-row" data-cls="${escapeHtml(c.id)}">
              <span class="tag">${c.element}</span> ${escapeHtml(tx(element(c.element)))}
              ${subcategoryLabel(c) ? `— ${escapeHtml(subcategoryLabel(c))}` : ''}
              ${c.confirmed ? '<span class="ok">✓</span>' : `<span class="warn">${t('sort.unconfirmed')}</span>`}
              ${c.otherSystem ? `<span class="tag">${t('sort.otherSystemShort')}</span>` : ''}
            </li>`).join('')}</ul>` : `<p class="muted small">${t('sort.noCls')}</p>`}
            ${!editingCls ? `<div class="btn-row"><button class="btn secondary" id="clsNew">${t('sort.addCls')}</button></div>` : ''}
          </div>
          ${editingCls ? clsFormHtml(editingCls) : ''}` : ''}
      </div>
    </div>`;

  container.querySelectorAll('.fact-list li').forEach((li) => li.addEventListener('click', () => {
    selectedId = li.dataset.id; editingCls = null; ctx.refresh();
  }));
  container.querySelectorAll('[data-ct]').forEach((b) => b.addEventListener('click', async () => {
    const yes = b.dataset.ct === 'yes';
    if (!yes && cls.length && !confirm(t('sort.confirmDropCls'))) return;
    await ctx.store.put('fact', { ...f, contributes: yes });
    if (!yes) for (const c of cls) await ctx.store.del('classification', c.id);
    editingCls = null;
    // после «да» — сразу форма классификации; после «нет» — следующий неотсортированный
    if (yes) editingCls = { factId: f.id };
    else { const next = unsortedFacts(facts.filter((x) => x.id !== f.id))[0]; if (next) selectedId = next.id; }
    ctx.refresh();
  }));
  const bNew = container.querySelector('#clsNew');
  if (bNew) bNew.addEventListener('click', () => { editingCls = { factId: f.id }; ctx.refresh(); });
  container.querySelectorAll('[data-cls]').forEach((li) => li.addEventListener('click', () => {
    editingCls = { ...cls.find((c) => c.id === li.dataset.cls) }; ctx.refresh();
  }));

  const form = container.querySelector('#clsForm');
  if (!form) return;
  const rerenderBody = () => {
    const v = formValues(form);
    editingCls = { ...editingCls, ...v, element: v.element, osfCodes: v.osfCodes || [], confirmed: !!v.confirmed };
    ctx.refresh();
  };
  form.querySelectorAll('input[name=element]').forEach((r) => r.addEventListener('change', rerenderBody));
  const cc = form.querySelector('#ccSel');
  if (cc) cc.addEventListener('change', () => { form.querySelector('#ccHint').innerHTML = ccHint(cc.value); });
  const bar = form.querySelector('#barSel');
  if (bar) bar.addEventListener('change', () => { form.querySelector('#barHint').innerHTML = barHint(bar.value); });
  form.querySelectorAll('input[name=osfCodes]').forEach((cb) => cb.addEventListener('change', () => {
    const codes = formValues(form).osfCodes || [];
    form.querySelector('#osfHint').innerHTML = codes.map(osfHint).join('');
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const rec = {
      ...editingCls,
      id: editingCls.id || newId(),
      factId: f.id, occurrenceId: ctx.id,
      element: v.element, confirmed: !!v.confirmed, note: v.note,
      ccCategory: v.element === 'CC' ? v.ccCategory : undefined,
      osfCodes: v.element === 'OSF' ? (v.osfCodes || []) : undefined,
      barrierType: v.element === 'BAR' ? v.barrierType : undefined,
      barrierState: v.element === 'BAR' ? (v.barrierState || null) : undefined,
      otherSystem: ['OSF', 'BAR'].includes(v.element) ? !!v.otherSystem : undefined,
      order: editingCls.order ?? (allCls.filter((c) => c.element === v.element).length + 1),
    };
    const errors = validateClassification(rec);
    if (errors.length) { toast(t('sort.err.' + errors[0])); return; }
    await ctx.store.put('classification', rec);
    editingCls = null; toast(t('toast.saved')); ctx.refresh();
  });
  form.querySelector('#clsCancel').addEventListener('click', () => { editingCls = null; ctx.refresh(); });
  const del = form.querySelector('#clsDelete');
  if (del) del.addEventListener('click', async () => {
    await ctx.store.del('classification', editingCls.id);
    editingCls = null; toast(t('toast.deleted')); ctx.refresh();
  });
}

export function reset() { selectedId = null; editingCls = null; }
