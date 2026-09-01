// ─────────────────────────────────────────────────────────────────────────────
// Баланс облачного счёта Рег.облака: сколько денег осталось и на сколько их
// хватит при нынешнем расходе.
//
// Считать «сколько серверу осталось жить» самим не нужно: Рег.облако отдаёт
// готовые hours_left/days_left вместе с балансом и почасовой ценой одним
// запросом — GET https://api.cloudvps.reg.ru/v1/balance_data.
// Документация: https://developers.cloudvps.reg.ru/billing/balance.html
//
// ТОКЕН ЖИВЁТ ТОЛЬКО ЗДЕСЬ. Он не «ключ к балансу», а ключ ко ВСЕМУ облаку:
// тем же токеном создают и удаляют серверы. Поэтому браузер ходит на наш
// /api/server/balance, а не в Рег.облако напрямую — иначе ключ от
// инфраструктуры оказался бы вшит в сборку сайта, то есть у каждого, кто
// откроет исходники страницы.
//
// Наружу отдаём РАЗОБРАННЫЙ ответ, а не чужой JSON как есть: в нём лежат ещё
// и id ресурсов, и туда в любой момент могут добавить полей, о которых мы
// ничего не знаем.
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = 'https://api.cloudvps.reg.ru/v1/balance_data';

// Панель видна всем вошедшим, а баланс меняется на два рубля в час: чаще раза
// в пять минут спрашивать облако незачем, сколько бы человек ни открыло сайт.
const TTL_MS = 5 * 60 * 1000;

// Облако молчит — показываем последнее известное значение с пометкой: цифра
// пятиминутной давности честнее прочерка на её месте. Но не вечно — снимок
// суточной давности уже ничего не говорит про «сколько осталось».
const STALE_MAX_MS = 24 * 60 * 60 * 1000;

// Своё имя сервера в CRM-шном ответе есть только у самого сервера; у бэкапа,
// плавающего IP и сети имени нет вовсе — там осмысленно только «что это».
const TYPE_LABELS = {
    reglet:          'Сервер',
    backup:          'Бэкап',
    snapshot:        'Снэпшот',
    floating_ip:     'Плавающий IP',
    private_network: 'Приватная сеть',
    dbaas:           'Кластер БД',
};

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function itemLabel(row) {
    const kind = TYPE_LABELS[row?.type] || String(row?.type || 'Ресурс');
    const name = String(row?.name || '').trim();
    return name ? `${kind} — ${name}` : kind;
}

// Детализация приходит деревом: у сервера в linked висят его бэкапы и
// снэпшоты. В панели нужен плоский список строк «что — почём», поэтому дерево
// разворачиваем, а вложенным строкам приписываем имя их сервера: «Бэкап»
// без уточнения, чей он, в списке из трёх серверов бесполезен.
function flatten(rows, parentName = '') {
    const out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const name = String(row?.name || '').trim() || parentName;
        out.push({
            label: itemLabel({ ...row, name }),
            hourly: num(row?.price),
            monthly: num(row?.price_month),
        });
        out.push(...flatten(row?.linked, name));
    }
    return out;
}

export function parseBalanceData(payload) {
    const d = payload?.balance_data || {};
    const balance = num(d.balance);
    const hourly = num(d.hourly_cost);

    // hours_left облако считает само, но при нулевом расходе (все серверы
    // выключены и удалены) поля может не быть вовсе — тогда и срока нет:
    // деньги не кончатся никогда, а не «кончатся сегодня».
    const hoursLeft = Number.isFinite(Number(d.hours_left))
        ? Number(d.hours_left)
        : (hourly > 0 ? Math.floor((balance + num(d.bonus_balance)) / hourly) : null);

    return {
        balance,
        bonus: num(d.bonus_balance),
        hourly,
        monthly: num(d.monthly_cost),
        hoursLeft,
        daysLeft: Number.isFinite(Number(d.days_left))
            ? Number(d.days_left)
            : (hoursLeft == null ? null : Math.floor(hoursLeft / 24)),
        items: flatten(d.detalization),
    };
}

let cache = null; // { at, value }

export function isConfigured() {
    return !!process.env.REG_CLOUD_TOKEN;
}

async function request(signal) {
    const res = await fetch(API_URL, {
        headers: {
            Authorization: `Bearer ${process.env.REG_CLOUD_TOKEN}`,
            'Content-Type': 'application/json',
        },
        signal,
    });
    if (!res.ok) {
        // 401 отделяем от остального: это не «облако прилегло», а протухший
        // или отозванный токен — лечится не ожиданием, а правкой .env.
        const err = new Error(res.status === 401
            ? 'Рег.облако не приняло токен — проверь REG_CLOUD_TOKEN'
            : `Рег.облако ответило ${res.status}`);
        err.code = res.status === 401 ? 'token' : 'upstream';
        throw err;
    }
    return parseBalanceData(await res.json());
}

// fetchImpl — для тестов: живого Рег.облака в node --test нет.
export async function getBalance({ now = Date.now(), fetchImpl } = {}) {
    if (!isConfigured()) {
        const err = new Error('токен Рег.облака не настроен');
        err.code = 'not_configured';
        throw err;
    }
    if (cache && now - cache.at < TTL_MS) {
        return { ...cache.value, checkedAt: new Date(cache.at).toISOString(), stale: false };
    }
    try {
        const value = fetchImpl
            ? parseBalanceData(await fetchImpl())
            // Восемь секунд: страница профиля ждёт эту панель, и висеть на
            // чужом API дольше, чем человек готов смотреть на «Загрузка…»,
            // бессмысленно — покажем прошлый снимок.
            : await request(AbortSignal.timeout(8000));
        cache = { at: now, value };
        return { ...value, checkedAt: new Date(now).toISOString(), stale: false };
    } catch (err) {
        if (cache && now - cache.at < STALE_MAX_MS) {
            return { ...cache.value, checkedAt: new Date(cache.at).toISOString(), stale: true };
        }
        throw err;
    }
}

// Только для тестов: кэш живёт в модуле, и без сброса второй тест видит
// ответ первого.
export function resetCache() {
    cache = null;
}
