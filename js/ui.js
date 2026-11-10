// Small DOM helpers shared by views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/** Disables the button while `fn` runs; shows errors in `errEl` (or a toast). */
export async function busy(btn, fn, errEl) {
  if (btn.disabled) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.classList.add('loading');
  if (errEl) errEl.textContent = '';
  try { return await fn(); }
  catch (e) {
    const { errorText } = await import('./fb.js');
    console.error(e);
    if (errEl) errEl.textContent = errorText(e); else toast(errorText(e), 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = label;
  }
}

/** Random invite code like "K4F9-QX2M" (no look-alike characters). */
export function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map(b => abc[b % abc.length]).join('');
  return s.slice(0, 4) + '-' + s.slice(4);
}
