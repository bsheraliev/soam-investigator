// Загрузка data/taxonomy.json и поиск по кодам. UI и логика читают списки отсюда, не хардкодят.

let _tax = null;
let _loading = null;

export async function loadTaxonomy(url = 'data/taxonomy.json') {
  if (_tax) return _tax;
  if (!_loading) {
    _loading = fetch(url).then((r) => {
      if (!r.ok) throw new Error('taxonomy: не удалось загрузить ' + url);
      return r.json();
    }).then((j) => { _tax = index(j); return _tax; });
  }
  return _loading;
}

export function taxonomy() {
  if (!_tax) throw new Error('taxonomy: сначала await loadTaxonomy()');
  return _tax;
}

function index(j) {
  const byCode = (arr) => Object.fromEntries(arr.map((e) => [e.code, e]));
  j._osf = byCode(j.osf);
  j._barrier = byCode(j.barriers);
  j._severity = byCode(j.severity);
  j._element = byCode(j.soam_elements);
  j._cc = byCode(j.contextual_conditions);
  j._shelo = byCode(j.shelo);
  j._barrierState = byCode(j.barrier_states);
  j._check = Object.fromEntries(j.check_questions.map((q) => [q.element, q]));
  return j;
}

export const osf = (code) => taxonomy()._osf[code];
export const barrier = (code) => taxonomy()._barrier[code];
export const severity = (code) => taxonomy()._severity[code];
export const element = (code) => taxonomy()._element[code];
export const shelo = (code) => taxonomy()._shelo[code];
export const barrierState = (code) => taxonomy()._barrierState[code];
/** Контрольный вопрос для элемента SOAM: HI, CC, OSF, BAR. */
export const checkQuestion = (elementCode) => taxonomy()._check[elementCode];
