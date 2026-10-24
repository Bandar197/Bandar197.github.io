// Boot: session handling, route guards, heartbeat, live notifications, shell.
import { sb, auth, rpc, game, channel, removeChannel, select } from './api.js';
import { route, render, navigate, setGuard } from './router.js';
import { state, setState, onState } from './state.js';
import { $, html, mount, avatar, toast, applyPrefs } from './ui.js';

applyPrefs();

/* ---------- routes (each view exports render(main, params) → optional cleanup) ---------- */
const V = (name) => () => import(`./views/${name}.js`);
route('/', V('home'));
route('/login', V('auth'), { public: true, guestOnly: true, bare: true });
route('/signup', V('auth'), { public: true, guestOnly: true, bare: true });
route('/forgot', V('auth'), { public: true, bare: true });
route('/reset', V('auth'), { public: true, bare: true, allowNoProfile: true });
route('/welcome', V('onboarding'), { allowNoProfile: true, bare: true });
route('/play', V('play'));
route('/room/:code', V('room'), { fullscreen: true });
route('/u/:username', V('profile'), { public: true });
route('/me', V('profile'));
route('/settings', V('settings'));
route('/friends', V('friends'));
route('/leaderboard', V('leaderboard'));
route('/notifications', V('notifications'));
route('/training', V('training'), { public: true });
route('/training/:mode', V('training'), { public: true, fullscreen: true });
route('/match/:id', V('match'));
route('/rules', V('rules'), { public: true });
route('/admin', V('admin'));
route('/404', V('notfound'), { public: true, notFound: true });

/* ---------- session ---------- */
let notifCh = null, beat = null;
async function loadProfile() {
  const s = await auth.session();
  if (!s) { setState({ session: null, user: null, profile: null, role: null, unread: 0 }); stopLive(); return; }
  const p = await select('profiles', (q) => q.select('*').eq('id', s.user.id).maybeSingle()).catch(() => null);
  setState({ session: s, user: s.user, profile: p || null });
  if (p) { startLive(); game('bootstrap').then((r) => setState({ role: r && r.role })).catch(() => {}); }
}
function startLive() {
  if (beat) return;
  const tick = async () => {
    try {
      const r = await rpc('touch');
      setState({ unread: r.unread, banned: r.banned ? { until: r.ban_until, reason: r.ban_reason } : null, role: r.staff || state.role });
    } catch { /* offline */ }
  };
  tick(); beat = setInterval(tick, 30_000);
  notifCh = channel('n:' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + state.user.id }, (p) => onNotification(p.new))
    .subscribe();
}
function stopLive() { clearInterval(beat); beat = null; if (notifCh) { removeChannel(notifCh); notifCh = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.profile) rpc('touch').catch(() => {}); });

function onNotification(n) {
  setState({ unread: state.unread + 1 });
  const d = n.data || {}, from = d.from ? d.from.display_name || d.from.username : '';
  if (n.kind === 'friend_request') toast(`${from} أرسل لك طلب صداقة`, { action: { label: 'عرض', run: () => navigate('/friends') } });
  else if (n.kind === 'friend_accepted') toast(`${from} قبل طلب صداقتك 🤝`);
  else if (n.kind === 'room_invite') toast(`${from} يدعوك لطاولة`, { action: { label: 'ادخل', run: () => navigate('/room/' + d.code) }, ms: 9000 });
  else if (n.kind === 'match_found') { toast('لقينا لك مباراة! جاري الدخول…'); navigate('/room/' + d.code); }
  else if (n.kind === 'achievement') toast(`${d.icon || '🏅'} إنجاز جديد: ${d.name} (+${d.xp} خبرة)`);
  else if (n.kind === 'challenge') toast(`✅ أنجزت التحدي: ${d.title} (+${d.xp} خبرة)`);
}

/* ---------- guard ---------- */
setGuard(async (opts, path) => {
  if (!sb) return null;
  if (state.session === null && !opts.public) return '/login?next=' + encodeURIComponent(path);
  if (state.session && opts.guestOnly) return state.profile ? '/' : '/welcome';
  if (state.session && !state.profile && !opts.allowNoProfile && !opts.public) return '/welcome';
  if (path === '/me' && state.profile) return '/u/' + encodeURIComponent(state.profile.username);
  return null;
});

/* ---------- shell ---------- */
function renderShell() {
  const show = !!(state.session && state.profile);
  $('#topbar').hidden = !show; $('#nav').hidden = !show;
  if (state.profile) mount($('#meLink'), html`${avatar(state.profile, 40)}`);
  $('#bellDot').hidden = !state.unread; $('#bellDot').textContent = state.unread > 9 ? '9+' : String(state.unread || '');
}
onState(renderShell);
window.addEventListener('offline', () => { $('#netbar').hidden = false; });
window.addEventListener('online', () => { $('#netbar').hidden = true; if (state.profile) rpc('touch').catch(() => {}); });

/* ---------- boot ---------- */
(async () => {
  if (!sb) { mount($('#main'), html`<div class="empty"><div class="art">⚠️</div><b>تعذّر تحميل خدمات الموقع.</b><span>تأكد من الاتصال وحدّث الصفحة.</span></div>`); return; }
  // GitHub Pages deep links arrive through 404.html with the real path intact.
  await loadProfile();
  auth.onChange(async (ev) => {
    if (ev === 'PASSWORD_RECOVERY') { navigate('/reset', { replace: true }); return; }
    if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') {
      const had = !!state.session;
      await loadProfile();
      if (ev === 'SIGNED_OUT' && had) navigate('/login', { replace: true });
    }
  });
  renderShell();
  await render();
})();

export { loadProfile };
