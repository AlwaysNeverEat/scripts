// ── Список карточек машин с «Показать ещё» ───────────────────────────────────
// Одно место на оба режима главной: свободный поиск (main.js) и «Теги»
// (tagSearch.js). Раньше и там, и там выдача жёстко резалась (20 и 60 машин), и
// отрезанное было не достать вообще ничем: у поиска оно молча пропадало, у
// тегов вместо него стояла надпись «…и ещё N — уточните теги». Уточнять при
// этом бывает нечем — у популярной модели десятки исполнений, и они отличаются
// как раз тем, ради чего человек и ищет.
//
// Поэтому список знает ВЕСЬ результат, а в разметку кладёт его страницами по
// PAGE_SIZE. Ограничение осталось (тысяча карточек разом — это подвисший на
// вводе телефон), но теперь оно не отрезает, а откладывает: кнопка внизу
// дорисовывает следующую страницу, ДОПИСЫВАЯ карточки, а не перерисовывая
// список — иначе прокрутка на каждом нажатии прыгала бы в начало.
//
// Клик слушает контейнер, а не каждая карточка: обработчиков всё равно должно
// быть столько же, сколько списков, а не столько, сколько строк.

import { carCardInner } from './carCard.js';

const PAGE_SIZE = 20;

function cardHtml(car) {
    return `<div class="car-card" data-id="${car.id}">${carCardInner(car)}</div>`;
}

// Кнопка пишет, сколько машин ещё не показано: «Показать ещё 20 из 137» — из
// этого видно и что список не кончился, и насколько он длинный. Голое
// «Показать ещё» такого не говорит, а знать глубину выдачи полезно до того, как
// решишь уточнять запрос. На последней странице остаток не дописываем: «ещё 7
// из 7» — это одно и то же число дважды.
function moreLabel(shown, total) {
    const rest = total - shown;
    const next = Math.min(PAGE_SIZE, rest);
    const restHtml = rest > next ? `<span class="car-list-rest">из ${rest}</span>` : '';
    return `Показать ещё ${next}${restHtml}`;
}

function moreHtml(shown, total) {
    return `<button type="button" class="car-list-more">${moreLabel(shown, total)}</button>`;
}

/**
 * Отрисовать выдачу в контейнер.
 * @param {HTMLElement} el — контейнер (.search-results)
 * @param {Array} cars — ВЕСЬ результат, а не первая страница
 * @param {{onPick:(id:string)=>void, empty:string}} opts
 */
export function renderCarList(el, cars, { onPick, empty }) {
    if (!cars.length) {
        el.innerHTML = `<div class="search-empty">${empty}</div>`;
        return;
    }

    let shown = Math.min(PAGE_SIZE, cars.length);
    el.innerHTML = cars.slice(0, shown).map(cardHtml).join('')
        + (shown < cars.length ? moreHtml(shown, cars.length) : '');

    el.onclick = (e) => {
        const more = e.target.closest('.car-list-more');
        if (more) {
            const next = cars.slice(shown, shown + PAGE_SIZE);
            shown += next.length;
            more.insertAdjacentHTML('beforebegin', next.map(cardHtml).join(''));
            // Саму кнопку не пересоздаём, а переподписываем: с новым элементом
            // с неё слетал бы фокус, и следующее нажатие с клавиатуры уходило в
            // никуда.
            if (shown < cars.length) more.innerHTML = moreLabel(shown, cars.length);
            else more.remove();
            return;
        }
        const card = e.target.closest('.car-card');
        if (card) onPick(card.dataset.id);
    };
}
