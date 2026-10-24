// Baloot game engine — pure logic shared by the server (Edge Function) and the browser (offline games).
// Cards are 2-char strings: rank + suit. Ranks 7 8 9 T J Q K A, suits S H C D.

export const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];            // sequence order (projects)
const ORD_N = ['7', '8', '9', 'J', 'Q', 'K', 'T', 'A'];                   // Sun / non-trump strength
const ORD_T = ['7', '8', 'Q', 'K', 'T', 'A', '9', 'J'];                   // trump strength
const PTS_N = { A: 11, T: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const PTS_T = { J: 20, 9: 14, A: 11, T: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const PROJ_RANK = { sira: 1, 50: 2, 100: 3, 400: 4 };
const PROJ_PTS = { sun: { sira: 4, 50: 10, 100: 20, 400: 40 }, hokm: { sira: 2, 50: 5, 100: 10, 400: 10 } };
export const FULL = [];
for (const s of SUITS) for (const r of RANKS) FULL.push(r + s);

export const team = (p) => p % 2;
export const partner = (p) => (p + 2) % 4;
const R = (c) => c[0], Su = (c) => c[1];

/* ---------- helpers ---------- */
export function isTrump(G, c) { return !!(G.contract && G.contract.type === 'hokm' && Su(c) === G.contract.trump); }
export function pts(G, c) { return isTrump(G, c) ? PTS_T[R(c)] : PTS_N[R(c)]; }
export function rankPow(G, c) { return isTrump(G, c) ? ORD_T.indexOf(R(c)) : ORD_N.indexOf(R(c)); }
function power(G, c, led) {
  if (isTrump(G, c)) return 100 + ORD_T.indexOf(R(c));
  if (Su(c) === led) return ORD_N.indexOf(R(c));
  return -1;
}
export function winnerOf(G, trick) {
  const led = Su(trick[0].c); let b = trick[0];
  for (const t of trick) if (power(G, t.c, led) > power(G, b.c, led)) b = t;
  return b;
}
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function legal(G, p) {
  const hand = G.hands[p], tr = G.trick;
  if (!tr.length) return hand.slice();
  const led = Su(tr[0].c), follow = hand.filter((c) => Su(c) === led);
  const hokm = G.contract.type === 'hokm', T = G.contract.trump;
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
  if (team(winnerOf(G, tr).p) === team(p)) return hand.slice();     // partner holds the trick
  if (bestT >= 0) { const up = trumps.filter((c) => power(G, c, led) > bestT); return up.length ? up : hand.slice(); }
  return trumps;
}

/* ---------- projects ---------- */
function findProjects(G, hand) {
  const res = [], used = new Set(), type = G.contract.type;
  for (const r of ['A', 'T', 'K', 'Q', 'J']) {
    const cs = hand.filter((c) => R(c) === r);
    if (cs.length === 4) { res.push({ t: r === 'A' && type === 'sun' ? '400' : '100', top: RANKS.indexOf(r) }); cs.forEach((c) => used.add(c)); }
  }
  for (const s of SUITS) {
    const idx = hand.filter((c) => Su(c) === s && !used.has(c)).map((c) => RANKS.indexOf(R(c))).sort((a, b) => b - a);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1] === idx[j] - 1) j++;
      let len = j - i + 1, top = idx[i];
      while (len >= 3) { const take = len >= 5 ? 5 : len; res.push({ t: take === 5 ? '100' : take === 4 ? '50' : 'sira', top }); top -= take; len -= take; }
      i = j + 1;
    }
  }
  return res;
}
function resolveProjects(G) {
  const all = [0, 1, 2, 3].map((p) => findProjects(G, G.hands[p]));
  const best = [-1, -1];
  for (let p = 0; p < 4; p++) {
    const oi = (p - G.dealer + 3) % 4;
    for (const pr of all[p]) { const k = PROJ_RANK[pr.t] * 1000 + pr.top * 10 + (3 - oi); if (k > best[team(p)]) best[team(p)] = k; }
  }
  let win = -1; if (best[0] >= 0 || best[1] >= 0) win = best[0] > best[1] ? 0 : 1;
  const ptsT = [0, 0];
  if (win >= 0) for (let p = 0; p < 4; p++) if (team(p) === win) for (const pr of all[p]) ptsT[win] += PROJ_PTS[G.contract.type][pr.t];
  let baloot = null;
  if (G.contract.type === 'hokm') {
    const T = G.contract.trump;
    for (let p = 0; p < 4; p++) if (G.hands[p].includes('K' + T) && G.hands[p].includes('Q' + T)) baloot = { p, shown: 0 };
  }
  G.projects = { all: all.map((l) => l.map((x) => x.t)), win, pts: ptsT };
  G.baloot = baloot;
}

/* ---------- AI ---------- */
const HV = { J: 3.5, 9: 3, A: 2, T: 1.5, K: 1, Q: 1, 8: 0.7, 7: 0.7 };
function hokmScore(cards, s) {
  let sc = 0, n = 0;
  for (const c of cards) {
    if (Su(c) === s) { n++; sc += HV[R(c)]; }
    else if (R(c) === 'A') sc += 1.4;
    else if (R(c) === 'T' && cards.includes('A' + Su(c))) sc += 0.6;
  }
  if (n >= 3) sc += 1; if (n >= 4) sc += 1; if (n <= 1) sc -= 2;
  return sc;
}
function sunScore(cards) {
  let sc = 0;
  for (const c of cards) {
    if (R(c) === 'A') sc += 2.6;
    else if (R(c) === 'T') sc += cards.includes('A' + Su(c)) ? 1.4 : 0.4;
    else if (R(c) === 'K') sc += 0.35;
  }
  return sc;
}
export function botBid(G, p, round, opts, lvl, rnd = Math.random) {
  const six = G.hands[p].concat([G.flip]);
  const noise = lvl === 'easy' ? rnd() * 3 - 1.5 : 0;
  const hokmBy = G.bid && G.bid.hokm;
  if (opts.includes('sun')) {
    const need = hokmBy != null && team(hokmBy) === team(p) ? 10.5 : 7.3;
    if (sunScore(six) + noise >= need) return { t: 'sun' };
  }
  if (round === 1 && opts.includes('hokm') && hokmScore(six, Su(G.flip)) + noise >= 7.2) return { t: 'hokm' };
  if (round === 2 && opts.includes('hokm2')) {
    let bs = null, bv = -9;
    for (const s of SUITS) if (s !== Su(G.flip)) { const v = hokmScore(six, s); if (v > bv) { bv = v; bs = s; } }
    if (bv + noise >= 7) return { t: 'hokm2', s: bs };
  }
  return { t: 'pass' };
}
export function botDouble(G, p) { return hokmScore(G.hands[p], G.contract.trump) >= 6.5; }

function unseenFor(G, p) { const known = new Set(G.played.concat(G.hands[p])); return FULL.filter((c) => !known.has(c)); }
function isMaster(G, c, p) { return !unseenFor(G, p).some((u) => Su(u) === Su(c) && rankPow(G, u) > rankPow(G, c)); }

export function botCard(G, p, level, rnd = Math.random) {
  const L = legal(G, p); if (L.length === 1) return L[0];
  if (level === 'easy' && rnd() < 0.55) return L[Math.floor(rnd() * L.length)];
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
        if (m.length) return byPow(m, -1)[0];
        if (p === G.contract.buyer && myT.length >= 4) return lowest(myT);
      }
    }
    const masters = L.filter((c) => !isTrump(G, c) && isMaster(G, c, p) && !oppMayCut(Su(c)));
    if (masters.length) return masters.sort((a, b) => pts(G, b) - pts(G, a))[0];
    if (hard && hokm) {
      const pv = L.filter((c) => !isTrump(G, c) && G.voids[partner(p)][Su(c)] && !G.voids[partner(p)][T] && pts(G, c) === 0);
      if (pv.length) return pv[0];
    }
    const side = L.filter((c) => !isTrump(G, c));
    const pool = (side.length ? side : L).filter((c) => !(R(c) === 'T' && !G.hands[p].includes('A' + Su(c)) && un.includes('A' + Su(c))));
    return lowest(pool.length ? pool : side.length ? side : L);
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
    if (partnerWin) return giveMost(L);
    if (winners.length) {
      const plain = winners.filter((c) => !isTrump(G, c));
      if (plain.length) return plain.sort((a, b) => pts(G, b) - pts(G, a) || rankPow(G, a) - rankPow(G, b))[0];
      if (trickPts >= 4 || rnd() < 0.6 || !hokm) return byPow(winners)[0];
    }
    return lowest(L);
  }
  if (partnerWin && safeCard(win.c)) return giveMost(L);
  if (partnerWin) return lowest(L);
  if (winners.length) {
    const sure = winners.filter(safeCard);
    if (sure.length) { const plain = sure.filter((c) => !isTrump(G, c)); return byPow(plain.length ? plain : sure)[0]; }
    const tw = winners.filter((c) => isTrump(G, c));
    if (tw.length && !winners.some((c) => !isTrump(G, c))) return byPow(tw)[0];
    if (trickPts >= 10) return byPow(winners, -1)[0];
  }
  return lowest(L);
}

/* ---------- game state machine ---------- */
export function newGame({ target = 152, level = 'mid', rnd = Math.random } = {}) {
  return {
    phase: 'idle', target, level, scores: [0, 0], dealer: Math.floor(rnd() * 4), round: 0, log: [],
    hands: [[], [], [], []], deck: [], flip: null, contract: null, bid: null, dbl: null,
    trick: [], trickNo: 0, leader: 0, turn: -1, raw: [0, 0], tricks: [0, 0], played: [], voids: [{}, {}, {}, {}],
    lastTrick: null, projects: null, baloot: null, summary: null, over: false,
    req: null, reqSeq: 0, ev: [], evSeq: 0,
  };
}
function ev(G, ...a) { G.evSeq++; G.ev.push([G.evSeq, ...a]); if (G.ev.length > 120) G.ev.shift(); }
export const addEvent = ev;
function setReq(G, p, k, d = {}) { G.req = { p, k, d, id: ++G.reqSeq }; G.turn = p; }
const bidText = (b, flip) => ({ hokm: 'حكم ' + sym(Su(flip)), sun: 'صن', pass: 'بس', ashkal: 'أشكل' }[b.t] || 'حكم ' + sym(b.s));
const sym = (s) => ({ S: '♠', H: '♥', D: '♦', C: '♣' }[s]);

export function startRound(G, rnd = Math.random) {
  Object.assign(G, {
    deck: shuffle(FULL.slice(), rnd), hands: [[], [], [], []], flip: null, contract: null, trick: [], trickNo: 0, turn: -1,
    raw: [0, 0], tricks: [0, 0], played: [], voids: [{}, {}, {}, {}], lastTrick: null, projects: null, baloot: null,
    summary: null, phase: 'bid', bid: { round: 1, i: 0, hokm: null, h2: null }, dbl: null, ev: G.ev.slice(-10),
  });
  for (const n of [3, 2]) for (let i = 1; i <= 4; i++) { const p = (G.dealer + i) % 4; for (let k = 0; k < n; k++) G.hands[p].push(G.deck.pop()); }
  G.flip = G.deck.pop();
  ev(G, 'deal', G.dealer);
  askBid(G);
}
function bidOrder(G) { return [1, 2, 3, 4].map((i) => (G.dealer + i) % 4); }
function askBid(G) {
  const b = G.bid, p = bidOrder(G)[b.i];
  let opts;
  if (b.round === 1) {
    opts = b.hokm === null ? ['hokm', 'sun', 'pass'] : ['sun', 'pass'];
    if (b.hokm === null && b.i >= 2 && R(G.flip) !== 'A') opts.push('ashkal');
  } else opts = b.h2 === null ? ['hokm2', 'sun', 'pass'] : ['sun', 'pass'];
  setReq(G, p, 'bid', { round: b.round, opts });
}
function applyBid(G, p, v) {
  const b = G.bid, opts = G.req.d.opts;
  if (!v || !opts.includes(v.t)) throw new Error('bad bid');
  if (v.t === 'hokm2' && (!SUITS.includes(v.s) || v.s === Su(G.flip))) throw new Error('bad suit');
  ev(G, 'bid', p, bidText(v, G.flip));
  if (v.t === 'sun') return finishContract(G, { type: 'sun', buyer: p });
  if (v.t === 'ashkal') return finishContract(G, { type: 'sun', buyer: partner(p), ashkal: p });
  if (v.t === 'hokm') b.hokm = p;
  if (v.t === 'hokm2') { b.h2 = { p, s: v.s }; b.hokm = p; }
  b.i++;
  if (b.i < 4) return askBid(G);
  if (b.round === 1) {
    if (b.hokm !== null) return finishContract(G, { type: 'hokm', trump: Su(G.flip), buyer: b.hokm });
    b.round = 2; b.i = 0; ev(G, 'r2'); return askBid(G);
  }
  if (b.h2) return finishContract(G, { type: 'hokm', trump: b.h2.s, buyer: b.h2.p });
  ev(G, 'redeal');
  G.dealer = (G.dealer + 1) % 4;
  startRound(G, G._rnd || Math.random);
}
function finishContract(G, ct) {
  G.contract = ct;
  ev(G, 'contract', ct.type, ct.trump || '', ct.buyer, ct.ashkal != null ? ct.ashkal : -1);
  if (ct.type === 'hokm') { G.phase = 'double'; G.dbl = { i: 0 }; setReq(G, (ct.buyer + 1) % 4, 'double'); }
  else dealRest(G);
}
function applyDouble(G, p, yes) {
  if (yes === true) { G.contract.doubled = true; ev(G, 'double', p); return dealRest(G); }
  G.dbl.i++;
  if (G.dbl.i < 2) return setReq(G, (G.contract.buyer + 3) % 4, 'double');
  dealRest(G);
}
function dealRest(G) {
  const ct = G.contract;
  for (let i = 1; i <= 4; i++) {
    const p = (G.dealer + i) % 4;
    if (p === ct.buyer) G.hands[p].push(G.flip, G.deck.pop(), G.deck.pop());
    else G.hands[p].push(G.deck.pop(), G.deck.pop(), G.deck.pop());
  }
  G.flip = null; G.phase = 'play'; resolveProjects(G);
  G.leader = (G.dealer + 1) % 4; G.trick = []; G.trickNo = 0;
  ev(G, 'play');
  setReq(G, G.leader, 'card');
}
function applyCard(G, p, c) {
  if (typeof c !== 'string' || !legal(G, p).includes(c)) throw new Error('illegal card');
  const h = G.hands[p]; h.splice(h.indexOf(c), 1);
  if (G.trick.length) {
    const led = Su(G.trick[0].c);
    if (Su(c) !== led) {
      G.voids[p][led] = true;
      if (G.contract.type === 'hokm' && led !== G.contract.trump && !isTrump(G, c) && team(winnerOf(G, G.trick).p) !== team(p)) G.voids[p][G.contract.trump] = true;
    }
  }
  G.trick.push({ p, c }); G.played.push(c);
  ev(G, 'card', p, c);
  if (G.trickNo === 0 && G.projects.all[p].length) ev(G, 'projbub', p, G.projects.all[p]);
  if (G.baloot && G.baloot.p === p && isTrump(G, c) && (R(c) === 'K' || R(c) === 'Q')) { G.baloot.shown++; if (G.baloot.shown === 2) ev(G, 'baloot', p); }
  if (G.trick.length < 4) return setReq(G, (p + 1) % 4, 'card');
  const w = winnerOf(G, G.trick).p;
  const gain = G.trick.reduce((a, t) => a + pts(G, t.c), 0) + (G.trickNo === 7 ? 10 : 0);
  G.raw[team(w)] += gain; G.tricks[team(w)]++;
  G.lastTrick = { cards: G.trick.slice(), w, gain };
  ev(G, 'trick', w, gain);
  G.leader = w; G.trick = []; G.trickNo++;
  if (G.trickNo === 1 && G.projects.win >= 0) {
    const pr = G.projects, list = [0, 1, 2, 3].filter((x) => team(x) === pr.win).flatMap((x) => pr.all[x]);
    const lost = [0, 1, 2, 3].filter((x) => team(x) !== pr.win).some((x) => pr.all[x].length);
    ev(G, 'proj', pr.win, list, pr.pts[pr.win], lost ? 1 : 0);
  }
  if (G.trickNo === 8) return scoreRound(G);
  setReq(G, w, 'card');
}
function scoreRound(G) {
  const ct = G.contract, b = team(ct.buyer), o = 1 - b, sun = ct.type === 'sun', total = sun ? 26 : 16;
  const pp = G.projects.pts.slice();
  let kaboot = -1; if (G.tricks[0] === 8) kaboot = 0; else if (G.tricks[1] === 8) kaboot = 1;
  const tp = [0, 0];
  if (kaboot >= 0) tp[kaboot] = sun ? 44 : 25;
  else { const bp = sun ? Math.round(G.raw[b] / 5) : Math.floor((G.raw[b] + 4) / 10); tp[b] = bp; tp[o] = total - bp; }
  let fin = [0, 0], note = 0;
  if (kaboot >= 0) { fin[kaboot] = tp[kaboot] + pp[kaboot] + (kaboot === o ? pp[b] : 0); note = 2 + kaboot; }
  else if (tp[b] + pp[b] <= tp[o] + pp[o]) { fin[o] = total + pp[0] + pp[1]; note = 1; }
  else fin = [tp[0] + pp[0], tp[1] + pp[1]];
  if (ct.doubled) fin = fin.map((x) => x * 2);
  let bal = -1; if (G.baloot) { fin[team(G.baloot.p)] += 2; bal = team(G.baloot.p); }
  G.scores[0] += fin[0]; G.scores[1] += fin[1];
  G.round++;
  const tc = sun ? 's' : 'h' + ct.trump;
  G.log.push([G.round, tc, ct.buyer, fin[0], fin[1], note, ct.doubled ? 1 : 0]);
  if (G.log.length > 40) G.log.shift();
  const done = (G.scores[0] >= G.target || G.scores[1] >= G.target) && G.scores[0] !== G.scores[1];
  const pr = [0, 1].map((tm) => [0, 1, 2, 3].filter((p) => team(p) === tm).flatMap((p) => G.projects.all[p]));
  G.summary = { n: G.round, tc, b: ct.buyer, d: ct.doubled ? 1 : 0, tk: G.tricks.slice(), raw: G.raw.slice(), tp, fin, pr, pw: G.projects.win, bal, note, done: done ? 1 : 0 };
  G.phase = 'roundEnd'; G.turn = -1;
  if (done) { G.over = true; G.winner = G.scores[0] > G.scores[1] ? 0 : 1; }
  G.kab = G.kab || [0, 0]; if (kaboot >= 0) G.kab[kaboot]++;
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
  if (kind === 'bid') applyBid(G, p, v);
  else if (kind === 'double') applyDouble(G, p, v);
  else if (kind === 'card') applyCard(G, p, v);
  delete G._rnd;
}
/** What a bot (or an auto-play for an absent player) would do now. */
export function botDecision(G, level, rnd = Math.random) {
  const q = G.req; if (!q) return null;
  if (q.k === 'bid') return botBid(G, q.p, q.d.round, q.d.opts, level, rnd);
  if (q.k === 'double') return botDouble(G, q.p);
  if (q.k === 'card') return botCard(G, q.p, level, rnd);
  return true;
}
/** Let bots play until a human has to decide. isBot(p) says which seats are bots. */
export function runBots(G, isBot, rnd = Math.random) {
  for (let guard = 0; guard < 400; guard++) {
    const q = G.req;
    if (!q || q.k === 'next' || !isBot(q.p)) return;
    act(G, q.p, q.k, botDecision(G, G.level, rnd), rnd);
  }
}
/** Everything a player may see (no hands, no deck). */
export function publicView(G) {
  return {
    phase: G.phase, target: G.target, scores: G.scores, dealer: G.dealer, round: G.round, log: G.log,
    counts: G.hands.map((h) => h.length), flip: G.flip, contract: G.contract, bid: G.bid ? { hokm: G.bid.hokm } : null,
    trick: G.trick, leader: G.leader, turn: G.turn, raw: G.raw, tricks: G.tricks, played: G.played, voids: G.voids,
    lastTrick: G.lastTrick, projects: G.trickNo >= 1 || G.phase === 'roundEnd' ? G.projects : null,
    baloot: G.baloot && G.baloot.shown === 2 ? G.baloot : null, summary: G.summary, over: G.over, winner: G.winner,
    req: G.req, ev: G.ev, evSeq: G.evSeq,
  };
}
