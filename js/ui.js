export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dateStr(new Date());
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
export const fmtLong = s => parseDate(s).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtShort = s => parseDate(s).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

export function num(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Wyszukiwanie bez polskich znaków i wielkości liter
export const norm = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');

let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), kind === 'err' ? 6000 : 3000);
}

let onCloseCb = null;
export function onSheetClose(cb) { onCloseCb = cb; }

export function openSheet(html) {
  if (onCloseCb) { const c = onCloseCb; onCloseCb = null; c(); }
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <button class="sheet-close" aria-label="Zamknij">✕</button>${html}</div>`;
  root.classList.add('open');
  document.body.classList.add('noscroll');
  $('.sheet-backdrop', root).onclick = closeSheet;
  $('.sheet-close', root).onclick = closeSheet;
  return $('.sheet', root);
}

export function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.classList.remove('noscroll');
  if (onCloseCb) { const c = onCloseCb; onCloseCb = null; c(); }
}
