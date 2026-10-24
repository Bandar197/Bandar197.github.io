// Small UI toolkit: DOM building, escaping, toasts, dialogs, avatars, ranks, formatting.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v && v.__raw) out += v.__raw;
      else if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.__raw : esc(x))).join('');
      else out += esc(v ?? '');
    }
  });
  return { __raw: out, toString() { return out; } };
}
export const raw = (s) => ({ __raw: String(s ?? '') });
export function mount(el, tpl) { el.innerHTML = tpl && tpl.__raw !== undefined ? tpl.__raw : String(tpl); return el; }

export function toast(text, { error = false, action, ms = 4200 } = {}) {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' err' : '');
  t.setAttribute('role', error ? 'alert' : 'status');
  const span = document.createElement('span'); span.className = 't'; span.textContent = text; t.appendChild(span);
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.run(); t.remove(); }; t.appendChild(b); }
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
export const toastErr = (e) => toast(e && e.message ? e.message : String(e), { error: true });

/** Modal dialog using <dialog>. Returns {el, close, done(promise)}. */
export function dialog(contentTpl, { dismiss = true, label = '' } = {}) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  if (label) d.setAttribute('aria-label', label);
  mount(d, contentTpl);
  document.body.appendChild(d);
  let resolve; const done = new Promise((r) => (resolve = r));
  const close = (v) => { if (d.open) d.close(); d.remove(); resolve(v); };
  d.addEventListener('cancel', (e) => { if (!dismiss) e.preventDefault(); else close(null); });
  d.addEventListener('click', (e) => { if (e.target === d && dismiss) close(null); const c = e.target.closest('[data-close]'); if (c) close(c.dataset.close || null); });
  d.showModal();
  const f = d.querySelector('[autofocus], input, button.primary, button');
  if (f) f.focus();
  return { el: d, close, done };
}
export async function confirmBox(title, body, { ok = 'تأكيد', danger = false } = {}) {
  const d = dialog(html`<h2>${title}</h2><p>${body}</p><div class="actions"><button class="btn" data-close="no">إلغاء</button><button class="btn ${danger ? 'danger' : 'primary'}" data-close="yes">${ok}</button></div>`);
  return (await d.done) === 'yes';
}
/** Runs an async action while showing a busy state on a button; maps errors to toasts. */
export async function busy(btn, fn) {
  if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
  try { return await fn(); } catch (e) { toastErr(e); return undefined; }
  finally { if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; } }
}

/* ---------- people ---------- */
export function avatar(p, size = 48, { online = false } = {}) {
  const name = (p && (p.display_name || p.username)) || '؟';
  const initial = name.replace(/^(أبو|ابو)\s+/, '').trim().charAt(0) || '؟';
  const img = p && p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" decoding="async">` : esc(initial);
  return raw(`<span class="avatar" style="--av:${size}px" data-frame="${esc((p && p.frame) || 'none')}">${img}${online ? '<span class="on" title="متصل"></span>' : ''}</span>`);
}
export function personLink(p, { sub = '', size = 44 } = {}) {
  if (!p) return raw('');
  return html`<a class="who" href="/u/${encodeURIComponent(p.username)}" data-link>${avatar(p, size, { online: p.online === true })}<span class="names"><b>${p.display_name || p.username}</b><span>${sub || '@' + p.username}</span></span></a>`;
}
/** Competitive tiers derived from rating (shown everywhere, computed the same way on every device). */
export const TIERS = [
  { min: 0, name: 'مبتدئ', icon: '🪵' }, { min: 900, name: 'برونزي', icon: '🥉' }, { min: 1050, name: 'فضي', icon: '🥈' },
  { min: 1200, name: 'ذهبي', icon: '🥇' }, { min: 1350, name: 'ماسي', icon: '💎' }, { min: 1500, name: 'أسطورة', icon: '👑' },
];
export function tier(rating) { let t = TIERS[0]; for (const x of TIERS) if ((rating ?? 0) >= x.min) t = x; return t; }
export function rankBadge(rating) { const t = tier(rating); return raw(`<span class="rank" title="التصنيف ${esc(rating)}">${t.icon} ${esc(t.name)} · <span class="num">${esc(rating)}</span></span>`); }
/** XP needed to reach level n: 100·n(n−1)/2 (published in the help section). */
export const xpForLevel = (n) => 50 * n * (n - 1);
export function levelProgress(xp, level) { const a = xpForLevel(level), b = xpForLevel(level + 1); return { pct: Math.max(0, Math.min(100, ((xp - a) / (b - a)) * 100)), next: b - xp }; }

/* ---------- formatting ---------- */
const nf = new Intl.NumberFormat('ar-SA');
export const n = (x) => nf.format(x ?? 0);
export function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'الآن';
  if (s < 3600) return `قبل ${n(Math.floor(s / 60))} دقيقة`;
  if (s < 86400) return `قبل ${n(Math.floor(s / 3600))} ساعة`;
  return new Date(ts).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
}
export const date = (ts) => (ts ? new Date(ts).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
export function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); }

/* ---------- settings kept on this device ---------- */
const KEY = 'diwaniya.prefs';
export const prefs = (() => { try { return { sound: true, volume: 0.7, speed: 'normal', fourColor: false, reduceMotion: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { sound: true, volume: 0.7, speed: 'normal', fourColor: false, reduceMotion: false }; } })();
export function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } applyPrefs(); }
export function applyPrefs() {
  document.body.classList.toggle('fourcolor', !!prefs.fourColor);
  document.body.classList.toggle('reduce-motion', !!prefs.reduceMotion);
}
export const reducedMotion = () => prefs.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
