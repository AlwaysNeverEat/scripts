import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createField, placeMines, openCell, chord, isWin, neighbours, minePositions,
    ROWS, COLS, MINES,
} from './field.js';

// Предсказуемый «генератор»: выдаёт заранее заданные номера клеток.
function fakeRandom(sequence) {
    let i = 0;
    return () => sequence[i++ % sequence.length];
}

test('поле среднее: 18×18 и 50 мин', () => {
    const f = createField();
    assert.equal(f.rows, ROWS);
    assert.equal(f.cols, COLS);
    assert.equal(f.mines, MINES);
    assert.equal(f.size, 324);
    assert.equal(f.state, 'new');
});

test('первый клик и клетки вокруг него не могут быть миной', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
        const f = createField();
        const safe = 100;
        placeMines(f, safe);
        assert.equal(minePositions(f).length, MINES);
        assert.equal(f.mine[safe], 0);
        for (const n of neighbours(f, safe)) assert.equal(f.mine[n], 0, `мина на соседе ${n}`);
    }
});

test('счётчики соседей считаются по всем восьми клеткам', () => {
    const f = createField(3, 3, 1);
    // Единственная мина — в углу (0,0), первый клик в противоположный угол.
    placeMines(f, 8, fakeRandom([0]));
    assert.equal(f.mine[0], 1);
    assert.equal(f.count[1], 1);
    assert.equal(f.count[3], 1);
    assert.equal(f.count[4], 1);
    assert.equal(f.count[8], 0);
});

test('пустая клетка раскрывается волной до цифр включительно', () => {
    const f = createField(3, 3, 1);
    placeMines(f, 8, fakeRandom([0]));
    const { revealed, hit } = openCell(f, 8);
    assert.equal(hit, false);
    // Открыться должно всё, кроме самой мины: поле маленькое и почти пустое.
    assert.equal(revealed.length, 8);
    assert.equal(f.opened[0], 0, 'мина открылась волной');
    assert.equal(f.state, 'won');
});

test('клик по цифре открывает только её — волна дальше не идёт', () => {
    // Мины в противоположных углах 3×3, клик в центр: там цифра «2».
    const f = createField(3, 3, 2);
    placeMines(f, 4, fakeRandom([0, 8]));
    assert.equal(f.count[4], 2);
    const { revealed } = openCell(f, 4);
    assert.deepEqual(revealed, [4]);
    assert.equal(f.state, 'play');
});

test('мина под кликом — проигрыш, и поле больше не открывается', () => {
    const f = createField(3, 3, 1);
    placeMines(f, 8, fakeRandom([0]));
    const dead = openCell(f, 0);
    assert.equal(dead.hit, true);
    assert.equal(f.state, 'lost');
    assert.deepEqual(openCell(f, 4), { revealed: [], hit: false });
});

test('победа — это открыть всё, кроме мин, без единого флажка', () => {
    const f = createField(2, 3, 1);
    placeMines(f, 5, fakeRandom([0]));
    for (let i = 1; i < 6; i++) openCell(f, i);
    assert.equal(isWin(f), true);
    assert.equal(f.state, 'won');
});

test('аккорд открывает соседей, когда флажков ровно столько, сколько цифра', () => {
    const f = createField(3, 3, 1);
    placeMines(f, 8, fakeRandom([0]));
    openCell(f, 4);           // центр: цифра 1 рядом с миной в углу
    assert.equal(f.count[4], 1);
    // Без флажка аккорд ничего не делает.
    assert.deepEqual(chord(f, 4, []), { revealed: [], hit: false });
    const res = chord(f, 4, [0]);
    assert.equal(res.hit, false);
    assert.ok(res.revealed.length > 0);
    assert.equal(f.state, 'won');
});

test('аккорд с неверным флажком — честный проигрыш', () => {
    const f = createField(3, 3, 1);
    placeMines(f, 8, fakeRandom([0]));
    openCell(f, 4);
    const res = chord(f, 4, [2]); // флажок не там, где мина
    assert.equal(res.hit, true);
    assert.equal(f.state, 'lost');
});

test('открытие уже открытой клетки ничего не меняет', () => {
    const f = createField();
    openCell(f, 100);
    const again = openCell(f, 100);
    assert.deepEqual(again, { revealed: [], hit: false });
});
