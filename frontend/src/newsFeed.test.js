import test from 'node:test';
import assert from 'node:assert/strict';

import { clickLabel, plural, spaced } from './newsFeed.js';

// Русское склонение — то место, где «нажатий» вместо «нажатия» видно всем и
// сразу: счётчик кнопки в посте висит на виду и меняется на каждый щелчок.
test('clickLabel: склонение по последней цифре, а не по величине', () => {
    assert.equal(clickLabel(1), '1 нажатие');
    assert.equal(clickLabel(2), '2 нажатия');
    assert.equal(clickLabel(5), '5 нажатий');
    assert.equal(clickLabel(21), '21 нажатие');
    assert.equal(clickLabel(102), '102 нажатия');
});

test('clickLabel: 11–14 — исключение, там всегда «нажатий»', () => {
    for (const n of [11, 12, 13, 14, 111, 212]) {
        assert.match(clickLabel(n), /нажатий$/, String(n));
    }
});

test('clickLabel: ноль — «нажатий», по кнопке ещё никто не щёлкал', () => {
    assert.equal(clickLabel(0), '0 нажатий');
});

// Пробел между разрядами НЕРАЗРЫВНЫЙ: иначе «1 204 нажатия» переносится по
// середине числа и читается как два разных.
test('spaced: разряды разделены неразрывным пробелом', () => {
    assert.equal(spaced(1204), '1 204');
    assert.equal(spaced(1000000), '1 000 000');
    assert.equal(spaced(999), '999');
});

test('plural: работает и с чужими словами', () => {
    assert.equal(plural(1, 'запись', 'записи', 'записей'), 'запись');
    assert.equal(plural(3, 'запись', 'записи', 'записей'), 'записи');
    assert.equal(plural(13, 'запись', 'записи', 'записей'), 'записей');
});
