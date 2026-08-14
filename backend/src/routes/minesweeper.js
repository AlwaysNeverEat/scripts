// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Сапёр» — поле 18×18 на 50 мин.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter). В отличие от
// вордле и контекстно, здесь ничего не привязано к суткам: партия генерируется
// заново после каждой победы и каждого проигрыша.
//
// Результаты нигде не хранятся: сыграл — и всё, в базу не идёт ни строки.
//
// Поле при этом живёт на СЕРВЕРЕ (backend/src/minesweeper/), а клиенту уходит
// только то, что открылось; раскладка мин — когда игра уже кончилась. Так
// партия переживает F5 и переход на другую вкладку: состояние спрашивается у
// сервера, а не хранится в браузере, где его теряет любая перезагрузка.
//
// Флажки, наоборот, целиком клиентские: это пометки для себя, сервер их не
// хранит и присылаются они только вместе с «аккордом» (см. field.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { newGame, currentGame, play, present } from '../minesweeper/games.js';

const router = Router();

// ── GET /api/minesweeper/state ───────────────────────────────────────────────
// Текущая партия (или новая, если её нет).
router.get('/state', (req, res) => {
    res.json({ game: present(currentGame(req.user.id)) });
});

// ── POST /api/minesweeper/new ────────────────────────────────────────────────
// Новая партия. Начатую при этом теряем — это и есть «начать заново».
router.post('/new', (req, res) => {
    res.json({ game: present(newGame(req.user.id)) });
});

// ── POST /api/minesweeper/open ───────────────────────────────────────────────
// { index, mode: 'open' | 'chord', flags: [index…] } → { game, revealed, hit }
router.post('/open', (req, res) => {
    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'index?' });

    const mode = req.body?.mode === 'chord' ? 'chord' : 'open';
    const flags = Array.isArray(req.body?.flags)
        ? req.body.flags.map(Number).filter(Number.isInteger)
        : [];

    const { game, step } = play(req.user.id, { index, flags, mode });
    res.json({ game: present(game), revealed: step.revealed, hit: step.hit });
});

export default router;
