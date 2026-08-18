// ─────────────────────────────────────────────────────────────────────────────
// Соперник-бот для пасхалки «Дурак».
//
// БОТ ВИДИТ РОВНО ТО ЖЕ, ЧТО ЧЕЛОВЕК. На вход ему дают не позицию, а ВИД
// (viewFor из shared/durak.js) — свою руку, размеры чужих рук, стол, отбой и
// козырь. Чужих карт и колоды в этом объекте нет вовсе, поэтому подсмотреть их
// бот не может даже случайно: не «мы попросили его не жульничать», а «нечем».
// Ходы он выбирает теми же функциями (attackCards, defendCards, transferCards),
// которыми окно подсвечивает карты человеку.
//
// СЛОЖНОСТЬ — ЭТО ГЛУБИНА СЧЁТА, А НЕ ФОРА. В бильярде (shared/poolBot.js)
// уровень — это дрожь руки: там вся позиция на виду, и «слабее» может значить
// только «хуже исполняет». В картах наоборот: вся игра — про неполное знание,
// поэтому уровень тут значит, СКОЛЬКО бот из видимого выжимает.
//
//   Новичок — считает только текущую карту: бьёт всегда, чем можно, козыри не
//             бережёт (кладёт козырную шестёрку раньше некозырной десятки —
//             самая частая ошибка человека, который сел играть первый раз);
//   Любитель — знает цену козырю: не отбивается козырем от мелочи, если дешевле
//             взять, подкидывает только дешёвое и не даёт козырей в подкидку;
//   Шулер   — вдобавок СЧИТАЕТ ВЫШЕДШЕЕ. Когда колода кончилась, а игроков
//             двое, «что осталось у соперника» — это уже не догадка, а
//             вычитание: все карты, кроме отбоя, стола и своей руки. Тогда он
//             заходит с того, что соперник не побьёт.
//
// Счёт карт — не подглядывание: отбой видят все (см. шапку viewFor в durak.js),
// и окно показывает его человеку той же панелью «вышло». Разница между Шулером
// и человеком не в том, что ему больше показали, а в том, что он не забывает.
//
// Здесь МОЖНО пользоваться случайными числами (у Новичка ход не всегда лучший) —
// в отличие от самих правил, которые обязаны быть чистой функцией от позиции.
// ─────────────────────────────────────────────────────────────────────────────

import {
    attackCards, defendCards, transferCards, canTake, canPass, defenceTarget,
    beats, power, cost, isTrump, rankOf, buildDeck,
} from './durak.js';

export const EASY = 'easy';
export const NORMAL = 'normal';
export const HARD = 'hard';

export const LEVELS = [
    { id: EASY, name: 'Новичок' },
    { id: NORMAL, name: 'Любитель' },
    { id: HARD, name: 'Шулер' },
];

// НАСКОЛЬКО «НЕ ПОБЬЮТ» ВАЖНЕЕ, ЧЕМ «ДЁШЕВО» — для Шулера, который считает
// вышедшее. Двенадцать подобраны турниром бот-против-бота (тысяча партий на
// пару, стороны меняются местами): меньше — счёт почти ничего не даёт, больше —
// бот начинает заходить с тузов ради «не побьют» и остаётся с мелочью на руках.
const RISK_WEIGHT = 12;

// Надбавка за КАЖДУЮ вторую карту того же достоинства: подкинуть потом можно
// только то, что уже легло, поэтому зайти пáрой лучше, чем одиночкой.
const COPY_BONUS = 2;

// Глубина колоды, ниже которой размен «козырь на мелочь» уже не жалко: добирать
// скоро будет нечего, и придержанный козырь всё равно останется в руке.
const DEEP_DECK = 6;

// С чего Шулер считает размен грабительским: старший козырь (валет и выше)
// против некозырной мелочи (девятка и ниже).
const RICH_TRUMP = 11;
const JUNK = 9;

const cheapest = (cards, trump) =>
    cards.reduce((best, c) => (best == null || cost(c, trump) < cost(best, trump) ? c : best), null);

/**
 * Придумать ход. Возвращает то же, что присылает окно:
 * { type: 'attack' | 'defend' | 'transfer' | 'take' | 'pass', card? }.
 *
 * rng — источник случайности (по умолчанию Math.random), отдельным параметром
 * ради тестов: партия двух ботов должна повторяться ход в ход.
 */
export function pickMove(view, { level = NORMAL, rng = Math.random } = {}) {
    if (!view || view.phase !== 'play' || view.toMove !== view.seat) return null;
    const move = view.seat === view.defender
        ? defenceMove(view, level, rng)
        : attackMove(view, level, rng);
    // Последняя проверка: ход, который движок не примет, роняет партию, а
    // пасхалке падать не из-за чего. Такого быть не должно (тест «бот всегда
    // ходит легально»), но запасной ход стоит одну строчку.
    return isLegal(view, move) ? move : fallback(view);
}

// ── Защита ───────────────────────────────────────────────────────────────────

function defenceMove(view, level, rng) {
    const trump = view.trump;
    const target = view.table[defenceTarget(view)];
    const cover = defendCards(view);
    const transfers = transferCards(view);

    // ПЕРЕВОД — самый дешёвый способ не отбиваться вовсе: розыгрыш целиком
    // уезжает соседу. Отдавать за это козырь стоит только тогда, когда отбиться
    // всё равно нечем.
    if (transfers.length) {
        const card = cheapest(transfers, trump);
        const worth = level === EASY
            // Новичок переводит не думая — примерно через раз.
            ? rng() < 0.5
            : !isTrump(card, trump) || !cover.length;
        if (worth) return { type: 'transfer', card };
    }

    if (!cover.length) return { type: 'take' };

    const best = cheapest(cover, trump);
    if (shouldTake(view, level, target.a, best)) return { type: 'take' };
    return { type: 'defend', card: best };
}

/**
 * Взять, хотя есть чем отбиться.
 *
 * ПОЧТИ ВСЕГДА ЭТО ОШИБКА, и это не мнение, а результат турнира: бот, который
 * берёт «чтобы не тратить козырь», проигрывает тому, который отбивается всегда,
 * когда может (48% против 63% в тысяче партий). Взятые карты никуда не
 * деваются — их потом некуда девать, а дурак это как раз тот, у кого карты
 * остались. Поэтому Новичок и Любитель по своей воле не берут вовсе.
 *
 * Шулер берёт в одном узком случае, где размен и правда грабительский: старший
 * козырь против некозырной мелочи, пока колода ещё глубокая и добор всё вернёт.
 * Этот случай стоит ему пары процентов побед против Любителя — не больше, но и
 * не меньше.
 */
function shouldTake(view, level, attack, defence) {
    if (level !== HARD) return false;
    return view.deckLeft > DEEP_DECK
        && isTrump(defence, view.trump) && !isTrump(attack, view.trump)
        && power(defence) >= RICH_TRUMP && power(attack) <= JUNK;
}

// ── Атака и подкидывание ─────────────────────────────────────────────────────

function attackMove(view, level, rng) {
    const cards = attackCards(view);
    if (!cards.length) return canPass(view) ? { type: 'pass' } : null;
    if (!view.table.length) return { type: 'attack', card: openingCard(view, level, cards) };
    return throwIn(view, level, rng, cards);
}

/**
 * С чего заходить.
 *
 * Новичок берёт самую младшую карту по номиналу — и потому кладёт козырную
 * шестёрку вперёд некозырной десятки: это ровно та ошибка, из-за которой к
 * концовке у него не остаётся козырей. Остальные сначала выкладывают некозырную
 * мелочь и выбирают из неё по pickCard.
 */
function openingCard(view, level, cards) {
    const trump = view.trump;
    if (level === EASY) {
        return cards.reduce((best, c) => (power(c) < power(best) ? c : best), cards[0]);
    }
    const plain = cards.filter(c => !isTrump(c, trump));
    return pickCard(view, level, plain.length ? plain : cards);
}

/**
 * Какую из годных карт положить.
 *
 * Дешевле — лучше; пара одного достоинства лучше одиночки (её можно подкинуть
 * следом). У Шулера к этому добавляется ТРЕТЬЕ слагаемое — доля неизвестных
 * карт, которыми эту побьют. Неизвестные — это всё, чего он не видел: колода и
 * чужие руки вместе. Пока колода толстая, это осторожная прикидка; когда она
 * кончилась и играют двое, неизвестное — это ровно рука соперника, и «не
 * побьют» становится точным знанием.
 */
function pickCard(view, level, pool) {
    const trump = view.trump;
    const hidden = level === HARD ? unseenCards(view) : null;
    const copies = card => view.hand.filter(c => rankOf(c) === rankOf(card)).length;

    let best = pool[0];
    let bestScore = Infinity;
    for (const card of pool) {
        let score = cost(card, trump) - copies(card) * COPY_BONUS;
        if (hidden && hidden.length) {
            let over = 0;
            for (const other of hidden) if (beats(card, other, trump)) over++;
            score += (over / hidden.length) * RISK_WEIGHT;
        }
        if (score < bestScore) { bestScore = score; best = card; }
    }
    return best;
}

/**
 * Подкидывать ли и чем.
 *
 * Козыри в подкидку не идут никогда (кроме новичка, который об этом не думает):
 * защитник их либо заберёт, либо побьёт старшим козырем — в обоих случаях
 * козырь ушёл впустую. А вот всё остальное подкидывается БЕЗ ОГЛЯДКИ, и это
 * тоже результат турнира, а не вкусовщина: бот, который подкидывает всегда,
 * когда есть чем, обыгрывает осторожного (59% против 48%). Карты, ушедшие в
 * розыгрыш, либо уедут в отбой, либо достанутся защитнику, — а рука доберётся
 * из колоды; с пустой же колодой пустая рука это и есть выход из партии.
 */
function throwIn(view, level, rng, cards) {
    const trump = view.trump;
    const plain = cards.filter(c => !isTrump(c, trump));
    const pool = level === EASY ? cards : plain;
    if (!pool.length) return { type: 'pass' };

    if (level === EASY) {
        // Соперник берёт — это единственный момент, когда можно отдать даром всё
        // ненужное. Новичок этим моментом толком не пользуется: подкинет
        // сколько-то и остановится.
        const card = cheapest(pool, trump);
        return rng() < (view.taking ? 0.55 : 0.6) ? { type: 'attack', card } : { type: 'pass' };
    }
    return { type: 'attack', card: pickCard(view, level, pool) };
}

// ── Счёт карт ────────────────────────────────────────────────────────────────

/**
 * Всё, чего этот игрок ещё не видел: колода и чужие руки вместе.
 *
 * Считается вычитанием из полной колоды своей руки, отбоя, стола и козыря на
 * дне — то есть ровно по тому, что окно показывает и человеку (панель «вышло»).
 * Никакого доступа к чужим картам тут нет и быть не может: в виде (view) их
 * просто не существует.
 *
 * Когда играют двое и колода кончилась, этот список перестаёт быть прикидкой и
 * становится РУКОЙ СОПЕРНИКА карта в карту. Тем же вычитанием её знает и
 * человек, который следил за отбоем, — Шулер лишь не забывает.
 */
function unseenCards(view) {
    const seen = new Set(view.hand);
    for (const card of view.discard) seen.add(card);
    for (const pair of view.table) {
        seen.add(pair.a);
        if (pair.d != null) seen.add(pair.d);
    }
    // Козырь на дне лежит в колоде, а не в чужой руке, но он всем виден —
    // значит, и в «неизвестном» ему не место.
    if (view.down != null) seen.add(view.down);
    return buildDeck().filter(card => !seen.has(card));
}

// ── Страховка ────────────────────────────────────────────────────────────────

function isLegal(view, move) {
    if (!move) return false;
    switch (move.type) {
        case 'attack': return attackCards(view).includes(move.card);
        case 'defend': return defendCards(view).includes(move.card);
        case 'transfer': return transferCards(view).includes(move.card);
        case 'take': return canTake(view);
        case 'pass': return canPass(view);
        default: return false;
    }
}

/** Хоть какой-нибудь законный ход: партия не должна вставать из-за бота. */
function fallback(view) {
    const cover = defendCards(view);
    if (cover.length) return { type: 'defend', card: cheapest(cover, view.trump) };
    if (canTake(view)) return { type: 'take' };
    const attacks = attackCards(view);
    if (attacks.length) return { type: 'attack', card: cheapest(attacks, view.trump) };
    if (canPass(view)) return { type: 'pass' };
    return null;
}
