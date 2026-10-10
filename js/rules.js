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

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/** Тяжесть по схеме EUROCONTROL (QRG, стр. 7) применяется к инцидентам; для АП не требуется. */
export function severityRequired(occurrence) {
  return occurrence.type !== 'accident';
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
