// ─────────────────────────────────────────────────────────────────────────────
// Хэллоуинский паучок: паутина в левом нижнем углу, на ней паук, который
// иногда сам говорит что-нибудь хэллоуинское (а по клику — сразу). Сезон и
// пак фраз — shared/halloween.js.
//
// Правила, чтобы украшение не стало помехой:
//   • угол и паутина клики НЕ ловят (pointer-events: none) — под ними
//     остаётся рабочий сайт; ловят только сам паук и крестик;
//   • говорит редко (раз в 1–2 минуты) и только на видимой вкладке — фраза,
//     прочитанная в пустоту свёрнутого окна, просто тратится;
//   • крестик ПРЯЧЕТ паучка, но не насовсем: в углу остаётся маленькая
//     паутинка, клик по ней возвращает его. Первая версия убирала «до
//     следующего Хэллоуина» без возврата — люди не знали, что это навсегда,
//     нажали из любопытства и расстроились. Со 3 ноября он уходит сам;
//   • на узком экране его нет: на телефоне угол — это часть контента;
//   • prefers-reduced-motion — паук не качается, фразы остаются.
// Все картинки — SVG вёрсткой, эмодзи нет (см. правило про значки в CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────

import './halloween.css';
import { isHalloweenSeason, phraseDeck } from '../../shared/halloween.js';

// Спрятан ли паук — на устройстве. Ключ НОВЫЙ сознательно: старый
// (`zm_halloween_off`) значил «до следующего года», и у тех, кто тогда нажал
// крестик, паук должен вернуться сам — старый ключ просто стираем.
const HIDE_KEY = 'zm_halloween_hidden';
const OLD_OFF_KEY = 'zm_halloween_off';
const BYE = 'Ладно, спрячусь. Соскучишься — кликни по паутинке в углу.';
const HELLO = 'Я вернулся! Скучали?';
const FIRST_DELAY_MS = 20 * 1000;
const MIN_GAP_MS = 60 * 1000;
const MAX_GAP_MS = 120 * 1000;
const BUBBLE_MS = 6500;

// Паутина в углу: лучи из угла и провисшие дуги между ними. Угол — (0, S).
function webSvg(S = 150) {
    const rays = 7;
    const angles = Array.from({ length: rays }, (_, i) => (Math.PI / 2) * (i / (rays - 1)));
    const pt = (r, a) => [r * Math.cos(a), S - r * Math.sin(a)];
    let d = '';
    for (const a of angles) {
        const [x, y] = pt(S, a);
        d += `M0 ${S} L${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    for (const r of [26, 50, 76, 102, 128]) {
        for (let i = 0; i < rays - 1; i++) {
            const [x1, y1] = pt(r, angles[i]);
            const [x2, y2] = pt(r, angles[i + 1]);
            // Провисание к углу: нить между лучами не натянута струной.
            const am = (angles[i] + angles[i + 1]) / 2;
            const [cx, cy] = pt(r * 0.86, am);
            d += `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `;
        }
    }
    return `<svg class="hw-web" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" aria-hidden="true"><path d="${d}"/></svg>`;
}

// Паук: брюшко, голова, восемь лап и глаза. Нить вверх — он на ней качается.
const SPIDER = `
<svg viewBox="0 0 60 70" width="44" height="52" aria-hidden="true">
  <line class="hw-silk" x1="30" y1="0" x2="30" y2="26"/>
  <g class="hw-legs">
    <path d="M24 38 Q12 30 6 22"/><path d="M23 42 Q10 40 3 36"/>
    <path d="M23 46 Q11 50 5 58"/><path d="M25 49 Q16 58 13 67"/>
    <path d="M36 38 Q48 30 54 22"/><path d="M37 42 Q50 40 57 36"/>
    <path d="M37 46 Q49 50 55 58"/><path d="M35 49 Q44 58 47 67"/>
  </g>
  <ellipse class="hw-body" cx="30" cy="46" rx="10" ry="12"/>
  <circle class="hw-body" cx="30" cy="31" r="7"/>
  <circle class="hw-eye" cx="27" cy="30" r="1.8"/><circle class="hw-eye" cx="33" cy="30" r="1.8"/>
  <path class="hw-mark" d="M30 40 l-3 5 3 5 3 -5z"/>
</svg>`;

let mounted = null; // вход после выхода зовёт нас снова — паук нужен один

export function initHalloween({ now = () => new Date() } = {}) {
    if (mounted && mounted.isConnected) return mounted;
    if (!isHalloweenSeason(now())) return null;
    let hidden = false;
    try {
        localStorage.removeItem(OLD_OFF_KEY);
        hidden = localStorage.getItem(HIDE_KEY) === '1';
    } catch { /* приватный режим — паук просто виден */ }

    const root = document.createElement('div');
    root.className = 'hw';
    root.innerHTML = `
        ${webSvg()}
        <button type="button" class="hw-spider" aria-label="Паучок — нажми, он что-нибудь скажет">${SPIDER}</button>
        <div class="hw-bubble" role="status" aria-live="polite"></div>
        <button type="button" class="hw-off" title="Спрятать паучка — вернуть можно кликом по паутинке" aria-label="Спрятать паучка">×</button>
        <button type="button" class="hw-mini" title="Вернуть паучка" aria-label="Вернуть паучка">${webSvg(36)}</button>`;
    document.body.appendChild(root);
    mounted = root;

    const spider = root.querySelector('.hw-spider');
    const bubble = root.querySelector('.hw-bubble');
    const nextPhrase = phraseDeck();
    let hideTimer = null;
    let talkTimer = null;

    function say() {
        bubble.textContent = nextPhrase();
        root.classList.add('hw-talking');
        spider.classList.remove('hw-wiggle');
        void spider.offsetWidth; // перезапуск анимации на повторный клик
        spider.classList.add('hw-wiggle');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => root.classList.remove('hw-talking'), BUBBLE_MS);
    }

    function schedule(delay = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS)) {
        clearTimeout(talkTimer);
        talkTimer = setTimeout(() => {
            if (!document.hidden) say();
            schedule();
        }, delay);
    }

    function sayText(text) {
        bubble.textContent = text;
        root.classList.add('hw-talking');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => root.classList.remove('hw-talking'), BUBBLE_MS);
    }

    function setHidden(on) {
        try { if (on) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch { /* до перезагрузки */ }
        root.classList.toggle('hw-hidden', on);
        if (on) clearTimeout(talkTimer); else schedule();
    }

    spider.addEventListener('click', () => { say(); schedule(); });
    // Прячется не молча: прощается и говорит, как вернуть, — и только потом
    // уходит, оставив в углу паутинку.
    root.querySelector('.hw-off').addEventListener('click', () => {
        clearTimeout(talkTimer);
        sayText(BYE);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { root.classList.remove('hw-talking'); setHidden(true); }, 2600);
    });
    root.querySelector('.hw-mini').addEventListener('click', () => {
        setHidden(false);
        sayText(HELLO);
    });

    if (hidden) root.classList.add('hw-hidden');
    else schedule(FIRST_DELAY_MS);
    return root;
}
