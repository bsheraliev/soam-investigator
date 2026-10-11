// «Настройки»: брендирование отчёта — название организации и логотип (хранятся в этом браузере, в копии дел не входят).
import { t } from '../i18n.js';
import { escapeHtml, toast, fmtSize } from '../ui.js';

const KEY = 'soam.branding';
export const LOGO_LIMIT = 200 * 1024;

export function getBranding() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function setBranding(b) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); return true; } catch { return false; }
}

/** Шапка отчёта (HTML): логотип и название организации, если заданы. */
export function brandingHtml() {
  const b = getBranding();
  if (!b.org && !b.logo) return '';
  return `<div class="rep-brand">${b.logo ? `<img src="${escapeHtml(b.logo)}" alt="" class="rep-logo">` : ''}${b.org ? `<div class="rep-org">${escapeHtml(b.org)}</div>` : ''}</div>`;
}

export async function render(view) {
  const b = getBranding();
  view.innerHTML = `
    <h1>${t('settings.title')}</h1>
    <p class="lead">${t('settings.lead')}</p>
    <form id="brandForm" class="card form">
      <h3>${t('settings.branding')}</h3>
      <label class="field"><span>${t('settings.org')}</span><input name="org" maxlength="200" value="${escapeHtml(b.org || '')}" placeholder="${t('settings.orgPlaceholder')}"></label>
      <label class="field"><span>${t('settings.logo')} <span class="muted small">(${t('settings.logoLimit', { kb: LOGO_LIMIT / 1024 })})</span></span>
        <input type="file" name="logo" accept="image/png,image/jpeg"></label>
      <div id="logoPreview">${b.logo ? `<img src="${escapeHtml(b.logo)}" alt="" class="rep-logo"> <button type="button" class="link danger" id="logoRemove">${t('settings.logoRemove')}</button>` : `<p class="muted small">${t('settings.noLogo')}</p>`}</div>
      <p class="small muted">${t('settings.hint')}</p>
      <div class="btn-row"><button class="btn" type="submit">${t('btn.save')}</button></div>
    </form>`;
  const form = view.querySelector('#brandForm');
  let logo = b.logo || null;
  form.querySelector('input[name=logo]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > LOGO_LIMIT) { toast(t('settings.logoTooBig', { size: fmtSize(file.size) })); e.target.value = ''; return; }
    logo = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
    view.querySelector('#logoPreview').innerHTML = `<img src="${escapeHtml(logo)}" alt="" class="rep-logo">`;
  });
  const rm = view.querySelector('#logoRemove');
  if (rm) rm.addEventListener('click', () => { logo = null; view.querySelector('#logoPreview').innerHTML = `<p class="muted small">${t('settings.noLogo')}</p>`; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = setBranding({ org: form.org.value.trim(), logo });
    toast(ok ? t('toast.saved') : t('settings.saveFailed'));
    if (ok) render(view);
  });
}
