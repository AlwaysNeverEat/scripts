// ── Трубная заставка: сетка и рост ───────────────────────────────────────────
// Правила отделены от рисования (pipes.js) по той же причине, по какой правила
// игр живут в shared/: здесь единственное во всей заставке, у чего есть
// ИНВАРИАНТЫ — узел не занимается дважды, труба не вылезает за куб, а рост
// обязан КОНЧАТЬСЯ. На фоне главной этого не разглядеть (сетка ±8 — это 4913
// узлов, а на экране видно клубок), зато видно тестом рядом.
//
// Оригинал (github.com/1j01/pipes) на занятом узле просто ничего не делает, и
// труба, упёршаяся в тупик, молча замирает навсегда. Мы вместо этого перебираем
// ВСЕ шесть направлений в случайном порядке и, если идти некуда, объявляем
// трубу мёртвой — сверху (pipes.js) на её место приходит новая. Разница видна
// только к концу цикла, когда клубок плотный: у оригинала в этот момент
// половина труб стоит.

// Порядок важен только для воспроизводимости тестов — рост всё равно
// перемешивает направления.
export const DIRS = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
];

// Вероятность продолжить прямо. Ровно как в оригинале: без неё труба вьётся
// клубком у точки старта, а с единицей — это отрезок, а не заставка.
export const STRAIGHT_CHANCE = 0.5;

// Генератор с сидом (xorshift32) — тот же, что у пасхалок в shared/. Нужен не
// для красоты: по сиду воспроизводится «вот на этом клубке всё встало», и на
// нём же стоят тесты.
export function rng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
    };
}

/**
 * Куб узлов ±half. Занятость — плоский Uint8Array, а не Set строк «(x, y, z)»
 * как в оригинале: узлов пять тысяч, и на каждый шаг роста приходится до шести
 * проверок, а строку под ключ пришлось бы каждый раз собирать заново.
 */
export function createGrid(half) {
    const size = half * 2 + 1;
    const cells = new Uint8Array(size * size * size);
    const inside = (x, y, z) =>
        x >= -half && x <= half && y >= -half && y <= half && z >= -half && z <= half;
    const idx = (x, y, z) => (x + half) + size * ((y + half) + size * (z + half));
    return {
        half,
        size,
        inside,
        free: (x, y, z) => inside(x, y, z) && cells[idx(x, y, z)] === 0,
        take: (x, y, z) => { if (inside(x, y, z)) cells[idx(x, y, z)] = 1; },
        clear: () => cells.fill(0),
        taken: () => cells.reduce((n, c) => n + c, 0),
    };
}

// Новая труба в свободном узле. Сначала тычемся наугад (пока куб пустой — это
// одна попытка), и только если не вышло — идём по узлам подряд: под конец цикла
// свободных мест остаются единицы, и случайный тык их не находит вовсе.
export function spawnPipe(grid, rnd) {
    const pick = () => Math.floor(rnd() * grid.size) - grid.half;
    for (let i = 0; i < 60; i++) {
        const x = pick(), y = pick(), z = pick();
        if (grid.free(x, y, z)) return start(grid, x, y, z);
    }
    for (let x = -grid.half; x <= grid.half; x++) {
        for (let y = -grid.half; y <= grid.half; y++) {
            for (let z = -grid.half; z <= grid.half; z++) {
                if (grid.free(x, y, z)) return start(grid, x, y, z);
            }
        }
    }
    return null; // куб забит целиком — расти негде
}

function start(grid, x, y, z) {
    grid.take(x, y, z);
    return { x, y, z, dx: 0, dy: 0, dz: 0, alive: true, length: 0 };
}

/**
 * Один шаг трубы. Возвращает пройденный отрезок и признак поворота (по нему
 * pipes.js решает, ставить ли шарнир) либо null, если идти некуда — тогда
 * труба помечается мёртвой и больше не шагает.
 */
export function stepPipe(pipe, grid, rnd) {
    if (!pipe.alive) return null;

    const dirs = DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    // Прямо — первым кандидатом, а не единственным: если впереди занято, труба
    // сворачивает, а не встаёт.
    const straight = pipe.length > 0 && rnd() < STRAIGHT_CHANCE;
    if (straight) dirs.unshift([pipe.dx, pipe.dy, pipe.dz]);

    for (const [dx, dy, dz] of dirs) {
        const nx = pipe.x + dx, ny = pipe.y + dy, nz = pipe.z + dz;
        if (!grid.free(nx, ny, nz)) continue;
        grid.take(nx, ny, nz);
        const turn = pipe.length > 0 && (dx !== pipe.dx || dy !== pipe.dy || dz !== pipe.dz);
        const seg = { ax: pipe.x, ay: pipe.y, az: pipe.z, bx: nx, by: ny, bz: nz, turn };
        pipe.x = nx; pipe.y = ny; pipe.z = nz;
        pipe.dx = dx; pipe.dy = dy; pipe.dz = dz;
        pipe.length++;
        return seg;
    }

    pipe.alive = false;
    return null;
}
