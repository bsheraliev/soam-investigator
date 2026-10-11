// «О методологии»: источник, права, состав таксономии.
import { t, tx } from '../i18n.js';
import { taxonomy } from '../taxonomy.js';
import { escapeHtml } from '../ui.js';

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
    ${tax.principles ? `<div class="card">
      <details>
        <summary><strong>${t('about.principles')}</strong> <span class="muted small">(QRG, стр. 8–9, 18)</span></summary>
        <h4>${t('about.systemsThinking')}</h4>
        <p>${escapeHtml(tx(tax.principles.systems_thinking_intro))}</p>
        <ol>${li(tax.principles.systems_thinking, (e) => escapeHtml(tx(e)))}</ol>
        <h4>Safety-II</h4>${tax.principles.safety_ii.map((p) => `<p>${escapeHtml(tx(p))}</p>`).join('')}
        <h4>Just Culture</h4><p>${escapeHtml(tx(tax.principles.just_culture[0]))}</p><ul>${li(tax.principles.just_culture.slice(1), (e) => escapeHtml(tx(e)))}</ul>
        <p class="small muted">${escapeHtml(tax.principles.source_note)}</p>
      </details>
    </div>` : ''}
    <div class="card">
      <details>
        <summary><strong>${t('about.pirate')}</strong> <span class="muted small">(QRG, стр. 54–56)</span></summary>
        <p>${escapeHtml(tx(tax.pirate.intro))}</p>
        <p>${escapeHtml(tx(tax.pirate.principle))}</p>
        <h4>${t('about.pirateSteps')}</h4><ol>${li(tax.pirate.steps, (e) => escapeHtml(tx(e)))}</ol>
        <h4>${t('about.pirateUses')}</h4><ul>${li(tax.pirate.uses, (e) => escapeHtml(tx(e)))}</ul>
        <p class="small muted">${escapeHtml(tax.pirate.source_note)}</p>
      </details>
    </div>
    <div class="card">
      <details>
        <summary><strong>${t('about.glossary')}</strong> <span class="muted small">(${tax.glossary.length} · QRG, стр. 58–60)</span></summary>
        <dl class="glossary">${tax.glossary.map((g) => `<dt>${escapeHtml(g.code)}</dt><dd>${escapeHtml(tx(g))}<br><span class="small muted">${escapeHtml(g.en)}</span></dd>`).join('')}</dl>
      </details>
    </div>
    <p class="small muted">${t('about.translation')} · taxonomy v${escapeHtml(tax.meta.version)}</p>`;
}
