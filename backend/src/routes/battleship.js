// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Морской бой» — вызовы в лобби, расстановка и стрельба один на один.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» + Enter);
// в остальном интерфейсе на неё ничего не ведёт.
//
// СЕРВЕР ЗДЕСЬ ЕДИНСТВЕННЫЙ, КТО ЗНАЕТ ПОЗИЦИЮ ЦЕЛИКОМ, и это не
// перестраховка, а устройство игры: чужая расстановка — это вся игра, и браузер,
// которому её отдали, уже выиграл. Каждому уезжает его ВИД на партию (viewFor в
// shared/battleship.js) — свой флот, чужие выстрелы по нему, свои выстрелы по
// чужому полю и потопленные чужие корабли. Отсюда же следует, почему тут нет
// ничего похожего на сверку отпечатков из бильярда: клиенту нечего
// пересчитывать, он рисует то, что прислали.
//
// Живая игра сделана ОПРОСОМ раз в полторы секунды, а не веб-сокетами, — ровно
// как в бильярде и дураке и по той же причине: ходят по очереди, действует один
// человек, задержки не видно, а сокеты потребовали бы отдельной настройки nginx
// (DEPLOY-VPS.md) ради того, чего никто не заметит.
//
// Партии с ботом сюда не приходят: они целиком в браузере и в таблицу очков не
// идут — иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// настрелял побед по Юнге.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
    lobby, createChallenge, joinChallenge, cancelChallenge,
    getGame, place, playShot, resignGame, claimGame,
} from '../battleship/games.js';
import { leaderboard } from '../battleship/scores.js';

const router = Router();

// Отказ по правилам («сейчас не ваш ход», «вызов уже приняли», «корабли
// касаются») — это НЕ ошибка сети: окну надо показать строчку, а не «сервер не
// отвечает». Поэтому такие ответы уезжают с кодом 200 и ok: false, как в
// остальных пасхалках.
const deny = (res, reason) => res.json({ ok: false, reason });

function fail(res, where, err) {
    console.error(where, err);
    res.status(500).json({ error: err.message });
}

// ── GET /api/battleship/lobby ────────────────────────────────────────────────
// { open: [...], mine: [...], top: { rows, me } }
router.get('/lobby', async (req, res) => {
    try {
        const [board, top] = await Promise.all([lobby(req.user.id), leaderboard(req.user.id)]);
        res.json({ ...board, top });
    } catch (err) { fail(res, 'GET /api/battleship/lobby', err); }
});

// ── POST /api/battleship/challenge ───────────────────────────────────────────
// Бросить вызов: он висит в лобби, пока его кто-нибудь не примет.
router.post('/challenge', async (req, res) => {
    try {
        const made = await createChallenge(req.user.id);
        if (!made.ok) return deny(res, made.reason);
        res.json({ ok: true, id: made.id });
    } catch (err) { fail(res, 'POST /api/battleship/challenge', err); }
});

// ── POST /api/battleship/challenge/:id/join ──────────────────────────────────
router.post('/challenge/:id/join', async (req, res) => {
    try {
        const joined = await joinChallenge(req.params.id, req.user.id);
        if (!joined.ok) return deny(res, joined.reason);
        res.json(joined);
    } catch (err) { fail(res, 'POST /api/battleship/challenge/:id/join', err); }
});

// ── DELETE /api/battleship/challenge/:id ─────────────────────────────────────
router.delete('/challenge/:id', async (req, res) => {
    try {
        const gone = await cancelChallenge(req.params.id, req.user.id);
        res.json({ ok: gone.ok });
    } catch (err) { fail(res, 'DELETE /api/battleship/challenge/:id', err); }
});

// ── GET /api/battleship/game/:id ─────────────────────────────────────────────
// ?since=N — номер хода, который клиент уже видел. Если сервер не ушёл вперёд,
// ответ приходит без вида на позицию: при опросе раз в полторы секунды это
// девять ответов из десяти.
router.get('/game/:id', async (req, res) => {
    try {
        const since = req.query.since == null ? -1 : Math.trunc(Number(req.query.since));
        const game = await getGame(req.params.id, req.user.id, Number.isFinite(since) ? since : -1);
        if (!game) return res.status(404).json({ error: 'партия не найдена' });
        res.json(game);
    } catch (err) { fail(res, 'GET /api/battleship/game/:id', err); }
});

// ── POST /api/battleship/game/:id/fleet ──────────────────────────────────────
// { ships: [{ x, y, len, dir }] } → партия целиком (как GET) или { ok:false, reason }
//
// Без seq, в отличие от выстрела, и это не забывчивость: расставляются оба
// ОДНОВРЕМЕННО, и номер хода тут ничей (см. place в battleship/games.js).
// Законность самой расстановки проверяет shared/battleship.js.
router.post('/game/:id/fleet', async (req, res) => {
    try {
        const done = await place(req.params.id, req.user.id, req.body?.ships);
        if (!done.ok) {
            // Отказ пишем в лог: расстановка приезжает из окна уже проверенной,
            // и «корабли касаются» с той стороны означает либо расхождение
            // правил, либо попытку прислать флот руками.
            console.warn('POST /api/battleship/game/:id/fleet: флот не принят', done.reason);
            return deny(res, done.reason);
        }
        res.json(done);
    } catch (err) { fail(res, 'POST /api/battleship/game/:id/fleet', err); }
});

// ── POST /api/battleship/game/:id/shot ───────────────────────────────────────
// { seq, cell } → партия целиком (как GET) или { ok: false, reason }
//
// seq — номер хода, каким его видит клиент: повторно отправленный выстрел не
// применится дважды. Проверку самого выстрела делает shared/battleship.js, здесь
// только приводим числа к целым — на входе может быть что угодно.
router.post('/game/:id/shot', async (req, res) => {
    const body = req.body || {};
    try {
        const played = await playShot(
            req.params.id, req.user.id,
            Math.trunc(Number(body.seq)), Math.trunc(Number(body.cell)),
        );
        if (!played.ok) {
            // «Не ваш ход» посреди партии — это либо расхождение с клиентом,
            // либо чья-то попытка выстрелить за соседа, и знать о таком стоит.
            console.warn('POST /api/battleship/game/:id/shot: выстрел не принят', played.reason);
            return deny(res, played.reason);
        }
        res.json(played);
    } catch (err) { fail(res, 'POST /api/battleship/game/:id/shot', err); }
});

// ── POST /api/battleship/game/:id/resign ─────────────────────────────────────
router.post('/game/:id/resign', async (req, res) => {
    try {
        const done = await resignGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/battleship/game/:id/resign', err); }
});

// ── POST /api/battleship/game/:id/claim ──────────────────────────────────────
// Закрыть партию, в которой соперник не ходит сутки (см. battleship/games.js).
router.post('/game/:id/claim', async (req, res) => {
    try {
        const done = await claimGame(req.params.id, req.user.id);
        if (!done.ok) return deny(res, done.reason);
        res.json(done);
    } catch (err) { fail(res, 'POST /api/battleship/game/:id/claim', err); }
});

// ── GET /api/battleship/top ──────────────────────────────────────────────────
router.get('/top', async (req, res) => {
    try {
        res.json(await leaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/battleship/top', err); }
});

export default router;
