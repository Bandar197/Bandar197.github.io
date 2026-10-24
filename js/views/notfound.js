import { html, mount } from '../ui.js';
export function render(main) {
  mount(main, html`<div class="empty" style="min-height:50vh"><div class="art">🂠</div><b>الصفحة غير موجودة</b><span>يمكن الرابط قديم أو فيه خطأ.</span><a class="btn primary" href="/" data-link>الرئيسية</a></div>`);
}
