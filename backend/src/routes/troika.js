// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тройка» (матч-3 на время) — мини-топ.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Как и в тетрисе, сервер партию НЕ ведёт: игра идёт на время, каскад надо
// показать в тот же кадр, и гонять это через сеть нельзя (подробнее — в шапке
// shared/troika.js). Поэтому ручек всего две: взять топ при открытии окна и
// записать результат в конце партии.
//
// Присланный результат проверяется общими правилами (isPlausibleRun): длина
// партии однозначно ограничена собранными часами, а счёт — числом убранных
// фишек. Это защита от мусора и от «999999 за минуту», а не от человека с
// открытой консолью — цена вопроса ровно та, что и у пасхалки.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { isPlausibleRun, levelFor } from '../../../shared/troika.js';
import { leaderboard, saveRun } from '../troika/scores.js';

const router = Router();

// ── GET /api/troika/top ──────────────────────────────────────────────────────
// { rows: [{ rank, id, display_name, avatar, role_prefix, score, level, clocks,
//            cascade, games }],
//   me: { rank, score, level, clocks, cascade, games } | null }
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) {
        console.error('GET /api/troika/top', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/troika/score ───────────────────────────────────────────────────
// { score, moves, tiles, clocks, cascade, seconds } → { ok: true, best, improved, rows, me }
//                                                  |  { ok: false }
//
// Топ возвращается тем же ответом: окно всё равно показывает его сразу после
// партии, и второй запрос за той же таблицей был бы лишним.
router.post('/score', async (req, res) => {
    const run = {
        score: Math.trunc(Number(req.body?.score)),
        moves: Math.trunc(Number(req.body?.moves)),
        tiles: Math.trunc(Number(req.body?.tiles)),
        clocks: Math.trunc(Number(req.body?.clocks)),
        seconds: Math.trunc(Number(req.body?.seconds)),
    };
    // Длина каскада в проверку не входит: на счёт она не влияет напрямую (влияет
    // через очки, которые уже проверены), и врать в ней можно только себе — зато
    // потолок ставим, чтобы в подпись строки не приехало число из шести цифр.
    const cascade = Math.min(Math.max(Math.trunc(Number(req.body?.cascade)) || 0, 0), 999);

    const check = isPlausibleRun(run);
    if (!check.ok) {
        // Отказ пишем в лог с причиной, а игроку отвечаем 200 и ok: false:
        // для окна это не сбой сети, а «результат не засчитан», и мешать эти
        // два случая на клиенте нельзя.
        console.warn('POST /api/troika/score: результат не принят', check.reason, run);
        return res.json({ ok: false });
    }

    try {
        // Уровень не берём из тела запроса: он ОДНОЗНАЧНО считается по очкам
        // (см. levelFor), и отдельное поле в запросе — просто ещё одно место,
        // где данные могут разъехаться.
        const saved = await saveRun(req.user.id, {
            ...run, cascade, level: levelFor(run.score),
        });
        const board = await leaderboard(req.user.id);
        res.json({ ok: true, ...saved, ...board });
    } catch (err) {
        console.error('POST /api/troika/score', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
