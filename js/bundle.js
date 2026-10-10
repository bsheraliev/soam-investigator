// Экспорт/импорт дела в JSON: вложения (Blob) ↔ base64, проверка схемы пакета.
import { DB_VERSION } from './db.js';

export const BUNDLE_FORMAT = 'soam-investigator/occurrence';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || 'application/octet-stream' });
}

/** Пакет из БД → переносимый JSON-объект (вложения в base64). */
export async function toPortable(bundle, appVersion) {
  const facts = [];
  for (const f of bundle.facts || []) {
    const attachments = [];
    for (const a of f.attachments || []) {
      attachments.push({ id: a.id, name: a.name, type: a.type, size: a.size, data: a.blob ? await blobToBase64(a.blob) : (a.data || '') });
    }
    facts.push({ ...f, attachments });
  }
  return {
    format: BUNDLE_FORMAT, schema: DB_VERSION, appVersion, exportedAt: new Date().toISOString(),
    occurrence: bundle.occurrence, facts, events: bundle.events || [], classifications: bundle.classifications || [],
    links: bundle.links || [], actions: bundle.actions || [], qa: bundle.qa || null,
  };
}

/** Проверка пакета перед импортом: список ошибок (пустой — можно импортировать). */
export function validatePortable(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['not-object'];
  if (p.format !== BUNDLE_FORMAT && !(p.schema && p.occurrence && p.facts)) errors.push('format');
  if (!p.occurrence || typeof p.occurrence !== 'object' || !p.occurrence.id) errors.push('occurrence');
  if (p.schema && p.schema > DB_VERSION) errors.push('schema-newer');
  for (const k of ['facts', 'events', 'classifications', 'links', 'actions']) {
    if (p[k] !== undefined && !Array.isArray(p[k])) errors.push(k);
  }
  const factIds = new Set((p.facts || []).map((f) => f.id));
  for (const c of p.classifications || []) if (!factIds.has(c.factId)) { errors.push('classification-orphan'); break; }
  return errors;
}

/** Переносимый JSON → пакет для db.importOccurrence (base64 → Blob). newId — дать делу новый id (копия). */
export function fromPortable(p, { newId = null } = {}) {
  const idMap = new Map();
  const occId = newId || p.occurrence.id;
  const map = (id) => {
    if (id === p.occurrence.id) return occId;
    if (!newId) return id;
    if (!idMap.has(id)) idMap.set(id, `${occId}:${idMap.size + 1}`);
    return idMap.get(id);
  };
  const facts = (p.facts || []).map((f) => ({
    ...f, id: map(f.id), occurrenceId: occId,
    attachments: (f.attachments || []).map((a) => ({ id: a.id, name: a.name, type: a.type, size: a.size, blob: base64ToBlob(a.data, a.type) })),
  }));
  const classifications = (p.classifications || []).map((c) => ({ ...c, id: map(c.id), factId: map(c.factId), occurrenceId: occId }));
  const links = (p.links || []).map((l) => ({ ...l, id: map(l.id), fromId: map(l.fromId), toId: map(l.toId), occurrenceId: occId }));
  const actions = (p.actions || []).map((a) => ({ ...a, id: map(a.id), occurrenceId: occId, addresses: (a.addresses || []).map(map) }));
  const events = (p.events || []).map((e) => ({ ...e, id: map(e.id), occurrenceId: occId, factIds: (e.factIds || []).map(map) }));
  const occurrence = { ...p.occurrence, id: occId };
  if (newId) { occurrence.isTestCase = false; occurrence.title = (typeof occurrence.title === 'string' ? occurrence.title : (occurrence.title && occurrence.title.ru) || '') + ' (копия)'; }
  return { occurrence, facts, events, classifications, links, actions, qa: p.qa ? { ...p.qa, occurrenceId: occId } : null };
}
