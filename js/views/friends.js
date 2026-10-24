// Friends (/friends): player search, friend requests, and the friends list with live refresh.
import { rpc, game, channel, removeChannel } from '../api.js';
import { state } from '../state.js';
import { html, mount, toast, toastErr, confirmBox, busy, personLink, ago, n } from '../ui.js';
import { inviteDialog } from './profile.js';

export async function render(main) {
  const uid = state.user && state.user.id;
  if (!uid || !state.profile) {
    mount(main, html`<div class="empty"><b>سجّل دخولك لعرض أصدقائك.</b><a class="btn primary" href="/login?next=/friends" data-link>تسجيل الدخول</a></div>`);
    return;
  }
  let friends = [], req = { incoming: [], outgoing: [], blocked: [] }, results = null, lastQ = '', searchSeq = 0, timer = null, loadErr = '';

  mount(main, html`<h1>الأصدقاء</h1>
    <section class="card stack" aria-labelledby="sTitle">
      <h2 id="sTitle">ابحث عن لاعب</h2>
      <div class="field"><label for="fq" class="sr-only">ابحث باسم المستخدم أو الاسم أو رقم اللاعب</label>
        <input class="input" id="fq" type="search" autocomplete="off" spellcheck="false" placeholder="اسم المستخدم أو الاسم أو رقم اللاعب" aria-describedby="fqHint" aria-controls="fRes">
        <span class="hint" id="fqHint">اكتب حرفين على الأقل. رقم اللاعب تلقاه في ملفه الشخصي.</span></div>
      <div id="fRes" aria-live="polite"></div>
    </section>
    <section class="card" aria-labelledby="rqTitle" id="rqBox"></section>
    <section class="card" aria-labelledby="flTitle" id="flBox"></section>`);
  const input = main.querySelector('#fq'), resBox = main.querySelector('#fRes'), rqBox = main.querySelector('#rqBox'), flBox = main.querySelector('#flBox');

  const relationOf = (id) => {
    if (friends.some((f) => f.id === id)) return { kind: 'friend' };
    const inc = req.incoming.find((r) => r.user && r.user.id === id); if (inc) return { kind: 'incoming', id: inc.id };
    const out = req.outgoing.find((r) => r.user && r.user.id === id); if (out) return { kind: 'outgoing', id: out.id };
    return { kind: 'none' };
  };
  const relBtn = (u) => {
    const r = relationOf(u.id);
    if (r.kind === 'friend') return html`<span class="chip gold">🤝 صديقك</span>`;
    if (r.kind === 'incoming') return html`<button class="btn primary small" data-act="accept" data-id="${r.id}">قبول طلبه</button>`;
    if (r.kind === 'outgoing') return html`<button class="btn small" data-act="cancel" data-id="${r.id}">إلغاء الطلب</button>`;
    return html`<button class="btn primary small" data-act="add" data-uid="${u.id}" data-name="${u.display_name || u.username}">➕ إضافة</button>`;
  };

  const drawResults = () => {
    if (results === null) { mount(resBox, ''); return; }
    if (results === 'loading') { mount(resBox, html`<p class="muted small" role="status">نبحث…</p>`); return; }
    if (!results.length) { mount(resBox, html`<div class="empty" style="padding:14px"><span>ما لقينا أحد بـ«${lastQ}». تأكد من الاسم أو رقم اللاعب.</span></div>`); return; }
    mount(resBox, html`<div class="list">${results.map((u) => html`<div class="item"><div class="grow">${personLink(u, { sub: '@' + u.username + ' · #' + u.player_no })}</div>${relBtn(u)}</div>`)}</div>`);
  };

  const drawRequests = () => {
    const inc = req.incoming || [], out = req.outgoing || [];
    mount(rqBox, html`<div class="section-title"><h2 id="rqTitle">طلبات الصداقة</h2>${inc.length ? html`<span class="pill">${n(inc.length)}</span>` : ''}</div>
      <h3 style="font-size:16px;margin-bottom:4px">طلبات وصلتك</h3>
      ${inc.length ? html`<div class="list">${inc.map((r) => html`<div class="item"><div class="grow">${personLink(r.user, { sub: 'أرسل الطلب ' + ago(r.at) })}</div>
          <div class="row" style="gap:6px"><button class="btn primary small" data-act="accept" data-id="${r.id}">قبول</button><button class="btn small" data-act="decline" data-id="${r.id}">رفض</button></div></div>`)}</div>`
        : html`<p class="muted small" style="padding:6px 0 10px">ما فيه طلبات جديدة.</p>`}
      <h3 style="font-size:16px;margin:10px 0 4px">طلبات أرسلتها</h3>
      ${out.length ? html`<div class="list">${out.map((r) => html`<div class="item"><div class="grow">${personLink(r.user, { sub: 'أرسلته ' + ago(r.at) + ' · بانتظار رده' })}</div>
          <button class="btn small" data-act="cancel" data-id="${r.id}">إلغاء</button></div>`)}</div>`
        : html`<p class="muted small" style="padding:6px 0">ما عندك طلبات معلّقة.</p>`}`);
  };

  const drawFriends = () => {
    if (loadErr) {
      mount(flBox, html`<div class="empty"><div class="art">⚠️</div><b>تعذّر تحميل الأصدقاء.</b><span>${loadErr}</span><button class="btn" data-act="reload">حاول مرة ثانية</button></div>`);
      return;
    }
    const list = [...friends].sort((a, b) => (b.online === true) - (a.online === true) || String(a.display_name || a.username).localeCompare(String(b.display_name || b.username), 'ar'));
    const on = list.filter((f) => f.online === true).length;
    mount(flBox, html`<div class="section-title"><h2 id="flTitle">أصدقاؤك</h2><span class="small muted">${n(list.length)} صديق${on ? html` · <span class="ok">${n(on)} متصل</span>` : ''}</span></div>
      ${list.length ? html`<div class="list">${list.map((f) => html`<div class="item">
          <div class="grow">${personLink(f, { sub: f.online === true ? 'متصل الآن' : '@' + f.username + ' · المستوى ' + n(f.level) })}</div>
          <div class="row" style="gap:6px;justify-content:flex-end">
            <a class="btn small ghost" href="/u/${encodeURIComponent(f.username)}" data-link aria-label="ملف ${f.display_name || f.username}">الملف</a>
            <button class="btn small" data-act="invite" data-uid="${f.id}" aria-label="دعوة ${f.display_name || f.username} لطاولة">🃏 دعوة</button>
            <button class="btn small ghost" data-act="remove" data-uid="${f.id}" aria-label="إزالة ${f.display_name || f.username}">إزالة</button>
          </div></div>`)}</div>`
        : html`<div class="empty"><div class="art">🤝</div><b>ما عندك أصدقاء للحين.</b><span>ابحث عن ربعك باسم المستخدم أو رقم اللاعب وأرسل لهم طلب، أو العب مباراة وتعرّف على ناس جدد.</span>
            <div class="row" style="justify-content:center"><button class="btn primary" data-act="focusSearch">ابحث عن لاعب</button><a class="btn" href="/play" data-link>العب الآن</a></div></div>`}`);
  };

  const reload = async () => {
    try {
      const [f, r] = await Promise.all([rpc('list_friends'), rpc('list_requests')]);
      friends = f || []; req = { incoming: [], outgoing: [], blocked: [], ...(r || {}) }; loadErr = '';
    } catch (e) { loadErr = e.message; }
    drawRequests(); drawFriends(); drawResults();
  };

  const search = async (q) => {
    const my = ++searchSeq;
    lastQ = q; results = 'loading'; drawResults();
    try {
      const r = await rpc('search_players', { p_q: q });
      if (my !== searchSeq) return;
      results = r || [];
    } catch (e) {
      if (my !== searchSeq) return;
      results = null; toastErr(e);
    }
    drawResults();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim().replace(/^[@#]/, '');
    if (q.length < 2) { searchSeq++; results = null; drawResults(); return; }
    timer = setTimeout(() => search(q), 300);
  });

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !main.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'reload') { await busy(b, reload); return; }
    if (act === 'focusSearch') { input.focus(); input.scrollIntoView({ block: 'center' }); return; }
    if (act === 'add') {
      const r = await busy(b, () => rpc('friend_send', { p_target: b.dataset.uid }));
      if (r === 'accepted') toast(`صرتم أصدقاء أنت و${b.dataset.name} 🤝`); else if (r === 'sent') toast('أرسلنا طلب الصداقة ✓');
      if (r) await reload();
    } else if (act === 'accept' || act === 'decline') {
      const accept = act === 'accept';
      const ok = await busy(b, async () => { await rpc('friend_respond', { p_id: Number(b.dataset.id), p_accept: accept }); return true; });
      if (ok) { toast(accept ? 'صرتم أصدقاء 🤝' : 'رفضت الطلب.'); await reload(); }
    } else if (act === 'cancel') {
      const ok = await busy(b, async () => { await rpc('friend_cancel', { p_id: Number(b.dataset.id) }); return true; });
      if (ok) { toast('ألغينا الطلب.'); await reload(); }
    } else if (act === 'invite') {
      const f = friends.find((x) => x.id === b.dataset.uid);
      if (f) await busy(b, () => inviteDialog(f));
    } else if (act === 'remove') {
      const f = friends.find((x) => x.id === b.dataset.uid);
      if (!f) return;
      const name = f.display_name || f.username;
      if (!(await confirmBox('إزالة من الأصدقاء', `متأكد تبي تشيل ${name} من أصدقائك؟ تقدر ترسل له طلب من جديد بعدين.`, { ok: 'إزالة', danger: true }))) return;
      const ok = await busy(b, async () => { await game('friend_remove', { target: f.id }); return true; });
      if (ok) { toast(`أزلنا ${name} من أصدقائك.`); await reload(); }
    }
  };
  main.addEventListener('click', onClick);

  await reload();

  const ch = channel('fr:' + uid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + uid }, (p) => {
      const k = p && p.new && p.new.kind;
      if (k === 'friend_request' || k === 'friend_accepted') reload();
    })
    .subscribe();

  return () => {
    clearTimeout(timer); searchSeq++;
    main.removeEventListener('click', onClick);
    removeChannel(ch);
  };
}
