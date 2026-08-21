// ─────────────────────────────────────────────────────────────────────────────
// Соперник-бот для пасхалки «Морской бой».
//
// БОТ ВИДИТ РОВНО ТО ЖЕ, ЧТО ЧЕЛОВЕК. На вход ему дают не позицию, а ВИД
// (viewFor из shared/battleship.js) — свой флот, свои выстрелы по чужому полю и
// потопленные чужие корабли. Чужой расстановки в этом объекте нет вовсе, поэтому
// подсмотреть её бот не может даже случайно: не «мы попросили его не жульничать»,
// а «нечем». Живые чужие длины он считает той же функцией enemyLeft, которой
// окно рисует человеку панель «осталось».
//
// СЛОЖНОСТЬ — ЭТО ГЛУБИНА СЧЁТА, А НЕ ФОРА. В бильярде (shared/poolBot.js)
// уровень — это дрожь руки: там вся позиция на виду, и «слабее» может значить
// только «хуже исполняет». Здесь, как и в дураке, вся игра про неполное знание,
// поэтому уровень значит, СКОЛЬКО бот из видимого выжимает:
//
//   Юнга     — стреляет наугад, попал — тычет в соседнюю клетку. Ровно так
//              играет человек, севший за поле первый раз;
//   Наводчик — охотится ПО ЧЁТНОСТИ (мимо клеток, куда самый мелкий живой
//              корабль всё равно не влезет) и добивает найденный ЛИНИЕЙ, а не
//              тычет вокруг: два попадания подряд задают направление;
//   Адмирал  — считает, СКОЛЬКО РАССТАНОВОК проходит через каждую клетку.
//              Перебирает все места, куда ещё может встать каждый живой
//              корабль, и стреляет туда, где таких мест больше всего. Раненый
//              корабль он добивает тем же перебором — просто места, не
//              накрывающие рану, в счёт не идут.
//
// Всё, чем Адмирал отличается от человека, — он не забывает. Каждый вывод, на
// котором он стоит, человеку доступен ровно так же: корабли не касаются
// бортами, потопленные обведены водой, живые длины написаны на панели.
//
// ГЛАВНОЕ ПРАВИЛО ПЕРЕБОРА: расстановка, которая КАСАЕТСЯ раненой клетки, но не
// накрывает её, — незаконна. Корабли не соприкасаются, значит, две клетки рядом
// с попаданием либо один корабль, либо ошибка. Именно из этого правила Адмирал
// и достраивает линию, а не из отдельной ветки «а теперь добиваем».
//
// РАССТАНОВКУ бот делает случайную на всех уровнях, и это не лень. Своё поле —
// единственное, чего соперник не видит совсем, и равномерно случайный флот
// против незнакомого соперника ничем не хуже «умного»: любая осмысленная схема
// («по краям», «в углу») — это узор, который живой человек запоминает с третьей
// партии и после этого обыгрывает Адмирала быстрее Юнги.
//
// Здесь МОЖНО пользоваться случайными числами (у Юнги выстрел почти всегда
// случайный) — в отличие от самих правил, которые обязаны быть чистой функцией
// от позиции.
// ─────────────────────────────────────────────────────────────────────────────

import {
    SIZE, CELLS, NONE, HIT, ACROSS, DOWN,
    xOf, yOf, cellAt, onBoard, shipAt, shipCells, around,
    enemyLeft, woundedCells, randomFleet,
} from './battleship.js';

export const EASY = 'easy';
export const NORMAL = 'normal';
export const HARD = 'hard';

export const LEVELS = [
    { id: EASY, name: 'Юнга' },
    { id: NORMAL, name: 'Наводчик' },
    { id: HARD, name: 'Адмирал' },
];

// ВО СКОЛЬКО РАЗ МЕСТО, НАКРЫВАЮЩЕЕ РАНУ, ВАЖНЕЕ ПРОСТО ЧАСТОГО. Двенадцать
// подобраны прогоном бота по тысяче случайных флотов: меньше — Адмирал бросает
// недобитый корабль ради «статистически хорошей» клетки на другом конце поля,
// больше — разницы уже нет, раненый и так перевешивает всё.
const WOUND_WEIGHT = 12;

/**
 * Флот бота. Случайный на всех уровнях — почему именно так, см. шапку.
 * rng передают, чтобы партия целиком воспроизводилась по зерну.
 */
export function pickFleet({ rng = Math.random } = {}) {
    return randomFleet(rng);
}

/**
 * Куда стрелять. На вход — ВИД бота (то же, что видит человек), на выходе —
 * номер клетки чужого поля.
 *
 * Возвращает -1, если стрелять некуда: такого в живой партии не бывает (она
 * кончается раньше), но вернуть «наугад» на пустом поле нельзя — окно выстрелит
 * в уже отстрелянную клетку и получит отказ.
 */
export function pickShot(view, { level = NORMAL, rng = Math.random } = {}) {
    const open = [];
    for (let c = 0; c < CELLS; c++) if (view.outgoing[c] === NONE) open.push(c);
    if (!open.length) return -1;

    const wounded = woundedCells(view);
    const lens = enemyLeft(view);
    // Живых кораблей нет — партия кончена, но отвечать чем-то надо.
    if (!lens.length) return pick(open, rng);

    if (level === HARD) {
        const best = byDensity(view, open, wounded, lens);
        if (best.length) return pick(best, rng);
    }

    if (wounded.length) {
        const shots = level === EASY ? aroundWound(view, wounded) : alongWound(view, wounded);
        if (shots.length) return pick(shots, rng);
    }

    if (level === EASY) return pick(open, rng);

    const step = huntStep(lens);
    const parity = open.filter(c => (xOf(c) + yOf(c)) % step === 0);
    return pick(parity.length ? parity : open, rng);
}

/**
 * Шаг сетки, по которой Наводчик ищет.
 *
 * Корабль длины L обязательно накрывает хотя бы одну клетку, где (x + y) кратно
 * L, — значит, пока он жив, остальные клетки можно не трогать. Шаг берётся по
 * самому мелкому ЖИВОМУ кораблю, и вот тут важная оговорка про русский флот:
 * однопалубных в нём четыре, они находятся последними, и по букве правила шаг
 * был бы равен единице всю партию, то есть никакой сетки не было бы вовсе.
 *
 * Поэтому катера в расчёт не идут, пока жив хоть кто-то крупнее: искать
 * одноклеточную иголку, не добив линкор, — худшее, что можно сделать. Это не
 * поддавки правилу, а ровно то, как играет человек: сначала крупные (их проще
 * найти, и вокруг каждого потопленного открывается полоса воды), катера — в
 * последнюю очередь, когда поле уже наполовину вычеркнуто.
 */
function huntStep(lens) {
    const big = lens.filter(l => l > 1);
    return big.length ? Math.min(...big) : 1;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];

// ── Добивание ────────────────────────────────────────────────────────────────

/** Юнга: тычет в любую свободную клетку рядом с попаданием. */
function aroundWound(view, wounded) {
    const out = new Set();
    for (const c of wounded) {
        for (const n of orthogonal(c)) if (view.outgoing[n] === NONE) out.add(n);
    }
    return [...out];
}

/**
 * Наводчик: два попадания подряд задают направление, и продолжать надо ИМЕННО
 * его — с любого из двух концов. Разница с Юнгой видна сразу: тот на
 * четырёхпалубном обстукивает все бока и тратит на него вдвое больше выстрелов.
 */
function alongWound(view, wounded) {
    const group = firstCluster(wounded);
    if (group.length === 1) return aroundWound(view, group);

    const horizontal = yOf(group[0]) === yOf(group[1]);
    const line = group.slice().sort((a, b) => (horizontal ? xOf(a) - xOf(b) : yOf(a) - yOf(b)));
    const dx = horizontal ? 1 : 0;
    const dy = horizontal ? 0 : 1;

    const out = [];
    const ends = [
        [xOf(line[0]) - dx, yOf(line[0]) - dy],
        [xOf(line[line.length - 1]) + dx, yOf(line[line.length - 1]) + dy],
    ];
    for (const [x, y] of ends) {
        if (!onBoard(x, y)) continue;
        const c = cellAt(x, y);
        if (view.outgoing[c] === NONE) out.push(c);
    }
    // Оба конца закрыты — такого при честной игре не бывает (корабль был бы уже
    // потоплен), но оставлять бота без хода нельзя.
    return out.length ? out : aroundWound(view, group);
}

/** Четыре соседа по стороне. Корабль идёт линией, диагональ к нему не ведёт. */
function orthogonal(cell) {
    const x = xOf(cell);
    const y = yOf(cell);
    const out = [];
    if (onBoard(x - 1, y)) out.push(cellAt(x - 1, y));
    if (onBoard(x + 1, y)) out.push(cellAt(x + 1, y));
    if (onBoard(x, y - 1)) out.push(cellAt(x, y - 1));
    if (onBoard(x, y + 1)) out.push(cellAt(x, y + 1));
    return out;
}

/** Первая связная группа раненых клеток — один недобитый корабль. */
function firstCluster(wounded) {
    const set = new Set(wounded);
    const group = [wounded[0]];
    const seen = new Set(group);
    for (let i = 0; i < group.length; i++) {
        for (const n of orthogonal(group[i])) {
            if (set.has(n) && !seen.has(n)) { seen.add(n); group.push(n); }
        }
    }
    return group;
}

// ── Счёт расстановок (Адмирал) ───────────────────────────────────────────────

/**
 * Клетки с наибольшим числом проходящих через них расстановок.
 *
 * Считаем так: для каждой живой длины перебираем все места на поле и оставляем
 * те, что не спорят с известным. Место годится, если
 *   — все его клетки либо не стреляны, либо ранены (в промах корабль не влезет,
 *     в клетку потопленного — тоже: она занята чужим бортом);
 *   — оно не КАСАЕТСЯ раны, которую не накрывает: корабли не соприкасаются,
 *     значит, рядом с чужим попаданием стоять нельзя (см. шапку).
 * Каждое годное место добавляет вес всем своим НЕ ОТСТРЕЛЯННЫМ клеткам — стрелять
 * есть смысл только туда.
 *
 * Пока на поле есть раненый, в счёт идут ТОЛЬКО места, его накрывающие: добить
 * найденное всегда выгоднее, чем искать новое.
 */
function byDensity(view, open, wounded, lens) {
    const woundSet = new Set(wounded);
    const dead = new Set();
    for (const ship of view.sunk || []) for (const c of shipCells(ship) || []) dead.add(c);
    // Куда корабль встать не может вовсе: промах и клетки потопленных.
    const solid = new Uint8Array(CELLS);
    for (let c = 0; c < CELLS; c++) {
        if (view.outgoing[c] !== NONE && !woundSet.has(c)) solid[c] = 1;
    }

    const hunting = wounded.length === 0;
    const score = new Float64Array(CELLS);
    let any = false;

    // Длины перебираются СО ВСЕМИ ПОВТОРАМИ: живых трёхпалубных бывает два, и
    // мест под них вдвое больше, чем под один. Свернуть список в набор — значит
    // уравнять единственный линкор с парой крейсеров, а это и есть та самая
    // вероятность, ради которой всё считается.
    for (const len of lens) {
        for (let dir = ACROSS; dir <= DOWN; dir++) {
            const maxX = dir === ACROSS ? SIZE - len : SIZE - 1;
            const maxY = dir === ACROSS ? SIZE - 1 : SIZE - len;
            for (let y = 0; y <= maxY; y++) {
                for (let x = 0; x <= maxX; x++) {
                    const ship = shipAt(x, y, len, dir);
                    const cells = shipCells(ship);
                    let fits = true;
                    let covered = 0;
                    for (const c of cells) {
                        if (solid[c]) { fits = false; break; }
                        if (woundSet.has(c)) covered++;
                    }
                    if (!fits) continue;
                    if (!hunting && !covered) continue;
                    // Рана впритык, но не под кораблём, — значит, там стоит
                    // другой корабль, а борт к борту они не встают.
                    const own = new Set(cells);
                    let touchesWound = false;
                    for (const c of cells) {
                        for (const n of around(c)) {
                            if (!own.has(n) && woundSet.has(n)) { touchesWound = true; break; }
                        }
                        if (touchesWound) break;
                    }
                    if (touchesWound) continue;

                    const weight = covered ? WOUND_WEIGHT ** covered : 1;
                    for (const c of cells) {
                        if (view.outgoing[c] === NONE) { score[c] += weight; any = true; }
                    }
                }
            }
            // Однопалубному вертикаль и горизонталь — одно и то же место.
            if (len === 1) break;
        }
    }

    // Ни одного законного места (позиция, которой не бывает) — пусть решает
    // уровень попроще, чем возвращать пустоту.
    if (!any) return [];

    let best = 0;
    for (const c of open) if (score[c] > best) best = score[c];
    return best > 0 ? open.filter(c => score[c] === best) : [];
}
