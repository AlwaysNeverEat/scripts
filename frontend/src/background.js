// ── Фон главной: сфера или трубы ─────────────────────────────────────────────
// Ручка живёт в профиле, в том же разделе «Оформление», что и акцент, и по тем
// же правилам: выбор лежит в localStorage, то есть НА УСТРОЙСТВЕ, а не в
// аккаунте. Это оформление рабочего места, а не настройка человека: за одним
// компьютером сидят по очереди, и таскать чужие трубы по всем машинам смены
// незачем.
//
// ИНЛАЙНОВОГО СКРИПТА В <head>, КАК У ТЕМЫ И АКЦЕНТА, ЗДЕСЬ НЕТ — и это не
// забывчивость. Тема и акцент красят саму страницу, поэтому обязаны встать до
// первого кадра, иначе сайт вспыхивает чужим цветом. Фон рисует канвас, он
// прозрачный, а под ним в обеих заставках один и тот же --search-bg: мигать
// нечему, и ради выбора фона городить третий скрипт в шапке не стоит.

export const BG_KEY = 'cars_db_bg';
export const DEFAULT_BG = 'sphere';

// Порядок здесь — это порядок кнопок в переключателе.
export const BACKGROUNDS = [
    { id: 'sphere', name: 'Сфера' },
    { id: 'pipes', name: 'Трубы' },
];

const known = (v) => BACKGROUNDS.some(b => b.id === v);

export function storedBackground() {
    try {
        const v = localStorage.getItem(BG_KEY);
        return known(v) ? v : null;
    } catch { return null; }
}

// Текущий выбор помним на <html>, как тему: так его видит и CSS, и вторая
// вкладка после storage-события, и не приходится лезть в localStorage на
// каждый чих.
export function currentBackground() {
    const v = document.documentElement.dataset.bg;
    return known(v) ? v : (storedBackground() || DEFAULT_BG);
}

// Единственная точка, где фон меняется. Само переключение канвасов делает
// main.js по событию: заставки грузятся по требованию (трубы — отдельным
// чанком, как игры-пасхалки), и знать про них здесь незачем.
export function applyBackground(id, { persist = true } = {}) {
    const next = known(id) ? id : DEFAULT_BG;
    document.documentElement.dataset.bg = next;

    if (persist) {
        try { localStorage.setItem(BG_KEY, next); } catch { /* приватный режим */ }
    }

    syncButtons(next);
    document.dispatchEvent(new CustomEvent('bgchange', { detail: { bg: next } }));
    return next;
}

function syncButtons(id) {
    document.querySelectorAll('[data-bg-choice]').forEach(btn => {
        const on = btn.dataset.bgChoice === id;
        // .active переключаем именно классом: за ним следит segmented.js, и
        // пилюля едет сама — так же, как у режимов поиска и дат в записях.
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

export function initBackground() {
    const bg = currentBackground();
    document.documentElement.dataset.bg = bg;
    syncButtons(bg);

    // Сайт открыт в двух вкладках — выбор в одной подхватывается в другой
    // (localStorage шлёт storage только в «чужие» вкладки).
    window.addEventListener('storage', (e) => {
        if (e.key !== BG_KEY) return;
        const next = known(e.newValue) ? e.newValue : DEFAULT_BG;
        if (next !== currentBackground()) applyBackground(next, { persist: false });
    });

    return bg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Сам переключатель. Это обычная капсула с едущей пилюлей (segmented.js) —
// такая же, как «Поиск / Теги / Клиент» на главной: выбор из двух взаимно
// исключающих пунктов на сайте выглядит одинаково, где бы он ни стоял.
// ─────────────────────────────────────────────────────────────────────────────

export function backgroundPickerHtml() {
    const cur = currentBackground();
    const chips = BACKGROUNDS.map(b => `
        <button type="button" class="chip${b.id === cur ? ' active' : ''}"
                data-bg-choice="${b.id}" aria-pressed="${b.id === cur ? 'true' : 'false'}">${b.name}</button>`).join('');
    return `
        <div class="bg-picker">
            <div class="bg-picker-row">
                <span class="bg-picker-label">Фон главной</span>
                <div class="bg-picker-seg" data-seg="bg">${chips}</div>
            </div>
            <div class="accent-note">
                Сфера — машины из базы, трубы — та самая заставка из Windows.
                Пространство под ними красит тема: тёмное ночью, светлое днём.
            </div>
        </div>`;
}

export function bindBackgroundPicker(root = document) {
    const box = root.querySelector?.('.bg-picker');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-bg-choice]');
        if (btn) applyBackground(btn.dataset.bgChoice);
    });
}
