// Diwaniya Baloot engine — pure rules, no I/O. Shared by the game server and the browser (training).
// Cards are 2-char strings: rank + suit. Ranks 7 8 9 T J Q K A, suits S H C D.
// Seats 0..3 counter-clockwise; teams are {0,2} and {1,3}. See docs/RULES.md.

export const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];          // natural order (sequences)
export const ORD_N = ['7', '8', '9', 'J', 'Q', 'K', 'T', 'A'];          // Sun and side suits, low → high
export const ORD_T = ['7', '8', 'Q', 'K', 'T', 'A', '9', 'J'];          // trump suit, low → high
const PTS_N = { A: 11, T: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const PTS_T = { J: 20, 9: 14, A: 11, T: 10, K: 4, Q: 3, 8: 0, 7: 0 };
/** Project values in score points, and their worth in abnat for the buyer-failure comparison. */
export const PROJ_POINTS = { sun: { sira: 4, 50: 10, 100: 20, 400: 40 }, hokm: { sira: 2, 50: 5, 100: 10, 400: 10 } };
const PROJ_ABNAT = { sun: { sira: 20, 50: 50, 100: 100, 400: 200 }, hokm: { sira: 20, 50: 50, 100: 100, 400: 100 } };
const PROJ_ORDER = { sira: 1, 50: 2, '100s': 3, '100f': 4, 400: 5 };
export const FULL = [];
for (const s of SUITS) for (const r of RANKS) FULL.push(r + s);

export const DEFAULT_RULES = Object.freeze({
  target: 152,                    // صكة
  secondRound: true,              // ثاني: Hokm in another suit in round 2
  ashkal: true,                   // أشكل allowed for the 3rd and 4th bidders in round 1
  ashkalOnAce: true,              // أشكل allowed when the face-up card is an Ace
  mustTrumpWhenPartnerWins: true, // must cut even if partner holds the trick
  mustUndertrump: true,           // if you can't over-trump you must still play a (lower) trump
  doubling: true,                 // دبل/ثري/فور/قهوة ladder in Hokm
  sunDouble: 'over100',           // 'over100' (buyer team >100 and doubler ≤100) | 'never' | 'always'
  doubleLock: 'open',             // 'open' | 'locked' (no trump lead while doubled unless only trumps)
  tieRule: 'split',               // 'split' | 'buyer_loses' | 'hang' (معلّقة)
  balootSurvivesLoss: true,       // بلوت stays with its holder when the buyer fails
  maxProjects: 2,                 // projects counted per player (بلوت excluded)
  kabootSun: 44,
  kabootHokm: 25,
  turnSeconds: 30,                // server-side move timer (not used by the engine itself)
});
export function makeRules(over = {}) {
  const r = { ...DEFAULT_RULES };
  for (const k of Object.keys(over || {})) if (k in DEFAULT_RULES && typeof over[k] === typeof DEFAULT_RULES[k]) r[k] = over[k];
  if (![101, 152, 202].includes(r.target)) r.target = 152;
  if (!['split', 'buyer_loses', 'hang'].includes(r.tieRule)) r.tieRule = 'split';
  if (!['over100', 'never', 'always'].includes(r.sunDouble)) r.sunDouble = 'over100';
  if (!['open', 'locked'].includes(r.doubleLock)) r.doubleLock = 'open';
  r.maxProjects = Math.max(1, Math.min(3, r.maxProjects | 0));
  r.turnSeconds = Math.max(10, Math.min(90, r.turnSeconds | 0));
  return r;
}

export const team = (p) => p % 2;
export const partner = (p) => (p + 2) % 4;
const R = (c) => c[0], Su = (c) => c[1];

/* ---------------- card helpers ---------------- */
export function isTrump(G, c) { return !!(G.contract && G.contract.type === 'hokm' && Su(c) === G.contract.trump); }
export function pts(G, c) { return isTrump(G, c) ? PTS_T[R(c)] : PTS_N[R(c)]; }
export function rankPow(G, c) { return isTrump(G, c) ? ORD_T.indexOf(R(c)) : ORD_N.indexOf(R(c)); }
export function power(G, c, led) {
  if (isTrump(G, c)) return 100 + ORD_T.indexOf(R(c));
  if (Su(c) === led) return ORD_N.indexOf(R(c));
  return -1;
}
export function winnerOf(G, trick) {
  const led = Su(trick[0].c); let b = trick[0];
  for (const t of trick) if (power(G, t.c, led) > power(G, b.c, led)) b = t;
  return b;
}
export function shuffle(a, rnd = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------------- score conversion (القيد) ---------------- */
/** Sun: units 0-4 down, 5 exact (+1), 6-9 up; doubled. 65 → 13, 64 → 12, 66 → 14. */
export function sunPoints(abnat) { const u = abnat % 10; return 2 * Math.floor(abnat / 10) + (u === 5 ? 1 : u >= 6 ? 2 : 0); }
/** Hokm: units 0-5 down, 6-9 up. 85 → 8, 86 → 9. */
export function hokmPoints(abnat) { return Math.floor(abnat / 10) + (abnat % 10 >= 6 ? 1 : 0); }

/* ---------------- legal moves ---------------- */
export function legal(G, p) {
  const hand = G.hands[p], tr = G.trick, rules = G.rules;
  const hokm = G.contract.type === 'hokm', T = G.contract.trump;
  if (!tr.length) {
    if (hokm && G.locked) { const side = hand.filter((c) => Su(c) !== T); if (side.length) return side; }
    return hand.slice();
  }
  const led = Su(tr[0].c), follow = hand.filter((c) => Su(c) === led);
  if (!hokm) return follow.length ? follow : hand.slice();
  const bestT = Math.max(-1, ...tr.filter((t) => isTrump(G, t.c)).map((t) => power(G, t.c, led)));
  if (led === T) {
    if (!follow.length) return hand.slice();
    const up = follow.filter((c) => power(G, c, led) > bestT);
    return up.length ? up : follow;
  }
  if (follow.length) return follow;
  const trumps = hand.filter((c) => isTrump(G, c));
  if (!trumps.length) return hand.slice();
  if (!rules.mustTrumpWhenPartnerWins && team(winnerOf(G, tr).p) === team(p)) return hand.slice();
  if (bestT >= 0) {
    const up = trumps.filter((c) => power(G, c, led) > bestT);
    if (up.length) return up;
    return rules.mustUndertrump ? trumps : hand.slice();
  }
  return trumps;
}

/* ---------------- projects (المشاريع) ---------------- */
/** All non-overlapping candidate projects in a hand, best first. Sequences may not share cards; four-of-a-kind may overlap a sequence. */
export function findProjects(type, hand) {
  const res = [];
  for (const r of ['A', 'T', 'K', 'Q', 'J']) {
    const cs = hand.filter((c) => R(c) === r);
    if (cs.length === 4) res.push({ t: r === 'A' && type === 'sun' ? '400' : '100', kind: r === 'A' && type === 'sun' ? '400' : '100f', top: RANKS.indexOf(r), cards: cs });
  }
  for (const s of SUITS) {
    const idx = hand.filter((c) => Su(c) === s).map((c) => RANKS.indexOf(R(c))).sort((a, b) => b - a);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1] === idx[j] - 1) j++;
      let len = j - i + 1, top = idx[i];
      while (len >= 3) {
        const take = len >= 5 ? 5 : len;
        const t = take === 5 ? '100' : take === 4 ? '50' : 'sira';
        const cards = []; for (let k = 0; k < take; k++) cards.push(RANKS[top - k] + s);
        res.push({ t, kind: t === '100' ? '100s' : t, top, cards });
        top -= take; len -= take;
      }
      i = j + 1;
    }
  }
  return res.sort((a, b) => PROJ_ORDER[b.kind] - PROJ_ORDER[a.kind] || b.top - a.top);
}
function projKey(pr, seatOrder) { return PROJ_ORDER[pr.kind] * 1000 + pr.top * 10 + (3 - seatOrder); }
function resolveProjects(G) {
  const type = G.contract.type;
  const all = [0, 1, 2, 3].map((p) => findProjects(type, G.hands[p]).slice(0, G.rules.maxProjects));
  const best = [-1, -1];
  for (let p = 0; p < 4; p++) {
    const order = (p - G.dealer + 3) % 4;                 // 0 = dealer's right (first to play)
    for (const pr of all[p]) { const k = projKey(pr, order); if (k > best[team(p)]) best[team(p)] = k; }
  }
  const win = best[0] < 0 && best[1] < 0 ? -1 : best[0] > best[1] ? 0 : 1;
  const sumFor = (tm, table) => [0, 1, 2, 3].filter((p) => team(p) === tm).reduce((a, p) => a + all[p].reduce((x, pr) => x + table[type][pr.t], 0), 0);
  G.projects = {
    all,                                                  // full detail stays server-side
    win,
    points: [0, 1].map((tm) => sumFor(tm, PROJ_POINTS)),  // own projects, before cancellation
    abnat: [0, 1].map((tm) => sumFor(tm, PROJ_ABNAT)),
  };
  let baloot = null;
  if (type === 'hokm') {
    const T = G.contract.trump;
    for (let p = 0; p < 4; p++) if (G.hands[p].includes('K' + T) && G.hands[p].includes('Q' + T)) baloot = { p, shown: 0 };
  }
  G.baloot = baloot;
}

/* ---------------- bots and hints ---------------- */
const HV = { J: 3.5, 9: 3, A: 2, T: 1.5, K: 1, Q: 1, 8: 0.7, 7: 0.7 };
export function hokmScore(cards, s) {
  let sc = 0, n = 0;
  for (const c of cards) {
    if (Su(c) === s) { n++; sc += HV[R(c)]; }
    else if (R(c) === 'A') sc += 1.4;
    else if (R(c) === 'T' && cards.includes('A' + Su(c))) sc += 0.6;
  }
  if (n >= 3) sc += 1; if (n >= 4) sc += 1; if (n <= 1) sc -= 2;
  return sc;
}
export function sunScore(cards) {
  let sc = 0;
  for (const c of cards) {
    if (R(c) === 'A') sc += 2.6;
    else if (R(c) === 'T') sc += cards.includes('A' + Su(c)) ? 1.4 : 0.4;
    else if (R(c) === 'K') sc += 0.35;
  }
  return sc;
}
/** Returns {t, s?, why}. `why` is an Arabic explanation used by training hints. */
export function botBid(G, p, round, opts, lvl = 'mid', rnd = Math.random) {
  const six = G.hands[p].concat([G.flip]);
  const noise = lvl === 'easy' ? rnd() * 3 - 1.5 : 0;
  const hokmBy = G.bid && G.bid.hokm;
  const aces = six.filter((c) => R(c) === 'A').length;
  if (opts.includes('sun')) {
    const need = hokmBy != null && team(hokmBy) === team(p) ? 10.5 : 7.3;
    if (sunScore(six) + noise >= need) return { t: 'sun', why: `معك ${aces} إكك مع الورقة المكشوفة، والصن يناسب اليد القوية بالإكك والعشرات.` };
  }
  if (round === 1 && opts.includes('hokm') && hokmScore(six, Su(G.flip)) + noise >= 7.2) {
    const n = six.filter((c) => Su(c) === Su(G.flip)).length;
    return { t: 'hokm', why: `يصير معك ${n} ورقات من نوع المكشوفة، ومنها الكبار (الولد والتسعة) إن وجدت.` };
  }
  if (round === 2 && opts.includes('hokm2')) {
    let bs = null, bv = -9;
    for (const s of SUITS) if (s !== Su(G.flip)) { const v = hokmScore(six, s); if (v > bv) { bv = v; bs = s; } }
    if (bv + noise >= 7) return { t: 'hokm2', s: bs, why: 'هذا أقوى نوع في يدك للحكم.' };
  }
  return { t: 'pass', why: 'يدك ما تكفي تشتري، والأسلم تقول بس.' };
}
export function botDouble(G, p) { return hokmScore(G.hands[p], G.contract.trump) >= 6.5; }
function botEscalate(G, p) {
  const s = G.contract.type === 'hokm' ? hokmScore(G.hands[p], G.contract.trump) : sunScore(G.hands[p]);
  return G.contract.type === 'hokm' ? s >= 8.5 : s >= 9;
}

function unseenFor(G, p) { const known = new Set(G.played.concat(G.hands[p])); return FULL.filter((c) => !known.has(c)); }
function isMaster(G, c, p) { return !unseenFor(G, p).some((u) => Su(u) === Su(c) && rankPow(G, u) > rankPow(G, c)); }

/** Chooses a card and explains why. Returns {card, why}. */
export function chooseCard(G, p, level = 'mid', rnd = Math.random) {
  const L = legal(G, p);
  if (L.length === 1) return { card: L[0], why: 'ما عندك غير هذي الورقة المسموحة.' };
  if (level === 'easy' && rnd() < 0.55) return { card: L[Math.floor(rnd() * L.length)], why: 'لعب عشوائي (مستوى سهل).' };
  const hard = level === 'hard';
  const hokm = G.contract.type === 'hokm', T = G.contract.trump;
  const lowKey = (c) => pts(G, c) * 20 + rankPow(G, c) + (isTrump(G, c) ? 60 : 0);
  const lowest = (a) => a.slice().sort((x, y) => lowKey(x) - lowKey(y))[0];
  const giveKey = (c) => pts(G, c) - (isTrump(G, c) ? 40 : 0) - (R(c) === 'A' ? 3 : 0);
  const giveMost = (a) => a.slice().sort((x, y) => giveKey(y) - giveKey(x) || rankPow(G, x) - rankPow(G, y))[0];
  const byPow = (a, dir = 1) => a.slice().sort((x, y) => dir * (rankPow(G, x) - rankPow(G, y)));
  const un = unseenFor(G, p);
  const trumpsOut = hokm && un.some((c) => Su(c) === T);
  const opps = [(p + 1) % 4, (p + 3) % 4];
  const oppMayCut = (s) => hard && hokm && trumpsOut && opps.some((o) => G.voids[o][s] && !G.voids[o][T]);

  if (!G.trick.length) {
    const buyerTeam = team(p) === team(G.contract.buyer);
    if (hokm) {
      const myT = L.filter((c) => isTrump(G, c));
      if (buyerTeam && myT.length && trumpsOut) {
        const m = myT.filter((c) => isMaster(G, c, p));
        if (m.length) return { card: byPow(m, -1)[0], why: 'أنت من فريق المشتري ومعك أكبر حكم باقي: اسحب حكم الخصوم.' };
        if (p === G.contract.buyer && myT.length >= 4) return { card: lowest(myT), why: 'معك حكم كثير، فتسحب حكم الخصوم بورقة صغيرة.' };
      }
    }
    const masters = L.filter((c) => !isTrump(G, c) && isMaster(G, c, p) && !oppMayCut(Su(c)));
    if (masters.length) return { card: masters.sort((a, b) => pts(G, b) - pts(G, a))[0], why: 'هذي أكبر ورقة باقية في نوعها، فالأكلة مضمونة غالباً.' };
    if (hard && hokm) {
      const pv = L.filter((c) => !isTrump(G, c) && G.voids[partner(p)][Su(c)] && !G.voids[partner(p)][T] && pts(G, c) === 0);
      if (pv.length) return { card: pv[0], why: 'خويك خلص من هذا النوع وعنده حكم، فيقدر يدق.' };
    }
    const side = L.filter((c) => !isTrump(G, c));
    const pool = (side.length ? side : L).filter((c) => !(R(c) === 'T' && !G.hands[p].includes('A' + Su(c)) && un.includes('A' + Su(c))));
    return { card: lowest(pool.length ? pool : side.length ? side : L), why: 'ما عندك ورقة مضمونة، فتبدأ بورقة صغيرة وتحفظ الكبار.' };
  }
  const led = Su(G.trick[0].c), win = winnerOf(G, G.trick), partnerWin = team(win.p) === team(p);
  const last = G.trick.length === 3;
  const winners = L.filter((c) => power(G, c, led) > power(G, win.c, led));
  const trickPts = G.trick.reduce((a, t) => a + pts(G, t.c), 0);
  const after = []; for (let i = G.trick.length + 1; i < 4; i++) after.push((G.leader + i) % 4);
  const oppAfter = after.filter((x) => team(x) !== team(p));
  const safeCard = (c) => {
    if (isTrump(G, c)) return !un.some((u) => Su(u) === T && rankPow(G, u) > rankPow(G, c)) || !oppAfter.length;
    const higher = un.some((u) => Su(u) === Su(c) && rankPow(G, u) > rankPow(G, c));
    const cut = hokm && trumpsOut && oppAfter.some((o) => hard && G.voids[o][led] && !G.voids[o][T]);
    return !oppAfter.length || (!higher && !cut);
  };
  if (last) {
    if (partnerWin) return { card: giveMost(L), why: 'خويك ماسك الأكلة وأنت آخر واحد، فتعطيه أكثر أبناط.' };
    if (winners.length) {
      const plain = winners.filter((c) => !isTrump(G, c));
      if (plain.length) return { card: plain.sort((a, b) => pts(G, b) - pts(G, a) || rankPow(G, a) - rankPow(G, b))[0], why: 'أنت آخر واحد وتقدر تاكل، فتاكل بأكثر ورقة أبناط.' };
      if (trickPts >= 4 || rnd() < 0.6 || !hokm) return { card: byPow(winners)[0], why: 'تدق بأصغر حكم يكفي عشان تاخذ الأكلة.' };
    }
    return { card: lowest(L), why: 'الأكلة رايحة للخصم، فترمي أصغر ورقة.' };
  }
  if (partnerWin && safeCard(win.c)) return { card: giveMost(L), why: 'خويك ماسك الأكلة بورقة مضمونة، فتعطيه أبناط.' };
  if (partnerWin) return { card: lowest(L), why: 'خويك ماسك الأكلة لكنها مو مضمونة، فترمي ورقة صغيرة.' };
  if (winners.length) {
    const sure = winners.filter(safeCard);
    if (sure.length) { const plain = sure.filter((c) => !isTrump(G, c)); return { card: byPow(plain.length ? plain : sure)[0], why: 'تاخذ الأكلة بأصغر ورقة تضمنها.' }; }
    const tw = winners.filter((c) => isTrump(G, c));
    if (tw.length && !winners.some((c) => !isTrump(G, c))) return { card: byPow(tw)[0], why: 'ما عندك من النوع، فتدق بأصغر حكم.' };
    if (trickPts >= 10) return { card: byPow(winners, -1)[0], why: 'الأكلة فيها أبناط كثيرة، فتحاول تاخذها بأقوى ورقة.' };
  }
  return { card: lowest(L), why: 'ما تقدر تضمن الأكلة، فترمي أصغر ورقة.' };
}
export function botCard(G, p, level, rnd) { return chooseCard(G, p, level, rnd).card; }

/* ---------------- state machine ---------------- */
export function newGame({ rules, rnd = Math.random, dealer } = {}) {
  const R0 = makeRules(rules);
  return {
    rules: R0, phase: 'idle', scores: [0, 0], dealer: dealer ?? Math.floor(rnd() * 4), round: 0, log: [], hang: 0,
    hands: [[], [], [], []], deck: [], flip: null, contract: null, bid: null, ladder: null, locked: false,
    trick: [], trickNo: 0, leader: 0, turn: -1, raw: [0, 0], tricks: [0, 0], played: [], voids: [{}, {}, {}, {}],
    lastTrick: null, tricksLog: [], projects: null, baloot: null, summary: null, over: false, winner: -1,
    req: null, reqSeq: 0, ev: [], evSeq: 0, stats: { kab: [0, 0], rounds: [] },
  };
}
function ev(G, ...a) { G.evSeq++; G.ev.push([G.evSeq, ...a]); if (G.ev.length > 150) G.ev.shift(); }
export const addEvent = ev;
function setReq(G, p, k, d = {}) { G.req = { p, k, d, id: ++G.reqSeq }; G.turn = p; }
const sym = (s) => ({ S: '♠', H: '♥', D: '♦', C: '♣' }[s]);
const bidText = (b, flip) => ({ hokm: 'حكم ' + sym(Su(flip)), sun: 'صن', pass: 'بس', ashkal: 'أشكل' }[b.t] || 'حكم ' + sym(b.s));
const LADDER_TEXT = { 2: 'دبل', 3: 'ثري', 4: 'فور', 5: 'قهوة' };

export function startRound(G, rnd = Math.random) {
  Object.assign(G, {
    deck: shuffle(FULL.slice(), rnd), hands: [[], [], [], []], flip: null, contract: null, trick: [], trickNo: 0, turn: -1,
    raw: [0, 0], tricks: [0, 0], played: [], voids: [{}, {}, {}, {}], lastTrick: null, tricksLog: [], projects: null, baloot: null,
    summary: null, phase: 'bid', bid: { round: 1, i: 0, hokm: null, h2: null }, ladder: null, locked: false, ev: G.ev.slice(-12),
  });
  for (const n of [3, 2]) for (let i = 1; i <= 4; i++) { const p = (G.dealer + i) % 4; for (let k = 0; k < n; k++) G.hands[p].push(G.deck.pop()); }
  G.flip = G.deck.pop();
  G.dealt = G.hands.map((h) => h.slice());
  ev(G, 'deal', G.dealer, G.round + 1);
  askBid(G);
}
function bidOrder(G) { return [1, 2, 3, 4].map((i) => (G.dealer + i) % 4); }
function askBid(G) {
  const b = G.bid, p = bidOrder(G)[b.i];
  let opts;
  if (b.round === 1) {
    opts = b.hokm === null ? ['hokm', 'sun', 'pass'] : ['sun', 'pass'];
    if (G.rules.ashkal && b.hokm === null && b.i >= 2 && (G.rules.ashkalOnAce || R(G.flip) !== 'A')) opts.push('ashkal');
  } else opts = b.h2 === null ? ['hokm2', 'sun', 'pass'] : ['sun', 'pass'];
  setReq(G, p, 'bid', { round: b.round, opts });
}
function applyBid(G, p, v) {
  const b = G.bid, opts = G.req.d.opts;
  if (!v || typeof v !== 'object' || !opts.includes(v.t)) throw new Error('bad bid');
  if (v.t === 'hokm2' && (!SUITS.includes(v.s) || v.s === Su(G.flip))) throw new Error('bad suit');
  ev(G, 'bid', p, bidText(v, G.flip));
  if (v.t === 'sun') return finishContract(G, { type: 'sun', buyer: p, taker: p });
  if (v.t === 'ashkal') return finishContract(G, { type: 'sun', buyer: p, taker: partner(p), ashkal: true });
  if (v.t === 'hokm') b.hokm = p;
  if (v.t === 'hokm2') { b.h2 = { p, s: v.s }; b.hokm = p; }
  b.i++;
  if (b.i < 4) return askBid(G);
  if (b.round === 1) {
    if (b.hokm !== null) return finishContract(G, { type: 'hokm', trump: Su(G.flip), buyer: b.hokm, taker: b.hokm });
    if (G.rules.secondRound) { b.round = 2; b.i = 0; ev(G, 'r2'); return askBid(G); }
  } else if (b.h2) return finishContract(G, { type: 'hokm', trump: b.h2.s, buyer: b.h2.p, taker: b.h2.p });
  ev(G, 'redeal');
  G.dealer = (G.dealer + 1) % 4;
  startRound(G, G._rnd || Math.random);
}
/** Who may start the doubling ladder for this contract. */
function canDouble(G) {
  const r = G.rules, ct = G.contract;
  if (!r.doubling) return false;
  if (ct.type === 'hokm') return true;
  if (r.sunDouble === 'never') return false;
  if (r.sunDouble === 'always') return true;
  const bt = team(ct.buyer);
  return G.scores[bt] > 100 && G.scores[1 - bt] <= 100;
}
function finishContract(G, ct) {
  G.contract = ct;
  ev(G, 'contract', ct.type, ct.trump || '', ct.buyer, ct.ashkal ? 1 : 0);
  G.mult = 1; G.gahwa = false;
  if (canDouble(G)) {
    G.phase = 'double';
    G.ladder = { level: 1, step: 0, caller: -1 };
    return setReq(G, (ct.buyer + 1) % 4, 'double', { level: 2, text: 'دبل' });
  }
  dealRest(G);
}
/** Ladder: opponents دبل → buyer ثري → opponents فور → buyer قهوة. Sun stops at دبل. */
function applyDouble(G, p, yes) {
  const L = G.ladder, ct = G.contract, bt = team(ct.buyer);
  if (yes === true) {
    L.level++; L.caller = team(p);
    G.mult = Math.min(L.level, 4); if (L.level === 5) G.gahwa = true;
    ev(G, 'double', p, L.level, LADDER_TEXT[L.level]);
    if (ct.type === 'sun' || L.level >= 5) return dealRest(G);
    // next rung goes to the other team: buyer answers ثري/قهوة, the doubler answers فور
    const nextLevel = L.level + 1;
    const nextP = team(p) === bt ? (L.doubler ?? (ct.buyer + 1) % 4) : ct.buyer;
    if (team(p) !== bt) L.doubler = p;
    return setReq(G, nextP, 'double', { level: nextLevel, text: LADDER_TEXT[nextLevel] });
  }
  if (yes !== false) throw new Error('bad double');
  if (L.level === 1 && L.step === 0) { L.step = 1; return setReq(G, (ct.buyer + 3) % 4, 'double', { level: 2, text: 'دبل' }); }
  dealRest(G);
}
function dealRest(G) {
  const ct = G.contract;
  G.locked = G.mult > 1 && G.rules.doubleLock === 'locked' && ct.type === 'hokm';
  for (let i = 1; i <= 4; i++) {
    const p = (G.dealer + i) % 4;
    if (p === ct.taker) G.hands[p].push(G.flip, G.deck.pop(), G.deck.pop());
    else G.hands[p].push(G.deck.pop(), G.deck.pop(), G.deck.pop());
  }
  G.dealt = G.hands.map((h) => h.slice());
  G.flip = null; G.phase = 'play'; resolveProjects(G);
  G.leader = (G.dealer + 1) % 4; G.trick = []; G.trickNo = 0;
  ev(G, 'play', G.mult, G.locked ? 1 : 0);
  setReq(G, G.leader, 'card');
}
function applyCard(G, p, c) {
  if (typeof c !== 'string' || !legal(G, p).includes(c)) throw new Error('illegal card');
  const h = G.hands[p]; h.splice(h.indexOf(c), 1);
  if (G.trick.length) {
    const led = Su(G.trick[0].c);
    if (Su(c) !== led) {
      G.voids[p][led] = true;
      if (G.contract.type === 'hokm' && led !== G.contract.trump && !isTrump(G, c) && (G.rules.mustTrumpWhenPartnerWins || team(winnerOf(G, G.trick).p) !== team(p))) G.voids[p][G.contract.trump] = true;
    }
  }
  G.trick.push({ p, c }); G.played.push(c);
  ev(G, 'card', p, c);
  if (G.trickNo === 0 && G.projects.all[p].length) ev(G, 'projbub', p, G.projects.all[p].map((x) => x.t));
  if (G.baloot && G.baloot.p === p && isTrump(G, c) && (R(c) === 'K' || R(c) === 'Q')) { G.baloot.shown++; if (G.baloot.shown === 2) ev(G, 'baloot', p); }
  if (G.trick.length < 4) return setReq(G, (p + 1) % 4, 'card');
  const w = winnerOf(G, G.trick).p;
  const gain = G.trick.reduce((a, t) => a + pts(G, t.c), 0) + (G.trickNo === 7 ? 10 : 0);
  G.raw[team(w)] += gain; G.tricks[team(w)]++;
  G.lastTrick = { cards: G.trick.slice(), w, gain };
  G.tricksLog.push({ cards: G.trick.slice(), w, gain });
  ev(G, 'trick', w, gain);
  G.leader = w; G.trick = []; G.trickNo++;
  if (G.trickNo === 1 && G.projects.win >= 0) {
    const pr = G.projects, show = {};
    for (let x = 0; x < 4; x++) if (team(x) === pr.win && pr.all[x].length) show[x] = pr.all[x].map((q) => ({ t: q.t, cards: q.cards }));
    const lost = [0, 1, 2, 3].some((x) => team(x) !== pr.win && pr.all[x].length);
    pr.shown = show;
    ev(G, 'projshow', pr.win, show, pr.points[pr.win] * (G.mult > 1 ? 2 : 1), lost ? 1 : 0);
  }
  if (G.trickNo === 8) return scoreRound(G);
  setReq(G, w, 'card');
}

/** Scores the finished hand. Exported pieces are covered by tests/engine.test.mjs. */
export function scoreHand({ type, buyerTeam: b, raw, tricks, projects, baloot, mult = 1, gahwa = false, rules, hang = 0, lastCaller = -1 }) {
  const o = 1 - b, sun = type === 'sun', total = sun ? 26 : 16, conv = sun ? sunPoints : hokmPoints;
  const projMult = mult > 1 ? 2 : 1;                                     // projects are doubled at most
  const pv = [0, 1].map((t) => (projects && projects.win === t ? projects.points[t] : 0) * projMult);
  const pa = [0, 1].map((t) => (projects && projects.win === t ? projects.abnat[t] : 0));
  let fin = [0, 0], outcome, handWinner;
  const kaboot = tricks[0] === 8 ? 0 : tricks[1] === 8 ? 1 : -1;
  if (kaboot >= 0) {
    const own = projects ? projects.points[kaboot] * projMult : 0;
    fin[kaboot] = (sun ? rules.kabootSun : rules.kabootHokm) + own;
    outcome = kaboot === b ? 'kaboot' : 'kaboot_against'; handWinner = kaboot;
  } else {
    const B = raw[b] + pa[b], O = raw[o] + pa[o];
    const bp = conv(raw[b]), op = total - bp;
    const win = (t) => { fin[t] = total * mult + pv[0] + pv[1]; handWinner = t; };
    if (B > O) {
      outcome = 'made';
      if (mult > 1) win(b); else { fin[b] = bp + pv[b]; fin[o] = op + pv[o]; handWinner = b; }
    } else if (B < O) { outcome = 'failed'; win(o); }
    else {
      outcome = 'tie';
      if (mult > 1) win(lastCaller >= 0 ? 1 - lastCaller : o);
      else if (rules.tieRule === 'buyer_loses') { outcome = 'failed'; win(o); }
      else if (rules.tieRule === 'hang') { fin[o] = op + pv[o]; handWinner = -1; }
      else { fin[b] = bp + pv[b]; fin[o] = op + pv[o]; handWinner = -1; }
    }
  }
  let carried = 0, hangOut = 0;
  if (hang && handWinner >= 0) { fin[handWinner] += hang; carried = hang; }
  else if (hang) hangOut += hang;
  if (outcome === 'tie' && rules.tieRule === 'hang' && mult === 1) {
    const bp = conv(raw[b]); hangOut += bp + pv[b];
  }
  let bal = -1;
  if (baloot) {
    bal = team(baloot.p);
    if (outcome === 'failed' && bal === b && !rules.balootSurvivesLoss) bal = o;
    fin[bal] += 2;
  }
  return { fin, outcome, kaboot, handWinner, bal, carried, hangOut, pv, gahwa: gahwa && handWinner >= 0 ? handWinner : -1 };
}

function scoreRound(G) {
  const ct = G.contract, b = team(ct.buyer), rules = G.rules;
  const r = scoreHand({ type: ct.type, buyerTeam: b, raw: G.raw, tricks: G.tricks, projects: G.projects, baloot: G.baloot, mult: G.mult,
    gahwa: G.gahwa, rules, hang: G.hang, lastCaller: G.ladder ? G.ladder.caller : -1 });
  G.hang = r.hangOut;
  G.scores[0] += r.fin[0]; G.scores[1] += r.fin[1];
  G.round++;
  const tc = ct.type === 'sun' ? 's' : 'h' + ct.trump;
  const noteCode = { made: 0, failed: 1, kaboot: 2, kaboot_against: 3, tie: 4 }[r.outcome];
  G.log.push([G.round, tc, ct.buyer, r.fin[0], r.fin[1], noteCode, G.mult, G.gahwa ? 1 : 0]);
  if (G.log.length > 60) G.log.shift();
  if (r.kaboot >= 0) G.stats.kab[r.kaboot]++;
  G.stats.rounds.push({ type: ct.type, buyer: ct.buyer, outcome: r.outcome, fin: r.fin, mult: G.mult });
  let over = false, winner = -1;
  if (r.gahwa >= 0) { over = true; winner = r.gahwa; }
  else {
    const t = rules.target, s = G.scores;
    if ((s[0] >= t || s[1] >= t) && s[0] !== s[1]) { over = true; winner = s[0] > s[1] ? 0 : 1; }
  }
  const prTypes = [0, 1].map((tm) => [0, 1, 2, 3].filter((p) => team(p) === tm).flatMap((p) => G.projects.all[p].map((x) => x.t)));
  G.summary = {
    n: G.round, tc, b: ct.buyer, mult: G.mult, gahwa: G.gahwa ? 1 : 0, tk: G.tricks.slice(), raw: G.raw.slice(),
    fin: r.fin, outcome: r.outcome, pr: prTypes, pw: G.projects.win, pv: r.pv, bal: r.bal, carried: r.carried, hang: G.hang,
    scores: G.scores.slice(), done: over ? 1 : 0, winner,
  };
  G.dealtLog = (G.dealtLog || []).concat([G.dealt]);                   // full hands: server-side only, revealed after the match
  G.phase = 'roundEnd'; G.turn = -1;
  if (over) { G.over = true; G.winner = winner; }
  ev(G, 'summary', G.summary);
  setReq(G, -1, 'next');
}
export function nextRound(G, rnd = Math.random) {
  if (G.phase !== 'roundEnd') throw new Error('not round end');
  if (G.over) { G.phase = 'over'; G.req = null; return; }
  G.dealer = (G.dealer + 1) % 4;
  startRound(G, rnd);
}

/** Apply one decision from seat p. Throws on anything invalid. */
export function act(G, p, kind, v, rnd = Math.random) {
  const q = G.req;
  if (!q || q.k !== kind) throw new Error('not expected');
  if (kind === 'next') return nextRound(G, rnd);
  if (q.p !== p) throw new Error('not your turn');
  G._rnd = rnd;
  try {
    if (kind === 'bid') applyBid(G, p, v);
    else if (kind === 'double') applyDouble(G, p, v);
    else if (kind === 'card') applyCard(G, p, v);
    else throw new Error('bad kind');
  } finally { delete G._rnd; }
}
/** What a bot (or auto-play for an absent player) would do now. */
export function botDecision(G, level = 'mid', rnd = Math.random) {
  const q = G.req; if (!q) return null;
  if (q.k === 'bid') { const b = botBid(G, q.p, q.d.round, q.d.opts, level, rnd); return b.s ? { t: b.t, s: b.s } : { t: b.t }; }
  if (q.k === 'double') return q.d.level === 2 ? botDouble(G, q.p) : botEscalate(G, q.p);
  if (q.k === 'card') return chooseCard(G, q.p, level, rnd).card;
  return true;
}
/** Let bots play until a human has to decide. */
export function runBots(G, isBot, level = 'mid', rnd = Math.random) {
  for (let guard = 0; guard < 500; guard++) {
    const q = G.req;
    if (!q || q.k === 'next' || !isBot(q.p)) return;
    act(G, q.p, q.k, botDecision(G, level, rnd), rnd);
  }
}
/** Everything any player may see. Hidden: hands, deck, unrevealed projects. */
export function publicView(G) {
  const pr = G.projects;
  return {
    rules: G.rules, phase: G.phase, scores: G.scores, dealer: G.dealer, round: G.round, log: G.log, hang: G.hang,
    counts: G.hands.map((h) => h.length), flip: G.flip, contract: G.contract, mult: G.mult || 1, gahwa: !!G.gahwa, locked: G.locked,
    bid: G.bid ? { hokm: G.bid.hokm, round: G.bid.round } : null,
    trick: G.trick, trickNo: G.trickNo, leader: G.leader, turn: G.turn, raw: G.raw, tricks: G.tricks, played: G.played, voids: G.voids,
    lastTrick: G.lastTrick, tricksLog: G.tricksLog,
    projects: pr && G.trickNo >= 1 ? { win: pr.win, shown: pr.shown || {}, points: pr.win >= 0 ? pr.points[pr.win] : 0 } : null,
    baloot: G.baloot && G.baloot.shown === 2 ? { p: G.baloot.p } : null,
    summary: G.summary, over: G.over, winner: G.winner, req: G.req, ev: G.ev, evSeq: G.evSeq,
  };
}
