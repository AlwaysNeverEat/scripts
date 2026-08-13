// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Сапёр» — поле 18×18 на 50 мин.
//
// Открывается только с поиска на главной («сапер» + Enter). В отличие от
// вордле и контекстно, здесь ничего не привязано к суткам: партия генерируется
// заново после каждой победы и каждого проигрыша.
//
// Поле живёт на СЕРВЕРЕ и клиенту не отдаётся (backend/src/minesweeper/): в
// браузер уходит только то, что открылось, а раскладка мин — когда игра уже
// кончилась. Иначе мини-топ не имел бы смысла: «пройденный сапёр» рисовался бы
// в консоли за секунду.
//
// Флажки, наоборот, целиком клиентские: это пометки для себя, сервер их не
// хранит и присылаются они только вместе с «аккордом» (см. field.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { newGame, currentGame, play, present, elapsedSeconds } from '../minesweeper/games.js';
import { recordWin, monthlyTop } from '../minesweeper/store.js';

const router = Router();

const TOP_LIMIT = 10;

// Топ — единственное место, где сапёр ходит в базу. Её недоступность не должна
// мешать играть: окно просто покажет игру без таблицы.
async function safeTop(userId) {
    try {
        return await monthlyTop(userId, TOP_LIMIT);
    } catch (err) {
        console.error('minesweeper: не удалось прочитать топ', err.message);
        return null;
    }
}

// ── GET /api/minesweeper/state ───────────────────────────────────────────────
// Текущая партия (или новая, если её нет) плюс мини-топ месяца.
router.get('/state', async (req, res) => {
    const game = currentGame(req.user.id);
    res.json({ game: present(game), top: await safeTop(req.user.id) });
});

// ── POST /api/minesweeper/new ────────────────────────────────────────────────
// Новая партия. Начатую при этом теряем — это и есть «начать заново».
router.post('/new', async (req, res) => {
    const game = newGame(req.user.id);
    res.json({ game: present(game), top: await safeTop(req.user.id) });
});

// ── POST /api/minesweeper/open ───────────────────────────────────────────────
// { index, mode: 'open' | 'chord', flags: [index…] }
// → { game, top?, revealed, hit }
//
// Победа пишется в базу здесь же, ровно один раз: состояние партии после этого
// 'won', и второй раз в этот блок она не попадёт.
router.post('/open', async (req, res) => {
    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'index?' });

    const mode = req.body?.mode === 'chord' ? 'chord' : 'open';
    const flags = Array.isArray(req.body?.flags)
        ? req.body.flags.map(Number).filter(Number.isInteger)
        : [];

    const wasOver = ['won', 'lost'].includes(currentGame(req.user.id).field.state);
    const { game, step } = play(req.user.id, { index, flags, mode });

    let top = null;
    if (!wasOver && game.field.state === 'won') {
        try {
            await recordWin(req.user.id, elapsedSeconds(game));
        } catch (err) {
            // Партия уже пройдена — не отнимать же победу из-за базы.
            console.error('minesweeper: победу не удалось записать', err.message);
        }
        top = await safeTop(req.user.id);
    }

    res.json({ game: present(game), revealed: step.revealed, hit: step.hit, ...(top ? { top } : {}) });
});

// ── GET /api/minesweeper/top ─────────────────────────────────────────────────
router.get('/top', async (req, res) => {
    const top = await safeTop(req.user.id);
    if (!top) return res.status(503).json({ error: 'top unavailable' });
    res.json(top);
});

export default router;
