// Public player profile (/u/:username). Works for guests; social actions only for signed-in players.
import { rpc, select, game } from '../api.js';
import { state } from '../state.js';
import { html, mount, toast, toastErr, dialog, confirmBox, busy, avatar, rankBadge, levelProgress, n, ago, date } from '../ui.js';

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const ROOM_KIND = { private: 'غرفة خاصة', friendly: 'ودية', ranked: 'مصنّفة', public: 'عامة' };
const REASONS = [
  ['abuse', 'إساءة أو سبّ أو تهديد'],
  ['cheating', 'غش أو تواطؤ في اللعب'],
  ['spam', 'إزعاج أو رسائل متكررة'],
  ['inappropriate_name', 'اسم أو صورة أو نبذة غير لائقة'],
  ['leaving', 'يترك المباريات باستمرار'],
  ['other', 'سبب آخر'],
];

/** Copies text to the clipboard with a fallback for older browsers. */
export async function copyText(text, okMsg = 'تم النسخ ✓') {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove();
      if (!ok) throw new Error('copy');
    }
    toast(okMsg);
  } catch {
    toast('ما قدرنا ننسخ تلقائياً. انسخه يدوياً: ' + text, { error: true, ms: 8000 });
  }
}

/** Invite a player to one of the viewer's open rooms (shared with the friends view). */
export async function inviteDialog(target) {
  const uid = state.user && state.user.id;
  if (!uid) { toast('سجّل دخولك أولاً.', { error: true }); return; }
  let rooms;
  try {
    rooms = await select('rooms', (q) => q.select('id,code,kind,status').contains('members', [uid]).in('status', ['waiting']).limit(10));
  } catch (e) { toastErr(e); return; }
  const name = target.display_name || target.username;
  if (!rooms || !rooms.length) {
    dialog(html`<h2>دعوة ${name}</h2>
      <p>ما عندك طاولة مفتوحة الحين. افتح غرفة من صفحة «العب»، وبعدها ادعُ ${name} منها أو من هنا.</p>
      <div class="actions"><button class="btn" data-close>إلغاء</button><a class="btn primary" href="/play" data-link data-close>افتح غرفة</a></div>`, { label: 'دعوة إلى طاولة' });
    return;
  }
  const d = dialog(html`<h2>دعوة ${name} لطاولة</h2>
    <p class="muted small">اختر الغرفة اللي تبي تدعوه لها. بيوصله تنبيه فيه زر للدخول.</p>
    <div class="list" style="margin-top:8px">${rooms.map((r) => html`
      <div class="item"><div class="grow"><b class="num" dir="ltr">${r.code}</b><div class="small muted">${ROOM_KIND[r.kind] || r.kind} · بانتظار اللاعبين</div></div>
      <button class="btn primary small" data-room="${r.id}">ادعُ</button></div>`)}</div>
    <div class="actions"><button class="btn" data-close>إغلاق</button></div>`, { label: 'دعوة إلى طاولة' });
  d.el.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-room]');
    if (!b) return;
    const ok = await busy(b, async () => { await rpc('invite_to_room', { p_target: target.id, p_room: b.dataset.room }); return true; });
    if (ok) { toast(`أرسلنا الدعوة إلى ${name} ✉️`); d.close('sent'); }
  });
}

/** Report a player (reason + optional details). */
export function reportDialog(target) {
  const name = target.display_name || target.username;
  const d = dialog(html`<h2>الإبلاغ عن ${name}</h2>
    <form class="stack" novalidate>
      <fieldset class="stack" style="border:0;padding:0;margin:0;gap:4px">
        <legend class="lbl" style="margin-bottom:6px">وش السبب؟</legend>
        ${REASONS.map(([v, t]) => html`<label class="row" style="min-height:44px;gap:10px;cursor:pointer"><input type="radio" name="reason" value="${v}" style="width:20px;height:20px">${t}</label>`)}
      </fieldset>
      <div class="field"><label for="repDetails">تفاصيل (اختياري)</label>
        <textarea id="repDetails" class="input" name="details" rows="3" maxlength="500" placeholder="وش صار بالضبط؟ متى وفي أي مباراة؟"></textarea>
        <span class="hint">البلاغ سري، وما يعرف اللاعب مين بلّغ عنه.</span></div>
      <p class="error" role="alert" data-err></p>
      <div class="actions" style="margin-top:0"><button type="button" class="btn" data-close>إلغاء</button><button type="submit" class="btn danger">أرسل البلاغ</button></div>
    </form>`, { label: 'إبلاغ' });
  const form = d.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = form.reason.value;
    const err = d.el.querySelector('[data-err]');
    if (!reason) { err.textContent = 'اختر سبب البلاغ.'; return; }
    err.textContent = '';
    const ok = await busy(form.querySelector('[type=submit]'), async () => {
      await rpc('report_submit', { p_kind: 'user', p_target: target.id, p_ref: null, p_reason: reason, p_details: form.details.value.trim() });
      return true;
    });
    if (ok) { toast('وصل بلاغك، شكراً لك. فريق الإشراف بيراجعه.'); d.close('sent'); }
  });
}

function statTile(value, label, title = '') {
  return title ? html`<div class="stat" title="${title}"><b>${value}</b><span>${label}</span></div>` : html`<div class="stat"><b>${value}</b><span>${label}</span></div>`;
}

function historyRow(m, own) {
  const won = m.result === 'win';
  const delta = Number(m.rating_delta) || 0;
  const body = html`
    <span class="chip ${won ? 'live' : ''}" style="${won ? '' : 'border-color:var(--them);color:var(--them)'}">${won ? 'فوز' : 'خسارة'}</span>
    <div class="grow">
      <div><span class="muted small">لنا</span> <b class="num">${n(m.us)}</b> <span class="muted">·</span> <span class="muted small">لهم</span> <b class="num">${n(m.them)}</b>
        ${m.abandoned ? html` <span class="chip warn">انسحاب</span>` : ''}</div>
      <div class="small muted">${m.ranked ? 'مصنّفة' : 'ودية'} · ${ago(m.ended_at)}</div>
    </div>
    <div class="stack" style="gap:0;align-items:flex-end">
      ${m.ranked ? html`<b class="num" dir="ltr" style="color:${delta >= 0 ? 'var(--us)' : 'var(--them)'}">${delta > 0 ? '+' : ''}${delta}</b>` : ''}
      <span class="small muted">+${n(m.xp)} خبرة</span>
    </div>`;
  return own
    ? html`<a class="item" href="/match/${encodeURIComponent(m.match_id)}" data-link style="color:inherit;text-decoration:none" aria-label="تفاصيل المباراة">${body}<span aria-hidden="true" class="muted">‹</span></a>`
    : html`<div class="item">${body}</div>`;
}

function actionsTpl(p) {
  const shareBtn = html`<button class="btn ghost" data-act="share">🔗 مشاركة الملف</button>`;
  const rel = p.relation || {};
  if (rel.self) {
    return html`<div class="row"><a class="btn primary" href="/settings" data-link>✏️ تعديل الملف</a>${shareBtn}</div>
      <p class="hint">هذا ملفك كما يشوفه الآخرون.</p>`;
  }
  if (!state.profile) {
    return html`<div class="row"><a class="btn primary" href="/login?next=${encodeURIComponent('/u/' + p.username)}" data-link>سجّل دخولك لإضافته</a>${shareBtn}</div>`;
  }
  if (rel.blocked_by_me) {
    return html`<div class="empty" style="padding:14px"><b>حظرت هذا اللاعب.</b><span>ما يقدر يرسل لك طلبات أو دعوات، وما تشوف رسائله.</span>
      <button class="btn" data-act="unblock">إلغاء الحظر</button></div>
      <div class="row"><button class="btn ghost small" data-act="report">🚩 إبلاغ</button></div>`;
  }
  if (rel.blocks_me) {
    return html`<div class="empty" style="padding:14px"><b>ما يمكن التواصل مع هذا اللاعب.</b><span>ما تقدر ترسل له طلب صداقة أو دعوة.</span></div>
      <div class="row"><button class="btn ghost small" data-act="block">⛔ حظر</button><button class="btn ghost small" data-act="report">🚩 إبلاغ</button></div>`;
  }
  let friend;
  if (rel.friend) friend = html`<span class="chip gold">🤝 صديقك</span><button class="btn small" data-act="unfriend">إزالة من الأصدقاء</button>`;
  else if (rel.incoming_request) friend = html`<button class="btn primary" data-act="accept">✅ قبول طلب الصداقة</button><button class="btn" data-act="decline">رفض</button>`;
  else if (rel.outgoing_request) friend = html`<span class="chip">⏳ أرسلت له طلب</span><button class="btn small" data-act="cancel">إلغاء الطلب</button>`;
  else if (rel.can_request) friend = html`<button class="btn primary" data-act="add">➕ إضافة صديق</button>`;
  else friend = html`<button class="btn" disabled aria-describedby="reqHint">➕ إضافة صديق</button><span class="hint" id="reqHint">هذا اللاعب قافل طلبات الصداقة.</span>`;
  const invite = rel.can_invite
    ? html`<button class="btn" data-act="invite">🃏 دعوة لطاولة</button>`
    : html`<button class="btn" disabled aria-describedby="invHint">🃏 دعوة لطاولة</button><span class="hint" id="invHint">${rel.friend ? 'هذا اللاعب ما يستقبل دعوات.' : 'يستقبل الدعوات من أصدقائه فقط.'}</span>`;
  return html`<div class="row">${friend}</div>
    <div class="row">${invite}${shareBtn}</div>
    <div class="row">
      <button class="btn ghost small" data-act="${rel.muted ? 'unmute' : 'mute'}" aria-pressed="${rel.muted ? 'true' : 'false'}" title="الكتم يخفي رسائله في الدردشة عندك فقط">${rel.muted ? '🔊 إلغاء الكتم' : '🔇 كتم'}</button>
      <button class="btn ghost small" data-act="block">⛔ حظر</button>
      <button class="btn ghost small" data-act="report">🚩 إبلاغ</button>
    </div>`;
}

function pageTpl(p, history, historyErr) {
  const rel = p.relation || {};
  const lp = levelProgress(p.xp || 0, p.level || 1);
  const games = p.games || 0;
  const s = p.season;
  let onlineChip = '';
  if (p.online === true) onlineChip = html`<span class="chip live">● متصل الآن</span>`;
  else if (p.online === false) onlineChip = html`<span class="chip">غير متصل</span>`;

  let historyBody;
  if (!p.history_visible) historyBody = html`<div class="empty"><div class="art">🔒</div><b>سجل المباريات خاص</b><span>صاحب الملف مخفي سجله.</span></div>`;
  else if (historyErr) historyBody = html`<div class="empty"><b>تعذّر تحميل السجل.</b><span>${historyErr}</span></div>`;
  else if (history === null) historyBody = html`<div class="empty"><div class="art">🔒</div><b>سجل المباريات خاص</b></div>`;
  else if (!history.length) historyBody = html`<div class="empty"><div class="art">🎴</div><b>ما فيه مباريات للحين.</b>${rel.self ? html`<a class="btn primary" href="/play" data-link>العب أول مباراة</a>` : ''}</div>`;
  else historyBody = html`<div class="list">${history.map((m) => historyRow(m, !!rel.self))}</div>
    ${rel.self ? '' : html`<p class="hint" style="margin-top:8px">تفاصيل المباريات متاحة لأصحابها فقط.</p>`}`;

  const ach = p.achievements || [];
  return html`
  <section class="card gold stack" style="gap:14px" aria-labelledby="pfName">
    <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:nowrap">
      ${avatar(p, 96, { online: p.online === true })}
      <div class="stack" style="flex:1;min-width:0;gap:4px">
        <h1 id="pfName" style="overflow-wrap:anywhere">${p.display_name || p.username}</h1>
        <div class="row small muted" style="gap:6px 10px">
          <span dir="ltr">@${p.username}</span>
          <span>رقم اللاعب <b class="num" style="color:var(--text)">${p.player_no}</b></span>
          <button class="btn ghost small" data-act="copyId" aria-label="نسخ رقم اللاعب">📋 نسخ</button>
        </div>
        <div class="row" style="gap:6px">${onlineChip}<span class="small muted">انضم في ${date(p.joined)}</span></div>
      </div>
    </div>
    ${p.bio ? html`<p style="white-space:pre-line;overflow-wrap:anywhere">${p.bio}</p>` : rel.self ? html`<p class="muted small">ما كتبت نبذة عن نفسك للحين. أضفها من «تعديل الملف».</p>` : ''}
    <div class="stack" style="gap:6px">
      <div class="row between"><b>المستوى <span class="num">${n(p.level)}</span></b><span class="small muted">${n(p.xp)} خبرة · باقي ${n(Math.max(0, lp.next))} للمستوى ${n((p.level || 1) + 1)}</span></div>
      <div class="bar" role="progressbar" aria-label="التقدم للمستوى التالي" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lp.pct)}"><i style="width:${lp.pct.toFixed(1)}%"></i></div>
    </div>
    <div class="row" style="gap:8px">
      ${rankBadge(p.rating)}
      ${s ? html`<span class="chip gold">الموسم «${s.name}»: ${s.games ? html`<b class="num">${n(s.rating)}</b> · ${n(s.wins)} فوز من ${n(s.games)}` : 'ما لعب مصنّف هذا الموسم'}</span>` : ''}
    </div>
    <div class="stack" style="gap:8px" id="pfActions">${actionsTpl(p)}</div>
  </section>

  <section class="card" aria-labelledby="stTitle">
    <div class="section-title"><h2 id="stTitle">الإحصائيات</h2></div>
    <div class="stats">
      ${statTile(n(games), 'مباراة')}
      ${statTile(n(p.wins), 'فوز')}
      ${statTile(n(p.losses), 'خسارة')}
      ${statTile(n(pct(p.wins || 0, games)) + '٪', 'نسبة الفوز')}
      ${statTile(n(p.best_streak), 'أفضل سلسلة فوز', 'السلسلة الحالية: ' + n(p.cur_streak))}
      ${statTile(n(p.kaboots), 'كبّوت')}
      ${statTile(n(p.ranked_games), 'مباراة مصنّفة')}
      ${statTile(n(pct(p.sun_won || 0, p.sun_rounds || 0)) + '٪', `صن: كسب ${n(p.sun_won)} من ${n(p.sun_rounds)} اشتراها`)}
      ${statTile(n(pct(p.hokm_won || 0, p.hokm_rounds || 0)) + '٪', `حكم: كسب ${n(p.hokm_won)} من ${n(p.hokm_rounds)} اشتراها`)}
    </div>
  </section>

  <section class="card" aria-labelledby="achTitle">
    <div class="section-title"><h2 id="achTitle">الأوسمة</h2><span class="chip">${n(ach.length)}</span></div>
    ${ach.length ? html`<div class="stats">${ach.map((a) => html`
      <div class="stat" title="${a.description}"><b aria-hidden="true" style="font-size:30px">${a.icon}</b><span style="color:var(--text);font-weight:600;display:block">${a.name}</span><span class="small">${a.description}</span><span class="small" style="display:block">${date(a.at)}</span></div>`)}</div>`
      : html`<div class="empty"><div class="art">🏅</div><b>ما فيه أوسمة للحين.</b><span>الأوسمة تنفتح بالفوز والكبابيت والسلاسل وغيرها.</span></div>`}
  </section>

  <section class="card" aria-labelledby="hiTitle">
    <div class="section-title"><h2 id="hiTitle">آخر المباريات</h2></div>
    ${historyBody}
  </section>`;
}

export async function render(main, params) {
  const username = params.username || (state.profile && state.profile.username) || '';
  let p = null;

  const load = async () => {
    let prof;
    try { prof = await rpc('get_profile', { p_username: username }); } catch (e) {
      mount(main, html`<div class="empty"><div class="art">⚠️</div><b>تعذّر تحميل الملف.</b><span>${e.message}</span><button class="btn" data-act="retry">حاول مرة ثانية</button></div>`);
      return;
    }
    if (!prof) {
      mount(main, html`<div class="empty"><div class="art">🔍</div><b>ما لقينا لاعب بهذا الاسم.</b><span>يمكن غيّر اسم المستخدم أو حذف حسابه.</span>
        <div class="row" style="justify-content:center">${state.profile ? html`<a class="btn primary" href="/friends" data-link>ابحث عن لاعب</a>` : ''}<a class="btn" href="/" data-link>الرئيسية</a></div></div>`);
      p = null;
      return;
    }
    p = prof;
    let history = null, historyErr = '';
    if (p.history_visible) {
      try { history = await rpc('player_history', { p_user: p.id, p_limit: 20 }); } catch (e) { historyErr = e.message; }
    }
    mount(main, pageTpl(p, history, historyErr));
  };
  const refreshActions = async () => {
    // Re-fetch only to update relation-dependent controls; keeps the rest of the page in place.
    try {
      const prof = await rpc('get_profile', { p_username: p.username });
      if (!prof) return load();
      p = prof;
      const box = main.querySelector('#pfActions');
      if (box) mount(box, actionsTpl(p)); else await load();
    } catch (e) { toastErr(e); }
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !main.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'retry') { await load(); return; }
    if (!p) return;
    const name = p.display_name || p.username;
    const uid = state.user && state.user.id;
    const rel = p.relation || {};
    switch (act) {
      case 'copyId': copyText(String(p.player_no), 'نسخنا رقم اللاعب ✓'); break;
      case 'share': copyText(location.origin + '/u/' + encodeURIComponent(p.username), 'نسخنا رابط الملف ✓'); break;
      case 'add': {
        const r = await busy(b, () => rpc('friend_send', { p_target: p.id }));
        if (r === 'accepted') toast(`صرتم أصدقاء أنت و${name} 🤝`); else if (r === 'sent') toast('أرسلنا طلب الصداقة ✓');
        if (r) await refreshActions();
        break;
      }
      case 'cancel': {
        const ok = await busy(b, async () => { await rpc('friend_cancel', { p_id: rel.outgoing_request }); return true; });
        if (ok) { toast('ألغينا الطلب.'); await refreshActions(); }
        break;
      }
      case 'accept':
      case 'decline': {
        const accept = act === 'accept';
        const ok = await busy(b, async () => { await rpc('friend_respond', { p_id: rel.incoming_request, p_accept: accept }); return true; });
        if (ok) { toast(accept ? `صرتم أصدقاء أنت و${name} 🤝` : 'رفضت الطلب.'); await refreshActions(); }
        break;
      }
      case 'unfriend': {
        if (!(await confirmBox('إزالة من الأصدقاء', `متأكد تبي تشيل ${name} من أصدقائك؟ تقدر ترسل له طلب من جديد بعدين.`, { ok: 'إزالة', danger: true }))) return;
        const ok = await busy(b, async () => { await game('friend_remove', { target: p.id }); return true; });
        if (ok) { toast('أزلناه من أصدقائك.'); await refreshActions(); }
        break;
      }
      case 'invite': await busy(b, () => inviteDialog(p)); break;
      case 'block': {
        if (!(await confirmBox(`حظر ${name}؟`, 'بيتشال من أصدقائك وتنلغي الطلبات بينكم، وما يقدر يرسل لك طلبات أو دعوات، وما تشوف رسائله في الدردشة.', { ok: 'حظر', danger: true }))) return;
        const ok = await busy(b, async () => { await game('block', { target: p.id }); return true; });
        if (ok) { toast(`حظرت ${name}.`); await refreshActions(); }
        break;
      }
      case 'unblock': {
        if (!(await confirmBox('إلغاء الحظر', `بيقدر ${name} يرسل لك طلبات ودعوات من جديد حسب إعدادات خصوصيتك.`, { ok: 'إلغاء الحظر' }))) return;
        const ok = await busy(b, async () => { await game('unblock', { target: p.id }); return true; });
        if (ok) { toast('ألغينا الحظر.'); await refreshActions(); }
        break;
      }
      case 'mute':
      case 'unmute': {
        if (!uid) return;
        const ok = await busy(b, async () => {
          if (act === 'mute') await select('user_mutes', (q) => q.insert({ muter: uid, muted: p.id }));
          else await select('user_mutes', (q) => q.delete().eq('muter', uid).eq('muted', p.id));
          return true;
        });
        if (ok) { toast(act === 'mute' ? `كتمت ${name}. ما بتشوف رسائله في الدردشة.` : 'ألغينا الكتم.'); await refreshActions(); }
        break;
      }
      case 'report': reportDialog(p); break;
      default: break;
    }
  };
  main.addEventListener('click', onClick);
  await load();
  return () => main.removeEventListener('click', onClick);
}
