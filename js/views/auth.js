// Sign in, sign up (with email confirmation), forgot password, reset password.
import { auth } from '../api.js';
import { GOOGLE_ENABLED } from '../config.js';
import { html, raw, mount, toast, busy, $ } from '../ui.js';
import { navigate } from '../router.js';
import { cardHTML } from '../table.js';

const FAN = ['AS', 'TH', 'KC', 'QD', 'JH'];
const cooldown = { until: 0 };

function shell(inner) {
  return html`<div class="auth"><div class="authcard">
    <div class="logo">ديوانية</div>
    <p class="tagline">بلوت عربي أونلاين — مع ربعك أو مع لاعبين من كل مكان</p>
    <div class="fan" aria-hidden="true">${raw(FAN.map((c, i) => `<span style="--r:${(i - 2) * 6}deg;display:inline-block">${cardHTML(c)}</span>`).join(''))}</div>
    <section class="card">${inner}</section>
    <p class="small muted" style="text-align:center"><a href="/training" data-link>جرّب التدريب ضد البوتات بدون حساب</a> · <a href="/rules" data-link>القواعد</a></p>
  </div></div>`;
}
const googleBtn = () => (GOOGLE_ENABLED ? raw(`<div class="oauth"><button class="btn" id="gBtn" type="button">الدخول بحساب Google</button></div><div class="divider">أو بالبريد</div>`) : '');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
function guardRate() {
  if (Date.now() < cooldown.until) { toast(`انتظر ${Math.ceil((cooldown.until - Date.now()) / 1000)} ثانية قبل المحاولة.`, { error: true }); return false; }
  return true;
}
function failed() { cooldown.fails = (cooldown.fails || 0) + 1; if (cooldown.fails >= 3) { cooldown.until = Date.now() + Math.min(60, 5 * 2 ** (cooldown.fails - 3)) * 1000; } }

export async function render(main) {
  const path = location.pathname;
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (path === '/login') {
    mount(main, shell(html`<h1 style="font-size:24px">تسجيل الدخول</h1>
      ${googleBtn()}
      <form id="f" class="stack" novalidate>
        <div class="field"><label for="em">البريد الإلكتروني</label><input class="input" id="em" type="email" autocomplete="email" required inputmode="email"></div>
        <div class="field"><label for="pw">كلمة المرور</label><input class="input" id="pw" type="password" autocomplete="current-password" required minlength="6"></div>
        <p class="error" id="err" role="alert"></p>
        <button class="btn primary big" type="submit">دخول</button>
      </form>
      <div class="row between small"><a href="/forgot" data-link>نسيت كلمة المرور؟</a><a href="/signup" data-link>ما عندك حساب؟ سجّل</a></div>`));
    $('#em', main).focus();
    $('#f', main).onsubmit = async (e) => {
      e.preventDefault();
      const em = $('#em', main).value, pw = $('#pw', main).value, err = $('#err', main);
      err.textContent = '';
      if (!validEmail(em)) { err.textContent = 'اكتب بريداً صحيحاً.'; return; }
      if (!guardRate()) return;
      await busy(e.submitter, async () => {
        try { await auth.signIn(em, pw); cooldown.fails = 0; const { loadProfile } = await import('../app.js'); await loadProfile(); navigate(safeNext, { replace: true }); }
        catch (x) { failed(); err.textContent = x.message; if (/أكّد بريدك/.test(x.message)) offerResend(main, em); }
      });
    };
  } else if (path === '/signup') {
    mount(main, shell(html`<h1 style="font-size:24px">حساب جديد</h1>
      ${googleBtn()}
      <form id="f" class="stack" novalidate>
        <div class="field"><label for="em">البريد الإلكتروني</label><input class="input" id="em" type="email" autocomplete="email" required inputmode="email"></div>
        <div class="field"><label for="pw">كلمة المرور</label><input class="input" id="pw" type="password" autocomplete="new-password" required minlength="8" aria-describedby="pwh"><span class="hint" id="pwh">٨ أحرف على الأقل، والأفضل تخلط حروف وأرقام.</span></div>
        <div class="field"><label for="pw2">أعد كلمة المرور</label><input class="input" id="pw2" type="password" autocomplete="new-password" required></div>
        <label class="row small"><input type="checkbox" id="agree" required> أوافق على <a href="/rules#conduct" data-link>قواعد التواصل والخصوصية</a></label>
        <p class="error" id="err" role="alert"></p>
        <button class="btn primary big" type="submit">إنشاء الحساب</button>
      </form>
      <p class="small"><a href="/login" data-link>عندك حساب؟ سجّل دخولك</a></p>`));
    $('#em', main).focus();
    $('#f', main).onsubmit = async (e) => {
      e.preventDefault();
      const em = $('#em', main).value, pw = $('#pw', main).value, pw2 = $('#pw2', main).value, err = $('#err', main);
      err.textContent = '';
      if (!validEmail(em)) { err.textContent = 'اكتب بريداً صحيحاً.'; return; }
      if (pw.length < 8) { err.textContent = 'كلمة المرور لازم ٨ أحرف على الأقل.'; return; }
      if (pw !== pw2) { err.textContent = 'كلمتا المرور مو متطابقتين.'; return; }
      if (!$('#agree', main).checked) { err.textContent = 'لازم توافق على قواعد التواصل.'; return; }
      if (!guardRate()) return;
      await busy(e.submitter, async () => {
        try {
          const r = await auth.signUp(em, pw);
          if (r.session) { navigate('/welcome', { replace: true }); return; }   // email confirmation disabled on the server
          mount(main, shell(html`<h1 style="font-size:24px">تحقق من بريدك 📬</h1>
            <p>أرسلنا رابط تأكيد إلى <b>${em}</b>. افتح الرابط من نفس الجهاز، وبعدها نكمل إعداد ملفك.</p>
            <p class="small muted">ما وصلك؟ شيّك على البريد غير المرغوب، أو أعد الإرسال بعد دقيقة.</p>
            <div class="row"><button class="btn" id="resend">إعادة الإرسال</button><a class="btn ghost" href="/login" data-link>رجوع للدخول</a></div>`));
          $('#resend', main).onclick = (ev) => busy(ev.currentTarget, async () => { await auth.resend(em); toast('أعدنا إرسال رابط التأكيد.'); });
        } catch (x) { failed(); err.textContent = x.message; }
      });
    };
  } else if (path === '/forgot') {
    mount(main, shell(html`<h1 style="font-size:24px">استعادة كلمة المرور</h1>
      <p class="muted">اكتب بريدك ونرسل لك رابط لتعيين كلمة مرور جديدة.</p>
      <form id="f" class="stack" novalidate>
        <div class="field"><label for="em">البريد الإلكتروني</label><input class="input" id="em" type="email" autocomplete="email" required></div>
        <p class="error" id="err" role="alert"></p>
        <button class="btn primary big" type="submit">أرسل الرابط</button>
      </form><p class="small"><a href="/login" data-link>رجوع للدخول</a></p>`));
    $('#f', main).onsubmit = async (e) => {
      e.preventDefault();
      const em = $('#em', main).value, err = $('#err', main); err.textContent = '';
      if (!validEmail(em)) { err.textContent = 'اكتب بريداً صحيحاً.'; return; }
      if (!guardRate()) return;
      await busy(e.submitter, async () => {
        try { await auth.forgot(em); cooldown.until = Date.now() + 60_000; mount($('.card', main), html`<h2>أرسلنا الرابط ✉️</h2><p>إذا كان البريد مسجّلاً عندنا بيوصلك رابط خلال دقائق. افتحه من هذا الجهاز.</p>`); }
        catch (x) { err.textContent = x.message; }
      });
    };
  } else if (path === '/reset') {
    const s = await auth.session();
    if (!s) {
      mount(main, shell(html`<h1 style="font-size:24px">الرابط غير صالح</h1><p>انتهت صلاحية رابط الاستعادة أو استُخدم من قبل.</p><a class="btn primary" href="/forgot" data-link>اطلب رابطاً جديداً</a>`));
      return;
    }
    mount(main, shell(html`<h1 style="font-size:24px">كلمة مرور جديدة</h1>
      <form id="f" class="stack" novalidate>
        <div class="field"><label for="pw">كلمة المرور الجديدة</label><input class="input" id="pw" type="password" autocomplete="new-password" required minlength="8"></div>
        <div class="field"><label for="pw2">أعدها</label><input class="input" id="pw2" type="password" autocomplete="new-password" required></div>
        <label class="row small"><input type="checkbox" id="others" checked> سجّل خروجي من الأجهزة الأخرى</label>
        <p class="error" id="err" role="alert"></p>
        <button class="btn primary big" type="submit">حفظ</button>
      </form>`));
    $('#f', main).onsubmit = async (e) => {
      e.preventDefault();
      const pw = $('#pw', main).value, err = $('#err', main); err.textContent = '';
      if (pw.length < 8) { err.textContent = 'كلمة المرور لازم ٨ أحرف على الأقل.'; return; }
      if (pw !== $('#pw2', main).value) { err.textContent = 'كلمتا المرور مو متطابقتين.'; return; }
      await busy(e.submitter, async () => {
        try {
          await auth.setPassword(pw);
          if ($('#others', main).checked) await auth.signOut('others').catch(() => {});
          toast('تم تغيير كلمة المرور.'); navigate('/', { replace: true });
        } catch (x) { err.textContent = x.message; }
      });
    };
  }
  const g = $('#gBtn', main);
  if (g) g.onclick = () => busy(g, () => auth.google());
}

function offerResend(main, em) {
  const err = $('#err', main);
  const b = document.createElement('button'); b.className = 'btn small'; b.type = 'button'; b.textContent = 'أعد إرسال رابط التأكيد';
  b.onclick = () => busy(b, async () => { await auth.resend(em); toast('أعدنا إرسال الرابط.'); });
  err.after(b);
}
