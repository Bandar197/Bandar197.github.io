// First sign-in: choose username, display name and picture.
import { rpc, uploadAvatar, auth } from '../api.js';
import { html, mount, avatar, busy, toast, $ } from '../ui.js';
import { state, setState } from '../state.js';
import { navigate } from '../router.js';
import { cropToBlob } from './avatarcrop.js';

export async function render(main) {
  if (!state.session) { navigate('/login', { replace: true }); return; }
  if (state.profile) { navigate('/', { replace: true }); return; }
  let avatarUrl = null, step = 1;
  const meta = (state.user && state.user.user_metadata) || {};
  const suggested = (meta.full_name || meta.name || (state.user.email || '').split('@')[0] || '').slice(0, 24);

  const paint = () => mount(main, html`<div class="auth"><div class="authcard">
    <div class="logo">ديوانية</div>
    <p class="tagline">حيّاك! خلّنا نجهّز ملفك — ${step} من ٣</p>
    <div class="bar" aria-hidden="true"><i style="width:${step * 33.4}%"></i></div>
    <section class="card stack" id="box"></section>
    <button class="btn ghost small" id="out" type="button">تسجيل الخروج</button>
  </div></div>`);
  paint();
  $('#out', main).onclick = () => auth.signOut('local').then(() => navigate('/login'));
  const box = () => $('#box', main);
  let data = { username: '', display: suggested };

  function s1() {
    mount(box(), html`<h1 style="font-size:22px">اختر اسم المستخدم</h1>
      <p class="muted">هو رابط ملفك ويعرفك فيه الناس: <span dir="ltr">/u/<b id="pv">${data.username || 'اسمك'}</b></span></p>
      <div class="field"><label for="un">اسم المستخدم</label><input class="input" id="un" maxlength="14" autocomplete="username" value="${data.username}" aria-describedby="unh"><span class="hint" id="unh">٣–١٤ حرفاً عربي أو إنجليزي أو أرقام أو _ بدون مسافات. تقدر تغيّره لاحقاً مرة كل ٧ أيام.</span></div>
      <p class="error" id="err" role="status"></p>
      <button class="btn primary big" id="nx">التالي</button>`);
    const un = $('#un', main), err = $('#err', main);
    let t = null;
    un.oninput = () => {
      $('#pv', main).textContent = un.value || 'اسمك'; err.textContent = ''; err.className = 'error';
      clearTimeout(t);
      t = setTimeout(async () => {
        const v = un.value.trim(); if (!v) return;
        if (!/^[A-Za-z0-9_ء-ي٠-٩]{3,14}$/u.test(v)) { err.textContent = 'الاسم غير صالح.'; return; }
        const ok = await rpc('username_available', { p_username: v }).catch(() => null);
        if (ok === false) err.textContent = 'مأخوذ، جرّب اسماً ثانياً.'; else if (ok) { err.textContent = 'متاح ✓'; err.className = 'ok small'; }
      }, 350);
    };
    un.focus();
    $('#nx', main).onclick = () => { const v = un.value.trim(); if (!/^[A-Za-z0-9_ء-ي٠-٩]{3,14}$/u.test(v)) { err.textContent = 'الاسم غير صالح.'; return; } data.username = v; step = 2; paint(); s2(); };
  }
  function s2() {
    mount(box(), html`<h1 style="font-size:22px">الاسم الظاهر</h1><p class="muted">هذا اللي يشوفه الناس على الطاولة.</p>
      <div class="field"><label for="dn">الاسم الظاهر</label><input class="input" id="dn" maxlength="24" value="${data.display}"></div>
      <p class="error" id="err" role="alert"></p>
      <div class="row between"><button class="btn ghost" id="bk">رجوع</button><button class="btn primary big" id="nx">التالي</button></div>`);
    $('#dn', main).focus();
    $('#bk', main).onclick = () => { step = 1; paint(); s1(); };
    $('#nx', main).onclick = () => { const v = $('#dn', main).value.trim(); if (v.length < 1 || v.length > 24) { $('#err', main).textContent = 'اكتب اسماً من حرف إلى ٢٤ حرفاً.'; return; } data.display = v; step = 3; paint(); s3(); };
  }
  function s3() {
    mount(box(), html`<h1 style="font-size:22px">الصورة الشخصية</h1><p class="muted">اختيارية — تقدر تضيفها أو تغيّرها بعدين.</p>
      <div class="row" style="justify-content:center" id="prev">${avatar({ display_name: data.display, avatar_url: avatarUrl }, 96)}</div>
      <label class="btn" for="file">اختر صورة</label><input id="file" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only">
      <p class="error" id="err" role="alert"></p>
      <div class="row between"><button class="btn ghost" id="bk">رجوع</button><button class="btn primary big" id="done">ابدأ</button></div>`);
    $('#bk', main).onclick = () => { step = 2; paint(); s2(); };
    $('#file', main).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { $('#err', main).textContent = 'الصورة أكبر من ٥ ميغابايت.'; return; }
      const blob = await cropToBlob(f).catch((x) => { $('#err', main).textContent = x.message; return null; });
      if (!blob) return;
      await busy($('#done', main), async () => { avatarUrl = await uploadAvatar(state.user.id, blob); mount($('#prev', main), html`${avatar({ avatar_url: avatarUrl }, 96)}`); });
    };
    $('#done', main).onclick = (ev) => busy(ev.currentTarget, async () => {
      try {
        await rpc('complete_onboarding', { p_username: data.username, p_display: data.display, p_avatar_url: avatarUrl });
      } catch (x) {
        if (/مأخوذ/.test(x.message)) { step = 1; paint(); s1(); }
        throw x;
      }
      const { loadProfile } = await import('../app.js'); await loadProfile();
      setState({});
      toast(`أهلاً ${data.display}! 🎉`);
      navigate('/', { replace: true });
    });
  }
  s1();
}
