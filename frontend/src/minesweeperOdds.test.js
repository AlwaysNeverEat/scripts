import test from 'node:test';
import assert from 'node:assert/strict';

import { computeOdds, oddsLabel } from './minesweeperOdds.js';

function nb(rows, cols, index) {
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

/** Поле из картинки: '*' — мина. openedList — какие клетки открыты. */
function game(lines, openedList = []) {
    const rows = lines.length;
    const cols = lines[0].length;
    const isMine = i => lines[Math.floor(i / cols)][i % cols] === '*';
    let mines = 0;
    for (let i = 0; i < rows * cols; i++) if (isMine(i)) mines++;
    const opened = openedList.map((i) => {
        assert.ok(!isMine(i), `клетка ${i} — мина, открытой она быть не может`);
        return [i, nb(rows, cols, i).filter(isMine).length];
    });
    return { field: { rows, cols, mines, opened }, isMine };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('до первого хода все клетки равноценны', () => {
    const { prob, exact } = computeOdds({ rows: 18, cols: 18, mines: 50, opened: [] });
    assert.equal(exact, true);
    near(prob[0], 50 / 324, 'плотность мин');
    assert.equal(new Set(prob).size, 1);
});

test('одна цифра делит вероятность поровну', () => {
    // . 1 .  — мина в одной из двух клеток по краям, но в какой, не узнать.
    const { prob } = computeOdds({ rows: 1, cols: 3, mines: 1, opened: [[1, 1]] });
    near(prob[0], 0.5, 'левая');
    near(prob[2], 0.5, 'правая');
    assert.equal(prob[1], null);
});

test('ноль и сто процентов — это доказанные клетки', () => {
    // 0 у второй клетки закрывает соседей, значит единственная мина — в дальней.
    const { prob, exact } = computeOdds({ rows: 1, cols: 4, mines: 1, opened: [[1, 0]] });
    assert.equal(exact, true);
    near(prob[0], 0, 'сосед нуля');
    near(prob[2], 0, 'сосед нуля');
    near(prob[3], 1, 'мине больше негде быть');
});

test('остаток мин размазывается по дальним клеткам', () => {
    // 1 у края → мина в клетке 1 наверняка; вторая мина где-то в 2 и 3.
    const { prob } = computeOdds({ rows: 1, cols: 4, mines: 2, opened: [[0, 1]] });
    near(prob[1], 1, 'у цифры');
    near(prob[2], 0.5, 'дальняя');
    near(prob[3], 0.5, 'дальняя');
});

test('общее число мин учитывается: сумма вероятностей равна их количеству', () => {
    const lines = [
        '......',
        '.*..*.',
        '......',
        '..*...',
        '....*.',
        '......',
    ];
    const cols = 6;
    const opened = [];
    for (const row of [0, 2]) for (let c = 0; c < cols; c++) opened.push(row * cols + c);
    const { field, isMine } = game(lines, opened);

    const { prob, exact } = computeOdds(field);
    assert.equal(exact, true);

    let sum = 0;
    for (let i = 0; i < prob.length; i++) if (prob[i] != null) sum += prob[i];
    near(sum, field.mines, 'сумма вероятностей');

    // Расчёт не обязан угадывать каждую мину, но противоречить полю не должен:
    // мина не может иметь нулевого шанса, пустая клетка — стопроцентного.
    for (let i = 0; i < prob.length; i++) {
        if (prob[i] == null) continue;
        if (isMine(i)) assert.ok(prob[i] > 0, `мина ${i} названа безопасной`);
        else assert.ok(prob[i] < 1, `пустая клетка ${i} названа миной`);
    }
});

test('вероятности зависят от соседних цифр, а не только от плотности', () => {
    // Классический «1-2-1»: у двойки мин по краям, середина под ней чиста.
    //   ? ? ? ?
    //   1 2 1 .
    const lines = [
        '.**.',
        '....',
    ];
    const { field } = game(lines, [4, 5, 6, 7]);
    const { prob, exact } = computeOdds(field);
    assert.equal(exact, true);
    near(prob[0], 0, 'угол свободен');
    near(prob[1], 1, 'мина доказана');
    near(prob[2], 1, 'мина доказана');
    near(prob[3], 0, 'угол свободен');
});

test('упёршись в потолок перебора, отдаём оценку, а не зависание', () => {
    const lines = [
        '......',
        '.*..*.',
        '......',
        '..*...',
        '....*.',
        '......',
    ];
    const opened = [];
    for (let c = 0; c < 6; c++) { opened.push(c); opened.push(12 + c); }
    const { field } = game(lines, opened);

    const { prob, exact } = computeOdds(field, { maxNodes: 5 });
    assert.equal(exact, false);
    for (let i = 0; i < prob.length; i++) {
        if (prob[i] == null) continue;
        assert.ok(prob[i] >= 0 && prob[i] <= 1, `клетка ${i} вне 0..1: ${prob[i]}`);
    }
});

test('подпись округляет, но не врёт про крайности', () => {
    assert.equal(oddsLabel(0), '0');
    assert.equal(oddsLabel(1), '100');
    assert.equal(oddsLabel(0.004), '1');    // не «0»: клетка не безопасна
    assert.equal(oddsLabel(0.996), '99');   // не «100»: мина не доказана
    assert.equal(oddsLabel(0.155), '16');
});
