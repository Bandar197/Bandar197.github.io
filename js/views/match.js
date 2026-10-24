// Match details (/match/:id): players, result, rules, the round log, rating/XP changes, a step-by-step replay and reporting.
// Data comes from rpc('match_detail') (participants and staff only); events are present only after the match ends.
import { rpc } from '../api.js';
import { state } from '../state.js';
import { html, raw, mount, dialog, toast, n, date } from '../ui.js';
import { cardHTML, cardName } from '../table.js';
import { ruleRows } from './rules.js';

const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'شريا', H: 'هاص', D: 'ديمن', C: 'سبيت' };
const PROJ = { sira: 'سرا', 50: 'خمسين', 100: 'مية', 400: 'أربعمية' };
const OUT_CODE = ['المشتري كسب', 'المشتري خسر', 'كبوت للمشتري', 'كبوت على المشتري', 'تعادل'];
const OUT = { made: 'المشتري كسب', failed: 'المشتري خسر', tie: 'تعادل', kaboot: 'كبوت للمشتري', kaboot_against: 'كبوت على المشتري' };
const STATUS = { playing: 'جارية الحين', finished: 'انتهت', abandoned: 'انتهت بانسحاب' };
const REASONS = [['cheating', 'غش أو تواطؤ بين اللاعبين'], ['leaving', 'انسحاب متعمّد أو تعطيل اللعب'], ['abuse', 'إساءة أو سب'], ['spam', 'إزعاج أو رسائل مكررة'], ['inappropriate_name', 'اسم غير لائق'], ['other', 'سبب ثاني']];
const team = (p) => p % 2;
const tcText = (tc) => (tc === 's' ? 'صن' : `حكم ${SYM[tc[1]] || ''}`);
const pc = (c, extra = '') => raw(cardHTML(c, extra));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STYLE = `<style>
.mt-teams{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;text-align:center}
.mt-teams .sc{font-family:var(--f-display);font-size:40px;line-height:1.1;font-variant-numeric:tabular-nums}
.mt-teams .vs{color:var(--muted)}
.mt-teams .win{color:var(--gold);font-size:13px}
.mt-delta.up{color:var(--us)} .mt-delta.down{color:var(--them)}
.rp-board{display:grid;direction:ltr;grid-template-columns:1fr minmax(160px,1.3fr) 1fr;grid-template-areas:". top ." "left mid right" ". bot .";gap:10px;padding:12px;border-radius:20px;
  background:radial-gradient(ellipse at center,var(--felt),var(--felt-2));border:1px solid var(--line);min-height:320px}
.rp-seat{direction:rtl;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.rp-seat.v0{grid-area:bot}.rp-seat.v1{grid-area:right}.rp-seat.v2{grid-area:top}.rp-seat.v3{grid-area:left}
.rp-seat .nm{font-size:13px;background:rgba(0,0,0,.4);padding:2px 10px;border-radius:999px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-seat.t0 .nm{box-shadow:inset 0 0 0 1px #3d9a6c}.rp-seat.t1 .nm{box-shadow:inset 0 0 0 1px #a4544a}
.rp-seat.turn .nm{background:var(--gold);color:var(--gold-ink)}
.rp-hand{display:flex;flex-wrap:wrap;justify-content:center;--cw:30px;--ch:43px;gap:2px;max-width:100%}
.rp-hand .pc.gone{opacity:.15}
.rp-tags{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;min-height:20px}
.rp-mid{grid-area:mid;direction:rtl;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}
.rp-trick{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;--cw:42px;--ch:59px;min-height:80px;align-items:flex-end}
.rp-trick figure{margin:0;font-size:11px;color:var(--muted)}
.rp-trick .w .pc{box-shadow:0 0 0 3px var(--gold)}
.rp-msg{font-family:var(--f-display);font-size:18px;min-height:1.6em}
.rp-ctrl{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.rp-ctrl .btn{min-width:48px}
.rp-log{max-height:180px;overflow:auto;font-size:13px;margin:0;padding-inline-start:20px;line-height:1.8}
.rp-log li[aria-current="step"]{color:var(--gold);font-weight:700}
.rp-range{width:100%;accent-color:var(--gold);min-height:32px}
@media (max-width:640px){.rp-board{grid-template-columns:1fr;grid-template-areas:"top" "right" "mid" "left" "bot"}.mt-teams .sc{font-size:30px}}
</style>`;

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${date(ts)} · ${d.toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' })}`;
}

/* ---------------- replay model ---------------- */
/** Splits the event stream into deals. Each completed deal (ends with 'summary') gets the full hands from its 'hands' event. */
export function buildDeals(events) {
  const evs = (events || []).slice().sort((a, b) => a.seq - b.seq);
  const handsBy = {};
  for (const e of evs) if (e.kind === 'hands') handsBy[e.seq - 1_000_001] = e.data;
  const deals = [];
  let cur = null, done = 0, pre = [], scores = [0, 0];
  for (const e of evs) {
    if (e.kind === 'hands') continue;
    if (e.kind === 'deal') {
      cur = { dealer: e.data[0], n: e.data[1], events: pre.concat([e]), status: 'open', base: scores.slice(), hands: null, summary: null };
      pre = []; deals.push(cur); continue;
    }
    if (!cur) { pre.push(e); continue; }
    cur.events.push(e);
    if (e.kind === 'redeal') cur.status = 'redeal';
    if (e.kind === 'summary') {
      cur.status = 'done'; cur.summary = e.data[0] || null; cur.hands = handsBy[done] || null; done++;
      if (cur.summary && cur.summary.scores) scores = cur.summary.scores.slice();
    }
  }
  if (pre.length && cur) cur.events.push(...pre);
  return deals;
}

/** State of a deal after applying its first i+1 events. ctx: {name(p), me (viewer's seat or -1), teamLabel(t)}. */
export function stepState(deal, i, ctx) {
  const { name, me = -1, teamLabel = (t) => (t === 0 ? 'الفريق الأول' : 'الفريق الثاني') } = ctx;
  const V = (p, he, you) => (p === me ? you : he);
  const st = {
    hands: deal.hands ? deal.hands.map((h) => h.slice()) : null, gone: [[], [], [], []], trick: [], trickDone: false, winner: -1,
    bids: {}, contract: null, mult: 1, gahwa: false, locked: false, raw: [0, 0], tricks: [0, 0], trickNo: 0, scores: deal.base.slice(),
    announced: {}, baloot: -1, summary: null, turn: -1, msg: '', dealer: deal.dealer, round2: false,
  };
  const evs = deal.events.slice(0, i + 1);
  for (const e of evs) {
    const a = Array.isArray(e.data) ? e.data : [];
    switch (e.kind) {
      case 'deal': st.msg = `التوزيعة ${n(a[1])} — يوزّع ${name(a[0])}`; st.turn = (a[0] + 1) % 4; break;
      case 'bid': st.bids[a[0]] = a[1]; st.msg = `${name(a[0])}: ${a[1]}`; st.turn = (a[0] + 1) % 4; break;
      case 'r2': st.round2 = true; st.bids = {}; st.msg = 'الكل قال بس — الدور الثاني'; break;
      case 'redeal': st.msg = 'الكل قال بس مرتين — يُعاد التوزيع'; st.turn = -1; break;
      case 'contract': {
        const [type, tr, b, ak] = a;
        st.contract = { type, trump: tr, buyer: b, ashkal: !!ak };
        st.msg = type === 'sun' ? `${ak ? 'أشكل — ' : ''}صن لـ${name(b)}` : `حكم ${SYM[tr]} ${SNAME[tr]} لـ${name(b)}`; st.turn = -1; break;
      }
      case 'double': st.mult = Math.min(a[1], 4); st.gahwa = a[1] >= 5; st.msg = `${name(a[0])} ${V(a[0], 'قال', 'قلت')} ${a[2]}`; break;
      case 'play': st.locked = !!a[1]; st.bids = {}; st.msg = `بدأ اللعب${a[0] > 1 ? ` (×${n(a[0])})` : ''}${a[1] ? ' — مقفول' : ''}`; st.turn = (deal.dealer + 1) % 4; break;
      case 'card': {
        const [p, c] = a;
        if (st.trickDone) { st.trick = []; st.trickDone = false; st.winner = -1; }
        st.trick.push({ p, c }); st.gone[p].push(c);
        st.msg = `${name(p)} ${V(p, 'لعب', 'لعبت')} ${cardName(c)}`; st.turn = (p + 1) % 4; break;
      }
      case 'projbub': st.announced[a[0]] = (a[1] || []).map((t) => PROJ[t] || t).join(' + '); st.msg = `${name(a[0])}: ${st.announced[a[0]]}`; break;
      case 'baloot': st.baloot = a[0]; st.msg = `${name(a[0])}: بلوت`; break;
      case 'trick': {
        const [w, gain] = a;
        st.trickDone = true; st.winner = w; st.raw[team(w)] += gain; st.tricks[team(w)]++; st.trickNo++; st.turn = w;
        st.msg = `${V(w, `أكلها ${name(w)}`, 'أكلتها أنت')} (+${n(gain)} بنط)`; break;
      }
      case 'projshow': {
        const [w, show, ptsv, lost] = a;
        const who = Object.keys(show || {}).map((s) => `${name(+s)}: ${(show[s] || []).map((x) => PROJ[x.t] || x.t).join(' + ')}`).join('، ');
        st.msg = `المشروع لـ${teamLabel(w)} (+${n(ptsv)})${who ? ' — ' + who : ''}${lost ? ` · انلغى مشروع ${teamLabel(1 - w)}` : ''}`; break;
      }
      case 'summary': { const sm = a[0] || {}; st.summary = sm; if (sm.scores) st.scores = sm.scores.slice(); const fin = sm.fin || [0, 0]; st.msg = `${OUT[sm.outcome] || 'نهاية التوزيعة'} — ${teamLabel(0)} +${n(fin[0])} · ${teamLabel(1)} +${n(fin[1])}`; st.turn = -1; break; }
      case 'left': st.msg = `${name(a[0])} ${V(a[0], 'انسحب', 'انسحبت')} — اللعب الآلي كمّل مكان${V(a[0], 'ه', 'ك')}`; break;
      case 'afk': st.msg = `${V(a[0], `${name(a[0])} خلص وقته — انلعبت عنه`, 'خلص وقتك — انلعبت عنك')} حركة تلقائياً`; break;
      case 'join': st.msg = `${name(a[0])} ${V(a[0], 'جلس', 'جلست')}`; break;
      case 'back': st.msg = `${name(a[0])} ${V(a[0], 'رجع', 'رجعت')} للطاولة`; break;
      default: st.msg = '';
    }
  }
  return st;
}
const stepLabel = (deal, i, ctx) => stepState({ ...deal, events: deal.events.slice(i, i + 1), hands: null }, 0, ctx).msg;

/* ---------------- page ---------------- */
export async function render(main, params) {
  const id = params.id;
  const emptyState = (title, body, retry = false) => {
    mount(main, html`<div class="empty" role="status"><div class="art">🃏</div><b>${title}</b><span>${body}</span>
      <div class="row" style="justify-content:center">${retry ? raw('<button class="btn" id="mtRetry" type="button">جرّب مرة ثانية</button>') : ''}<a class="btn primary" href="/" data-link>الرئيسية</a></div></div>`);
    const b = main.querySelector('#mtRetry'); if (b) b.onclick = () => render(main, params);
  };
  if (!UUID.test(id || '')) { emptyState('ما لقينا هذي المباراة.', 'الرابط غير صحيح. افتح المباراة من سجل مبارياتك في ملفك.'); return undefined; }
  let m;
  try { m = await rpc('match_detail', { p_match: id }); }
  catch (e) {
    const code = String((e && e.code) || '');
    if (/not_found|forbidden|P0001|22P02|PGRST116/i.test(code) || /not_found/.test(String((e && e.message) || ''))) emptyState('ما تقدر تفتح هذي المباراة.', 'المباراة غير موجودة، أو تفاصيلها متاحة للاعبين فيها فقط.');
    else emptyState('تعذّر تحميل المباراة.', (e && e.message) || 'تأكد من الاتصال وجرّب.', true);
    return undefined;
  }
  if (!m) { emptyState('ما لقينا هذي المباراة.', 'ممكن تكون انحذفت.'); return undefined; }

  const players = Array.isArray(m.players) ? m.players : [];
  const bySeat = [0, 1, 2, 3].map((s) => players.find((p) => p.seat === s) || null);
  const results = Array.isArray(m.results) ? m.results : [];
  const resBySeat = [0, 1, 2, 3].map((s) => results.find((r) => r.seat === s) || null);
  const me = state.user && state.user.id;
  const mySeat = bySeat.findIndex((p) => p && p.uid === me);
  const persp = mySeat >= 0 ? mySeat : 0;
  const name = (p) => (p >= 0 && bySeat[p] ? (p === mySeat ? 'أنت' : bySeat[p].name || 'لاعب') : 'لاعب');
  const fullName = (p) => (bySeat[p] ? bySeat[p].name || 'لاعب' : '—');
  const teamLabel = (t) => (mySeat >= 0 ? (team(mySeat) === t ? 'فريقك' : 'الخصم') : t === 0 ? 'الفريق الأول' : 'الفريق الثاني');
  const tColor = (t) => ((mySeat >= 0 ? team(mySeat) : 0) === t ? 'var(--us)' : 'var(--them)');
  const teamNames = (t) => [t, t + 2].map(fullName).join(' و');
  const scores = [m.score0, m.score1];
  const finished = m.status !== 'playing';
  const deals = finished ? buildDeals(m.events) : [];
  const rounds = Array.isArray(m.rounds) ? m.rounds : [];
  const mins = m.started_at && m.ended_at ? Math.max(1, Math.round((new Date(m.ended_at) - new Date(m.started_at)) / 60000)) : null;
  const rows = ruleRows(m.rules);
  const changed = rows.filter((r) => !r.isDefault).length;

  let running = [0, 0];
  const roundRows = rounds.map(([rn, tc, b, t0, t1, code, mult, gahwa]) => {
    running = [running[0] + (t0 || 0), running[1] + (t1 || 0)];
    return html`<tr><td class="num">${n(rn)}</td><td>${tcText(tc)}${mult > 1 ? ` ×${n(mult)}` : ''}${gahwa ? ' · قهوة' : ''}</td><td>${fullName(b)}</td>
      <td>${OUT_CODE[code] || ''}</td><td class="num" style="color:${tColor(0)}">${n(t0)}</td><td class="num" style="color:${tColor(1)}">${n(t1)}</td>
      <td class="num small muted">${n(running[0])} / ${n(running[1])}</td></tr>`;
  });

  const teamBox = (t) => {
    const won = m.winner_team === t;
    return html`<div><div class="small muted">${teamLabel(t)}</div><div class="sc" style="color:${tColor(t)}">${scores[t] == null ? '—' : n(scores[t])}</div>
      <div class="small">${teamNames(t)}</div>${won ? raw('<div class="win">🏆 الفائز</div>') : ''}</div>`;
  };
  const playerRow = (s) => {
    const p = bySeat[s], r = resBySeat[s];
    const delta = r && r.rating_before != null && r.rating_after != null ? r.rating_after - r.rating_before : null;
    return html`<tr><td>${s === mySeat ? raw('<b>أنت</b> · ') : ''}${p ? p.name : '—'}</td><td>${teamLabel(team(s))}</td>
      <td>${r ? (r.result === 'win' ? 'فوز' : 'خسارة') : '—'}${r && r.abandoned ? raw(' <span class="chip warn">انسحب</span>') : ''}</td>
      <td class="num">${m.ranked && delta != null ? html`${n(r.rating_before)} ← ${n(r.rating_after)} <b class="mt-delta ${delta >= 0 ? 'up' : 'down'}">(${delta >= 0 ? '+' : '−'}${n(Math.abs(delta))})</b>` : m.ranked ? '—' : 'ما يتأثر'}</td>
      <td class="num">${r ? `+${n(r.xp || 0)}` : '—'}</td></tr>`;
  };

  mount(main, html`${raw(STYLE)}
    <div class="section-title" style="margin:0"><h1>تفاصيل المباراة</h1>
      <div class="row"><span class="chip ${m.ranked ? 'gold' : ''}">${m.ranked ? 'مصنّفة' : 'ودية'}</span><span class="chip ${m.status === 'playing' ? 'live' : ''}">${STATUS[m.status] || m.status}</span></div></div>

    <section class="card stack" aria-label="النتيجة النهائية">
      <div class="mt-teams">${teamBox(0)}<div class="vs">ضد</div>${teamBox(1)}</div>
      <div class="row small muted" style="justify-content:center;gap:16px">
        <span>البداية: ${fmtTime(m.started_at)}</span><span>النهاية: ${fmtTime(m.ended_at)}</span>${mins ? html`<span>المدة: ${n(mins)} دقيقة</span>` : ''}
        <span>نهاية الصكة: ${n((m.rules && m.rules.target) || 152)}</span></div>
    </section>

    <section class="card stack" aria-labelledby="mtPl"><h2 id="mtPl">اللاعبين والنتائج</h2>
      <div class="scroll-x"><table class="data"><thead><tr><th scope="col">اللاعب</th><th scope="col">الفريق</th><th scope="col">النتيجة</th><th scope="col">التصنيف</th><th scope="col">الخبرة</th></tr></thead>
      <tbody>${[0, 1, 2, 3].map(playerRow)}</tbody></table></div>
      ${results.length ? '' : raw('<p class="small muted" style="margin:0">التصنيف والخبرة تنحسب بعد نهاية المباراة.</p>')}
    </section>

    <section class="card stack" aria-labelledby="mtRd"><h2 id="mtRd">القيد</h2>
      ${rounds.length ? html`<div class="scroll-x"><table class="data"><thead><tr><th scope="col">#</th><th scope="col">النوع</th><th scope="col">المشتري</th><th scope="col">النتيجة</th>
        <th scope="col">${teamLabel(0)}</th><th scope="col">${teamLabel(1)}</th><th scope="col">المجموع</th></tr></thead><tbody>${roundRows}</tbody></table></div>`
        : raw('<p class="muted" style="margin:0">ما فيه توزيعات مسجّلة.</p>')}
    </section>

    <section class="card stack" aria-labelledby="mtRp"><h2 id="mtRp">إعادة المباراة</h2><div id="replay"></div></section>

    <details class="card"><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-family:var(--f-display);font-size:18px">قواعد المباراة${changed ? ` (${n(changed)} إعداد مختلف عن الافتراضي)` : ' (الإعدادات الافتراضية)'}</summary>
      <div class="scroll-x" style="margin-top:8px"><table class="data"><tbody>${rows.map((r) => html`<tr><td>${r.label}</td><td><b>${r.value}</b>${r.isDefault ? '' : raw(' <span class="chip warn">مختلف</span>')}</td></tr>`)}</tbody></table></div>
    </details>

    ${mySeat >= 0 ? html`<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" id="mtReport">⚑ الإبلاغ عن المباراة</button></div>` : ''}`);

  const cleanup = setupReplay(main.querySelector('#replay'), { deals, finished, name, persp, ctx: { name, me: mySeat, teamLabel } });
  const rb = main.querySelector('#mtReport');
  if (rb) rb.onclick = () => reportDialog(id);
  return cleanup;
}

/* ---------------- replay viewer ---------------- */
function setupReplay(box, { deals, finished, name, persp, ctx }) {
  if (!finished) { mount(box, html`<div class="empty"><div class="art">⏳</div><b>الإعادة تظهر بعد نهاية المباراة.</b><span>عشان ما تنكشف أوراق أحد والمباراة شغّالة.</span></div>`); return undefined; }
  if (!deals.length) { mount(box, html`<div class="empty"><div class="art">🗂️</div><b>ما فيه أحداث مسجّلة لهذي المباراة.</b></div>`); return undefined; }
  let di = Math.max(0, deals.findIndex((d) => d.status === 'done')), si = 0, timer = null;
  const dealLabel = (d, i) => (d.status === 'done' ? `التوزيعة ${n(d.n)}` : d.status === 'redeal' ? `توزيعة ملغاة (${n(i + 1)})` : `التوزيعة ${n(d.n)} (ما اكتملت)`);

  mount(box, html`
    <div class="row between">
      <div class="field" style="min-width:200px"><label for="rpDeal">التوزيعة</label>
        <select class="input" id="rpDeal">${deals.map((d, i) => html`<option value="${i}">${dealLabel(d, i)}${d.summary ? ` — ${tcText(d.summary.tc)}` : ''}</option>`)}</select></div>
      <span class="small muted" id="rpCount" aria-live="polite"></span>
    </div>
    <div class="rp-board" id="rpBoard" tabindex="0" aria-label="لوحة الإعادة — استخدم الأسهم للتنقل والمسافة للتشغيل"></div>
    <input type="range" class="rp-range" id="rpRange" min="0" value="0" aria-label="الخطوة">
    <div class="rp-ctrl" role="group" aria-label="التحكم في الإعادة">
      <button type="button" class="btn" id="rpFirst" aria-label="أول خطوة">⏮</button>
      <button type="button" class="btn" id="rpPrev" aria-label="الخطوة السابقة">→ السابق</button>
      <button type="button" class="btn primary" id="rpPlay" aria-pressed="false">▶ تشغيل</button>
      <button type="button" class="btn" id="rpNext" aria-label="الخطوة التالية">التالي ←</button>
      <button type="button" class="btn" id="rpLast" aria-label="آخر خطوة">⏭</button>
    </div>
    <details><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center">سجل الأحداث في هذي التوزيعة</summary><ol class="rp-log" id="rpLog"></ol></details>
    <p class="small muted" style="margin:0">الأيدي المعروضة هي ورق كل لاعب كامل بعد اكتمال التوزيع، وتختفي الأوراق وهي تنلعب.</p>`);
  const $ = (s) => box.querySelector(s);
  const vpos = (p) => (p - persp + 4) % 4;

  function seatTpl(p, st) {
    const ct = st.contract;
    const tags = [];
    if (st.dealer === p) tags.push(html`<span class="tag d">الموزّع</span>`);
    if (ct && ct.buyer === p) tags.push(html`<span class="tag">المشتري</span>`);
    if (st.bids[p]) tags.push(html`<span class="chip">${st.bids[p]}</span>`);
    if (st.announced[p]) tags.push(html`<span class="chip gold">${st.announced[p]}</span>`);
    if (st.baloot === p) tags.push(html`<span class="chip gold">بلوت</span>`);
    const hand = st.hands ? st.hands[p] : null;
    const isT = (c) => ct && ct.type === 'hokm' && c[1] === ct.trump;
    return html`<div class="rp-seat v${vpos(p)} t${team(p)} ${st.turn === p ? 'turn' : ''}">
      <span class="nm">${name(p)}</span><div class="rp-tags">${tags}</div>
      <div class="rp-hand" aria-label="ورق ${name(p)}">${hand ? hand.map((c) => pc(c, (st.gone[p].includes(c) ? 'gone' : '') + (isT(c) ? ' trump' : ''))) : raw('<span class="small muted">الورق غير متاح</span>')}</div></div>`;
  }
  function draw() {
    const d = deals[di], total = d.events.length;
    si = Math.max(0, Math.min(total - 1, si));
    const st = stepState(d, si, ctx);
    const ct = st.contract;
    const ctText = ct ? (ct.type === 'sun' ? '☀ صن' : `${SYM[ct.trump]} حكم ${SNAME[ct.trump]}`) + ` · المشتري ${name(ct.buyer)}` + (st.gahwa ? ' · قهوة' : st.mult > 1 ? ` · ×${n(st.mult)}` : '') + (st.locked ? ' · مقفول' : '') : st.round2 ? 'الشراء — الدور الثاني' : 'الشراء — الدور الأول';
    const U = team(persp);
    mount($('#rpBoard'), html`${[0, 1, 2, 3].map((p) => seatTpl(p, st))}
      <div class="rp-mid">
        <span class="chip">${ctText}</span>
        <div class="rp-trick" aria-live="polite">${st.trick.map((t) => html`<figure class="${st.trickDone && t.p === st.winner ? 'w' : ''}">${pc(t.c, ct && ct.type === 'hokm' && t.c[1] === ct.trump ? 'trump' : '')}<figcaption>${name(t.p)}</figcaption></figure>`)}</div>
        <div class="rp-msg">${st.msg}</div>
        <div class="small muted">الأكلة ${n(Math.min(8, st.trickNo + (st.trick.length && !st.trickDone ? 1 : 0)))} من ٨ · الأبناط: ${ctx.teamLabel(U)} ${n(st.raw[U])} · ${ctx.teamLabel(1 - U)} ${n(st.raw[1 - U])}</div>
        <div class="small"><b>النتيجة:</b> ${ctx.teamLabel(U)} <span style="color:var(--us)">${n(st.scores[U])}</span> · ${ctx.teamLabel(1 - U)} <span style="color:var(--them)">${n(st.scores[1 - U])}</span>${st.summary ? html` <span class="muted">(+${n(st.summary.fin[U])} / +${n(st.summary.fin[1 - U])})</span>` : ''}</div>
      </div>`);
    const r = $('#rpRange'); r.max = String(total - 1); r.value = String(si);
    r.setAttribute('aria-valuetext', `الخطوة ${si + 1} من ${total}`);
    $('#rpCount').textContent = `الخطوة ${n(si + 1)} من ${n(total)}`;
    $('#rpPrev').disabled = $('#rpFirst').disabled = si === 0;
    $('#rpNext').disabled = $('#rpLast').disabled = si === total - 1;
    const log = $('#rpLog');
    if (log.dataset.deal !== String(di)) {
      log.dataset.deal = String(di);
      mount(log, html`${d.events.map((_, i) => html`<li data-i="${i}">${stepLabel(d, i, ctx)}</li>`)}`);
    }
    log.querySelectorAll('li').forEach((li) => (+li.dataset.i === si ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
    if (timer && si === total - 1) stop();
  }
  function stop() { clearInterval(timer); timer = null; const b = $('#rpPlay'); if (b) { b.textContent = '▶ تشغيل'; b.setAttribute('aria-pressed', 'false'); } }
  function play() {
    if (timer) return stop();
    if (si >= deals[di].events.length - 1) si = 0;
    timer = setInterval(() => { si++; draw(); }, 850);
    $('#rpPlay').textContent = '⏸ إيقاف'; $('#rpPlay').setAttribute('aria-pressed', 'true');
    draw();
  }
  const go = (k) => { stop(); si = k; draw(); };
  $('#rpDeal').value = String(di);
  $('#rpDeal').onchange = (e) => { stop(); di = Number(e.target.value); si = 0; draw(); };
  $('#rpFirst').onclick = () => go(0);
  $('#rpLast').onclick = () => go(deals[di].events.length - 1);
  $('#rpPrev').onclick = () => go(si - 1);
  $('#rpNext').onclick = () => go(si + 1);
  $('#rpPlay').onclick = play;
  $('#rpRange').oninput = (e) => go(Number(e.target.value));
  $('#rpLog').onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) go(Number(li.dataset.i)); };
  $('#rpBoard').addEventListener('keydown', (e) => {
    const k = { ArrowLeft: 1, ArrowRight: -1 }[e.key];             // RTL: left = forward
    if (k) { e.preventDefault(); go(si + k); }
    else if (e.key === ' ') { e.preventDefault(); play(); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(deals[di].events.length - 1); }
  });
  draw();
  return () => stop();
}

/* ---------------- report ---------------- */
function reportDialog(id) {
  const d = dialog(html`<h2>الإبلاغ عن المباراة</h2>
    <form id="rpF" class="stack" novalidate>
      <fieldset class="stack" style="border:0;padding:0;margin:0;gap:4px"><legend class="lbl">وش المشكلة؟</legend>
        ${REASONS.map(([v, t], i) => html`<label class="row" style="min-height:44px;gap:8px;cursor:pointer"><input type="radio" name="reason" value="${v}" ${raw(i === 0 ? 'checked' : '')}> ${t}</label>`)}
      </fieldset>
      <div class="field"><label for="rpDet">تفاصيل (اختياري، إلا إذا اخترت «سبب ثاني»)</label>
        <textarea class="input" id="rpDet" maxlength="500" rows="3" placeholder="مثلاً: رقم التوزيعة ووش صار"></textarea><span class="hint" id="rpCnt">٠ / ٥٠٠</span></div>
      <p class="error" id="rpErr" role="alert"></p>
      <p class="small muted" style="margin:0">فريق الإشراف يراجع البلاغ مع سجل المباراة كامل. البلاغات الكاذبة ممكن تعرّض حسابك للإيقاف.</p>
      <div class="actions"><button class="btn" type="button" data-close>إلغاء</button><button class="btn primary" type="submit">أرسل البلاغ</button></div>
    </form>`, { label: 'الإبلاغ عن المباراة' });
  const f = d.el.querySelector('#rpF'), det = d.el.querySelector('#rpDet'), err = d.el.querySelector('#rpErr');
  det.oninput = () => { d.el.querySelector('#rpCnt').textContent = `${n(det.value.length)} / ٥٠٠`; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const reason = (f.querySelector('input[name="reason"]:checked') || {}).value;
    const details = det.value.trim();
    if (!reason) { err.textContent = 'اختر سبب البلاغ.'; return; }
    if (reason === 'other' && details.length < 5) { err.textContent = 'اكتب وش صار بالتفصيل.'; det.focus(); return; }
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); err.textContent = '';
    try {
      await rpc('report_submit', { p_kind: 'match', p_target: null, p_ref: id, p_reason: reason, p_details: details });
      d.close('sent');
      toast('وصلنا بلاغك، شكراً لك. فريق الإشراف بيراجعه.');
    } catch (x) { err.textContent = (x && x.message) || 'تعذّر إرسال البلاغ.'; }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  };
}
