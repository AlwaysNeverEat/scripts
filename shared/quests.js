// ─────────────────────────────────────────────────────────────────────────────
// Задания: три дневных по играм-пасхалкам и одно недельное по работе.
//
// Дневные — по 25 опыта, недельное — 1000; опыт тот же, что копится от
// дубликатов в кейсах (100 опыта = гем, shared/cases.js), и попадает в кошелёк
// строкой журнала по кнопке «Забрать».
//
// Набор СВОЙ У КАЖДОГО: три разные игры, выбранные от (id аккаунта, дата МСК),
// и параметры к ним. Часть порогов считается от личного рекорда (тетрис,
// тройка, пасьянс, маджонг): «5 000 очков в тройке» новичку — подвиг, а тому,
// кто держит первую строку мини-топа, — разминка. Поэтому набор не
// пересчитывается на лету, а ЗАМОРАЖИВАЕТСЯ при первом показе (quest_sets в
// базе): побил рекорд днём — сегодняшние задания от этого не потяжелели.
//
// Засчитывает задание СЕРВЕР по журналу партий (game_results): слова — по
// ходам, которые и так идут через сервер, сапёр — по партии, которую он ведёт,
// тетрис/тройка/пасьянс/маджонг/рогалик — по присланному итогу после той же
// проверки правдоподобия, что у мини-топа, а партии с ботом в бильярде, дураке,
// морском бое и шашках — со слов браузера (сервер их не видит вовсе). Потолок
// того, что можно так накрутить, — 75 опыта в день, и большего это не стоит.
//
// DOOM в заданиях нет и не будет: про его партию сервер не знает ничего.
//
// Недельное — по работе, и сервер считает его по своим же таблицам: записи
// (record_credits, counted) или машины, добавленные в базу (car_events,
// type='added'). Цель — своё среднее за прошлые четыре недели плюс 15%, не
// ниже пола: «как обычно, но чуть больше», а не одна планка на всех.
// ─────────────────────────────────────────────────────────────────────────────

export const DAILY_XP = 25;
export const WEEKLY_XP = 1000;
export const DAILY_COUNT = 3;

// Недельное по записям выпадает только тем, кто записывает в среднем не меньше
// этого: оператору без записей цель «+15% от нуля» — это ноль.
export const WEEKLY_RECORDS_MIN_AVG = 5;
export const WEEKLY_CARS_MIN = 10;
export const WEEKLY_GROWTH = 1.15;
export const WEEKLY_HISTORY_WEEKS = 4;

export const GAMES = {
    wordle: 'Вордле',
    kontekst: 'Контекстно',
    minesweeper: 'Сапёр',
    tetris: 'Тетрис',
    troika: 'Тройка',
    solitaire: 'Пасьянс',
    mahjong: 'Маджонг',
    roguelike: 'Рогалик',
    pool: 'Бильярд',
    durak: 'Дурак',
    battleship: 'Морской бой',
    checkers: 'Шашки',
};

// Парные игры: задание там одно — выиграть, и трёх «выиграй» за день хватит на
// скуку. Поэтому в наборе из них не больше одной.
export const DUEL_GAMES = ['pool', 'durak', 'battleship', 'checkers'];

// Уровни ботов в разных играх называются по-разному (easy/normal/hard у трёх,
// rookie/club/master у шашек) — для заданий это одна шкала 0…2.
export const BOT_LEVEL = { easy: 0, normal: 1, hard: 2, rookie: 0, club: 1, master: 2 };
const BOT_NAMES = {
    pool: ['Новичок', 'Любитель', 'Катала'],
    durak: ['Новичок', 'Любитель', 'Шулер'],
    battleship: ['Юнга', 'Наводчик', 'Адмирал'],
    checkers: ['Новичок', 'Любитель', 'Мастер'],
};

// ── Время МСК ────────────────────────────────────────────────────────────────

const MSK = 3 * 3600_000;
const DAY = 24 * 3600_000;

export const mskDay = (ms) => new Date(ms + MSK).toISOString().slice(0, 10);
// Начало суток МСК в UTC-миллисекундах.
export const dayStart = (ms) => Math.floor((ms + MSK) / DAY) * DAY - MSK;
// Неделя — с понедельника (как в календаре, а не как getDay с воскресенья).
export function weekStart(ms) {
    const d = dayStart(ms);
    const wd = (new Date(d + MSK).getUTCDay() + 6) % 7;
    return d - wd * DAY;
}
export const mskWeek = (ms) => mskDay(weekStart(ms));

// ── Случайность от (аккаунт, период) ─────────────────────────────────────────
// Свой xorshift32 от FNV-хэша строки: правила общие с браузером (песочница), а
// node:crypto туда не возьмёшь. Криптостойкость не нужна — нужна одинаковость.

function hash32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0 || 1;
}

export function rngFor(seed) {
    let x = hash32(seed);
    return () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x / 0x100000000;
    };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// ── Подписи ──────────────────────────────────────────────────────────────────

export function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
}
const fmtNum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export function fmtTime(sec) {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const minutes = (m) => `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
const round = (n, step) => Math.round(n / step) * step;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ── Шаблоны дневных ──────────────────────────────────────────────────────────
//
// make(rand, best) → params; text(p) → строка; measure(p, results) →
// { done, frac, label }, где results — сегодняшние партии этой игры
// ([{ data }]). Три вида меры:
//   • count — сколько партий подошло (бар «1 / 2»);
//   • max — лучшее число за партию (бар «3 120 / 5 000»);
//   • min — лучшее время (бар тем полнее, чем ближе лучшее время к цели).

function countMeasure(need, ok) {
    return (results) => {
        const have = results.filter(r => ok(r.data || {})).length;
        return { done: have >= need, frac: Math.min(1, have / need), label: `${Math.min(have, need)} / ${need}` };
    };
}

function maxMeasure(need, metric) {
    return (results) => {
        const best = results.reduce((m, r) => Math.max(m, Number(metric(r.data || {})) || 0), 0);
        return { done: best >= need, frac: Math.min(1, best / need), label: `${fmtNum(Math.min(best, need))} / ${fmtNum(need)}` };
    };
}

function minMeasure(limitSec, ok, metric) {
    return (results) => {
        const times = results.filter(r => ok(r.data || {})).map(r => Number(metric(r.data || {}))).filter(Number.isFinite);
        if (!times.length) return { done: false, frac: 0, label: `цель ${fmtTime(limitSec)}` };
        const best = Math.min(...times);
        return {
            done: best <= limitSec,
            frac: best <= limitSec ? 1 : Math.min(0.95, limitSec / best),
            label: best <= limitSec ? `${fmtTime(best)} из ${fmtTime(limitSec)}` : `лучшее ${fmtTime(best)} · цель ${fmtTime(limitSec)}`,
        };
    };
}

const won = (d) => d.won !== false;

// Парная игра: бот уровня не ниже «Любителя» или живой соперник. Имя бота — в
// кавычках и в именительном: склонять «Каталу» и «Юнгу» по падежам в шаблоне
// значит однажды написать «у Катала».
function duelTemplate(game, text) {
    return {
        id: `${game}-win`, game,
        make: () => ({ level: 1 }),
        text: (p) => `${text}: бот «${BOT_NAMES[game][p.level]}» и сильнее или живой соперник`,
        measure: (p) => countMeasure(1, (d) => won(d) && (d.vs === 'human' || (Number(d.level) || 0) >= p.level)),
    };
}

export const TEMPLATES = [
    {
        id: 'wordle-time', game: 'wordle',
        make: (rand) => ({ min: pick(rand, [5, 10]) }),
        text: (p) => `Разгадать вордле за ${minutes(p.min)} от первой попытки`,
        measure: (p) => minMeasure(p.min * 60, won, d => d.seconds),
    },
    {
        id: 'wordle-tries', game: 'wordle',
        make: (rand) => ({ tries: pick(rand, [4, 5]) }),
        text: (p) => `Разгадать вордле не больше чем за ${p.tries} ${plural(p.tries, 'попытку', 'попытки', 'попыток')}`,
        measure: (p) => countMeasure(1, d => won(d) && d.guesses <= p.tries),
    },
    {
        id: 'kontekst-tries', game: 'kontekst',
        make: (rand) => ({ tries: pick(rand, [80, 150]) }),
        text: (p) => `Угадать слово в контекстно не больше чем за ${p.tries} попыток`,
        measure: (p) => countMeasure(1, d => won(d) && d.guesses <= p.tries),
    },
    {
        id: 'kontekst-nohint', game: 'kontekst',
        make: () => ({}),
        text: () => 'Угадать слово в контекстно без единой подсказки',
        measure: () => countMeasure(1, d => won(d) && !d.hints),
    },
    {
        id: 'minesweeper-wins', game: 'minesweeper',
        make: (rand) => ({ n: pick(rand, [1, 2]) }),
        text: (p) => p.n === 1 ? 'Выиграть партию в сапёра' : `Выиграть ${p.n} партии в сапёра`,
        measure: (p) => countMeasure(p.n, won),
    },
    {
        id: 'minesweeper-time', game: 'minesweeper',
        make: (rand) => ({ min: pick(rand, [6, 10]) }),
        text: (p) => `Выиграть в сапёра за ${minutes(p.min)}`,
        measure: (p) => minMeasure(p.min * 60, won, d => d.seconds),
    },
    {
        id: 'tetris-score', game: 'tetris',
        make: (_rand, best) => ({ score: best ? clamp(round(best * 0.5, 500), 2000, 30000) : 3000 }),
        text: (p) => `Набрать ${fmtNum(p.score)} очков в тетрисе за одну партию`,
        measure: (p) => maxMeasure(p.score, d => d.score),
    },
    {
        id: 'tetris-lines', game: 'tetris',
        make: (rand) => ({ lines: pick(rand, [20, 30]) }),
        text: (p) => `Убрать ${p.lines} линий в тетрисе за одну партию`,
        measure: (p) => maxMeasure(p.lines, d => d.lines),
    },
    {
        id: 'troika-score', game: 'troika',
        make: (_rand, best) => ({ score: best ? clamp(round(best * 0.6, 500), 2500, 40000) : 4000 }),
        text: (p) => `Собрать ${fmtNum(p.score)} очков в тройке за одну партию`,
        measure: (p) => maxMeasure(p.score, d => d.score),
    },
    {
        id: 'troika-cascade', game: 'troika',
        make: (rand) => ({ x: pick(rand, [4, 5]) }),
        text: (p) => `Довести цепочку в тройке до ×${p.x}`,
        measure: (p) => maxMeasure(p.x, d => d.cascade),
    },
    {
        id: 'solitaire-time', game: 'solitaire',
        make: (_rand, best) => ({ min: best ? clamp(Math.ceil(best * 1.6 / 60), 3, 15) : 8 }),
        text: (p) => `Разложить пасьянс за ${minutes(p.min)}`,
        measure: (p) => minMeasure(p.min * 60, won, d => d.seconds),
    },
    {
        id: 'solitaire-wins', game: 'solitaire',
        make: (rand) => ({ n: pick(rand, [1, 2]) }),
        text: (p) => p.n === 1 ? 'Разложить пасьянс' : `Разложить ${p.n} пасьянса`,
        measure: (p) => countMeasure(p.n, won),
    },
    {
        id: 'mahjong-time', game: 'mahjong',
        make: (_rand, best) => ({ min: best ? clamp(Math.ceil(best * 1.5 / 60), 4, 20) : 10 }),
        text: (p) => `Собрать маджонг за ${minutes(p.min)}`,
        measure: (p) => minMeasure(p.min * 60, won, d => d.seconds),
    },
    {
        id: 'mahjong-clean', game: 'mahjong',
        make: () => ({}),
        text: () => 'Собрать маджонг, ни разу не перемешав',
        measure: () => countMeasure(1, d => won(d) && !d.shuffles),
    },
    {
        id: 'roguelike-floor', game: 'roguelike',
        make: (rand) => ({ floor: pick(rand, [6, 9]) }),
        text: (p) => `Пройти ${p.floor} узлов за один забег в рогалике`,
        measure: (p) => maxMeasure(p.floor, d => d.floor),
    },
    {
        id: 'roguelike-elite', game: 'roguelike',
        make: () => ({}),
        text: () => 'Одолеть элитного врага в рогалике',
        measure: () => countMeasure(1, d => (Number(d.elites) || 0) + (Number(d.bosses) || 0) > 0),
    },
    duelTemplate('pool', 'Выиграть партию в бильярд'),
    duelTemplate('durak', 'Сыграть в дурака и не остаться дураком'),
    duelTemplate('battleship', 'Выиграть в морской бой'),
    duelTemplate('checkers', 'Выиграть в шашки'),
];

const byId = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));
export const templateOf = (id) => byId[id] || null;

// Личный рекорд, от которого считается порог (тот же, что в мини-топе).
// Время — в секундах, очки — очками.
export const BEST_KEYS = { tetris: 'score', troika: 'score', solitaire: 'seconds', mahjong: 'seconds' };

/**
 * Три дневных задания на (аккаунт, день). bests — личные рекорды
 * ({ tetris, troika, solitaire, mahjong }), можно пустые.
 * @returns {Array<{ slot, id, game, params, xp }>}
 */
export function pickDaily({ userId, day, bests = {} }) {
    const rand = rngFor(`daily:${userId}:${day}`);
    // Парные игры тянутся ОДНИМ билетом на четверых: иначе их треть списка, и
    // «выиграй у бота» выпадало бы почти каждый день.
    const tickets = [...Object.keys(GAMES).filter(g => !DUEL_GAMES.includes(g)), 'duel'];
    const chosen = [];
    while (chosen.length < DAILY_COUNT) {
        const t = pick(rand, tickets);
        const g = t === 'duel' ? pick(rand, DUEL_GAMES) : t;
        if (chosen.includes(g) || (t === 'duel' && chosen.some(c => DUEL_GAMES.includes(c)))) continue;
        chosen.push(g);
    }
    return chosen.map((game, slot) => {
        const t = pick(rand, TEMPLATES.filter(x => x.game === game));
        return { slot, id: t.id, game, params: t.make(rand, Number(bests[game]) || 0), xp: DAILY_XP };
    });
}

/**
 * Недельное на (аккаунт, неделя). avg — среднее за прошлые четыре недели:
 * { records, cars }. Записи — только тому, кто записывает (см. порог), и то
 * через неделю на машины: «по работе» не значит «одно и то же всегда».
 */
export function pickWeekly({ userId, week, avg = {} }) {
    const rand = rngFor(`weekly:${userId}:${week}`);
    const records = Number(avg.records) || 0;
    const cars = Number(avg.cars) || 0;
    const canRecords = records >= WEEKLY_RECORDS_MIN_AVG;
    const kind = canRecords && rand() < 0.5 ? 'records' : 'cars';
    const target = kind === 'records'
        ? Math.ceil(records * WEEKLY_GROWTH)
        : Math.max(WEEKLY_CARS_MIN, Math.ceil(cars * WEEKLY_GROWTH));
    return { slot: 0, id: `weekly-${kind}`, kind, params: { target, avg: kind === 'records' ? records : cars }, xp: WEEKLY_XP };
}

export function questText(q) {
    if (q.kind === 'records') return `Сделать ${q.params.target} ${plural(q.params.target, 'запись', 'записи', 'записей')} за неделю`;
    if (q.kind === 'cars') return `Добавить в базу ${q.params.target} ${plural(q.params.target, 'машину', 'машины', 'машин')} за неделю`;
    return templateOf(q.id)?.text(q.params || {}) || 'Задание';
}

// Почему цель такая — подпись мелким под недельным: «+15%» без числа читается
// как произвол.
export function weeklyNote(q) {
    const a = Math.round((q.params?.avg || 0) * 10) / 10;
    const rec = q.kind === 'records';
    if (!(a > 0)) return `цель для всех, у кого ${rec ? 'записей' : 'машин'} за месяц не было`;
    // Дробь по правилам — в родительном единственного («4,5 записи»,
    // «2,3 машины»), а не по последней цифре, как целое.
    const what = Number.isInteger(a) ? (rec ? plural(a, 'запись', 'записи', 'записей') : plural(a, 'машина', 'машины', 'машин')) : (rec ? 'записи' : 'машины');
    // Цель упёрлась в пол — так и пишем: «+15% от одной машины» это не десять.
    const tail = q.params.target > Math.ceil(a * WEEKLY_GROWTH) ? `цель не меньше ${q.params.target}` : 'цель на 15% больше';
    return `обычно у вас ${String(a).replace('.', ',')} ${what} в неделю — ${tail}`;
}

/** Дневное: results — сегодняшние партии ЭТОЙ игры ([{ data }]). */
export function measureDaily(q, results) {
    const t = templateOf(q.id);
    if (!t) return { done: false, frac: 0, label: '' };
    return t.measure(q.params || {})(results || []);
}

/** Недельное: counts — { records, cars } за текущую неделю. */
export function measureWeekly(q, counts) {
    const have = Number(counts?.[q.kind]) || 0;
    const need = q.params.target;
    return { done: have >= need, frac: Math.min(1, have / need), label: `${Math.min(have, need)} / ${need}` };
}

// ── Партия с ботом: что принимаем из запроса ────────────────────────────────

/** Тело POST /api/quests/report (партия с ботом) → строка журнала или null. */
export function cleanBotReport(body) {
    const game = String(body?.game || '');
    if (!DUEL_GAMES.includes(game)) return null;
    if (body?.won !== true) return null;
    const level = BOT_LEVEL[String(body?.level || '')];
    if (level == null) return null;
    return { game, data: { won: true, vs: 'bot', level } };
}

// Сколько партий с ботом в день принимается со слов браузера. Задание там
// одно — одна победа, — а потолок нужен, чтобы консоль не забила журнал.
export const BOT_REPORTS_PER_DAY = 40;
