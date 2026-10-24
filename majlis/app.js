// Baloot Majlis — web client.
import * as E from './engine.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

/* ================= constants ================= */
const SUITS = ['S', 'H', 'C', 'D'];
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'شريا', H: 'هاص', D: 'ديمن', C: 'سبيت' };
const RED = (s) => s === 'H' || s === 'D';
const RLABEL = (r) => (r === 'T' ? '10' : r);
const RNAME = { 7: 'سبعة', 8: 'ثمانية', 9: 'تسعة', T: 'عشرة', J: 'ولد', Q: 'بنت', K: 'شايب', A: 'إكة' };
const ORD_N = ['7', '8', '9', 'J', 'Q', 'K', 'T', 'A'], ORD_T = ['7', '8', 'Q', 'K', 'T', 'A', '9', 'J'];
const BOT_NAMES = ['سلطان', 'أبو سعد', 'فهد', 'مشعل'];
const PROJ_NAME = { sira: 'سرا', 50: 'خمسين', 100: 'مية', 400: 'أربعمية' };
const QUICK = ['هلا والله', 'يعطيك العافية', 'ركّز يا خوي', 'لعبة حلوة', 'وش ذا؟!', '😂', '👏', '🔥'];
const SPEED = { slow: 1.5, normal: 1, fast: 0.5 };
const team = (p) => p % 2, partner = (p) => (p + 2) % 4;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emailFor = (u) => 'p_' + [...new TextEncoder().encode(u.toLowerCase())].map((b) => b.toString(16).padStart(2, '0')).join('') + '@players.baloot-majlis.app';

/* ================= settings ================= */
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ? { ...d, ...v } : { ...d }; } catch { return { ...d }; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
const settings = load('bm.settings', { speed: 'normal', sound: true, counter: false, level: 'mid', target: 152 });

/* ================= backend API ================= */
function makeApi(sb) {
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(u, p) {
      const { error } = await sb.auth.signInWithPassword({ email: emailFor(u.trim()), password: p });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'اسم المستخدم أو كلمة المرور غلط' : 'ما قدرنا ندخلك، جرّب مرة ثانية');
    },
    async signUp(u, p) { await this.game({ action: 'signup', username: u.trim(), password: p }); await this.signIn(u, p); },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const { data: { user } } = await sb.auth.getUser(); if (!user) return null;
      const { data } = await sb.from('profiles').select('id,username,rating,games,wins,kaboots').eq('id', user.id).single();
      return data;
    },
    async game(body) {
      const { data, error } = await sb.functions.invoke('game', { body });
      if (error) {
        let msg = 'صار خطأ، جرّب مرة ثانية';
        try { const j = await error.context.json(); if (j.error) msg = j.error; } catch { /* not json */ }
        throw new Error(msg);
      }
      return data;
    },
    async getTable(id) { const { data } = await sb.from('game_tables').select('id,code,host,is_private,status,seats,target,level,state,version').eq('id', id).maybeSingle(); return data; },
    async getHand(id) { const { data } = await sb.from('hands').select('seat,cards,user_id').eq('table_id', id); return (data && data[0]) || null; },
    subscribe(id, h) {
      const ch = sb.channel('t:' + id)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_tables', filter: 'id=eq.' + id }, (p) => h.onTable(p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hands', filter: 'table_id=eq.' + id }, (p) => h.onHand(p.new))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'table_id=eq.' + id }, (p) => h.onMsg(p.new))
        .subscribe((st) => { if (st === 'SUBSCRIBED' && h.onReady) h.onReady(); });
      return () => sb.removeChannel(ch);
    },
    async listTables() {
      const since = new Date(Date.now() - 30 * 60e3).toISOString();
      const { data } = await sb.from('game_tables').select('id,code,host,status,seats,target,updated_at').eq('is_private', false)
        .in('status', ['waiting', 'playing']).gt('updated_at', since).order('updated_at', { ascending: false }).limit(30);
      return data || [];
    },
    async myTables(uid) {
      const since = new Date(Date.now() - 6 * 3600e3).toISOString();
      const { data } = await sb.from('game_tables').select('id,code,host,status,seats,target,updated_at').contains('members', [uid])
        .in('status', ['waiting', 'playing']).gt('updated_at', since).order('updated_at', { ascending: false }).limit(5);
      return data || [];
    },
    async ranks() { const { data } = await sb.from('profiles').select('id,username,rating,games,wins').order('rating', { ascending: false }).order('wins', { ascending: false }).limit(50); return data || []; },
    async matches() { const { data } = await sb.from('match_results').select('ended_at,team0,team1,score0,score1,rated').order('ended_at', { ascending: false }).limit(10); return data || []; },
    async messages(id) { const { data } = await sb.from('messages').select('id,user_id,username,body').eq('table_id', id).order('id', { ascending: false }).limit(40); return (data || []).reverse(); },
    async send(id, body, uid) { const { error } = await sb.from('messages').insert({ table_id: id, body, user_id: uid }); if (error) throw new Error('ما انرسلت الرسالة'); },
  };
}
const sb = window.supabase && SUPABASE_URL ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const api = window.__fakeApi || (sb ? makeApi(sb) : null);

/* ================= session state ================= */
let profile = null;          // my profile (online) or null (offline)
let myUid = null;            // profile id or 'local'
let row = null;              // current table row {id, code, host, status, seats, state, version, ...}
let hand = [];               // my cards
let local = null;            // offline game controller
let unsub = null, pollT = null;
let me = 0, spectating = true;
let lastSeq = 0, queue = [], pumping = false, sentReq = 0, lastTick = 0;
let msgs = [], unread = 0;
const isOnline = () => !!row && !local;

/* ================= small UI helpers ================= */
function screen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  document.body.classList.toggle('ingame', id === 'scrGame');
}
let gtT = null;
function gtoast(msg, ms = 2200) { const t = $('#gtoast'); t.textContent = msg; t.classList.add('show'); clearTimeout(gtT); gtT = setTimeout(() => t.classList.remove('show'), ms); }
let toastT = null;
function toast(html, ms = 1700) { const t = $('#toast'); t.innerHTML = html; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms * SPEED[settings.speed]); }
let autoModal = null;
function openModal(html, { dismiss = true, key = null } = {}) { $('#modal').innerHTML = html; $('#overlay').hidden = false; $('#overlay').dataset.dismiss = dismiss ? '1' : ''; autoModal = key; }
function closeModal() { $('#overlay').hidden = true; $('#modal').innerHTML = ''; autoModal = null; }
$('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay' && $('#overlay').dataset.dismiss) closeModal(); });
$('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#overlay').hidden && $('#overlay').dataset.dismiss) closeModal();
  if ((e.key === 'h' || e.key === 'ه') && $('#overlay').hidden && !/INPUT|TEXTAREA/.test(e.target.tagName) && !$('#scrGame').hidden) hint();
});

function cardHTML(c, extra = '') {
  const r = c[0], s = c[1], face = 'JQK'.includes(r), L = RLABEL(r);
  return `<div class="card ${RED(s) ? 'red' : ''} ${face ? 'face' : ''} ${extra}" data-id="${c}"><span class="ix tl">${L}<i>${SYM[s]}</i></span>` +
    `<span class="pip">${face ? `<span>${L}</span>` : SYM[s]}</span><span class="ix br">${L}<i>${SYM[s]}</i></span></div>`;
}
function cardEl(c, cls = '') { const d = document.createElement('div'); d.innerHTML = cardHTML(c, cls); return d.firstChild; }
const cardName = (c) => `${RNAME[c[0]]} ${SNAME[c[1]]}`;

/* ================= sound ================= */
let actx = null;
function snd(kind) {
  if (!settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    if (kind === 'card') {
      const len = 0.07, buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      f.type = 'bandpass'; f.frequency.value = 1800; g.gain.value = 0.5; src.buffer = buf; src.connect(f).connect(g).connect(actx.destination); src.start(t);
      return;
    }
    const notes = { win: [523, 784], bid: [440], good: [523, 659, 784, 1047], bad: [392, 330, 262], proj: [659, 880], turn: [660, 990], msg: [880] }[kind] || [440];
    notes.forEach((fq, i) => {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = 'triangle'; o.frequency.value = fq;
      g.gain.setValueAtTime(0, t + i * 0.09); g.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.28);
      o.connect(g).connect(actx.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.3);
    });
  } catch { /* audio unavailable */ }
}

/* ================= auth screen ================= */
let authMode = 'login';
function showAuth() {
  screen('scrAuth');
  $('#authFan').innerHTML = ['AS', 'TH', 'KC', 'QD', 'JH'].map((c) => cardHTML(c)).join('');
  if (!api) { $('#authForm').hidden = true; $('#authTabs').hidden = true; $('#authErr').textContent = ''; }
}
$('#authTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  authMode = b.dataset.tab;
  for (const x of $('#authTabs').children) x.classList.toggle('on', x === b);
  $('#fPass2Wrap').hidden = authMode !== 'signup';
  $('#fPass').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
  $('#authGo').textContent = authMode === 'signup' ? 'أنشئ الحساب' : 'دخول';
  $('#authErr').textContent = '';
});
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = $('#fUser').value.trim(), p = $('#fPass').value;
  const err = $('#authErr'); err.textContent = '';
  if (authMode === 'signup') {
    if (!/^[A-Za-z0-9_ء-ي٠-٩]{3,14}$/u.test(u)) { err.textContent = 'اسم المستخدم من ٣ إلى ١٤ حرف أو رقم، بدون مسافات'; return; }
    if (p.length < 6) { err.textContent = 'كلمة المرور لازم ٦ أحرف على الأقل'; return; }
    if (p !== $('#fPass2').value) { err.textContent = 'كلمتا المرور مو متطابقتين'; return; }
  }
  const btn = $('#authGo'); btn.disabled = true;
  try {
    if (authMode === 'signup') await api.signUp(u, p); else await api.signIn(u, p);
    await enterLobby();
  } catch (x) { err.textContent = x.message; }
  btn.disabled = false;
});
$('#offlineBtn').addEventListener('click', () => { myUid = profile ? profile.id : 'local'; startLocal(); });

/* ================= lobby ================= */
let lobbyTab = 'tables', lobbyT = null;
async function enterLobby() {
  profile = await api.me();
  if (!profile) { showAuth(); return; }
  myUid = profile.id;
  screen('scrLobby');
  renderMe();
  const code = new URLSearchParams(location.search).get('t');
  if (code) { history.replaceState(null, '', location.pathname); joinByCode(code); return; }
  showLobbyTab(lobbyTab);
}
function renderMe() {
  $('#meChip').innerHTML = profile ? `<b>${esc(profile.username)}</b><span class="rating" title="التقييم">${profile.rating}</span>` : '<b>زائر</b>';
}
$('#logoutBtn').addEventListener('click', async () => { if (api) await api.signOut(); profile = null; myUid = null; clearInterval(lobbyT); showAuth(); });
$('#lobbyTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showLobbyTab(b.dataset.tab); });
function showLobbyTab(tab) {
  lobbyTab = tab;
  for (const x of $('#lobbyTabs').children) x.classList.toggle('on', x.dataset.tab === tab);
  $('#tabTables').hidden = tab !== 'tables'; $('#tabRanks').hidden = tab !== 'ranks'; $('#tabProfile').hidden = tab !== 'profile';
  clearInterval(lobbyT);
  if (tab === 'tables') { refreshTables(); lobbyT = setInterval(() => { if (!$('#scrLobby').hidden) refreshTables(); }, 6000); }
  if (tab === 'ranks') refreshRanks();
  if (tab === 'profile') refreshProfile();
}
const seatCount = (t) => t.seats.filter((s) => s && !s.bot).length;
const hostName = (t) => { const s = t.seats.find((x) => x && x.uid === t.host); return s ? s.name : 'لاعب'; };
async function refreshTables() {
  try {
    const [mine, list] = await Promise.all([api.myTables(myUid), api.listTables()]);
    const mineIds = new Set(mine.map((t) => t.id));
    $('#myTables').innerHTML = mine.length ? `<div class="list">${mine.map((t) => tableRow(t, true)).join('')}</div>` : '';
    const others = list.filter((t) => !mineIds.has(t.id));
    $('#tablesList').innerHTML = others.length ? others.map((t) => tableRow(t, false)).join('')
      : '<div class="empty">ما فيه طاولات مفتوحة الحين.<br>أنشئ طاولة جديدة وأرسل رابط الدعوة لأصحابك، أو العب ضد البوتات.</div>';
  } catch { /* offline for a moment */ }
}
function tableRow(t, mine) {
  const n = seatCount(t), live = t.status === 'playing';
  return `<div class="trow ${mine ? 'mine' : ''}"><div class="info"><b>${mine ? 'طاولتك · ' : ''}طاولة ${esc(hostName(t))}</b>
    <span>${n}/4 لاعبين · الصكة ${t.target} · <span class="pill ${live ? 'live' : ''}">${live ? 'اللعب شغّال' : 'بانتظار اللاعبين'}</span></span></div>
    <button class="bbtn ${mine ? 'main' : ''}" data-open="${t.id}">${mine ? 'ارجع' : live ? 'تفرّج / اجلس' : 'انضم'}</button></div>`;
}
$('#tabTables').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) joinById(b.dataset.open); });
async function refreshRanks() {
  const list = await api.ranks();
  $('#ranksTable').innerHTML = '<tr><th>#</th><th>اللاعب</th><th>التقييم</th><th>فوز</th><th>صكات</th></tr>' +
    (list.map((p, i) => `<tr class="${p.id === myUid ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.username)}</td><td>${p.rating}</td><td>${p.wins}</td><td>${p.games}</td></tr>`).join('') ||
      '<tr><td colspan="5" class="muted">ما فيه لاعبين للحين</td></tr>');
}
async function refreshProfile() {
  profile = (await api.me()) || profile; renderMe();
  const p = profile, rate = p.games ? Math.round((p.wins / p.games) * 100) : 0;
  const ms = await api.matches();
  $('#tabProfile').innerHTML = `<div class="stats"><div class="stat"><b>${p.rating}</b><span>التقييم</span></div><div class="stat"><b>${p.games}</b><span>صكات</span></div>
    <div class="stat"><b>${rate}%</b><span>نسبة الفوز</span></div><div class="stat"><b>${p.kaboots}</b><span>كبوت</span></div></div>
    <h3 style="font-family:var(--f-display);color:var(--brass);font-weight:500">آخر صكاتك</h3>
    <div class="tablewrap"><table class="grid"><tr><th>التاريخ</th><th>النتيجة</th><th>لنا</th><th>لهم</th><th>مصنّفة</th></tr>
    ${ms.map((m) => { const t0 = m.team0.includes(myUid), us = t0 ? m.score0 : m.score1, them = t0 ? m.score1 : m.score0;
      return `<tr><td>${new Date(m.ended_at).toLocaleDateString('ar-SA')}</td><td style="color:var(--${us > them ? 'us' : 'them'})">${us > them ? 'فوز' : 'خسارة'}</td><td>${us}</td><td>${them}</td><td>${m.rated ? 'نعم' : 'لا'}</td></tr>`; }).join('') ||
      '<tr><td colspan="5" class="muted">ما لعبت صكات للحين</td></tr>'}</table></div>
    <p class="muted">الصكة تحسب في التقييم لما يكون فيه لاعب حقيقي في كل فريق: الفوز +٢٥ والخسارة −١٥.</p>`;
}
$('#codeForm').addEventListener('submit', (e) => { e.preventDefault(); const c = $('#codeInp').value.trim(); if (c) joinByCode(c); });
$('#quickBotBtn').addEventListener('click', () => startLocal());
$('#newTableBtn').addEventListener('click', () => {
  const seg = (k, opts, v) => `<div class="seg" data-k="${k}">${opts.map(([x, l]) => `<button type="button" data-v="${x}" class="${String(v) === String(x) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const cfg = { private: false, target: settings.target, level: settings.level };
  openModal(`<h2>طاولة جديدة</h2>
    <div class="field"><span>نوع الطاولة</span>${seg('private', [[false, 'عامة'], [true, 'خاصة بالدعوة']], false)}</div>
    <div class="field"><span>نهاية الصكة</span>${seg('target', [[101, '101'], [152, '152'], [202, '202']], cfg.target)}</div>
    <div class="field"><span>مستوى البوتات</span>${seg('level', [['easy', 'سهل'], ['mid', 'متوسط'], ['hard', 'محترف']], cfg.level)}</div>
    <p class="muted">الكراسي الفاضية يلعبها بوت لين يجلس أحد مكانه.</p>
    <div class="actions"><button class="bbtn main" id="mCreate">أنشئ</button><button class="bbtn" data-close="1">إلغاء</button></div>`);
  for (const g of document.querySelectorAll('#modal .seg')) g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = g.dataset.k; let v = b.dataset.v; v = v === 'true' ? true : v === 'false' ? false : k === 'target' ? +v : v;
    cfg[k] = v; for (const x of g.children) x.classList.toggle('on', x === b);
  });
  $('#mCreate').onclick = async () => {
    $('#mCreate').disabled = true;
    settings.target = cfg.target; settings.level = cfg.level; save('bm.settings', settings);
    try { const r = await api.game({ action: 'create', ...cfg }); closeModal(); await openTable(r.id); }
    catch (x) { gtoast(x.message); $('#mCreate').disabled = false; }
  };
});
async function joinByCode(code) {
  try { const r = await api.game({ action: 'join', code }); await openTable(r.id); }
  catch (x) { gtoast(x.message); screen('scrLobby'); showLobbyTab('tables'); }
}
async function joinById(id) {
  try { await api.game({ action: 'join', id }); await openTable(id); } catch (x) { gtoast(x.message); }
}

/* ================= table session ================= */
async function openTable(id) {
  clearInterval(lobbyT);
  closeTable();
  local = null;
  const [r, h, m] = await Promise.all([api.getTable(id), api.getHand(id), api.messages(id)]);
  if (!r) { gtoast('ما لقينا الطاولة'); return; }
  msgs = m; unread = 0;
  hand = h && h.user_id === myUid ? h.cards : [];
  unsub = api.subscribe(id, {
    onTable: (n) => { if (row && n.id === row.id && n.version > row.version) setRow({ ...row, ...n }); },
    onHand: (n) => { if (n.user_id === myUid && row && n.table_id === row.id) { hand = n.cards || []; renderHand(); } },
    onMsg: (n) => onMessage(n),
    onReady: () => refreshRow(),
  });
  pollT = setInterval(() => refreshRow(), 8000);
  setRow(r, true);
}
function closeTable() {
  if (unsub) { try { unsub(); } catch { /* already closed */ } unsub = null; }
  clearInterval(pollT); pollT = null;
  row = null; queue = []; lastSeq = 0; pumping = false; sentReq = 0; hand = [];
  $('#trick').innerHTML = ''; clearBubbles(); closeModal();
}
let refreshing = false;
async function refreshRow() {
  if (local) { setRow(local.row()); return; }
  if (!row || refreshing) return;
  refreshing = true;
  try {
    const id = row.id;
    const [r, h] = await Promise.all([api.getTable(id), api.getHand(id)]);
    if (!row || row.id !== id) return;
    if (h && h.user_id === myUid) { hand = h.cards; }
    if (r && r.version > row.version) setRow(r); else renderHand();
  } catch { /* network hiccup */ } finally { refreshing = false; }
}
async function exitTable(leave) {
  if (leave && isOnline()) { try { await api.game({ action: 'leave', id: row.id }); } catch { /* ignore */ } }
  closeTable(); local = null;
  if (profile) { screen('scrLobby'); renderMe(); showLobbyTab('tables'); } else showAuth();
}

/* --- applying a new table row --- */
function setRow(r, fresh = false) {
  const prev = row;
  row = r;
  const seat = r.seats.findIndex((s) => s && !s.bot && s.uid === myUid);
  spectating = seat < 0; me = spectating ? 0 : seat;
  if (r.status === 'closed') { gtoast('انقفلت الطاولة'); exitTable(false); return; }
  if (r.status === 'waiting') { closeModal(); screen('scrRoom'); renderRoom(); return; }
  screen('scrGame');
  const pub = r.state; if (!pub) return;
  const newGame = fresh || !prev || prev.status === 'waiting' || pub.evSeq < lastSeq;
  if (newGame) {
    queue = []; $('#trick').innerHTML = ''; clearBubbles();
    if (fresh) { lastSeq = pub.evSeq; if (autoModal) closeModal(); }
    else { lastSeq = 0; closeModal(); }
  }
  for (const e of pub.ev || []) if (e[0] > lastSeq) { queue.push(e); lastSeq = e[0]; }
  if (!spectating && pub.counts && pub.counts[me] !== hand.length && !local) setTimeout(refreshRow, 300);
  if (local) hand = local.hand();
  renderStatic();
  if (fresh && pub.phase === 'roundEnd' && pub.summary) showSummary(pub.summary, true);
  else if (fresh && pub.over) showFinal();
  pump();
}

/* ================= offline game ================= */
function startLocal() {
  closeTable();
  const level = settings.level, target = settings.target;
  const G = E.newGame({ level, target });
  E.startRound(G);
  const isBot = (p) => p !== 0;
  E.runBots(G, isBot);
  let version = 1;
  const seats = [{ uid: myUid || 'local', name: profile ? profile.username : 'أنت' }, { bot: true }, { bot: true }, { bot: true }];
  myUid = myUid || 'local';
  local = {
    G,
    row: () => ({ id: 'local', code: '', host: myUid, status: G.over ? 'finished' : 'playing', seats, target, level, version,
      state: JSON.parse(JSON.stringify({ ...E.publicView(G), deadline: null })) }),
    hand: () => G.hands[0].slice(),
    act(kind, v) { E.act(G, kind === 'next' ? -1 : 0, kind, v); E.runBots(G, isBot); version++; },
  };
  msgs = []; unread = 0;
  setRow(local.row(), false);
}

/* ================= names ================= */
function NAME(p) {
  if (!row) return '';
  const s = row.seats[p];
  if (s && !s.bot) return s.uid === myUid ? 'أنت' : s.name;
  return BOT_NAMES[p];
}
const LNAME = (p) => (p === me && !spectating ? 'لك' : 'ل' + NAME(p));
const view = (p) => ((p - me) % 4 + 4) % 4;
const seatEl = (p) => document.querySelector(`.seat[data-v="${view(p)}"]`);
const mine = (t) => t === team(me);

/* G-shaped object for the engine helpers (legal moves, hints) */
function Gv() { const hands = [[], [], [], []]; if (!spectating) hands[me] = hand.slice(); return { ...row.state, hands }; }

/* ================= rendering ================= */
function renderStatic() {
  if (!row || !row.state) return;
  const p = row.state, U = team(me), O = 1 - U, tgt = p.target;
  $('#sUs').textContent = p.scores[U]; $('#sThem').textContent = p.scores[O];
  $('#bUs').style.width = Math.min(100, (p.scores[U] / tgt) * 100) + '%';
  $('#bThem').style.width = Math.min(100, (p.scores[O] / tgt) * 100) + '%';
  const ct = p.contract, chip = $('#contract');
  if (ct) {
    chip.className = 'chip' + (ct.type === 'hokm' && RED(ct.trump) ? ' red' : '');
    chip.innerHTML = (ct.type === 'sun' ? '<span class="s">☀</span> صن' : `<span class="s">${SYM[ct.trump]}</span> حكم ${SNAME[ct.trump]}`) +
      ` · ${ct.buyer === me && !spectating ? 'أنت المشتري' : 'المشتري: ' + esc(NAME(ct.buyer))}` + (ct.doubled ? ' <span class="x2">دبل ×2</span>' : '');
  } else { chip.className = 'chip'; chip.textContent = p.phase === 'bid' ? 'وقت الشراء' : 'بانتظار التوزيع'; }
  $('#abnat').textContent = ['play', 'roundEnd'].includes(p.phase) ? `الأبناط · لنا ${p.raw[U]} · لهم ${p.raw[O]}` : '';
  for (let s = 0; s < 4; s++) {
    const el = seatEl(s), st = row.seats[s], nm = NAME(s), isBot = !st || st.bot;
    el.querySelector('.pname').textContent = nm + (s === partner(me) && !spectating ? ' · خويك' : '') + (isBot && !local ? ' · بوت' : '');
    el.querySelector('.avatar span').textContent = s === me && !spectating ? 'أ' : (nm.replace(/^أبو\s/, '')[0] || '؟');
    el.classList.toggle('bot', isBot);
    const tags = [];
    if (p.dealer === s) tags.push('<span class="tag d">موزّع</span>');
    if (ct && ct.buyer === s) tags.push('<span class="tag">مشتري</span>');
    if (spectating && isBot && isOnline()) tags.push(`<button class="tag sit" data-sit="${s}">اجلس هنا</button>`);
    el.querySelector('.tags').innerHTML = tags.join('');
    const bk = el.querySelector('.backs'); if (bk) bk.innerHTML = '<div class="mini"></div>'.repeat(p.counts[s]);
  }
  $('#tLast').disabled = !p.lastTrick;
  $('#tCounter').classList.toggle('on', settings.counter);
  renderCounter();
  renderInteractive();
}
$('#table').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sit]'); if (!b || !row) return;
  try { await api.game({ action: 'join', id: row.id, seat: +b.dataset.sit }); refreshRow(); } catch (x) { toast(esc(x.message)); }
});
function myReq() {
  const q = row && row.state && row.state.req;
  if (!q || pumping || spectating || row.status !== 'playing' || q.p !== me || sentReq === q.id) return null;
  return q;
}
function renderInteractive() {
  if (!row || !row.state) return;
  const p = row.state;
  for (let s = 0; s < 4; s++) seatEl(s).classList.toggle('turn', !pumping && p.turn === s && p.phase !== 'roundEnd');
  const fl = $('#flip');
  fl.innerHTML = !pumping && p.flip && (p.phase === 'bid' || p.phase === 'double') ? `${cardHTML(p.flip)}<span class="lbl">الورقة المكشوفة</span>` : '';
  if (!pumping) reconcileTrick();
  renderPanel(); renderHand(); updateTimer();
  $('#tHint').disabled = !myReq() || !['card', 'bid'].includes(myReq().k);
}
function renderHand() {
  const h = $('#hand'); h.innerHTML = '';
  if (spectating || !row || !row.state) return;
  const q = myReq(), active = q && q.k === 'card';
  const G = Gv();
  const ok = active ? E.legal(G, me) : [];
  h.classList.toggle('active', !!active);
  const order = suitOrder(hand);
  const sorted = hand.slice().sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || E.rankPow(G, b) - E.rankPow(G, a));
  for (const c of sorted) {
    const can = ok.includes(c);
    const el = cardEl(c, (active ? (can ? 'ok' : 'no') : '') + (E.isTrump(G, c) ? ' trump' : ''));
    el.setAttribute('role', 'button'); el.tabIndex = can ? 0 : -1; el.setAttribute('aria-label', cardName(c));
    const go = () => { if (myReq() && myReq().k === 'card' && E.legal(Gv(), me).includes(c)) act('card', c); else if (active) toast('هذي الورقة ما تنلعب الحين', 1200); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    h.appendChild(el);
  }
}
function suitOrder(h) {
  const ct = row.state.contract, tr = ct && ct.type === 'hokm' ? ct.trump : null;
  const present = SUITS.filter((s) => h.some((c) => c[1] === s));
  const blacks = present.filter((s) => !RED(s)), reds = present.filter(RED);
  let order = [];
  while (blacks.length || reds.length) { if (blacks.length) order.push(blacks.shift()); if (reds.length) order.push(reds.shift()); }
  if (tr && order.includes(tr)) order = [tr, ...order.filter((s) => s !== tr)];
  return order;
}
let hintText = '';
function renderPanel() {
  const pn = $('#panel'), q = myReq();
  if (!q || (q.k !== 'bid' && q.k !== 'double')) { pn.hidden = true; pn.innerHTML = ''; hintText = ''; return; }
  pn.hidden = false;
  const p = row.state;
  if (q.k === 'double') {
    pn.innerHTML = `<h3>${esc(NAME(p.contract.buyer))} اشترى حكم ${SYM[p.contract.trump]} — تدبّل؟</h3><div class="row">
      <button class="bbtn main" data-v="1">دبل ×2</button><button class="bbtn" data-v="0">لا، كمّل</button></div>`;
    pn.querySelectorAll('button').forEach((b) => (b.onclick = () => act('double', b.dataset.v === '1')));
    return;
  }
  const { round, opts } = q.d, f = p.flip;
  let html = `<h3>${round === 1 ? 'الدور الأول' : 'الدور الثاني'} — وش تبي؟</h3><div class="row">`;
  if (opts.includes('hokm')) html += `<button class="bbtn main ${RED(f[1]) ? 'red' : ''}" data-t="hokm">حكم <span class="s">${SYM[f[1]]}</span></button>`;
  if (opts.includes('hokm2')) for (const s of SUITS) if (s !== f[1]) html += `<button class="bbtn ${RED(s) ? 'red' : ''}" data-t="hokm2" data-s="${s}">حكم <span class="s">${SYM[s]}</span></button>`;
  if (opts.includes('sun')) html += `<button class="bbtn main" data-t="sun">صن ☀</button>`;
  if (opts.includes('ashkal')) html += `<button class="bbtn" data-t="ashkal">أشكل</button>`;
  html += `<button class="bbtn" data-t="pass">بس</button></div>`;
  if (hintText) html += `<div class="tip">${hintText}</div>`;
  pn.innerHTML = html;
  pn.querySelectorAll('button').forEach((b) => (b.onclick = () => act('bid', b.dataset.s ? { t: b.dataset.t, s: b.dataset.s } : { t: b.dataset.t })));
}
function renderCounter() {
  const el = $('#counter'), p = row && row.state;
  if (!settings.counter || !p || !p.contract) { el.hidden = true; return; }
  el.hidden = false;
  const played = new Set(p.played), mineSet = new Set(spectating ? [] : hand);
  let html = '<div class="h">عداد الورق</div>';
  for (const s of SUITS) {
    const rs = (p.contract.type === 'hokm' && s === p.contract.trump ? ORD_T : ORD_N).slice().reverse();
    const left = rs.filter((r) => !played.has(r + s) && !mineSet.has(r + s)).length;
    html += `<div class="r"><span class="s ${RED(s) ? 'red' : ''}">${SYM[s]}</span>` + rs.map((r) => `<span class="c ${played.has(r + s) ? 'gone' : ''} ${mineSet.has(r + s) ? 'mine' : ''}">${RLABEL(r)}</span>`).join('') + `<span style="margin-inline-start:4px;color:var(--muted)">${left}</span></div>`;
  }
  el.innerHTML = html;
}
function updateTimer() {
  const tm = $('#timer');
  for (let s = 0; s < 4; s++) seatEl(s).classList.remove('timed');
  const p = row && row.state;
  if (!p || !p.deadline || pumping || !p.req || p.req.k === 'next' || row.status !== 'playing') { tm.hidden = true; return; }
  const left = p.deadline - Date.now(), total = 35000, frac = Math.max(0, Math.min(1, left / total));
  const el = seatEl(p.req.p); el.classList.add('timed');
  el.querySelector('.ring circle').style.strokeDashoffset = String(144.5 * (1 - frac));
  if (p.req.p === me && !spectating) { tm.hidden = false; tm.querySelector('i').style.width = frac * 100 + '%'; tm.classList.toggle('low', left < 8000); }
  else tm.hidden = true;
}
setInterval(() => {
  if (!row || !row.state || $('#scrGame').hidden) return;
  updateTimer();
  const p = row.state;
  if (isOnline() && row.status === 'playing' && p.deadline && Date.now() > p.deadline + 1500 && !pumping && Date.now() - lastTick > 5000) {
    lastTick = Date.now();
    api.game({ action: 'tick', id: row.id }).then(() => refreshRow()).catch(() => {});
  }
}, 1000);

/* trick animation */
function seatVec(p) { const tb = $('#table').getBoundingClientRect(); return [[0, tb.height * 0.5], [tb.width * 0.5, 0], [0, -tb.height * 0.5], [-tb.width * 0.5, 0]][view(p)]; }
function slotVec(p, cw, ch) { return [[0, ch * 0.36], [cw * 0.72, -ch * 0.04], [0, -ch * 0.44], [-cw * 0.72, -ch * 0.04]][view(p)]; }
const ROT = [-3, 6, 2, -6];
function placeTrickCard(p, c, animate) {
  const el = cardEl(c, E.isTrump(row.state, c) ? 'trump' : ''); el.dataset.p = p;
  $('#trick').appendChild(el);
  const [x, y] = slotVec(p, el.offsetWidth, el.offsetHeight);
  const to = `translate(-50%,-50%) translate(${x}px,${y}px) rotate(${ROT[view(p)]}deg)`;
  el.style.transform = to;
  if (animate && el.animate) {
    const [fx, fy] = seatVec(p);
    el.animate([{ transform: `translate(-50%,-50%) translate(${fx}px,${fy}px) scale(.7)`, opacity: 0.2 }, { transform: to, opacity: 1 }], { duration: 280 * SPEED[settings.speed], easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
}
function collectTrick(w) {
  const [wx, wy] = seatVec(w);
  for (const el of document.querySelectorAll('#trick .card:not(.going)')) {
    el.classList.add('going');
    if (!el.animate) { el.remove(); continue; }
    el.animate([{ transform: el.style.transform, opacity: 1 }, { transform: `translate(-50%,-50%) translate(${wx * 0.9}px,${wy * 0.9}px) scale(.45)`, opacity: 0 }],
      { duration: 420 * SPEED[settings.speed], easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove());
  }
}
function reconcileTrick() {
  const els = [...document.querySelectorAll('#trick .card:not(.going)')];
  const want = row.state.trick.map((t) => t.p + ':' + t.c).join(','), have = els.map((e) => e.dataset.p + ':' + e.dataset.id).join(',');
  if (want === have) return;
  els.forEach((e) => e.remove());
  for (const t of row.state.trick) placeTrickCard(t.p, t.c, false);
}
const bubbleT = {};
function bubble(p, text, ms = 1500, cls = '') {
  const v = view(p), b = seatEl(p).querySelector('.bubble');
  b.textContent = text; b.className = 'bubble show ' + cls; clearTimeout(bubbleT[v]);
  if (ms) bubbleT[v] = setTimeout(() => b.classList.remove('show'), ms * SPEED[settings.speed]);
}
function clearBubbles() { for (const b of document.querySelectorAll('.seat .bubble')) b.classList.remove('show'); }

/* ================= event playback ================= */
async function pump() {
  if (pumping) return;
  pumping = true; renderInteractive();
  try {
    while (queue.length && row) {
      const e = queue.shift();
      await playEvent(e);
    }
  } finally { pumping = false; }
  if (row && row.state) {
    renderStatic();
    const q = myReq(); if (q && q.k !== 'next') snd('turn');
  }
}
function pace(ms) { const fast = queue.length > 14 ? 0.2 : queue.length > 8 ? 0.5 : 1; return sleep(ms * SPEED[settings.speed] * fast); }
async function playEvent(e) {
  const [, k, ...a] = e;
  switch (k) {
    case 'deal': $('#trick').innerHTML = ''; clearBubbles(); toast(`التوزيع على ${a[0] === me && !spectating ? 'يدك' : esc(NAME(a[0]))}`, 1100); snd('card'); await pace(900); break;
    case 'bid': for (let s = 0; s < 4; s++) seatEl(s).classList.toggle('turn', s === a[0]); bubble(a[0], a[1], 0); snd(a[1] === 'بس' ? 'card' : 'bid'); await pace(a[0] === me ? 250 : 700); break;
    case 'r2': clearBubbles(); toast('الدور الثاني', 900); await pace(800); break;
    case 'redeal': clearBubbles(); toast('الكل قال بس — نعيد التوزيع'); await pace(1400); break;
    case 'contract': {
      const [type, tr, b, ak] = a; clearBubbles(); snd('bid');
      toast(type === 'sun' ? `${ak >= 0 ? esc(NAME(ak)) + ' أشكل · ' : ''}صن ${esc(LNAME(b))}` : `حكم ${SYM[tr]} ${SNAME[tr]} ${esc(LNAME(b))}`, 1500);
      await pace(1200); break;
    }
    case 'double': bubble(a[0], 'دبل!', 1600); snd('proj'); toast(`${esc(NAME(a[0]))} دبّل — النقاط ×٢`, 1500); await pace(1100); break;
    case 'play': $('#flip').innerHTML = ''; await pace(300); break;
    case 'card':
      for (let s = 0; s < 4; s++) seatEl(s).classList.toggle('turn', s === a[0]);
      placeTrickCard(a[0], a[1], true); snd('card'); await pace(a[0] === me ? 200 : 620); break;
    case 'projbub': bubble(a[0], a[1].map((t) => PROJ_NAME[t]).join(' + '), 1800, 'proj'); snd('proj'); break;
    case 'baloot': bubble(a[0], 'بلوت', 1600, 'proj'); snd('proj'); break;
    case 'trick': await pace(450); collectTrick(a[0]); snd(mine(team(a[0])) ? 'win' : 'card'); await pace(450); break;
    case 'proj': {
      const [w, list, pts, lost] = a;
      toast(`مشروع ${mine(w) ? 'لنا' : 'لهم'}: ${list.map((t) => PROJ_NAME[t]).join(' + ')} (+${pts})${lost ? `<br><small>انلغى مشروع ${mine(w) ? 'لهم' : 'لنا'}</small>` : ''}`, 2200);
      await pace(500); break;
    }
    case 'summary': await showSummary(a[0] || row.state.summary); break;
    case 'join': toast(`${esc(NAME(a[0]))} جلس على الطاولة`); break;
    case 'back': toast(`${esc(NAME(a[0]))} رجع للطاولة`); break;
    case 'left': toast(`لاعب طلع — ${esc(BOT_NAMES[a[0]])} (بوت) يكمل بداله`, 2200); break;
    case 'afk': toast(`${esc(NAME(a[0]))} تأخر — البوت لعب عنه`); break;
  }
}

/* ================= round summary & game over ================= */
const noteText = (n) => (n === 0 ? 'المشتري كسب' : n === 1 ? 'المشتري خسر — الأرض كلها للخصم' : `كبوت ${mine(n - 2) ? 'لنا' : 'لهم'}!`);
const typeText = (tc) => (tc === 's' ? 'صن' : `حكم ${SYM[tc[1]]}`);
let summaryDone = null;
async function showSummary(sm, standalone = false) {
  if (!sm) return;
  const U = team(me), O = 1 - U, good = sm.fin[U] >= sm.fin[O];
  snd(good ? 'good' : 'bad');
  const prRow = (tm) => (sm.pr[tm].length ? sm.pr[tm].map((t) => PROJ_NAME[t]).join(' + ') + (sm.pw === tm ? '' : ' (ملغي)') : '—');
  const sc = row.state.scores;
  openModal(`<h2>نهاية التوزيعة ${sm.n}</h2>
    <div class="verdict ${good ? 'win' : 'lose'}">${noteText(sm.note)}</div>
    <p class="muted" style="text-align:center">${sm.tc === 's' ? 'صن' : `حكم ${SYM[sm.tc[1]]} ${SNAME[sm.tc[1]]}`} · المشتري ${esc(NAME(sm.b))}${sm.d ? ' · مدبّل ×٢' : ''}</p>
    <table><tr><th></th><th>لنا</th><th>لهم</th></tr>
      <tr><td>الأكلات</td><td>${sm.tk[U]}</td><td>${sm.tk[O]}</td></tr>
      <tr><td>الأبناط</td><td>${sm.raw[U]}</td><td>${sm.raw[O]}</td></tr>
      <tr><td>نقاط الأكل</td><td>${sm.tp[U]}</td><td>${sm.tp[O]}</td></tr>
      <tr><td>المشاريع</td><td>${prRow(U)}</td><td>${prRow(O)}</td></tr>
      ${sm.bal >= 0 ? `<tr><td>بلوت</td><td>${sm.bal === U ? '+2' : '—'}</td><td>${sm.bal === O ? '+2' : '—'}</td></tr>` : ''}
      <tr><td><b>حصيلة التوزيعة</b></td><td><b style="color:var(--us)">+${sm.fin[U]}</b></td><td><b style="color:var(--them)">+${sm.fin[O]}</b></td></tr>
    </table>
    <div class="bigscore"><div class="us"><small>لنا</small><b>${sc[U]}</b></div><div class="them"><small>لهم</small><b>${sc[O]}</b></div></div>
    <div class="actions"><button class="bbtn main" id="mNext">${sm.done ? 'النتيجة النهائية' : 'التوزيعة الجاية'}</button></div>`, { dismiss: false, key: 'summary' });
  const started = Date.now();
  let clicked = false;
  $('#mNext').onclick = () => { clicked = true; };
  if (standalone) { await waitFor(() => clicked || autoModal !== 'summary'); afterSummary(sm, clicked); return; }
  await waitFor(() => clicked || autoModal !== 'summary' || (queue.length > 0 && Date.now() - started > 5000) || (row && row.state.phase !== 'roundEnd' && Date.now() - started > 5000));
  afterSummary(sm, clicked);
}
async function waitFor(fn) { while (!fn()) await sleep(250); }
function afterSummary(sm, clicked) {
  if (autoModal === 'summary') closeModal();
  if (sm.done || (row && row.state.over)) { showFinal(); return; }
  if (clicked && row && row.state.req && row.state.req.k === 'next') act('next', true);
}
function showFinal() {
  if (!row) return;
  const sc = row.state.scores, U = team(me), O = 1 - U, won = sc[U] > sc[O];
  const host = local || row.host === myUid;
  openModal(`<h2>${spectating ? 'انتهت الصكة' : won ? 'مبروك! كسبتوا الصكة' : 'خسرتوا الصكة'}</h2>
    <div class="bigscore"><div class="us"><small>لنا</small><b>${sc[U]}</b></div><div class="them"><small>لهم</small><b>${sc[O]}</b></div></div>
    <p class="muted" style="text-align:center">${local ? 'صكة تدريب ضد البوتات' : 'انحفظت النتيجة في ملفك'}</p>
    <div class="actions">${host ? '<button class="bbtn main" id="mAgain">صكة جديدة</button>' : '<span class="muted">بانتظار المضيف يبدأ صكة جديدة…</span>'}
    <button class="bbtn" id="mLog2">السجل</button><button class="bbtn" id="mOut">رجوع للوبي</button></div>`, { dismiss: false, key: 'final' });
  if ($('#mAgain')) $('#mAgain').onclick = async () => {
    closeModal();
    if (local) { startLocal(); return; }
    try { await api.game({ action: 'start', id: row.id }); refreshRow(); } catch (x) { gtoast(x.message); }
  };
  $('#mLog2').onclick = () => showLog(true);
  $('#mOut').onclick = () => exitTable(!local);
}

/* ================= actions ================= */
async function act(kind, v) {
  const q = row.state.req;
  sentReq = q ? q.id : 0;
  hintText = ''; clearHint(); renderInteractive();
  try {
    if (local) { local.act(kind, v); sentReq = 0; setRow(local.row()); return; }
    await api.game({ action: 'play', id: row.id, kind, v, reqId: kind === 'next' ? undefined : q && q.id });
    await refreshRow();
  } catch (x) { sentReq = 0; toast(esc(x.message)); renderInteractive(); }
}
function clearHint() { for (const e of document.querySelectorAll('.hand .hint')) e.classList.remove('hint'); }
function hint() {
  const q = myReq(); if (!q) return;
  const G = Gv();
  if (q.k === 'card') { const c = E.botCard(G, me, 'hard'); clearHint(); const el = document.querySelector(`.hand .card[data-id="${c}"]`); if (el) el.classList.add('hint'); toast(`اقتراح: ${cardName(c)}`, 1300); }
  else if (q.k === 'bid') {
    const s = E.botBid(G, me, q.d.round, q.d.opts, 'hard');
    hintText = 'اقتراح المحترف: ' + ({ hokm: `حكم ${SYM[row.state.flip[1]]}`, sun: 'صن', pass: 'بس', ashkal: 'أشكل' }[s.t] || `حكم ${SYM[s.s]}`);
    renderPanel();
  }
}

/* ================= tools ================= */
$('#tHint').onclick = hint;
$('#tLast').onclick = () => {
  const lt = row && row.state.lastTrick; if (!lt) return;
  openModal(`<h2>آخر أكلة</h2><div class="ltrick">${lt.cards.map((t) => `<figure class="${t.p === lt.w ? 'w' : ''}">${cardHTML(t.c)}<figcaption>${esc(NAME(t.p))}</figcaption></figure>`).join('')}</div>
    <p style="text-align:center">أكلها <b>${esc(NAME(lt.w))}</b> · ${lt.gain} بنط</p><div class="actions"><button class="bbtn" data-close="1">إغلاق</button></div>`);
};
$('#tCounter').onclick = () => { settings.counter = !settings.counter; save('bm.settings', settings); renderStatic(); };
$('#tLog').onclick = () => showLog(false);
function showLog(fromFinal) {
  const U = team(me), log = row.state.log || [];
  const rows = log.map(([n, tc, b, t0, t1, nc, d]) => { const t = [t0, t1]; return `<tr><td>${n}</td><td>${typeText(tc)}</td><td>${esc(NAME(b))}</td><td style="color:var(--us)">${t[U]}</td><td style="color:var(--them)">${t[1 - U]}</td><td style="font-size:12px">${d ? 'دبل · ' : ''}${noteText(nc)}</td></tr>`; }).join('');
  openModal(`<h2>سجل الصكة</h2><div class="tablewrap"><table><tr><th>#</th><th>النوع</th><th>المشتري</th><th>لنا</th><th>لهم</th><th>ملاحظة</th></tr>${rows || '<tr><td colspan="6" class="muted">ما فيه توزيعات مكتملة للحين</td></tr>'}
    <tr><td colspan="3"><b>المجموع</b></td><td><b>${row.state.scores[U]}</b></td><td><b>${row.state.scores[1 - U]}</b></td><td></td></tr></table></div>
    <div class="actions"><button class="bbtn" id="mLogClose">إغلاق</button></div>`);
  $('#mLogClose').onclick = () => { closeModal(); if (fromFinal) showFinal(); };
}
$('#tRules').onclick = () => openModal(`<div class="rules"><h2>قوانين البلوت</h2>
  <p class="muted">٣٢ ورقة، أربع لاعبين، كل اثنين متقابلين فريق. اللعب عكس عقارب الساعة.</p>
  <h4>الشراء</h4><ul><li><b>صن ☀</b>: بدون حكم، ٢٦ نقطة في التوزيعة.</li><li><b>حكم</b>: نوع الورقة المكشوفة في الدور الأول، وفي الدور الثاني تختار نوع ثاني (١٦ نقطة).</li>
  <li><b>أشكل</b>: للاعب الثالث والرابع في الدور الأول — صن لخويك وهو ياخذ الورقة المكشوفة.</li><li>الصن يغلب الحكم.</li><li><b>دبل</b>: الخصم يدبّل الحكم وتصير النقاط ×٢.</li></ul>
  <h4>ترتيب الورق</h4><ul><li>صن وغير الحكم: A ، 10 ، K ، Q ، J ، 9 ، 8 ، 7</li><li>الحكم: J ، 9 ، A ، 10 ، K ، Q ، 8 ، 7</li></ul>
  <h4>الأبناط</h4><ul><li>A=11 ، 10=10 ، K=4 ، Q=3 ، J=2 · في الحكم: الولد=20 والتسعة=14 · الأرض=10</li></ul>
  <h4>اللعب</h4><ul><li>لازم تنزل من نفس النوع.</li><li>في الحكم إذا ما عندك من النوع لازم تدق، إلا إذا خويك ماسك الأكلة.</li><li>إذا نزل حكم لازم تكبّر عليه إذا تقدر.</li></ul>
  <h4>المشاريع</h4><ul><li>سرا: صن ٤ / حكم ٢ · خمسين: ١٠ / ٥ · مية: ٢٠ / ١٠ · أربعمية (أربع إكك في الصن): ٤٠</li><li>بلوت (الشايب والبنت من الحكم): ٢ ولا ينلغى.</li></ul>
  <h4>الحساب</h4><ul><li>المشتري لازم يجيب أكثر من خصمه، وإلا الأرض كلها للخصم.</li><li>كبوت: صن ٤٤ / حكم ٢٥.</li></ul>
  <h4>الوقت</h4><ul><li>عندك ٣٥ ثانية لكل حركة. إذا خلص الوقت البوت يلعب عنك، وبعد مرتين ورا بعض ياخذ كرسيك لين ترجع.</li></ul></div>
  <div class="actions"><button class="bbtn" data-close="1">إغلاق</button></div>`);
$('#tSet').onclick = () => {
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(settings[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openModal(`<h2>الإعدادات</h2>
    <div class="field"><span>سرعة العرض</span>${seg('speed', [['slow', 'هادي'], ['normal', 'عادي'], ['fast', 'سريع']])}</div>
    <div class="field"><span>الأصوات</span>${seg('sound', [[true, 'تشغيل'], [false, 'إيقاف']])}</div>
    <div class="actions"><button class="bbtn main" data-close="1">تم</button></div>`);
  for (const g of document.querySelectorAll('#modal .seg')) g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    let v = b.dataset.v; v = v === 'true' ? true : v === 'false' ? false : v;
    settings[g.dataset.k] = v; save('bm.settings', settings); for (const x of g.children) x.classList.toggle('on', x === b);
  });
};
$('#tLeave').onclick = () => {
  openModal(`<h2>تطلع من الطاولة؟</h2><p>${local ? 'الصكة التدريبية بتنتهي.' : 'كرسيك بيلعبه بوت، وتقدر ترجع له من اللوبي.'}</p>
    <div class="actions"><button class="bbtn main" id="mLeave">اطلع</button><button class="bbtn" data-close="1">كمّل</button></div>`);
  $('#mLeave').onclick = () => exitTable(!local);
};

/* ================= chat ================= */
function chatHTML(drawer) {
  return `${drawer ? '<div class="head"><span>الدردشة</span><button class="tbtn" id="chatClose">إغلاق</button></div>' : ''}
    <div class="msgs" aria-live="polite">${msgs.map(msgHTML).join('') || '<span class="muted">ما فيه رسائل للحين</span>'}</div>
    <div class="quick">${QUICK.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form><input class="inp" maxlength="200" placeholder="اكتب رسالة" aria-label="رسالة"><button class="bbtn" type="submit">أرسل</button></form>`;
}
const msgHTML = (m) => `<div class="msg ${m.user_id === myUid ? 'mine' : ''}"><b>${esc(m.username || 'لاعب')}:</b> ${esc(m.body)}</div>`;
function bindChat(box) {
  const list = box.querySelector('.msgs'); list.scrollTop = list.scrollHeight;
  box.querySelector('form').onsubmit = (e) => { e.preventDefault(); const i = box.querySelector('input'); const t = i.value.trim(); if (t) { sendMsg(t); i.value = ''; } };
  box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => sendMsg(b.dataset.q)));
  const c = box.querySelector('#chatClose'); if (c) c.onclick = () => { box.hidden = true; };
}
async function sendMsg(t) {
  if (local) { gtoast('الدردشة للطاولات الأونلاين'); return; }
  try { await api.send(row.id, t, myUid); } catch (x) { gtoast(x.message); }
}
function onMessage(m) {
  if (!row || m.table_id !== row.id || msgs.some((x) => x.id === m.id)) return;
  msgs.push(m); if (msgs.length > 60) msgs.shift();
  const s = row.seats.findIndex((x) => x && x.uid === m.user_id);
  if (!$('#scrGame').hidden && s >= 0) bubble(s, m.body, 3000, 'chat');
  if (m.user_id !== myUid) snd('msg');
  const drawer = $('#gameChat');
  if (!$('#scrRoom').hidden) renderRoomChat();
  else if (!drawer.hidden) { drawer.innerHTML = chatHTML(true); bindChat(drawer); }
  else if (m.user_id !== myUid) { unread++; $('#chatBadge').hidden = false; $('#chatBadge').textContent = unread; }
}
$('#tChat').onclick = () => {
  const d = $('#gameChat');
  if (local) { gtoast('الدردشة للطاولات الأونلاين'); return; }
  d.hidden = !d.hidden; unread = 0; $('#chatBadge').hidden = true;
  if (!d.hidden) { d.innerHTML = chatHTML(true); bindChat(d); d.querySelector('input').focus(); }
};
function renderRoomChat() { const box = $('#roomChat'); box.innerHTML = chatHTML(false); bindChat(box); }

/* ================= waiting room ================= */
function renderRoom() {
  $('#roomCode').textContent = row.code;
  const host = row.host === myUid, n = seatCount(row);
  $('#roomInfo').textContent = host ? 'أرسل رابط الدعوة لأصحابك. الكراسي الفاضية يلعبها بوت.' : 'اختر كرسيك. الكرسي اللي قدامك يكون خويك.';
  const box = (p) => {
    const s = row.seats[p], isMe = s && s.uid === myUid;
    const who = s ? (isMe ? 'أنت' : esc(s.name)) : '<span class="muted">فاضي · بوت</span>';
    const btn = !s ? `<button class="sbtn" data-seat="${p}">اجلس هنا</button>` : '';
    return `<div class="wseat ${team(p) === 0 ? 'ta' : 'tb'}"><span class="muted">كرسي ${p + 1}${s && s.uid === row.host ? ' · المضيف' : ''}</span><span class="who">${who}</span>${btn}</div>`;
  };
  $('#roomSeats').innerHTML = [0, 2, 1, 3].map(box).join('');
  $('#roomActions').innerHTML = (host ? `<button class="bbtn main big" id="roomStart">ابدأ اللعب (${n}/4)</button>` : '<span class="muted">بانتظار المضيف يبدأ…</span>') +
    `<span class="muted">الفريق الأول: كرسي ١ و٣ · الفريق الثاني: كرسي ٢ و٤ · الصكة ${row.target}</span>`;
  if ($('#roomStart')) $('#roomStart').onclick = async () => { $('#roomStart').disabled = true; try { await api.game({ action: 'start', id: row.id }); await refreshRow(); } catch (x) { gtoast(x.message); $('#roomStart').disabled = false; } };
  renderRoomChat();
}
$('#roomSeats').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-seat]'); if (!b) return;
  try { await api.game({ action: 'join', id: row.id, seat: +b.dataset.seat }); await refreshRow(); } catch (x) { gtoast(x.message); }
});
$('#roomLeave').onclick = () => exitTable(true);
$('#roomCopy').onclick = () => {
  const link = location.origin + location.pathname + '?t=' + row.code;
  const done = () => gtoast('انسخ رابط الدعوة');
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => gtoast(link, 5000)); else gtoast(link, 5000);
};

/* ================= boot ================= */
window.__bm = { get row() { return row; }, get me() { return me; }, get pumping() { return pumping; }, act, startLocal, settings };
(async () => {
  if (!api) { myUid = 'local'; showAuth(); return; }
  try { const s = await api.session(); if (s) { await enterLobby(); return; } } catch { /* fall through */ }
  showAuth();
})();
