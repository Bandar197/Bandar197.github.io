// Rules page (/rules) and the in-game rules dialog (rulesDialog, opened from the table's «القواعد» button).
// Every number in the worked examples is computed at runtime with the engine, so the page can never drift from the game.
import * as E from '../engine.js';
import { cardHTML } from '../table.js';
import { html, raw, mount, dialog, n, xpForLevel, TIERS } from '../ui.js';

const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'شريا', H: 'هاص', D: 'ديمن', C: 'سبيت' };
const RNAME = { 7: 'سبعة', 8: 'ثمانية', 9: 'تسعة', T: 'عشرة', J: 'ولد', Q: 'بنت', K: 'شايب', A: 'إكة' };
const yesNo = (y = 'نعم', no = 'لا') => (v) => (v ? y : no);

/** Arabic label, value formatter and the list of choices for every rule key (same keys as engine DEFAULT_RULES). */
export const RULE_META = [
  { key: 'target', label: 'نهاية الصكة', fmt: (v) => `${n(v)} نقطة`, choices: [101, 152, 202] },
  { key: 'secondRound', label: 'الدور الثاني (ثاني): حكم بنوع غير المكشوفة', fmt: yesNo('مسموح', 'ممنوع — إذا الكل قال بس يُعاد التوزيع'), choices: [true, false] },
  { key: 'ashkal', label: 'أشكل (للثالث والرابع في الدور الأول)', fmt: yesNo('مسموح', 'ممنوع'), choices: [true, false] },
  { key: 'ashkalOnAce', label: 'أشكل إذا كانت المكشوفة إكة', fmt: yesNo('مسموح', 'ممنوع'), choices: [true, false] },
  { key: 'mustTrumpWhenPartnerWins', label: 'إلزام القطع حتى لو خويك ماسك الأكلة', fmt: yesNo('ملزم', 'غير ملزم'), choices: [true, false] },
  { key: 'mustUndertrump', label: 'إذا ما تقدر تكبّر بالحكم', fmt: yesNo('تلعب حكم أصغر إلزاماً', 'تلعب أي ورقة'), choices: [true, false] },
  { key: 'doubling', label: 'الدبل في الحكم (دبل ← ثري ← فور ← قهوة)', fmt: yesNo('مسموح', 'ممنوع'), choices: [true, false] },
  { key: 'sunDouble', label: 'الدبل في الصن', fmt: (v) => ({ over100: 'إذا فريق المشتري فوق ١٠٠ والمدبّل ١٠٠ أو أقل', never: 'ممنوع', always: 'مسموح دائماً' }[v] || v), choices: ['over100', 'never', 'always'] },
  { key: 'doubleLock', label: 'اللعب بعد الدبل', fmt: (v) => ({ open: 'مفتوح', locked: 'مقفول — ما تبدأ بالحكم إلا إذا ما عندك غيره' }[v] || v), choices: ['open', 'locked'] },
  { key: 'tieRule', label: 'تعادل الأبناط بين المشتري والخصم', fmt: (v) => ({ split: 'كل فريق ياخذ أبناطه', buyer_loses: 'على المشتري (يخسر)', hang: 'معلّقة: نصيب المشتري ينتقل لكاسب التوزيعة الجاية' }[v] || v), choices: ['split', 'buyer_loses', 'hang'] },
  { key: 'balootSurvivesLoss', label: 'البلوت إذا خسر المشتري', fmt: yesNo('يبقى لصاحبه', 'يروح للخصم'), choices: [true, false] },
  { key: 'maxProjects', label: 'أقصى عدد مشاريع للاعب الواحد (بدون البلوت)', fmt: (v) => n(v), choices: [1, 2, 3] },
  { key: 'kabootSun', label: 'قيمة الكبوت في الصن', fmt: (v) => `${n(v)} نقطة` },
  { key: 'kabootHokm', label: 'قيمة الكبوت في الحكم', fmt: (v) => `${n(v)} نقطة` },
  { key: 'turnSeconds', label: 'وقت الدور', fmt: (v) => `${n(v)} ثانية` },
];

/** Normalised rule rows for display: [{key,label,value,isDefault}]. Used here and by views/match.js. */
export function ruleRows(rules) {
  const r = E.makeRules(rules || {});
  return RULE_META.map((m) => ({ key: m.key, label: m.label, value: m.fmt(r[m.key]), isDefault: r[m.key] === E.DEFAULT_RULES[m.key] }));
}

const fake = (type, trump) => ({ contract: type === 'hokm' ? { type, trump } : { type: 'sun' } });
const pc = (c, extra = '') => raw(cardHTML(c, extra));
/** A suit laid out high → low with each card's points under it. */
function orderRow(type, suit) {
  const G = fake(type, suit), ord = (type === 'hokm' ? E.ORD_T : E.ORD_N).slice().reverse();
  return html`<div class="rl-order" role="list">${ord.map((r) => html`<figure role="listitem" class="rl-fig">${pc(r + suit, type === 'hokm' ? 'trump' : '')}<figcaption><b>${RNAME[r]}</b><span>${n(E.pts(G, r + suit))} بنط</span></figcaption></figure>`)}</div>`;
}
const orderText = (type) => (type === 'hokm' ? E.ORD_T : E.ORD_N).slice().reverse().map((r) => RNAME[r]).join(' ← ');

const STYLE = `<style>
.rl-order{display:flex;flex-wrap:wrap;gap:8px;--cw:44px;--ch:62px}
.rl-fig{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px}
.rl-fig figcaption{display:flex;flex-direction:column;align-items:center;line-height:1.3}
.rl-fig figcaption span{color:var(--muted)}
.rl-toc{display:flex;flex-wrap:wrap;gap:8px}
.rl-toc button{min-height:44px}
.rl-sec{scroll-margin-top:72px}
.rl-sec h2{font-size:21px;margin-bottom:6px}
.rl-sec h3{font-size:17px;margin:12px 0 4px;color:var(--gold)}
.rl-sec ul,.rl-sec ol{margin:4px 0;padding-inline-start:22px;line-height:1.9}
.rl-sec p{line-height:1.9}
.rl-hand{display:flex;gap:4px;flex-wrap:wrap;--cw:40px;--ch:57px;margin:6px 0}
.rl-note{border-inline-start:3px solid var(--gold-2);padding:6px 12px;background:var(--bg-2);border-radius:8px}
.rl-def{color:var(--muted);font-size:12px}
</style>`;

/* ---------------- worked examples, computed by the engine ---------------- */
function examples() {
  const R = E.makeRules({});
  const ex = [];
  const add = (title, input, desc) => { ex.push({ title, desc, r: E.scoreHand({ rules: R, projects: null, baloot: null, ...input }), input }); };
  add('صن — المشتري كسب', { type: 'sun', buyerTeam: 0, raw: [80, 50], tricks: [5, 3] },
    'المشتري جاب ٨٠ بنط من ١٣٠، والخصم ٥٠.');
  add('حكم — المشتري كسب ومعه سرا', { type: 'hokm', buyerTeam: 0, raw: [96, 66], tricks: [5, 3], projects: { win: 0, points: [E.PROJ_POINTS.hokm.sira, 0], abnat: [20, 0] } },
    'المشتري ٩٦ بنط من ١٦٢، والخصم ٦٦، ومشروع سرا للمشتري.');
  add('حكم — المشتري خسر (الخصم معه خمسين)', { type: 'hokm', buyerTeam: 0, raw: [76, 86], tricks: [4, 4], projects: { win: 1, points: [0, E.PROJ_POINTS.hokm[50]], abnat: [0, 50] } },
    'المشتري ٧٦ والخصم ٨٦ + خمسين (تنحسب ٥٠ بنط في المقارنة) — المشتري ما تعدّى الخصم.');
  add('صن — تعادل ٦٥ مقابل ٦٥', { type: 'sun', buyerTeam: 0, raw: [65, 65], tricks: [4, 4] },
    'حسب الإعداد الافتراضي «كل فريق ياخذ أبناطه».');
  add('حكم مدبّل — المشتري كسب', { type: 'hokm', buyerTeam: 0, raw: [100, 62], tricks: [5, 3], mult: 2 },
    'دبل (×٢): الكاسب ياخذ كل نقاط التوزيعة مضروبة.');
  add('صن — كبوت للمشتري', { type: 'sun', buyerTeam: 0, raw: [130, 0], tricks: [8, 0] },
    'المشتري أخذ الأكلات الثمان كلها.');
  add('حكم — بلوت مع الخصم', { type: 'hokm', buyerTeam: 0, raw: [90, 72], tricks: [5, 3], baloot: { p: 1, shown: 2 } },
    'الخصم معه الشايب والبنت من الحكم (بلوت) — نقطتين ما تتضاعف.');
  return ex;
}
const OUTCOME = { made: 'المشتري كسب', failed: 'المشتري خسر', tie: 'تعادل', kaboot: 'كبوت للمشتري', kaboot_against: 'كبوت على المشتري' };

function convTable() {
  const sun = [64, 65, 66, 80, 85, 96, 130], hokm = [74, 75, 76, 85, 86, 96, 162];
  return html`<div class="grid two">
    <div class="scroll-x"><table class="data"><caption class="small muted" style="text-align:start">الصن (المجموع ١٣٠ ← ٢٦ نقطة)</caption>
      <thead><tr><th scope="col">الأبناط</th><th scope="col">النقاط</th><th scope="col">للخصم</th></tr></thead>
      <tbody>${sun.map((a) => html`<tr><td class="num">${n(a)}</td><td class="num"><b>${n(E.sunPoints(a))}</b></td><td class="num">${n(26 - E.sunPoints(a))}</td></tr>`)}</tbody></table></div>
    <div class="scroll-x"><table class="data"><caption class="small muted" style="text-align:start">الحكم (المجموع ١٦٢ ← ١٦ نقطة)</caption>
      <thead><tr><th scope="col">الأبناط</th><th scope="col">النقاط</th><th scope="col">للخصم</th></tr></thead>
      <tbody>${hokm.map((a) => html`<tr><td class="num">${n(a)}</td><td class="num"><b>${n(E.hokmPoints(a))}</b></td><td class="num">${n(16 - E.hokmPoints(a))}</td></tr>`)}</tbody></table></div>
  </div>`;
}

function exampleTable() {
  return html`<div class="scroll-x"><table class="data">
    <thead><tr><th scope="col">المثال</th><th scope="col">التفاصيل</th><th scope="col">النتيجة</th><th scope="col">قيد المشتري</th><th scope="col">قيد الخصم</th></tr></thead>
    <tbody>${examples().map((e) => html`<tr><td><b>${e.title}</b></td><td class="small">${e.desc}</td><td>${OUTCOME[e.r.outcome] || ''}</td>
      <td class="num"><b style="color:var(--us)">${n(e.r.fin[e.input.buyerTeam])}</b></td><td class="num"><b style="color:var(--them)">${n(e.r.fin[1 - e.input.buyerTeam])}</b></td></tr>`)}</tbody></table></div>`;
}

function projectsTable() {
  const P = E.PROJ_POINTS;
  const rows = [
    ['سرا', '٣ أوراق متتالية من نفس النوع', P.sun.sira, P.hokm.sira, ['7H', '8H', '9H']],
    ['خمسين', '٤ أوراق متتالية من نفس النوع', P.sun[50], P.hokm[50], ['TS', 'JS', 'QS', 'KS']],
    ['مية', '٥ متتالية، أو أربع شياب/بنات/أولاد/عشرات (وأربع إكك في الحكم)', P.sun[100], P.hokm[100], ['KS', 'KH', 'KC', 'KD']],
    ['أربعمية', 'أربع إكك في الصن فقط', P.sun[400], '—', ['AS', 'AH', 'AC', 'AD']],
    ['بلوت', 'الشايب والبنت من الحكم بيد واحدة (حكم فقط)', '—', 2, ['KS', 'QS']],
  ];
  return html`<div class="scroll-x"><table class="data">
    <thead><tr><th scope="col">المشروع</th><th scope="col">الشرط</th><th scope="col">مثال</th><th scope="col">صن</th><th scope="col">حكم</th></tr></thead>
    <tbody>${rows.map(([nm, d, s, h, cs]) => html`<tr><td><b>${nm}</b></td><td class="small">${d}</td><td><div class="miniproj">${cs.map((c) => pc(c))}</div></td><td class="num">${typeof s === 'number' ? n(s) : s}</td><td class="num">${typeof h === 'number' ? n(h) : h}</td></tr>`)}</tbody></table></div>`;
}

function variantsTable() {
  return html`<div class="scroll-x"><table class="data">
    <thead><tr><th scope="col">الإعداد</th><th scope="col">الافتراضي</th><th scope="col">الخيارات</th></tr></thead>
    <tbody>${RULE_META.map((m) => html`<tr><td>${m.label}</td><td><b>${m.fmt(E.DEFAULT_RULES[m.key])}</b></td>
      <td class="small">${m.choices ? m.choices.map((c) => m.fmt(c)).join(' · ') : m.key === 'turnSeconds' ? 'من ١٠ إلى ٩٠ ثانية' : 'ثابت'}</td></tr>`)}</tbody></table></div>`;
}

function levelsTable() {
  const lv = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20];
  return html`<div class="grid two">
    <div class="scroll-x"><table class="data"><thead><tr><th scope="col">المستوى</th><th scope="col">الخبرة المطلوبة</th></tr></thead>
      <tbody>${lv.map((x) => html`<tr><td class="num">${n(x)}</td><td class="num">${n(xpForLevel(x))}</td></tr>`)}</tbody></table></div>
    <div class="scroll-x"><table class="data"><thead><tr><th scope="col">الفئة</th><th scope="col">من تصنيف</th></tr></thead>
      <tbody>${TIERS.map((t) => html`<tr><td>${t.icon} ${t.name}</td><td class="num">${n(t.min)}</td></tr>`)}</tbody></table></div>
  </div>`;
}

const SECTIONS = [
  ['basics', 'الأساسيات'], ['deal', 'التوزيع والشراء'], ['order', 'ترتيب الورق والأبناط'], ['play', 'اللعب'], ['projects', 'المشاريع'],
  ['double', 'الدبل وما بعده'], ['score', 'الحساب (القيد)'], ['kaboot', 'الكبوت والحالات الخاصة'], ['end', 'نهاية الصكة'],
  ['variants', 'إعدادات المجالس'], ['time', 'سياسة الوقت والانقطاع'], ['levels', 'المستويات والخبرة'],
];

/** The disconnect / timer policy, shared by the page and the in-game dialog. */
function timePolicy(rules) {
  const t = E.makeRules(rules || {}).turnSeconds;
  return html`<ul>
    <li>وقت كل دور <b>${n(t)} ثانية</b>${rules ? '' : ' (الافتراضي، وصاحب الغرفة يقدر يغيّره)'}، ويُضاف له وقت قصير يغطّي حركات الورق على الشاشة.</li>
    <li>إذا خلص وقتك، الخادم يلعب عنك ورقة معقولة (أو يقول «بس» في الشراء) واللعب يكمل.</li>
    <li>٣ مرات متتالية بدون ما تلعب، أو انقطاع أكثر من ٣ دقائق = <b>انسحاب</b>: اللعب الآلي يكمل كرسيك، والمباراة تنحسب عليك خسارة، وفي المصنّفة ينخصم منك ١٥ نقطة تصنيف إضافية، والمنسحب ما ياخذ خبرة.</li>
    <li>إذا انقطع النت ورجعت خلال ٣ دقائق، ترجع لنفس كرسيك وورقك بدون أي خسارة.</li>
    <li>تحديث الصفحة ما يضيّع شي: الطاولة والورق والنتيجة محفوظة في الخادم.</li>
    <li>النتيجة تُسجَّل مرة وحدة فقط في الخادم، والتصنيف والخبرة ما تتكرر.</li>
  </ul>`;
}

export async function render(main) {
  const R = E.makeRules({});
  mount(main, html`${raw(STYLE)}
    <div class="section-title" style="margin:0"><h1>قواعد البلوت</h1><a class="btn small" href="/training" data-link>جرّبها في التدريب</a></div>
    <p class="muted" style="margin:0">القواعد اللي تلعب فيها ديوانية، مبنية على المتعارف عليه في المجالس السعودية وكتيّب بطولة المملكة للبلوت. كل الأرقام في الأمثلة محسوبة من محرك اللعبة نفسه.</p>
    <nav class="card rl-toc" aria-label="محتويات القواعد">${SECTIONS.map(([id, t]) => html`<button type="button" class="btn small" data-go="${id}">${t}</button>`)}</nav>

    <section class="card rl-sec" id="rl-basics" aria-labelledby="h-basics"><h2 id="h-basics">الأساسيات</h2>
      <ul>
        <li>أربعة لاعبين في فريقين: كل لاعب وخويه متقابلين. الفريق يلعب مع بعض ويحسب أكلاته مع بعض.</li>
        <li>الورق ٣٢ ورقة: من السبعة إلى الإكة في الأنواع الأربعة — شريا ${SYM.S}، هاص ${SYM.H}، سبيت ${SYM.C}، ديمن ${SYM.D}.</li>
        <li>اللعب والتوزيع والشراء يمشي لليمين (عكس عقارب الساعة).</li>
        <li>كل توزيعة لها «مشتري» يختار نوع اللعب: <b>صن</b> (بدون حكم) أو <b>حكم</b> (نوع واحد يغلب كل الأنواع).</li>
        <li>الهدف: فريق المشتري لازم يجيب أبناط (مع مشاريعه) أكثر من الخصم، وإلا تروح النقاط كلها للخصم.</li>
        <li>أول فريق يوصل <b>${n(R.target)}</b> نقطة (أو الحد اللي اختاره المجلس) يكسب الصكة.</li>
      </ul></section>

    <section class="card rl-sec" id="rl-deal" aria-labelledby="h-deal"><h2 id="h-deal">التوزيع والشراء</h2>
      <ul>
        <li>الموزّع يعطي كل لاعب ٣ أوراق ثم ورقتين (٥ أوراق)، ويكشف ورقة في النص.</li>
        <li>الشراء يبدأ من اللي على يمين الموزّع. <b>الدور الأول</b>: حكم (بنوع الورقة المكشوفة)، أو صن، أو بس. <b>أشكل</b> للثالث والرابع فقط: صن لكن الورقة المكشوفة تروح لخويك.</li>
        <li>الصن يغلب الحكم: لو أحد قال حكم، اللي بعده يقدرون يقولون صن.</li>
        <li><b>الدور الثاني</b> (إذا الكل قال بس): حكم بأي نوع غير المكشوفة، أو صن. إذا الكل قال بس مرة ثانية، يُعاد التوزيع والموزّع اللي بعده يوزّع.</li>
        <li>المشتري ياخذ الورقة المكشوفة + ورقتين، والباقين ٣ أوراق، فيصير مع كل واحد ٨ أوراق.</li>
      </ul></section>

    <section class="card rl-sec" id="rl-order" aria-labelledby="h-order"><h2 id="h-order">ترتيب الورق والأبناط</h2>
      <h3>الصن، والأنواع غير الحكم (المجموع ١٢٠ + ١٠ للأكلة الأخيرة = ١٣٠)</h3>
      ${orderRow('sun', 'H')}
      <h3>نوع الحكم (المجموع مع الأنواع الثانية ١٥٢ + ١٠ للأخيرة = ١٦٢)</h3>
      ${orderRow('hokm', 'S')}
      <p class="rl-note small">في الحكم: الولد أكبر ورقة (٢٠ بنط) ثم التسعة (١٤). الأنواع الثانية في الحكم ترتيبها مثل الصن.</p></section>

    <section class="card rl-sec" id="rl-play" aria-labelledby="h-play"><h2 id="h-play">اللعب</h2>
      <ul>
        <li>اللي على يمين الموزّع يبدأ أول أكلة، وبعدها اللي ياخذ الأكلة يبدأ اللي بعدها.</li>
        <li><b>لازم تنزل من نفس النوع</b> إذا عندك. ما عندك؟ في الصن ترمي أي ورقة.</li>
        <li>في الحكم إذا ما عندك من النوع: <b>لازم تقطع بالحكم</b> (حتى لو خويك ماسك الأكلة — حسب الإعداد الافتراضي).</li>
        <li>إذا أحد قطع قبلك: لازم <b>تكبّر</b> بحكم أعلى إذا تقدر، وإذا ما تقدر لازم تنزل حكم أصغر (الإعداد الافتراضي)، وإذا ما عندك حكم ترمي أي ورقة.</li>
        <li>إذا بدأ أحد بالحكم: لازم تنزل حكم، وأعلى من الموجود إذا تقدر.</li>
        <li>الأكلة لأكبر حكم فيها، وإذا ما فيها حكم فلأكبر ورقة من النوع اللي بدأ فيه.</li>
        <li>اللعب المقفول (إعداد): بعد الدبل في الحكم ما تبدأ أكلة بالحكم إلا إذا ما عندك غيره.</li>
      </ul></section>

    <section class="card rl-sec" id="rl-projects" aria-labelledby="h-projects"><h2 id="h-projects">المشاريع</h2>
      ${projectsTable()}
      <ul>
        <li>تُعلن المشاريع في الأكلة الأولى، وتنكشف بعد ما تخلص الأكلة الأولى.</li>
        <li><b>الفريق صاحب أكبر مشروع</b> بس ياخذ مشاريعه كلها، ومشاريع الفريق الثاني تنلغي.</li>
        <li>المقارنة: أربعمية ← مية (أربعة) ← مية (متتالية) ← خمسين ← سرا، وإذا تساووا فالأعلى ورقة، وإذا تساووا فالأقرب ليمين الموزّع.</li>
        <li>كل لاعب يحسب له مشروعين بالأكثر (الإعداد الافتراضي). المتتاليات ما تتشارك ورق، لكن الأربعة تقدر تتداخل مع متتالية.</li>
        <li><b>البلوت</b> (الشايب والبنت من الحكم) قيمته نقطتين ثابتة، ما تتضاعف ولا تنلغي بمشروع الخصم، ويُعلن مع نزول الورقة الثانية منهم.</li>
        <li>في مقارنة المشتري بالخصم، المشروع ينحسب أبناط: سرا ٢٠، خمسين ٥٠، مية ١٠٠، أربعمية ٢٠٠ (في الصن).</li>
      </ul></section>

    <section class="card rl-sec" id="rl-double" aria-labelledby="h-double"><h2 id="h-double">الدبل وما بعده</h2>
      <ul>
        <li><b>الحكم</b>: الخصم يقول <b>دبل</b> (×٢) ← المشتري يرد <b>ثري</b> (×٣) ← الخصم <b>فور</b> (×٤) ← المشتري <b>قهوة</b>: اللي يكسب التوزيعة يكسب الصكة كاملة.</li>
        <li><b>الصن</b>: دبل فقط، ومسموح إذا فريق المشتري تعدّى ١٠٠ والمدبّل ١٠٠ أو أقل (الإعداد الافتراضي).</li>
        <li>في التوزيعة المدبّلة: الكاسب ياخذ كل النقاط (٢٦ أو ١٦) مضروبة، والمشاريع تتضاعف ×٢ بالأكثر مهما ارتفع الدبل.</li>
        <li>التعادل في توزيعة مدبّلة يكون على آخر واحد رفع اللعب.</li>
      </ul></section>

    <section class="card rl-sec" id="rl-score" aria-labelledby="h-score"><h2 id="h-score">الحساب (القيد)</h2>
      <h3>تحويل الأبناط إلى نقاط</h3>
      <ul>
        <li><b>الصن</b>: الآحاد من ٠ إلى ٤ تنزل، ٥ تبقى نص (+١)، ومن ٦ إلى ٩ تطلع، ثم تنضرب ×٢. مثلاً ٦٥ ← <b>${n(E.sunPoints(65))}</b>، ٦٤ ← ${n(E.sunPoints(64))}، ٦٦ ← ${n(E.sunPoints(66))}.</li>
        <li><b>الحكم</b>: الآحاد من ٠ إلى ٥ تنزل، ومن ٦ إلى ٩ تطلع. مثلاً ٨٥ ← <b>${n(E.hokmPoints(85))}</b>، ٨٦ ← <b>${n(E.hokmPoints(86))}</b>.</li>
        <li>الفريق الثاني ياخذ الباقي من ٢٦ (صن) أو ١٦ (حكم): إذا المشتري جاب ${n(E.sunPoints(65))} في الصن، الخصم ياخذ ${n(26 - E.sunPoints(65))}.</li>
        <li>المشتري لازم <b>يتعدّى</b> الخصم في الأبناط + المشاريع، وإلا الخصم ياخذ كل النقاط وكل المشاريع.</li>
      </ul>
      ${convTable()}
      <h3>أمثلة محسوبة</h3>
      ${exampleTable()}</section>

    <section class="card rl-sec" id="rl-kaboot" aria-labelledby="h-kaboot"><h2 id="h-kaboot">الكبوت والحالات الخاصة</h2>
      <ul>
        <li><b>الكبوت</b>: فريق ياخذ الأكلات الثمان كلها = ${n(R.kabootSun)} نقطة في الصن، و${n(R.kabootHokm)} في الحكم، مع مشاريعه هو.</li>
        <li>الكبوت ممكن يكون للمشتري أو عليه.</li>
        <li><b>التعادل</b> (الإعداد الافتراضي): كل فريق ياخذ أبناطه. في بعض المجالس يكون على المشتري، أو «معلّقة»: نصيب المشتري يتعلّق ويروح لكاسب التوزيعة الجاية.</li>
        <li>البلوت يبقى لصاحبه حتى لو خسر المشتري (الإعداد الافتراضي).</li>
      </ul></section>

    <section class="card rl-sec" id="rl-end" aria-labelledby="h-end"><h2 id="h-end">نهاية الصكة</h2>
      <ul>
        <li>الصكة تنتهي لما فريق يوصل ${n(R.target)} نقطة أو أكثر (الغرف تقدر تختار ١٠١ أو ١٥٢ أو ٢٠٢).</li>
        <li>إذا الفريقين تعدّوا الحد، يكسب صاحب النقاط الأعلى. وإذا تساووا تماماً، تُلعب توزيعة إضافية.</li>
        <li>القهوة تنهي الصكة مباشرة لصالح كاسب التوزيعة.</li>
      </ul></section>

    <section class="card rl-sec" id="rl-variants" aria-labelledby="h-variants"><h2 id="h-variants">إعدادات المجالس</h2>
      <p class="muted small">صاحب الغرفة الخاصة يقدر يغيّر هذي الإعدادات قبل البداية. المباريات المصنّفة دائماً على الإعدادات الافتراضية.</p>
      ${variantsTable()}</section>

    <section class="card rl-sec" id="rl-time" aria-labelledby="h-time"><h2 id="h-time">سياسة الوقت والانقطاع</h2>${timePolicy(null)}</section>

    <section class="card rl-sec" id="rl-levels" aria-labelledby="h-levels"><h2 id="h-levels">المستويات والخبرة والتصنيف</h2>
      <ul>
        <li>المستوى <b>ن</b> يحتاج <b>٥٠ × ن × (ن − ١)</b> نقطة خبرة: المستوى ٢ = ${n(xpForLevel(2))}، المستوى ٥ = ${n(xpForLevel(5))}، المستوى ١٠ = ${n(xpForLevel(10))}.</li>
        <li>خبرة كل مباراة: <b>٣٠</b> للمشاركة + <b>٢٠</b> للفوز + <b>١٠</b> لكل كبوت يسوّيه فريقك. الإنجازات والتحديات تعطي خبرة إضافية. المنسحب ما ياخذ خبرة.</li>
        <li>التصنيف بنظام «إيلو» (K = ٣٢) ويتغيّر في المباريات المصنّفة فقط، ويبدأ كل لاعب من ١٠٠٠.</li>
        <li>الانسحاب = خسارة + خصم ١٥ نقطة إضافية. لو انسحب خويك وخسرتوا، تنقص خسارتك للنص.</li>
        <li>مباريات التدريب ضد البوتات ما تحسب في التصنيف ولا الخبرة.</li>
      </ul>
      ${levelsTable()}</section>`);

  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
    const sec = main.querySelector('#rl-' + b.dataset.go);
    if (!sec) return;
    sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const h = sec.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }));
}

/** In-game dialog: the room's rule profile plus the reminders players need most. */
export function rulesDialog(rules) {
  const r = E.makeRules(rules || {});
  const rows = ruleRows(r);
  const hokmFollow = [
    'لازم تنزل من نفس النوع إذا عندك.',
    `في الحكم إذا ما عندك من النوع: ${r.mustTrumpWhenPartnerWins ? 'لازم تقطع بالحكم حتى لو خويك ماسك الأكلة' : 'لازم تقطع بالحكم، إلا إذا خويك ماسك الأكلة'}.`,
    `إذا أحد قطع قبلك: لازم تكبّر إذا تقدر${r.mustUndertrump ? '، وإلا تنزل حكم أصغر' : '، وإلا ترمي أي ورقة'}.`,
    'إذا بدأ أحد بالحكم: تنزل حكم أعلى من الموجود إذا تقدر.',
  ];
  if (r.doubleLock === 'locked') hokmFollow.push('بعد الدبل: ما تبدأ بالحكم إلا إذا ما عندك غيره.');
  return dialog(html`${raw(STYLE)}<h2>قواعد هذي الطاولة</h2>
    <div class="scroll-x"><table class="data"><tbody>${rows.map((x) => html`<tr><td>${x.label}</td><td><b>${x.value}</b>${x.isDefault ? '' : raw(' <span class="chip warn">إعداد المجلس</span>')}</td></tr>`)}</tbody></table></div>
    <h3 style="margin-top:12px">ترتيب الورق</h3>
    <p class="small" style="margin:2px 0"><b>صن والأنواع الثانية:</b> ${orderText('sun')}</p>
    <p class="small" style="margin:2px 0"><b>الحكم:</b> ${orderText('hokm')}</p>
    <h3 style="margin-top:12px">الأبناط</h3>
    <p class="small" style="margin:2px 0">صن: إكة ١١، عشرة ١٠، شايب ٤، بنت ٣، ولد ٢. حكم: ولد ٢٠، تسعة ١٤، إكة ١١، عشرة ١٠، شايب ٤، بنت ٣. الأكلة الأخيرة +١٠.</p>
    <p class="small" style="margin:2px 0">التحويل: صن ٦٥ ← ${n(E.sunPoints(65))} · حكم ٨٦ ← ${n(E.hokmPoints(86))} · الخصم ياخذ الباقي من ٢٦ / ١٦.</p>
    <h3 style="margin-top:12px">الإلزام</h3>
    <ul class="small" style="margin:2px 0;padding-inline-start:20px;line-height:1.8">${hokmFollow.map((t) => html`<li>${t}</li>`)}</ul>
    <h3 style="margin-top:12px">الوقت والانقطاع</h3>
    <div class="small">${timePolicy(r)}</div>
    <div class="actions"><a class="btn" href="/rules" target="_blank" rel="noopener">القواعد كاملة</a><button class="btn primary" data-close autofocus>تمام</button></div>`, { label: 'قواعد الطاولة' });
}
