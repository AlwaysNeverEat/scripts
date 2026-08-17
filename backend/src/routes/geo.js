// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Гео» — угадать место по снимку улицы. Режимы: дейли, соло, дуэль.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Здесь, в отличие от тетриса с тройкой, сервер ведёт ВСЁ и во всех режимах:
// правильный ответ — это координата, и она же секрет (почему так — в шапке
// shared/geo.js). Браузер получает id снимка и присылает точку на карте,
// расстояние и очки считаются тут.
//
// Отказ по правилам («уже отвечал сегодня», «вызов увели») — это 200 и
// ok: false: для окна игры это не сбой сети, и мешать эти два случая на клиенте
// нельзя. 500 остаётся за настоящими поломками.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
    MAX_SCORE, SOLO_ROUNDS, DUEL_HP, DUEL_MODES, DUEL_MODE_NAMES,
    DUEL_ROUND_SECONDS, DUEL_REVEAL_SECONDS, DUEL_WIN_PTS, isGuess,
} from '../../../shared/geo.js';
import { COUNTRIES } from '../../../shared/geoPoints.js';
import { token, hasToken } from '../geo/panoramas.js';
import * as daily from '../geo/daily.js';
import * as solo from '../geo/solo.js';
import * as duels from '../geo/duels.js';
import { dailyLeaderboard, soloLeaderboard, duelLeaderboard } from '../geo/scores.js';

const router = Router();

const deny = (res, reason) => res.json({ ok: false, reason });

function fail(res, where, err) {
    console.error(where, err);
    res.status(500).json({ error: err.message });
}

// Точка с карты. Кривые числа — отказ, а не «ноль очков»: ноль игрок должен
// получать за плохую догадку, а не за подвисший скрипт.
function readGuess(body) {
    const guess = { lat: Number(body?.lat), lng: Number(body?.lng) };
    return isGuess(guess) ? guess : null;
}

// ── GET /api/geo/config ──────────────────────────────────────────────────────
// Токен для просмотрщика снимков и числа правил, чтобы окно не хранило их копию.
//
// Токен приезжает ЗАПРОСОМ, а не запекается в сборку сайта: пересобирать
// статику ради его смены — лишний повод сломать прод. Публичности он не боится:
// клиентский токен Mapillary на то и клиентский, снимки в браузере без него не
// показать.
router.get('/config', (req, res) => {
    res.json({
        ok: hasToken(),
        token: token(),
        max_score: MAX_SCORE,
        solo_rounds: SOLO_ROUNDS,
        countries: COUNTRIES,
        duel: {
            hp: DUEL_HP,
            modes: DUEL_MODES.map(id => ({ id, name: DUEL_MODE_NAMES[id] })),
            round_seconds: DUEL_ROUND_SECONDS,
            reveal_seconds: DUEL_REVEAL_SECONDS,
            win_pts: DUEL_WIN_PTS,
        },
    });
});

// ── Дейли ────────────────────────────────────────────────────────────────────

// GET /api/geo/daily → { round, rows, me } | { ok: false, reason: 'no_point' }
router.get('/daily', async (req, res) => {
    if (!hasToken()) return deny(res, 'no_key');
    try {
        const [round, board] = await Promise.all([daily.today(req.user.id), dailyLeaderboard(req.user.id)]);
        if (!round) return deny(res, 'no_point');
        res.json({ ok: true, round, ...board });
    } catch (err) { fail(res, 'GET /api/geo/daily', err); }
});

// POST /api/geo/daily/guess { lat, lng } → { ok, result, rows, me }
router.post('/daily/guess', async (req, res) => {
    const guess = readGuess(req.body);
    if (!guess) return deny(res, 'bad_guess');
    try {
        res.json(await daily.answer(req.user.id, guess));
    } catch (err) { fail(res, 'POST /api/geo/daily/guess', err); }
});

router.get('/daily/top', async (req, res) => {
    try {
        res.json(await dailyLeaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/geo/daily/top', err); }
});

// ── Соло ─────────────────────────────────────────────────────────────────────

// GET /api/geo/solo → { run: … | null, rows, me }
router.get('/solo', async (req, res) => {
    try {
        const [run, board] = await Promise.all([solo.current(req.user.id), soloLeaderboard(req.user.id)]);
        res.json({ ok: true, run, ...board });
    } catch (err) { fail(res, 'GET /api/geo/solo', err); }
});

// POST /api/geo/solo/start → { ok, run }
router.post('/solo/start', async (req, res) => {
    if (!hasToken()) return deny(res, 'no_key');
    try {
        const run = await solo.start(req.user.id);
        if (!run) return deny(res, 'no_point');
        res.json({ ok: true, run });
    } catch (err) { fail(res, 'POST /api/geo/solo/start', err); }
});

// POST /api/geo/solo/guess { id, lat, lng } → { ok, …партия, [best, rows, me] }
router.post('/solo/guess', async (req, res) => {
    const guess = readGuess(req.body);
    if (!guess) return deny(res, 'bad_guess');
    try {
        res.json(await solo.answer(req.user.id, String(req.body?.id || ''), guess));
    } catch (err) { fail(res, 'POST /api/geo/solo/guess', err); }
});

router.post('/solo/abandon', async (req, res) => {
    try {
        res.json(await solo.abandon(req.user.id, String(req.body?.id || '')));
    } catch (err) { fail(res, 'POST /api/geo/solo/abandon', err); }
});

router.get('/solo/top', async (req, res) => {
    try {
        res.json(await soloLeaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/geo/solo/top', err); }
});

// ── Дуэль ────────────────────────────────────────────────────────────────────
//
// Ручки лобби и топа объявлены ДО /duel/:id: иначе «top» уедет в :id и станет
// поиском партии с таким номером.

router.get('/duel/lobby', async (req, res) => {
    try {
        res.json(await duels.lobby(req.user.id));
    } catch (err) { fail(res, 'GET /api/geo/duel/lobby', err); }
});

router.get('/duel/top', async (req, res) => {
    try {
        res.json(await duelLeaderboard(req.user.id));
    } catch (err) { fail(res, 'GET /api/geo/duel/top', err); }
});

// POST /api/geo/duel/challenge { mode } → { ok, id }
router.post('/duel/challenge', async (req, res) => {
    if (!hasToken()) return deny(res, 'no_key');
    try {
        res.json(await duels.createChallenge(req.user.id, String(req.body?.mode || 'move')));
    } catch (err) { fail(res, 'POST /api/geo/duel/challenge', err); }
});

router.post('/duel/:id/join', async (req, res) => {
    if (!hasToken()) return deny(res, 'no_key');
    try {
        res.json(await duels.joinChallenge(req.params.id, req.user.id));
    } catch (err) { fail(res, 'POST /api/geo/duel/join', err); }
});

router.delete('/duel/:id', async (req, res) => {
    try {
        res.json(await duels.cancelChallenge(req.params.id, req.user.id));
    } catch (err) { fail(res, 'DELETE /api/geo/duel', err); }
});

// GET /api/geo/duel/:id?since=N — опрос партии. since — номер, который клиент
// уже видел: если сервер не ушёл вперёд, ответ приходит коротким.
router.get('/duel/:id', async (req, res) => {
    try {
        const since = Number.isFinite(Number(req.query.since)) ? Number(req.query.since) : -1;
        const game = await duels.getDuel(req.params.id, req.user.id, since);
        if (!game) return res.status(404).json({ error: 'нет такой дуэли' });
        res.json(game);
    } catch (err) { fail(res, 'GET /api/geo/duel', err); }
});

router.post('/duel/:id/guess', async (req, res) => {
    const guess = readGuess(req.body);
    if (!guess) return deny(res, 'bad_guess');
    try {
        res.json(await duels.submit(req.params.id, req.user.id, guess));
    } catch (err) { fail(res, 'POST /api/geo/duel/guess', err); }
});

router.post('/duel/:id/ready', async (req, res) => {
    try {
        res.json(await duels.ready(req.params.id, req.user.id));
    } catch (err) { fail(res, 'POST /api/geo/duel/ready', err); }
});

router.post('/duel/:id/resign', async (req, res) => {
    try {
        res.json(await duels.resign(req.params.id, req.user.id));
    } catch (err) { fail(res, 'POST /api/geo/duel/resign', err); }
});

export default router;
