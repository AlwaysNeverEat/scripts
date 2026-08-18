// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Дурак» — комнаты на 2–4 игроков, подкидной и переводной.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» + Enter);
// в остальном интерфейсе на неё ничего не ведёт.
//
// СЕРВЕР ЗДЕСЬ ЕДИНСТВЕННЫЙ, КТО ЗНАЕТ ПОЗИЦИЮ ЦЕЛИКОМ, и это не перестраховка,
// а устройство игры: в карты играют закрытыми. Каждому уезжает его ВИД на стол
// (viewFor в shared/durak.js) — своя рука, размеры чужих рук, стол и отбой.
// Отсюда же следует, почему тут нет ничего похожего на сверку отпечатков из
// бильярда: клиенту нечего пересчитывать, он рисует то, что прислали.
//
// Живая игра сделана ОПРОСОМ раз в полторы секунды, а не веб-сокетами, — ровно
// как в бильярде и по той же причине: ходят по очереди, действует один человек,
// задержки не видно, а сокеты потребовали бы отдельной настройки nginx
// (DEPLOY-VPS.md) ради того, чего никто не заметит.
//
// Партии с ботом сюда не приходят: они целиком в браузере и в таблицу очков не
// идут — иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// настрелял побед по Новичку.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
    lobby, createRoom, joinRoom, startRoom, leaveRoom,
    getGame, playMove, resignGame, claimGame,
} from '../durak/games.js';
import { leaderboard } from '../durak/scores.js';

const router = Router();

// Отказ по правилам («сейчас не ваш ход», «комнату уже заняли») — это НЕ ошибка
// сети: окну надо показать строчку, а не «сервер не отвечает». Поэтому такие
// ответы уезжают с кодом 200 и ok: false, как в остальных пасхалках.
const deny = (res, reason) => res.json({ ok: false, reason });

function fail(res, where, err) {
    console.error(where, err);
    res.status(500).json({ error: err.message });
}

// ── GET /api/durak/lobby ─────────────────────────────────────────────────────
// { open: [...], mine: [...], top: { rows, me } }
router.get('/lobby', async (req, res) => {
    try {
        const [board, top] = await Promise.all([lobby(req.user.id), leaderboard(req.user.id)]);
        res.json({ ...board, top });
    } catch (err) { fail(res, 'GET /api/durak/lobby', err); }
});

// ── POST /api/durak/room ─────────────────────────────────────────────────────
// { seats, mode } — комната висит в лобби, пока не наберётся народ.
router.post('/room', async (req, res) => {
    try {
        const made = await createRoom(req.user.id, {
            seats: req.body?.seats,
            mode: req.body?.mode,
        });
        if (!made.ok) return deny(res, made.reason);
        res.json({ ok: true, id: made.id });
    } catch (err) { fail(res, 'POST /api/durak/room', err); }
});

// ── POST /api/durak/room/:id/join ────────────────────────────────────────────
// Занять место. Последнее место сразу начинает партию.
router.post('/room/:id/join', async (req, res) => {
    try {
        const joined = await joinRoom(req.params.id, req.user.id);
        if (!joined.ok) return deny(res, joined.reason);
        res.json(joined);
    } catch (err) { fail(res, 'POST /api/durak/room/:id/join', err); }
});

// ── POST /api/durak/room/:id/start ───────────────────────────────────────────
// Начать неполным столом. Только хозяину комнаты.
router.post('/room/:id/start', async (req, res) => {
    try {
        const started = await startRoom(req.params.id, req.user.id);
        if (!started.ok) return deny(res, started.reason);
        res.json(started);
    } catch (err) { fail(res, 'POST /api/durak/room/:id/start', err); }
});

// ── DELETE /api/durak/room/:id ───────────────────────────────────────────────
// Встать из-за стола до начала. Хозяин уносит комнату с собой.
router.delete('/room/:id', async (req, res) => {
    try {
        const gone = await leaveRoom(req.params.id, req.user.id);
        res.json({ ok: gone.ok });
    } catch (err) { fail(res, 'DELETE /api/durak/room/:id', err); }
});

// ── GET /api/durak/game/:id ──────────────────────────────────────────────────
// ?since=N — номер хода, который клиент уже видел. Если сервер не ушёл вперёд,
// ответ приходит без вида на стол: при опросе раз в полторы секунды это девять
// ответов из десяти.
router.get('/game/:id', async (req, res) => {
    try {
        const since = req.query.since == null ? -1 : Math.trunc(Number(req.query.since));
        const game = await getGame(req.params.id, req.user.id, Number.isFinite(since) ? since : -1);
        if (!game) return res.status(404).json({ error: 'партия не найдена' });
        res.json(game);
    } catch (err) { fail(res, 'GET /api/durak/game/:id', err); }
});

// ── POST /api/durak/game/:id/move ────────────────────────────────────────────
// { seq, type, card? } → партия целиком (как GET) или { ok: false, reason }
//
// seq — номер хода, каким его видит клиент: повторно отправленный ход не
// применится дважды. Проверку самого хода делает shared/durak.js, здесь только
// приводим числа к целым — на входе может быть что угодно.
router.post('/game/:id/move', async (req, res) => {
    const body = req.body || {};
    const move = { type: String(body.type || '') };
    if (body.card != null) move.card = Math.trunc(Number(body.card));

    try {
        const played = await playMove(req.params.id, req.user.id, Math.trunc(Number(body.seq)), move);
        if (!played.ok) {
            // Отказ пишем в лог с причиной: «ход не принят» посреди партии — это
            // либо расхождение с клиентом, либо чья-то попытка сходить за
            // соседа, и знать о таком стоит.
            console.warn('POST /api/durak/game/:id/move: ход не принят', played.reason);
            return deny(res, played.reason);
        }
        res.json(played);
    } catch (err) { fail(res, 'POST /api/durak/game/:id/move', err); }
});

// ── POST /api/durak/game/:id/resign ──────────────────────────────────────────
router.post('/game/:id/resign', async (req, res) => {
    try {
        const done = await resignGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/durak/game/:id/resign', err); }
});

// ── POST /api/durak/game/:id/claim ───────────────────────────────────────────
// Закрыть партию, в которой соперник не ходит сутки (см. durak/games.js).
router.post('/game/:id/claim', async (req, res) => {
    try {
        const done = await claimGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/durak/game/:id/claim', err); }
});

// ── GET /api/durak/top ───────────────────────────────────────────────────────
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/durak/top', err); }
});

export default router;
