// Вкладка «Отчёт»: печатная страница (в PDF через печать браузера). Правило 7: полноценный отчёт — только после QA.
import { t, tx } from '../i18n.js';
import { taxonomy, osf, barrier, element, severity, shelo } from '../taxonomy.js';
import { escapeHtml, fmtDateTime, toast } from '../ui.js';
import { sortEvents, otherSafetyIssues, contributingFacts, qaComplete, SMARTER_CODES, openFollowUps, investigationAdvice, isPirate } from '../rules.js';
import { layout, renderSvg } from './chart.js';
import { brandingHtml } from './settings.js';

function section(title, body) {
  return `<section class="rep-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

export function buildReportHtml(ctx, { classes, links, events, actions, qa }) {
  const tax = taxonomy();
  const o = ctx.occurrence;
  const facts = [...ctx.facts].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const factById = Object.fromEntries(facts.map((f) => [f.id, f]));
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const qaIds = tax.qa_checklist.map((q) => q.id);
  const final = qaComplete(qa, qaIds);
  const sev = o.severity ? severity(o.severity) : null;
  const advice = investigationAdvice(o);
  const pirate = isPirate(o);
  const svg = renderSvg(o, layout(o, classes, factById), links, { interactive: false });

  const head = `
    <header class="rep-head">
      ${brandingHtml()}
      ${final ? '' : `<div class="rep-draft">${t('report.draft')}</div>`}
      <p class="rep-kicker">${pirate ? t('report.kickerPirate') : t('report.kicker')}</p>
      <h1>${escapeHtml(tx(o.title))}</h1>
      <table class="rep-meta">
        <tr><th>${t('field.type')}</th><td>${t('type.' + (o.type || 'unknown'))}</td></tr>
        <tr><th>${t('field.date')}</th><td>${escapeHtml(fmtDateTime(o.date))}</td></tr>
        <tr><th>${t('field.place')}</th><td>${escapeHtml(o.place || '—')}</td></tr>
        ${pirate ? `
        <tr><th>${t('occ.pirateReason')}</th><td>${o.pirateReason ? t('pirate.reason.' + o.pirateReason) : '—'}</td></tr>
        <tr><th>${t('occ.participants')}</th><td>${escapeHtml(o.participants || '—')}</td></tr>` : `
        <tr><th>${t('field.severity')}</th><td>${sev ? `${sev.code} — ${escapeHtml(tx(sev))}` : '—'}</td></tr>
        <tr><th>${t('occ.investigate')}</th><td>${o.investigate === true ? t('occ.investigateYes') : o.investigate === false ? t('occ.investigateNo') : t('occ.investigateUndecided')}${o.investigateReason ? ` — ${escapeHtml(o.investigateReason)}` : ''}${advice.conflict ? ` <em>(${t('occ.advice.conflict')})</em>` : ''}</td></tr>
        <tr><th>${t('occ.advice.label')}</th><td>${t({ required: 'occ.advice.required', recommended: 'occ.advice.recommended', cost_benefit: 'occ.advice.costBenefit', unknown: 'occ.advice.unknown' }[advice.level], { severity: o.severity || '' })}</td></tr>`}
        <tr><th>${t('field.status')}</th><td>${t('status.' + (o.status || 'draft'))}${o.completedAt ? ` · ${escapeHtml(o.completedAt.slice(0, 10))}` : ''}</td></tr>
        <tr><th>${t('report.generated')}</th><td>${new Date().toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
      </table>
    </header>`;

  const outcome = section(pirate ? t('occ.scenarioOutcome') : t('occ.outcome'), (o.outcome || []).length ? `<ul>${o.outcome.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<p>—</p>');

  const factsHtml = section(t('report.facts'), facts.length ? `<table class="rep-table"><thead><tr><th>#</th><th>SHEL/O</th><th>${t('facts.text')}</th><th>${t('facts.source')}</th><th>${t('report.contribution')}</th></tr></thead><tbody>
    ${facts.map((f, i) => `<tr><td>${i + 1}</td><td>${f.shelo ? `${f.shelo} — ${escapeHtml(tx(shelo(f.shelo)))}` : ''}</td><td>${escapeHtml(f.text)}${(f.attachments || []).length ? `<br><small>📎 ${f.attachments.map((a) => escapeHtml(a.name)).join(', ')}</small>` : ''}</td><td>${escapeHtml(f.source || '')}</td><td>${f.contributes === true ? '✓' : f.contributes === false ? '—' : '?'}</td></tr>`).join('')}
  </tbody></table>` : '<p>—</p>');

  const evs = sortEvents(events);
  const timeline = section(t('tab.timeline'), evs.length ? `<table class="rep-table"><thead><tr><th>${t('timeline.time')}</th><th>${t('timeline.description')}</th></tr></thead><tbody>
    ${evs.map((e) => `<tr><td class="nowrap">${escapeHtml(fmtDateTime(e.time)) || '—'}</td><td>${escapeHtml(e.description)}</td></tr>`).join('')}</tbody></table>` : '<p>—</p>');

  const chart = `<section class="rep-section rep-chart"><h2>${t('report.chart')}</h2><div class="rep-svg">${svg}</div></section>`;

  const elem = (code, filter, fmt) => {
    const items = classes.filter(filter).sort((a, b) => (a.order || 0) - (b.order || 0));
    return `<h3>${escapeHtml(tx(element(code)))} (${items.length})</h3>${items.length ? `<ol>${items.map((c) => `<li>${fmt(c)}${c.note ? ` <em>— ${escapeHtml(c.note)}</em>` : ''}${evidence(c)}</li>`).join('')}</ol>` : '<p>—</p>'}`;
  };
  // Доказательства у каждого фактора: источник факта и его вложения (QA № 8: findings supported by evidence).
  const evidence = (c) => {
    const f = factById[c.factId];
    if (!f) return '';
    const parts = [];
    if (f.source) parts.push(escapeHtml(f.source));
    if ((f.attachments || []).length) parts.push('📎 ' + f.attachments.map((a) => escapeHtml(a.name)).join(', '));
    return `<br><small class="rep-evidence">${t('report.evidence')}: ${parts.length ? parts.join(' · ') : t('report.evidenceNone')}</small>`;
  };
  const txt = (c) => escapeHtml(factById[c.factId] ? factById[c.factId].text : c.factId);
  const factors = section(t('report.factors'),
    elem('HI', (c) => c.element === 'HI', txt) +
    elem('CC', (c) => c.element === 'CC', (c) => `${c.ccCategory ? `<strong>${escapeHtml(tx(tax._cc[c.ccCategory]))}:</strong> ` : ''}${txt(c)}`) +
    elem('OSF', (c) => c.element === 'OSF', (c) => `<strong>${(c.osfCodes || []).map((k) => `${k} (${escapeHtml(osf(k) ? tx(osf(k)) : k)})`).join(' / ')}</strong>${c.otherSystem ? ` [${t('soam.otherSystem')}]` : ''}: ${txt(c)}`) +
    elem('BAR', (c) => c.element === 'BAR', (c) => `<strong>${c.barrierType ? escapeHtml(tx(barrier(c.barrierType))) : ''}${c.barrierState ? ' · ' + t('barrier.' + c.barrierState) : ''}</strong>${c.barrierType || c.barrierState ? ': ' : ''}${txt(c)}`));

  const acts = [...actions].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const actionsHtml = section(t('actions.list'), acts.length ? `<table class="rep-table"><thead><tr><th>#</th><th>${t('actions.text')}</th><th>${t('actions.addresses')}</th><th>${t('actions.responsible')}</th><th>${t('actions.due')}</th><th>${t('field.status')}</th><th>SMARTER</th></tr></thead><tbody>
    ${acts.map((a, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(a.text)}</td><td>${(a.addresses || []).map((id) => byId[id] ? `${byId[id].element}${byId[id].element === 'OSF' ? ' ' + (byId[id].osfCodes || []).join('/') : ''}: ${escapeHtml((factById[byId[id].factId] || {}).text || '')}` : '').filter(Boolean).join('<br>')}</td><td>${escapeHtml(a.responsible || '')}</td><td class="nowrap">${escapeHtml(a.due || '')}</td><td>${t('actions.status.' + (a.status || 'planned'))}</td><td class="nowrap">${SMARTER_CODES.filter((k) => a.smarter && a.smarter[k]).map((k) => k.replace(/\d/, '')).join('') || '—'}</td></tr>`).join('')}
  </tbody></table>` : '<p>—</p>');

  const other = otherSafetyIssues(facts);
  const otherHtml = section(t('sort.otherTitle'), other.length ? `<ul>${other.map((f) => `<li>${escapeHtml(f.text)}</li>`).join('')}</ul>` : `<p>${t('report.none')}</p>`);

  const open = openFollowUps(facts);
  const followHtml = open.length ? section(t('report.followUps'), `<ul>${open.map((f) => `<li>${escapeHtml(f.followUp.question || '—')} <em>— ${escapeHtml(f.text)}</em></li>`).join('')}</ul>`) : '';
  const lessonsHtml = section(t('report.lessons'), ((o.lessons || []).length ? `<ul>${o.lessons.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '<p>—</p>') + (o.disseminated ? `<p><strong>${t('report.disseminated')}:</strong> ${escapeHtml(o.disseminated)}</p>` : ''));

  const qaHtml = section(t('qa.title'), `<ol class="rep-qa">${tax.qa_checklist.map((q) => {
    const st = (qa && qa.items && qa.items[q.id]) || {};
    return `<li>${st.checked ? '☑' : '☐'} ${escapeHtml(tx(q))}${st.note ? ` <em>— ${escapeHtml(st.note)}</em>` : ''}</li>`;
  }).join('')}</ol>`);

  const footer = `<footer class="rep-foot">${t('report.source')}: ${escapeHtml(tax.meta.source)}<br>SOAM Investigator v${escapeHtml(ctx.appVersion || '')} · ${t('report.stats', { facts: facts.length, contributing: contributingFacts(facts).length, classes: classes.length, links: links.length, actions: acts.length })}</footer>`;

  return head + outcome + factsHtml + timeline + chart + factors + actionsHtml + otherHtml + followHtml + lessonsHtml + qaHtml + footer;
}

export async function renderTab(container, ctx) {
  const [links, events] = await Promise.all([
    ctx.store.byIndex('link', 'occurrenceId', ctx.id),
    ctx.store.byIndex('event', 'occurrenceId', ctx.id),
  ]);
  const data = { classes: ctx.classifications, links, events, actions: ctx.actions, qa: ctx.qa };
  const final = ctx.readiness.qaDone === ctx.readiness.qaTotal;
  container.innerHTML = `
    <div class="card no-print">
      <div class="btn-row top">
        <button class="btn" id="printBtn">${t('report.print')}</button>
        <button class="btn secondary" id="docxBtn" title="${t('report.docxHint')}">${t('report.docx')}</button>
        <span class="small ${final ? 'muted' : 'warn'}">${final ? t('report.finalNote') : t('report.draftNote', { done: ctx.readiness.qaDone, total: ctx.readiness.qaTotal })}</span>
      </div>
    </div>
    <article class="report" id="report">${buildReportHtml(ctx, data)}</article>`;
  container.querySelector('#printBtn').addEventListener('click', () => window.print());
  const docxBtn = container.querySelector('#docxBtn');
  docxBtn.addEventListener('click', async () => {
    docxBtn.disabled = true;
    try {
      const { htmlToBlocks, buildDocx } = await import('../docx.js');
      const { svgToPngBlob } = await import('./chart.js');
      const { downloadFile } = await import('../ui.js');
      const blocks = htmlToBlocks(container.querySelector('#report'));
      // картинки: схема — из SVG через canvas; логотип — из data-URL
      for (const b of blocks) {
        if (b.type !== 'image') continue;
        try {
          if (b.svg) b.png = new Uint8Array(await (await svgToPngBlob(b.svg, b.width, b.height)).arrayBuffer());
          else if (b.dataUrl) { const r = await fetch(b.dataUrl); b.mime = r.headers.get('content-type') || 'image/png'; b.png = new Uint8Array(await r.arrayBuffer()); }
        } catch { b.png = null; }
      }
      const bytes = buildDocx(blocks, { title: tx(ctx.occurrence.title), footer: `${tx(ctx.occurrence.title)} · SOAM Investigator v${ctx.appVersion || ''}`, footerWords: { page: t('docx.page'), of: t('docx.of') } });
      downloadFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        ('soam-' + tx(ctx.occurrence.title)).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) + '.docx');
    } catch (e) { toast(t('error.title') + ': ' + e.message); }
    docxBtn.disabled = false;
  });
}
