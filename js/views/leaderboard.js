// Leaderboard (/leaderboard): global, current season, and friends.
import { rpc, select } from '../api.js';
import { state } from '../state.js';
import { html, mount, personLink, tier, n, date } from '../ui.js';

const TABS = [['global', 'عام'], ['season', 'الموسم'], ['friends', 'الأصدقاء']];
const MEDAL = ['🥇', '🥈', '🥉'];
const pct = (w, g) => (g > 0 ? Math.round((w / g) * 100) : 0);

function tableTpl(rows, me) {
  return html`<div class="scroll-x"><table class="data">
    <caption class="sr-only">جدول الترتيب</caption>
    <thead><tr><th scope="col">#</th><th scope="col">اللاعب</th><th scope="col">الفئة</th><th scope="col">التصنيف</th><th scope="col">فوز</th><th scope="col">مباريات</th><th scope="col">نسبة الفوز</th></tr></thead>
    <tbody>${rows.map((r, i) => {
      const u = r.user || {}, mine = me && u.id === me, t = tier(r.rating);
      return html`<tr aria-current="${mine ? 'true' : 'false'}" style="${mine ? 'background:rgba(226,189,98,.13);box-shadow:inset 3px 0 0 var(--gold)' : ''}">
        <td class="num"><b>${i < 3 ? MEDAL[i] + ' ' : ''}${n(i + 1)}</b></td>
        <td style="min-width:170px">${personLink(u, { size: 36, sub: mine ? 'أنت' : '@' + u.username })}</td>
        <td><span class="rank" style="white-space:nowrap">${t.icon} ${t.name}</span></td>
        <td class="num"><b style="color:var(--gold)">${n(r.rating)}</b></td>
        <td class="num">${n(r.wins)}</td>
        <td class="num">${n(r.games)}</td>
        <td class="num">${n(pct(r.wins, r.games))}٪</td>
      </tr>`;
    })}</tbody></table></div>`;
}

export async function render(main) {
  const me = state.user && state.user.id;
  const qs = new URLSearchParams(location.search).get('tab');
  let current = TABS.some((t) => t[0] === qs) ? qs : 'global';
  let seq = 0;

  mount(main, html`<div class="section-title" style="margin:0"><h1>الترتيب</h1>
      ${state.profile ? html`<span class="small muted">تصنيفك <b class="num" style="color:var(--gold)">${n(state.profile.rating)}</b> · ${tier(state.profile.rating).icon} ${tier(state.profile.rating).name}</span>` : ''}</div>
    <div class="tabs" role="tablist" aria-label="نوع الترتيب">${TABS.map(([id, t]) => html`<button type="button" role="tab" id="lb-${id}" data-tab="${id}" aria-controls="lbPanel" aria-selected="${id === current ? 'true' : 'false'}" tabindex="${id === current ? '0' : '-1'}">${t}</button>`)}</div>
    <section class="card" id="lbPanel" role="tabpanel" aria-labelledby="lb-${current}"></section>
    <section class="card stack" aria-labelledby="howTitle" style="gap:6px">
      <h2 id="howTitle" style="font-size:18px">كيف ينحسب التصنيف؟</h2>
      <p class="muted small">نستخدم نظام «إيلو»: يبدأ كل لاعب من ١٠٠٠، ويتغيّر التصنيف في المباريات المصنّفة فقط (الودية والخاصة ما تأثر).
        الفوز على فريق بمستواك يعطيك حوالي +١٦، وعلى فريق أقوى منك يوصل لين +٣٢، وعلى فريق أضعف أقل. والخسارة بنفس المنطق: تنقص أكثر لو خسرت أمام فريق أضعف.
        اللي ينسحب من مباراة مصنّفة ينخصم منه ١٥ نقطة إضافية، ولو انسحب شريكك تنقص خسارتك للنصف.
        الترتيب العام يعرض اللاعبين اللي لعبوا مباراة مصنّفة واحدة على الأقل، وترتيب الموسم يبدأ من ١٠٠٠ مع كل موسم جديد.</p>
    </section>`);
  const panel = main.querySelector('#lbPanel'), tabs = main.querySelector('.tabs');

  const show = async (id, focus = false) => {
    current = id; const my = ++seq;
    tabs.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    panel.setAttribute('aria-labelledby', 'lb-' + id);
    history.replaceState(null, '', id === 'global' ? '/leaderboard' : '/leaderboard?tab=' + id);
    mount(panel, '<div class="loading" role="status" style="min-height:20vh"><div class="spinner"></div><span>لحظة…</span></div>');
    let rows, season = null, err = '';
    try {
      if (id === 'season') {
        season = await select('seasons', (q) => q.select('*').eq('active', true).maybeSingle());
        rows = season ? await rpc('leaderboard', { p_scope: 'season', p_limit: 100 }) : [];
      } else rows = await rpc('leaderboard', { p_scope: id, p_limit: 100 });
    } catch (e) { err = e.message; }
    if (my !== seq) return;
    if (err) {
      mount(panel, html`<div class="empty"><div class="art">⚠️</div><b>تعذّر تحميل الترتيب.</b><span>${err}</span><button class="btn" data-retry>حاول مرة ثانية</button></div>`);
      panel.querySelector('[data-retry]').onclick = () => show(id);
      return;
    }
    rows = rows || [];
    let head = '';
    if (id === 'season') {
      if (!season) { mount(panel, html`<div class="empty"><div class="art">📅</div><b>ما فيه موسم شغّال حالياً.</b><span>تابعنا، الموسم الجاي قريب.</span></div>`); return; }
      head = html`<div class="section-title"><h2>الموسم «${season.name}»</h2><span class="small muted">بدأ ${date(season.starts_at)}${season.ends_at ? html` · ينتهي ${date(season.ends_at)}` : ''}</span></div>`;
    } else if (id === 'global') head = html`<div class="section-title"><h2>أفضل اللاعبين</h2><span class="small muted">أعلى ١٠٠ تصنيف</span></div>`;
    else head = html`<div class="section-title"><h2>أنت وأصدقاؤك</h2></div>`;

    if (!rows.length) {
      const msg = id === 'friends'
        ? html`<div class="empty"><div class="art">🤝</div><b>أضف أصدقاء عشان تتنافسون.</b><a class="btn primary" href="/friends" data-link>ابحث عن ربعك</a></div>`
        : html`<div class="empty"><div class="art">🏆</div><b>ما فيه أحد في الترتيب للحين.</b><span>العب مباراة مصنّفة وكن أول اسم هنا.</span><a class="btn primary" href="/play" data-link>العب مصنّف</a></div>`;
      mount(panel, html`${head}${msg}`);
      return;
    }
    const mineIn = me && rows.some((r) => r.user && r.user.id === me);
    const foot = id !== 'friends' && state.profile && !mineIn
      ? html`<p class="hint" style="margin-top:10px">${id === 'season' ? 'ما دخلت ترتيب هذا الموسم للحين. العب مباريات مصنّفة عشان يظهر اسمك.' : 'اسمك مو ضمن أول ١٠٠. كل فوز مصنّف يقرّبك!'}</p>` : '';
    mount(panel, html`${head}${tableTpl(rows, me)}${foot}`);
  };

  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b && b.dataset.tab !== current) show(b.dataset.tab); });
  tabs.addEventListener('keydown', (e) => {
    const ids = TABS.map((t) => t[0]); let i = ids.indexOf(current);
    if (e.key === 'ArrowLeft') i = (i + 1) % ids.length; else if (e.key === 'ArrowRight') i = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = ids.length - 1; else return;
    e.preventDefault(); show(ids[i], true);
  });
  await show(current);
  return () => { seq++; };
}
