// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Шашки» (русские) — вызовы в лобби и партии один на один.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» + Enter);
// в остальном интерфейсе на неё ничего не ведёт.
//
// СЕРВЕР ЗДЕСЬ АРБИТР, А НЕ ХРАНИТЕЛЬ ТАЙНЫ, и это главное отличие от дурака с
// морским боем: там наружу уезжает ВИД на позицию, потому что чужая рука и чужая
// расстановка закрыты. В шашках закрытого нет ничего — доска на виду у обоих с
// первого хода, и позиция уезжает целиком. Партию сервер всё равно ведёт, но по
// другой причине — той же, что в бильярде: игра парная, и очко, приписанное
// себе, отнято у живого человека.
//
// Живая игра сделана ОПРОСОМ раз в полторы секунды, а не веб-сокетами, — ровно
// как в бильярде, дураке и морском бое и по той же причине: ходят по очереди,
// действует один человек, задержки не видно, а сокеты потребовали бы отдельной
// настройки nginx (DEPLOY-VPS.md) ради того, чего никто не заметит.
//
// Партии с ботом сюда не приходят: они целиком в браузере и в таблицу очков не
// идут — иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// набил побед по Новичку.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
    lobby, createChallenge, joinChallenge, cancelChallenge,
    getGame, playHop, resignGame, claimGame, offerDraw, cancelDraw,
} from '../checkers/games.js';
import { leaderboard } from '../checkers/scores.js';

const router = Router();

// Отказ по правилам («сейчас не ваш ход», «вызов уже приняли», «так пойти
// нельзя») — это НЕ ошибка сети: окну надо показать строчку, а не «сервер не
// отвечает». Поэтому такие ответы уезжают с кодом 200 и ok: false, как в
// остальных пасхалках.
const deny = (res, reason) => res.json({ ok: false, reason });

function fail(res, where, err) {
    console.error(where, err);
    res.status(500).json({ error: err.message });
}

// ── GET /api/checkers/lobby ──────────────────────────────────────────────────
// { open: [...], mine: [...], top: { rows, me } }
router.get('/lobby', async (req, res) => {
    try {
        const [board, top] = await Promise.all([lobby(req.user.id), leaderboard(req.user.id)]);
        res.json({ ...board, top });
    } catch (err) { fail(res, 'GET /api/checkers/lobby', err); }
});

// ── POST /api/checkers/challenge ─────────────────────────────────────────────
// Бросить вызов: он висит в лобби, пока его кто-нибудь не примет.
router.post('/challenge', async (req, res) => {
    try {
        const made = await createChallenge(req.user.id);
        if (!made.ok) return deny(res, made.reason);
        res.json({ ok: true, id: made.id });
    } catch (err) { fail(res, 'POST /api/checkers/challenge', err); }
});

// ── POST /api/checkers/challenge/:id/join ────────────────────────────────────
router.post('/challenge/:id/join', async (req, res) => {
    try {
        const joined = await joinChallenge(req.params.id, req.user.id);
        if (!joined.ok) return deny(res, joined.reason);
        res.json(joined);
    } catch (err) { fail(res, 'POST /api/checkers/challenge/:id/join', err); }
});

// ── DELETE /api/checkers/challenge/:id ───────────────────────────────────────
router.delete('/challenge/:id', async (req, res) => {
    try {
        const gone = await cancelChallenge(req.params.id, req.user.id);
        res.json({ ok: gone.ok });
    } catch (err) { fail(res, 'DELETE /api/checkers/challenge/:id', err); }
});

// ── GET /api/checkers/game/:id ───────────────────────────────────────────────
// ?since=N — номер прыжка, который клиент уже видел. Если сервер не ушёл вперёд,
// ответ приходит без позиции: при опросе раз в полторы секунды это девять
// ответов из десяти.
router.get('/game/:id', async (req, res) => {
    try {
        const since = req.query.since == null ? -1 : Math.trunc(Number(req.query.since));
        const game = await getGame(req.params.id, req.user.id, Number.isFinite(since) ? since : -1);
        if (!game) return res.status(404).json({ error: 'партия не найдена' });
        res.json(game);
    } catch (err) { fail(res, 'GET /api/checkers/game/:id', err); }
});

// ── POST /api/checkers/game/:id/move ─────────────────────────────────────────
// { seq, from, to } → партия целиком (как GET) или { ok: false, reason }
//
// Ход — ОДИН прыжок, а не вся цепочка: если побившая шашка может бить дальше,
// сервер оставляет ход за ней и ждёт следующего запроса (см. shared/checkers.js).
// Законность прыжка проверяют правила, здесь только приводим числа к целым — на
// входе может быть что угодно.
router.post('/game/:id/move', async (req, res) => {
    const body = req.body || {};
    try {
        const played = await playHop(
            req.params.id, req.user.id,
            Math.trunc(Number(body.seq)),
            Math.trunc(Number(body.from)), Math.trunc(Number(body.to)),
        );
        if (!played.ok) {
            // «Так пойти нельзя» посреди партии — это либо расхождение с
            // клиентом, либо чья-то попытка сходить за соседа, и знать о таком
            // стоит.
            console.warn('POST /api/checkers/game/:id/move: ход не принят', played.reason);
            return deny(res, played.reason);
        }
        res.json(played);
    } catch (err) { fail(res, 'POST /api/checkers/game/:id/move', err); }
});

// ── POST /api/checkers/game/:id/resign ───────────────────────────────────────
router.post('/game/:id/resign', async (req, res) => {
    try {
        const done = await resignGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/checkers/game/:id/resign', err); }
});

// ── POST /api/checkers/game/:id/draw ─────────────────────────────────────────
// Одна ручка на «предложить» и «согласиться»: для игрока это одна кнопка, а что
// именно она сделает, решает не он, а то, предлагали ли ему (см. checkers/games.js).
router.post('/game/:id/draw', async (req, res) => {
    try {
        const done = await offerDraw(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/checkers/game/:id/draw', err); }
});

// ── DELETE /api/checkers/game/:id/draw ───────────────────────────────────────
router.delete('/game/:id/draw', async (req, res) => {
    try {
        const done = await cancelDraw(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'DELETE /api/checkers/game/:id/draw', err); }
});

// ── POST /api/checkers/game/:id/claim ────────────────────────────────────────
// Закрыть партию, в которой соперник не ходит сутки (см. checkers/games.js).
router.post('/game/:id/claim', async (req, res) => {
    try {
        const done = await claimGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/checkers/game/:id/claim', err); }
});

// ── GET /api/checkers/top ────────────────────────────────────────────────────
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/checkers/top', err); }
});

export default router;
