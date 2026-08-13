import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markGuess, isWin, normalizeWord, isWordShape } from './wordle.js';

test('точное совпадение — все буквы зелёные', () => {
    assert.deepEqual(markGuess('карта', 'карта'), ['hit', 'hit', 'hit', 'hit', 'hit']);
    assert.equal(isWin(markGuess('карта', 'карта')), true);
});

test('буква не на своём месте — жёлтая, чужая — серая', () => {
    // «карта» / «тропа»: «т» и «р» есть, но не тут; «о» и «п» нет вовсе.
    assert.deepEqual(markGuess('карта', 'тропа'), ['near', 'near', 'miss', 'miss', 'hit']);
});

test('жёлтых ровно столько, сколько таких букв в ответе', () => {
    // В «домике» одна «о» — жёлтой становится только первая «о» попытки.
    assert.deepEqual(markGuess('домик', 'олово'), ['near', 'miss', 'miss', 'miss', 'miss']);
});

test('зелёные съедают букву раньше жёлтых', () => {
    // Обе «о» из «колоса» уже стоят на своих местах — остальным «о» попытки
    // подсветиться нечем, хотя буква в слове есть.
    assert.deepEqual(markGuess('колос', 'оооон'), ['miss', 'hit', 'miss', 'hit', 'miss']);
});

test('«ё» и регистр приводятся к «е» и нижнему регистру', () => {
    assert.equal(normalizeWord(' Ёлочка '), 'елочка');
    assert.deepEqual(markGuess('елена', 'ЁЛЕНА'), ['hit', 'hit', 'hit', 'hit', 'hit']);
});

test('isWordShape пропускает только пять русских букв', () => {
    assert.equal(isWordShape('карта'), true);
    assert.equal(isWordShape('КАРТА'), true);
    assert.equal(isWordShape('карт'), false);
    assert.equal(isWordShape('карты!'), false);
    assert.equal(isWordShape('cards'), false);
    assert.equal(isWordShape(''), false);
});

test('isWin не срабатывает на неполной раскраске', () => {
    assert.equal(isWin(['hit', 'hit', 'hit', 'hit']), false);
    assert.equal(isWin(['hit', 'hit', 'hit', 'near', 'hit']), false);
});
