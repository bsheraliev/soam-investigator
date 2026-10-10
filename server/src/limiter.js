// Ограничитель попыток в памяти процесса: после max неудач за окно — блок на полное окно от последней неудачи.
// clock — для тестов (по умолчанию Date.now). Нулевой или некорректный max → лимит по умолчанию, а не «всегда блок».
export function limiter(max, windowMs, clock = Date.now) {
  const hits = new Map();
  const sweep = () => { const now = clock(); for (const [k, v] of hits) if (v.until < now) hits.delete(k); };
  return {
    /** Бросает { status: 429, code: 'too-many-attempts', retryAfterSec } через onBlock, если ключ заблокирован. */
    check(key, onBlock) {
      const h = hits.get(key);
      if (h && h.count >= max && h.until > clock()) onBlock(Math.ceil((h.until - clock()) / 1000));
    },
    /** Неудачная попытка: счётчик в окне; при достижении max окно блокировки отсчитывается заново от этой попытки. */
    hit(key) {
      if (hits.size > 10000) sweep();
      const now = clock();
      const h = hits.get(key);
      if (!h || h.until < now) { hits.set(key, { count: 1, until: now + windowMs }); return; }
      h.count += 1;
      if (h.count >= max) h.until = now + windowMs;
    },
    reset(key) { hits.delete(key); },
    size() { return hits.size; },
  };
}

/** Число из переменной окружения: положительное целое, иначе значение по умолчанию. */
export function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
