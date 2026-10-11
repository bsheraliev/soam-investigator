// Тесты этапа 0: миграции БД, экспорт/импорт, целостность таксономии и кейсов.
import { openDB, deleteDB, STORES, DB_VERSION } from '../js/db.js';

const out = document.getElementById('out');
const results = [];

async function test(name, fn) {
  const li = document.createElement('li');
  try {
    await fn();
    li.className = 'ok'; li.textContent = '✓ ' + name;
    results.push(true);
  } catch (e) {
    li.className = 'fail'; li.textContent = '✗ ' + name + ' — ' + e.message;
    results.push(false);
    console.error(name, e);
  }
  out.appendChild(li);
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); }
const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error('fetch ' + u); return r.json(); });

const OSF = ['TR', 'WM', 'AC', 'CO', 'OC', 'CG', 'PP', 'MM', 'EI', 'RM', 'CM', 'EE'];
const BARRIERS = ['Awareness', 'Restriction', 'Detection', 'Control & Recovery', 'Protection & Containment', 'Escape & Rescue'];
const CC = ['Workplace conditions', 'Organisational climate', 'Attitudes and personality factors', 'Human performance limitations', 'Physiological and emotional factors'];

// ---------------------------------------------------------------- db.js
const TEST_DB = 'soam-test-' + Date.now();

await test('db: открывается с версией схемы и всеми хранилищами', async () => {
  const s = await openDB(TEST_DB);
  eq(s.db.version, DB_VERSION, 'версия');
  for (const st of STORES) assert(s.db.objectStoreNames.contains(st), 'нет хранилища ' + st);
  const tx = s.db.transaction(STORES);
  for (const st of ['fact', 'event', 'classification', 'link', 'action']) {
    assert(tx.objectStore(st).indexNames.contains('occurrenceId'), st + ': нет индекса occurrenceId');
  }
  assert(tx.objectStore('classification').indexNames.contains('factId'), 'classification: нет индекса factId');
  assert(tx.objectStore('link').indexNames.contains('fromId') && tx.objectStore('link').indexNames.contains('toId'), 'link: индексы');
  s.close();
});

await test('db: put/get/byIndex/del', async () => {
  const s = await openDB(TEST_DB);
  await s.put('occurrence', { id: 'o1', title: 'x', status: 'draft' });
  await s.putMany('fact', [{ id: 'f1', occurrenceId: 'o1', text: 'a' }, { id: 'f2', occurrenceId: 'o1', text: 'b' }, { id: 'f3', occurrenceId: 'o2', text: 'c' }]);
  eq((await s.get('occurrence', 'o1')).title, 'x');
  eq((await s.byIndex('fact', 'occurrenceId', 'o1')).length, 2);
  await s.del('fact', 'f1');
  eq((await s.byIndex('fact', 'occurrenceId', 'o1')).length, 1);
  s.close();
});

await test('db: importOccurrence заменяет дело, deleteOccurrence удаляет каскадно', async () => {
  const s = await openDB(TEST_DB);
  const bundle = {
    occurrence: { id: 'o9', title: 't', status: 'draft' },
    facts: [{ id: 'o9f1', text: 'a' }],
    classifications: [{ id: 'o9c1', factId: 'o9f1', element: 'HI' }],
    links: [{ id: 'o9l1', fromId: 'o9c1', toId: 'o9' }],
    qa: { items: [] },
  };
  await s.importOccurrence(bundle);
  eq((await s.byIndex('fact', 'occurrenceId', 'o9')).length, 1, 'факт получил occurrenceId');
  await s.importOccurrence({ ...bundle, facts: [{ id: 'o9f2', text: 'b' }] });
  const facts = await s.byIndex('fact', 'occurrenceId', 'o9');
  eq(facts.length, 1, 'повторный импорт заменил факты');
  eq(facts[0].id, 'o9f2');
  const exp = await s.exportOccurrence('o9');
  eq(exp.classifications.length, 1); eq(exp.links.length, 1); assert(exp.qa, 'qa экспортирован');
  await s.deleteOccurrence('o9');
  eq(await s.get('occurrence', 'o9'), undefined);
  eq((await s.byIndex('classification', 'occurrenceId', 'o9')).length, 0, 'классификации удалены');
  eq(await s.get('qa', 'o9'), undefined, 'qa удалён');
  s.close();
  await deleteDB(TEST_DB);
});

// ---------------------------------------------------------------- taxonomy.json
const tax = await json('../data/taxonomy.json');

await test('taxonomy: 12 OSF с кодами из QRG, у каждого определение, признаки и последствия', () => {
  eq(tax.osf.map((o) => o.code).join(','), OSF.join(','));
  for (const o of tax.osf) {
    assert(o.definition.en.length > 50, o.code + ': определение');
    assert(o.issues.length >= 3 && o.consequences.length >= 5, o.code + ': списки');
  }
});

await test('taxonomy: 5 категорий контекстных условий с примерами error/common/non_compliance', () => {
  eq(tax.contextual_conditions.map((c) => c.en).join('|'), CC.join('|'));
  for (const c of tax.contextual_conditions) {
    assert(c.examples.length >= 10, c.code + ': мало примеров');
    for (const e of c.examples) assert(['error', 'common', 'non_compliance'].includes(e.kind), c.code + ': kind');
  }
});

await test('taxonomy: 6 типов барьеров, 3 состояния', () => {
  eq(tax.barriers.map((b) => b.en).join('|'), BARRIERS.join('|'));
  eq(tax.barrier_states.map((b) => b.code).join(','), 'absent,failed,worked');
});

await test('taxonomy: тяжесть A,B,C,E,D; 4 контрольных вопроса; тест вклада', () => {
  eq(tax.severity.map((s) => s.code).join(','), 'A,B,C,E,D');
  eq(tax.check_questions.map((q) => q.element).join(','), 'HI,CC,OSF,BAR');
  for (const q of tax.check_questions) assert(q.en.endsWith('?'), 'вопрос ' + q.code);
  assert(tax.contribution_test.en.startsWith('Does this fact'), 'тест вклада');
});

await test('taxonomy: SHEL/O (5), SMARTER (7), чек-лист мер (9), QA (12)', () => {
  eq(tax.shelo.map((s) => s.code).join(''), 'SHELO');
  eq(tax.safety_actions.smarter.map((s) => s.en[0]).join(''), 'SMARTER');
  eq(tax.safety_actions.checklist.length, 9);
  eq(tax.qa_checklist.length, 12);
  assert(tax.safety_actions.coverage_rule.en.includes('at least one safety action'), 'правило покрытия');
});

await test('taxonomy: у каждой записи id уникален, en и ru заполнены, tj_status', () => {
  const ids = new Set(); let n = 0;
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if ('id' in o && 'en' in o) {
        n++;
        assert(!ids.has(o.id), 'дубль id ' + o.id); ids.add(o.id);
        assert(o.en && o.en.trim(), 'пустой en: ' + o.id);
        assert(o.ru && o.ru.trim(), 'пустой ru: ' + o.id);
        assert('tj' in o && o.tj_status, 'нет tj/tj_status: ' + o.id);
      }
      Object.values(o).forEach(walk);
    }
  })(tax);
  assert(n > 400, 'записей: ' + n);
});

// ---------------------------------------------------------------- data/cases
const index = await json('../data/cases/index.json');

await test('cases: index.json содержит 3 кейса', () => eq(index.cases.length, 3));

for (const c of index.cases) {
  await test(`cases: ${c.file} — целостность ссылок и элементов`, async () => {
    const b = await json('../data/cases/' + c.file);
    eq(b.occurrence.id, c.id);
    assert(b.occurrence.isTestCase === true, 'isTestCase');
    assert(Array.isArray(b.occurrence.outcome) && b.occurrence.outcome.length >= 2, 'исход');
    const factIds = new Set(b.facts.map((f) => f.id));
    const clsIds = new Set(b.classifications.map((x) => x.id));
    eq(factIds.size, b.facts.length, 'уникальность id фактов');
    for (const f of b.facts) { assert(f.text && f.text.length > 5, 'пустой факт ' + f.id); eq(f.contributes, true, 'contributes'); }
    for (const x of b.classifications) {
      assert(factIds.has(x.factId), 'классификация без факта ' + x.id);
      assert(['HI', 'CC', 'OSF', 'BAR'].includes(x.element), 'элемент ' + x.element);
      if (x.element === 'OSF') {
        assert(x.osfCodes.length >= 1 && x.osfCodes.every((k) => OSF.includes(k)), 'коды OSF ' + x.id);
      }
      if (x.element === 'BAR') assert('barrierState' in x, 'barrierState ' + x.id);
    }
    const counts = {};
    for (const x of b.classifications) counts[x.element] = (counts[x.element] || 0) + 1;
    for (const el of ['HI', 'CC', 'OSF', 'BAR']) assert(counts[el] >= 3, 'мало ' + el);
    for (const l of b.links) {
      assert(clsIds.has(l.fromId), 'связь из неизвестного узла ' + l.id);
      assert(clsIds.has(l.toId) || l.toId === b.occurrence.id, 'связь в неизвестный узел ' + l.id);
    }
    // у каждого узла HI есть хотя бы одна связь
    const linked = new Set(b.links.flatMap((l) => [l.fromId, l.toId]));
    for (const x of b.classifications) if (x.element === 'HI') assert(linked.has(x.id), 'HI без связей ' + x.id);
    // каждый барьер ведёт к исходу
    for (const x of b.classifications) if (x.element === 'BAR' && !x.otherSystem) {
      assert(b.links.some((l) => l.fromId === x.id && l.toId === b.occurrence.id), 'барьер без связи с исходом ' + x.id);
    }
  });
}

await test('cases: загрузка трёх кейсов в БД и чтение обратно', async () => {
  const name = TEST_DB + '-cases';
  const s = await openDB(name);
  for (const c of index.cases) await s.importOccurrence(await json('../data/cases/' + c.file));
  eq((await s.all('occurrence')).length, 3);
  for (const c of index.cases) {
    const exp = await s.exportOccurrence(c.id);
    eq(exp.facts.length, c.facts, c.file + ': факты');
    eq(exp.links.length, c.links, c.file + ': связи');
  }
  s.close();
  await deleteDB(name);
});

// ---------------------------------------------------------------- rules.js
const R = await import('../js/rules.js');

await test('rules: правило 1 — в анализ только факты, прошедшие тест вклада', () => {
  const facts = [{ id: 1, contributes: true }, { id: 2, contributes: false }, { id: 3 }, { id: 4, contributes: undefined }];
  eq(R.contributingFacts(facts).map((f) => f.id).join(), '1');
  eq(R.otherSafetyIssues(facts).map((f) => f.id).join(), '2');
  eq(R.unsortedFacts(facts).map((f) => f.id).join(), '3,4');
  eq(R.canClassify(facts[0]), true); eq(R.canClassify(facts[1]), false); eq(R.canClassify(facts[2]), false);
});

await test('rules: правило 2 — классификация требует подтверждения и подкатегории', () => {
  eq(R.validateClassification({ element: 'HI', confirmed: true }).length, 0);
  eq(R.validateClassification({ element: 'HI', confirmed: false }).join(), 'confirmed');
  eq(R.validateClassification({ element: 'CC', confirmed: true }).join(), 'ccCategory');
  eq(R.validateClassification({ element: 'OSF', confirmed: true, osfCodes: [] }).join(), 'osfCodes');
  eq(R.validateClassification({ element: 'OSF', confirmed: true, osfCodes: ['TR'] }).length, 0);
  eq(R.validateClassification({ element: 'BAR', confirmed: true, barrierType: 'detection' }).join(), 'barrierState');
  eq(R.validateClassification({ element: 'BAR', confirmed: true, barrierType: 'detection', barrierState: 'failed' }).length, 0);
  eq(R.validateClassification({ element: 'XX', confirmed: true }).join(), 'element');
});

await test('rules: статусы — «Завершено» только из «Меры» и только при готовности', () => {
  eq(R.canTransition('draft', 'collection'), true);
  eq(R.canTransition('draft', 'analysis'), false);
  eq(R.canTransition('analysis', 'completed'), false);
  eq(R.canTransition('actions', 'completed'), false);
  eq(R.canTransition('actions', 'completed', true), true);
  eq(R.canTransition('analysis', 'completed', true), false);
  eq(R.canTransition('collection', 'draft'), true);
});

await test('rules: правило 4 — покрытие мерами OSF и absent/failed барьеров', () => {
  const cls = [
    { id: 'o1', element: 'OSF' }, { id: 'b1', element: 'BAR', barrierState: 'failed' },
    { id: 'b2', element: 'BAR', barrierState: 'worked' }, { id: 'b3', element: 'BAR', barrierState: null },
    { id: 'h1', element: 'HI' }, { id: 'c1', element: 'CC' },
  ];
  eq(R.coverage(cls, []).required.map((c) => c.id).join(), 'o1,b1,b3');
  const cov = R.coverage(cls, [{ addresses: ['o1', 'b3'] }]);
  eq(cov.uncovered.map((c) => c.id).join(), 'b1'); eq(cov.ok, false);
  eq(R.coverage(cls, [{ addresses: ['o1', 'b1'] }, { addresses: ['b3'] }]).ok, true);
});

await test('rules: правило 5 — мера адресует барьеры/OSF и имеет ответственного', () => {
  eq(R.validateAction({ text: 'x', addresses: ['a'], responsible: 'Отдел', status: 'planned' }).length, 0);
  eq(R.validateAction({ text: 'x', addresses: [], responsible: 'Отдел', status: 'planned' }).join(), 'addresses');
  eq(R.validateAction({ text: '', addresses: ['a'], responsible: '', status: 'bogus' }).join(), 'text,responsible,status');
});

await test('rules: правило 7 — QA целиком; сводка готовности', () => {
  const ids = ['qa.01', 'qa.02'];
  eq(R.qaComplete({ items: { 'qa.01': { checked: true } } }, ids), false);
  eq(R.qaComplete({ items: { 'qa.01': { checked: true }, 'qa.02': { checked: true } } }, ids), true);
  const base = { facts: [{ contributes: true }], classifications: [{ id: 'o1', element: 'OSF', confirmed: true }], actions: [{ addresses: ['o1'] }], qa: { items: { 'qa.01': { checked: true }, 'qa.02': { checked: true } } }, qaIds: ids, occurrence: { lessons: ['урок'] } };
  eq(R.readiness(base).ok, true);
  eq(R.readiness({ ...base, actions: [] }).ok, false);
  eq(R.readiness({ ...base, facts: [{}] }).unsorted, 1);
  eq(R.readiness({ ...base, classifications: [{ id: 'o1', element: 'OSF' }] }).unconfirmed, 1);
  eq(R.readiness({ ...base, classifications: [] }).ok, false);
  // этап 3.5: открытые вопросы (QA № 4) и уроки (QA № 12)
  eq(R.readiness({ ...base, facts: [{ contributes: true, followUp: { needed: true, question: 'x' } }] }).ok, false);
  eq(R.readiness({ ...base, facts: [{ contributes: true, followUp: { needed: true, question: 'x', status: 'closed' } }] }).ok, true);
  eq(R.readiness({ ...base, occurrence: { lessons: [] } }).noLessons, true);
  eq(R.readiness({ ...base, occurrence: {} }).ok, false);
});

await test('rules: открытые вопросы по фактам', () => {
  const facts = [{ id: 1, followUp: { needed: true } }, { id: 2, followUp: { needed: true, status: 'closed' } }, { id: 3 }, { id: 4, followUp: { needed: false } }];
  eq(R.openFollowUps(facts).map((f) => f.id).join(), '1');
});

await test('rules: предложение связей — барьер → исход и соседние уровни по событию хронологии', () => {
  const cls = [
    { id: 'o', factId: 'f1', element: 'OSF' }, { id: 'c', factId: 'f2', element: 'CC' },
    { id: 'h', factId: 'f3', element: 'HI' }, { id: 'b', factId: 'f4', element: 'BAR' }, { id: 'b2', factId: 'f5', element: 'BAR' },
  ];
  const events = [{ factIds: ['f1', 'f2', 'f3'] }, { factIds: ['f3', 'f4'] }];
  const got = R.suggestLinks({ classifications: cls, events, links: [{ fromId: 'b', toId: 'occ' }], occurrenceId: 'occ' });
  const keys = got.map((l) => `${l.fromId}>${l.toId}`).sort().join();
  eq(keys, 'b2>occ,c>h,h>b,o>c');
  eq(got.find((l) => l.fromId === 'b2').reason, 'barrier-outcome');
  // OSF→HI не предлагается (не соседние уровни), повторов нет
  eq(got.some((l) => l.fromId === 'o' && l.toId === 'h'), false);
});

await test('rules: тяжесть обязательна для инцидента, не для АП; лимит вложений 5 МБ; сортировка хронологии', () => {
  eq(R.severityRequired({ type: 'incident' }), true);
  eq(R.severityRequired({ type: 'accident' }), false);
  eq(R.attachmentAllowed({ size: 5 * 1024 * 1024 }), true);
  eq(R.attachmentAllowed({ size: 5 * 1024 * 1024 + 1 }), false);
  const ev = R.sortEvents([{ id: 'c', seq: 3 }, { id: 'b', time: '2026-01-01T10:00', seq: 2 }, { id: 'a', time: '2026-01-01T09:00', seq: 1 }, { id: 'd', time: '2026-01-01T09:00', seq: 0 }]);
  eq(ev.map((e) => e.id).join(''), 'dabc');
});

await test('rules: уровень расследования по тяжести (QRG, стр. 7) и конфликт с решением «не расследовать»', () => {
  eq(R.investigationAdvice({ type: 'accident' }).level, 'required');
  eq(R.investigationAdvice({ type: 'accident', severity: 'E' }).level, 'required', 'тяжесть для АП не меняет уровень');
  for (const s of ['A', 'B', 'C']) eq(R.investigationAdvice({ type: 'incident', severity: s }).level, 'recommended', s);
  for (const s of ['E', 'D']) eq(R.investigationAdvice({ type: 'incident', severity: s }).level, 'cost_benefit', s);
  eq(R.investigationAdvice({ type: 'incident' }).level, 'unknown');
  eq(R.investigationAdvice({ type: 'incident', severity: 'A', investigate: false }).conflict, true);
  eq(R.investigationAdvice({ type: 'accident', investigate: false }).conflict, true);
  eq(R.investigationAdvice({ type: 'incident', severity: 'E', investigate: false }).conflict, false);
  eq(R.investigationAdvice({ type: 'incident', severity: 'A', investigate: true }).conflict, false);
});

await test('rules: режим PIRATe — тяжесть и решение о расследовании не требуются, остальное как в SOAM', () => {
  eq(R.isPirate({ mode: 'pirate' }), true); eq(R.isPirate({}), false); eq(R.isPirate(null), false);
  eq(R.severityRequired({ mode: 'pirate', type: 'incident' }), false);
  eq(R.severityRequired({ mode: 'soam', type: 'incident' }), true);
  eq(R.investigationAdvice({ mode: 'pirate', type: 'accident', investigate: false }).level, 'pirate');
  eq(R.investigationAdvice({ mode: 'pirate', type: 'accident', investigate: false }).conflict, false);
  // правило 4 действует и для PIRATe (QRG, стр. 55)
  eq(R.coverage([{ id: 'c', element: 'OSF' }], []).ok, false);
});

await test('taxonomy: PIRATe (QRG, стр. 54–56) — вступление, принцип, 5 шагов, 3 применения', () => {
  assert(tax.pirate && tax.pirate.intro.en && tax.pirate.principle.ru, 'нет pirate');
  eq(tax.pirate.steps.length, 5); eq(tax.pirate.uses.length, 3);
  for (const e of [...tax.pirate.steps, ...tax.pirate.uses]) assert(e.en && e.ru && e.qrg_page >= 54 && e.qrg_page <= 56, e.id);
});

await test('rules: CSV — BOM, «;», кавычки и удвоение, CRLF, массивы и пустые значения', () => {
  const csv = R.toCsv(
    [{ a: 'x;y', b: 'он сказал "да"', c: ['TR', 'WM'], d: null, n: 0 }, { a: 'plain', b: 'line\nbreak', c: [], d: undefined, n: 2 }],
    [{ key: 'a', title: 'A' }, { key: 'b', title: 'B;' }, { key: 'c', title: 'C' }, { key: 'd', title: 'D' }, { key: (r) => r.n * 2, title: 'N2' }],
  );
  assert(csv.startsWith('﻿'), 'BOM');
  const lines = csv.slice(1).split('\r\n');
  eq(lines[0], 'A;"B;";C;D;N2');
  eq(lines[1], '"x;y";"он сказал ""да""";TR, WM;;0');
  eq(lines[2], 'plain;"line\nbreak";;;4');
  eq(lines[3], '', 'завершающий CRLF');
});

await test('rules: автопродвижение статуса — только вперёд, «Завершено» не трогаем', () => {
  eq(R.advanceStatus('draft', 'collection'), 'collection');
  eq(R.advanceStatus('draft', 'actions'), 'actions', 'можно перепрыгнуть');
  eq(R.advanceStatus('actions', 'collection'), 'actions', 'назад не идём');
  eq(R.advanceStatus('analysis', 'analysis'), 'analysis');
  eq(R.advanceStatus('completed', 'actions'), 'completed');
  eq(R.advanceStatus('draft', 'completed'), 'draft', 'завершение — только через QA');
  eq(R.advanceStatus(undefined, 'collection'), 'collection');
  eq(R.advanceStatus('draft', 'bogus'), 'draft');
});

await test('rules: реестр мер — просрочка и порядок; статистика по кодам OSF', () => {
  const today = '2026-10-10';
  eq(R.actionOverdue({ due: '2026-10-09', status: 'planned' }, today), true);
  eq(R.actionOverdue({ due: '2026-10-10', status: 'planned' }, today), false, 'срок сегодня — не просрочена');
  eq(R.actionOverdue({ due: '2026-10-09', status: 'done' }, today), false, 'выполненная не просрочена');
  eq(R.actionOverdue({ status: 'planned' }, today), false, 'без срока');
  const reg = R.actionsRegistry([
    { id: 'done', due: '2026-01-01', status: 'done' },
    { id: 'nodue', status: 'planned' },
    { id: 'late', due: '2026-10-01', status: 'in_progress' },
    { id: 'soon', due: '2026-11-01', status: 'planned' },
  ], today);
  eq(reg.map((a) => a.id).join(','), 'late,soon,nodue,done');
  const st = R.osfStats([
    { element: 'OSF', osfCodes: ['TR', 'WM'] }, { element: 'OSF', osfCodes: ['TR'] }, { element: 'BAR' }, { element: 'OSF', osfCodes: ['XX'] },
  ], OSF);
  eq(st.length, 12); eq(st[0].code, 'TR'); eq(st[0].n, 2); eq(st[1].code, 'WM'); eq(st[1].n, 1); eq(st[2].n, 0); eq(st[2].code, 'AC', 'при равенстве — порядок QRG');
});

await test('taxonomy: глоссарий QRG (стр. 58–60) — 23 термина с en и ru', () => {
  eq(tax.glossary.length, 23);
  for (const g of tax.glossary) assert(g.code && g.en && g.ru && g.qrg_page >= 58 && g.qrg_page <= 60, g.id);
});

await test('db: факт с вложением (Blob) сохраняется и читается', async () => {
  const name = TEST_DB + '-blob';
  const s = await openDB(name);
  const blob = new Blob(['hello'], { type: 'text/plain' });
  await s.put('fact', { id: 'f', occurrenceId: 'o', text: 'x', attachments: [{ id: 'a', name: 'a.txt', type: 'text/plain', size: 5, blob }] });
  const f = await s.get('fact', 'f');
  eq(await f.attachments[0].blob.text(), 'hello');
  s.close(); await deleteDB(name);
});

await test('taxonomy: подсказки «Участие человека» (QRG, стр. 45)', () => {
  eq(tax.hi_guidance.length, 3);
  assert(tax.hi_guidance[2].en.includes('[Someone]'), 'формат');
});

// ---------------------------------------------------------------- bundle.js (экспорт/импорт JSON)
const B = await import('../js/bundle.js');

await test('bundle: экспорт → JSON → импорт сохраняет вложения, связи и меры', async () => {
  const name = TEST_DB + '-bundle';
  const s = await openDB(name);
  const blob = new Blob(['attached text'], { type: 'text/plain' });
  await s.importOccurrence({
    occurrence: { id: 'b1', title: 'Экспорт', type: 'incident', status: 'analysis' },
    facts: [{ id: 'b1f1', text: 'факт', attachments: [{ id: 'a1', name: 'a.txt', type: 'text/plain', size: 13, blob }] }],
    classifications: [{ id: 'b1c1', factId: 'b1f1', element: 'OSF', osfCodes: ['TR'], confirmed: true }],
    links: [{ id: 'b1l1', fromId: 'b1c1', toId: 'b1' }],
    actions: [{ id: 'b1a1', text: 'мера', addresses: ['b1c1'], responsible: 'отдел', status: 'planned' }],
    events: [{ id: 'b1e1', time: '2026-01-01T10:00', description: 'событие', factIds: ['b1f1'] }],
    qa: { items: { 'qa.01': { checked: true, note: 'ok' } } },
  });
  const portable = await B.toPortable(await s.exportOccurrence('b1'), '0.3.0');
  eq(portable.format, B.BUNDLE_FORMAT);
  eq(portable.facts[0].attachments[0].data, btoa('attached text'), 'base64');
  const text = JSON.stringify(portable);
  const parsed = JSON.parse(text);
  eq(B.validatePortable(parsed).join(), '', 'валидация');
  eq(B.validatePortable({ hello: 1 }).includes('occurrence'), true);
  eq(B.validatePortable({ ...parsed, classifications: [{ id: 'x', factId: 'nope' }] }).join(), 'classification-orphan');
  // копия под новым id: все ссылки переписаны
  const copy = B.fromPortable(parsed, { newId: 'b2' });
  eq(copy.occurrence.id, 'b2'); eq(copy.facts[0].occurrenceId, 'b2');
  eq(copy.classifications[0].factId, copy.facts[0].id, 'factId переписан');
  eq(copy.links[0].toId, 'b2', 'связь на исход переписана'); eq(copy.links[0].fromId, copy.classifications[0].id);
  eq(copy.actions[0].addresses[0], copy.classifications[0].id, 'адресация переписана');
  eq(copy.events[0].factIds[0], copy.facts[0].id);
  eq(await copy.facts[0].attachments[0].blob.text(), 'attached text', 'blob восстановлен');
  await s.importOccurrence(copy);
  eq((await s.all('occurrence')).length, 2);
  // замена под тем же id
  const same = B.fromPortable(parsed);
  eq(same.occurrence.id, 'b1');
  await s.importOccurrence(same);
  eq((await s.byIndex('fact', 'occurrenceId', 'b1')).length, 1);
  s.close(); await deleteDB(name);
});

// ---------------------------------------------------------------- docx.js
const D = await import('../js/docx.js');

await test('docx: crc32 эталон, ZIP без сжатия — сигнатуры, число записей, смещения', () => {
  eq(D.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'crc32("123456789")');
  const zip = D.zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 9, 11, 12, 0, 0));
  const dv = new DataView(zip.buffer);
  eq(dv.getUint32(0, true), 0x04034b50, 'локальный заголовок');
  eq(dv.getUint32(zip.length - 22, true), 0x06054b50, 'EOCD');
  eq(dv.getUint16(zip.length - 22 + 10, true), 2, 'записей в каталоге');
  const cdOffset = dv.getUint32(zip.length - 22 + 16, true);
  eq(dv.getUint32(cdOffset, true), 0x02014b50, 'центральный каталог по смещению');
  // вторая локальная запись начинается ровно после первой: 30 + 5 ("a.txt") + 5 ("hello")
  eq(dv.getUint32(40, true), 0x04034b50, 'вторая локальная запись');
  eq(new TextDecoder().decode(zip.slice(30, 35)), 'a.txt');
  eq(new TextDecoder().decode(zip.slice(35, 40)), 'hello');
});

await test('docx: экранирование XML, блоки → document.xml, картинка только при наличии PNG', () => {
  eq(D.xmlEscape('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  const xml = D.docxXml([{ type: 'h1', text: 'Отчёт <1>' }, { type: 'p', runs: [{ text: 'жирный', bold: true }, { text: ' обычный' }] }, { type: 'li', text: 'пункт' }, { type: 'oli', text: 'шаг' }, { type: 'table', rows: [[[{ text: 'A' }], [{ text: 'B' }]], [[{ text: '1' }], [{ text: '2;3' }]]] }, { type: 'image', width: 800, height: 400 }, { type: 'pagebreak' }]);
  assert(xml.includes('Heading1') && xml.includes('Отчёт &lt;1&gt;'), 'заголовок экранирован');
  assert(xml.includes('<w:b/>') && xml.includes('жирный'), 'жирный run');
  assert(xml.includes('w:numId w:val="1"') && xml.includes('w:numId w:val="2"'), 'списки');
  assert(xml.includes('<w:tbl>') && xml.includes('<w:tblHeader/>') && xml.includes('2;3'), 'таблица с шапкой');
  assert(xml.includes('<w:drawing>') && xml.includes('cx="6096000"'), 'картинка 640 px ширины в EMU');
  assert(xml.includes('w:type="page"'), 'разрыв страницы');
  const docx = D.buildDocx([{ type: 'p', text: 'x' }, { type: 'image', width: 10, height: 10 }], { png: null });
  const dvn = new DataView(docx.buffer); eq(dvn.getUint16(docx.length - 22 + 10, true), 7, 'без PNG — 7 частей, картинка выброшена');
  const withPng = D.buildDocx([{ type: 'p', text: 'x' }, { type: 'image', width: 10, height: 10 }], { png: new Uint8Array([137, 80, 78, 71]) });
  eq(new DataView(withPng.buffer).getUint16(withPng.length - 22 + 10, true), 8, 'с PNG — 8 частей');
});

await test('docx: HTML отчёта → блоки (заголовки, абзацы с форматированием, списки, таблицы, схема, черновик)', () => {
  const root = document.createElement('div');
  root.innerHTML = `<div class="no-print">кнопки</div><header class="rep-head"><div class="rep-draft">ЧЕРНОВИК</div><p class="rep-kicker">Отчёт</p><h1>Дело</h1>
    <table class="rep-meta"><tr><th>Тип</th><td>Инцидент</td></tr></table></header>
    <section class="rep-section"><h2>Факты</h2><table class="rep-table"><thead><tr><th>#</th><th>Текст</th></tr></thead><tbody><tr><td>1</td><td>факт <small>📎 a.pdf</small></td></tr></tbody></table></section>
    <section class="rep-section rep-chart"><h2>Схема</h2><div class="rep-svg"><svg width="700" height="300"></svg></div></section>
    <section><h3>HI (1)</h3><ol><li>действие <em>— примечание</em><br><small>Доказательства: интервью</small></li></ol><ul><li>урок</li></ul></section>
    <footer class="rep-foot">Методология: QRG</footer>`;
  const b = D.htmlToBlocks(root);
  const types = b.map((x) => x.type).join(',');
  eq(types, 'p,small,h1,table,h2,table,h2,image,h3,oli,li,small');
  eq(b[0].runs[0].color, 'A50021', 'черновик красным');
  eq(b[3].rows[0][0][0].bold, true, 'th жирный'); eq(b[3].header, true, 'rep-meta как таблица с шапкой');
  eq(b[7].width, 700); assert(b[7].svg.startsWith('<svg'), 'svg сохранён для PNG');
  const li = b[9].runs.map((r) => r.text).join('');
  assert(li.includes('действие') && li.includes('— примечание') && li.includes(' · ') && li.includes('Доказательства'), 'inline-форматирование и перенос: ' + li);
  eq(b[9].runs.find((r) => r.italic).text.trim(), '— примечание');
  assert(!JSON.stringify(b).includes('кнопки'), 'no-print выброшен');
});

// ---------------------------------------------------------------- i18n
await test('i18n: ru — эталон; tj и en — подмножества без лишних ключей (до приёмки новые строки только RU)', async () => {
  const [ru, tj, en] = await Promise.all(['ru', 'tj', 'en'].map((l) => json(`../data/i18n/${l}.json`)));
  for (const [name, d] of [['tj', tj], ['en', en]]) {
    const extra = Object.keys(d).filter((k) => !(k in ru));
    eq(extra.join(), '', name + ': лишние ключи');
  }
  for (const d of [ru, tj, en]) for (const [key, v] of Object.entries(d)) assert(v && v.trim(), 'пустая строка ' + key);
});

const okN = results.filter(Boolean).length;
const s = document.getElementById('summary');
s.textContent = `${okN} / ${results.length} пройдено`;
s.className = okN === results.length ? 'ok' : 'fail';
