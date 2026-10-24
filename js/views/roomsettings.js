// Room settings dialog (create a room / owner edits before anyone is ready). Every option maps to engine.makeRules().
import * as E from '../engine.js';
import { html, raw, dialog } from '../ui.js';
import { RULE_META } from './rules.js';

const CHAT = [['open', 'مفتوحة (كتابة + عبارات)'], ['quick', 'عبارات سريعة فقط'], ['off', 'مقفلة']];
const KIND = [['private', 'خاصة بالكود والدعوة'], ['public', 'عامة تظهر في قائمة الغرف']];
const TURN = [20, 30, 45, 60];

export async function roomSettingsDialog({ rules = {}, chat_mode = 'open', kind = 'private', title = 'إعدادات الغرفة', okLabel = 'حفظ' } = {}) {
  const r = E.makeRules(rules);
  const seg = (name, opts, cur) => raw(`<div class="seg" role="group" data-name="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${String(v)}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</div>`);
  const rows = RULE_META.filter((m) => m.choices).map((m) => html`<div class="field"><span class="lbl">${m.label}</span>${seg(m.key, m.choices.map((c) => [c, m.fmt(c)]), r[m.key])}</div>`);
  const d = dialog(html`<h2>${title}</h2>
    <div class="stack">
      <div class="field"><span class="lbl">نوع الغرفة</span>${seg('kind', KIND, kind)}</div>
      <div class="field"><span class="lbl">الدردشة</span>${seg('chat_mode', CHAT, chat_mode)}</div>
      <div class="field"><span class="lbl">وقت الدور</span>${seg('turnSeconds', TURN.map((t) => [t, t + ' ثانية']), r.turnSeconds)}</div>
      <details><summary class="btn ghost small">قواعد المجلس (اختياري)</summary><div class="stack" style="margin-top:10px">${rows}</div></details>
      <p class="small muted">القواعد تثبت للمباراة كاملة بعد البداية، وتظهر لكل اللاعبين قبل الاستعداد.</p>
    </div>
    <div class="actions"><button class="btn" data-close="cancel">إلغاء</button><button class="btn primary" data-close="ok">${okLabel}</button></div>`, { label: title });
  d.el.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button'); if (!b) return;
    for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b));
  });
  const v = await d.done;
  if (v !== 'ok') return null;
  const pick = (name) => { const b = d.el.querySelector(`.seg[data-name="${name}"] button[aria-pressed="true"]`); return b ? b.dataset.v : null; };
  const out = { ...r };
  for (const m of RULE_META) {
    const s = pick(m.key); if (s == null) continue;
    out[m.key] = typeof r[m.key] === 'number' ? Number(s) : typeof r[m.key] === 'boolean' ? s === 'true' : s;
  }
  out.turnSeconds = Number(pick('turnSeconds') || r.turnSeconds);
  return { rules: E.makeRules(out), chat_mode: pick('chat_mode') || chat_mode, kind: pick('kind') || kind };
}
