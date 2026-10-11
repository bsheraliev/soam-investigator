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
  // Готовое дело можно завершить с любого статуса: перед завершением статус продвигается до «Меры» (правила 4 и 7 проверены в readiness).
  const canFinish = o.status !== 'completed' && (canTransition(o.status, 'completed', r.ok) || (r.ok && canTransition('actions', 'completed', r.ok)));
  const open = openFollowUps(ctx.facts);
  const closed = ctx.facts.filter((f) => f.followUp && f.followUp.status === 'closed' && f.followUp.question);
  // AI-ревью всего дела: только при входе на сервер с включённым AI и пишущей роли; уходит обезличенный конспект
  const sync = await import('./sync.js');
  const session = sync.getSession();
  const canAsk = session && session.token && ['admin', 'investigator'].includes(session.user.role);
  const aiOn = canAsk ? await sync.aiStatus().then((s) => (s.enabled ? s : null)) : null;

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
`}
        </div>
        ${aiOn ? `<div class="card">
          <h3>${t('qa.aiReview')}</h3>
          <p class="small muted">${t('qa.aiReviewHint', { provider: escapeHtml(aiOn.provider || '') })}</p>
          <div class="btn-row"><button class="btn secondary" id="aiReview">${t('qa.aiReviewRun')}</button></div>
          <div id="aiReviewOut"></div>
        </div>` : ''}
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
  const aiBtn = container.querySelector('#aiReview');
  if (aiBtn) aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    const out = container.querySelector('#aiReviewOut');
    out.innerHTML = `<p class="small muted">${t('sort.aiWorking')}</p>`;
    try {
      const { toPortable } = await import('../bundle.js');
      const { parseDictionary, anonymiseBundle } = await import('../anon.js');
      const labels = { email: t('anon.label.email'), phone: t('anon.label.phone'), registration: t('anon.label.registration'), callsign: t('anon.label.callsign') };
      const portable = await toPortable(await ctx.store.exportOccurrence(ctx.id), ctx.appVersion);
      const { bundle } = anonymiseBundle(portable, parseDictionary(o.anonDict || '', { redacted: t('anon.redacted') }), { labels });
      const byFact = {};
      for (const c of bundle.classifications || []) (byFact[c.factId] = byFact[c.factId] || []).push({ element: c.element, codes: c.osfCodes || (c.ccCategory ? [c.ccCategory] : c.barrierType ? [c.barrierType, c.barrierState || ''] : []) });
      const context = {
        anonymised: true, caseId: ctx.id, title: tx(bundle.occurrence.title), type: o.type, outcome: bundle.occurrence.outcome || [],
        facts: (bundle.facts || []).map((f) => ({ id: f.id, text: f.text, contributes: f.contributes === true ? true : f.contributes === false ? false : null, elements: byFact[f.id] || [] })),
        linkCount: (bundle.links || []).length,
        actions: (bundle.actions || []).map((a) => ({ text: a.text, addresses: (a.addresses || []).map((id) => { const c = (bundle.classifications || []).find((x) => x.id === id); return c ? c.element : ''; }) })),
      };
      const r = await sync.api('POST', '/api/ai/review', { context, lang: document.documentElement.lang === 'en' ? 'en' : 'ru' });
      const rv = r.review;
      const factText = (id) => { const f = ctx.facts.find((x) => x.id === id); return f ? escapeHtml(short(f.text, 60)) : ''; };
      out.innerHTML = `<div class="hint">
        <p><span class="small muted">(${escapeHtml(r.provider)}${r.model ? ' · ' + escapeHtml(r.model) : ''})</span></p>
        ${rv.summary ? `<p>${escapeHtml(rv.summary)}</p>` : ''}
        ${rv.observations.length ? `<ul>${rv.observations.map((ob) => `<li><span class="tag">${t('qa.aiKind.' + ob.kind)}</span> ${escapeHtml(ob.text)}${ob.factIds.length ? `<br><span class="small muted">${ob.factIds.map(factText).filter(Boolean).join(' · ')}</span>` : ''}</li>`).join('')}</ul>` : `<p class="small muted">${t('qa.aiNoObservations')}</p>`}
        ${rv.questions.length ? `<p><strong>${t('sort.aiQuestions')}:</strong></p><ul>${rv.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>` : ''}
        <p class="small muted">${t('qa.aiReviewDisclaimer')}</p>
      </div>`;
    } catch (e) { out.innerHTML = `<p class="warn small">${escapeHtml(sync.errText(e))}</p>`; }
    aiBtn.disabled = false;
  });

  container.querySelector('#lessonsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = e.target;
    await ctx.store.put('occurrence', { ...o, lessons: fd.lessons.value.split('\n').map((s) => s.trim()).filter(Boolean), disseminated: fd.disseminated.value.trim(), updatedAt: nowIso() });
    toast(t('toast.saved')); ctx.refresh();
  });
  const fin = container.querySelector('#finish');
  if (fin) fin.addEventListener('click', async () => {
    if (!confirm(t('qa.confirmFinish'))) return;
    await ctx.advance('actions');
    const fresh = await ctx.store.get('occurrence', ctx.id);
    if (!canTransition(fresh.status, 'completed', ctx.readiness.ok)) { toast(t('occ.err.status')); return; }
    await ctx.store.put('occurrence', { ...fresh, status: 'completed', completedAt: nowIso(), updatedAt: nowIso() });
    // Если подключён сервер организации — завершённое дело уходит туда сразу (решение 2026-10-10).
    const sync = await import('./sync.js');
    const s = sync.getSession();
    if (s && s.token && ['admin', 'investigator'].includes(s.user.role)) {
      const r = await sync.pushOccurrence(ctx.store, ctx.id);
      toast(r ? t('sync.autoPushed') : t('qa.finished'));
    } else toast(t('qa.finished'));
    ctx.refresh();
  });
}
