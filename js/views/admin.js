// Staff panel. Every action is role-checked on the server; this view only hides what the role cannot do.
import { rpc, game } from '../api.js';
import { state } from '../state.js';
import { html, raw, mount, toast, toastErr, dialog, confirmBox, busy, ago, date, n } from '../ui.js';

/* ---------- roles ---------- */
const RANK = { owner: 3, admin: 2, moderator: 1 };
const rank = (r) => RANK[r] || 0;
const ROLE_NAME = { owner: 'المالك', admin: 'إداري', moderator: 'مشرف' };

/* ---------- labels ---------- */
const BAN_HOURS = [
  { h: 1, t: 'ساعة واحدة' }, { h: 6, t: '٦ ساعات' }, { h: 24, t: 'يوم واحد' }, { h: 72, t: '٣ أيام' },
  { h: 168, t: 'أسبوع', admin: true }, { h: 720, t: '٣٠ يوماً', admin: true },
];
const REPORT_KIND = { user: 'لاعب', message: 'رسالة', match: 'مباراة' };
const REPORT_REASON = { abuse: 'إساءة أو سب', cheating: 'غش أو تواطؤ', spam: 'إزعاج وتكرار', inappropriate_name: 'اسم غير لائق', leaving: 'انسحاب متعمّد', other: 'سبب آخر' };
const REPORT_STATUS = { open: 'مفتوح', resolved: 'تمت المعالجة', dismissed: 'مرفوض' };
const ROOM_KIND = { private: 'خاصة', public: 'عامة', ranked: 'مصنّفة', friendly: 'ودية' };
const ROOM_STATUS = { waiting: 'بانتظار اللاعبين', playing: 'مباراة جارية', finished: 'انتهت', closed: 'مقفلة' };
const MATCH_STATUS = { playing: 'جارية', finished: 'انتهت', abandoned: 'ملغاة' };
const PERIOD = { daily: 'يومي', weekly: 'أسبوعي' };
const AUDIT_ACTION = {
  ban: 'إيقاف حساب', unban: 'رفع إيقاف', set_role: 'تغيير صلاحية', resolve_report: 'معالجة بلاغ', close_room: 'إقفال غرفة',
  season_start: 'بدء موسم', challenge_toggle: 'تفعيل/إيقاف تحدٍّ', owner_bootstrap: 'تعيين المالك', delete_account: 'حذف حساب',
};
const OUTCOME = ['تمّت', 'خسر المشتري', 'كبوت', 'كبوت عكسي', 'تعادل'];
const SUIT = { S: '♠', H: '♥', C: '♣', D: '♦' };
const card = (c) => (typeof c === 'string' && c.length >= 2 ? c.slice(0, -1).replace('T', '10') + (SUIT[c.slice(-1)] || c.slice(-1)) : String(c ?? ''));
const contractText = (tc) => (tc === 's' ? 'صن' : typeof tc === 'string' && tc[0] === 'h' ? 'حكم ' + (SUIT[tc[1]] || '') : String(tc ?? ''));
const when = (ts) => (ts ? new Date(ts).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const json = (v) => { try { return JSON.stringify(v ?? null); } catch { return String(v); } };
const isBanned = (p) => !!(p.ban_permanent || (p.ban_until && new Date(p.ban_until).getTime() > Date.now()));
const byAtDesc = (a, b) => new Date(b.at || 0) - new Date(a.at || 0);

const TABS = [
  { id: 'overview', t: 'نظرة عامة' }, { id: 'players', t: 'اللاعبون' }, { id: 'reports', t: 'البلاغات' },
  { id: 'rooms', t: 'الغرف' }, { id: 'seasons', t: 'المواسم والتحديات' }, { id: 'logs', t: 'السجلات' },
];

/* ---------- form dialogs ---------- */
/** Opens a dialog holding a <form>; resolves with collect(form) on valid submit, or null when cancelled. */
function formDialog(tpl, collect, label) {
  const d = dialog(tpl, { label });
  let out = null;
  const form = d.el.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const v = collect(form);
    if (v === false) return;
    out = v; d.close('ok');
  });
  return d.done.then((r) => (r === 'ok' ? out : null));
}
const trimmed = (form, name) => String(form.elements[name]?.value || '').trim();
function invalid(form, name, msg) {
  const el = form.elements[name];
  el.setAttribute('aria-invalid', 'true'); el.setCustomValidity(msg); el.reportValidity();
  el.addEventListener('input', () => { el.removeAttribute('aria-invalid'); el.setCustomValidity(''); }, { once: true });
  return false;
}

/** Ban dialog → {hours|null, reason} or null. Options follow the caller's role (server enforces the same). */
function banDialog(target, presetReason = '') {
  const admin = rank(state.role) >= 2;
  const opts = BAN_HOURS.filter((o) => admin || !o.admin);
  return formDialog(html`
    <form class="stack" novalidate>
      <h2>إيقاف ${target}</h2>
      <div class="field"><label for="banHours">المدة</label>
        <select id="banHours" name="hours" class="input">
          ${opts.map((o) => html`<option value="${o.h}" ${o.h === 24 ? raw('selected') : ''}>${o.t}</option>`)}
          ${admin ? html`<option value="perm">إيقاف دائم</option>` : ''}
        </select>
        ${admin ? '' : html`<span class="muted small">المشرف يقدر يوقف حتى ٣ أيام. للأطول اطلب من إداري.</span>`}
      </div>
      <div class="field"><label for="banReason">السبب (يظهر للاعب)</label>
        <textarea id="banReason" name="reason" class="input" rows="3" maxlength="300" required autofocus>${presetReason}</textarea>
      </div>
      <div class="actions"><button type="button" class="btn" data-close="">إلغاء</button><button type="submit" class="btn danger">متابعة</button></div>
    </form>`, (f) => {
    const reason = trimmed(f, 'reason');
    if (reason.length < 3) return invalid(f, 'reason', 'اكتب سبباً واضحاً (٣ أحرف على الأقل).');
    const h = f.elements.hours.value;
    return { hours: h === 'perm' ? null : Number(h), reason };
  }, 'إيقاف لاعب');
}
async function doBan(btn, userId, name, presetReason, after) {
  const v = await banDialog(name, presetReason);
  if (!v) return;
  const span = v.hours === null ? 'إيقافاً دائماً' : `لمدة ${BAN_HOURS.find((o) => o.h === v.hours)?.t || n(v.hours) + ' ساعة'}`;
  if (!(await confirmBox('تأكيد الإيقاف', `سيتم إيقاف ${name} ${span}، ويُخرج من قائمة الانتظار.`, { ok: 'أوقف الحساب', danger: true }))) return;
  const ok = await busy(btn, () => game('admin_ban', { user: userId, hours: v.hours, reason: v.reason }));
  if (ok !== undefined) { toast('تم إيقاف الحساب.'); after(); }
}

/* ---------- match viewer ---------- */
function eventLine(e, seatName) {
  const d = Array.isArray(e.data) ? e.data : [];
  const p = (i) => seatName(d[i]);
  switch (e.kind) {
    case 'deal': return `توزيع الجولة ${n(d[1])} — الموزّع ${p(0)}`;
    case 'bid': return `${p(0)}: ${d[1] ?? ''}`;
    case 'r2': return 'الشراء الثاني';
    case 'redeal': return 'إعادة توزيع (ما أحد اشترى)';
    case 'contract': return `العقد: ${d[0] === 'sun' ? 'صن' : 'حكم ' + (SUIT[d[1]] || '')} — المشتري ${p(2)}${d[3] ? ' (أشكل)' : ''}`;
    case 'double': return `${p(0)}: ${d[2] || 'مضاعفة'}`;
    case 'play': return `بدء اللعب — المضاعف ×${n(d[0])}${d[1] ? ' (مقفول)' : ''}`;
    case 'card': return `${p(0)} لعب ${card(d[1])}`;
    case 'projbub': return `${p(0)} أعلن مشروع: ${(d[1] || []).join('، ')}`;
    case 'baloot': return `${p(0)}: بلوت`;
    case 'trick': return `الأكلة لـ ${p(0)} (+${n(d[1])})`;
    case 'projshow': return `مشاريع الفريق ${n((d[0] ?? 0) + 1)}: ${n(d[2])} نقطة${d[3] ? ' (ألغت مشاريع الخصم)' : ''}`;
    case 'summary': { const s = d[0] || {}; return `نهاية الجولة ${n(s.n)}: ${n(s.fin?.[0])} – ${n(s.fin?.[1])} · المجموع ${n(s.scores?.[0])} – ${n(s.scores?.[1])}`; }
    default: return `${e.kind}: ${json(e.data)}`;
  }
}
async function showMatch(btn, matchId) {
  const m = await busy(btn, () => rpc('match_detail', { p_match: matchId }));
  if (!m) return;
  const players = Array.isArray(m.players) ? m.players : [];
  const results = Array.isArray(m.results) ? m.results : [];
  const seatName = (s) => { const x = players.find((q) => q.seat === s); return x ? x.name : (s === undefined || s === null ? '' : `مقعد ${n(Number(s) + 1)}`); };
  const finished = m.status !== 'playing';
  const events = finished && Array.isArray(m.events) ? m.events : [];
  const hands = events.filter((e) => e.kind === 'hands');
  const log = events.filter((e) => e.kind !== 'hands');
  // group the log into rounds at every deal
  const groups = [];
  for (const e of log) { if (e.kind === 'deal' || !groups.length) groups.push({ title: e.kind === 'deal' ? `الجولة ${n(e.data?.[1])}` : 'بداية', items: [] }); groups[groups.length - 1].items.push(e); }
  const rounds = Array.isArray(m.rounds) ? m.rounds : [];
  const res = (uid) => results.find((r) => r.user_id === uid);
  dialog(html`
    <div class="stack">
      <div class="row between"><h2>تفاصيل المباراة</h2><button class="btn small" data-close="" aria-label="إغلاق">✕</button></div>
      <div class="row">
        <span class="chip ${m.ranked ? 'gold' : ''}">${m.ranked ? 'مصنّفة' : 'غير مصنّفة'}</span>
        <span class="chip ${m.status === 'playing' ? 'live' : ''}">${MATCH_STATUS[m.status] || m.status}</span>
        <span class="muted small">بدأت ${when(m.started_at)}${m.ended_at ? ' · انتهت ' + when(m.ended_at) : ''}</span>
      </div>
      <div class="stats">
        <div class="stat"><b>${m.score0 ?? '—'}</b><span>الفريق ١ ${m.winner_team === 0 ? '🏆' : ''}</span></div>
        <div class="stat"><b>${m.score1 ?? '—'}</b><span>الفريق ٢ ${m.winner_team === 1 ? '🏆' : ''}</span></div>
      </div>
      <div class="scroll-x"><table class="data">
        <thead><tr><th>المقعد</th><th>اللاعب</th><th>الفريق</th><th>النتيجة</th><th>التقييم</th></tr></thead>
        <tbody>${players.map((pl) => { const r = res(pl.uid) || {}; return html`<tr>
          <td>${n(pl.seat + 1)}</td><td>${pl.name}</td><td>${n((pl.seat % 2) + 1)}</td>
          <td>${r.result || '—'}${r.abandoned ? html` <span class="chip warn">انسحب</span>` : ''}</td>
          <td>${r.rating_before != null ? `${n(r.rating_before)} ← ${n(r.rating_after)}` : '—'}</td></tr>`; })}</tbody>
      </table></div>
      <h3>الجولات</h3>
      ${rounds.length ? html`<div class="scroll-x"><table class="data">
        <thead><tr><th>#</th><th>العقد</th><th>المشتري</th><th>الفريق ١</th><th>الفريق ٢</th><th>النتيجة</th></tr></thead>
        <tbody>${rounds.map((r) => (Array.isArray(r) ? html`<tr><td>${n(r[0])}</td><td>${contractText(r[1])}${r[6] > 1 ? ` ×${n(r[6])}` : ''}${r[7] ? ' ☕' : ''}</td><td>${seatName(r[2])}</td><td>${n(r[3])}</td><td>${n(r[4])}</td><td>${OUTCOME[r[5]] ?? ''}</td></tr>` : html`<tr><td colspan="6"><code>${json(r)}</code></td></tr>`))}</tbody>
      </table></div>` : html`<p class="muted">ما فيه جولات مسجّلة.</p>`}
      <h3>سجل الأحداث</h3>
      ${!finished ? html`<p class="muted">المباراة جارية. يظهر السجل وتوزيع الأوراق بعد نهايتها.</p>`
        : !log.length ? html`<p class="muted">ما فيه أحداث محفوظة.</p>`
        : groups.map((g) => html`<details ${groups.length === 1 ? raw('open') : ''}>
            <summary>${g.title} <span class="muted small">(${n(g.items.length)} حدث)</span></summary>
            <ol class="small">${g.items.map((e) => html`<li>${eventLine(e, seatName)}</li>`)}</ol>
          </details>`)}
      ${finished && hands.length ? html`<h3>الأوراق الموزّعة كاملة</h3>
        ${hands.map((h, i) => html`<details><summary>التوزيعة ${n(i + 1)}</summary>
          <ul class="small">${(Array.isArray(h.data) ? h.data : []).map((cards, s) => html`<li><b>${seatName(s)}:</b> <span dir="ltr">${(Array.isArray(cards) ? cards : []).map(card).join(' ')}</span></li>`)}</ul>
        </details>`)}` : ''}
    </div>`, { label: 'تفاصيل المباراة' });
}

/* ---------- view ---------- */
export async function render(main) {
  const role = state.role;
  if (!role) {
    mount(main, html`<div class="empty"><div class="art">🔒</div><b>هذي الصفحة لطاقم الإدارة فقط.</b><span>ما عندك صلاحية الدخول للوحة التحكم.</span><a class="btn" href="/" data-link>الرئيسية</a></div>`);
    return;
  }
  const R = rank(role);
  let alive = true, timer = null, tab = 'overview', token = 0;
  const ui = { playersQ: '', reportStatus: 'open' };

  mount(main, html`
    <section class="stack">
      <div class="row between"><h1>لوحة التحكم</h1><span class="chip gold">${ROLE_NAME[role] || role}</span></div>
      <div class="tabs" role="tablist" aria-label="أقسام لوحة التحكم">
        ${TABS.map((t) => html`<button role="tab" id="tab-${t.id}" aria-controls="adminPanel" data-tab="${t.id}" aria-selected="${t.id === tab ? 'true' : 'false'}" tabindex="${t.id === tab ? '0' : '-1'}">${t.t}</button>`)}
      </div>
      <div id="adminPanel" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="-1"></div>
    </section>`);
  const tablist = main.querySelector('[role=tablist]');
  const panel = main.querySelector('#adminPanel');
  const loading = () => mount(panel, html`<div class="loading" role="status"><div class="spinner"></div><span>لحظة…</span></div>`);
  const failed = (e, retry) => {
    mount(panel, html`<div class="empty"><div class="art">⚠️</div><b>تعذّر التحميل.</b><span>${e && e.message ? e.message : ''}</span><button class="btn" data-act="retry">إعادة المحاولة</button></div>`);
    panel.onclick = (ev) => { if (ev.target.closest('[data-act=retry]')) retry(); };
  };
  /** Runs loader for the current tab; drops the result if the user moved on. */
  async function load(fn, draw) {
    const my = ++token;
    try { const d = await fn(); if (alive && my === token) draw(d); }
    catch (e) { if (alive && my === token) failed(e, () => show(tab)); }
  }

  function selectTab(id, focus = false) {
    for (const b of tablist.querySelectorAll('[role=tab]')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    panel.setAttribute('aria-labelledby', 'tab-' + id);
    show(id);
  }
  tablist.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) selectTab(b.dataset.tab); });
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    // RTL: the next tab sits to the left
    const step = { ArrowLeft: 1, ArrowRight: -1 }[e.key];
    let j = null;
    if (step) j = (i + step + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j === null) return;
    e.preventDefault(); selectTab(TABS[j].id, true);
  });

  function show(id) {
    tab = id;
    clearInterval(timer); timer = null;
    panel.onclick = panel.onchange = panel.onsubmit = null;
    loading();
    ({ overview, players, reports, rooms, seasons, logs })[id]();
  }

  /* ----- overview ----- */
  function overview() {
    const tiles = [
      ['users', 'الحسابات'], ['profiles', 'الملفات المكتملة'], ['online', 'متصل الآن'], ['signups_7d', 'تسجيلات ٧ أيام'],
      ['rooms_waiting', 'غرف بالانتظار'], ['rooms_playing', 'مباريات جارية'], ['queue', 'في قائمة البحث'],
      ['matches_today', 'مباريات آخر ٢٤ ساعة'], ['matches_total', 'مباريات مكتملة'], ['open_reports', 'بلاغات مفتوحة'], ['errors_24h', 'أخطاء ٢٤ ساعة'],
    ];
    const draw = (o) => {
      mount(panel, html`<div class="stack">
        <div class="row between"><span class="muted small" aria-live="polite">آخر تحديث: ${new Date().toLocaleTimeString('ar-SA', { timeStyle: 'short' })} · يتحدّث كل ٣٠ ثانية</span>
          <button class="btn small" data-act="refresh">تحديث</button></div>
        <div class="stats">${tiles.map(([k, t]) => html`<div class="stat"><b>${o && o[k] != null ? n(o[k]) : '—'}</b><span>${t}</span></div>`)}</div>
        ${o && o.open_reports > 0 ? html`<div class="row"><span class="chip warn">${n(o.open_reports)} بلاغ ينتظر المراجعة</span><button class="btn small" data-act="go-reports">افتح البلاغات</button></div>` : ''}
        ${o && o.errors_24h > 0 ? html`<div class="row"><span class="chip warn">${n(o.errors_24h)} خطأ في الخادم خلال ٢٤ ساعة</span><button class="btn small" data-act="go-logs">افتح السجلات</button></div>` : ''}
      </div>`);
    };
    const fetchIt = () => load(() => rpc('admin_overview'), draw);
    panel.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'refresh') { const o = await busy(b, () => rpc('admin_overview')); if (o && alive && tab === 'overview') draw(o); }
      if (b.dataset.act === 'go-reports') selectTab('reports', true);
      if (b.dataset.act === 'go-logs') selectTab('logs', true);
    };
    fetchIt();
    timer = setInterval(() => { if (!document.hidden && tab === 'overview') rpc('admin_overview').then((o) => { if (alive && tab === 'overview') draw(o); }).catch(() => {}); }, 30_000);
  }

  /* ----- players ----- */
  function players() {
    let rows = [];
    const draw = (list) => {
      rows = Array.isArray(list) ? list : [];
      mount(panel, html`<div class="stack">
        <form class="row" role="search" data-form="search">
          <label class="muted small" for="pq">بحث</label>
          <input id="pq" name="q" class="input" type="search" placeholder="اسم المستخدم أو رقم اللاعب" value="${ui.playersQ}" style="flex:1;min-width:180px" autocomplete="off">
          <button class="btn primary" type="submit">بحث</button>
        </form>
        <span class="muted small">${ui.playersQ ? `نتائج «${ui.playersQ}»: ${n(rows.length)}` : `أحدث ${n(rows.length)} لاعب`}</span>
        ${rows.length ? html`<div class="scroll-x"><table class="data">
          <thead><tr><th>اللاعب</th><th>التقييم</th><th>المباريات</th><th>البلاغات</th><th>آخر ظهور</th><th>الحالة</th><th>الصلاحية</th><th>إجراءات</th></tr></thead>
          <tbody>${rows.map((p, i) => playerRow(p, i))}</tbody></table></div>`
        : html`<div class="empty"><div class="art">🔎</div><b>ما لقينا لاعبين.</b></div>`}
      </div>`);
    };
    function playerRow(p, i) {
      const banned = isBanned(p), self = state.user && p.id === state.user.id;
      const canBan = !self && p.role !== 'owner' && (!p.role || R >= 3);
      return html`<tr>
        <td><a href="/u/${encodeURIComponent(p.username)}" data-link><b>${p.display_name || p.username}</b></a><br><span class="muted small">@${p.username} · #${p.player_no ?? ''}</span><br><span class="muted small">انضم ${date(p.joined)}</span></td>
        <td>${n(p.rating)}</td><td>${n(p.games)}</td>
        <td>${p.reports > 0 ? html`<span class="chip warn">${n(p.reports)}</span>` : n(0)}</td>
        <td>${p.last_seen ? ago(p.last_seen) : '—'}</td>
        <td>${banned ? html`<span class="chip warn">${p.ban_permanent ? 'موقوف دائماً' : 'موقوف حتى ' + when(p.ban_until)}</span>${p.ban_reason ? html`<br><span class="muted small">${p.ban_reason}</span>` : ''}` : html`<span class="chip">نشط</span>`}</td>
        <td>${R >= 3 && !self && p.role !== 'owner'
          ? html`<select class="input" data-role="${i}" aria-label="صلاحية ${p.username}">
              <option value="" ${!p.role ? raw('selected') : ''}>لاعب</option>
              <option value="moderator" ${p.role === 'moderator' ? raw('selected') : ''}>مشرف</option>
              <option value="admin" ${p.role === 'admin' ? raw('selected') : ''}>إداري</option></select>`
          : p.role ? html`<span class="chip gold">${ROLE_NAME[p.role] || p.role}</span>` : html`<span class="muted">لاعب</span>`}</td>
        <td><div class="row">
          ${canBan ? html`<button class="btn small danger" data-act="ban" data-i="${i}">${banned ? 'تعديل الإيقاف' : 'إيقاف'}</button>` : ''}
          ${banned && !self ? html`<button class="btn small" data-act="unban" data-i="${i}">رفع الإيقاف</button>` : ''}
        </div></td></tr>`;
    }
    const reload = () => load(() => rpc('admin_players', { p_q: ui.playersQ }), draw);
    panel.onsubmit = (e) => {
      if (!e.target.matches('[data-form=search]')) return;
      e.preventDefault(); ui.playersQ = String(e.target.elements.q.value || '').trim(); loading(); reload();
    };
    panel.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const p = rows[Number(b.dataset.i)]; if (!p) return;
      const name = p.display_name || p.username;
      if (b.dataset.act === 'ban') doBan(b, p.id, name, p.ban_reason || '', reload);
      if (b.dataset.act === 'unban') {
        if (!(await confirmBox('رفع الإيقاف', `يرجع ${name} يقدر يلعب ويدردش مباشرة.`, { ok: 'ارفع الإيقاف' }))) return;
        const ok = await busy(b, () => rpc('admin_unban', { p_user: p.id }));
        if (ok !== undefined) { toast('تم رفع الإيقاف.'); reload(); }
      }
    };
    panel.onchange = async (e) => {
      const s = e.target.closest('select[data-role]'); if (!s) return;
      const p = rows[Number(s.dataset.role)]; if (!p) return;
      const next = s.value || null, prev = p.role || '';
      const label = next ? ROLE_NAME[next] : 'لاعب عادي';
      if (!(await confirmBox('تغيير الصلاحية', `تغيير صلاحية ${p.display_name || p.username} إلى «${label}».`, { ok: 'غيّر', danger: !next || next === 'admin' }))) { s.value = prev; return; }
      const ok = await busy(s, () => game('admin_set_role', { user: p.id, role: next }));
      if (ok !== undefined) { toast('تم تحديث الصلاحية.'); reload(); } else s.value = prev;
    };
    reload();
  }

  /* ----- reports ----- */
  function reports() {
    let rows = [];
    const draw = (list) => {
      rows = Array.isArray(list) ? list : [];
      mount(panel, html`<div class="stack">
        <div class="seg" role="group" aria-label="حالة البلاغ">
          ${['open', 'resolved', 'dismissed', 'all'].map((s) => html`<button type="button" data-status="${s}" aria-pressed="${ui.reportStatus === s ? 'true' : 'false'}">${s === 'all' ? 'الكل' : REPORT_STATUS[s]}</button>`)}
        </div>
        ${rows.length ? html`<div class="stack">${rows.map(reportCard)}</div>`
          : html`<div class="empty"><div class="art">✅</div><b>${ui.reportStatus === 'open' ? 'ما فيه بلاغات مفتوحة.' : 'ما فيه بلاغات بهذي الحالة.'}</b></div>`}
      </div>`);
    };
    function reportCard(r, i) {
      return html`<article class="card stack" aria-label="بلاغ رقم ${r.id}">
        <div class="row between">
          <div class="row"><span class="chip gold">${REPORT_KIND[r.kind] || r.kind}</span><b>${REPORT_REASON[r.reason] || r.reason}</b>
            <span class="chip ${r.status === 'open' ? 'warn' : ''}">${REPORT_STATUS[r.status] || r.status}</span></div>
          <span class="muted small" title="${when(r.at)}">#${r.id} · ${ago(r.at)}</span>
        </div>
        <div class="row small">
          <span>المُبلِّغ: ${r.reporter ? html`<a href="/u/${encodeURIComponent(r.reporter)}" data-link>@${r.reporter}</a>` : html`<span class="muted">محذوف</span>`}</span>
          <span aria-hidden="true">←</span>
          <span>المُبلَّغ عنه: ${r.target ? html`<a href="/u/${encodeURIComponent(r.target)}" data-link>@${r.target}</a>` : html`<span class="muted">—</span>`}</span>
        </div>
        ${r.details ? html`<p>${r.details}</p>` : ''}
        ${r.kind === 'message' ? html`<blockquote class="card small"><span class="muted">نص الرسالة:</span> ${r.message != null ? r.message : html`<span class="muted">الرسالة غير متوفرة</span>`}</blockquote>` : ''}
        ${r.resolution ? html`<p class="muted small">القرار: ${r.resolution}</p>` : ''}
        <div class="row">
          ${r.kind === 'match' && r.ref_id ? html`<button class="btn small" data-act="match" data-i="${i}">أحداث المباراة</button>` : ''}
          ${r.status === 'open' ? html`
            <button class="btn small primary" data-act="resolve" data-i="${i}">معالجة</button>
            <button class="btn small" data-act="dismiss" data-i="${i}">رفض البلاغ</button>` : ''}
          ${r.target_id && r.target ? html`<button class="btn small danger" data-act="ban" data-i="${i}">إيقاف المُبلَّغ عنه</button>` : ''}
        </div>
      </article>`;
    }
    const reload = () => load(() => rpc('admin_reports', { p_status: ui.reportStatus }), draw);
    async function settle(b, r, status) {
      const resolve = status === 'resolved';
      const v = await formDialog(html`
        <form class="stack" novalidate>
          <h2>${resolve ? 'معالجة البلاغ' : 'رفض البلاغ'} #${r.id}</h2>
          <div class="field"><label for="resText">${resolve ? 'الإجراء المتخذ' : 'سبب الرفض (اختياري)'}</label>
            <textarea id="resText" name="res" class="input" rows="3" maxlength="300" ${resolve ? raw('required') : ''} autofocus></textarea></div>
          ${resolve && r.kind === 'message' ? html`<label class="row"><input type="checkbox" name="hide" checked> إخفاء الرسالة من الدردشة</label>` : ''}
          <div class="actions"><button type="button" class="btn" data-close="">إلغاء</button><button type="submit" class="btn ${resolve ? 'primary' : 'danger'}">متابعة</button></div>
        </form>`, (f) => {
        const res = trimmed(f, 'res');
        if (resolve && res.length < 3) return invalid(f, 'res', 'اكتب الإجراء المتخذ.');
        return { res, hide: !!(f.elements.hide && f.elements.hide.checked) };
      }, resolve ? 'معالجة البلاغ' : 'رفض البلاغ');
      if (!v) return;
      if (!(await confirmBox(resolve ? 'تأكيد المعالجة' : 'تأكيد الرفض', `${resolve ? 'سيُغلق البلاغ كمعالَج' : 'سيُغلق البلاغ كمرفوض'}${v.hide ? ' وتُخفى الرسالة' : ''}.`, { ok: 'تأكيد', danger: !resolve || v.hide }))) return;
      const ok = await busy(b, () => rpc('admin_resolve_report', { p_id: r.id, p_status: status, p_resolution: v.res, p_hide_message: v.hide }));
      if (ok !== undefined) { toast(resolve ? 'تمت معالجة البلاغ.' : 'تم رفض البلاغ.'); reload(); }
    }
    panel.onclick = (e) => {
      const st = e.target.closest('[data-status]');
      if (st) { ui.reportStatus = st.dataset.status; loading(); reload(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const r = rows[Number(b.dataset.i)]; if (!r) return;
      if (b.dataset.act === 'match') showMatch(b, r.ref_id);
      if (b.dataset.act === 'resolve') settle(b, r, 'resolved');
      if (b.dataset.act === 'dismiss') settle(b, r, 'dismissed');
      if (b.dataset.act === 'ban') doBan(b, r.target_id, '@' + r.target, `بلاغ #${r.id}: ${REPORT_REASON[r.reason] || r.reason}`, reload);
    };
    reload();
  }

  /* ----- rooms ----- */
  function rooms() {
    let rows = [];
    const draw = (list) => {
      rows = Array.isArray(list) ? list : [];
      const stuck = rows.filter((r) => r.stuck).length;
      mount(panel, html`<div class="stack">
        <div class="row between"><span class="muted small">${n(rows.length)} غرفة مفتوحة${stuck ? html` · <span class="chip warn">${n(stuck)} عالقة</span>` : ''}</span>
          <button class="btn small" data-act="refresh">تحديث</button></div>
        ${rows.length ? html`<div class="scroll-x"><table class="data">
          <thead><tr><th>الكود</th><th>النوع</th><th>الحالة</th><th>اللاعبون</th><th>آخر نشاط</th><th>إجراءات</th></tr></thead>
          <tbody>${rows.map((r, i) => html`<tr ${r.stuck ? raw('style="background:rgba(255,180,0,.08)"') : ''}>
            <td><b dir="ltr">${r.code}</b></td><td>${ROOM_KIND[r.kind] || r.kind}</td>
            <td>${ROOM_STATUS[r.status] || r.status}${r.stuck ? html` <span class="chip warn">عالقة</span>` : ''}</td>
            <td>${n(r.players)}/${n(4)}</td><td title="${when(r.updated_at)}">${ago(r.updated_at)}</td>
            <td><div class="row">
              ${r.match_id ? html`<button class="btn small" data-act="match" data-i="${i}">المباراة</button>` : ''}
              <button class="btn small danger" data-act="close" data-i="${i}">إقفال</button></div></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty"><div class="art">🪑</div><b>ما فيه غرف مفتوحة.</b></div>`}
      </div>`);
    };
    const reload = () => load(() => rpc('admin_rooms'), draw);
    panel.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'refresh') { const d = await busy(b, () => rpc('admin_rooms')); if (d && alive && tab === 'rooms') draw(d); return; }
      const r = rows[Number(b.dataset.i)]; if (!r) return;
      if (b.dataset.act === 'match') showMatch(b, r.match_id);
      if (b.dataset.act === 'close') {
        const v = await formDialog(html`<form class="stack" novalidate>
            <h2>إقفال الغرفة <span dir="ltr">${r.code}</span></h2>
            ${r.status === 'playing' ? html`<p class="chip warn">المباراة الجارية بتُلغى بدون نتيجة.</p>` : ''}
            <div class="field"><label for="closeReason">السبب</label>
              <textarea id="closeReason" name="reason" class="input" rows="2" maxlength="200" required autofocus>${r.stuck ? 'غرفة عالقة بدون نشاط' : ''}</textarea></div>
            <div class="actions"><button type="button" class="btn" data-close="">إلغاء</button><button type="submit" class="btn danger">متابعة</button></div>
          </form>`, (f) => { const reason = trimmed(f, 'reason'); return reason.length < 3 ? invalid(f, 'reason', 'اكتب سبباً واضحاً.') : { reason }; }, 'إقفال غرفة');
        if (!v) return;
        if (!(await confirmBox('تأكيد الإقفال', `ستُقفل الغرفة ${r.code} ويخرج منها كل اللاعبين.`, { ok: 'أقفل الغرفة', danger: true }))) return;
        const ok = await busy(b, () => rpc('admin_close_room', { p_room: r.id, p_reason: v.reason }));
        if (ok !== undefined) { toast('تم إقفال الغرفة.'); reload(); }
      }
    };
    reload();
  }

  /* ----- seasons & challenges ----- */
  function seasons() {
    let data = { seasons: [], challenges: [] };
    const draw = (d) => {
      data = { seasons: Array.isArray(d && d.seasons) ? d.seasons : [], challenges: Array.isArray(d && d.challenges) ? d.challenges : [] };
      const current = data.seasons.find((s) => s.active);
      const past = data.seasons.filter((s) => !s.active);
      mount(panel, html`<div class="grid two">
        <section class="card stack" aria-labelledby="hSeasons">
          <h2 id="hSeasons">المواسم</h2>
          ${current ? html`<div class="row between"><div><b>${current.name}</b><br><span class="muted small">بدأ ${date(current.starts_at)}</span></div><span class="chip live">الموسم الحالي</span></div>`
            : html`<p class="muted">ما فيه موسم نشط حالياً.</p>`}
          ${R >= 2 ? html`<form class="stack" data-form="season" novalidate>
              <div class="field"><label for="seasonName">اسم الموسم الجديد</label>
                <input id="seasonName" name="name" class="input" maxlength="40" required placeholder="مثال: موسم الشتاء"></div>
              <button class="btn primary" type="submit">ابدأ موسماً جديداً</button>
            </form>` : ''}
          ${past.length ? html`<h3>المواسم السابقة</h3><div class="list">${past.map((s) => html`<div class="item"><div class="grow"><b>${s.name}</b><br><span class="muted small">${date(s.starts_at)} – ${s.ends_at ? date(s.ends_at) : '—'}</span></div></div>`)}</div>` : ''}
        </section>
        <section class="card stack" aria-labelledby="hCh">
          <h2 id="hCh">التحديات</h2>
          ${data.challenges.length ? html`<div class="scroll-x"><table class="data">
            <thead><tr><th>التحدي</th><th>الفترة</th><th>الهدف</th><th>المكافأة</th><th>الحالة</th></tr></thead>
            <tbody>${data.challenges.map((c, i) => html`<tr>
              <td><b>${c.title}</b><br><span class="muted small" dir="ltr">${c.code} · ${c.metric}</span></td>
              <td>${PERIOD[c.period] || c.period}</td><td>${n(c.target)}</td>
              <td>${n(c.reward_xp)} خبرة${c.reward_cosmetic ? html`<br><span class="muted small">${c.reward_cosmetic}</span>` : ''}</td>
              <td>${R >= 2 ? html`<button class="btn small ${c.active ? 'primary' : ''}" data-act="toggle" data-i="${i}" aria-pressed="${c.active ? 'true' : 'false'}" aria-label="${c.title}: ${c.active ? 'مفعّل' : 'موقوف'}">${c.active ? 'مفعّل' : 'موقوف'}</button>`
                : html`<span class="chip ${c.active ? 'live' : ''}">${c.active ? 'مفعّل' : 'موقوف'}</span>`}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">ما فيه تحديات معرّفة.</p>`}
        </section>
      </div>`);
    };
    const reload = () => load(() => rpc('admin_logs'), draw);
    panel.onsubmit = async (e) => {
      if (!e.target.matches('[data-form=season]')) return;
      e.preventDefault();
      const f = e.target, name = trimmed(f, 'name');
      if (name.length < 2) { invalid(f, 'name', 'اكتب اسم الموسم.'); return; }
      const cur = data.seasons.find((s) => s.active);
      if (!(await confirmBox('بدء موسم جديد', `${cur ? `سينتهي الموسم الحالي «${cur.name}» فوراً ويبدأ ` : 'سيبدأ '}موسم «${name}». ما يمكن التراجع عن هذا.`, { ok: 'ابدأ الموسم', danger: true }))) return;
      const ok = await busy(f.querySelector('[type=submit]'), () => rpc('admin_season_start', { p_name: name }));
      if (ok !== undefined) { toast('بدأ الموسم الجديد.'); reload(); }
    };
    panel.onclick = async (e) => {
      const b = e.target.closest('[data-act=toggle]'); if (!b) return;
      const c = data.challenges[Number(b.dataset.i)]; if (!c) return;
      const next = !c.active;
      if (!next && !(await confirmBox('إيقاف التحدي', `ما راح يظهر «${c.title}» للاعبين لين تفعّله من جديد.`, { ok: 'أوقف', danger: true }))) return;
      const ok = await busy(b, () => rpc('admin_challenge_toggle', { p_id: c.id, p_active: next }));
      if (ok !== undefined) { toast(next ? 'تم تفعيل التحدي.' : 'تم إيقاف التحدي.'); reload(); }
    };
    reload();
  }

  /* ----- logs ----- */
  function logs() {
    const draw = (d) => {
      const errors = (Array.isArray(d && d.errors) ? d.errors : []).slice().sort(byAtDesc);
      const audit = (Array.isArray(d && d.audit) ? d.audit : []).slice().sort(byAtDesc);
      mount(panel, html`<div class="stack">
        <div class="row between"><span class="muted small">آخر ١٠٠ سجل لكل قسم</span><button class="btn small" data-act="refresh">تحديث</button></div>
        <div class="grid two">
          <section class="card stack" aria-labelledby="hErr">
            <h2 id="hErr">أخطاء الخادم <span class="muted small">(${n(errors.length)})</span></h2>
            ${errors.length ? html`<div class="list">${errors.map((x) => html`<div class="item"><div class="grow">
                <div class="row between"><span class="chip warn" dir="ltr">${x.source}</span><span class="muted small" title="${when(x.at)}">${ago(x.at)}</span></div>
                <div dir="ltr" class="small" style="overflow-wrap:anywhere">${x.message}</div>
                ${x.context && Object.keys(x.context).length ? html`<details><summary class="muted small">السياق</summary><code dir="ltr" class="small" style="overflow-wrap:anywhere;white-space:pre-wrap">${json(x.context)}</code></details>` : ''}
              </div></div>`)}</div>` : html`<div class="empty"><div class="art">✨</div><b>ما فيه أخطاء مسجّلة.</b></div>`}
          </section>
          <section class="card stack" aria-labelledby="hAudit">
            <h2 id="hAudit">سجل الإجراءات <span class="muted small">(${n(audit.length)})</span></h2>
            ${audit.length ? html`<div class="list">${audit.map((x) => html`<div class="item"><div class="grow">
                <div class="row between"><b>${AUDIT_ACTION[x.action] || x.action}</b><span class="muted small" title="${when(x.at)}">${ago(x.at)}</span></div>
                <div class="small">بواسطة ${x.actor ? html`<a href="/u/${encodeURIComponent(x.actor)}" data-link>@${x.actor}</a>` : html`<span class="muted">النظام</span>`}${x.target ? html` · الهدف <code dir="ltr">${x.target}</code>` : ''}</div>
                ${x.details && Object.keys(x.details).length ? html`<code dir="ltr" class="muted small" style="overflow-wrap:anywhere">${json(x.details)}</code>` : ''}
              </div></div>`)}</div>` : html`<div class="empty"><div class="art">📜</div><b>السجل فاضي.</b></div>`}
          </section>
        </div>
      </div>`);
    };
    panel.onclick = async (e) => {
      const b = e.target.closest('[data-act=refresh]'); if (!b) return;
      const d = await busy(b, () => rpc('admin_logs')); if (d && alive && tab === 'logs') draw(d);
    };
    load(() => rpc('admin_logs'), draw);
  }

  show(tab);
  return () => { alive = false; clearInterval(timer); timer = null; };
}
