// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Пасьянс» (косынка) — мини-топ по времени.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Как и в тетрисе с тройкой, сервер партию НЕ ведёт: карту тянут мышью, и
// спрашивать «а можно сюда?» через сеть на каждое движение нельзя (подробнее —
// в шапке shared/solitaire.js). Поэтому ручек всего две: взять топ при открытии
// окна и записать результат разложенной партии.
//
// Незаконченные партии сюда не приходят вовсе: соревнуются временем, а у
// брошенной раскладки времени нет. Проверка (isPlausibleRun) отсекает мусор и
// «разложил за секунду» — это защита от мусора, а не от человека с открытой
// консолью, цена вопроса ровно та, что и у пасхалки.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { isPlausibleRun } from '../../../shared/solitaire.js';
import { leaderboard, saveRun } from '../solitaire/scores.js';

const router = Router();

// ── GET /api/solitaire/top ───────────────────────────────────────────────────
// { rows: [{ rank, id, display_name, avatar, role_prefix, seconds, moves,
//            redeals, wins }],
//   me: { rank, seconds, moves, redeals, wins } | null }
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) {
        console.error('GET /api/solitaire/top', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/solitaire/score ────────────────────────────────────────────────
// { seconds, moves, redeals } → { ok: true, best, wins, improved, rows, me }
//                            |  { ok: false }
//
// Топ возвращается тем же ответом: окно всё равно показывает его сразу после
// партии, и второй запрос за той же таблицей был бы лишним.
router.post('/score', async (req, res) => {
    const run = {
        seconds: Math.trunc(Number(req.body?.seconds)),
        moves: Math.trunc(Number(req.body?.moves)),
        redeals: Math.trunc(Number(req.body?.redeals)),
    };

    const check = isPlausibleRun(run);
    if (!check.ok) {
        // Отказ пишем в лог с причиной, а игроку отвечаем 200 и ok: false:
        // для окна это не сбой сети, а «результат не засчитан», и мешать эти
        // два случая на клиенте нельзя.
        console.warn('POST /api/solitaire/score: результат не принят', check.reason, run);
        return res.json({ ok: false });
    }

    try {
        const saved = await saveRun(req.user.id, run);
        const board = await leaderboard(req.user.id);
        res.json({ ok: true, ...saved, ...board });
    } catch (err) {
        console.error('POST /api/solitaire/score', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
