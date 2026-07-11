// ─────────────────────────────────────────────────────────────────────────────
// Кроппер аватарки: круглый вьюпорт, драг мышью/тачем для пана, слайдер зума.
// Чистый canvas/DOM, без сторонних библиотек (в стиле остального фронта).
//
// openAvatarCropper({ imageSrc, initialCrop }) → Promise<{ blob, crop } | null>
//   imageSrc    — URL картинки (blob: для только что выбранного файла,
//                 обычный https: URL оригинала для повторного кропа).
//   initialCrop — { x, y, zoom } с прошлого раза, чтобы редактор открылся
//                 в том же положении (просто стартовая точка, не обязателен).
//   blob        — итоговая квадратная JPEG-картинка именно того, что видно
//                 в круге (вся круглая маска на сайте — уже CSS border-radius
//                 на местах показа, самому кропперу рисовать маску не нужно).
// ─────────────────────────────────────────────────────────────────────────────

const VP_SIZE = 260;     // видимый вьюпорт кроппера, css px
const OUTPUT_SIZE = 480; // экспортируемая картинка, px
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export function openAvatarCropper({ imageSrc, initialCrop } = {}) {
    return new Promise((resolve) => {
        const old = document.getElementById('avatar-crop-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'avatar-crop-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-win modal-win-sm">
                <div class="modal-head">
                    <span>Обрезка аватарки</span>
                    <button class="btn btn-sec" id="crop-close">✕</button>
                </div>
                <div class="modal-body">
                    <div class="crop-viewport" id="crop-viewport">
                        <img id="crop-img" alt="" draggable="false"/>
                    </div>
                    <div class="crop-zoom-row">
                        <span></span>
                        <input type="range" id="crop-zoom" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.01" value="${MIN_ZOOM}"/>
                    </div>
                    <div class="crop-hint">Перетащи картинку, чтобы выбрать, как она ляжет в кружок</div>
                    <div id="crop-error" class="edit-error hidden"></div>
                    <div class="modal-actions">
                        <button class="btn btn-sec" id="crop-cancel">Отмена</button>
                        <button class="btn btn-pri" id="crop-save">Сохранить</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const img = modal.querySelector('#crop-img');
        const zoomInput = modal.querySelector('#crop-zoom');
        const errBox = modal.querySelector('#crop-error');
        const viewport = modal.querySelector('#crop-viewport');

        let naturalW = 0, naturalH = 0, baseScale = 1;
        let zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialCrop?.zoom || MIN_ZOOM));
        let x = initialCrop?.x || 0;
        let y = initialCrop?.y || 0;

        function clamp() {
            const dispW = naturalW * baseScale * zoom;
            const dispH = naturalH * baseScale * zoom;
            const maxX = Math.max(0, (dispW - VP_SIZE) / 2);
            const maxY = Math.max(0, (dispH - VP_SIZE) / 2);
            x = Math.min(maxX, Math.max(-maxX, x));
            y = Math.min(maxY, Math.max(-maxY, y));
        }

        function applyTransform() {
            const dispW = naturalW * baseScale * zoom;
            const dispH = naturalH * baseScale * zoom;
            img.style.width = dispW + 'px';
            img.style.height = dispH + 'px';
            img.style.left = (VP_SIZE / 2 - dispW / 2 + x) + 'px';
            img.style.top = (VP_SIZE / 2 - dispH / 2 + y) + 'px';
        }

        // Публичный URL из Supabase (не blob:) — нужен crossOrigin, иначе canvas
        // будет "tainted" и toBlob() откажется отдать данные.
        img.crossOrigin = 'anonymous';
        img.onerror = () => {
            errBox.textContent = 'Не удалось загрузить изображение';
            errBox.classList.remove('hidden');
        };
        img.onload = () => {
            naturalW = img.naturalWidth;
            naturalH = img.naturalHeight;
            baseScale = Math.max(VP_SIZE / naturalW, VP_SIZE / naturalH);
            clamp();
            applyTransform();
        };
        img.src = imageSrc;

        zoomInput.value = String(zoom);
        zoomInput.oninput = () => {
            zoom = parseFloat(zoomInput.value);
            clamp();
            applyTransform();
        };

        let dragging = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;
        const pointerDown = (e) => {
            if (!naturalW) return;
            dragging = true;
            const p = e.touches ? e.touches[0] : e;
            startX = p.clientX; startY = p.clientY;
            startPanX = x; startPanY = y;
            e.preventDefault();
        };
        const pointerMove = (e) => {
            if (!dragging) return;
            const p = e.touches ? e.touches[0] : e;
            x = startPanX + (p.clientX - startX);
            y = startPanY + (p.clientY - startY);
            clamp();
            applyTransform();
        };
        const pointerUp = () => { dragging = false; };

        viewport.addEventListener('mousedown', pointerDown);
        viewport.addEventListener('touchstart', pointerDown, { passive: false });
        window.addEventListener('mousemove', pointerMove);
        window.addEventListener('touchmove', pointerMove, { passive: false });
        window.addEventListener('mouseup', pointerUp);
        window.addEventListener('touchend', pointerUp);

        const finish = (result) => {
            window.removeEventListener('mousemove', pointerMove);
            window.removeEventListener('touchmove', pointerMove);
            window.removeEventListener('mouseup', pointerUp);
            window.removeEventListener('touchend', pointerUp);
            modal.remove();
            resolve(result);
        };

        modal.querySelector('.modal-backdrop').onclick = () => finish(null);
        modal.querySelector('#crop-close').onclick = () => finish(null);
        modal.querySelector('#crop-cancel').onclick = () => finish(null);

        modal.querySelector('#crop-save').onclick = () => {
            if (!naturalW) return; // картинка ещё не догрузилась
            const k = OUTPUT_SIZE / VP_SIZE;
            const dispW = naturalW * baseScale * zoom;
            const dispH = naturalH * baseScale * zoom;
            const left = VP_SIZE / 2 - dispW / 2 + x;
            const top = VP_SIZE / 2 - dispH / 2 + y;

            const canvas = document.createElement('canvas');
            canvas.width = OUTPUT_SIZE;
            canvas.height = OUTPUT_SIZE;
            const ctx = canvas.getContext('2d');
            try {
                ctx.drawImage(img, 0, 0, naturalW, naturalH, left * k, top * k, dispW * k, dispH * k);
            } catch {
                errBox.textContent = 'Не удалось обработать изображение';
                errBox.classList.remove('hidden');
                return;
            }
            canvas.toBlob((blob) => {
                if (!blob) {
                    errBox.textContent = 'Не удалось экспортировать изображение';
                    errBox.classList.remove('hidden');
                    return;
                }
                finish({ blob, crop: { x, y, zoom } });
            }, 'image/jpeg', 0.92);
        };
    });
}
