// Single gateway to the backend (Supabase Auth, database RPCs, the `api` game server, realtime and storage).
// Every error leaves this module as an Error with an Arabic message.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const MESSAGES = {
  // auth
  'Invalid login credentials': 'البريد أو كلمة المرور غير صحيحة.',
  'Email not confirmed': 'أكّد بريدك أولاً من الرابط اللي وصلك.',
  'User already registered': 'هذا البريد مسجّل من قبل. جرّب تسجيل الدخول أو استعادة كلمة المرور.',
  'Password should be at least 6 characters.': 'كلمة المرور لازم ٨ أحرف على الأقل.',
  'over_email_send_rate_limit': 'طلبات كثيرة على البريد. انتظر دقيقة وجرّب.',
  'over_request_rate_limit': 'محاولات كثيرة. انتظر شوي وجرّب مرة ثانية.',
  'email_address_invalid': 'البريد الإلكتروني غير صحيح.',
  'weak_password': 'كلمة المرور ضعيفة. استخدم ٨ أحرف أو أكثر مع أرقام.',
  'same_password': 'كلمة المرور الجديدة مثل القديمة.',
  'session_not_found': 'انتهت الجلسة. سجّل دخولك من جديد.',
  // profile and social
  bad_username: 'اسم المستخدم من ٣ إلى ١٤ حرفاً (عربي أو إنجليزي أو أرقام أو _) بدون مسافات.',
  username_taken: 'اسم المستخدم مأخوذ، اختر غيره.',
  username_change_cooldown: 'تقدر تغيّر اسم المستخدم مرة كل ٧ أيام.',
  bad_display_name: 'الاسم الظاهر من حرف إلى ٢٤ حرفاً.',
  bad_avatar: 'الصورة غير صالحة. ارفعها من جديد.',
  not_unlocked: 'هذا التخصيص ما فتحته للحين.',
  self: 'ما تقدر تسويها مع نفسك.',
  not_found: 'ما لقينا المطلوب.',
  bad_target: 'اللاعب المطلوب غير صالح.',
  blocked: 'ما يمكن التواصل مع هذا اللاعب.',
  already_friends: 'أنتم أصدقاء من قبل.',
  already_pending: 'أرسلت له طلب من قبل، انتظر رده.',
  requests_closed: 'هذا اللاعب قافل طلبات الصداقة.',
  invites_closed: 'هذا اللاعب ما يستقبل دعوات منك.',
  rate_limited: 'طلبات كثيرة. انتظر شوي وجرّب.',
  not_member: 'أنت مو عضو في هذي الغرفة.',
  room_closed: 'الغرفة مقفلة.',
  // chat and reports
  chat_off: 'الدردشة مقفلة في هذي الغرفة.',
  quick_only: 'في هذي الغرفة العبارات السريعة فقط.',
  slow_down: 'هدّ اللعب شوي 😅 رسائلك كثيرة.',
  bad_message: 'الرسالة فاضية أو طويلة.',
  bad_reason: 'اختر سبب البلاغ.',
  banned: 'حسابك موقوف مؤقتاً.',
  // rooms and play
  room_not_found: 'ما لقينا غرفة بهذا الكود.',
  room_private: 'هذي الغرفة خاصة بلاعبيها.',
  not_waiting: 'المباراة بدأت أو انتهت.',
  seat_taken: 'الكرسي محجوز. اختر كرسي ثاني.',
  bad_seat: 'الكرسي غير صحيح.',
  not_seated: 'لازم تجلس على كرسي أول.',
  owner_only: 'هذا الإجراء لصاحب الغرفة فقط.',
  need_four: 'لازم يكتمل أربعة لاعبين.',
  not_all_ready: 'لازم كل اللاعبين يضغطون «جاهز».',
  duplicate_player: 'نفس الحساب ما يجلس على كرسيين.',
  player_banned: 'أحد اللاعبين موقوف.',
  not_playing: 'ما فيه مباراة شغّالة.',
  seat_abandoned: 'انسحبت من هذي المباراة، وما تقدر ترجع لها.',
  illegal_move: 'هذي الحركة غير مسموحة.',
  already_playing: 'عندك مباراة شغّالة. كمّلها أول.',
  match_running: 'ما تقدر تقفل الغرفة والمباراة شغّالة.',
  use_matchmaking: 'المباريات العامة تبدأ من «العب الآن».',
  not_finished: 'المباراة ما خلصت.',
  busy: 'الطاولة مشغولة لحظة، جرّب مرة ثانية.',
  confirm_mismatch: 'اكتب اسم المستخدم بالضبط للتأكيد.',
  forbidden: 'ما عندك صلاحية لهذا الإجراء.',
  reason_required: 'اكتب سبباً واضحاً.',
  no_profile: 'كمّل إعداد ملفك أولاً.',
  not_signed_in: 'سجّل دخولك أولاً.',
  server_error: 'صار خطأ في الخادم. جرّب مرة ثانية.',
};
export function arabic(err) {
  if (!err) return 'صار خطأ غير متوقع.';
  const raw = typeof err === 'string' ? err : err.code || err.error_code || err.message || '';
  for (const k of Object.keys(MESSAGES)) if (raw === k || (typeof raw === 'string' && raw.includes(k))) return MESSAGES[k];
  if (/fetch|network|Failed to fetch|NetworkError/i.test(String(raw))) return 'تعذّر الاتصال. تأكد من الإنترنت وجرّب.';
  if (/rate limit/i.test(String(raw))) return MESSAGES.rate_limited;
  return 'صار خطأ. جرّب مرة ثانية.';
}
const fail = (e) => { const x = new Error(arabic(e)); x.code = e && (e.code || e.message); return x; };

export const sb = window.__fakeSupabase || (window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  realtime: { params: { eventsPerSecond: 20 } },
}) : null);
export const online = () => !!sb;
export const siteUrl = (path = '/') => location.origin + path;

/* ---------- auth ---------- */
export const auth = {
  async session() { const { data } = await sb.auth.getSession(); return data.session; },
  onChange(cb) { return sb.auth.onAuthStateChange((ev, s) => cb(ev, s)); },
  async signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: siteUrl('/welcome') } });
    if (error) throw fail(error);
    return data;
  },
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw fail(error);
  },
  async google() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: siteUrl('/') } });
    if (error) throw fail(error);
  },
  async resend(email) { const { error } = await sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: siteUrl('/welcome') } }); if (error) throw fail(error); },
  async forgot(email) { const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: siteUrl('/reset') }); if (error) throw fail(error); },
  async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw fail(error); },
  async changeEmail(email) { const { error } = await sb.auth.updateUser({ email: email.trim() }, { emailRedirectTo: siteUrl('/settings') }); if (error) throw fail(error); },
  async signOut(scope = 'local') { const { error } = await sb.auth.signOut({ scope }); if (error) throw fail(error); },
  async user() { const { data } = await sb.auth.getUser(); return data.user; },
};

/* ---------- database RPCs (validated in SQL) ---------- */
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw fail(error);
  return data;
}
export async function select(table, build) {
  const { data, error } = await build(sb.from(table));
  if (error) throw fail(error);
  return data;
}

/* ---------- game server ---------- */
export async function game(action, body = {}) {
  const { data, error } = await sb.functions.invoke('api', { body: { action, ...body } });
  if (error) {
    let code = 'server_error';
    try { const j = await error.context.json(); if (j && j.error) code = j.error; } catch { /* not json */ }
    throw fail({ code });
  }
  return data;
}

/* ---------- realtime ---------- */
export function channel(name, opts) { return opts ? sb.channel(name, opts) : sb.channel(name); }
export function removeChannel(ch) { try { sb.removeChannel(ch); } catch { /* already removed */ } }

/* ---------- storage ---------- */
export async function uploadAvatar(uid, blob) {
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)) throw new Error('نوع الصورة غير مدعوم.');
  if (blob.size > 1024 * 1024) throw new Error('حجم الصورة أكبر من ١ ميغابايت.');
  const path = `${uid}/avatar.webp`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '60' });
  if (error) throw fail(error);
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
