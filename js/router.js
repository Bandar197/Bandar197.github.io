// History-API router. GitHub Pages serves 404.html (a copy of index.html) for deep links like /u/name.
const routes = [];
let current = null, cleanup = null;
export function route(pattern, load, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ re, keys, load, opts });
}
export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  return render();
}
export function currentPath() { return location.pathname; }
let guard = null;
export function setGuard(fn) { guard = fn; }
export async function render() {
  const path = location.pathname;
  const r = routes.find((x) => x.re.test(path)) || routes.find((x) => x.opts.notFound);
  const m = path.match(r.re) || [];
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] || '')]));
  if (guard) { const redirect = await guard(r.opts, path); if (redirect && redirect !== path) return navigate(redirect, { replace: true }); }
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  current = { path, params, opts: r.opts };
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading" role="status"><div class="spinner"></div><span>لحظة…</span></div>';
  document.body.classList.toggle('ingame', !!r.opts.fullscreen);
  for (const a of document.querySelectorAll('#nav a')) a.setAttribute('aria-current', a.getAttribute('href') === path || (a.getAttribute('href') !== '/' && path.startsWith(a.getAttribute('href'))) ? 'page' : 'false');
  try {
    const mod = await r.load();
    if (current.path !== path) return;
    cleanup = await mod.render(main, params);
  } catch (e) {
    console.error(e);
    main.innerHTML = '<div class="empty"><div class="art">⚠️</div><b>تعذّر فتح الصفحة.</b><span>تأكد من الاتصال وحدّث الصفحة.</span><button class="btn" onclick="location.reload()">تحديث</button></div>';
  }
  if (!r.opts.fullscreen) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http')) return;
  e.preventDefault();
  if (href !== location.pathname + location.search) navigate(href);
});
window.addEventListener('popstate', () => render());
