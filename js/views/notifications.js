// Notifications (/notifications): newest first; opening the page marks everything as read.
import { rpc } from '../api.js';
import { state, setState } from '../state.js';
import { navigate } from '../router.js';
import { html, mount, toast, busy, avatar, ago, n } from '../ui.js';

const ROOM_KIND = { private: 'خاصة', friendly: 'ودية', ranked: 'مصنّفة', public: 'عامة' };
const nameOf = (u) => (u ? u.display_name || u.username : 'لاعب');
const fromLink = (u) => (u && u.username
  ? html`<a href="/u/${encodeURIComponent(u.username)}" data-link><b>${nameOf(u)}</b></a>`
  : html`<b>${nameOf(u)}</b>`);

function itemTpl(x) {
  const d = x.data || {};
  let icon = '🔔', body, actions = '';
  switch (x.kind) {
    case 'friend_request':
      icon = d.from ? avatar(d.from, 40) : '👋';
      body = html`${fromLink(d.from)} أرسل لك طلب صداقة.`;
      actions = d.request_id ? html`<div class="row" style="gap:6px" data-req-box>
        <button class="btn primary small" data-act="accept" data-id="${d.request_id}">قبول</button>
        <button class="btn small" data-act="decline" data-id="${d.request_id}">رفض</button></div>` : '';
      break;
    case 'friend_accepted':
      icon = d.from ? avatar(d.from, 40) : '🤝';
      body = html`${fromLink(d.from)} قبل طلب صداقتك. صرتم أصدقاء 🤝`;
      break;
    case 'room_invite':
      icon = '🃏';
      body = html`${fromLink(d.from)} يدعوك لطاولة${d.kind && ROOM_KIND[d.kind] ? ' ' + ROOM_KIND[d.kind] : ''}${d.code ? html` (<span dir="ltr" class="num">${d.code}</span>)` : ''}.`;
      actions = d.code ? html`<button class="btn primary small" data-act="room" data-code="${d.code}">ادخل</button>` : '';
      break;
    case 'match_found':
      icon = '⚔️';
      body = html`لقينا لك مباراة${d.mode === 'ranked' ? ' مصنّفة' : d.mode === 'friendly' ? ' ودية' : ''}!`;
      actions = d.code ? html`<button class="btn primary small" data-act="room" data-code="${d.code}">ادخل الغرفة</button>` : '';
      break;
    case 'match_result': {
      const delta = Number(d.rating_delta) || 0;
      icon = d.abandoned ? '🏳️' : d.won ? '🏆' : '😔';
      body = html`${d.abandoned ? 'انسحبت من مباراة' : d.won ? 'فزت بمباراة' : 'خسرت مباراة'}${d.ranked ? ' مصنّفة' : ''}:
        لكم <b class="num">${n(d.us)}</b> مقابل <b class="num">${n(d.them)}</b>.
        ${d.ranked ? html`التصنيف <b class="num" dir="ltr" style="color:${delta >= 0 ? 'var(--us)' : 'var(--them)'}">${delta > 0 ? '+' : ''}${delta}</b> · ` : ''}+${n(d.xp)} خبرة`;
      actions = d.match_id ? html`<a class="btn small" href="/match/${encodeURIComponent(d.match_id)}" data-link>التفاصيل</a>` : '';
      break;
    }
    case 'achievement':
      icon = d.icon || '🏅';
      body = html`وسام جديد: <b>${d.name || ''}</b>${d.xp ? html` · +${n(d.xp)} خبرة` : ''}`;
      break;
    case 'challenge':
      icon = '✅';
      body = html`أنجزت التحدي: <b>${d.title || ''}</b>${d.xp ? html` · +${n(d.xp)} خبرة` : ''}`;
      break;
    default:
      body = html`تنبيه جديد.`;
  }
  const iconEl = typeof icon === 'string' ? html`<span aria-hidden="true" style="font-size:28px;width:40px;text-align:center;flex:none">${icon}</span>` : icon;
  return html`<div class="item" style="${x.read ? '' : 'background:rgba(226,189,98,.07);border-radius:12px;padding-inline:8px'}">
    ${iconEl}
    <div class="grow"><div style="overflow-wrap:anywhere">${!x.read ? html`<span class="sr-only">جديد: </span>` : ''}${body}</div>
      <div class="small muted">${ago(x.at)}${!x.read ? html` · <span class="pill">جديد</span>` : ''}</div></div>
    ${actions}
  </div>`;
}

export async function render(main) {
  if (!state.user) {
    mount(main, html`<div class="empty"><b>سجّل دخولك لعرض التنبيهات.</b><a class="btn primary" href="/login?next=/notifications" data-link>تسجيل الدخول</a></div>`);
    return;
  }
  const load = async () => {
    let list;
    try { list = (await rpc('my_notifications', { p_limit: 50 })) || []; } catch (e) {
      mount(main, html`<h1>التنبيهات</h1><div class="empty"><div class="art">⚠️</div><b>تعذّر تحميل التنبيهات.</b><span>${e.message}</span><button class="btn" data-act="reload">حاول مرة ثانية</button></div>`);
      return;
    }
    list.sort((a, b) => b.id - a.id);
    mount(main, html`<div class="section-title" style="margin:0"><h1>التنبيهات</h1><button class="btn small ghost" data-act="reload">↻ تحديث</button></div>
      <section class="card" aria-label="قائمة التنبيهات">
        ${list.length ? html`<div class="list">${list.map(itemTpl)}</div>`
          : html`<div class="empty"><div class="art">🔕</div><b>ما عندك تنبيهات.</b><span>هنا بتوصلك طلبات الصداقة والدعوات ونتائج مبارياتك.</span></div>`}
      </section>`);
    if (list.some((x) => !x.read)) {
      try { await rpc('notif_read', { p_ids: null }); setState({ unread: 0 }); } catch { /* stays unread; not worth an error */ }
    } else if (state.unread) setState({ unread: 0 });
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !main.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'reload') { await busy(b, load); return; }
    if (act === 'room') { navigate('/room/' + encodeURIComponent(b.dataset.code)); return; }
    if (act === 'accept' || act === 'decline') {
      const accept = act === 'accept';
      const box = b.closest('[data-req-box]');
      let gone = false;
      const ok = await busy(b, async () => {
        try { await rpc('friend_respond', { p_id: Number(b.dataset.id), p_accept: accept }); return true; } catch (x) {
          if (x.code === 'not_found' || String(x.code || '').includes('not_found')) { gone = true; return false; }
          throw x;
        }
      });
      if (ok) { toast(accept ? 'صرتم أصدقاء 🤝' : 'رفضت الطلب.'); if (box) mount(box, html`<span class="small muted">${accept ? '✓ قبلت الطلب' : 'رفضت الطلب'}</span>`); }
      else if (gone && box) mount(box, html`<span class="small muted">الطلب ما عاد متاح</span>`);
    }
  };
  main.addEventListener('click', onClick);
  await load();
  return () => main.removeEventListener('click', onClick);
}
