// ─────────────────────────────────────────────────────────────────────────────
// Карточка «Сервер» в нижнем левом углу главной: сколько сайту осталось жить.
// Данные — /api/server/balance (бэкенд ходит в Рег.облако сам, см.
// backend/src/regcloud/balance.js).
//
// Карточку видит КАЖДЫЙ вошедший, а не только модератор: сайт живёт на
// предоплаченном облачном счёте, и когда он кончится, ляжет всё сразу — и
// записи, и калькулятор, и CRM-панель.
//
// Главное и САМОЕ КРУПНОЕ здесь — СРОК. Рубли на счёте человеку, который за
// сервер не платит, не говорят ничего: «134,18 ₽» — это не хорошо и не плохо,
// пока не посчитаешь в уме расход. «2 дня» — это сразу понятно. Поэтому сумма
// ушла в мелкую строку под полосой, а на её месте стоит время.
//
// Полоса — ТОЖЕ ПРО ВРЕМЯ, а не про деньги: она пустеет вместе с запасом (две
// недели — полная, сегодня — пустая). Сначала она показывала доли расхода по
// ресурсам, красиво и бесполезно: на что уходят деньги, интересно ровно одному
// человеку в конторе, а «сколько осталось» — всем.
//
// Из чего складывается расход, карточка всё же помнит — в подсказке у строки с
// суммой: место это не занимает, а вопрос «почему так быстро тает» иногда
// возникает.
//
// Форма (метка с иконкой, чип, крупное значение, полоса-капсула) взята у
// готовой карточки статистики uiverse, но материал наш: стекло главной (те же
// --glass-*, что у строки поиска), наши ступени скруглений и отступов,
// системный шрифт.
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

function levelOf(days) {
    if (days == null) return 'ok';
    if (days <= DAYS_ALARM) return 'alarm';
    if (days <= DAYS_WARN) return 'warn';
    return 'ok';
}

// Срок разбит на ЧИСЛО и ЕДИНИЦУ: число стоит крупно (его и читают), единица
// рядом мелко. Меньше двух суток считаем часами — «0 дней» это не срок, а
// ошибка отображения.
function lifeParts({ hoursLeft, daysLeft }) {
    if (hoursLeft == null) return { big: '∞', unit: 'не тратится' };
    if (hoursLeft <= 0) return { big: '0', unit: 'деньги кончились' };
    if (hoursLeft < 48) return { big: String(hoursLeft), unit: plural(hoursLeft, ['час', 'часа', 'часов']) };
    const days = daysLeft ?? Math.floor(hoursLeft / 24);
    return { big: String(days), unit: plural(days, ['день', 'дня', 'дней']) };
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

// Шкала полосы — две недели. Не месяц: на месячной шкале разница между двумя
// днями и четырьмя не видна вовсе, а она тут и решает.
const SCALE_DAYS = 14;

// Подсказка к строке с суммой: на что уходит расход. В самой карточке этому
// места нет, а знать иногда полезно.
function costTitle(items, hourly) {
    const rows = (Array.isArray(items) ? items : []).filter(it => it.hourly > 0);
    const lines = rows.map(it => `${it.label || it.name || it.kind}: ${fmt(it.hourly)} ₽/час`);
    return [`Расход ${fmt(hourly)} ₽/час`, ...lines].join('\n');
}

export function serverCardHtml(data) {
    const level = levelOf(data.daysLeft);
    const life = lifeParts(data);
    const out = runsOutLabel(data);
    // Полоса пустеет вместе с запасом. Минимум в пару процентов оставлен
    // нарочно: полоса, стёртая в ноль, читается как «полосы нет», а не как
    // «времени нет» — а времени как раз нет.
    const fill = data.hoursLeft == null
        ? 100
        : Math.max(2, Math.min(100, Math.round((data.hoursLeft / 24) / SCALE_DAYS * 100)));

    return `
        <article class="srv-card srv-${level}">
            <header class="srv-card__head">
                <span class="srv-card__label">${serverIcon(13)}Сервер</span>
                <span class="srv-card__range">${data.stale
                    ? esc('на ' + new Date(data.checkedAt).toLocaleTimeString('ru-RU',
                        { hour: '2-digit', minute: '2-digit' }))
                    : 'Рег.облако'}</span>
            </header>

            <div class="srv-card__life">
                ${data.hoursLeft == null ? '' : trendDownIcon(12)}
                <span class="srv-card__big">${esc(life.big)}</span>
                <span class="srv-card__unit">${esc(life.unit)}</span>
            </div>

            <div class="srv-card__bar" aria-hidden="true"><span style="width:${fill}%"></span></div>

            <div class="srv-card__sub" title="${esc(costTitle(data.items, data.hourly))}">
                ${esc(fmt(data.balance))} ₽${out ? ' · ' + esc(out) : ''}
            </div>
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
