// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Контекстно» — угадать слово по смысловой близости.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// На каждую догадку игра отвечает её МЕСТОМ в списке слов, отсортированном по
// близости к загаданному: 1 — это оно и есть, 25 000 — «совсем не туда».
// Места посчитаны заранее по word2vec-модели RusVectores (kontekst/README.md);
// на сервере ни модели, ни Python нет — только чтение готовых байтов.
//
// Как и в вордле: слово — чистая функция от (id аккаунта, дата МСК), в базе
// не хранится ничего, само слово клиенту не уходит, пока игра не кончилась.
// Число попыток здесь не ограничено, поэтому «сдаюсь» — отдельный запрос, а
// не побочный эффект счётчика.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { normalizeWord, isWordShape } from '../../../shared/kontekst.js';
import { resolveWord, rankOf, closestWords, hintWord, ANSWERS, VOCAB_SIZE, ANSWERS_COUNT, READY } from '../kontekst/tables.js';
import { mskDay, nextMidnightMsk, pickForUser } from '../daily.js';

const router = Router();

// Без таблиц (обрезанный клон, сбой выкладки) игра просто не открывается —
// см. kontekst/tables.js. Окно покажет «сервер не отвечает», остальной API
// работает как ни в чём не бывало.
router.use((_req, res, next) => {
    if (!READY) return res.status(503).json({ error: 'kontekst tables unavailable' });
    next();
});

// Своя соль: у человека, играющего в обе пасхалки, слова не должны каждый день
// выпадать на одинаковых номерах списков.
const SALT = process.env.KONTEKST_SALT || 'k-spot-kontekst';

// Сколько ближайших слов показываем сдавшемуся: достаточно, чтобы понять, где
// он ходил рядом, и не столько, чтобы это стало новой игрой.
const REVEAL_CLOSEST = 15;

function answerFor(userId, day) {
    return pickForUser(ANSWERS, userId, day, SALT);
}

// ── GET /api/kontekst/today ──────────────────────────────────────────────────
// { day, resetAt, vocab, pool } — правила и момент смены слова.
router.get('/today', (_req, res) => {
    res.json({
        day: mskDay(),
        resetAt: nextMidnightMsk().toISOString(),
        vocab: VOCAB_SIZE,
        pool: ANSWERS_COUNT,
    });
});

// ── POST /api/kontekst/guess ─────────────────────────────────────────────────
// { word } → { ok: true, day, word, rank, win } | { ok: false, reason }
//
// word в ответе — приведённая форма («машиной» → «машина»): игрок должен
// видеть в списке то слово, место которого ему назвали.
router.post('/guess', (req, res) => {
    const raw = normalizeWord(req.body?.word);
    if (!isWordShape(raw)) return res.json({ ok: false, reason: 'bad_shape' });

    const word = resolveWord(raw);
    if (!word) return res.json({ ok: false, reason: 'unknown_word' });

    const day = mskDay();
    const answer = answerFor(req.user.id, day);
    const rank = rankOf(answer, word);
    res.json({ ok: true, day, word, rank, win: rank === 1 });
});

// ── POST /api/kontekst/hint ──────────────────────────────────────────────────
// { best } → { word, rank }: слово вдвое ближе того, что игрок уже нашёл.
//
// best присылает клиент. Подделать его — значит попросить подсказку получше,
// то есть испортить игру себе одному; проверять тут нечего.
router.post('/hint', (req, res) => {
    const day = mskDay();
    const answer = answerFor(req.user.id, day);
    // Подсказка обязана быть полезной, а не «формально ближе»: половина от
    // найденного, но не дальше сотого места. Иначе игроку, у которого лучшая
    // догадка на 20-тысячном месте, мы бы выдали слово с десятитысячного — а
    // это то же самое «не туда». Каждая следующая подсказка вдвое ближе.
    const best = Number(req.body?.best);
    // Игрок уже держит второе место — ближе только само слово, и выдать его
    // подсказкой значит доиграть за него.
    if (Number.isFinite(best) && best <= 2) return res.json({ ok: false, reason: 'no_closer' });
    const half = Number.isFinite(best) && best > 1 ? Math.floor(best / 2) : 100;
    const to = Math.min(100, Math.max(2, half));
    // Вилка [to/2 … to], а не «всё, что ближе»: без нижней границы подсказкой
    // каждый раз оказывалось бы самое частотное слово словаря («год»), которое
    // стоит близко к чему угодно и не говорит ни о чём.
    const hint = hintWord(answer, Math.max(2, Math.floor(to / 2)), to);
    if (!hint) return res.json({ ok: false });
    res.json({ ok: true, ...hint });
});

// ── POST /api/kontekst/giveup ────────────────────────────────────────────────
// { answer, closest } — конец игры на сегодня, слово показываем.
router.post('/giveup', (req, res) => {
    const day = mskDay();
    const answer = answerFor(req.user.id, day);
    res.json({ day, answer, closest: closestWords(answer, REVEAL_CLOSEST) });
});

export default router;
