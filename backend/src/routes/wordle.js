// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Вордле» — угадать слово из пяти букв за шесть попыток.
//
// Открывается только из меню игр, а оно — с поиска на главной («игры» +
// Enter); в остальном интерфейсе на неё ничего не ведёт.
//
// Слово загаданное — на сервере, и клиенту оно не уходит: браузер шлёт попытку,
// сервер возвращает раскраску. Ответ показывается, только когда игра кончилась
// (угадал или израсходовал попытки). Иначе пасхалку разгадывали бы во вкладке
// «Сеть», а не буквами.
//
// Состояния в базе нет вовсе: слово — чистая функция от (id аккаунта, дата
// МСК), а сыгранные попытки браузер помнит у себя (localStorage). Номер попытки
// клиент присылает сам — на нём держится только момент показа ответа в
// проигрыше; подделать его — значит подсмотреть собственное слово, и никому,
// кроме самого игрока, это ничего не портит.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { markGuess, isWin, normalizeWord, isWordShape, WORD_LENGTH, MAX_TRIES } from '../../../shared/wordle.js';
import { answerFor, isKnownWord, ANSWERS_COUNT } from '../wordle/words.js';
import { mskDay, nextMidnightMsk } from '../daily.js';

const router = Router();

// ── GET /api/wordle/today ────────────────────────────────────────────────────
// { day, resetAt, length, tries, pool } — правила и момент смены слова.
// Само слово здесь не отдаётся (и нигде, пока игра не кончилась).
router.get('/today', (req, res) => {
    res.json({
        day: mskDay(),
        resetAt: nextMidnightMsk().toISOString(),
        length: WORD_LENGTH,
        tries: MAX_TRIES,
        pool: ANSWERS_COUNT,
    });
});

// ── POST /api/wordle/guess ───────────────────────────────────────────────────
// { guess, attempt } → { ok: true, day, marks, win, answer? }
//                   |  { ok: false, reason: 'bad_shape' | 'unknown_word' }
//
// Отказ по слову — это не ошибка запроса, а ход игры: отвечаем 200, чтобы на
// клиенте он не смешивался с обрывом сети (см. apiFetch во фронте).
router.post('/guess', (req, res) => {
    const guess = normalizeWord(req.body?.guess);
    if (!isWordShape(guess)) return res.json({ ok: false, reason: 'bad_shape' });
    if (!isKnownWord(guess)) return res.json({ ok: false, reason: 'unknown_word' });

    const day = mskDay();
    const answer = answerFor(req.user.id, day);
    const marks = markGuess(answer, guess);
    const win = isWin(marks);

    const attempt = Number(req.body?.attempt) || 0;
    const over = win || attempt >= MAX_TRIES;
    res.json({ ok: true, day, marks, win, ...(over ? { answer } : {}) });
});

export default router;
