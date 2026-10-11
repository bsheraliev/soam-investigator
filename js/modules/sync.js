// «Сервер»: подключение к серверу организации по желанию (этап 4). Без входа приложение ничего не отправляет.
// Дела передаются целиком пакетом JSON (как экспорт), с проверкой версии на сервере.
import { db } from '../db.js';
import { t, tx } from '../i18n.js';
import { escapeHtml, toast, formValues, fmtDateTime } from '../ui.js';

const KEY = 'soam.sync';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function setSession(s) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
}
export const isConnected = () => !!(getSession() && getSession().token);

/** Запрос к серверу текущей сессии. Ошибка — Error с .code (для t('sync.err.' + code)). */
export async function api(method, path, body, session = getSession()) {
  if (!session || !session.url) { const e = new Error('no-server'); e.code = 'no-server'; throw e; }
  let res;
  try {
    res = await fetch(session.url.replace(/\/+$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(session.token ? { Authorization: 'Bearer ' + session.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { const e = new Error('network'); e.code = 'network'; throw e; }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || 'generic'); e.code = json.error || 'generic'; e.extra = json; throw e; }
  return json;
}
/** Текст ошибки сервера для пользователя; неизвестный код — общее сообщение с кодом. */
export const errText = (e) => { const k = 'sync.err.' + (e.code || 'generic'); const s = t(k); return s === k ? t('sync.err.generic') + ' (' + e.message + ')' : s; };

/** Отправить дело на сервер. Возвращает { version } или null (отменено / ошибка показана). */
export async function pushOccurrence(store, id) {
  const bundle = await store.exportOccurrence(id);
  const { toPortable } = await import('../bundle.js');
  const { APP_VERSION } = await import('../app.js');
  const portable = await toPortable(bundle, APP_VERSION);
  const o = bundle.occurrence;
  let base = o.remote && o.remote.version;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await api('PUT', '/api/cases/' + encodeURIComponent(id), { bundle: portable, baseVersion: base ?? null });
      await store.put('occurrence', { ...o, remote: { url: getSession().url, version: r.version, at: r.updatedAt } });
      (await import('./home.js')).invalidateRemoteCache(); // главная покажет свежую версию
      toast(t('sync.pushed', { v: r.version }));
      return r;
    } catch (e) {
      if (e.code === 'version-conflict' && attempt === 0) {
        if (!confirm(t('sync.conflict', { v: e.extra.version }))) return null;
        base = e.extra.version; continue;
      }
      toast(errText(e)); return null;
    }
  }
  return null;
}

/** Получить дело с сервера и записать локально (с подтверждением замены). */
export async function pullOccurrence(store, id) {
  try {
    const r = await api('GET', '/api/cases/' + encodeURIComponent(id));
    const { fromPortable, validatePortable } = await import('../bundle.js');
    const errors = validatePortable(r.bundle);
    if (errors.length) { toast(t('sync.err.bundle')); return null; }
    const existing = await store.get('occurrence', id);
    if (existing && !confirm(t('sync.replaceLocal', { title: tx(existing.title) }))) return null;
    const b = fromPortable(r.bundle);
    b.occurrence.remote = { url: getSession().url, version: r.version, at: r.updatedAt };
    await store.importOccurrence(b);
    (await import('./home.js')).invalidateRemoteCache();
    toast(t('sync.pulled'));
    return r;
  } catch (e) { toast(errText(e)); return null; }
}

function loginHtml(saved) {
  return `
    <div class="card"><p class="small muted">${t('sync.privacy')}</p></div>
    <form id="loginForm" class="card form">
      <h3>${t('sync.login')}</h3>
      <label class="field"><span>${t('sync.url')}</span><input name="url" type="url" required placeholder="https://soam-investigator-api.onrender.com" value="${escapeHtml((saved && saved.url) || '')}"></label>
      <div class="row">
        <label class="field"><span>${t('sync.email')}</span><input name="email" type="email" required autocomplete="username"></label>
        <label class="field"><span>${t('sync.password')}</span><input name="password" type="password" required autocomplete="current-password"></label>
      </div>
      <div class="btn-row"><button class="btn" type="submit">${t('sync.login')}</button></div>
    </form>
    <details class="card"><summary><strong>${t('sync.register')}</strong></summary>
      <p class="small muted">${t('sync.registerHint')}</p>
      <form id="regForm" class="form">
        <label class="field"><span>${t('sync.url')}</span><input name="url" type="url" required value="${escapeHtml((saved && saved.url) || '')}"></label>
        <label class="field"><span>${t('sync.org')}</span><input name="organisation" required maxlength="200"></label>
        <div class="row">
          <label class="field"><span>${t('sync.name')}</span><input name="name" required maxlength="200"></label>
          <label class="field"><span>${t('sync.email')}</span><input name="email" type="email" required></label>
          <label class="field"><span>${t('sync.password')}</span><input name="password" type="password" required minlength="8"></label>
        </div>
        <div class="btn-row"><button class="btn secondary" type="submit">${t('sync.register')}</button></div>
      </form>
    </details>`;
}

export async function render(view) {
  const session = getSession();
  view.innerHTML = `<h1>${t('sync.title')}</h1><p class="lead">${t('sync.lead')}</p><div id="syncBody"></div>`;
  const body = view.querySelector('#syncBody');

  if (!session || !session.token) {
    body.innerHTML = loginHtml(session);
    const doAuth = async (path, v) => {
      try {
        const r = await api('POST', path, v, { url: v.url });
        setSession({ url: v.url.replace(/\/+$/, ''), token: r.token, user: r.user, org: r.organisation });
        toast(t('sync.connected')); render(view);
      } catch (e) { toast(errText(e)); }
    };
    body.querySelector('#loginForm').addEventListener('submit', (e) => { e.preventDefault(); const v = formValues(e.target); doAuth('/api/auth/login', { url: v.url, email: v.email, password: v.password }); });
    body.querySelector('#regForm').addEventListener('submit', (e) => { e.preventDefault(); doAuth('/api/auth/register', formValues(e.target)); });
    return;
  }

  const store = await db();
  let remote = [];
  try { remote = (await api('GET', '/api/cases')).cases; } catch (e) {
    if (e.code === 'unauthorized') { setSession({ url: session.url }); toast(t('sync.err.unauthorized')); return render(view); } // адрес сервера сохраняем
    toast(errText(e));
  }
  const local = (await store.all('occurrence')).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const remoteById = Object.fromEntries(remote.map((c) => [c.id, c]));
  const canWrite = ['admin', 'investigator'].includes(session.user.role);

  body.innerHTML = `
    <div class="card">
      <p>${t('sync.loggedAs', { name: escapeHtml(session.user.name), role: t('sync.role.' + session.user.role), org: escapeHtml(session.org.name) })} <span class="small muted">· ${escapeHtml(session.url)}</span></p>
      <div class="btn-row"><button class="btn secondary small" id="logout">${t('sync.logout')}</button>
        ${session.user.role === 'admin' ? `<button class="btn secondary small" id="orgExport">${t('sync.orgExport')}</button>
        <label class="btn secondary small" for="orgImport">${t('sync.orgImport')}</label><input id="orgImport" type="file" accept="application/json,.json" hidden>` : ''}</div>
      ${session.user.role === 'admin' ? `<p class="small muted">${t('sync.orgExportHint')} ${t('sync.orgImportHint')}</p>` : ''}
    </div>
    <div class="card">
      <h3>${t('sync.serverCases')} <span class="muted">(${remote.length})</span></h3>
      ${remote.length ? `<table><thead><tr><th>${t('field.title')}</th><th>${t('field.status')}</th><th>${t('sync.version')}</th><th>${t('sync.updated')}</th><th></th></tr></thead><tbody>
        ${remote.map((c) => `<tr><td>${escapeHtml(c.title)}</td><td>${c.status ? t('status.' + c.status) : '—'}</td><td>${c.version}</td><td class="nowrap">${escapeHtml(fmtDateTime(c.updatedAt))}</td>
          <td><button class="btn secondary small" data-pull="${escapeHtml(c.id)}">${t('sync.pull')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('sync.none')}</p>`}
    </div>
    <div class="card">
      <h3>${t('sync.localCases')} <span class="muted">(${local.length})</span></h3>
      ${local.length ? `<table><thead><tr><th>${t('field.title')}</th><th>${t('field.status')}</th><th>${t('sync.remoteState')}</th><th></th></tr></thead><tbody>
        ${local.map((o) => {
          const r = remoteById[o.id];
          const mine = o.remote && o.remote.version;
          const state = !r ? t('sync.notRemote') : (mine === r.version ? t('sync.inSync', { v: r.version }) : t('sync.remoteNewer', { v: r.version, mine: mine || '—' }));
          return `<tr><td><a href="#/occurrence/${encodeURIComponent(o.id)}">${escapeHtml(tx(o.title))}</a></td><td>${t('status.' + (o.status || 'draft'))}</td><td class="small">${state}</td>
            <td>${canWrite ? `<button class="btn secondary small" data-push="${escapeHtml(o.id)}">${t('sync.push')}</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table>` : `<p class="muted">${t('home.empty')}</p>`}
    </div>`;

  // --- пользователи (admin), журнал (admin / investigator), свой пароль (все)
  const isAdmin = session.user.role === 'admin';
  let users = [], audit = [];
  try {
    if (isAdmin) users = (await api('GET', '/api/users')).users;
    if (canWrite) audit = (await api('GET', '/api/audit?limit=50')).audit;
  } catch (e) { toast(errText(e)); }
  const titleById = Object.fromEntries(remote.map((c) => [c.id, c.title]));
  const roleOptions = (cur) => ['admin', 'investigator', 'reader'].map((r) => `<option value="${r}" ${r === cur ? 'selected' : ''}>${t('sync.role.' + r)}</option>`).join('');

  body.insertAdjacentHTML('beforeend', `
    ${isAdmin ? `<div class="card">
      <h3>${t('sync.users')} <span class="muted">(${users.length})</span></h3>
      <table><thead><tr><th>${t('sync.name')}</th><th>${t('sync.email')}</th><th>${t('sync.roleLabel')}</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr class="${u.disabled ? 'muted' : ''}"><td>${escapeHtml(u.name)}${u.id === session.user.id ? ` <span class="tag">${t('sync.you')}</span>` : ''}${u.disabled ? ` <span class="tag warn">${t('sync.disabled')}</span>` : ''}</td><td>${escapeHtml(u.email)}</td>
          <td><select data-role="${escapeHtml(u.id)}" ${u.id === session.user.id ? 'disabled' : ''}>${roleOptions(u.role)}</select></td>
          <td class="nowrap">${u.id === session.user.id ? '' : `<button class="btn secondary small" data-toggle="${escapeHtml(u.id)}" data-disabled="${u.disabled ? 1 : 0}">${u.disabled ? t('sync.enable') : t('sync.disable')}</button>
            <button class="btn secondary small" data-reset="${escapeHtml(u.id)}">${t('sync.resetPassword')}</button>`}</td></tr>`).join('')}
      </tbody></table>
      <form id="userForm" class="form">
        <h4>${t('sync.addUser')}</h4>
        <p class="small muted">${t('sync.addUserHint')}</p>
        <div class="row">
          <label class="field"><span>${t('sync.name')}</span><input name="name" required maxlength="200"></label>
          <label class="field"><span>${t('sync.email')}</span><input name="email" type="email" required></label>
          <label class="field"><span>${t('sync.tempPassword')}</span><input name="password" required minlength="8" autocomplete="new-password"></label>
          <label class="field"><span>${t('sync.roleLabel')}</span><select name="role">${roleOptions('investigator')}</select></label>
        </div>
        <div class="btn-row"><button class="btn secondary" type="submit">${t('sync.addUser')}</button></div>
      </form>
    </div>` : ''}
    ${canWrite ? `<div class="card">
      <details><summary><strong>${t('sync.audit')}</strong> <span class="muted small">(${audit.length})</span></summary>
      ${audit.length ? `<table class="small"><thead><tr><th>${t('sync.when')}</th><th>${t('sync.who')}</th><th>${t('sync.action')}</th><th>${t('registry.occurrence')}</th></tr></thead><tbody>
        ${audit.map((a) => `<tr><td class="nowrap">${escapeHtml(fmtDateTime(a.at))}</td><td>${escapeHtml(a.userName || '—')}</td><td>${t('sync.act.' + a.action) === 'sync.act.' + a.action ? escapeHtml(a.action) : t('sync.act.' + a.action)}${a.details && a.details.version ? ` · v${Number(a.details.version) || ''}` : ''}</td>
          <td>${a.caseId ? escapeHtml(titleById[a.caseId] || a.caseId) : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="muted small">${t('sync.auditEmpty')}</p>`}
      </details>
    </div>` : ''}
    <form id="pwdForm" class="card form">
      <h3>${t('sync.changePassword')}</h3>
      <div class="row">
        <label class="field"><span>${t('sync.currentPassword')}</span><input name="current" type="password" required autocomplete="current-password"></label>
        <label class="field"><span>${t('sync.newPassword')}</span><input name="next" type="password" required minlength="8" autocomplete="new-password"></label>
      </div>
      <div class="btn-row"><button class="btn secondary" type="submit">${t('sync.changePassword')}</button></div>
    </form>`);

  const call = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); render(view); } catch (e) { toast(errText(e)); } };
  body.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', () => call(() => api('PATCH', '/api/users/' + encodeURIComponent(s.dataset.role), { role: s.value }), t('toast.saved'))));
  body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => call(() => api('PATCH', '/api/users/' + encodeURIComponent(b.dataset.toggle), { disabled: b.dataset.disabled !== '1' }), t('toast.saved'))));
  body.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => {
    const p = prompt(t('sync.resetPrompt'));
    if (p === null) return;
    call(() => api('PATCH', '/api/users/' + encodeURIComponent(b.dataset.reset), { password: p }), t('sync.passwordChanged'));
  }));
  const uf = body.querySelector('#userForm');
  if (uf) uf.addEventListener('submit', (e) => { e.preventDefault(); call(() => api('POST', '/api/users', formValues(uf)), t('sync.userAdded')); });
  body.querySelector('#pwdForm').addEventListener('submit', (e) => { e.preventDefault(); call(() => api('POST', '/api/auth/password', formValues(e.target)), t('sync.passwordChanged')); });

  const exp = body.querySelector('#orgExport');
  if (exp) exp.addEventListener('click', async () => {
    exp.disabled = true;
    try {
      const data = await api('GET', '/api/export');
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `soam-${session.org.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(t('sync.orgExported', { n: data.cases.length }));
    } catch (e) { toast(errText(e)); }
    finally { exp.disabled = false; render(view); } // журнал действий получит запись о копии
  });

  const imp = body.querySelector('#orgImport');
  if (imp) imp.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast(t('sync.err.format')); return; }
    if (!data || data.format !== 'soam-investigator/organisation' || !Array.isArray(data.cases)) { toast(t('sync.err.format')); return; }
    if (!confirm(t('sync.orgImportConfirm', { n: data.cases.length, org: data.organisation ? data.organisation.name : '—' }))) return;
    try {
      const r = await api('POST', '/api/import', data);
      toast(t('sync.orgImported', { imported: r.imported, updated: r.updated, skipped: r.skipped, errors: r.errors.length }), 6000);
    } catch (err) { toast(errText(err)); }
    render(view);
  });

  body.querySelector('#logout').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } catch { /* сессия всё равно забывается */ }
    setSession({ url: session.url }); render(view);
  });
  body.querySelectorAll('[data-pull]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; await pullOccurrence(store, b.dataset.pull); render(view); }));
  body.querySelectorAll('[data-push]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; await pushOccurrence(store, b.dataset.push); render(view); }));
}
