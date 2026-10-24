// Account settings (/settings): profile, security, privacy, notifications, cosmetics, people, device.
import { auth, rpc, select, game, uploadAvatar } from '../api.js';
import { state, setState } from '../state.js';
import { navigate } from '../router.js';
import { html, mount, toast, toastErr, dialog, confirmBox, busy, avatar, personLink, prefs, savePrefs } from '../ui.js';

const TABS = [
  ['profile', 'الملف'],
  ['account', 'الحساب والأمان'],
  ['privacy', 'الخصوصية'],
  ['notify', 'التنبيهات'],
  ['custom', 'التخصيص'],
  ['people', 'الأصدقاء والمحظورون'],
  ['device', 'الجهاز'],
];
const USERNAME_RE = /^[A-Za-z0-9_ء-ي٠-٩]{3,14}$/;
const MAX_INPUT = 5 * 1024 * 1024;

async function refreshProfile() {
  const p = await select('profiles', (q) => q.select('*').eq('id', state.user.id).maybeSingle());
  if (p) setState({ profile: p });
  return p;
}
async function updateProfile(patch) {
  await select('profiles', (q) => q.update(patch).eq('id', state.user.id));
  return refreshProfile();
}

/* ---------------- device / browser summary ---------------- */
function deviceSummary() {
  const ua = navigator.userAgent || '';
  let browser = 'متصفح غير معروف';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = 'نظام غير معروف';
  if (/iPhone|iPod/.test(ua)) os = 'iPhone (iOS)';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) os = 'iPad (iPadOS)';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return `${browser} على ${os}`;
}
const dateTime = (ts) => (ts ? new Date(ts).toLocaleString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'غير معروف');

/* ---------------- avatar cropper ---------------- */
export function createCropper(canvas, zoomInput) {
  const S = canvas.width; // internal square size
  const ctx = canvas.getContext('2d');
  let img = null, w = 0, h = 0, base = 1, z = 1, ox = 0, oy = 0;
  const clamp = () => {
    const dw = w * base * z, dh = h * base * z;
    const mx = Math.max(0, (dw - S) / 2), my = Math.max(0, (dh - S) / 2);
    ox = Math.min(mx, Math.max(-mx, ox)); oy = Math.min(my, Math.max(-my, oy));
  };
  const drawTo = (c, size, overlay) => {
    const k = size / S;
    const dw = w * base * z * k, dh = h * base * z * k;
    c.clearRect(0, 0, size, size);
    c.fillStyle = '#0a2419'; c.fillRect(0, 0, size, size);
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, size / 2 - dw / 2 + ox * k, size / 2 - dh / 2 + oy * k, dw, dh);
    if (overlay) {
      c.fillStyle = 'rgba(2,10,6,.62)';
      c.beginPath(); c.rect(0, 0, size, size); c.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); c.fill('evenodd');
      c.strokeStyle = '#e2bd62'; c.lineWidth = 3; c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); c.stroke();
    }
  };
  const draw = () => { if (img) { clamp(); drawTo(ctx, S, true); } };
  let drag = null;
  const scale = () => S / canvas.getBoundingClientRect().width;
  canvas.addEventListener('pointerdown', (e) => { if (!img) return; drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = scale();
    ox += (e.clientX - drag.x) * k; oy += (e.clientY - drag.y) * k; drag = { x: e.clientX, y: e.clientY }; draw();
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 12;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (m) { e.preventDefault(); ox += m[0]; oy += m[1]; draw(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(z + 0.1); }
    else if (e.key === '-') { e.preventDefault(); setZoom(z - 0.1); }
  });
  canvas.addEventListener('wheel', (e) => { if (!img) return; e.preventDefault(); setZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  const setZoom = (v) => { z = Math.min(4, Math.max(1, v)); zoomInput.value = String(z); draw(); };
  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));
  return {
    load(image) {
      img = image; w = image.width; h = image.height; base = Math.max(S / w, S / h); z = 1; ox = 0; oy = 0; zoomInput.value = '1'; draw();
    },
    async export() {
      const out = document.createElement('canvas'); out.width = 256; out.height = 256;
      drawTo(out.getContext('2d'), 256, false);
      const toBlob = (type, q) => new Promise((r) => out.toBlob(r, type, q));
      let blob = await toBlob('image/webp', 0.9);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.9);
      if (blob && blob.size > 1024 * 1024) blob = await toBlob('image/jpeg', 0.75);
      if (!blob) throw new Error('ما قدرنا نجهّز الصورة. جرّب صورة ثانية.');
      return blob;
    },
  };
}
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ما قدرنا نقرأ الصورة. جرّب صورة PNG أو JPG أو WebP.')); };
    im.src = url;
  });
}

/* ---------------- tabs ---------------- */
function profileTab(el) {
  const p = state.profile;
  mount(el, html`
  <section class="card stack" aria-labelledby="avTitle">
    <h2 id="avTitle">الصورة الشخصية</h2>
    <div class="row" style="gap:16px">
      <span id="avNow">${avatar(p, 88)}</span>
      <div class="stack" style="gap:6px">
        <div class="row">
          <button class="btn" id="avPick" type="button">🖼️ اختر صورة</button>
          <button class="btn ghost" id="avRemove" type="button" ${p.avatar_url ? '' : 'hidden'}>إزالة الصورة</button>
        </div>
        <span class="hint">PNG أو JPG أو WebP، حتى ٥ ميغابايت. بنقصّها مربعة ونصغّرها قبل الرفع.</span>
      </div>
      <input type="file" id="avFile" accept="image/png,image/jpeg,image/webp" class="sr-only" tabindex="-1" aria-hidden="true">
    </div>
    <div id="cropBox" class="stack" hidden style="align-items:center">
      <canvas id="crop" width="560" height="560" tabindex="0" role="img" aria-label="معاينة القص. اسحب الصورة أو استخدم الأسهم لتحريكها، و + و − للتكبير."
        style="width:min(280px,100%);aspect-ratio:1;border-radius:16px;touch-action:none;cursor:grab;background:var(--bg-2)"></canvas>
      <div class="field" style="width:min(280px,100%)">
        <label for="zoom">التكبير</label>
        <input type="range" id="zoom" min="1" max="4" step="0.01" value="1" style="width:100%;min-height:44px">
        <span class="hint">اسحب الصورة لتحريكها داخل الدائرة.</span>
      </div>
      <div class="row"><button class="btn primary" id="avSave" type="button">حفظ الصورة</button><button class="btn" id="avCancel" type="button">إلغاء</button></div>
    </div>
  </section>

  <section class="card" aria-labelledby="infoTitle">
    <form class="stack" id="infoForm" novalidate>
      <h2 id="infoTitle">معلوماتك</h2>
      <div class="field"><label for="dn">الاسم الظاهر</label>
        <input class="input" id="dn" name="dn" maxlength="24" required value="${p.display_name || ''}" autocomplete="nickname">
        <span class="hint">من حرف إلى ٢٤ حرفاً. هذا اللي يشوفه الناس على الطاولة.</span></div>
      <div class="field"><label for="bio">نبذة عنك</label>
        <textarea class="input" id="bio" name="bio" maxlength="160" rows="3" aria-describedby="bioCount">${p.bio || ''}</textarea>
        <span class="hint" id="bioCount" aria-live="polite"></span></div>
      <p class="error" role="alert" id="infoErr"></p>
      <div class="row"><button class="btn primary" type="submit">حفظ</button></div>
    </form>
  </section>

  <section class="card" aria-labelledby="unTitle">
    <form class="stack" id="unForm" novalidate>
      <h2 id="unTitle">اسم المستخدم</h2>
      <div class="field"><label for="un">اسم المستخدم</label>
        <input class="input" id="un" name="un" maxlength="14" dir="ltr" value="${p.username}" autocomplete="username" spellcheck="false" autocapitalize="off">
        <span class="hint">من ٣ إلى ١٤ حرفاً (عربي أو إنجليزي أو أرقام أو _) بدون مسافات. تقدر تغيّره مرة كل ٧ أيام، ورابط ملفك القديم بيتوقف عن العمل.</span></div>
      <p class="error" role="alert" id="unErr"></p>
      <div class="row"><button class="btn" type="submit">تغيير اسم المستخدم</button></div>
    </form>
  </section>`);

  // avatar
  const file = el.querySelector('#avFile'), box = el.querySelector('#cropBox');
  const cropper = createCropper(el.querySelector('#crop'), el.querySelector('#zoom'));
  el.querySelector('#avPick').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { toast('نوع الصورة غير مدعوم. استخدم PNG أو JPG أو WebP.', { error: true }); return; }
    if (f.size > MAX_INPUT) { toast('الصورة أكبر من ٥ ميغابايت. اختر صورة أصغر.', { error: true }); return; }
    try {
      const im = await loadImage(f);
      box.hidden = false; cropper.load(im);
      el.querySelector('#crop').focus();
    } catch (e) { toastErr(e); }
  };
  el.querySelector('#avCancel').onclick = () => { box.hidden = true; };
  el.querySelector('#avSave').onclick = (e) => busy(e.currentTarget, async () => {
    const blob = await cropper.export();
    const url = await uploadAvatar(state.user.id, blob);
    await updateProfile({ avatar_url: url });
    toast('تحدّثت صورتك ✓');
    profileTab(el);
  });
  el.querySelector('#avRemove').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox('إزالة الصورة', 'بنرجع لأول حرف من اسمك بدل الصورة.', { ok: 'إزالة' }))) return;
    await busy(btn, async () => { await updateProfile({ avatar_url: null }); toast('أزلنا الصورة.'); profileTab(el); });
  };

  // info
  const form = el.querySelector('#infoForm'), bio = form.bio, count = el.querySelector('#bioCount');
  const upd = () => { count.textContent = `${bio.value.length} / ١٦٠ حرف`; };
  bio.addEventListener('input', upd); upd();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el.querySelector('#infoErr');
    const dn = form.dn.value.trim(), b = bio.value.trim();
    form.dn.setAttribute('aria-invalid', 'false');
    if (dn.length < 1 || dn.length > 24) { err.textContent = 'الاسم الظاهر من حرف إلى ٢٤ حرفاً.'; form.dn.setAttribute('aria-invalid', 'true'); form.dn.focus(); return; }
    if (b.length > 160) { err.textContent = 'النبذة أطول من ١٦٠ حرفاً.'; return; }
    err.textContent = '';
    await busy(form.querySelector('[type=submit]'), async () => {
      await updateProfile({ display_name: dn, bio: b });
      toast('انحفظت معلوماتك ✓');
      el.querySelector('#avNow').innerHTML = avatar(state.profile, 88).__raw;
    });
  });

  // username
  const uf = el.querySelector('#unForm');
  uf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el.querySelector('#unErr'), v = uf.un.value.trim();
    uf.un.setAttribute('aria-invalid', 'false');
    if (v === state.profile.username) { err.textContent = 'هذا اسمك الحالي.'; return; }
    if (!USERNAME_RE.test(v)) { err.textContent = 'اسم المستخدم من ٣ إلى ١٤ حرفاً (عربي أو إنجليزي أو أرقام أو _) بدون مسافات.'; uf.un.setAttribute('aria-invalid', 'true'); uf.un.focus(); return; }
    err.textContent = '';
    if (!(await confirmBox('تغيير اسم المستخدم', `بيصير اسمك @${v}، وما تقدر تغيّره مرة ثانية إلا بعد ٧ أيام. رابط ملفك القديم بيتوقف.`, { ok: 'غيّره' }))) return;
    await busy(uf.querySelector('[type=submit]'), async () => {
      try { await rpc('change_username', { p_username: v }); } catch (x) { err.textContent = x.message; return; }
      await refreshProfile();
      toast(`صار اسم المستخدم @${v} ✓`);
    });
  });
}

function accountTab(el) {
  const u = state.user || {};
  mount(el, html`
  <section class="card stack" aria-labelledby="emTitle">
    <h2 id="emTitle">البريد الإلكتروني</h2>
    <div class="row"><b dir="ltr" style="overflow-wrap:anywhere">${u.email || 'بدون بريد'}</b>
      ${u.email_confirmed_at ? html`<span class="chip live">✓ مؤكَّد</span>` : html`<span class="chip warn">غير مؤكَّد</span>`}</div>
    ${u.new_email ? html`<p class="hint">بانتظار تأكيد البريد الجديد: <span dir="ltr">${u.new_email}</span></p>` : ''}
    <form class="stack" id="emForm" novalidate>
      <div class="field"><label for="em">بريد جديد</label><input class="input" id="em" name="em" type="email" dir="ltr" autocomplete="email" required></div>
      <p class="error" role="alert" id="emErr"></p>
      <p class="hint" id="emOk" role="status"></p>
      <div class="row"><button class="btn" type="submit">تغيير البريد</button></div>
    </form>
  </section>

  <section class="card" aria-labelledby="pwTitle">
    <form class="stack" id="pwForm" novalidate>
      <h2 id="pwTitle">كلمة المرور</h2>
      <div class="field"><label for="pw1">كلمة المرور الجديدة</label><input class="input" id="pw1" name="pw1" type="password" minlength="8" autocomplete="new-password" required></div>
      <div class="field"><label for="pw2">أعد كتابتها</label><input class="input" id="pw2" name="pw2" type="password" minlength="8" autocomplete="new-password" required>
        <span class="hint">٨ أحرف على الأقل. الأفضل تخلطها بأرقام.</span></div>
      <p class="error" role="alert" id="pwErr"></p>
      <div class="row"><button class="btn" type="submit">تحديث كلمة المرور</button></div>
    </form>
  </section>

  <section class="card stack" aria-labelledby="seTitle">
    <h2 id="seTitle">الجلسات</h2>
    <div class="list">
      <div class="item"><span aria-hidden="true" style="font-size:26px">💻</span>
        <div class="grow"><b>هذا الجهاز</b><div class="small muted">${deviceSummary()}</div></div><span class="chip live">الحالي</span></div>
      <div class="item"><span aria-hidden="true" style="font-size:26px">🕒</span>
        <div class="grow"><b>آخر تسجيل دخول</b><div class="small muted">${dateTime(u.last_sign_in_at)}</div></div></div>
    </div>
    <p class="hint">ما نعرض قائمة بالأجهزة الثانية. لو تشك إن أحد داخل على حسابك، اضغط «تسجيل الخروج من الأجهزة الأخرى» وغيّر كلمة المرور؛ بيطلع كل جهاز غير هذا.</p>
    <div class="row">
      <button class="btn" id="outOthers" type="button">تسجيل الخروج من الأجهزة الأخرى</button>
      <button class="btn ghost" id="outHere" type="button">تسجيل الخروج</button>
    </div>
  </section>

  <section class="card stack" aria-labelledby="dzTitle" style="border-color:#7a2a20">
    <h2 id="dzTitle" style="color:var(--danger)">منطقة الخطر</h2>
    <p class="muted">حذف الحساب نهائي: ينحذف ملفك وصورتك وأصدقاؤك وتقدمك، وما نقدر نرجعه.</p>
    <div class="row"><button class="btn danger" id="delAcc" type="button">حذف الحساب نهائياً</button></div>
  </section>`);

  const ef = el.querySelector('#emForm');
  ef.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el.querySelector('#emErr'), okEl = el.querySelector('#emOk'), v = ef.em.value.trim();
    okEl.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err.textContent = 'البريد الإلكتروني غير صحيح.'; ef.em.setAttribute('aria-invalid', 'true'); return; }
    if (v.toLowerCase() === String(u.email || '').toLowerCase()) { err.textContent = 'هذا بريدك الحالي.'; return; }
    err.textContent = ''; ef.em.setAttribute('aria-invalid', 'false');
    await busy(ef.querySelector('[type=submit]'), async () => {
      try { await auth.changeEmail(v); } catch (x) { err.textContent = x.message; return; }
      okEl.textContent = `أرسلنا رابط تأكيد إلى ${v}. البريد ما يتغيّر إلا بعد ما تضغط الرابط (وقد يوصلك تأكيد على بريدك الحالي بعد).`;
      ef.reset();
    });
  });

  const pf = el.querySelector('#pwForm');
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el.querySelector('#pwErr'), a = pf.pw1.value, b = pf.pw2.value;
    if (a.length < 8) { err.textContent = 'كلمة المرور لازم ٨ أحرف على الأقل.'; pf.pw1.focus(); return; }
    if (a !== b) { err.textContent = 'كلمتا المرور غير متطابقتين.'; pf.pw2.focus(); return; }
    err.textContent = '';
    await busy(pf.querySelector('[type=submit]'), async () => {
      try { await auth.setPassword(a); } catch (x) { err.textContent = x.message; return; }
      pf.reset(); toast('تحدّثت كلمة المرور ✓');
    });
  });

  el.querySelector('#outOthers').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox('تسجيل الخروج من الأجهزة الأخرى', 'بيطلع حسابك من كل الأجهزة والمتصفحات الثانية، وتبقى داخل هنا.', { ok: 'سجّل خروجها' }))) return;
    await busy(btn, async () => { await auth.signOut('others'); toast('سجّلنا خروج الأجهزة الأخرى ✓'); });
  };
  el.querySelector('#outHere').onclick = (e) => busy(e.currentTarget, async () => {
    await auth.signOut('local');
    setState({ session: null, user: null, profile: null, role: null, unread: 0 });
    navigate('/login', { replace: true });
  });
  el.querySelector('#delAcc').onclick = () => deleteDialog();
}

function deleteDialog() {
  const uname = state.profile.username;
  const d = dialog(html`<h2>حذف الحساب نهائياً</h2>
    <form class="stack" novalidate>
      <p>بينحذف كل شيء: ملفك وصورتك وأصدقاؤك وإنجازاتك وتصنيفك. لو عندك مباراة شغّالة بتنسحب منها. <b>ما فيه تراجع.</b></p>
      <div class="field"><label for="delConfirm">للتأكيد اكتب اسم المستخدم: <b dir="ltr">${uname}</b></label>
        <input class="input" id="delConfirm" name="c" dir="ltr" autocomplete="off" spellcheck="false" autocapitalize="off"></div>
      <p class="error" role="alert" data-err></p>
      <div class="actions" style="margin-top:0"><button type="button" class="btn" data-close>إلغاء</button><button type="submit" class="btn danger" disabled>احذف حسابي</button></div>
    </form>`, { label: 'حذف الحساب' });
  const form = d.el.querySelector('form'), sub = form.querySelector('[type=submit]');
  form.c.addEventListener('input', () => { sub.disabled = form.c.value !== uname; });
  form.c.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.c.value !== uname) return;
    const ok = await busy(sub, async () => { await game('delete_account', { confirm: form.c.value }); return true; });
    if (!ok) { sub.disabled = form.c.value !== uname; return; }
    try { await auth.signOut('local'); } catch { /* the account is already gone */ }
    d.close('deleted');
    setState({ session: null, user: null, profile: null, role: null, unread: 0 });
    toast('انحذف حسابك. الله يحييك في أي وقت.');
    navigate('/login', { replace: true });
  });
}

const PRIVACY = [
  ['privacy_online', 'من يشوف إني متصل؟', 'إذا اخترت «لا أحد» يختفي مؤشر الاتصال من ملفك وقوائم الأصدقاء.', [['everyone', 'الكل'], ['friends', 'الأصدقاء فقط'], ['nobody', 'لا أحد']]],
  ['privacy_history', 'من يشوف سجل مبارياتي؟', 'السجل يظهر في ملفك الشخصي. تفاصيل كل مباراة تبقى للاعبيها فقط.', [['everyone', 'الكل'], ['friends', 'الأصدقاء فقط'], ['nobody', 'لا أحد']]],
  ['privacy_requests', 'من يقدر يرسل لي طلب صداقة؟', 'لو قفلتها، تقدر أنت ترسل طلبات عادي.', [['everyone', 'الكل'], ['nobody', 'لا أحد']]],
  ['privacy_invites', 'من يقدر يدعوني لطاولة؟', 'الدعوات توصلك تنبيه فيه زر للدخول.', [['everyone', 'الكل'], ['friends', 'الأصدقاء فقط'], ['nobody', 'لا أحد']]],
];
function privacyTab(el) {
  const p = state.profile;
  mount(el, html`<section class="card stack" style="gap:18px" aria-labelledby="prTitle">
    <h2 id="prTitle">الخصوصية</h2>
    ${PRIVACY.map(([col, q, hint, opts]) => html`<div class="stack" style="gap:6px">
      <b id="lb-${col}">${q}</b>
      <div class="seg" role="group" aria-labelledby="lb-${col}" data-col="${col}">${opts.map(([v, t]) => html`<button type="button" data-v="${v}" aria-pressed="${p[col] === v ? 'true' : 'false'}">${t}</button>`)}</div>
      <span class="hint">${hint}</span></div>`)}
    <p class="hint">التغييرات تنحفظ مباشرة.</p>
  </section>`);
  el.querySelectorAll('.seg[data-col]').forEach((seg) => {
    seg.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.getAttribute('aria-pressed') === 'true' || seg.dataset.busy) return;
      const col = seg.dataset.col, prev = state.profile[col];
      const press = (v) => seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === v ? 'true' : 'false'));
      press(b.dataset.v); seg.dataset.busy = '1';
      try { await updateProfile({ [col]: b.dataset.v }); toast('انحفظ ✓', { ms: 1800 }); }
      catch (x) { press(prev); toastErr(x); }
      finally { delete seg.dataset.busy; }
    });
  });
}

const NOTIFY = [
  ['notify_requests', 'طلبات الصداقة', 'لما أحد يرسل لك طلب أو يقبل طلبك.'],
  ['notify_invites', 'دعوات الطاولات', 'لما صديق يدعوك لغرفة.'],
  ['notify_results', 'نتائج المباريات', 'ملخص النتيجة والتصنيف والخبرة بعد كل مباراة.'],
];
async function notifyTab(el) {
  let row;
  try { row = await select('account_private', (q) => q.select('notify_requests,notify_invites,notify_results').eq('user_id', state.user.id).maybeSingle()); }
  catch (e) { mount(el, html`<div class="empty"><b>تعذّر تحميل الإعدادات.</b><span>${e.message}</span></div>`); return; }
  if (!row) { mount(el, html`<div class="empty"><b>ما لقينا إعدادات التنبيهات لحسابك.</b><span>حدّث الصفحة وجرّب مرة ثانية.</span></div>`); return; }
  mount(el, html`<section class="card" aria-labelledby="ntTitle">
    <h2 id="ntTitle" style="margin-bottom:6px">التنبيهات</h2>
    <p class="hint" style="margin-bottom:6px">تتحكم في التنبيهات اللي توصلك داخل ديوانية.</p>
    ${NOTIFY.map(([col, t, h]) => html`<label class="switch" for="sw-${col}"><span><b>${t}</b><br><span class="hint">${h}</span></span>
      <input type="checkbox" role="switch" id="sw-${col}" data-col="${col}" ${row[col] ? 'checked' : ''} style="width:26px;height:26px;accent-color:var(--gold)"></label>`)}
  </section>`);
  el.querySelectorAll('input[data-col]').forEach((cb) => cb.addEventListener('change', async () => {
    const v = cb.checked; cb.disabled = true;
    try { await select('account_private', (q) => q.update({ [cb.dataset.col]: v }).eq('user_id', state.user.id)); toast('انحفظ ✓', { ms: 1800 }); }
    catch (x) { cb.checked = !v; toastErr(x); }
    finally { cb.disabled = false; }
  }));
}

const KIND = { table: ['الطاولة', 'equip_table'], back: ['ظهر الورق', 'equip_back'], frame: ['إطار الصورة', 'equip_frame'] };
function unlockText(u, achievements) {
  if (!u || u === 'default') return 'متاح للجميع';
  if (u.startsWith('level:')) return `يفتح عند المستوى ${Number(u.split(':')[1]).toLocaleString('ar-SA')}`;
  if (u.startsWith('achievement:')) {
    const a = achievements.find((x) => x.code === u.split(':')[1]);
    return a ? `يفتح مع وسام «${a.name}»` : 'يفتح مع وسام';
  }
  if (u === 'challenge') return 'مكافأة تحدي';
  return 'مقفل';
}
function preview(c) {
  if (c.kind === 'table') return html`<span data-table="${c.code}" aria-hidden="true" style="display:block;height:56px;border-radius:12px;background:radial-gradient(ellipse at 50% 45%, var(--felt) 0%, var(--felt-2) 100%);box-shadow:inset 0 0 0 3px var(--gold-2)"></span>`;
  if (c.kind === 'back') return html`<span data-back="${c.code}" aria-hidden="true" style="display:flex;justify-content:center"><span class="pc back" style="--cw:40px;--ch:57px;display:block"></span></span>`;
  return html`<span aria-hidden="true" style="display:flex;justify-content:center;padding:4px">${avatar({ ...state.profile, frame: c.code }, 48)}</span>`;
}
async function customTab(el) {
  let prog;
  try { prog = await rpc('my_progress'); } catch (e) { mount(el, html`<div class="empty"><b>تعذّر تحميل التخصيصات.</b><span>${e.message}</span></div>`); return; }
  const items = (prog && prog.cosmetics) || [], ach = (prog && prog.achievements) || [];
  const draw = () => {
    const p = state.profile;
    mount(el, html`${Object.entries(KIND).map(([kind, [title, col]]) => {
      const list = items.filter((c) => c.kind === kind);
      return html`<section class="card" aria-labelledby="ct-${kind}">
        <div class="section-title"><h2 id="ct-${kind}">${title}</h2><span class="small muted">${list.filter((c) => c.owned).length.toLocaleString('ar-SA')} من ${list.length.toLocaleString('ar-SA')} مفتوحة</span></div>
        ${list.length ? html`<div class="stats" role="group" aria-labelledby="ct-${kind}">${list.map((c) => {
          const on = p[col] === c.code;
          return html`<button type="button" class="stat stack" data-col="${col}" data-code="${c.code}" aria-pressed="${on ? 'true' : 'false'}" ${c.owned ? '' : 'disabled'}
            style="gap:6px;min-height:44px;color:inherit;${on ? 'border-color:var(--gold);box-shadow:0 0 0 2px var(--gold-2);' : ''}${c.owned ? '' : 'opacity:.55;cursor:not-allowed;'}">
            ${preview(c)}<span style="color:var(--text);font-weight:600">${c.name}</span>
            <span class="small">${on ? '✓ مستخدم' : c.owned ? 'اضغط للاستخدام' : '🔒 ' + unlockText(c.unlock, ach)}</span></button>`;
        })}</div>` : html`<div class="empty">ما فيه عناصر.</div>`}
      </section>`;
    })}`);
  };
  draw();
  el.onclick = async (e) => {
    const b = e.target.closest('button[data-code]');
    if (!b || b.disabled || b.getAttribute('aria-pressed') === 'true') return;
    const ok = await busy(b, async () => { await updateProfile({ [b.dataset.col]: b.dataset.code }); return true; });
    if (ok) { toast('تم التطبيق ✓', { ms: 1800 }); draw(); }
  };
}

async function peopleTab(el) {
  let req, mutes = [];
  try {
    req = await rpc('list_requests');
    const rows = await select('user_mutes', (q) => q.select('muted').eq('muter', state.user.id));
    const ids = (rows || []).map((r) => r.muted);
    if (ids.length) {
      const ps = await select('profiles', (q) => q.select('id,username,display_name,avatar_url,equip_frame').in('id', ids));
      mutes = (ps || []).map((x) => ({ ...x, display_name: x.display_name || x.username, frame: x.equip_frame }));
    }
  } catch (e) { mount(el, html`<div class="empty"><b>تعذّر التحميل.</b><span>${e.message}</span></div>`); return; }
  const blocked = (req && req.blocked) || [];
  mount(el, html`
  <section class="card stack" aria-labelledby="frTitle">
    <div class="section-title" style="margin:0"><h2 id="frTitle">الأصدقاء</h2><a class="btn small" href="/friends" data-link>إدارة الأصدقاء والطلبات ‹</a></div>
    <p class="hint">البحث عن لاعبين وطلبات الصداقة وقائمة أصدقائك في صفحة الأصدقاء.</p>
  </section>
  <section class="card" aria-labelledby="blTitle">
    <div class="section-title"><h2 id="blTitle">المحظورون</h2><span class="chip">${blocked.length.toLocaleString('ar-SA')}</span></div>
    ${blocked.length ? html`<div class="list">${blocked.map((u) => html`<div class="item"><div class="grow">${personLink(u)}</div>
      <button class="btn small" data-unblock="${u.id}">إلغاء الحظر</button></div>`)}</div>`
      : html`<div class="empty"><div class="art">🕊️</div><span>ما حظرت أحد.</span></div>`}
    <p class="hint" style="margin-top:8px">المحظور ما يقدر يرسل لك طلبات أو دعوات، وما تشوف رسائله.</p>
  </section>
  <section class="card" aria-labelledby="muTitle">
    <div class="section-title"><h2 id="muTitle">المكتومون</h2><span class="chip">${mutes.length.toLocaleString('ar-SA')}</span></div>
    ${mutes.length ? html`<div class="list">${mutes.map((u) => html`<div class="item"><div class="grow">${personLink(u)}</div>
      <button class="btn small" data-unmute="${u.id}">إلغاء الكتم</button></div>`)}</div>`
      : html`<div class="empty"><span>ما كتمت أحد. الكتم يخفي رسائل اللاعب في الدردشة عندك فقط.</span></div>`}
  </section>`);
  el.onclick = async (e) => {
    const ub = e.target.closest('button[data-unblock]'), um = e.target.closest('button[data-unmute]');
    if (ub) {
      const ok = await busy(ub, async () => { await game('unblock', { target: ub.dataset.unblock }); return true; });
      if (ok) { toast('ألغينا الحظر.'); peopleTab(el); }
    } else if (um) {
      const ok = await busy(um, async () => { await select('user_mutes', (q) => q.delete().eq('muter', state.user.id).eq('muted', um.dataset.unmute)); return true; });
      if (ok) { toast('ألغينا الكتم.'); peopleTab(el); }
    }
  };
}

function deviceTab(el) {
  const sw = (key, t, h) => html`<label class="switch" for="pf-${key}"><span><b>${t}</b>${h ? html`<br><span class="hint">${h}</span>` : ''}</span>
    <input type="checkbox" role="switch" id="pf-${key}" data-pref="${key}" ${prefs[key] ? 'checked' : ''} style="width:26px;height:26px;accent-color:var(--gold)"></label>`;
  const speeds = [['slow', 'بطيئة'], ['normal', 'عادية'], ['fast', 'سريعة']];
  mount(el, html`<section class="card" aria-labelledby="dvTitle">
    <h2 id="dvTitle" style="margin-bottom:6px">إعدادات هذا الجهاز</h2>
    <p class="hint" style="margin-bottom:6px">تنحفظ في هذا المتصفح فقط، وما تنتقل لأجهزتك الثانية.</p>
    ${sw('sound', 'الأصوات', 'أصوات الورق والتنبيهات أثناء اللعب.')}
    <div class="switch"><label for="pf-volume"><b>مستوى الصوت</b></label>
      <input type="range" id="pf-volume" min="0" max="1" step="0.05" value="${prefs.volume}" ${prefs.sound ? '' : 'disabled'} style="width:min(220px,50%);min-height:44px;accent-color:var(--gold)" aria-valuetext="${Math.round(prefs.volume * 100)}٪"></div>
    <div class="switch"><span id="spLbl"><b>سرعة الحركة</b><br><span class="hint">سرعة توزيع الورق وحركة الأكلات.</span></span>
      <div class="seg" role="group" aria-labelledby="spLbl" id="pf-speed">${speeds.map(([v, t]) => html`<button type="button" data-v="${v}" aria-pressed="${prefs.speed === v ? 'true' : 'false'}">${t}</button>`)}</div></div>
    ${sw('fourColor', 'ورق بأربعة ألوان', 'الديناري أزرق والسباتي أخضر، أوضح للتمييز.')}
    ${sw('reduceMotion', 'تقليل الحركة', 'يوقف الحركات والانتقالات.')}
  </section>`);
  el.querySelectorAll('input[data-pref]').forEach((cb) => cb.addEventListener('change', () => {
    prefs[cb.dataset.pref] = cb.checked; savePrefs();
    if (cb.dataset.pref === 'sound') el.querySelector('#pf-volume').disabled = !cb.checked;
  }));
  const vol = el.querySelector('#pf-volume');
  vol.addEventListener('input', () => { prefs.volume = Number(vol.value); vol.setAttribute('aria-valuetext', Math.round(prefs.volume * 100) + '٪'); savePrefs(); });
  el.querySelector('#pf-speed').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    prefs.speed = b.dataset.v; savePrefs();
    el.querySelectorAll('#pf-speed button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  });
}

const RENDER = { profile: profileTab, account: accountTab, privacy: privacyTab, notify: notifyTab, custom: customTab, people: peopleTab, device: deviceTab };

export async function render(main) {
  if (!state.user || !state.profile) {
    mount(main, html`<div class="empty"><b>سجّل دخولك لفتح الإعدادات.</b><a class="btn primary" href="/login?next=/settings" data-link>تسجيل الدخول</a></div>`);
    return;
  }
  const qs = new URLSearchParams(location.search).get('tab');
  let current = RENDER[qs] ? qs : 'profile';
  mount(main, html`<h1>الإعدادات</h1>
    <div class="tabs" role="tablist" aria-label="أقسام الإعدادات">${TABS.map(([id, t]) => html`<button type="button" role="tab" id="tab-${id}" data-tab="${id}" aria-controls="setPanel" aria-selected="${id === current ? 'true' : 'false'}" tabindex="${id === current ? '0' : '-1'}">${t}</button>`)}</div>
    <div id="setPanel" role="tabpanel" class="stack" style="gap:16px" aria-labelledby="tab-${current}"></div>`);
  const panel = main.querySelector('#setPanel'), tabs = main.querySelector('.tabs');
  let seq = 0;
  const show = async (id, focus = false) => {
    current = id;
    const my = ++seq;
    tabs.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    panel.setAttribute('aria-labelledby', 'tab-' + id);
    history.replaceState(null, '', id === 'profile' ? '/settings' : '/settings?tab=' + id);
    mount(panel, '<div class="loading" role="status" style="min-height:20vh"><div class="spinner"></div><span>لحظة…</span></div>');
    const holder = document.createElement('div'); holder.className = 'stack'; holder.style.gap = '16px';
    try { await RENDER[id](holder); } catch (e) { toastErr(e); }
    if (my !== seq) return; // another tab was opened meanwhile
    panel.replaceChildren(holder);
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b && b.dataset.tab !== current) show(b.dataset.tab); });
  tabs.addEventListener('keydown', (e) => {
    const ids = TABS.map((t) => t[0]); let i = ids.indexOf(current);
    // RTL: the left arrow moves to the next tab.
    if (e.key === 'ArrowLeft') i = (i + 1) % ids.length; else if (e.key === 'ArrowRight') i = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = ids.length - 1; else return;
    e.preventDefault(); show(ids[i], true);
  });
  await show(current);
  return () => { seq++; };
}

