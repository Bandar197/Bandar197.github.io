// Play hub: ranked and friendly matchmaking, private/public rooms, join by code, open public rooms.
import { game, rpc, select } from '../api.js';
import { html, raw, mount, busy, toast, dialog, ago, n, $ } from '../ui.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { roomSettingsDialog } from './roomsettings.js';

const POLICY_KEY = 'diwaniya.policy.v1';
export async function showPolicy(force = false) {
  try { if (!force && localStorage.getItem(POLICY_KEY)) return true; } catch { /* ignore */ }
  const d = dialog(html`<h2>قبل اللعب التنافسي</h2>
    <ul class="stack" style="padding-inline-start:18px;margin:0">
      <li>لكل حركة <b>٣٠ ثانية</b> بعد عرض حركات اللاعبين. إذا خلص وقتك يلعب الخادم عنك ورقة مناسبة.</li>
      <li>إذا انقطع اتصالك عندك <b>٣ دقائق</b> ترجع فيها لنفس كرسيك وورقك (حدّث الصفحة أو افتح الرابط).</li>
      <li>انتهاء الوقت <b>٣ مرات متتالية</b> أو الغياب أكثر من ٣ دقائق أو الخروج = <b>انسحاب</b>: بوت يكمل مكانك، والمباراة تُحسب لك خسارة مع خصم ١٥ نقطة تصنيف إضافية.</li>
      <li>خويك ما يتضرر كثير: إذا خسر فريقه بسبب انسحابك تنقص خسارته للنصف.</li>
      <li>النتيجة تُعتمد على الخادم مرة واحدة فقط، وما يمكن تعديلها من المتصفح.</li>
      <li>التلميحات وعداد الورق متاحة في <a href="/training" data-link>التدريب</a> فقط.</li>
    </ul>
    <div class="actions"><button class="btn" data-close="no">لاحقاً</button><button class="btn primary" data-close="ok">فهمت، كمّل</button></div>`, { label: 'سياسة اللعب التنافسي' });
  const ok = (await d.done) === 'ok';
  if (ok) try { localStorage.setItem(POLICY_KEY, '1'); } catch { /* ignore */ }
  return ok;
}

export async function createRoom(defaultKind = 'private', btn) {
  const cfg = await roomSettingsDialog({ kind: defaultKind, title: 'غرفة جديدة', okLabel: 'افتح الغرفة' });
  if (!cfg) return;
  await busy(btn, async () => { const r = await game('room_create', cfg); navigate('/room/' + r.code); });
}

export async function render(main) {
  let poll = null, stats = null;
  mount(main, html`
    <section class="stack"><h1>العب</h1><p class="muted" id="live">…</p></section>
    <section class="play-cta">
      <button class="mode primary" id="ranked"><span class="chip gold tag">مصنّف</span><b>تنافسي</b><span>مباراة مع ٣ لاعبين بمستوى قريب منك. تحسب في التصنيف والموسم.</span></button>
      <button class="mode" id="friendly"><span class="chip tag">ودّي</span><b>ودّي سريع</b><span>نجمع لك أول ٤ لاعبين متاحين. ما يأثر على التصنيف.</span></button>
      <button class="mode" id="private"><span class="chip tag">خاصة</span><b>غرفة خاصة</b><span>افتح غرفة وادعُ ربعك بالكود أو الرابط، ورتّبوا الفرق.</span></button>
      <button class="mode" id="public"><span class="chip tag">عامة</span><b>غرفة عامة</b><span>تظهر في قائمة الغرف لأي لاعب يبي ينضم.</span></button>
      <a class="mode" href="/training" data-link><span class="chip tag">تدريب</span><b>ضد البوتات</b><span>تدريب بمستويات صعوبة وتلميحات — ما يحسب في التصنيف.</span></a>
    </section>
    <section class="card" id="queueBox" hidden></section>
    <section class="card"><h3>انضم بكود</h3>
      <form class="row" id="codeF" style="margin-top:8px"><input class="input" id="code" maxlength="10" placeholder="مثال: k7m2xp" dir="ltr" autocomplete="off" aria-label="كود الغرفة" style="flex:1;min-width:160px"><button class="btn primary" type="submit">ادخل</button></form>
    </section>
    <section class="card"><div class="section-title"><h3>الغرف العامة</h3><button class="btn small ghost" id="refresh">تحديث</button></div><div id="pub" class="list"></div></section>`);

  const live = async () => {
    stats = await rpc('lobby_stats').catch(() => null);
    if (stats) $('#live', main).textContent = `${n(stats.online)} متصل الحين · ${n(stats.playing)} مباراة شغّالة · ${n(stats.queue_ranked + stats.queue_friendly)} ينتظرون مباراة`;
  };
  const loadPublic = async () => {
    const rows = await select('rooms', (q) => q.select('id,code,status,seats,rules,updated_at').eq('kind', 'public').in('status', ['waiting', 'playing'])
      .gt('updated_at', new Date(Date.now() - 2 * 3600e3).toISOString()).order('updated_at', { ascending: false }).limit(20)).catch(() => []);
    const box = $('#pub', main);
    if (!rows.length) { mount(box, html`<div class="empty"><div class="art">🪑</div><b>ما فيه غرف عامة مفتوحة الحين.</b><span>افتح غرفة عامة وخل الناس ينضمون، أو جرّب «ودّي سريع».</span></div>`); return; }
    mount(box, html`${rows.map((r) => {
      const seated = r.seats.filter(Boolean), host = seated[0];
      return html`<div class="item"><div class="grow"><b>طاولة ${host ? host.name : ''}</b><div class="small muted">${seated.length}/4 · الصكة ${r.rules.target} · ${ago(r.updated_at)}</div></div>
        <span class="chip ${r.status === 'playing' ? 'live' : ''}">${r.status === 'playing' ? 'تلعب الحين' : 'تنتظر لاعبين'}</span>
        <a class="btn small ${r.status === 'waiting' && seated.length < 4 ? 'primary' : ''}" href="/room/${r.code}" data-link>${r.status === 'waiting' && seated.length < 4 ? 'انضم' : 'تفرّج'}</a></div>`;
    })}`);
  };

  /* matchmaking */
  const qbox = $('#queueBox', main);
  function showQueue(r) {
    qbox.hidden = false;
    const since = r.since ? new Date(r.since).getTime() : Date.now();
    mount(qbox, html`<div class="row between"><div class="row"><div class="spinner" style="width:28px;height:28px"></div><div><b>${r.mode === 'ranked' ? 'نبحث لك عن مباراة تنافسية' : 'نجمع مباراة ودّية'}</b>
      <div class="small muted"><span id="qt">0:00</span> · ${n(r.waiting)} في الانتظار</div></div></div><button class="btn danger small" id="qcancel">إلغاء</button></div>
      <p class="small muted" style="margin-top:8px">نوسّع نطاق المستوى كل ١٥ ثانية. تقدر تتصفح الموقع وبيوصلك تنبيه أول ما تجهز المباراة.</p>`);
    $('#qcancel', main).onclick = (e) => busy(e.currentTarget, async () => { await game('queue_leave'); stopPoll(); qbox.hidden = true; toast('ألغيت البحث.'); });
    const tick = () => { const s = Math.floor((Date.now() - since) / 1000); const el = $('#qt', main); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    tick(); clearInterval(qbox._t); qbox._t = setInterval(tick, 1000);
  }
  function stopPoll() { clearInterval(poll); poll = null; clearInterval(qbox._t); }
  async function pollOnce() {
    const r = await game('queue_poll').catch(() => null);
    if (!r) return;
    if (r.room) { stopPoll(); const rm = await select('rooms', (q) => q.select('code').eq('id', r.room).maybeSingle()).catch(() => null); if (rm) navigate('/room/' + rm.code); return; }
    if (r.queued) showQueue(r); else { stopPoll(); qbox.hidden = true; }
  }
  async function join(mode, btn) {
    if (state.banned) { toast('حسابك موقوف حالياً.', { error: true }); return; }
    if (mode === 'ranked' && !(await showPolicy())) return;
    await busy(btn, async () => {
      const r = await game('queue_join', { mode });
      if (r.room) { await pollOnce(); return; }
      showQueue(r); stopPoll(); poll = setInterval(pollOnce, 4000);
    });
  }
  $('#ranked', main).onclick = (e) => join('ranked', e.currentTarget);
  $('#friendly', main).onclick = (e) => join('friendly', e.currentTarget);
  $('#private', main).onclick = (e) => createRoom('private', e.currentTarget);
  $('#public', main).onclick = (e) => createRoom('public', e.currentTarget);
  $('#refresh', main).onclick = loadPublic;
  $('#codeF', main).onsubmit = (e) => { e.preventDefault(); const c = $('#code', main).value.trim().toLowerCase(); if (c) navigate('/room/' + encodeURIComponent(c)); };

  await Promise.all([live(), loadPublic(), pollOnce()]);
  if (poll === null && !qbox.hidden) poll = setInterval(pollOnce, 4000);
  const ref = setInterval(() => { live(); loadPublic(); }, 15000);
  return () => { stopPoll(); clearInterval(ref); };
}
