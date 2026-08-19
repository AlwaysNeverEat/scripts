// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Рогалик» (карточный забег) — мини-топ по пройденным циклам.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Сервер забег НЕ ведёт: игрок один, соперника нет, закрытой чужой информации
// нет — прятать не от кого (подробнее — в шапке shared/roguelike.js). Поэтому
// ручек всего две: взять топ при открытии окна и записать результат в конце
// забега.
//
// Присланный результат проверяется общими правилами (isPlausibleRun): циклы
// однозначно связаны с числом пройденных узлов, узлы — с числом боёв, а секунды
// — с числом ходов. Это защита от мусора и от «сто циклов за минуту», а не от
// человека с открытой консолью — цена вопроса ровно та, что и у пасхалки.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { isPlausibleRun } from '../../../shared/roguelike.js';
import { leaderboard, saveRun } from '../roguelike/scores.js';

const router = Router();

// ── GET /api/roguelike/top ───────────────────────────────────────────────────
// { rows: [{ rank, id, display_name, avatar, role_prefix, faculty, loops, floor,
//            kills, elites, bosses, cards, level, mutations, runs }],
//   me: { rank, loops, floor, ... } | null }
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) {
        console.error('GET /api/roguelike/top', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/roguelike/run ──────────────────────────────────────────────────
// { loops, floor, kills, elites, bosses, cards, level, mutations, seconds }
//   → { ok: true, best, runs, improved, rows, me } | { ok: false }
//
// Топ возвращается тем же ответом: окно всё равно показывает его сразу после
// смерти, и второй запрос за той же таблицей был бы лишним.
router.post('/run', async (req, res) => {
    const int = (v, max) => Math.min(Math.max(Math.trunc(Number(v)) || 0, 0), max);
    const run = {
        loops: int(req.body?.loops, 1_000),
        floor: int(req.body?.floor, 100_000),
        kills: int(req.body?.kills, 100_000),
        turns: int(req.body?.turns, 1_000_000),
        cards: int(req.body?.cards, 10_000),
        level: int(req.body?.level, 10_000),
        seconds: int(req.body?.seconds, 24 * 3600),
    };
    // Элиты, боссы и мутации в проверку не входят: на место в топе они не
    // влияют, врать в них можно только себе, — зато потолок ставим, чтобы в
    // подпись строки не приехало число из шести цифр.
    const elites = int(req.body?.elites, 9_999);
    const bosses = int(req.body?.bosses, 9_999);
    const mutations = int(req.body?.mutations, 9_999);

    const check = isPlausibleRun(run);
    if (!check.ok) {
        // Отказ пишем в лог с причиной, а игроку отвечаем 200 и ok: false: для
        // окна это не сбой сети, а «результат не засчитан», и мешать эти два
        // случая на клиенте нельзя.
        console.warn('POST /api/roguelike/run: результат не принят', check.reason, run);
        return res.json({ ok: false });
    }

    try {
        const saved = await saveRun(req.user.id, { ...run, elites, bosses, mutations });
        const board = await leaderboard(req.user.id);
        res.json({ ok: true, ...saved, ...board });
    } catch (err) {
        console.error('POST /api/roguelike/run', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
