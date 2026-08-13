import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, getGame, currentGame, play, present, elapsedSeconds, _reset } from './games.js';

beforeEach(() => _reset());

// Открыть все клетки без мин — то есть выиграть, зная раскладку. Так может
// только тест: клиенту раскладка не уходит до конца партии.
function winGame(userId) {
    const game = currentGame(userId);
    play(userId, { index: 0, mode: 'open' });  // первый ход расставляет мины
    for (let i = 0; i < game.field.size; i++) {
        if (!game.field.mine[i]) play(userId, { index: i, mode: 'open' });
    }
    return game;
}

test('у каждого аккаунта своя партия', () => {
    const a = newGame('user-a');
    const b = newGame('user-b');
    play('user-a', { index: 0, mode: 'open' });
    assert.equal(a.field.state, 'play');
    assert.equal(b.field.state, 'new', 'ход одного аккаунта тронул поле другого');
    assert.notEqual(getGame('user-a'), getGame('user-b'));
});

test('партия переживает перезагрузку страницы: состояние на сервере', () => {
    newGame('user-a');
    play('user-a', { index: 40, mode: 'open' });
    const opened = present(getGame('user-a')).opened.length;
    // «Перезагрузка» — это повторный запрос состояния, а не новая игра.
    assert.equal(present(currentGame('user-a')).opened.length, opened);
});

test('раскладка мин не уходит клиенту, пока игра идёт', () => {
    newGame('user-a');
    play('user-a', { index: 0, mode: 'open' });
    const shown = present(getGame('user-a'));
    assert.equal(shown.minePositions, undefined, 'мины видны прямо посреди партии');
    assert.equal(shown.rows, 18);
    assert.equal(shown.cols, 18);
    assert.equal(shown.mines, 50);
});

test('после победы мины показываются, а время фиксируется', () => {
    const game = winGame('user-a');
    assert.equal(game.field.state, 'won');
    const shown = present(game);
    assert.equal(shown.state, 'won');
    assert.equal(shown.minePositions.length, 50);
    assert.equal(shown.opened.length, game.field.size - 50);
    // Время замерло: секунды не растут после конца партии.
    const first = elapsedSeconds(game);
    assert.equal(elapsedSeconds(game), first);
});

test('«Заново» выдаёт новое поле, а не продолжает старое', () => {
    winGame('user-a');
    const next = newGame('user-a');
    assert.equal(next.field.state, 'new');
    assert.equal(present(next).opened.length, 0);
    assert.equal(present(next).minePositions, undefined);
    assert.equal(elapsedSeconds(next), 0);
});

test('время идёт с первого хода, а не с открытия окна', () => {
    const game = newGame('user-a');
    assert.equal(game.startedAt, null);
    assert.equal(elapsedSeconds(game), 0);
    play('user-a', { index: 10, mode: 'open' });
    assert.ok(game.startedAt, 'первый ход не запустил секундомер');
});

test('ходы в проигранной партии игнорируются', () => {
    const game = newGame('user-a');
    play('user-a', { index: 0, mode: 'open' });
    const mine = [...game.field.mine].findIndex(Boolean);
    const dead = play('user-a', { index: mine, mode: 'open' });
    assert.equal(dead.step.hit, true);
    assert.equal(game.field.state, 'lost');
    const opened = present(game).opened.length;
    play('user-a', { index: mine + 1, mode: 'open' });
    assert.equal(present(game).opened.length, opened);
});
