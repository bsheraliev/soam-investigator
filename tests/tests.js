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

await test('rules: статусы — «Завершено» недоступно до этапа 2, переходы по цепочке', () => {
  eq(R.canTransition('draft', 'collection'), true);
  eq(R.canTransition('draft', 'analysis'), false);
  eq(R.canTransition('analysis', 'completed'), false);
  eq(R.canTransition('actions', 'completed'), false);
  eq(R.canTransition('collection', 'draft'), true);
});

await test('rules: тяжесть обязательна для инцидента, не для АП; лимит вложений 5 МБ; сортировка хронологии', () => {
  eq(R.severityRequired({ type: 'incident' }), true);
  eq(R.severityRequired({ type: 'accident' }), false);
  eq(R.attachmentAllowed({ size: 5 * 1024 * 1024 }), true);
  eq(R.attachmentAllowed({ size: 5 * 1024 * 1024 + 1 }), false);
  const ev = R.sortEvents([{ id: 'c', seq: 3 }, { id: 'b', time: '2026-01-01T10:00', seq: 2 }, { id: 'a', time: '2026-01-01T09:00', seq: 1 }, { id: 'd', time: '2026-01-01T09:00', seq: 0 }]);
  eq(ev.map((e) => e.id).join(''), 'dabc');
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

// ---------------------------------------------------------------- i18n
await test('i18n: ru, tj, en содержат один и тот же набор ключей', async () => {
  const [ru, tj, en] = await Promise.all(['ru', 'tj', 'en'].map((l) => json(`../data/i18n/${l}.json`)));
  const k = (o) => Object.keys(o).sort().join('|');
  eq(k(tj), k(ru), 'tj vs ru'); eq(k(en), k(ru), 'en vs ru');
  for (const d of [ru, tj, en]) for (const [key, v] of Object.entries(d)) assert(v && v.trim(), 'пустая строка ' + key);
});

const okN = results.filter(Boolean).length;
const s = document.getElementById('summary');
s.textContent = `${okN} / ${results.length} пройдено`;
s.className = okN === results.length ? 'ok' : 'fail';
