// Бизнес-правила SOAM в чистом виде (без DOM и БД) — покрываются тестами в tests/.
// Нумерация правил — по CLAUDE.md.

export const STATUSES = ['draft', 'collection', 'analysis', 'actions', 'completed'];

// Допустимые переходы статуса. «completed» открывается на этапе 2 (правила 4 и 7).
const TRANSITIONS = {
  draft: ['collection'],
  collection: ['draft', 'analysis'],
  analysis: ['collection', 'actions'],
  actions: ['analysis'],
  completed: [],
};

/** Переход статуса. «completed» — только при ready === true (правила 4 и 7). */
export function canTransition(from, to, ready = false) {
  if (to === 'completed') return from === 'actions' && ready === true;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * Автопродвижение статуса: работа на вкладке означает, что дело дошло до этого этапа
 * (факт → collection, классификация → analysis, мера → actions). Только вперёд; «Завершено» не трогаем.
 */
export function advanceStatus(current, reached) {
  const ci = STATUSES.indexOf(current || 'draft');
  const ri = STATUSES.indexOf(reached);
  if (current === 'completed' || ri < 0 || reached === 'completed') return current || 'draft';
  return ri > ci ? reached : (current || 'draft');
}

// ---------------------------------------------------------------- этап 2: меры, покрытие, QA

export const ACTION_STATUSES = ['planned', 'in_progress', 'done'];
export const SMARTER_CODES = ['S', 'M', 'A', 'R1', 'T', 'E', 'R2'];

/**
 * Правило 4: мерой должен быть закрыт каждый OSF и каждый Absent/Failed барьер (QRG, стр. 50).
 * Барьер без состояния считается требующим меры (осторожная трактовка); worked — по желанию.
 */
export function needsAction(c) {
  if (c.element === 'OSF') return true;
  if (c.element === 'BAR') return c.barrierState !== 'worked';
  return false;
}

/** Покрытие: какие классификации требуют меры и какие из них не закрыты. */
export function coverage(classifications, actions) {
  const covered = new Set();
  for (const a of actions) for (const id of a.addresses || []) covered.add(id);
  const required = classifications.filter(needsAction);
  const uncovered = required.filter((c) => !covered.has(c.id));
  return { required, uncovered, ok: uncovered.length === 0 };
}

/** Правило 5: мера адресует барьеры/OSF (поле addresses обязательно), ответственный — подразделение/должность. */
export function validateAction(a) {
  const errors = [];
  if (!a.text || !a.text.trim()) errors.push('text');
  if (!Array.isArray(a.addresses) || !a.addresses.length) errors.push('addresses');
  if (!a.responsible || !a.responsible.trim()) errors.push('responsible');
  if (!ACTION_STATUSES.includes(a.status)) errors.push('status');
  return errors;
}

/** Правило 7: QA-чек-лист пройден целиком. */
export function qaComplete(qa, ids) {
  if (!qa || !qa.items) return false;
  return ids.every((id) => qa.items[id] && qa.items[id].checked === true);
}

/** Открытые вопросы по фактам (QA № 4: issues requiring follow-up identified and actioned). */
export function openFollowUps(facts) {
  return facts.filter((f) => f.followUp && f.followUp.needed && f.followUp.status !== 'closed');
}

/** Сводка готовности дела к статусу «Завершено». */
export function readiness({ facts, classifications, actions, qa, qaIds, occurrence = {} }) {
  const cov = coverage(classifications, actions);
  const unsorted = unsortedFacts(facts).length;
  const unconfirmed = classifications.filter((c) => c.confirmed !== true).length;
  const qaDone = qaIds.filter((id) => qa && qa.items && qa.items[id] && qa.items[id].checked).length;
  const noClassifications = classifications.length === 0;
  const followUps = openFollowUps(facts).length;
  const noLessons = !(Array.isArray(occurrence.lessons) && occurrence.lessons.some((l) => l && l.trim()));
  const ok = unsorted === 0 && unconfirmed === 0 && cov.ok && qaDone === qaIds.length && !noClassifications && followUps === 0 && !noLessons;
  return { unsorted, unconfirmed, uncovered: cov.uncovered, required: cov.required.length, qaDone, qaTotal: qaIds.length, noClassifications, followUps, noLessons, ok };
}

// ---------------------------------------------------------------- реестр мер и статистика по всем делам

/** Мера просрочена: срок прошёл, а статус не «выполнена». today — 'YYYY-MM-DD'. */
export function actionOverdue(a, today) {
  return !!a.due && a.status !== 'done' && a.due < today;
}

/** Реестр мер по всем делам: сортировка — просроченные, затем по сроку (без срока — в конец), выполненные — последними. */
export function actionsRegistry(actions, today) {
  const rank = (a) => (a.status === 'done' ? 2 : actionOverdue(a, today) ? 0 : 1);
  return [...actions].sort((a, b) => rank(a) - rank(b) || (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0));
}

/** Статистика по кодам OSF: сколько классификаций OSF несут каждый код, по убыванию; коды без упоминаний — с нулём. */
export function osfStats(classifications, codes) {
  const count = Object.fromEntries(codes.map((c) => [c, 0]));
  for (const c of classifications) if (c.element === 'OSF') for (const k of c.osfCodes || []) if (k in count) count[k]++;
  return codes.map((code) => ({ code, n: count[code] })).sort((a, b) => b.n - a.n || codes.indexOf(a.code) - codes.indexOf(b.code));
}

// ---------------------------------------------------------------- связи на схеме

const LEVEL_ORDER = ['OSF', 'CC', 'HI', 'BAR'];
const levelOf = (c) => c.element;

/**
 * Предложение связей: (1) каждый барьер → исход; (2) факты, привязанные к одному событию хронологии,
 * связываются между соседними уровнями SOAM (OSF→CC, CC→HI, HI→BAR). Возвращает только новые связи.
 */
export function suggestLinks({ classifications, events, links, occurrenceId }) {
  const have = new Set(links.map((l) => `${l.fromId}>${l.toId}`));
  const out = [];
  const add = (fromId, toId, reason) => {
    const k = `${fromId}>${toId}`;
    if (have.has(k)) return;
    have.add(k);
    out.push({ fromId, toId, reason });
  };
  for (const c of classifications) if (c.element === 'BAR') add(c.id, occurrenceId, 'barrier-outcome');
  const byFact = {};
  for (const c of classifications) (byFact[c.factId] = byFact[c.factId] || []).push(c);
  for (const ev of events) {
    const cls = (ev.factIds || []).flatMap((fid) => byFact[fid] || []);
    for (const a of cls) for (const b of cls) {
      if (a === b) continue;
      const ia = LEVEL_ORDER.indexOf(levelOf(a)), ib = LEVEL_ORDER.indexOf(levelOf(b));
      if (ia >= 0 && ib === ia + 1) add(a.id, b.id, 'same-event');
    }
  }
  return out;
}

/** Тяжесть по схеме EUROCONTROL (QRG, стр. 7) применяется к инцидентам; для АП не требуется. */
export function severityRequired(occurrence) {
  return occurrence.type !== 'accident';
}

/**
 * Уровень расследования по QRG (стр. 7): АП всегда расследуется (Приложение 13);
 * для A, B, C SOAM крайне желателен; для E и D — по оценке затраты/польза
 * (потенциальные уроки для безопасности против ресурсов на расследование).
 * level: required | recommended | cost_benefit | unknown (тяжесть инцидента не оценена).
 * conflict: выбрано «не расследовать», хотя методология требует или рекомендует расследование.
 */
export function investigationAdvice(occurrence = {}) {
  let level = 'unknown';
  if (occurrence.type === 'accident') level = 'required';
  else if (['A', 'B', 'C'].includes(occurrence.severity)) level = 'recommended';
  else if (['E', 'D'].includes(occurrence.severity)) level = 'cost_benefit';
  const conflict = occurrence.investigate === false && (level === 'required' || level === 'recommended');
  return { level, conflict };
}

/** Правило 1: в анализ SOAM попадают только факты, прошедшие тест вклада. */
export function contributingFacts(facts) {
  return facts.filter((f) => f.contributes === true);
}

/** Правило 1: не прошедшие тест — «прочие вопросы безопасности» (хранятся отдельно, в отчёте — своим разделом). */
export function otherSafetyIssues(facts) {
  return facts.filter((f) => f.contributes === false);
}

/** Факты, по которым тест вклада ещё не проведён. */
export function unsortedFacts(facts) {
  return facts.filter((f) => f.contributes !== true && f.contributes !== false);
}

/** Классификация допустима только для факта, прошедшего тест вклада (правило 1). */
export function canClassify(fact) {
  return fact.contributes === true;
}

/**
 * Правило 2: классификация принимается только с подтверждением контрольного вопроса
 * и с обязательной подкатегорией для CC / OSF / BAR.
 * Возвращает список кодов ошибок (пустой — всё в порядке).
 */
export function validateClassification(c) {
  const errors = [];
  if (!['HI', 'CC', 'OSF', 'BAR'].includes(c.element)) errors.push('element');
  if (c.confirmed !== true) errors.push('confirmed');
  if (c.element === 'CC' && !c.ccCategory) errors.push('ccCategory');
  if (c.element === 'OSF' && !(Array.isArray(c.osfCodes) && c.osfCodes.length)) errors.push('osfCodes');
  if (c.element === 'BAR') {
    if (!c.barrierType) errors.push('barrierType');
    if (!['absent', 'failed', 'worked'].includes(c.barrierState)) errors.push('barrierState');
  }
  return errors;
}

/** Лимит вложения к факту. */
export const ATTACHMENT_LIMIT = 5 * 1024 * 1024;

export function attachmentAllowed(file) {
  return file && file.size <= ATTACHMENT_LIMIT;
}

/** Хронология: сортировка по времени; записи без времени — в конец в порядке ввода. */
export function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (!a.time && !b.time) return (a.seq || 0) - (b.seq || 0);
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : a.time > b.time ? 1 : (a.seq || 0) - (b.seq || 0);
  });
}
