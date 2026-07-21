// ─────────────────────────────────────────────────────────────────────────────
// Фид «Скрипты»: кнопка справа снизу на странице поиска → модалка со списком
// всех юзерскриптов. У каждой карточки ссылка-«Установить» ведёт прямо на сырой
// .user.js — Tampermonkey перехватывает переход и сам открывает экран установки.
//
// При первом клике показываем мини-гайд (нужен Tampermonkey + Developer mode в
// Chrome) с чекбоксом «не показывать больше» → флаг в localStorage. Дальше клик
// ведёт на установку сразу.
// ─────────────────────────────────────────────────────────────────────────────

import { SCRIPT_GROUPS, TAMPERMONKEY_URL } from './scriptsData.js';

const GUIDE_SEEN_KEY = 'scripts_install_guide_seen';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Иконки — только inline SVG, без эмодзи (currentColor наследует цвет текста).
const ICON_PUZZLE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5a1.5 1.5 0 0 1 3 0V5h3.5a1 1 0 0 1 1 1V9.5h1.5a1.5 1.5 0 0 1 0 3H17V16a1 1 0 0 1-1 1h-3.5v1.5a1.5 1.5 0 0 1-3 0V17H6a1 1 0 0 1-1-1v-3.5H3.5a1.5 1.5 0 0 1 0-3H5V6a1 1 0 0 1 1-1h4z"/></svg>`;
const ICON_INSTALL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`;

function cardHtml(s) {
    return `
        <div class="scr-card">
            <div class="scr-card-main">
                <div class="scr-card-head">
                    <span class="scr-card-title">${esc(s.title)}</span>
                    <span class="scr-card-ver">v${esc(s.version)}</span>
                </div>
                <p class="scr-card-desc">${esc(s.desc)}</p>
                <div class="scr-card-site">${esc(s.site)}</div>
            </div>
            <a class="btn btn-pri scr-install" href="${esc(s.url)}" target="_blank" rel="noopener"
               data-scr-url="${esc(s.url)}">${ICON_INSTALL}<span>Установить</span></a>
        </div>`;
}

function feedHtml() {
    return SCRIPT_GROUPS.map(g => `
        <section class="scr-group">
            <h3 class="scr-group-title">${esc(g.title)}</h3>
            ${g.scripts.map(cardHtml).join('')}
        </section>`).join('');
}

let bound = false;

export function initScriptsFeed() {
    const btn       = document.getElementById('btn-scripts');
    const modal     = document.getElementById('scripts-modal');
    const body      = document.getElementById('scripts-modal-body');
    const btnClose  = document.getElementById('scripts-modal-close');
    const backdrop  = document.getElementById('scripts-modal-backdrop');

    const guide       = document.getElementById('scripts-guide-modal');
    const guideBack   = document.getElementById('scripts-guide-backdrop');
    const guideClose  = document.getElementById('scripts-guide-close');
    const guideGo     = document.getElementById('scripts-guide-go');
    const guideDont   = document.getElementById('scripts-guide-dont');

    if (!btn || !modal || !guide) return;

    let pendingUrl = null;

    const openModal  = () => { modal.classList.remove('hidden'); };
    const closeModal = () => { modal.classList.add('hidden'); };

    const closeGuide = () => {
        // Уважаем «не показывать больше» даже если гайд просто закрыли.
        if (guideDont.checked) localStorage.setItem(GUIDE_SEEN_KEY, '1');
        guide.classList.add('hidden');
        pendingUrl = null;
    };

    const openGuide = (url) => {
        pendingUrl = url;
        guideDont.checked = false;
        guide.classList.remove('hidden');
    };

    if (!bound) {
        bound = true;
        body.innerHTML = feedHtml();

        btn.onclick      = openModal;
        btnClose.onclick = closeModal;
        backdrop.onclick = closeModal;

        // Перехватываем обычный клик по «Установить»: пока гайд не отмечен как
        // виденный — сначала показываем его. Middle/ctrl-клик не трогаем — пусть
        // открывается напрямую (ссылка настоящая, href на .user.js).
        body.addEventListener('click', (e) => {
            const link = e.target.closest('.scr-install');
            if (!link) return;
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (localStorage.getItem(GUIDE_SEEN_KEY)) return; // гайд уже видели — ведём напрямую
            e.preventDefault();
            openGuide(link.dataset.scrUrl);
        });

        guideBack.onclick  = closeGuide;
        guideClose.onclick = closeGuide;
        guideGo.onclick = () => {
            const url = pendingUrl;
            if (guideDont.checked) localStorage.setItem(GUIDE_SEEN_KEY, '1');
            guide.classList.add('hidden');
            pendingUrl = null;
            if (url) window.open(url, '_blank', 'noopener');
        };

        // Esc закрывает верхнюю из открытых модалок.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!guide.classList.contains('hidden')) closeGuide();
            else if (!modal.classList.contains('hidden')) closeModal();
        });
    }
}

export { TAMPERMONKEY_URL };
