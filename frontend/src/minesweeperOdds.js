// ─────────────────────────────────────────────────────────────────────────────
// Вероятность мины в закрытой клетке — для чит-режима сапёра (см. minesweeper.js).
//
// Считаем ИСКЛЮЧИТЕЛЬНО по тому, что видно на доске: открытые цифры и общее
// число мин. Раскладку сервер до конца партии не отдаёт, и подсматривать её тут
// нечем — этот модуль решает ту же задачу, что и человек, только честно
// перебором. Поэтому «100%» значит «мина там доказуема», а не «я подглядел».
//
// Флажки в расчёт НЕ берутся сознательно: это пометки игрока, они могут быть
// ошибочными, и учитывать их — значит показывать проценты, выведенные из
// собственной ошибки. Вопрос «насколько я нарандомил» тогда теряет смысл.
//
// Как считается:
//  1. Каждая открытая цифра — уравнение: сумма мин в её закрытых соседях = цифра.
//  2. Клетки, попавшие хоть в одно уравнение («граница»), делятся на связные
//     компоненты — уравнения разных компонент друг о друге ничего не знают.
//  3. В каждой компоненте перебираем все допустимые расстановки, считая для
//     каждой клетки, в скольких из них она мина, с разбивкой по числу мин в
//     компоненте (число мин важно: оно расходует общий лимит поля).
//  4. Компоненты и «дальние» клетки (те, что не граничат ни с одной цифрой)
//     сшиваются свёрткой с C(дальних, оставшихся мин) — так учитывается, что
//     всего мин на поле ровно `mines`.
//
// Перебор в пункте 3 в теории экспоненциальный. На практике компоненты мелкие,
// но упереться в дикую позицию можно — поэтому есть потолок по числу узлов:
// вместо зависшей вкладки получаем приблизительную оценку и честный флаг
// exact: false.
// ─────────────────────────────────────────────────────────────────────────────

// Потолок подобран так, чтобы худший случай считался десятки миллисекунд:
// подвисание доски на ход хуже, чем «примерно».
export const DEFAULT_MAX_NODES = 300_000;

function neighbours(rows, cols, index) {
    const r = Math.floor(index / cols);
    const c = index % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
        }
    }
    return out;
}

/**
 * Вероятности мины по клеткам.
 *
 * game: { rows, cols, mines, opened } — opened это Map(индекс → цифра) или
 * массив пар, как приходит с сервера.
 *
 * Возвращает { prob, exact }: prob[i] — число 0..1 для закрытой клетки и null
 * для открытой; exact === false означает, что перебор упёрся в потолок и часть
 * значений — оценка.
 */
export function computeOdds(game, { maxNodes = DEFAULT_MAX_NODES } = {}) {
    const { rows, cols, mines } = game;
    const size = rows * cols;
    const opened = game.opened instanceof Map ? game.opened : new Map(game.opened || []);
    const prob = new Array(size).fill(null);

    const unknown = [];
    for (let i = 0; i < size; i++) if (!opened.has(i)) unknown.push(i);
    if (!unknown.length) return { prob, exact: true };

    const uniform = () => {
        const p = clamp01(mines / unknown.length);
        for (const i of unknown) prob[i] = p;
        return { prob, exact: true };
    };

    // Уравнения. Открытая клетка миной быть не может, поэтому в неизвестных у
    // цифры только её закрытые соседи.
    const constraints = [];
    const border = new Set();
    for (const [i, n] of opened) {
        const around = neighbours(rows, cols, i).filter(j => !opened.has(j));
        if (!around.length) continue;
        constraints.push({ cells: around, n });
        for (const j of around) border.add(j);
    }
    // Ни одной цифры с закрытым соседом — знать нечего, все клетки равноценны.
    // Это и есть начало партии: ровно 50 мин на 324 клетки, 15% под каждой.
    if (!constraints.length) return uniform();

    const comps = components(constraints, border).map(g => solveComponent(g, mines, maxNodes));
    const free = unknown.filter(i => !border.has(i));

    const exact = comps.every(c => !c.capped) && combine(prob, comps, free, mines);
    if (!exact) approximate(prob, comps, free, mines);
    return { prob, exact };
}

/** Подпись на клетке: целые проценты, но 0 и 100 — только когда это доказано. */
export function oddsLabel(p) {
    if (p <= 0) return '0';
    if (p >= 1) return '100';
    // Округление не должно врать в самом важном месте: 0,4% — это не «0»
    // (клетка не безопасна), а 99,6% — не «100» (мина не доказана).
    return String(Math.min(99, Math.max(1, Math.round(p * 100))));
}

function clamp01(x) {
    if (!(x > 0)) return 0;      // заодно ловит NaN и -0
    return x < 1 ? x : 1;
}

// ── Компоненты ───────────────────────────────────────────────────────────────

// Клетки, связанные общим уравнением, разбирать порознь нельзя; всё остальное —
// можно, и это единственное, что удерживает перебор в разумных размерах.
function components(constraints, border) {
    const parent = new Map();
    for (const j of border) parent.set(j, j);
    const find = (x) => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r);
        while (parent.get(x) !== r) { const next = parent.get(x); parent.set(x, r); x = next; }
        return r;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    for (const c of constraints) for (let k = 1; k < c.cells.length; k++) union(c.cells[0], c.cells[k]);

    const groups = new Map();
    for (const c of constraints) {
        const root = find(c.cells[0]);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(c);
    }
    return [...groups.values()].map(cons => ({ cons }));
}

// ── Перебор внутри компоненты ────────────────────────────────────────────────

/**
 * Возвращает { cells, n, T, S, capped, cons }:
 *  T[k] — сколько расстановок компоненты содержат ровно k мин;
 *  S[c * (n + 1) + k] — в скольких из них мина стоит в клетке c.
 * Разбивка по k нужна дальше, чтобы учесть общий лимит мин на поле.
 */
function solveComponent(group, mines, maxNodes) {
    // Порядок клеток — по появлению в уравнениях: так уравнения «закрываются»
    // как можно раньше, и отсечение срабатывает у корня, а не у листьев.
    const local = new Map();
    const cells = [];
    for (const c of group.cons) {
        for (const j of c.cells) {
            if (local.has(j)) continue;
            local.set(j, cells.length);
            cells.push(j);
        }
    }
    const n = cells.length;
    const cellCons = Array.from({ length: n }, () => []);
    const need = [];
    const left = [];
    group.cons.forEach((c, ci) => {
        need.push(c.n);
        left.push(c.cells.length);
        for (const j of c.cells) cellCons[local.get(j)].push(ci);
    });

    const T = new Float64Array(n + 1);
    const S = new Float64Array(n * (n + 1));
    const assign = new Uint8Array(n);
    let nodes = 0;
    let capped = false;

    const step = (k, used) => {
        if (++nodes > maxNodes) { capped = true; return; }
        if (k === n) {
            T[used]++;
            for (let c = 0; c < n; c++) if (assign[c]) S[c * (n + 1) + used]++;
            return;
        }
        for (let v = 0; v <= 1; v++) {
            if (v && used >= mines) continue;   // мин на поле всего mines
            const list = cellCons[k];
            let applied = 0;
            let ok = true;
            while (applied < list.length) {
                const ci = list[applied++];
                need[ci] -= v;
                left[ci] -= 1;
                // Мин уже больше, чем просит цифра, или оставшихся клеток не
                // хватит, чтобы её добрать, — ветка мертва.
                if (need[ci] < 0 || need[ci] > left[ci]) { ok = false; break; }
            }
            if (ok) {
                assign[k] = v;
                step(k + 1, used + v);
                assign[k] = 0;
            }
            while (applied-- > 0) { const ci = list[applied]; need[ci] += v; left[ci] += 1; }
            if (capped) return;
        }
    };
    step(0, 0);

    return { cells, n, T, S, capped, cons: group.cons };
}

// ── Сшивка компонент и дальних клеток ────────────────────────────────────────

function conv(a, b) {
    const out = new Float64Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) {
        if (!a[i]) continue;
        for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    }
    return out;
}

function binomials(n, upTo) {
    const out = new Float64Array(upTo + 1);
    for (let k = 0; k <= upTo; k++) {
        if (k > n) break;
        const m = Math.min(k, n - k);
        let r = 1;
        for (let i = 1; i <= m; i++) r = r * (n - m + i) / i;
        out[k] = r;
    }
    return out;
}

/**
 * Точный расчёт. Каждая расстановка поля весит одинаково, поэтому вероятность
 * клетки — доля расстановок, где она мина. Расстановки считаются как
 * (варианты компонент) × C(дальних клеток, оставшиеся мины).
 *
 * Возвращает false, если посчитать не вышло (числа выродились) — тогда наверху
 * включается приблизительный путь.
 */
function combine(prob, comps, free, mines) {
    const F = free.length;
    const cf = binomials(F, mines);
    const ways = (rest) => (rest < 0 || rest > mines ? 0 : cf[rest]);

    // Префиксные и суффиксные свёртки: из них получается «всё, кроме i-й
    // компоненты» без деления — делить на ноль тут слишком легко.
    const pre = [new Float64Array([1])];
    for (const c of comps) pre.push(conv(pre[pre.length - 1], c.T));
    const suf = new Array(comps.length + 1);
    suf[comps.length] = new Float64Array([1]);
    for (let i = comps.length - 1; i >= 0; i--) suf[i] = conv(comps[i].T, suf[i + 1]);

    const W = pre[comps.length];       // расстановок границы с m минами
    let total = 0;
    for (let m = 0; m < W.length; m++) total += W[m] * ways(mines - m);
    if (!(total > 0) || !Number.isFinite(total)) return false;

    for (let i = 0; i < comps.length; i++) {
        const { cells, n, S } = comps[i];
        const excl = conv(pre[i], suf[i + 1]);
        // G[k] — вес всего остального поля, если в этой компоненте k мин.
        const G = new Float64Array(n + 1);
        for (let k = 0; k <= n; k++) {
            let s = 0;
            for (let j = 0; j < excl.length; j++) {
                if (excl[j]) s += excl[j] * ways(mines - k - j);
            }
            G[k] = s;
        }
        for (let c = 0; c < n; c++) {
            let num = 0;
            for (let k = 0; k <= n; k++) {
                const s = S[c * (n + 1) + k];
                if (s) num += s * G[k];
            }
            prob[cells[c]] = clamp01(num / total);
        }
    }

    if (F) {
        // Дальние клетки неразличимы между собой: у каждой одна и та же доля
        // оставшихся мин.
        let num = 0;
        for (let m = 0; m < W.length; m++) {
            const rest = mines - m;
            if (rest > 0 && W[m]) num += W[m] * ways(rest) * (rest / F);
        }
        const p = clamp01(num / total);
        for (const i of free) prob[i] = p;
    }
    return true;
}

/**
 * Запасной путь: перебор где-то упёрся в потолок. Считаем без учёта общего
 * лимита мин — на середине партии это близко к правде, а «примерно» честно
 * показывается в интерфейсе.
 */
function approximate(prob, comps, free, mines) {
    let expected = 0;
    for (const comp of comps) {
        if (comp.capped) {
            // Про эту компоненту известно только локальное: клетка тем опаснее,
            // чем плотнее самое требовательное уравнение вокруг неё.
            const worst = new Map();
            for (const c of comp.cons) {
                const p = c.n / c.cells.length;
                for (const j of c.cells) worst.set(j, Math.max(worst.get(j) ?? 0, p));
            }
            for (const [j, p] of worst) { prob[j] = clamp01(p); expected += prob[j]; }
            continue;
        }
        let all = 0;
        for (let k = 0; k <= comp.n; k++) all += comp.T[k];
        for (let c = 0; c < comp.n; c++) {
            let mine = 0;
            for (let k = 0; k <= comp.n; k++) mine += comp.S[c * (comp.n + 1) + k];
            const p = all > 0 ? mine / all : 0;
            prob[comp.cells[c]] = clamp01(p);
            expected += prob[comp.cells[c]];
        }
    }
    if (free.length) {
        const p = clamp01((mines - expected) / free.length);
        for (const i of free) prob[i] = p;
    }
}
