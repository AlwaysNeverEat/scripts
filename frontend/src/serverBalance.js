// ─────────────────────────────────────────────────────────────────────────────
// Карточка «Сервер» в левом углу главной: сколько денег на облачном счёте
// Рег.облака и на сколько их хватит. Данные — /api/server/balance (бэкенд
// ходит в облако сам, см. backend/src/regcloud/balance.js).
//
// Карточку видит КАЖДЫЙ вошедший, а не только модератор: кончившийся счёт
// кладёт сайт у всех сразу — и записи, и калькулятор, и CRM-панель.
//
// Главное в ней — СРОК, а не сумма: «134,18 ₽» тому, кто за сервер не платит,
// не говорит ничего, а «хватит на 2 дня» говорит. Поэтому сумма стоит крупно
// (её ищут глазами), а строкой ниже — то, ради чего карточка вообще есть.
//
// Форма взята у готовой карточки статистики (uiverse), но материал наш:
// стекло главной вместо белой плашки, шкала скруглений и отступов проекта
// вместо своих чисел, системный шрифт вместо Inter. Полоса под значением у
// образца показывала доли выручки — здесь она показывает, из чего складывается
// расход: сам сервер, его адрес, бэкапы.
//
// Токена в .env нет (машина разработчика, чужая копия) — карточки просто нет.
// Пустая карточка с прочерками читалась бы как поломка.
// ─────────────────────────────────────────────────────────────────────────────

import { serverIcon, trendDownIcon } from './icons.js';
import { plural } from './profileLayout.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmt = (n, digits = 2) => new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(Number(n) || 0);

// Порог тревоги — в ДНЯХ, а не в рублях: пополнить счёт можно за минуту, а вот
// заметить, что пора, нужно заранее. Три дня — «займись сегодня», неделя —
// «на этой неделе». Цвет здесь не украшение, поэтому и берётся не из акцента:
// тон акцента пользователь крутит сам (accent.js), а «денег на два дня»
// обязано выглядеть тревожно при любом его выборе.
const DAYS_ALARM = 3;
const DAYS_WARN  = 7;

// В полосе и легенде помещается три ресурса; всё остальное схлопывается в
// «прочее» штриховкой. У нас их сейчас два, но снэпшоты и бэкапы заводятся
// одним кликом в панели облака, и список туда приезжает сам.
const MAX_PARTS = 3;

function levelOf(days) {
    if (days == null) return 'ok';
    if (days <= DAYS_ALARM) return 'alarm';
    if (days <= DAYS_WARN) return 'warn';
    return 'ok';
}

// «Хватит на 2 дня». Меньше двух суток считаем часами: «0 дней» — это не срок,
// а ошибка отображения.
function lifeLabel({ hoursLeft, daysLeft }) {
    if (hoursLeft == null) return 'Расхода нет — счёт не тратится';
    if (hoursLeft <= 0) return 'Деньги кончились';
    if (hoursLeft < 48) return `Хватит на ${hoursLeft} ${plural(hoursLeft, ['час', 'часа', 'часов'])}`;
    const days = daysLeft ?? Math.floor(hoursLeft / 24);
    return `Хватит на ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
}

// Дату конца считаем от МОМЕНТА ЗАМЕРА, а не от «сейчас»: ответ живёт в кэше
// бэкенда до пяти минут, и от «сейчас» дата ползала бы между заходами.
function runsOutLabel({ checkedAt, hoursLeft }) {
    if (!hoursLeft) return '';
    const base = Date.parse(checkedAt);
    if (!Number.isFinite(base)) return '';
    const end = new Date(base + hoursLeft * 3600_000);
    return 'до ' + end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Доли расхода. Считаем от суммы САМИХ СТРОК, а не от общего hourly: строки —
// это то, что нарисовано, и полоса, не сходящаяся со своей же легендой,
// выглядит ошибкой.
function parts(items) {
    const rows = (Array.isArray(items) ? items : []).filter(it => it.hourly > 0);
    if (!rows.length) return [];
    rows.sort((a, b) => b.hourly - a.hourly);

    // В легенде стоит ТИП ресурса («Сервер», «Плавающий IP»), а не имя машины:
    // имя своё есть только у сервера, и «Cars DB» рядом с «Cars DB» (бэкап того
    // же сервера) не различает строки, а путает их. Имя добавляется ровно там,
    // где типы совпали, а полная подпись всегда лежит в подсказке.
    const kinds = rows.slice(0, MAX_PARTS).map(it => it.kind || 'Ресурс');
    const head = rows.slice(0, MAX_PARTS).map((it, i) => {
        const kind = kinds[i];
        const twice = kinds.filter(k => k === kind).length > 1;
        return {
            name: (twice && it.name ? `${kind} ${it.name}` : kind),
            title: it.label || it.name || '',
            hourly: it.hourly,
        };
    });
    const restSum = rows.slice(MAX_PARTS).reduce((s, it) => s + it.hourly, 0);
    if (restSum > 0) head.push({ name: 'Прочее', title: '', hourly: restSum, rest: true });
    return head;
}

export function serverCardHtml(data) {
    const level = levelOf(data.daysLeft);
    const out = runsOutLabel(data);
    const seg = parts(data.items);

    return `
        <article class="srv-card srv-${level}">
            <header class="srv-card__head">
                <span class="srv-card__label">${serverIcon(14)}Сервер</span>
                <span class="srv-card__range">${data.stale
                    ? esc('на ' + new Date(data.checkedAt).toLocaleTimeString('ru-RU',
                        { hour: '2-digit', minute: '2-digit' }))
                    : 'Рег.облако'}</span>
            </header>

            <div class="srv-card__value">${esc(fmt(data.balance))}<span class="srv-card__currency">₽</span></div>

            <div class="srv-card__delta">
                ${data.hoursLeft == null ? '' : trendDownIcon(12)}
                <span>${esc(lifeLabel(data))}${out ? ' · ' + esc(out) : ''}</span>
            </div>

            ${seg.length ? `
            <div class="srv-card__bar" aria-hidden="true">
                ${seg.map((p, i) => `<span class="srv-seg-${p.rest ? 'rest' : i + 1}"
                    style="flex:${p.hourly.toFixed(5)}"></span>`).join('')}
            </div>
            <footer class="srv-card__legend">
                ${seg.map((p, i) => `<span title="${esc(p.title)}">
                    <i class="srv-seg-${p.rest ? 'rest' : i + 1}"></i>${esc(p.name)}</span>`).join('')}
            </footer>` : ''}
        </article>`;
}

// Обновляемся не чаще, чем живёт кэш бэкенда: чаще — значит ходить к своему же
// серверу за тем же самым ответом.
const REFRESH_MS = 5 * 60 * 1000;

// Карточка висит на главной, а главная открыта часами. Обновляем её по таймеру,
// но только когда вкладку реально смотрят: на спящей вкладке цифра никому не
// нужна, а браузер всё равно душит таймеры фона.
export function initServerCard({ apiFetch }) {
    const box = document.getElementById('server-card');
    if (!box) return;

    let last = 0;
    let dead = false;

    async function load() {
        if (dead) return;
        last = Date.now();
        let data;
        try {
            data = await apiFetch('/api/server/balance');
        } catch {
            // Свой бэкенд не ответил — молчим и пробуем в следующий раз:
            // карточка справочная, и сообщение об ошибке поверх сферы на
            // главной пугало бы сильнее, чем стоит эта цифра.
            return;
        }
        if (!data?.configured) { dead = true; box.classList.add('hidden'); return; }
        box.innerHTML = serverCardHtml(data);
        box.classList.remove('hidden');
    }

    load();
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - last < REFRESH_MS) return;
        load();
    }, 60_000);
    // Вернулись на вкладку после долгого отсутствия — цифра обязана быть
    // свежей сразу, а не через минуту тика.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - last >= REFRESH_MS) load();
    });
}
