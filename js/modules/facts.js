// Вкладка «Факты»: сбор фактов по SHEL/O с подсказками из QRG, источник, вложения (до 5 МБ).
import { newId } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml, toast, formValues, nowIso, fmtSize, short } from '../ui.js';
import { attachmentAllowed, ATTACHMENT_LIMIT } from '../rules.js';

let editing = null;        // факт в форме (null — новый)
let pendingFiles = [];     // вложения, добавленные до сохранения

function sheloPrompts(code) {
  const s = taxonomy()._shelo[code];
  if (!s) return '';
  return `<details class="hint" open><summary>${t('facts.prompts')} — ${escapeHtml(tx(s))}</summary>
    <p class="muted small">${escapeHtml(tx(s.description))}</p>
    ${s.groups.map((g) => `<p><strong>${escapeHtml(tx(g))}</strong></p>${g.items.length ? `<ul>${g.items.map((i) => `<li>${escapeHtml(tx(i))}</li>`).join('')}</ul>` : ''}`).join('')}
  </details>`;
}

function attachmentsHtml(list, editable) {
  if (!list.length) return '';
  return `<ul class="attachments">${list.map((a, i) => `
    <li><a href="#" data-dl="${i}">${escapeHtml(a.name)}</a> <span class="muted small">${fmtSize(a.size)}</span>
      ${editable ? `<button type="button" class="link danger" data-rm="${i}">✕</button>` : ''}</li>`).join('')}</ul>`;
}

function formHtml(f) {
  const tax = taxonomy();
  const atts = [...(f.attachments || []), ...pendingFiles];
  return `
  <form id="factForm" class="card form">
    <h3>${f.id ? t('facts.edit') : t('facts.add')}</h3>
    <label class="field"><span>${t('facts.text')} *</span><textarea name="text" rows="3" required>${escapeHtml(f.text || '')}</textarea></label>
    <div class="row">
      <label class="field"><span>${t('facts.shelo')}</span>
        <select name="shelo" id="sheloSel">
          <option value="">—</option>
          ${tax.shelo.map((s) => `<option value="${s.code}" ${f.shelo === s.code ? 'selected' : ''}>${s.code} — ${escapeHtml(tx(s))}</option>`).join('')}
        </select></label>
      <label class="field"><span>${t('facts.source')}</span><input name="source" maxlength="300" value="${escapeHtml(f.source || '')}" placeholder="${t('facts.sourcePlaceholder')}"></label>
    </div>
    <div id="sheloHint">${f.shelo ? sheloPrompts(f.shelo) : ''}</div>
    <div class="followup">
      <label class="check"><input type="checkbox" name="fuNeeded" ${f.followUp && f.followUp.needed && f.followUp.status !== 'closed' ? 'checked' : ''}> ${t('sort.followUp')}</label>
      <input class="qa-note" name="fuQuestion" placeholder="${t('sort.followUpQuestion')}" value="${escapeHtml((f.followUp && f.followUp.question) || '')}">
    </div>
    <label class="field"><span>${t('facts.attachments')} <span class="muted small">(${t('facts.limit', { mb: ATTACHMENT_LIMIT / 1024 / 1024 })})</span></span>
      <input type="file" name="files" multiple></label>
    <div id="attList">${attachmentsHtml(atts, true)}</div>
    <div class="btn-row">
      <button class="btn" type="submit">${t('btn.save')}</button>
      <button class="btn secondary" type="button" id="factCancel">${t('btn.cancel')}</button>
      ${f.id ? `<button class="btn danger" type="button" id="factDelete">${t('btn.delete')}</button>` : ''}
    </div>
  </form>`;
}

function listHtml(facts) {
  if (!facts.length) return `<p class="muted">${t('facts.empty')}</p>`;
  const chip = (f) => f.contributes === true ? `<span class="tag ok">${t('sort.contributes')}</span>`
    : f.contributes === false ? `<span class="tag">${t('sort.other')}</span>` : `<span class="tag warn">${t('sort.unsorted')}</span>`;
  return `<table><thead><tr><th>#</th><th>SHEL/O</th><th>${t('facts.text')}</th><th>${t('facts.source')}</th><th></th></tr></thead><tbody>
    ${facts.map((f, i) => `<tr class="link-row" data-id="${escapeHtml(f.id)}">
      <td>${i + 1}</td>
      <td>${f.shelo ? `<span class="tag">${f.shelo}</span>` : ''}</td>
      <td>${escapeHtml(f.text)}${(f.attachments || []).length ? ` <span class="muted small">📎${f.attachments.length}</span>` : ''}</td>
      <td class="small muted">${escapeHtml(short(f.source || '', 60))}</td>
      <td>${chip(f)}${f.followUp && f.followUp.needed && f.followUp.status !== 'closed' ? ` <span class="tag q" title="${escapeHtml(f.followUp.question || '')}">?</span>` : ''}</td></tr>`).join('')}
  </tbody></table>`;
}

export async function renderTab(container, ctx) {
  const facts = [...ctx.facts].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const f = editing || {};
  container.innerHTML = `
    <div class="two-col">
      <div>${formHtml(f)}</div>
      <div class="card">
        <h3>${t('facts.list')} <span class="muted">(${facts.length})</span></h3>
        ${listHtml(facts)}
      </div>
    </div>`;

  const form = container.querySelector('#factForm');
  const sel = form.querySelector('#sheloSel');
  sel.addEventListener('change', () => { form.querySelector('#sheloHint').innerHTML = sel.value ? sheloPrompts(sel.value) : ''; });

  form.querySelector('input[name=files]').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      if (!attachmentAllowed(file)) { toast(t('facts.tooBig', { name: file.name })); continue; }
      pendingFiles.push({ id: newId(), name: file.name, type: file.type, size: file.size, blob: new Blob([await file.arrayBuffer()], { type: file.type }) });
    }
    e.target.value = '';
    form.querySelector('#attList').innerHTML = attachmentsHtml([...(f.attachments || []), ...pendingFiles], true);
    bindAttachments(form, f);
  });
  bindAttachments(form, f);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (!v.text) { toast(t('facts.err.text')); return; }
    const now = nowIso();
    const rec = {
      ...f,
      id: f.id || newId(),
      occurrenceId: ctx.id,
      text: v.text,
      shelo: v.shelo || null,
      source: v.source,
      attachments: [...(f.attachments || []), ...pendingFiles],
      contributes: f.contributes,
      followUp: v.fuNeeded ? { needed: true, question: v.fuQuestion, status: 'open', updatedAt: now }
        : (f.followUp ? { ...f.followUp, needed: false, status: 'closed' } : undefined),
      seq: f.seq ?? (facts.length ? Math.max(...facts.map((x) => x.seq || 0)) + 1 : 1),
      createdAt: f.createdAt || now,
      updatedAt: now,
    };
    await ctx.store.put('fact', rec);
    editing = null; pendingFiles = [];
    toast(t('toast.saved'));
    ctx.refresh();
  });
  form.querySelector('#factCancel').addEventListener('click', () => { editing = null; pendingFiles = []; ctx.refresh(); });
  const del = form.querySelector('#factDelete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(t('facts.confirmDelete'))) return;
    for (const c of await ctx.store.byIndex('classification', 'factId', f.id)) await ctx.store.del('classification', c.id);
    await ctx.store.del('fact', f.id);
    editing = null; pendingFiles = [];
    toast(t('toast.deleted'));
    ctx.refresh();
  });

  container.querySelectorAll('tr.link-row').forEach((tr) => tr.addEventListener('click', () => {
    editing = facts.find((x) => x.id === tr.dataset.id) || null;
    pendingFiles = [];
    ctx.refresh();
    container.scrollIntoView({ behavior: 'smooth' });
  }));
}

function bindAttachments(form, f) {
  const all = [...(f.attachments || []), ...pendingFiles];
  form.querySelectorAll('[data-dl]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const att = all[+a.dataset.dl];
    const url = URL.createObjectURL(att.blob);
    const l = document.createElement('a'); l.href = url; l.download = att.name; l.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }));
  form.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.rm;
    const n = (f.attachments || []).length;
    if (i < n) f.attachments.splice(i, 1); else pendingFiles.splice(i - n, 1);
    form.querySelector('#attList').innerHTML = attachmentsHtml([...(f.attachments || []), ...pendingFiles], true);
    bindAttachments(form, f);
  }));
}

/** Сброс состояния формы при уходе с дела. */
export function reset() { editing = null; pendingFiles = []; }
