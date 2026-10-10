// «О методологии»: источник, права, состав таксономии.
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml } from '../app.js';

export async function render(view) {
  const tax = taxonomy();
  const li = (arr, f) => arr.map((e) => `<li>${f(e)}</li>`).join('');
  view.innerHTML = `
    <h1>${t('about.title')}</h1>
    <div class="card">
      <p>${t('about.intro')}</p>
      <p><strong>${t('about.source')}:</strong> ${escapeHtml(tax.meta.source)}</p>
      <p class="small muted">${t('about.rights')}</p>
      <p><a href="https://www.eurocontrol.int/" target="_blank" rel="noopener">eurocontrol.int</a></p>
    </div>

    <div class="card">
      <h2>${t('about.process')}</h2>
      <ol>
        <li>${t('about.step.register')}</li>
        <li>${t('about.step.shelo')}</li>
        <li>${t('about.step.timeline')}</li>
        <li>${t('about.step.sort')}: <em>${escapeHtml(tx(tax.contribution_test))}</em></li>
        <li>${t('about.step.chart')}</li>
        <li>${t('about.step.actions')}</li>
        <li>${t('about.step.qa')}</li>
        <li>${t('about.step.report')}</li>
      </ol>
    </div>

    <div class="grid">
      <div class="card"><h3>${t('about.severity')}</h3><ul class="plain">${li(tax.severity, (e) => `<strong>${e.code}</strong> — ${escapeHtml(tx(e))}`)}</ul></div>
      <div class="card"><h3>${t('about.checkQuestions')}</h3><ul class="plain">${li(tax.check_questions, (e) => `<strong>${e.code}</strong> · ${escapeHtml(tx(e))}`)}</ul></div>
      <div class="card"><h3>${t('about.cc')} (${tax.contextual_conditions.length})</h3><ul class="plain">${li(tax.contextual_conditions, (e) => `${escapeHtml(tx(e))} <span class="muted small">(${e.examples.length})</span>`)}</ul></div>
      <div class="card"><h3>${t('about.osf')} (${tax.osf.length})</h3><ul class="plain">${li(tax.osf, (e) => `<strong>${e.code}</strong> — ${escapeHtml(tx(e))}`)}</ul></div>
      <div class="card"><h3>${t('about.barriers')} (${tax.barriers.length})</h3><ul class="plain">${li(tax.barriers, (e) => escapeHtml(tx(e)))}</ul></div>
      <div class="card"><h3>SMARTER</h3><ul class="plain">${li(tax.safety_actions.smarter, (e) => `<strong>${e.code.replace(/\d/, '')}</strong> — ${escapeHtml(tx(e))}`)}</ul></div>
      <div class="card"><h3>${t('about.qa')} (${tax.qa_checklist.length})</h3><ol>${li(tax.qa_checklist, (e) => escapeHtml(tx(e)))}</ol></div>
    </div>
    <p class="small muted">${t('about.translation')} · taxonomy v${escapeHtml(tax.meta.version)}</p>`;
}
