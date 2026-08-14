// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тетрис» — мини-топ.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Здесь, в отличие от сапёра, сервер партию НЕ ведёт: тридцать действий в
// секунду через сеть не гоняют, и на первом же подлагивании игра стала бы
// неиграбельной (подробнее — в шапке shared/tetris.js). Поэтому ручек всего
// две: взять топ при открытии окна и записать результат в конце партии.
//
// Присланный результат проверяется на правдоподобность общими правилами
// (isPlausibleRun): отсекает мусор и «999999 за минуту». Это защита от
// опечатки и от случайного дубля, а не от человека с открытой консолью —
// цена вопроса ровно та, что и у пасхалки.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { isPlausibleRun, levelFor } from '../../../shared/tetris.js';
import { leaderboard, saveRun } from '../tetris/scores.js';

const router = Router();

// ── GET /api/tetris/top ──────────────────────────────────────────────────────
// { rows: [{ rank, id, display_name, avatar, role_prefix, score, lines, games }],
//   me: { rank, score, lines, level, games } | null }
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) {
        console.error('GET /api/tetris/top', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/tetris/score ───────────────────────────────────────────────────
// { score, lines, pieces, seconds } → { ok: true, best, improved, rows, me }
//                                  |  { ok: false }
//
// Топ возвращается тем же ответом: окно всё равно показывает его сразу после
// партии, и второй запрос за той же таблицей был бы лишним.
router.post('/score', async (req, res) => {
    const run = {
        score: Math.trunc(Number(req.body?.score)),
        lines: Math.trunc(Number(req.body?.lines)),
        pieces: Math.trunc(Number(req.body?.pieces)),
        seconds: Math.trunc(Number(req.body?.seconds)),
    };

    const check = isPlausibleRun(run);
    if (!check.ok) {
        // Отказ пишем в лог с причиной, а игроку отвечаем 200 и ok: false:
        // для окна это не сбой сети, а «результат не засчитан», и мешать эти
        // два случая на клиенте нельзя.
        console.warn('POST /api/tetris/score: результат не принят', check.reason, run);
        return res.json({ ok: false });
    }

    try {
        // Уровень не берём из тела запроса: он ОДНОЗНАЧНО считается по линиям
        // (см. levelFor), и отдельное поле в запросе — просто ещё одно место,
        // где данные могут разъехаться.
        const saved = await saveRun(req.user.id, { ...run, level: levelFor(run.lines) });
        const board = await leaderboard(req.user.id);
        res.json({ ok: true, ...saved, ...board });
    } catch (err) {
        console.error('POST /api/tetris/score', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
