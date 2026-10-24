// Opens a crop dialog for a picked image file and resolves with a 256×256 WebP/JPEG blob (or null if cancelled).
import { html, dialog } from '../ui.js';
import { createCropper, loadImage } from './settings.js';

export async function cropToBlob(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('اختر صورة PNG أو JPG أو WebP.');
  const img = await loadImage(file);
  const d = dialog(html`<h2>قص الصورة</h2>
    <p class="small muted">اسحب الصورة لتحريكها واستخدم الشريط للتكبير.</p>
    <canvas id="cc" width="320" height="320" tabindex="0" aria-label="معاينة القص" style="width:min(320px,100%);aspect-ratio:1;border-radius:16px;touch-action:none;display:block;margin:0 auto"></canvas>
    <label class="field"><span class="lbl">التكبير</span><input id="cz" type="range" min="1" max="4" step="0.01" value="1"></label>
    <div class="actions"><button class="btn" data-close="cancel">إلغاء</button><button class="btn primary" id="cok">اعتماد</button></div>`, { label: 'قص الصورة' });
  const cropper = createCropper(d.el.querySelector('#cc'), d.el.querySelector('#cz'));
  cropper.load(img);
  let blob = null;
  d.el.querySelector('#cok').onclick = async () => { blob = await cropper.export(); d.close('ok'); };
  const v = await d.done;
  return v === 'ok' ? blob : null;
}
