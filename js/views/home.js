// Home: account summary, play now, live numbers, rooms, online friends, invites, recent results, challenges.
import { rpc, select } from '../api.js';
import { html, mount, avatar, rankBadge, levelProgress, n, ago, $ } from '../ui.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { createRoom } from './play.js';

export async function render(main) {
  const p = state.profile;
  const lp = levelProgress(p.xp, p.level);
  const games = p.games || 0, wr = games ? Math.round((100 * (p.wins || 0)) / games) : 0;
  mount(main, html`
    <section class="card hero">
      ${avatar(p, 72)}
      <div class="stack" style="gap:6px">
        <div class="row between"><h1 style="font-size:22px;margin:0">هلا ${p.display_name || p.username}</h1>${rankBadge(p.rating)}</div>
        <div class="small muted">المستوى ${n(p.level)} · ${n(p.xp)} خبرة</div>
        <div class="bar" aria-label="التقدم للمستوى التالي"><i style="width:${lp.pct}%"></i></div>
      </div>
    </section>
    <section class="stats">
      <div class="stat"><b>${n(games)}</b><span>مباراة</span></div>
      <div class="stat"><b>${n(p.wins)}</b><span>فوز</span></div>
      <div class="stat"><b>${n(wr)}٪</b><span>نسبة الفوز</span></div>
      <div class="stat"><b>${n(p.best_streak)}</b><span>أفضل سلسلة</span></div>
    </section>
    <section class="card stack">
      <button class="btn primary big" id="playNow">العب الآن</button>
      <div class="row" style="flex-wrap:wrap">
        <a class="btn" href="/play" data-link>تنافسي / ودّي</a>
        <button class="btn" id="newRoom">غرفة خاصة</button>
        <form class="row" id="codeF" style="flex:1;min-width:200px"><input class="input" id="code" maxlength="10" placeholder="كود الغرفة" dir="ltr" aria-label="كود الغرفة" style="flex:1"><button class="btn" type="submit">انضم</button></form>
      </div>
      <p class="small muted" id="live">…</p>
    </section>
    <section class="card" id="resume" hidden></section>
    <section class="card"><div class="section-title"><h3>دعوات اللعب</h3></div><div id="inv" class="list"></div></section>
    <section class="card"><div class="section-title"><h3>الأصدقاء المتصلون</h3><a class="small" href="/friends" data-link>كل الأصدقاء</a></div><div id="fr" class="list"></div></section>
    <section class="card"><div class="section-title"><h3>الغرف العامة</h3><a class="small" href="/play" data-link>المزيد</a></div><div id="pub" class="list"></div></section>
    <section class="card"><div class="section-title"><h3>آخر النتائج</h3></div><div id="hist" class="list"></div></section>
    <section class="card"><div class="section-title"><h3>التحديات</h3><a class="small" href="/u/${p.username}" data-link>الإنجازات</a></div><div id="ch" class="list"></div></section>`);

  $('#playNow', main).onclick = () => navigate('/play');
  $('#newRoom', main).onclick = (e) => createRoom('private', e.currentTarget);
  $('#codeF', main).onsubmit = (e) => { e.preventDefault(); const c = $('#code', main).value.trim().toLowerCase(); if (c) navigate('/room/' + encodeURIComponent(c)); };
  const empty = (art, t, s = '') => html`<div class="empty"><div class="art">${art}</div><b>${t}</b>${s ? html`<span>${s}</span>` : ''}</div>`;

  const live = async () => {
    const s = await rpc('lobby_stats').catch(() => null); const el = $('#live', main);
    if (s && el) el.textContent = `${n(s.online)} متصل الحين · ${n(s.playing)} مباراة شغّالة · ${n(s.open_rooms)} غرفة عامة مفتوحة`;
  };
  const resume = async () => {
    const r = await select('rooms', (q) => q.select('code,status').contains('members', [state.user.id]).in('status', ['waiting', 'playing']).order('updated_at', { ascending: false }).limit(1)).catch(() => []);
    const box = $('#resume', main); if (!box || !r.length) return;
    box.hidden = false;
    mount(box, html`<div class="row between"><div><b>${r[0].status === 'playing' ? 'عندك مباراة شغّالة' : 'أنت في غرفة انتظار'}</b><div class="small muted">ارجع لكرسيك وورقك.</div></div><a class="btn primary" href="/room/${r[0].code}" data-link>ارجع</a></div>`);
  };
  const invites = async () => {
    const list = (await rpc('my_notifications', { p_limit: 30 }).catch(() => [])) || [];
    const inv = list.filter((x) => x.kind === 'room_invite' && Date.now() - new Date(x.at).getTime() < 3600e3).slice(0, 5);
    const box = $('#inv', main); if (!box) return;
    if (!inv.length) { mount(box, empty('✉️', 'ما عندك دعوات حالياً.', 'ادعُ ربعك من صفحة الأصدقاء أو من داخل الغرفة.')); return; }
    mount(box, html`${inv.map((x) => html`<div class="item">${avatar(x.data.from || {}, 36)}<div class="grow"><b>${(x.data.from && x.data.from.display_name) || ''}</b><div class="small muted">يدعوك لطاولة · ${ago(x.at)}</div></div><a class="btn small primary" href="/room/${x.data.code}" data-link>ادخل</a></div>`)}`);
  };
  const friends = async () => {
    const list = ((await rpc('list_friends').catch(() => [])) || []).filter((f) => f.online);
    const box = $('#fr', main); if (!box) return;
    if (!list.length) { mount(box, empty('🫂', 'ما فيه أصدقاء متصلين الحين.', 'ابحث عن ربعك وأضفهم من صفحة الأصدقاء.')); return; }
    mount(box, html`${list.slice(0, 8).map((f) => html`<a class="item" href="/u/${f.username}" data-link>${avatar(f, 36, { online: true })}<div class="grow"><b>${f.display_name}</b><div class="small muted">@${f.username} · المستوى ${n(f.level)}</div></div></a>`)}`);
  };
  const pub = async () => {
    const rows = await select('rooms', (q) => q.select('code,seats,rules,updated_at').eq('kind', 'public').eq('status', 'waiting')
      .gt('updated_at', new Date(Date.now() - 2 * 3600e3).toISOString()).order('updated_at', { ascending: false }).limit(5)).catch(() => []);
    const box = $('#pub', main); if (!box) return;
    if (!rows.length) { mount(box, empty('🪑', 'ما فيه غرف عامة مفتوحة الحين.', 'افتح غرفة عامة من صفحة اللعب.')); return; }
    mount(box, html`${rows.map((r) => { const s = r.seats.filter(Boolean); return html`<div class="item"><div class="grow"><b>طاولة ${s[0] ? s[0].name : ''}</b><div class="small muted">${s.length}/4 · ${ago(r.updated_at)}</div></div><a class="btn small primary" href="/room/${r.code}" data-link>انضم</a></div>`; })}`);
  };
  const hist = async () => {
    const list = (await rpc('player_history', { p_user: state.user.id, p_limit: 5 }).catch(() => [])) || [];
    const box = $('#hist', main); if (!box) return;
    if (!list.length) { mount(box, empty('🃏', 'ما لعبت مباريات بعد.', 'أول مباراة مكتملة بتظهر هنا.')); return; }
    mount(box, html`${list.map((m) => html`<a class="item" href="/match/${m.match_id}" data-link><span class="chip ${m.result === 'win' ? 'gold' : ''}">${m.result === 'win' ? 'فوز' : m.result === 'loss' ? 'خسارة' : 'تعادل'}</span>
      <div class="grow"><b>${n(m.us)} – ${n(m.them)}</b><div class="small muted">${m.ranked ? 'مصنّفة' : 'ودّية'} · ${ago(m.ended_at)}${m.abandoned ? ' · انسحاب' : ''}</div></div>
      <span class="small">${m.ranked ? (m.rating_delta >= 0 ? '+' : '') + n(m.rating_delta) + ' تصنيف · ' : ''}+${n(m.xp)} خبرة</span></a>`)}`);
  };
  const challenges = async () => {
    const pr = await rpc('my_progress').catch(() => null);
    const box = $('#ch', main); if (!box) return;
    const list = (pr && pr.challenges) || [];
    if (!list.length) { mount(box, empty('🎯', 'ما فيه تحديات فعّالة حالياً.')); return; }
    mount(box, html`${list.map((c) => html`<div class="item"><div class="grow"><b>${c.done ? '✅ ' : ''}${c.title}</b><div class="small muted">${c.period === 'daily' ? 'يومي' : 'أسبوعي'} · +${n(c.reward_xp)} خبرة</div>
      <div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, (100 * c.progress) / c.target)}%"></i></div></div><span class="small">${n(Math.min(c.progress, c.target))}/${n(c.target)}</span></div>`)}`);
  };
  await Promise.all([live(), resume(), invites(), friends(), pub(), hist(), challenges()]);
  const t = setInterval(() => { live(); friends(); }, 20000);
  return () => clearInterval(t);
}
