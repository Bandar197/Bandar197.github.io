// Training (/training hub, /training/:mode fullscreen play). Local only: no server calls, nothing counts toward rating or XP.
// Play mode wraps the shared table (table.js) with a local engine game, bots on seats 1–3 and the human on seat 0.
// Every human decision is recorded next to the engine's recommendation ('hard' level, same game state, before the move).
import * as E from '../engine.js';
import { createTable, cardHTML, cardName } from '../table.js';
import { html, raw, mount, dialog, confirmBox, toast, n } from '../ui.js';
import { navigate } from '../router.js';

const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'شريا', H: 'هاص', D: 'ديمن', C: 'سبيت' };
const RNAME = { 7: 'سبعة', 8: 'ثمانية', 9: 'تسعة', T: 'عشرة', J: 'ولد', Q: 'بنت', K: 'شايب', A: 'إكة' };
const PROJ = { sira: 'سرا', 50: 'خمسين', 100: 'مية', 400: 'أربعمية' };
const LEVELS = [['easy', 'سهل'], ['mid', 'متوسط'], ['hard', 'محترف']];
const TARGETS = [101, 152];
const FIX = () => 0.5;                         // deterministic randomness for recommendations
const LABEL = 'تدريب — ما يحسب في التصنيف';
const PREF_KEY = 'diwaniya.training';
const RED = (s) => s === 'H' || s === 'D';
const pc = (c, extra = '') => raw(cardHTML(c, extra));
const sortHand = (h) => h.slice().sort((a, b) => E.SUITS.indexOf(a[1]) - E.SUITS.indexOf(b[1]) || E.RANKS.indexOf(b[0]) - E.RANKS.indexOf(a[0]));

function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); return { level: LEVELS.some((l) => l[0] === p.level) ? p.level : 'mid', target: TARGETS.includes(p.target) ? p.target : 152 }; }
  catch { return { level: 'mid', target: 152 }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

/* =====================================================================================
   Scenarios: a rigged deck makes the real engine deal exact hands, then a script of real
   moves (bids, doubles, cards) brings the game to the decision point. Nothing is faked.
   ===================================================================================== */

/** A rnd() that makes E.shuffle(FULL) produce exactly `deck`, then falls back to Math.random. */
export function riggedRnd(deck) {
  const a = E.FULL.slice(), vals = [];
  for (let i = a.length - 1; i > 0; i--) { const j = a.indexOf(deck[i]); vals.push((j + 0.5) / (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  let k = 0;
  return () => (k < vals.length ? vals[k++] : Math.random());
}
/** Deck order so that startRound + dealRest give each seat `hands[p]` (taker's hand includes the face-up `flip`). */
export function deckFor({ dealer, hands, flip, taker }) {
  const first = [], rest = [];
  for (let p = 0; p < 4; p++) {
    const h = p === taker ? hands[p].filter((c) => c !== flip) : hands[p].slice();
    first[p] = h.slice(0, 5); rest[p] = h.slice(5);
  }
  const pops = [];
  for (const [from, cnt] of [[0, 3], [3, 2]]) for (let i = 1; i <= 4; i++) { const p = (dealer + i) % 4; pops.push(...first[p].slice(from, from + cnt)); }
  pops.push(flip);
  for (let i = 1; i <= 4; i++) pops.push(...rest[(dealer + i) % 4]);
  const all = new Set(pops);
  if (pops.length !== 32 || all.size !== 32 || E.FULL.some((c) => !all.has(c))) throw new Error('scenario deck is not a full 32-card deck');
  return pops.reverse();                           // the engine pops from the end
}

export const SCENARIOS = [
  {
    title: 'اسحب الحكم', icon: '♠',
    blurb: 'اشتريت حكم شريا ومعك الولد والتسعة والإكة. أنت أول واحد يلعب — وش تبدأ فيه؟',
    lesson: 'المشتري اللي معه أكبر حكم باقي يبدأ فيه ويسحب حكم الخصوم، عشان ما يقطعون إكك وكبارك بعدين.',
    dealer: 3, flip: '8S', taker: 0, decision: 'card',
    hands: [
      ['JS', '9S', 'AH', 'KH', 'AD', 'AS', '7C', '8S'],
      ['TS', '7S', 'QH', '9H', '8D', '9D', 'KC', '8C'],
      ['KS', '8H', '7H', 'TD', 'JD', 'QD', 'AC', 'TC'],
      ['QS', 'JH', 'TH', '7D', 'KD', 'QC', 'JC', '9C'],
    ],
    script: [[0, 'bid', { t: 'hokm' }], [1, 'bid', { t: 'pass' }], [2, 'bid', { t: 'pass' }], [3, 'bid', { t: 'pass' }], [1, 'double', false], [3, 'double', false]],
  },
  {
    title: 'اعطِ خويك الأبناط', icon: '🤝',
    blurb: 'صن لخويك. الخصم بدأ بسبعة هاص، وخويك نزل الإكة، وأنت آخر واحد ومعك العشرة والثمانية.',
    lesson: 'إذا خويك ماسك الأكلة بورقة مضمونة وأنت آخر واحد، عطه أكثر أبناط تقدر عليها — الأكلة لكم أكيد.',
    dealer: 0, flip: 'KD', taker: 2, decision: 'card',
    hands: [
      ['TH', '8H', 'KS', 'QS', '9C', '8C', '7D', '8D'],
      ['7H', 'QH', '7S', '8S', 'AC', '7C', '9D', 'TD'],
      ['AH', 'KH', 'AS', 'TS', 'TC', 'JC', 'AD', 'KD'],
      ['9H', 'JH', '9S', 'JS', 'KC', 'QC', 'JD', 'QD'],
    ],
    script: [[1, 'bid', { t: 'pass' }], [2, 'bid', { t: 'sun' }], [1, 'card', '7H'], [2, 'card', 'AH'], [3, 'card', '9H']],
  },
  {
    title: 'متى تشتري صن', icon: '☀',
    blurb: 'أنت أول واحد في الشراء. معك ثلاث إكك وعشرة شريا، والمكشوفة تسعة سبيت. وش تقول؟',
    lesson: 'الصن يبي إكك وعشرات مسنودة؛ ثلاث إكك مع عشرة تحت إكتها يد صن ممتازة، والحكم بنوع ما عندك منه شي ضعيف.',
    dealer: 3, flip: '9C', taker: 0, decision: 'bid',
    hands: [
      ['AS', 'AH', 'AD', 'TS', 'KC', 'QS', '7H', '9C'],
      ['7S', '8S', 'TH', 'AC', '8C', 'KD', 'QD', '9D'],
      ['9S', 'KS', '8H', '9H', 'JH', '7C', 'TD', 'JD'],
      ['JS', 'QH', 'KH', 'TC', 'JC', 'QC', '7D', '8D'],
    ],
    script: [],
  },
  {
    title: 'قطع الخصم', icon: '✂',
    blurb: 'حكم ديمن لخويك. الخصم بدأ بإكة سبيت وما عندك سبيت. معك سبعة وبنت وشايب ديمن — بأي ورقة تقطع؟',
    lesson: 'إذا لازم تقطع وأنت آخر واحد، اقطع بأصغر حكم يكفي واحفظ الكبار (والشايب والبنت معك بلوت!).',
    dealer: 0, flip: 'JD', taker: 2, decision: 'card',
    hands: [
      ['7D', 'QD', 'KD', 'AS', 'KS', 'QS', 'AH', 'TH'],
      ['TD', 'AC', '7C', 'TS', '9S', 'KH', 'QH', 'JH'],
      ['9D', 'AD', '8C', 'KC', 'JS', '9H', '8H', 'JD'],
      ['8D', '9C', 'TC', 'JC', 'QC', '7S', '8S', '7H'],
    ],
    script: [[1, 'bid', { t: 'pass' }], [2, 'bid', { t: 'hokm' }], [3, 'bid', { t: 'pass' }], [0, 'bid', { t: 'pass' }], [3, 'double', false], [1, 'double', false],
      [1, 'card', 'AC'], [2, 'card', '8C'], [3, 'card', '9C']],
  },
  {
    title: 'متى تدبّل', icon: '×٢',
    blurb: 'الخصم اشترى حكم شريا، وأنت معك الولد والتسعة والإكة من الشريا. خويك ما دبّل — تدبّل؟',
    lesson: 'إذا معك كبار الحكم (الولد والتسعة) والمشتري بيحتاجها، الدبل فرصة تضاعف خسارته. بس انتبه: لو كسب، يتضاعف عليكم.',
    dealer: 0, flip: 'KS', taker: 1, decision: 'double',
    hands: [
      ['JS', '9S', 'AS', 'AH', '7C', '7H', '8D', '9D'],
      ['TS', '7S', 'AC', 'AD', 'KH', 'KC', 'TD', 'KS'],
      ['8S', 'QH', 'JH', 'TH', 'QC', '9C', 'KD', '7D'],
      ['QS', '9H', '8H', 'JC', 'TC', '8C', 'QD', 'JD'],
    ],
    script: [[1, 'bid', { t: 'hokm' }], [2, 'bid', { t: 'pass' }], [3, 'bid', { t: 'pass' }], [0, 'bid', { t: 'pass' }], [2, 'double', false]],
  },
];

/** Builds the scenario's game with the real engine; G.req is the human's decision. */
export function buildScenario(sc, target = 152) {
  const G = E.newGame({ rules: { target }, dealer: sc.dealer });
  E.startRound(G, riggedRnd(deckFor(sc)));
  for (const [p, kind, v] of sc.script) E.act(G, p, kind, v);
  if (!G.req || G.req.p !== 0 || G.req.k !== sc.decision) throw new Error('scenario did not reach its decision');
  return G;
}

/* ---------------- recommendations & labels ---------------- */
const bidLabel = (v, flipSuit) => (!v ? '' : v.t === 'hokm' ? `حكم ${SYM[flipSuit]}` : v.t === 'hokm2' ? `حكم ${SYM[v.s]}` : { sun: 'صن', ashkal: 'أشكل', pass: 'بس' }[v.t] || v.t);
function doubleWhy(G, yes, level) {
  const T = G.contract.trump, t = G.hands[0].filter((c) => c[1] === T);
  const big = t.filter((c) => c[0] === 'J' || c[0] === '9').map((c) => RNAME[c[0]]);
  if (level === 2) return yes
    ? `معك ${n(t.length)} من الحكم${big.length ? ` ومنها ${big.join(' و')}` : ''}؛ فرصتك تكسر المشتري، والدبل يضاعف النقاط.`
    : 'يدك في الحكم ما تكفي تكسر المشتري، ولو دبّلت وكسب تتضاعف النقاط عليكم.';
  return yes ? 'يدك قوية بما يكفي ترفع اللعب درجة.' : 'ما يستاهل ترفع المخاطرة بهذي اليد؛ الأسلم «لا».';
}
/** The engine's recommendation for the pending human request, computed before the move. */
export function recommend(G) {
  const q = G.req;
  if (q.k === 'card') { const r = E.chooseCard(G, 0, 'hard', FIX); return { v: r.card, why: r.why }; }
  if (q.k === 'bid') { const r = E.botBid(G, 0, q.d.round, q.d.opts, 'hard', FIX); return { v: r.s ? { t: r.t, s: r.s } : { t: r.t }, why: r.why }; }
  if (q.k === 'double') { const yes = !!E.botDecision(G, 'hard', FIX); return { v: yes, why: doubleWhy(G, yes, q.d.level) }; }
  return null;
}
const sameChoice = (kind, a, b) => (kind === 'bid' ? a.t === b.t && (a.t !== 'hokm2' || a.s === b.s) : a === b);
function describe(d, which) {
  const v = which === 'mine' ? d.mine : d.rec;
  if (d.kind === 'card') return html`<span class="tr-mini">${pc(v)}</span><span>${cardName(v)}</span>`;
  if (d.kind === 'bid') return html`<b>${bidLabel(v, d.flipSuit)}</b>`;
  return html`<b>${v ? d.word : 'لا'}</b>`;
}
const whereLabel = (d) => (d.kind === 'card' ? `التوزيعة ${n(d.round)} · الأكلة ${n(d.trick)}` : d.kind === 'bid' ? `التوزيعة ${n(d.round)} · الشراء${d.bidRound === 2 ? ' (الدور الثاني)' : ''}` : `التوزيعة ${n(d.round)} · ${d.word}`);

/* =====================================================================================
   Styles (scoped to training)
   ===================================================================================== */
const STYLE = `<style>
.tr-cards{display:flex;flex-wrap:wrap;gap:6px;--cw:46px;--ch:65px}
.tr-cb{border:0;background:none;padding:3px;border-radius:10px;min-width:44px;min-height:44px;cursor:pointer;transition:transform .12s}
.tr-cb:hover{transform:translateY(-4px)}
.tr-cb.good .pc{box-shadow:0 0 0 3px var(--us)}
.tr-cb.bad .pc{box-shadow:0 0 0 3px var(--danger)}
.tr-cb.show .pc{box-shadow:0 0 0 3px var(--us);opacity:.9}
.tr-trick{display:flex;flex-wrap:wrap;gap:10px;--cw:44px;--ch:62px;align-items:flex-end}
.tr-trick figure{margin:0;text-align:center;font-size:12px;color:var(--muted)}
.tr-fb{min-height:1.6em;line-height:1.8}
.tr-fb.good{color:var(--us)} .tr-fb.bad{color:var(--danger)}
.tr-steps{display:flex;gap:4px;flex-wrap:wrap}
.tr-steps button{width:30px;height:30px;min-height:30px;border-radius:50%;border:1px solid var(--line-2);background:var(--bg-2);color:var(--muted);font-size:13px;padding:0}
.tr-steps button[aria-current="step"]{background:var(--gold);color:var(--gold-ink);border-color:var(--gold)}
.tr-step{min-height:280px}
.tr-step p,.tr-step li{line-height:1.9}
.tr-order{display:flex;flex-wrap:wrap;gap:8px;--cw:42px;--ch:59px}
.tr-order figure{margin:0;text-align:center;font-size:12px}
.tr-order figcaption span{display:block;color:var(--muted)}
.tr-mini{display:inline-block;--cw:30px;--ch:43px;vertical-align:middle}
.tr-prev{display:flex;gap:2px;flex-wrap:wrap;--cw:28px;--ch:40px}
.tr-rev{list-style:none;padding:10px 0;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
.tr-rev:last-child{border-bottom:0}
.tr-rev .row{gap:6px}
.tr-why{border-inline-start:3px solid var(--info);padding:4px 10px;background:var(--bg-2);border-radius:8px;font-size:14px}
.tr-badge{position:absolute;top:10px;right:12px;z-index:9;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:44%}
.tr-badge .chip{font-size:11.5px;background:rgba(6,24,15,.85)}
.tr-badge .btn{min-height:44px;font-size:13px;padding:4px 12px}
@media (max-width:640px){.tr-badge{top:auto;bottom:calc(var(--ch) * .95 + 80px);right:8px}}
</style>`;

/* =====================================================================================
   Tutorial: short interactive steps, every answer checked by the engine
   ===================================================================================== */
const quizG = (type, trump, hand, trick, rules = {}) => ({ rules: E.makeRules(rules), contract: type === 'hokm' ? { type, trump, buyer: 1 } : { type: 'sun', buyer: 1 }, hands: [hand, [], [], []], trick, locked: false, played: [] });
const WHO = { 1: 'الخصم (يمينك)', 2: 'خويك', 3: 'الخصم (يسارك)' };
function trickTpl(trick) {
  return html`<div class="tr-trick" aria-label="الورق على الطاولة">${trick.map((t) => html`<figure>${pc(t.c)}<figcaption>${WHO[t.p]}</figcaption></figure>`)}</div>`;
}
function orderTpl(type, suit) {
  const G = quizG(type, suit, [], []), ord = (type === 'hokm' ? E.ORD_T : E.ORD_N).slice().reverse();
  return html`<div class="tr-order">${ord.map((r) => html`<figure>${pc(r + suit, type === 'hokm' ? 'trump' : '')}<figcaption><b>${RNAME[r]}</b><span>${n(E.pts(G, r + suit))} بنط</span></figcaption></figure>`)}</div>`;
}
/** A "tap the legal card" quiz: feedback comes from E.legal on a real mini game state. */
function legalQuiz({ type, trump, hand, trick, ask, rightWhy, rules }) {
  const G = quizG(type, trump, hand, trick, rules);
  const ok = E.legal(G, 0);
  return {
    body: html`<p>${ask}</p>${trickTpl(trick)}<p class="small muted" style="margin:8px 0 4px">ورقك — اضغط على ورقة تقدر تلعبها:</p>
      <div class="tr-cards" role="group" aria-label="ورقك">${sortHand(hand).map((c) => html`<button type="button" class="tr-cb" data-c="${c}" aria-label="${cardName(c)}">${pc(c, type === 'hokm' && c[1] === trump ? 'trump' : '')}</button>`)}</div>
      <p class="tr-fb" role="status" aria-live="polite"></p>`,
    wire(el) {
      const fb = el.querySelector('.tr-fb');
      el.querySelectorAll('.tr-cb').forEach((b) => (b.onclick = () => {
        el.querySelectorAll('.tr-cb').forEach((x) => x.classList.remove('good', 'bad', 'show'));
        const c = b.dataset.c;
        if (ok.includes(c)) {
          b.classList.add('good'); fb.className = 'tr-fb good';
          fb.textContent = `✅ صح — ${cardName(c)} مسموحة. ${rightWhy}${ok.length > 1 ? ` (المسموح: ${ok.map(cardName).join('، ')})` : ''}`;
        } else {
          b.classList.add('bad'); ok.forEach((x) => { const e2 = el.querySelector(`.tr-cb[data-c="${x}"]`); if (e2) e2.classList.add('show'); });
          fb.className = 'tr-fb bad'; fb.textContent = `❌ ما تنلعب. ${rightWhy} المسموح: ${ok.map(cardName).join('، ')}.`;
        }
      }));
    },
  };
}
function projectsQuiz() {
  let hand, type;
  const fresh = () => {
    for (let i = 0; i < 60; i++) {
      type = Math.random() < 0.5 ? 'sun' : 'hokm';
      hand = E.shuffle(E.FULL.slice()).slice(0, 8);
      if (E.findProjects(type, hand).length || Math.random() < 0.2) break;
    }
  };
  const OPTS = [['none', 'ما فيه مشروع'], ['sira', 'سرا'], ['50', 'خمسين'], ['100', 'مية'], ['400', 'أربعمية']];
  return {
    body: html`<p>كل يد ممكن يكون فيها مشروع: <b>سرا</b> (٣ متتالية من نفس النوع)، <b>خمسين</b> (٤ متتالية)، <b>مية</b> (٥ متتالية، أو أربع شياب/بنات/أولاد/عشرات، أو أربع إكك في الحكم)، <b>أربعمية</b> (أربع إكك في الصن). التتالي بالترتيب الطبيعي: ٧ ٨ ٩ ١٠ ولد بنت شايب إكة.</p>
      <p><b id="tqType"></b> — وش أكبر مشروع في هذي اليد؟</p>
      <div class="tr-cards" id="tqHand" aria-label="اليد"></div>
      <div class="row" role="group" aria-label="الإجابة" style="margin-top:8px">${OPTS.map(([v, t]) => html`<button type="button" class="btn small" data-a="${v}">${t}</button>`)}</div>
      <p class="tr-fb" role="status" aria-live="polite"></p>
      <button type="button" class="btn small" id="tqNew">يد جديدة</button>`,
    wire(el) {
      const fb = el.querySelector('.tr-fb');
      const show = () => {
        fresh();
        el.querySelector('#tqType').textContent = type === 'sun' ? 'اللعب صن' : 'اللعب حكم';
        mount(el.querySelector('#tqHand'), html`${sortHand(hand).map((c) => pc(c))}`);
        fb.className = 'tr-fb'; fb.textContent = '';
      };
      el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
        const found = E.findProjects(type, hand), best = found.length ? found[0].t : 'none';
        const list = found.slice(0, 2).map((p) => `${PROJ[p.t]} (${p.cards.map(cardName).join('، ')})`).join(' + ');
        if (b.dataset.a === best) { fb.className = 'tr-fb good'; fb.textContent = best === 'none' ? '✅ صح — ما فيه مشروع في هذي اليد.' : `✅ صح — ${list}.`; }
        else { fb.className = 'tr-fb bad'; fb.textContent = best === 'none' ? '❌ ما فيه مشروع هنا: ما فيه ٣ متتالية من نوع واحد ولا أربعة من رتبة.' : `❌ أكبر مشروع: ${PROJ[best]} — ${list}.`; }
      }));
      el.querySelector('#tqNew').onclick = show;
      show();
    },
  };
}
function scoringQuiz() {
  let type, abnat;
  return {
    body: html`<p>الأبناط تتحول نقاط: <b>الصن</b> الآحاد ٠–٤ تنزل، ٥ تبقى نص (+١)، ٦–٩ تطلع، ثم ×٢ (المجموع ٢٦). <b>الحكم</b> الآحاد ٠–٥ تنزل و٦–٩ تطلع (المجموع ١٦). الخصم ياخذ الباقي.</p>
      <p id="tsQ" style="font-size:18px"></p>
      <form class="row" id="tsF"><label class="sr-only" for="tsIn">النقاط</label><input class="input" id="tsIn" type="number" inputmode="numeric" min="0" max="60" style="width:120px" required placeholder="النقاط"><button class="btn primary" type="submit">تحقّق</button><button class="btn" type="button" id="tsNew">سؤال جديد</button></form>
      <p class="tr-fb" role="status" aria-live="polite"></p>`,
    wire(el) {
      const fb = el.querySelector('.tr-fb'), inp = el.querySelector('#tsIn');
      const ask = () => {
        type = Math.random() < 0.5 ? 'sun' : 'hokm';
        abnat = type === 'sun' ? 20 + Math.floor(Math.random() * 91) : 30 + Math.floor(Math.random() * 103);
        el.querySelector('#tsQ').textContent = `المشتري في ${type === 'sun' ? 'الصن' : 'الحكم'} جاب ${n(abnat)} بنط (وكسب). كم نقطة ياخذ؟`;
        inp.value = ''; fb.className = 'tr-fb'; fb.textContent = '';
      };
      el.querySelector('#tsF').onsubmit = (e) => {
        e.preventDefault();
        const v = Number(String(inp.value).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
        const right = type === 'sun' ? E.sunPoints(abnat) : E.hokmPoints(abnat), total = type === 'sun' ? 26 : 16, u = abnat % 10;
        const how = type === 'sun'
          ? `الآحاد ${n(u)} ${u === 5 ? 'تبقى نص' : u >= 6 ? 'تطلع' : 'تنزل'}، فتصير ${n(right / 2)} × ٢ = ${n(right)}`
          : `الآحاد ${n(u)} ${u >= 6 ? 'تطلع' : 'تنزل'}، فتصير ${n(right)}`;
        if (v === right) { fb.className = 'tr-fb good'; fb.textContent = `✅ صح — ${how}، والخصم ياخذ ${n(total - right)}.`; }
        else { fb.className = 'tr-fb bad'; fb.textContent = `❌ الجواب ${n(right)}: ${how}، والخصم ياخذ ${n(total - right)}.`; }
      };
      el.querySelector('#tsNew').onclick = () => { ask(); inp.focus(); };
      ask();
    },
  };
}
function tutorialSteps() {
  const st = (title, body, wire) => ({ title, body, wire });
  const s = [];
  s.push(st('الفريقين والورق', html`<ul>
      <li>أربعة لاعبين: أنت وخويك متقابلين ضد فريق ثاني.</li>
      <li>الورق ٣٢ ورقة: من السبعة إلى الإكة في أربعة أنواع: شريا ${SYM.S}، هاص ${SYM.H}، سبيت ${SYM.C}، ديمن ${SYM.D}.</li>
      <li>اللعب يمشي لليمين، وكل لاعب ياخذ ٨ أوراق في التوزيعة.</li>
      <li>الهدف: أول فريق يوصل ١٥٢ نقطة (أو الحد اللي اخترتوه) يكسب «الصكة».</li></ul>
      <div class="tr-cards">${['AS', 'AH', 'AC', 'AD'].map((c) => pc(c))}</div>`));
  s.push(st('الشراء', html`<p>يتوزع لكل لاعب ٥ أوراق وتنكشف ورقة. بالدور من يمين الموزّع، كل واحد يقول:</p>
      <ul><li><b>حكم</b>: نوع الورقة المكشوفة يصير «حكم» يغلب كل الأنواع.</li><li><b>صن</b>: بدون حكم، والنقاط مضاعفة. الصن يغلب الحكم.</li>
      <li><b>أشكل</b>: للثالث والرابع فقط — صن، والمكشوفة تروح لخويك.</li><li><b>بس</b>: ما تبي.</li></ul>
      <p>المشتري ياخذ المكشوفة + ورقتين، والباقين ٣ أوراق. إذا الكل قال بس، فيه دور ثاني تختار فيه حكم بنوع ثاني أو صن.</p>
      <div class="tr-cards">${pc('JH')}<span class="small muted" style="align-self:center">مثال: المكشوفة ولد هاص — «حكم» يعني الهاص حكم.</span></div>`));
  s.push(st('ترتيب الورق في الصن', html`<p>في الصن (والأنواع غير الحكم) العشرة ثاني أكبر ورقة بعد الإكة:</p>${orderTpl('sun', 'H')}
      <p class="small muted">المجموع ١٢٠ بنط + ١٠ للي ياخذ آخر أكلة = ١٣٠.</p>`));
  s.push(st('ترتيب الورق في الحكم', html`<p>في نوع الحكم الولد أكبر ورقة ثم التسعة — وأي حكم يغلب أي ورقة من نوع ثاني:</p>${orderTpl('hokm', 'S')}
      <p class="small muted">المجموع في الحكم ١٥٢ + ١٠ للأخيرة = ١٦٢.</p>`));
  const q1 = legalQuiz({ type: 'sun', hand: ['AH', '9H', 'KS', '7S', 'QD', 'TC', '8C', 'JD'], trick: [{ p: 3, c: 'TS' }],
    ask: 'صن. الخصم بدأ بعشرة شريا. لازم تنزل من نفس النوع إذا عندك.', rightWhy: 'عندك شريا، فلازم تنزل منها.' });
  s.push(st('اتبع النوع', q1.body, q1.wire));
  const q2 = legalQuiz({ type: 'hokm', trump: 'H', hand: ['7H', 'QH', 'KS', '9S', '8C', 'TC', 'JC', 'AS'], trick: [{ p: 3, c: 'AD' }],
    ask: 'حكم هاص. الخصم بدأ بإكة ديمن، وما عندك ديمن.', rightWhy: 'ما عندك من النوع، وفي الحكم لازم تقطع بالحكم.' });
  s.push(st('القطع بالحكم', q2.body, q2.wire));
  const q3 = legalQuiz({ type: 'hokm', trump: 'S', hand: ['KS', '9S', '7S', 'AH', 'TH', '8C', '9C', 'JC'], trick: [{ p: 1, c: 'AD' }, { p: 2, c: '7D' }, { p: 3, c: 'QS' }],
    ask: 'حكم شريا. بدأوا بإكة ديمن، وخويك نزل سبعة، والخصم قطع ببنت شريا. ما عندك ديمن.', rightWhy: 'لازم تكبّر على حكم الخصم إذا تقدر (الشايب أو التسعة أكبر من البنت).' });
  s.push(st('التكبير (الدق فوق الدق)', q3.body, q3.wire));
  const q4 = projectsQuiz();
  s.push(st('المشاريع', q4.body, q4.wire));
  const q5 = scoringQuiz();
  s.push(st('الحساب', q5.body, q5.wire));
  s.push(st('الدبل والكبوت', html`<ul>
      <li>المشتري لازم يجيب أبناط (مع مشاريعه) <b>أكثر</b> من الخصم، وإلا الخصم ياخذ النقاط كلها.</li>
      <li><b>الدبل</b> في الحكم: الخصم يقول دبل (×٢)، المشتري ثري (×٣)، الخصم فور (×٤)، المشتري قهوة (الصكة كاملة).</li>
      <li><b>الكبوت</b>: إذا فريق أخذ الأكلات الثمان = ٤٤ في الصن و٢٥ في الحكم.</li>
      <li><b>البلوت</b>: الشايب والبنت من الحكم بيد واحدة = نقطتين.</li></ul>
      <p>جاهز؟ جرّب السيناريوهات تحت، أو العب صكة كاملة ضد البوتات. والقواعد بالتفصيل في <a href="/rules" data-link>صفحة القواعد</a>.</p>`));
  return s;
}

/* =====================================================================================
   Hub
   ===================================================================================== */
function renderHub(main) {
  const P = loadPrefs();
  const steps = tutorialSteps();
  let step = 0;
  const previews = SCENARIOS.map((sc) => { try { const G = buildScenario(sc); return sortHand(G.hands[0]); } catch { return []; } });

  mount(main, html`${raw(STYLE)}
    <div class="section-title" style="margin:0"><h1>التدريب</h1><span class="chip gold">${LABEL}</span></div>
    <p class="muted" style="margin:0">تعلّم القواعد خطوة خطوة، جرّب مواقف حقيقية، والعب ضد بوتات بثلاث مستويات — كله على جهازك وبدون أي تأثير على تصنيفك.</p>

    <section class="card stack" aria-labelledby="tutH">
      <div class="section-title" style="margin:0"><h2 id="tutH">تعلّم القواعد</h2><span class="small muted" id="tutCount"></span></div>
      <nav class="tr-steps" aria-label="خطوات الدرس">${steps.map((s, i) => html`<button type="button" data-step="${i}" aria-label="الخطوة ${n(i + 1)}: ${s.title}">${n(i + 1)}</button>`)}</nav>
      <div class="tr-step" id="tutBody" tabindex="-1"></div>
      <div class="row between"><button type="button" class="btn" id="tutPrev">→ السابق</button><button type="button" class="btn primary" id="tutNext">التالي ←</button></div>
    </section>

    <section class="card stack" aria-labelledby="botsH">
      <h2 id="botsH">العب ضد البوتات</h2>
      <p class="muted small" style="margin:0">أنت وخويك (بوت) ضد بوتين. التلميحات وعداد الورق شغّالة، وبعد كل توزيعة تقدر تراجع قراراتك.</p>
      <div class="row"><span class="lbl" id="lvlL">الصعوبة</span><div class="seg" role="group" aria-labelledby="lvlL">${LEVELS.map(([v, t]) => html`<button type="button" data-level="${v}" aria-pressed="${P.level === v ? 'true' : 'false'}">${t}</button>`)}</div></div>
      <div class="row"><span class="lbl" id="tgtL">نهاية الصكة</span><div class="seg" role="group" aria-labelledby="tgtL">${TARGETS.map((v) => html`<button type="button" data-target="${v}" aria-pressed="${P.target === v ? 'true' : 'false'}">${n(v)}</button>`)}</div></div>
      <div><button type="button" class="btn primary big" id="startBots">ابدأ صكة تدريب</button></div>
    </section>

    <section class="stack" aria-labelledby="scH">
      <div class="section-title" style="margin:0"><h2 id="scH">سيناريوهات</h2><span class="small muted">قرّر أنت، وبعدها نوريك اقتراح المحرك وسببه</span></div>
      <div class="grid three">${SCENARIOS.map((sc, i) => html`<article class="card stack" style="gap:8px">
        <div class="row between"><b style="font-family:var(--f-display);font-size:18px">${sc.title}</b><span class="chip" aria-hidden="true">${sc.icon}</span></div>
        <p class="small" style="margin:0;line-height:1.8">${sc.blurb}</p>
        <div class="tr-prev" aria-label="ورقك في السيناريو">${previews[i].map((c) => pc(c))}</div>
        <button type="button" class="btn" data-scenario="${i + 1}">جرّب السيناريو</button></article>`)}</div>
    </section>

    <section class="card" aria-labelledby="hintH" style="border-style:dashed">
      <h2 id="hintH" style="font-size:17px">سياسة المساعدة</h2>
      <p style="margin:0">التلميحات والعداد متاحة في التدريب فقط؛ الغرف الحقيقية بدون مساعدة.</p>
    </section>`);

  const $ = (s) => main.querySelector(s);
  const showStep = (i, focus = false) => {
    step = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[step], body = $('#tutBody');
    mount(body, html`<h3 style="color:var(--gold);margin:0 0 8px">${s.title}</h3>${s.body}`);
    if (s.wire) s.wire(body);
    $('#tutCount').textContent = `الخطوة ${n(step + 1)} من ${n(steps.length)}`;
    main.querySelectorAll('[data-step]').forEach((b) => (+b.dataset.step === step ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    $('#tutPrev').disabled = step === 0;
    $('#tutNext').textContent = step === steps.length - 1 ? 'من البداية ↺' : 'التالي ←';
    if (focus) body.focus({ preventScroll: true });
  };
  main.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => showStep(+b.dataset.step, true)));
  $('#tutPrev').onclick = () => showStep(step - 1, true);
  $('#tutNext').onclick = () => showStep(step === steps.length - 1 ? 0 : step + 1, true);
  showStep(0);

  const seg = (attr, key, parse) => main.querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = () => {
    P[key] = parse(b.dataset[attr]); savePrefs(P);
    main.querySelectorAll(`[data-${attr}]`).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  }));
  seg('level', 'level', String); seg('target', 'target', Number);
  const qs = () => `?level=${encodeURIComponent(P.level)}&target=${P.target}`;
  $('#startBots').onclick = () => navigate('/training/bots' + qs());
  main.querySelectorAll('[data-scenario]').forEach((b) => (b.onclick = () => navigate(`/training/scenario-${b.dataset.scenario}${qs()}`)));
}

/* =====================================================================================
   Play mode
   ===================================================================================== */
const BOT_NAMES = ['أنت', 'سعد (بوت)', 'خالد (بوت)', 'فهد (بوت)'];
const SEATS = BOT_NAMES.map((name, i) => ({ uid: i ? 'bot' + i : 'me', name, username: name, avatar_url: null, frame: 'none', rating: null }));

function renderPlay(main, mode) {
  const qs = new URLSearchParams(location.search);
  const level = LEVELS.some((l) => l[0] === qs.get('level')) ? qs.get('level') : 'mid';
  const target = [101, 152, 202].includes(Number(qs.get('target'))) ? Number(qs.get('target')) : 152;
  const m = /^scenario-(\d+)$/.exec(mode || '');
  const sc = m ? SCENARIOS[Number(m[1]) - 1] : null;
  if (mode !== 'bots' && !sc) {
    document.body.classList.remove('ingame');
    mount(main, html`<div class="empty"><div class="art">🎓</div><b>هذا التدريب غير موجود.</b><span>ارجع لصفحة التدريب واختر نوع اللعب.</span><a class="btn primary" href="/training" data-link>صفحة التدريب</a></div>`);
    return undefined;
  }

  const root = document.createElement('div');
  main.innerHTML = ''; main.appendChild(root);
  let G = null, table = null, decisions = [], pending = false, gone = false;

  const view = () => ({
    state: { ...structuredClone(E.publicView(G)), deadline: null },
    seats: SEATS, mySeat: 0, hand: G.hands[0].slice(), status: G.over ? 'finished' : 'playing', table: 'classic', back: 'sadu',
  });
  const push = () => { if (!gone && table) table.update(view()); };
  const bots = () => E.runBots(G, (p) => p !== 0, level);

  function reviewDialog(which) {
    const list = which === 'all' ? decisions : decisions.filter((d) => d.round === Number(which));
    const diff = list.filter((d) => !d.same);
    const scope = which === 'all' ? 'في هذي الصكة' : `في التوزيعة ${n(Number(which))}`;
    return dialog(html`<h2>مراجعة قراراتك</h2>
      <p class="muted" style="margin:0 0 6px">${list.length ? `طابقت اقتراح المحرك في ${n(list.length - diff.length)} من ${n(list.length)} قرار ${scope}.` : `ما فيه قرارات مسجّلة ${scope}.`}</p>
      ${diff.length ? html`<ul style="margin:0;padding:0">${diff.map((d) => html`<li class="tr-rev">
          <span class="small muted">${whereLabel(d)}</span>
          ${d.kind === 'card' && d.table.length ? html`<div class="row small"><span class="muted">على الطاولة:</span>${d.table.map((t) => html`<span class="tr-mini" title="${BOT_NAMES[t.p]}">${pc(t.c)}</span>`)}</div>` : ''}
          <div class="row small"><span class="muted">اختيارك:</span>${describe(d, 'mine')}<span class="muted" style="margin-inline-start:10px">الاقتراح:</span>${describe(d, 'rec')}</div>
          <div class="tr-why">💡 ${d.why}</div></li>`)}</ul>`
        : list.length ? html`<p class="ok" style="font-size:17px">👏 ممتاز! كل قراراتك ${scope} طابقت اقتراح المحرك.</p>` : ''}
      <p class="small muted">الاقتراح من محرك اللعبة بمستوى «محترف» على نفس حالة اللعب لحظة قرارك. أحياناً فيه أكثر من حركة صحيحة، فاعتبره رأي ثاني.</p>
      <div class="actions"><button class="btn primary" data-close autofocus>تمام</button></div>`, { label: 'مراجعة القرارات' });
  }
  const onDocClick = (e) => { const b = e.target.closest('[data-train-review]'); if (b) reviewDialog(b.dataset.trainReview); };
  document.addEventListener('click', onDocClick);

  async function scenarioFeedback(d) {
    const v = await dialog(html`<h2>${d.same ? '👏 قرار ممتاز' : 'خلنا نشوف قرارك'}</h2>
      <div class="stack" style="gap:8px">
        <div class="row"><span class="muted">اختيارك:</span>${describe(d, 'mine')}</div>
        <div class="row"><span class="muted">اقتراح المحرك:</span>${describe(d, 'rec')}</div>
        <div class="tr-why">💡 ${d.why}</div>
        <p style="margin:0;line-height:1.8"><b>الفكرة:</b> ${sc.lesson}</p>
      </div>
      <div class="actions"><button class="btn" data-close="retry">أعد السيناريو</button><button class="btn primary" data-close="go" autofocus>كمّل التوزيعة ضد البوتات</button></div>`,
    { dismiss: false, label: 'نتيجة السيناريو' }).done;
    return v === 'retry';
  }

  const adapter = {
    hints: true,
    view,
    async act(kind, v) {
      if (gone) return;
      if (kind === 'next') { if (G.req && G.req.k === 'next') { E.act(G, 0, 'next', true); bots(); push(); } return; }
      const q = G.req;
      if (!q || q.p !== 0 || q.k !== kind) throw new Error('مو دورك الحين.');
      const rec = recommend(G);
      const d = {
        kind, round: G.round + 1, trick: G.trickNo + 1, bidRound: q.d && q.d.round, word: q.d && q.d.text, flipSuit: G.flip ? G.flip[1] : null,
        table: G.trick.slice(), mine: v, rec: rec.v, why: rec.why, same: sameChoice(kind, v, rec.v),
      };
      try { E.act(G, 0, kind, v); } catch { throw new Error('هذي الحركة غير مسموحة.'); }
      decisions.push(d);
      if (sc && pending && kind === sc.decision) {
        pending = false;
        if (await scenarioFeedback(d)) { if (!gone) start(); return; }
      }
      if (gone) return;
      bots(); push();
    },
    leave: async () => {
      if (G && !G.over && decisions.length && !(await confirmBox('تطلع من التدريب؟', 'اللعبة الحالية ما تنحفظ.', { ok: 'اطلع' }))) return;
      navigate('/training');
    },
    rematch: () => start(),
    onSummary(sm) {
      const k = decisions.filter((x) => x.round === sm.n && !x.same).length;
      setTimeout(() => {
        const dl = [...document.querySelectorAll('dialog.sheet[open]')].pop();
        const act = dl && dl.querySelector('.actions');
        if (!act || act.querySelector('[data-train-review]')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.dataset.trainReview = String(sm.n);
        b.textContent = k ? `مراجعة قراراتك (${n(k)})` : 'مراجعة قراراتك ✓';
        act.prepend(b);
      }, 0);
    },
    async finalInfo() {
      const diff = decisions.filter((x) => !x.same).length;
      return html`<p class="muted" style="text-align:center;margin:0">${LABEL}</p>
        <p style="text-align:center">طابقت اقتراح المحرك في ${n(decisions.length - diff)} من ${n(decisions.length)} قرار.</p>
        <div class="row" style="justify-content:center"><button type="button" class="btn" data-train-review="all">مراجعة كل قراراتك</button></div>`.__raw;
    },
  };

  function addBadge() {
    const felt = root.querySelector('#felt');
    if (!felt) return;
    const b = document.createElement('div');
    b.className = 'tr-badge';
    mount(b, html`<span class="chip gold">🎓 ${LABEL}${sc ? ` · ${sc.title}` : ''}</span><button type="button" class="btn" data-train-review="all">مراجعة قراراتك</button>`);
    felt.appendChild(b);
  }
  function start() {
    if (table) { table.destroy(); table = null; }
    decisions = [];
    try {
      if (sc) { G = buildScenario(sc, target); pending = true; }
      else { G = E.newGame({ rules: { target } }); E.startRound(G); bots(); }
    } catch (e) {
      console.error(e);
      mount(root, html`<div class="empty"><div class="art">⚠️</div><b>تعذّر تجهيز التدريب.</b><a class="btn" href="/training" data-link>رجوع</a></div>`);
      return;
    }
    table = createTable(root, adapter, { replay: true });
    addBadge();
    if (sc) toast(`${sc.title}: ${sc.blurb}`, { ms: 7000 });
  }
  start();

  return () => { gone = true; document.removeEventListener('click', onDocClick); if (table) table.destroy(); };
}

export async function render(main, params = {}) {
  if (params.mode) return renderPlay(main, params.mode);
  renderHub(main);
  return undefined;
}
