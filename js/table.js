// Game table: renders a Baloot table from a public game view and replays server events with light animations.
// Used by online rooms (views/room.js) and by training against bots (views/training.js).
//
// Adapter contract:
//   view()            → { state, seats:[{uid,name,avatar_url,frame,rating,level,abandoned,offline}|null], mySeat (-1 = spectator),
//                         hand:[card], status, code, kind, chatMode, ownerId }
//   act(kind, v, req) → Promise   (kind: 'bid' | 'double' | 'card' | 'next')
//   tick()            → optional; called when the server clock says a move is overdue
//   leave()           → user wants to leave (the room view decides how)
//   rematch()         → optional (owner or training) start again
//   chat              → optional { send(text), quick: [] , mode }
//   hints             → boolean: show hint/explain tools (training only)
//   onSummary(sm)     → optional hook after each round (training uses it for decision review)
import * as E from './engine.js';
import { esc, html, raw, mount, avatar, rankBadge, sleep, dialog, toast, prefs, reducedMotion } from './ui.js';
import * as S from './sound.js';

const SUITS = ['S', 'H', 'C', 'D'];
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'شريا', H: 'هاص', D: 'ديمن', C: 'سبيت' };
const RNAME = { 7: 'سبعة', 8: 'ثمانية', 9: 'تسعة', T: 'عشرة', J: 'ولد', Q: 'بنت', K: 'شايب', A: 'إكة' };
const PROJ = { sira: 'سرا', 50: 'خمسين', 100: 'مية', 400: 'أربعمية' };
const SPEED = { slow: 1.5, normal: 1, fast: 0.55 };
const RED = (s) => s === 'H' || s === 'D';
const L = (r) => (r === 'T' ? '10' : r);
export const cardName = (c) => `${RNAME[c[0]]} ${SNAME[c[1]]}`;
export function cardHTML(c, extra = '') {
  const r = c[0], s = c[1], face = 'JQK'.includes(r);
  return `<div class="pc s-${s} ${face ? 'face' : ''} ${extra}" data-id="${c}" aria-label="${cardName(c)}"><span class="ix tl">${L(r)}<i>${SYM[s]}</i></span><span class="pip">${face ? `<span>${L(r)}</span>` : SYM[s]}</span><span class="ix br">${L(r)}<i>${SYM[s]}</i></span></div>`;
}
const team = (p) => p % 2;

export function createTable(root, adapter, opts = {}) {
  let V = adapter.view();
  let me = V.mySeat >= 0 ? V.mySeat : 0, spectating = V.mySeat < 0;
  let lastSeq = V.state && !opts.replay ? V.state.evSeq : 0;
  let queue = [], pumping = false, sentReq = 0, skew = 0, lastTick = 0, chatOpen = false, unread = 0, destroyed = false;
  let summaryResolve = null;

  mount(root, html`
    <div class="game" data-table="${V.table || 'classic'}" data-back="${V.back || 'sadu'}">
      <header class="hud">
        <div class="score" aria-label="النتيجة"><div class="t us"><small>لنا</small><b id="tUs">0</b></div><div class="div"></div><div class="t them"><small>لهم</small><b id="tThem">0</b></div><span class="target" id="tTarget"></span></div>
        <span class="hudchip" id="tContract">بانتظار التوزيع</span>
        <span class="hudchip" id="tAbnat" hidden></span>
        <div class="tools">
          ${adapter.hints ? raw('<button class="tbtn" id="bHint" title="اقتراح ورقة مع الشرح (H)">💡 اقتراح</button>') : ''}
          <button class="tbtn" id="bLast">آخر أكلة</button>
          <button class="tbtn" id="bTricks">الأكلات</button>
          <button class="tbtn" id="bLog">القيد</button>
          ${adapter.chat ? raw('<button class="tbtn" id="bChat">💬 الدردشة <span class="dot" id="chatDot" hidden></span></button>') : ''}
          <button class="tbtn" id="bRules">❔ القواعد</button>
          <button class="tbtn" id="bSound" aria-pressed="${prefs.sound ? 'true' : 'false'}" title="الصوت">${prefs.sound ? '🔊' : '🔇'}</button>
          <button class="tbtn" id="bLeave">خروج</button>
        </div>
      </header>
      <main class="felt" id="felt" aria-label="طاولة اللعب">
        ${[1, 2, 3, 0].map((v) => raw(`<div class="seat ${v % 2 ? 'foe' : 'ally'}" data-v="${v}"><div class="bubble"></div><button class="avbtn" aria-label="ملف اللاعب"><svg class="ring" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/></svg><span class="av"></span></button><span class="nm"></span><span class="tags"></span>${v ? '<div class="backs"></div>' : ''}</div>`))}
        <div id="flip"></div>
        <div id="trick" aria-live="polite"></div>
        <div class="panel" id="panel" hidden></div>
        <div class="turnbar" id="turnbar" hidden><i></i></div>
        <div class="counterbox" id="counter" hidden></div>
        <div class="hand" id="hand" aria-label="ورقك"></div>
        <div id="ttoast" role="status"></div>
        <aside class="drawer" id="chat" hidden></aside>
      </main>
    </div>`);
  const $ = (s) => root.querySelector(s);
  const seatEl = (p) => root.querySelector(`.seat[data-v="${view(p)}"]`);
  const view = (p) => ((p - me) % 4 + 4) % 4;
  const mine = (t) => t === team(me);
  const NAME = (p) => { const s = V.seats[p]; if (!s) return 'بوت'; return p === me && !spectating ? 'أنت' : s.name; };
  const LNAME = (p) => (p === me && !spectating ? 'لك' : 'ل' + NAME(p));
  const pace = (ms) => { const fast = queue.length > 14 ? 0.2 : queue.length > 8 ? 0.5 : 1; return sleep((reducedMotion() ? 0.4 : 1) * ms * SPEED[prefs.speed || 'normal'] * fast); };
  const Gv = () => { const hands = [[], [], [], []]; if (!spectating) hands[me] = (V.hand || []).slice(); return { ...V.state, hands }; };

  /* ---------- toasts & bubbles ---------- */
  let tt = null;
  function ttoast(h, ms = 1700) { const t = $('#ttoast'); t.innerHTML = h; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms * SPEED[prefs.speed || 'normal']); }
  const bubT = {};
  function bubble(p, text, ms = 1500, cls = '') {
    const v = view(p), b = seatEl(p).querySelector('.bubble');
    b.textContent = text; b.className = 'bubble show ' + cls; clearTimeout(bubT[v]);
    if (ms) bubT[v] = setTimeout(() => b.classList.remove('show'), ms * SPEED[prefs.speed || 'normal']);
  }
  const clearBubbles = () => root.querySelectorAll('.bubble').forEach((b) => b.classList.remove('show'));

  /* ---------- trick animation ---------- */
  function seatVec(p) { const r = $('#felt').getBoundingClientRect(); return [[0, r.height * 0.5], [r.width * 0.5, 0], [0, -r.height * 0.5], [-r.width * 0.5, 0]][view(p)]; }
  function slot(p, cw, ch) { return [[0, ch * 0.36], [cw * 0.72, -ch * 0.04], [0, -ch * 0.44], [-cw * 0.72, -ch * 0.04]][view(p)]; }
  const ROT = [-3, 6, 2, -6];
  function place(p, c, anim) {
    const w = document.createElement('div'); w.innerHTML = cardHTML(c, E.isTrump(V.state, c) ? 'trump' : '');
    const el = w.firstChild; el.dataset.p = p; $('#trick').appendChild(el);
    const [x, y] = slot(p, el.offsetWidth, el.offsetHeight);
    const to = `translate(-50%,-50%) translate(${x}px,${y}px) rotate(${ROT[view(p)]}deg)`;
    el.style.transform = to;
    if (anim && el.animate && !reducedMotion()) {
      const [fx, fy] = seatVec(p);
      el.animate([{ transform: `translate(-50%,-50%) translate(${fx}px,${fy}px) scale(.7)`, opacity: 0.2 }, { transform: to, opacity: 1 }], { duration: 260 * SPEED[prefs.speed || 'normal'], easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
  }
  function collect(w) {
    const [wx, wy] = seatVec(w);
    for (const el of root.querySelectorAll('#trick .pc:not(.going)')) {
      el.classList.add('going');
      if (!el.animate || reducedMotion()) { el.remove(); continue; }
      el.animate([{ transform: el.style.transform, opacity: 1 }, { transform: `translate(-50%,-50%) translate(${wx * 0.9}px,${wy * 0.9}px) scale(.45)`, opacity: 0 }],
        { duration: 400 * SPEED[prefs.speed || 'normal'], easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove());
    }
  }
  function reconcile() {
    const els = [...root.querySelectorAll('#trick .pc:not(.going)')];
    const want = (V.state.trick || []).map((t) => t.p + ':' + t.c).join(','), have = els.map((e) => e.dataset.p + ':' + e.dataset.id).join(',');
    if (want === have) return;
    els.forEach((e) => e.remove());
    for (const t of V.state.trick || []) place(t.p, t.c, false);
  }

  /* ---------- rendering ---------- */
  function myReq() {
    const q = V.state && V.state.req;
    if (!q || pumping || spectating || V.status !== 'playing' || q.p !== me || sentReq === q.id) return null;
    if (V.seats[me] && V.seats[me].abandoned) return null;
    return q;
  }
  function renderStatic() {
    const p = V.state; if (!p) return;
    const U = team(me), O = 1 - U;
    $('#tUs').textContent = p.scores[U]; $('#tThem').textContent = p.scores[O];
    $('#tTarget').textContent = `/ ${p.rules.target}`;
    const ct = p.contract, chip = $('#tContract');
    if (ct) {
      chip.className = 'hudchip' + (ct.type === 'hokm' && RED(ct.trump) ? ' red' : '');
      chip.innerHTML = (ct.type === 'sun' ? '<span class="s">☀</span> صن' : `<span class="s">${SYM[ct.trump]}</span> حكم ${SNAME[ct.trump]}`) +
        ` · ${ct.buyer === me && !spectating ? 'أنت المشتري' : 'المشتري: ' + esc(NAME(ct.buyer))}` +
        (p.mult > 1 ? ` <span class="x">${p.gahwa ? 'قهوة' : '×' + p.mult}</span>` : '') + (p.locked ? ' · مقفول' : '');
    } else { chip.className = 'hudchip'; chip.textContent = p.phase === 'bid' ? `الشراء — الدور ${p.bid && p.bid.round === 2 ? 'الثاني' : 'الأول'}` : 'بانتظار التوزيع'; }
    const ab = $('#tAbnat');
    ab.hidden = !['play', 'roundEnd'].includes(p.phase);
    ab.textContent = `الأبناط · لنا ${p.raw[U]} · لهم ${p.raw[O]}`;
    for (let s = 0; s < 4; s++) {
      const el = seatEl(s), st = V.seats[s];
      el.classList.toggle('offline', !!(st && (st.offline || st.abandoned)));
      el.querySelector('.av').innerHTML = avatar(st || { username: 'بوت' }, view(s) === 0 ? 44 : 52, { online: st && st.online === true }).__raw;
      el.querySelector('.nm').textContent = NAME(s) + (s === (me + 2) % 4 && !spectating ? ' · خويك' : '');
      const tags = [];
      if (p.dealer === s) tags.push('<span class="tag d">الموزّع</span>');
      if (ct && ct.buyer === s) tags.push('<span class="tag">المشتري</span>');
      if (st && st.abandoned) tags.push('<span class="tag off">انسحب · آلي</span>');
      else if (st && st.offline) tags.push('<span class="tag off">منقطع</span>');
      if (st && st.rating != null && view(s) !== 0) tags.push(`<span class="tag p" title="التصنيف">${esc(st.rating)}</span>`);
      el.querySelector('.tags').innerHTML = tags.join('');
      const bk = el.querySelector('.backs'); if (bk) bk.innerHTML = '<i></i>'.repeat(p.counts[s] || 0);
    }
    renderCounter(); renderInteractive();
  }
  function renderInteractive() {
    const p = V.state; if (!p) return;
    for (let s = 0; s < 4; s++) seatEl(s).classList.toggle('turn', !pumping && p.turn === s && p.phase !== 'roundEnd');
    $('#flip').innerHTML = !pumping && p.flip && (p.phase === 'bid' || p.phase === 'double') ? `${cardHTML(p.flip)}<span class="lbl">الورقة المكشوفة</span>` : '';
    if (!pumping) reconcile();
    renderPanel(); renderHand(); timer();
    const hb = $('#bHint'); if (hb) hb.disabled = !myReq() || !['card', 'bid'].includes(myReq().k);
    $('#bLast').disabled = !p.lastTrick;
  }
  function suitOrder(h) {
    const ct = V.state.contract, tr = ct && ct.type === 'hokm' ? ct.trump : null;
    const present = SUITS.filter((s) => h.some((c) => c[1] === s));
    const b = present.filter((s) => !RED(s)), r = present.filter(RED); let order = [];
    while (b.length || r.length) { if (b.length) order.push(b.shift()); if (r.length) order.push(r.shift()); }
    return tr && order.includes(tr) ? [tr, ...order.filter((s) => s !== tr)] : order;
  }
  let selected = null;
  function renderHand() {
    const h = $('#hand'); h.innerHTML = '';
    if (spectating) return;
    const q = myReq(), active = q && q.k === 'card', G = Gv();
    const ok = active ? E.legal(G, me) : [];
    h.classList.toggle('active', !!active);
    const order = suitOrder(V.hand || []);
    const sorted = (V.hand || []).slice().sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || E.rankPow(G, b) - E.rankPow(G, a));
    sorted.forEach((c, i) => {
      const w = document.createElement('div'); w.innerHTML = cardHTML(c, (active ? (ok.includes(c) ? 'ok' : 'no') : '') + (E.isTrump(G, c) ? ' trump' : '') + (selected === c ? ' sel' : ''));
      const el = w.firstChild; el.setAttribute('role', 'button'); el.tabIndex = active && ok.includes(c) ? 0 : -1;
      el.title = `${cardName(c)}${active ? ` — اضغط ${i + 1}` : ''}`;
      const go = () => {
        if (!myReq() || myReq().k !== 'card') return;
        if (!E.legal(Gv(), me).includes(c)) { ttoast('هذي الورقة ما تنلعب الحين', 1100); S.play('error'); return; }
        // touch: first tap selects, second tap plays (prevents accidental plays); mouse/keyboard play at once
        if (matchMedia('(pointer: coarse)').matches && selected !== c) { selected = c; renderHand(); return; }
        selected = null; act('card', c);
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = c; go(); } });
      h.appendChild(el);
    });
  }
  let hintText = '';
  function renderPanel() {
    const pn = $('#panel'), q = myReq();
    if (!q || (q.k !== 'bid' && q.k !== 'double')) { pn.hidden = true; pn.innerHTML = ''; hintText = ''; return; }
    pn.hidden = false;
    const p = V.state;
    if (q.k === 'double') {
      const lvl = q.d.level, word = q.d.text;
      const ask = lvl === 2 ? `${esc(NAME(p.contract.buyer))} اشترى ${p.contract.type === 'sun' ? 'صن' : 'حكم ' + SYM[p.contract.trump]} — تدبّل؟` : `الخصم رفع اللعب — تقول «${word}»؟`;
      pn.innerHTML = `<h3>${ask}</h3><div class="row"><button class="btn primary" data-v="1">${word}${lvl < 5 ? ` ×${lvl}` : ''}</button><button class="btn" data-v="0">لا</button></div>${lvl === 5 ? '<span class="small muted">القهوة: اللي يكسب هذي التوزيعة يكسب الصكة كاملة.</span>' : ''}`;
      pn.querySelectorAll('button').forEach((b) => (b.onclick = () => act('double', b.dataset.v === '1')));
      return;
    }
    const { round, opts } = q.d, f = p.flip;
    let h = `<h3>${round === 1 ? 'الدور الأول' : 'الدور الثاني'} — وش تبي؟</h3><div class="row">`;
    if (opts.includes('hokm')) h += `<button class="btn primary" data-t="hokm">حكم <span style="color:${RED(f[1]) ? '#a01818' : 'inherit'}">${SYM[f[1]]}</span></button>`;
    if (opts.includes('hokm2')) for (const s of SUITS) if (s !== f[1]) h += `<button class="btn" data-t="hokm2" data-s="${s}" aria-label="حكم ${SNAME[s]}">حكم ${SYM[s]}</button>`;
    if (opts.includes('sun')) h += '<button class="btn primary" data-t="sun">صن ☀</button>';
    if (opts.includes('ashkal')) h += '<button class="btn" data-t="ashkal">أشكل</button>';
    h += '<button class="btn" data-t="pass">بس</button></div>';
    if (hintText) h += `<div class="small" style="color:var(--info)">${esc(hintText)}</div>`;
    pn.innerHTML = h;
    pn.querySelectorAll('button').forEach((b) => (b.onclick = () => act('bid', b.dataset.s ? { t: b.dataset.t, s: b.dataset.s } : { t: b.dataset.t })));
    pn.querySelector('button').focus({ preventScroll: true });
  }
  function renderCounter() {
    const el = $('#counter'), p = V.state;
    if (!adapter.hints || !p || !p.contract || !counterOn) { el.hidden = true; return; }
    el.hidden = false;
    const played = new Set(p.played), mineSet = new Set(spectating ? [] : V.hand);
    let h = '<b class="small" style="color:var(--gold)">عداد الورق</b>';
    for (const s of SUITS) {
      const rs = (p.contract.type === 'hokm' && s === p.contract.trump ? E.ORD_T : E.ORD_N).slice().reverse();
      h += `<div class="r"><span style="width:16px;color:${RED(s) ? '#ff8a7e' : 'inherit'}">${SYM[s]}</span>${rs.map((r) => `<span class="c ${played.has(r + s) ? 'gone' : ''} ${mineSet.has(r + s) ? 'mine' : ''}">${L(r)}</span>`).join('')}</div>`;
    }
    el.innerHTML = h;
  }
  let counterOn = false;
  function timer() {
    const bar = $('#turnbar'), p = V.state;
    root.querySelectorAll('.seat').forEach((x) => x.classList.remove('timed'));
    if (!p || !p.deadline || pumping || !p.req || p.req.k === 'next' || V.status !== 'playing') { bar.hidden = true; return; }
    const now = Date.now() + skew, total = (p.rules.turnSeconds || 30) * 1000, left = p.deadline - now, frac = Math.max(0, Math.min(1, left / total));
    const el = seatEl(p.req.p); el.classList.add('timed');
    el.querySelector('.ring circle').style.strokeDashoffset = String(150.8 * (1 - frac));
    if (p.req.p === me && !spectating) { bar.hidden = false; bar.querySelector('i').style.width = frac * 100 + '%'; bar.classList.toggle('low', left < 8000); if (left < 8000 && left > 7000) S.play('tick'); }
    else bar.hidden = true;
  }

  /* ---------- event playback ---------- */
  async function pump() {
    if (pumping) return;
    pumping = true; renderInteractive();
    try { while (queue.length && !destroyed) await playEvent(queue.shift()); }
    finally { pumping = false; }
    if (destroyed || !V.state) return;
    renderStatic();
    const q = myReq();
    if (q && q.k !== 'next') { S.play('turn'); if (document.hidden && navigator.vibrate) navigator.vibrate(120); }
    if (V.status === 'finished' && !finalShown) showFinal();
  }
  async function playEvent(e) {
    const [, k, ...a] = e;
    switch (k) {
      case 'deal': $('#trick').innerHTML = ''; clearBubbles(); ttoast(`التوزيعة ${a[1] || ''} — يوزّع ${a[0] === me && !spectating ? 'أنت' : esc(NAME(a[0]))}`, 1200); S.play('deal'); await pace(900); break;
      case 'bid': for (let s = 0; s < 4; s++) seatEl(s).classList.toggle('turn', s === a[0]); bubble(a[0], a[1], 0); S.play(a[1] === 'بس' ? 'soft' : 'bid'); await pace(a[0] === me ? 250 : 700); break;
      case 'r2': clearBubbles(); ttoast('الدور الثاني', 900); await pace(800); break;
      case 'redeal': clearBubbles(); ttoast('الكل قال بس — توزيع جديد'); await pace(1400); break;
      case 'contract': {
        const [type, tr, b, ak] = a; clearBubbles(); S.play('bid');
        ttoast(type === 'sun' ? `${ak ? 'أشكل · ' : ''}صن ${esc(LNAME(b))}` : `حكم ${SYM[tr]} ${SNAME[tr]} ${esc(LNAME(b))}`, 1500);
        await pace(1200); break;
      }
      case 'double': bubble(a[0], a[2] + '!', 1600, 'proj'); S.play('double'); ttoast(`${esc(NAME(a[0]))} قال ${esc(a[2])}`, 1500); await pace(1100); break;
      case 'play': $('#flip').innerHTML = ''; if (a[1]) ttoast('اللعب مقفول: ما تبدأ بالحكم إلا إذا ما عندك غيره', 1800); await pace(300); break;
      case 'card': for (let s = 0; s < 4; s++) seatEl(s).classList.toggle('turn', s === a[0]); place(a[0], a[1], true); S.play('card'); await pace(a[0] === me ? 200 : 620); break;
      case 'projbub': bubble(a[0], a[1].map((t) => PROJ[t]).join(' + '), 1800, 'proj'); S.play('proj'); break;
      case 'baloot': bubble(a[0], 'بلوت', 1600, 'proj'); S.play('proj'); break;
      case 'trick': await pace(450); collect(a[0]); S.play(mine(team(a[0])) ? 'win' : 'soft'); await pace(420); break;
      case 'projshow': {
        const [w, show, pts, lost] = a;
        const cards = Object.entries(show).map(([seat, list]) => `<div class="small">${esc(NAME(+seat))}: ${list.map((x) => PROJ[x.t]).join(' + ')}</div><div class="miniproj">${list.flatMap((x) => x.cards).map((c) => cardHTML(c)).join('')}</div>`).join('');
        ttoast(`مشروع ${mine(w) ? 'لنا' : 'لهم'} (+${pts})${cards}${lost ? `<div class="small">انلغى مشروع ${mine(w) ? 'لهم' : 'لنا'}</div>` : ''}`, 2600);
        await pace(600); break;
      }
      case 'summary': await showSummary(a[0]); break;
      case 'join': ttoast(`${esc(NAME(a[0]))} جلس`); break;
      case 'left': ttoast(`${esc(NAME(a[0]))} انسحب — اللعب الآلي يكمل مكانه`, 2400); break;
      case 'afk': ttoast(`${esc(NAME(a[0]))} خلص وقته — لُعبت عنه ورقة تلقائياً`); break;
    }
  }

  /* ---------- round summary & final ---------- */
  const OUT = { made: 'المشتري كسب', failed: 'المشتري خسر — النقاط كلها للخصم', tie: 'تعادل', kaboot: 'كبوت!', kaboot_against: 'كبوت على المشتري!' };
  async function showSummary(sm) {
    if (!sm) return;
    const U = team(me), O = 1 - U, good = sm.fin[U] >= sm.fin[O];
    S.play(good ? 'good' : 'bad');
    const prRow = (tm) => (sm.pr[tm].length ? sm.pr[tm].map((t) => PROJ[t]).join(' + ') + (sm.pw === tm ? ` (+${sm.pv[tm]})` : ' (ملغي)') : '—');
    let clicked = false;
    const d = dialog(html`<h2>نهاية التوزيعة ${sm.n}</h2>
      <p class="verdict" style="text-align:center;font-family:var(--f-display);font-size:20px;color:${good ? 'var(--us)' : 'var(--them)'}">${OUT[sm.outcome] || ''}</p>
      <p class="muted" style="text-align:center">${sm.tc === 's' ? 'صن' : `حكم ${SYM[sm.tc[1]]} ${SNAME[sm.tc[1]]}`} · المشتري ${NAME(sm.b)}${sm.mult > 1 ? ` · ${sm.gahwa ? 'قهوة' : '×' + sm.mult}` : ''}</p>
      <div class="scroll-x"><table class="data"><tr><th></th><th>لنا</th><th>لهم</th></tr>
        <tr><td>الأكلات</td><td>${sm.tk[U]}</td><td>${sm.tk[O]}</td></tr>
        <tr><td>الأبناط</td><td>${sm.raw[U]}</td><td>${sm.raw[O]}</td></tr>
        <tr><td>المشاريع</td><td>${prRow(U)}</td><td>${prRow(O)}</td></tr>
        ${sm.bal >= 0 ? raw(`<tr><td>بلوت</td><td>${sm.bal === U ? '+2' : '—'}</td><td>${sm.bal === O ? '+2' : '—'}</td></tr>`) : ''}
        ${sm.carried ? raw(`<tr><td>المعلّق من قبل</td><td colspan="2">+${sm.carried}</td></tr>`) : ''}
        <tr><td><b>القيد</b></td><td><b style="color:var(--us)">+${sm.fin[U]}</b></td><td><b style="color:var(--them)">+${sm.fin[O]}</b></td></tr>
        <tr><td>المجموع</td><td>${sm.scores[U]}</td><td>${sm.scores[O]}</td></tr></table></div>
      ${sm.hang ? raw(`<p class="small muted">نقاط معلّقة للتوزيعة الجاية: ${sm.hang}</p>`) : ''}
      <div class="actions"><button class="btn primary" data-close="next" autofocus>${sm.done ? 'النتيجة النهائية' : 'التوزيعة الجاية'}</button></div>`, { dismiss: false, label: 'ملخص التوزيعة' });
    summaryResolve = () => d.close('auto');
    const t0 = Date.now();
    d.done.then((v) => { clicked = v === 'next'; });
    if (adapter.onSummary) try { adapter.onSummary(sm); } catch { /* ignore */ }
    while (d.el.isConnected) {
      await sleep(250);
      if (destroyed) { d.close(); break; }
      if (Date.now() - t0 > 6000 && (queue.length || (V.state && V.state.phase !== 'roundEnd'))) { d.close('auto'); break; }
    }
    summaryResolve = null;
    if (sm.done) return;
    if (clicked && V.state && V.state.req && V.state.req.k === 'next' && !spectating) act('next', true);
  }
  let finalShown = false;
  async function showFinal() {
    finalShown = true;
    const p = V.state, U = team(me), O = 1 - U, won = p.scores[U] > p.scores[O];
    S.play(won ? 'good' : 'bad');
    const extra = adapter.finalInfo ? await adapter.finalInfo().catch(() => null) : null;
    const d = dialog(html`<h2>${spectating ? 'انتهت الصكة' : won ? '🏆 مبروك! كسبتوا الصكة' : 'خسرتوا الصكة'}</h2>
      <div class="row" style="justify-content:center;gap:32px;margin:12px 0"><div style="text-align:center"><small class="muted">لنا</small><b style="display:block;font-family:var(--f-display);font-size:36px;color:var(--us)">${p.scores[U]}</b></div>
      <div style="text-align:center"><small class="muted">لهم</small><b style="display:block;font-family:var(--f-display);font-size:36px;color:var(--them)">${p.scores[O]}</b></div></div>
      ${extra ? raw(extra) : ''}
      <div class="actions">${adapter.rematch ? raw('<button class="btn primary" data-close="again">صكة جديدة</button>') : ''}<button class="btn" data-close="log">القيد</button><button class="btn" data-close="out">خروج</button></div>`, { dismiss: false });
    const v = await d.done;
    if (v === 'again') adapter.rematch();
    else if (v === 'log') { await showLog(); finalShown = false; showFinal(); }
    else adapter.leave();
  }
  async function showLog() {
    const U = team(me), log = (V.state && V.state.log) || [];
    const OUTS = ['كسب', 'خسر', 'كبوت', 'كبوت عليه', 'تعادل'];
    const rows = log.map(([n, tc, b, t0, t1, nc, mult]) => { const t = [t0, t1]; return raw(`<tr><td>${n}</td><td>${tc === 's' ? 'صن' : 'حكم ' + SYM[tc[1]]}${mult > 1 ? ' ×' + mult : ''}</td><td>${esc(NAME(b))}</td><td>${OUTS[nc] || ''}</td><td style="color:var(--us)">${t[U]}</td><td style="color:var(--them)">${t[1 - U]}</td></tr>`); });
    await dialog(html`<h2>القيد</h2><div class="scroll-x"><table class="data"><tr><th>#</th><th>النوع</th><th>المشتري</th><th>النتيجة</th><th>لنا</th><th>لهم</th></tr>${rows.length ? rows : raw('<tr><td colspan="6" class="muted">ما فيه توزيعات مكتملة</td></tr>')}</table></div><div class="actions"><button class="btn" data-close>إغلاق</button></div>`).done;
  }

  /* ---------- actions ---------- */
  async function act(kind, v) {
    const q = V.state.req;
    sentReq = q ? q.id : 0; hintText = ''; renderInteractive();
    try { await adapter.act(kind, v, q && q.id); }
    catch (e) { sentReq = 0; ttoast(esc(e.message || 'تعذّر تنفيذ الحركة')); S.play('error'); renderInteractive(); }
  }
  function hint() {
    const q = myReq(); if (!q) return;
    const G = Gv();
    if (q.k === 'card') {
      const r = E.chooseCard(G, me, 'hard');
      root.querySelectorAll('.hand .pc.hint').forEach((x) => x.classList.remove('hint'));
      const el = root.querySelector(`.hand .pc[data-id="${r.card}"]`); if (el) el.classList.add('hint');
      ttoast(`💡 ${cardName(r.card)}<div class="small">${esc(r.why)}</div>`, 3600);
    } else if (q.k === 'bid') {
      const r = E.botBid(G, me, q.d.round, q.d.opts, 'hard');
      hintText = '💡 ' + ({ hokm: 'حكم', sun: 'صن', pass: 'بس', ashkal: 'أشكل' }[r.t] || `حكم ${SYM[r.s]}`) + ' — ' + r.why;
      renderPanel();
    }
  }

  /* ---------- tools ---------- */
  if ($('#bHint')) $('#bHint').onclick = hint;
  if (adapter.hints) { counterOn = true; }
  $('#bLast').onclick = () => {
    const lt = V.state.lastTrick; if (!lt) return;
    dialog(html`<h2>آخر أكلة</h2><div class="row" style="justify-content:center">${lt.cards.map((t) => raw(`<figure style="margin:0;text-align:center;font-size:12px">${cardHTML(t.c, t.p === lt.w ? 'trump' : '')}<figcaption>${esc(NAME(t.p))}</figcaption></figure>`))}</div><p style="text-align:center">أكلها <b>${NAME(lt.w)}</b> · ${lt.gain} بنط</p><div class="actions"><button class="btn" data-close>إغلاق</button></div>`);
  };
  $('#bTricks').onclick = () => {
    const tl = (V.state.tricksLog || []);
    dialog(html`<h2>أكلات هذي التوزيعة</h2>${tl.length ? tl.map((t, i) => raw(`<div class="row" style="margin:6px 0"><b class="num" style="width:22px">${i + 1}</b>${t.cards.map((x) => `<span title="${esc(NAME(x.p))}" style="--cw:34px;--ch:48px;display:inline-block">${cardHTML(x.c, x.p === t.w ? 'trump' : '')}</span>`).join('')}<span class="small muted">${esc(NAME(t.w))} · ${t.gain}</span></div>`)) : raw('<p class="muted">ما فيه أكلات للحين.</p>')}<div class="actions"><button class="btn" data-close>إغلاق</button></div>`);
  };
  $('#bLog').onclick = showLog;
  $('#bRules').onclick = () => import('./views/rules.js').then((m) => m.rulesDialog && m.rulesDialog(V.state && V.state.rules)).catch(() => toast('تعذّر فتح القواعد', { error: true }));
  $('#bSound').onclick = (e) => { prefs.sound = !prefs.sound; import('./ui.js').then((u) => u.savePrefs()); e.currentTarget.textContent = prefs.sound ? '🔊' : '🔇'; e.currentTarget.setAttribute('aria-pressed', String(prefs.sound)); };
  $('#bLeave').onclick = () => adapter.leave();
  root.querySelectorAll('.seat .avbtn').forEach((b) => {
    b.onclick = () => { const v = +b.closest('.seat').dataset.v; const s = (v + me) % 4; if (adapter.onSeatClick) adapter.onSeatClick(s); };
  });
  const keys = (e) => {
    if (/INPUT|TEXTAREA/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
    if ((e.key === 'h' || e.key === 'ه') && adapter.hints) hint();
    const n = Number(e.key);
    if (n >= 1 && n <= 8) { const el = root.querySelectorAll('.hand .pc')[n - 1]; if (el) { selected = el.dataset.id; el.click(); } }
  };
  document.addEventListener('keydown', keys);
  const timerT = setInterval(() => {
    if (destroyed || !V.state) return;
    timer();
    const p = V.state;
    if (adapter.tick && V.status === 'playing' && p.deadline && Date.now() + skew > p.deadline + 1500 && !pumping && Date.now() - lastTick > 5000) { lastTick = Date.now(); adapter.tick(); }
  }, 1000);

  /* ---------- chat drawer ---------- */
  function renderChat() {
    if (!adapter.chat) return;
    const c = adapter.chat, box = $('#chat');
    box.innerHTML = `<div class="row between"><b style="color:var(--gold)">الدردشة</b><button class="btn small" id="chatX">إغلاق</button></div>
      <div class="msgs" aria-live="polite">${c.messages().map((m) => `<div class="msg ${m.mine ? 'mine' : ''}"><b>${esc(m.name)}:</b><span>${esc(m.body)}</span>${m.mine ? '' : `<button class="rep" data-rep="${m.id}" title="إبلاغ">⚑</button>`}</div>`).join('') || '<span class="muted small">ما فيه رسائل</span>'}</div>
      ${c.mode() === 'off' ? '<p class="small muted">الدردشة مقفلة في هذي الغرفة.</p>' : `<div class="quick">${c.quick.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      ${c.mode() === 'open' ? '<form class="row" id="chatF"><input class="input" maxlength="200" placeholder="اكتب رسالة" aria-label="رسالة" style="flex:1"><button class="btn" type="submit">أرسل</button></form>' : '<p class="small muted">في هذي الغرفة العبارات السريعة فقط.</p>'}`}`;
    const list = box.querySelector('.msgs'); list.scrollTop = list.scrollHeight;
    $('#chatX').onclick = () => { chatOpen = false; box.hidden = true; };
    box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => c.send(b.dataset.q)));
    box.querySelectorAll('[data-rep]').forEach((b) => (b.onclick = () => c.report(+b.dataset.rep)));
    const f = box.querySelector('#chatF'); if (f) f.onsubmit = (e) => { e.preventDefault(); const i = f.querySelector('input'); const t = i.value.trim(); if (t) { c.send(t); i.value = ''; } };
  }
  if ($('#bChat')) $('#bChat').onclick = () => { chatOpen = !chatOpen; $('#chat').hidden = !chatOpen; unread = 0; $('#chatDot').hidden = true; if (chatOpen) { renderChat(); const i = $('#chat input'); if (i) i.focus(); } };

  /* ---------- public API ---------- */
  function update(next) {
    const prev = V;
    V = next;
    me = V.mySeat >= 0 ? V.mySeat : 0; spectating = V.mySeat < 0;
    root.querySelector('.game').dataset.table = V.table || 'classic';
    if (V.state && V.state.serverNow) skew = V.state.serverNow - Date.now();
    const pub = V.state; if (!pub) return;
    const fresh = !prev.state || pub.evSeq < lastSeq || (prev.status !== 'playing' && V.status === 'playing' && pub.evSeq < lastSeq);
    if (fresh) { queue = []; $('#trick').innerHTML = ''; clearBubbles(); lastSeq = 0; finalShown = false; }
    for (const e of pub.ev || []) if (e[0] > lastSeq) { queue.push(e); lastSeq = e[0]; }
    if (sentReq && (!pub.req || pub.req.id !== sentReq)) sentReq = 0;
    renderStatic(); pump();
  }
  function chatMessage(m, isNew) {
    if (!isNew) return;
    const s = V.seats.findIndex((x) => x && x.uid === m.uid);
    if (s >= 0 && !m.mine) bubble(s, m.body, 3200, 'chat');
    if (chatOpen) renderChat(); else if (!m.mine && $('#chatDot')) { unread++; $('#chatDot').hidden = false; $('#chatDot').textContent = unread; }
    if (!m.mine) S.play('msg');
  }
  function destroy() { destroyed = true; clearInterval(timerT); document.removeEventListener('keydown', keys); if (summaryResolve) summaryResolve(); }

  // first paint: show the current state (replaying this match's events only when asked, e.g. right after it starts)
  renderStatic();
  if (opts.replay && V.state) { for (const e of V.state.ev || []) if (e[0] > lastSeq) { queue.push(e); lastSeq = e[0]; } pump(); }
  if (V.status === 'finished' && V.state) setTimeout(() => !finalShown && showFinal(), 50);
  else if (V.state && V.state.phase === 'roundEnd' && V.state.summary) showSummary(V.state.summary);
  return { update, chatMessage, renderChat, destroy, cardHTML };
}
