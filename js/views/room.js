// A room: waiting area (seats, ready, owner controls, invites, chat) and the live table once the match starts.
// Live updates: Supabase Realtime (rooms row, my hand, chat) + presence for connection status, with an 8s resync as a safety net.
import { game, rpc, select, channel, removeChannel } from '../api.js';
import { html, raw, mount, avatar, rankBadge, busy, toast, toastErr, dialog, confirmBox, esc, uid, $ } from '../ui.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { createTable } from '../table.js';
import { ruleRows } from './rules.js';
import { roomSettingsDialog } from './roomsettings.js';
import { reportDialog, copyText } from './profile.js';

const QUICK = ['هلا والله', 'يعطيك العافية', 'ركّز يا خوي', 'لعبة حلوة', 'وش ذا؟!', 'الله يحييك', 'بالتوفيق', 'معليش', '😂', '👏', '🔥', '😅', '🤝', '☕'];
const KIND = { private: 'غرفة خاصة', public: 'غرفة عامة', ranked: 'مباراة تنافسية', friendly: 'مباراة ودّية' };

export async function render(main, params) {
  const myId = state.user.id;
  let room = null, hand = [], profiles = {}, msgs = [], muted = new Set(), onlineIds = new Set(), presenceReady = false;
  let table = null, ch = null, pres = null, resync = null, beat = null, gone = false, roomEl = null;

  /* ---------- load ---------- */
  let id;
  try { id = (await game('room_join', { code: params.code })).id; }
  catch (e) {
    mount(main, html`<div class="empty" style="margin-top:20vh"><div class="art">🚪</div><b>${e.message}</b><a class="btn primary" href="/play" data-link>رجوع</a></div>`);
    return;
  }
  const loadRoom = async () => select('rooms', (q) => q.select('*').eq('id', id).single());
  const loadHand = async () => { const r = await select('room_hands', (q) => q.select('seat,cards,user_id').eq('room_id', id)).catch(() => []); const h = r.find((x) => x.user_id === myId); hand = h ? h.cards : []; };
  const loadProfiles = async () => {
    const ids = (room.seats || []).filter(Boolean).map((s) => s.uid).filter((u) => !profiles[u]);
    if (!ids.length) return;
    const rows = await select('profiles', (q) => q.select('id,username,display_name,avatar_url,rating,level,equip_frame').in('id', ids)).catch(() => []);
    for (const p of rows) profiles[p.id] = { ...p, frame: p.equip_frame };
  };
  const loadChat = async () => {
    const rows = await select('chat_messages', (q) => q.select('id,user_id,body,created_at').eq('room_id', id).order('id', { ascending: false }).limit(50)).catch(() => []);
    msgs = rows.reverse();
  };
  const loadMutes = async () => { const r = await select('user_mutes', (q) => q.select('muted').eq('muter', myId)).catch(() => []); muted = new Set(r.map((x) => x.muted)); };
  room = await loadRoom();
  await Promise.all([loadHand(), loadProfiles(), loadChat(), loadMutes()]);

  /* ---------- live ---------- */
  ch = channel('room:' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'id=eq.' + id }, (p) => { if (p.new.version > room.version) apply(p.new); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_hands', filter: 'room_id=eq.' + id }, (p) => { if (p.new && p.new.user_id === myId) { hand = p.new.cards || []; draw(); } })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'room_id=eq.' + id }, (p) => onChat(p.new))
    .subscribe((s) => { if (s === 'SUBSCRIBED') refresh(); });
  pres = channel('presence:' + id, { config: { presence: { key: myId } } });
  pres.on('presence', { event: 'sync' }, () => { onlineIds = new Set(Object.keys(pres.presenceState())); presenceReady = true; draw(); })
    .subscribe((s) => { if (s === 'SUBSCRIBED') pres.track({ at: Date.now() }); });
  resync = setInterval(refresh, 8000);
  beat = setInterval(() => rpc('touch').catch(() => {}), 25000);
  rpc('touch').catch(() => {});

  async function refresh() {
    if (gone) return;
    try { const r = await loadRoom(); await loadHand(); if (r.version > room.version) apply(r); else draw(); } catch { /* offline: next tick */ }
  }
  async function apply(r) {
    const was = room.status;
    room = r;
    if (room.status === 'closed') { gone = true; toast('انقفلت الغرفة.'); navigate('/play', { replace: true }); return; }
    if (room.state && room.state.counts && !isSpectator() && room.state.counts[mySeat()] !== hand.length) await loadHand();
    await loadProfiles();
    if (was === 'waiting' && room.status === 'playing') { if (roomEl) roomEl = null; startTable(true); return; }
    if (was !== 'waiting' && room.status === 'waiting') { if (table) { table.destroy(); table = null; } }
    draw();
  }
  const mySeat = () => (room.seats || []).findIndex((s) => s && s.uid === myId);
  const isSpectator = () => mySeat() < 0;
  const isOwner = () => room.owner === myId;

  /* ---------- table ---------- */
  const seatsView = () => (room.seats || []).map((s) => {
    if (!s) return null;
    const p = profiles[s.uid] || {};
    return { uid: s.uid, name: s.name, avatar_url: p.avatar_url, frame: p.frame, rating: p.rating, level: p.level, abandoned: !!s.abandoned, offline: presenceReady && !onlineIds.has(s.uid), online: presenceReady ? onlineIds.has(s.uid) : null };
  });
  const adapter = {
    view: () => ({ state: room.state, seats: seatsView(), mySeat: mySeat(), hand, status: room.status, code: room.code, kind: room.kind, table: state.profile.equip_table, back: state.profile.equip_back }),
    async act(kind, v, reqId) { await game('play', { id, kind, v, reqId, rid: uid() }); await refresh(); },
    tick() { game('tick', { id }).then(refresh).catch(() => {}); },
    async leave() {
      if (room.status === 'playing' && !isSpectator() && !room.seats[mySeat()].abandoned) {
        const ok = await confirmBox('تنسحب من المباراة؟', 'الانسحاب يُحسب خسارة لك' + (room.kind === 'ranked' ? ' مع خصم ١٥ نقطة تصنيف' : '') + '، وبوت يكمل مكانك. إذا بس تبي تطلع شوي، سكّر الصفحة وارجع خلال ٣ دقائق.', { ok: 'انسحب', danger: true });
        if (!ok) return;
        await game('room_leave', { id }).catch(toastErr);
      } else if (room.status !== 'playing') await game('room_leave', { id }).catch(() => {});
      gone = true; navigate('/', { replace: true });
    },
    rematch: () => (room.kind === 'ranked' || room.kind === 'friendly' ? navigate('/play') : isOwner() ? game('room_rematch', { id }).then(refresh).catch(toastErr) : toast('صاحب الغرفة يقدر يبدأ صكة جديدة.')),
    async finalInfo() {
      const me = room.seats[mySeat()]; if (!me) return '';
      const h = await rpc('player_history', { p_user: myId, p_limit: 1 }).catch(() => null);
      const m = h && h[0]; if (!m || m.match_id !== room.match_id) return '<p class="small muted" style="text-align:center">جاري اعتماد النتيجة…</p>';
      return `<p style="text-align:center">${m.ranked ? `التصنيف <b class="num" style="color:${m.rating_delta >= 0 ? 'var(--us)' : 'var(--them)'}">${m.rating_delta >= 0 ? '+' : ''}${m.rating_delta}</b> · ` : ''}الخبرة <b class="num">+${m.xp}</b>${m.abandoned ? ' · انسحاب' : ''}</p><p style="text-align:center"><a href="/match/${m.match_id}" data-link>تفاصيل المباراة والإعادة</a></p>`;
    },
    onSeatClick: (s) => seatMenu(s),
    chat: {
      quick: QUICK,
      mode: () => room.chat_mode,
      messages: () => msgs.filter((m) => !muted.has(m.user_id)).map((m) => ({ id: m.id, uid: m.user_id, name: nameOf(m.user_id), body: m.body, mine: m.user_id === myId })),
      send: (t) => rpc('send_chat', { p_room: id, p_body: t }).catch(toastErr),
      report: (mid) => reportMessage(mid),
    },
  };
  function nameOf(u) { const s = (room.seats || []).find((x) => x && x.uid === u); const p = profiles[u]; return (p && p.display_name) || (s && s.name) || 'لاعب'; }
  function startTable(replay) {
    main.innerHTML = '';
    document.body.classList.add('ingame');
    table = createTable(main, adapter, { replay });
  }
  function onChat(m) {
    if (msgs.some((x) => x.id === m.id)) return;
    msgs.push(m); if (msgs.length > 80) msgs.shift();
    if (muted.has(m.user_id)) return;
    if (table) table.chatMessage({ uid: m.user_id, body: m.body, mine: m.user_id === myId }, true);
    else drawChat();
  }
  async function reportMessage(mid) {
    const m = msgs.find((x) => x.id === mid); if (!m) return;
    const d = dialog(html`<h2>الإبلاغ عن رسالة</h2><blockquote class="card">${m.body}</blockquote>
      <div class="seg" role="group" id="rr">${raw(['abuse:إساءة', 'spam:إزعاج', 'inappropriate_name:محتوى غير لائق', 'other:غير ذلك'].map((x) => { const [v, l] = x.split(':'); return `<button type="button" data-v="${v}" aria-pressed="false">${l}</button>`; }).join(''))}</div>
      <div class="actions"><button class="btn" data-close>إلغاء</button><button class="btn danger" id="send">إبلاغ</button></div>`);
    let reason = null;
    d.el.querySelector('#rr').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; reason = b.dataset.v; for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b)); };
    d.el.querySelector('#send').onclick = (e) => busy(e.currentTarget, async () => { if (!reason) { toast('اختر سبب البلاغ.', { error: true }); return; } await rpc('report_submit', { p_kind: 'message', p_target: null, p_ref: String(mid), p_reason: reason, p_details: '' }); toast('وصل البلاغ. شكراً لك.'); d.close(); });
  }
  async function seatMenu(s) {
    const st = room.seats[s]; if (!st || st.uid === myId) return;
    const p = profiles[st.uid] || { username: '', display_name: st.name };
    const isMuted = muted.has(st.uid);
    const d = dialog(html`<div class="row">${avatar(p, 64)}<div><h2 style="margin:0">${p.display_name || st.name}</h2><span class="muted">@${p.username}</span><div>${p.rating != null ? rankBadge(p.rating) : ''}</div></div></div>
      <div class="stack" style="margin-top:14px">
        <a class="btn" href="/u/${encodeURIComponent(p.username)}" target="_blank" rel="noopener">فتح الملف (في نافذة جديدة)</a>
        <button class="btn" id="mute">${isMuted ? 'إلغاء كتم الرسائل' : 'كتم رسائله'}</button>
        <button class="btn danger" id="rep">إبلاغ</button>
      </div><div class="actions"><button class="btn" data-close>إغلاق</button></div>`);
    d.el.querySelector('#mute').onclick = (e) => busy(e.currentTarget, async () => {
      if (isMuted) await select('user_mutes', (q) => q.delete().eq('muter', myId).eq('muted', st.uid)); else await select('user_mutes', (q) => q.insert({ muter: myId, muted: st.uid }));
      await loadMutes(); toast(isMuted ? 'ألغيت الكتم.' : 'كتمت رسائله.'); d.close(); if (table) table.renderChat(); else drawChat();
    });
    d.el.querySelector('#rep').onclick = () => { d.close(); reportDialog({ id: st.uid, username: p.username, display_name: p.display_name || st.name }); };
  }

  /* ---------- waiting room ---------- */
  function draw() {
    if (gone) return;
    if (room.status === 'playing' || room.status === 'finished') {
      if (!table) startTable(false); else table.update(adapter.view());
      return;
    }
    document.body.classList.remove('ingame');
    drawWaiting();
  }
  function drawWaiting() {
    const seats = room.seats || [], me = mySeat(), owner = isOwner();
    const filled = seats.filter(Boolean).length, allReady = filled === 4 && seats.every((s) => s && s.ready);
    const seatBox = (p) => {
      const s = seats[p], pr = s ? profiles[s.uid] || {} : null;
      const online = s && presenceReady ? onlineIds.has(s.uid) : null;
      if (!s) return html`<div class="card stack" style="align-items:center;text-align:center;min-height:170px;justify-content:center;border-style:dashed">
        <span class="muted small">كرسي ${p + 1} · ${p % 2 ? 'الفريق الثاني' : 'الفريق الأول'}</span><span class="muted">فاضي</span>
        ${room.kind === 'ranked' || room.kind === 'friendly' ? '' : html`<button class="btn small primary" data-sit="${p}">${me >= 0 ? 'انتقل هنا' : 'اجلس هنا'}</button>`}</div>`;
      return html`<div class="card stack" style="align-items:center;text-align:center;min-height:170px;border-color:${s.ready ? 'var(--us)' : 'var(--line)'}">
        <span class="muted small">كرسي ${p + 1} · ${p % 2 ? 'الفريق الثاني' : 'الفريق الأول'}${room.owner === s.uid ? ' · 👑 صاحب الغرفة' : ''}</span>
        ${avatar({ ...pr, display_name: pr.display_name || s.name }, 56, { online: online === true })}
        <b>${s.uid === myId ? 'أنت' : pr.display_name || s.name}</b>
        ${pr.rating != null ? rankBadge(pr.rating) : ''}
        <span class="chip ${s.ready ? 'live' : ''}">${s.ready ? 'جاهز ✓' : 'غير جاهز'}${online === false ? ' · غير متصل' : ''}</span>
        ${owner && s.uid !== myId ? html`<div class="row" style="justify-content:center"><button class="btn small ghost" data-kick="${p}">إخراج</button><button class="btn small ghost" data-owner="${s.uid}">نقل الملكية</button></div>` : ''}</div>`;
    };
    if (!roomEl) { mount(main, html`<div id="wr" class="stack"></div>`); roomEl = $('#wr', main); }
    mount(roomEl, html`
      <section class="row between">
        <div><h1>${KIND[room.kind] || 'غرفة'}</h1><p class="muted">الكود: <b dir="ltr" class="num" style="color:var(--gold);letter-spacing:.12em">${room.code}</b> · ${filled}/4 لاعبين</p></div>
        <div class="row"><button class="btn" id="copy">🔗 رابط الدعوة</button><button class="btn" id="invite">✉️ ادعُ صديق</button><button class="btn ghost" id="leave">اطلع</button></div>
      </section>
      <section class="grid two" aria-label="المقاعد">
        <div class="stack"><h3>الفريق الأول</h3><div class="grid two">${seatBox(0)}${seatBox(2)}</div></div>
        <div class="stack"><h3>الفريق الثاني</h3><div class="grid two">${seatBox(1)}${seatBox(3)}</div></div>
      </section>
      <section class="card row between">
        <div class="stack" style="gap:4px"><b>${me < 0 ? 'أنت تتفرج — اختر كرسي فاضي' : allReady ? 'الكل جاهز!' : 'لما يجهز الأربعة يبدأ صاحب الغرفة'}</b><span class="small muted">المقابل لك هو خويك. صاحب الغرفة يرتّب الفرق قبل البداية.</span></div>
        <div class="row">
          ${me >= 0 ? html`<button class="btn ${seats[me].ready ? '' : 'primary'} big" id="ready">${seats[me].ready ? 'إلغاء الاستعداد' : 'جاهز ✓'}</button><button class="btn ghost" id="stand">قم من الكرسي</button>` : ''}
          ${owner ? html`<button class="btn primary big" id="start" ${allReady ? '' : raw('disabled')}>ابدأ المباراة</button>` : ''}
        </div>
      </section>
      <section class="grid two">
        <div class="card"><div class="section-title"><h3>قواعد الغرفة</h3>${owner ? html`<button class="btn small" id="edit">تعديل</button>` : ''}</div>
          <table class="data">${ruleRows(room.rules).map((r) => html`<tr><td>${r.label}</td><td>${r.value}${r.isDefault ? '' : raw(' <span class="pill">مخصّص</span>')}</td></tr>`)}
          <tr><td>الدردشة</td><td>${{ open: 'مفتوحة', quick: 'عبارات سريعة فقط', off: 'مقفلة' }[room.chat_mode]}</td></tr></table>
          ${owner ? html`<div class="row" style="margin-top:10px"><button class="btn danger small" id="close">إنهاء الغرفة</button></div>` : ''}</div>
        <div class="card stack" id="chatBox"></div>
      </section>`);
    roomEl.querySelectorAll('[data-sit]').forEach((b) => (b.onclick = () => busy(b, async () => { await game('room_sit', { id, seat: +b.dataset.sit }); await refresh(); })));
    roomEl.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = async () => { if (await confirmBox('إخراج اللاعب؟', 'بيرجع متفرج ويقدر يجلس من جديد.')) busy(b, async () => { await game('room_kick', { id, seat: +b.dataset.kick }); await refresh(); }); }));
    roomEl.querySelectorAll('[data-owner]').forEach((b) => (b.onclick = async () => { if (await confirmBox('نقل الملكية؟', 'بيصير هو صاحب الغرفة ويتحكم بالبداية والإعدادات.')) busy(b, async () => { await game('room_transfer', { id, to: b.dataset.owner }); await refresh(); }); }));
    const on = (sel, fn) => { const el = roomEl.querySelector(sel); if (el) el.onclick = fn; };
    on('#ready', (e) => busy(e.currentTarget, async () => { await game('room_ready', { id, ready: !room.seats[me].ready }); await refresh(); }));
    on('#stand', (e) => busy(e.currentTarget, async () => { await game('room_stand', { id }); await refresh(); }));
    on('#start', (e) => busy(e.currentTarget, async () => { await game('room_start', { id }); await refresh(); }));
    on('#leave', async () => { await game('room_leave', { id }).catch(() => {}); gone = true; navigate('/play'); });
    on('#close', async () => { if (await confirmBox('إنهاء الغرفة؟', 'بيطلع الجميع وتنقفل الغرفة.', { ok: 'إنهاء', danger: true })) { await game('room_close', { id }).catch(toastErr); gone = true; navigate('/play'); } });
    on('#edit', async () => { const cfg = await roomSettingsDialog({ rules: room.rules, chat_mode: room.chat_mode, kind: room.kind === 'public' ? 'public' : 'private' }); if (cfg) { await game('room_settings', { id, ...cfg }).catch(toastErr); await refresh(); toast('تحدّثت الإعدادات، وكل اللاعبين يحتاجون يأكدون الاستعداد من جديد.'); } });
    on('#copy', () => copyText(location.origin + '/room/' + room.code, 'نسخت رابط الدعوة ✓'));
    on('#invite', inviteFriends);
    drawChat();
  }
  function drawChat() {
    const box = roomEl && roomEl.querySelector('#chatBox'); if (!box) return;
    const list = msgs.filter((m) => !muted.has(m.user_id));
    mount(box, html`<h3>الدردشة</h3>
      <div class="msgs" style="max-height:220px">${list.length ? list.map((m) => html`<div class="msg ${m.user_id === myId ? 'mine' : ''}"><b>${nameOf(m.user_id)}:</b><span>${m.body}</span>${m.user_id === myId ? '' : html`<button class="rep" data-rep="${m.id}" title="إبلاغ">⚑</button>`}</div>`) : raw('<span class="muted small">ما فيه رسائل للحين. سلّم على ربعك 👋</span>')}</div>
      ${room.chat_mode === 'off' ? raw('<p class="small muted">الدردشة مقفلة.</p>') : html`<div class="quick">${QUICK.map((q) => html`<button data-q="${q}">${q}</button>`)}</div>
      ${room.chat_mode === 'open' ? raw('<form class="row" id="cf"><input class="input" maxlength="200" placeholder="اكتب رسالة" aria-label="رسالة" style="flex:1"><button class="btn" type="submit">أرسل</button></form>') : ''}`}`);
    const l = box.querySelector('.msgs'); l.scrollTop = l.scrollHeight;
    box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => rpc('send_chat', { p_room: id, p_body: b.dataset.q }).catch(toastErr)));
    box.querySelectorAll('[data-rep]').forEach((b) => (b.onclick = () => reportMessage(+b.dataset.rep)));
    const f = box.querySelector('#cf'); if (f) f.onsubmit = (e) => { e.preventDefault(); const i = f.querySelector('input'); const t = i.value.trim(); if (t) { rpc('send_chat', { p_room: id, p_body: t }).catch(toastErr); i.value = ''; } };
  }
  async function inviteFriends() {
    const friends = await rpc('list_friends').catch(() => []);
    const seated = new Set((room.seats || []).filter(Boolean).map((s) => s.uid));
    const list = friends.filter((f) => !seated.has(f.id));
    const d = dialog(html`<h2>ادعُ أصدقاءك</h2>${list.length ? html`<div class="list">${list.map((f) => html`<div class="item">${avatar(f, 40, { online: f.online === true })}<div class="grow"><b>${f.display_name}</b><div class="small muted">${f.online ? 'متصل' : f.online === false ? 'غير متصل' : ''}</div></div><button class="btn small primary" data-inv="${f.id}">ادعُ</button></div>`)}</div>`
      : html`<div class="empty"><b>ما عندك أصدقاء تدعوهم الحين.</b><span>أرسل رابط الغرفة أو الكود: <b dir="ltr">${room.code}</b></span><a class="btn" href="/friends" data-link data-close>أضف أصدقاء</a></div>`}
      <div class="actions"><button class="btn" data-close>إغلاق</button></div>`);
    d.el.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => busy(b, async () => { await rpc('invite_to_room', { p_target: b.dataset.inv, p_room: id }); b.textContent = 'أُرسلت ✓'; b.disabled = true; })));
  }

  draw();
  return () => {
    gone = true; clearInterval(resync); clearInterval(beat);
    if (table) table.destroy();
    if (ch) removeChannel(ch); if (pres) { try { pres.untrack(); } catch { /* ignore */ } removeChannel(pres); }
    document.body.classList.remove('ingame');
  };
}
