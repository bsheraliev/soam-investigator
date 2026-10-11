// Мелкие помощники для экранов: экранирование, тост, форматы.

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

/** 'YYYY-MM-DDTHH:MM' → 'YYYY-MM-DD HH:MM'; дата без времени — как есть. */
export function fmtDateTime(v) {
  if (!v) return '';
  return String(v).replace('T', ' ');
}

export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** Значения формы по именам полей (checkbox → boolean, radio → value, multiple select → array). */
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) {
        out[el.name] = out[el.name] || [];
        if (el.checked) out[el.name].push(el.value);
      } else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
      else if (!(el.name in out)) out[el.name] = out[el.name] ?? '';
    } else if (el.type === 'file') {
      out[el.name] = Array.from(el.files || []);
    } else if (el.multiple) {
      out[el.name] = Array.from(el.selectedOptions).map((o) => o.value);
    } else {
      out[el.name] = el.value.trim();
    }
  }
  return out;
}

/** Скачать файл из строки или Blob. */
export function downloadFile(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Короткий текст для списков. */
export function short(s, n = 90) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
