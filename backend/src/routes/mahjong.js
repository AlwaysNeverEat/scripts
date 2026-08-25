// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Маджонг» (пасьянс-маджонг, «черепаха») — мини-топ по времени.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Как в тетрисе, тройке и пасьянсе, сервер партию НЕ ведёт: все 144 фишки лежат
// лицом вверх, соперника нет, прятать не от кого (подробнее — в шапке
// shared/mahjong.js). Поэтому ручек всего две: взять топ при открытии окна и
// записать результат разобранной партии.
//
// Незаконченные партии сюда не приходят вовсе: соревнуются временем, а у
// брошенного стола времени нет. Проверка (isPlausibleRun) отсекает мусор и
// «разобрал за секунду» — это защита от мусора, а не от человека с открытой
// консолью, цена вопроса ровно та, что и у пасхалки.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { isPlausibleRun } from '../../../shared/mahjong.js';
import { leaderboard, saveRun } from '../mahjong/scores.js';

const router = Router();

// ── GET /api/mahjong/top ─────────────────────────────────────────────────────
// { rows: [{ rank, id, display_name, avatar, role_prefix, faculty, seconds,
//            shuffles, wins }],
//   me: { rank, seconds, shuffles, wins } | null }
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) {
        console.error('GET /api/mahjong/top', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/mahjong/score ──────────────────────────────────────────────────
// { seconds, shuffles } → { ok: true, best, wins, improved, rows, me }
//                      |  { ok: false }
//
// Топ возвращается тем же ответом: окно всё равно показывает его сразу после
// партии, и второй запрос за той же таблицей был бы лишним.
router.post('/score', async (req, res) => {
    const run = {
        seconds: Math.trunc(Number(req.body?.seconds)),
        shuffles: Math.trunc(Number(req.body?.shuffles)),
    };

    const check = isPlausibleRun(run);
    if (!check.ok) {
        // Отказ пишем в лог с причиной, а игроку отвечаем 200 и ok: false:
        // для окна это не сбой сети, а «результат не засчитан», и мешать эти
        // два случая на клиенте нельзя.
        console.warn('POST /api/mahjong/score: результат не принят', check.reason, run);
        return res.json({ ok: false });
    }

    try {
        const saved = await saveRun(req.user.id, run);
        const board = await leaderboard(req.user.id);
        res.json({ ok: true, ...saved, ...board });
    } catch (err) {
        console.error('POST /api/mahjong/score', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
