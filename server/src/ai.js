// AI-подсказки со сменным провайдером (этап 5). Провайдер задаётся окружением: AI_PROVIDER = none | mock | gemini | claude.
// Сервер отправляет провайдеру только обезличенный текст факта и короткий контекст дела; таксономия SOAM — из data/taxonomy.json.
// Ответ — строгий JSON; подсказка никогда не применяется автоматически, решение за расследователем.
import { readFileSync } from 'node:fs';

const TAX = JSON.parse(readFileSync(new URL('../../data/taxonomy.json', import.meta.url), 'utf8'));

const OSF_LIST = TAX.osf.map((o) => `${o.code} — ${o.en}: ${(o.definition && o.definition.en) || ''}`).join('\n');
const CC_LIST = TAX.contextual_conditions.map((c) => `${c.code} — ${c.en}`).join('\n');
const BAR_LIST = TAX.barriers.map((b) => `${b.code} — ${b.en}`).join('\n');
const CHECKS = TAX.check_questions.map((q) => `${q.element}: ${q.en}`).join('\n');

/** Промпт: факт + контекст → JSON с предложением классификации и нейтральной формулировкой HI. */
export function buildPrompt({ fact, context = {}, lang = 'ru' }) {
  const schema = `{
  "contributes": true | false,
  "elements": [ { "element": "HI" | "CC" | "OSF" | "BAR", "ccCategory": "<code or null>", "osfCodes": ["<code>"] | null, "barrierType": "<code or null>", "barrierState": "absent" | "failed" | "worked" | null, "rationale": "<1-2 sentences, ${lang}>" } ],
  "hiRewrite": "<if the fact describes a person's action: a neutral, non-judgemental wording [someone] [did / did not do something], ${lang}; else null>",
  "questions": ["<up to 3 follow-up data-collection questions, ${lang}>"]
}`;
  return `You are assisting an aviation safety investigator who applies EUROCONTROL SOAM (Systemic Occurrence Analysis Methodology, QRG V3). Classify ONE fact. Answer with JSON only, matching this schema exactly:
${schema}

Rules: first apply the contribution test ("Does this fact represent a condition or event that contributed to the occurrence?"). Use the check questions:
${CHECKS}
Contextual Condition categories (codes):
${CC_LIST}
Organisational and System Factor codes:
${OSF_LIST}
Barrier types (codes):
${BAR_LIST}
Human Involvement must be worded as an action or non-action without blame (Just Culture). A fact may belong to more than one element. Write rationale, hiRewrite and questions in ${lang === 'ru' ? 'Russian' : lang}.

Occurrence (anonymised): ${JSON.stringify({ title: context.title || '', type: context.type || '', outcome: context.outcome || [] })}
Other facts (anonymised, for context): ${JSON.stringify((context.otherFacts || []).slice(0, 30))}
FACT TO CLASSIFY: ${JSON.stringify({ text: fact.text, source: fact.source || '', shelo: fact.shelo || null })}`;
}

/** Вытащить JSON из ответа модели (возможны ```json ограждения и текст вокруг). */
export function parseJson(text) {
  const s = String(text || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no-json');
  return JSON.parse(body.slice(start, end + 1));
}

const ELEMENTS = ['HI', 'CC', 'OSF', 'BAR'];
const OSF_CODES = new Set(TAX.osf.map((o) => o.code));
const CC_CODES = new Set(TAX.contextual_conditions.map((c) => c.code));
const BAR_CODES = new Set(TAX.barriers.map((b) => b.code));

/** Привести ответ к таксономии: чужие коды выбрасываем, лишние поля убираем. */
export function normalise(raw) {
  const out = { contributes: !!raw.contributes, elements: [], hiRewrite: typeof raw.hiRewrite === 'string' && raw.hiRewrite.trim() ? raw.hiRewrite.trim() : null, questions: Array.isArray(raw.questions) ? raw.questions.filter((q) => typeof q === 'string').slice(0, 3) : [] };
  for (const e of Array.isArray(raw.elements) ? raw.elements : []) {
    if (!e || !ELEMENTS.includes(e.element)) continue;
    const n = { element: e.element, rationale: typeof e.rationale === 'string' ? e.rationale.slice(0, 500) : '' };
    if (e.element === 'CC') n.ccCategory = CC_CODES.has(e.ccCategory) ? e.ccCategory : null;
    if (e.element === 'OSF') n.osfCodes = (Array.isArray(e.osfCodes) ? e.osfCodes : []).filter((c) => OSF_CODES.has(c));
    if (e.element === 'BAR') { n.barrierType = BAR_CODES.has(e.barrierType) ? e.barrierType : null; n.barrierState = ['absent', 'failed', 'worked'].includes(e.barrierState) ? e.barrierState : null; }
    out.elements.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- провайдеры
async function callGemini({ apiKey, model }, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }) });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const j = await res.json();
  return (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text).join('') || '';
}

async function callClaude({ apiKey, model }, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1500, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }) });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const j = await res.json();
  return (j.content || []).map((c) => c.text || '').join('');
}

/** Заглушка для тестов и демонстрации: детерминированный ответ по ключевым словам факта. */
function mockAnswer(prompt) {
  const m = prompt.match(/FACT TO CLASSIFY: (\{.*\})$/s);
  const fact = m ? JSON.parse(m[1]) : { text: '' };
  const t = (fact.text || '').toLowerCase();
  const elements = [];
  if (/\bnot\b|didn't|не |failed to|без /.test(t)) elements.push({ element: 'HI', rationale: 'Описано действие или бездействие человека.' });
  if (/training|обучен|подготов/.test(t)) elements.push({ element: 'OSF', osfCodes: ['TR'], rationale: 'Относится к подготовке персонала.' });
  if (/roster|workload|нагрузк|график/.test(t)) elements.push({ element: 'CC', ccCategory: 'workplace', rationale: 'Условие на рабочем месте.' });
  if (/warning|alert|предупрежд|not detected|не обнаруж/.test(t)) elements.push({ element: 'BAR', barrierType: 'detection', barrierState: 'failed', rationale: 'Барьер обнаружения не сработал.' });
  return JSON.stringify({ contributes: elements.length > 0, elements, hiRewrite: elements.some((e) => e.element === 'HI') ? 'Работник не выполнил требуемое действие' : null, questions: ['Какие данные подтверждают факт?'] });
}

const DEFAULT_MODELS = { gemini: 'gemini-2.0-flash', claude: 'claude-haiku-5-5' };

/** Фабрика: { enabled, provider, model, suggest({ fact, context, lang }) } */
export function createAi({ provider = process.env.AI_PROVIDER || 'none', apiKey = process.env.AI_API_KEY || '', model = process.env.AI_MODEL || '' } = {}) {
  const name = String(provider).toLowerCase();
  const mdl = model || DEFAULT_MODELS[name] || null;
  const enabled = name === 'mock' || ((name === 'gemini' || name === 'claude') && !!apiKey);
  const call = name === 'gemini' ? (p) => callGemini({ apiKey, model: mdl }, p)
    : name === 'claude' ? (p) => callClaude({ apiKey, model: mdl }, p)
    : name === 'mock' ? async (p) => mockAnswer(p)
    : async () => { throw new Error('ai-disabled'); };
  return {
    enabled, provider: enabled ? name : 'none', model: enabled ? mdl : null,
    async suggest(input) {
      if (!enabled) throw new Error('ai-disabled');
      const prompt = buildPrompt(input);
      const text = await call(prompt);
      return normalise(parseJson(text));
    },
  };
}
