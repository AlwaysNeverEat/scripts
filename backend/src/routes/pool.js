// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Бильярд» (восьмёрка) — партии двух игроков и таблица очков.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» + Enter);
// в остальном интерфейсе на неё ничего не ведёт.
//
// В отличие от остальных пасхалок, сервер здесь ВЕДЁТ ПАРТИЮ: принимает удар,
// применяет его своей копией правил (shared/pool.js) и хранит получившуюся
// позицию. Причина — в шапке backend/src/pool/games.js: игра парная, и верить
// браузеру на слово нельзя, потому что приписанное себе очко отнято у живого
// человека.
//
// Живая игра вдвоём сделана ОПРОСОМ, а не сокетами, и это осознанно. Ходят по
// очереди, действует один человек, а по сети уезжает удар из четырёх чисел —
// задержка в секунду тут не видна вовсе. Веб-сокеты потребовали бы отдельной
// настройки nginx на сервере (DEPLOY-VPS.md) ради того, чего никто не заметит.
//
// Партии с ботом сюда не приходят: они целиком в браузере и в таблицу очков не
// идут — иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// настрелял побед по лёгкому сопернику.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
    lobby, createChallenge, joinChallenge, cancelChallenge,
    getGame, playShot, resignGame, claimGame,
} from '../pool/games.js';
import { leaderboard } from '../pool/scores.js';

const router = Router();

// Отказ по правилам («сейчас не ваш ход», «вызов уже приняли») — это НЕ ошибка
// сети: окну надо показать строчку, а не «сервер не отвечает». Поэтому такие
// ответы уезжают с кодом 200 и ok: false, как в остальных пасхалках.
const deny = (res, reason) => res.json({ ok: false, reason });

function fail(res, where, err) {
    console.error(where, err);
    res.status(500).json({ error: err.message });
}

// ── GET /api/pool/lobby ──────────────────────────────────────────────────────
// { open: [...], mine: [...], top: { rows, me } }
router.get('/lobby', async (req, res) => {
    try {
        const [board, top] = await Promise.all([lobby(req.user.id), leaderboard(req.user.id)]);
        res.json({ ...board, top });
    } catch (err) { fail(res, 'GET /api/pool/lobby', err); }
});

// ── POST /api/pool/challenge ─────────────────────────────────────────────────
// Бросить вызов: партия висит в лобби, пока её кто-нибудь не примет.
router.post('/challenge', async (req, res) => {
    try {
        const made = await createChallenge(req.user.id);
        if (!made.ok) return deny(res, made.reason);
        res.json({ ok: true, id: made.id });
    } catch (err) { fail(res, 'POST /api/pool/challenge', err); }
});

// ── POST /api/pool/challenge/:id/join ────────────────────────────────────────
router.post('/challenge/:id/join', async (req, res) => {
    try {
        const joined = await joinChallenge(req.params.id, req.user.id);
        if (!joined.ok) return deny(res, joined.reason);
        res.json({ ok: true, id: joined.id });
    } catch (err) { fail(res, 'POST /api/pool/challenge/:id/join', err); }
});

// ── DELETE /api/pool/challenge/:id ───────────────────────────────────────────
router.delete('/challenge/:id', async (req, res) => {
    try {
        const gone = await cancelChallenge(req.params.id, req.user.id);
        res.json({ ok: gone.ok });
    } catch (err) { fail(res, 'DELETE /api/pool/challenge/:id', err); }
});

// ── GET /api/pool/game/:id ───────────────────────────────────────────────────
// ?since=N — номер удара, который клиент уже видел. Если сервер не ушёл вперёд,
// ответ приходит без позиции: при опросе раз в полторы секунды это девять
// ответов из десяти.
router.get('/game/:id', async (req, res) => {
    try {
        const since = req.query.since == null ? -1 : Math.trunc(Number(req.query.since));
        const game = await getGame(req.params.id, req.user.id, Number.isFinite(since) ? since : -1);
        if (!game) return res.status(404).json({ error: 'партия не найдена' });
        res.json(game);
    } catch (err) { fail(res, 'GET /api/pool/game/:id', err); }
});

// ── POST /api/pool/game/:id/shot ─────────────────────────────────────────────
// { seq, dx, dy, power, cx?, cy? } → { ok, seq, outcome, state, hash }
//
// seq — номер хода, каким его видит клиент: повторно отправленный удар не
// применится дважды. Проверку самого удара делает shared/pool.js, здесь только
// приводим числа к целым — на входе может быть что угодно.
router.post('/game/:id/shot', async (req, res) => {
    const body = req.body || {};
    const shot = {
        dx: Math.trunc(Number(body.dx)),
        dy: Math.trunc(Number(body.dy)),
        power: Math.trunc(Number(body.power)),
    };
    if (body.cx != null && body.cy != null) {
        shot.cx = Math.trunc(Number(body.cx));
        shot.cy = Math.trunc(Number(body.cy));
    }

    try {
        const played = await playShot(req.params.id, req.user.id, Math.trunc(Number(body.seq)), shot);
        if (!played.ok) {
            // Отказ пишем в лог с причиной: «удар не принят» посреди партии —
            // это либо расхождение с клиентом, либо чья-то попытка сходить за
            // соперника, и знать о таком стоит.
            console.warn('POST /api/pool/game/:id/shot: удар не принят', played.reason);
            return deny(res, played.reason);
        }
        res.json(played);
    } catch (err) { fail(res, 'POST /api/pool/game/:id/shot', err); }
});

// ── POST /api/pool/game/:id/resign ───────────────────────────────────────────
router.post('/game/:id/resign', async (req, res) => {
    try {
        const done = await resignGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/pool/game/:id/resign', err); }
});

// ── POST /api/pool/game/:id/claim ────────────────────────────────────────────
// Забрать партию, в которой соперник не ходит сутки (см. games.js).
router.post('/game/:id/claim', async (req, res) => {
    try {
        const done = await claimGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/pool/game/:id/claim', err); }
});

// ── GET /api/pool/top ────────────────────────────────────────────────────────
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/pool/top', err); }
});

export default router;
