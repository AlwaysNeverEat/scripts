// ─────────────────────────────────────────────────────────────────────────────
// Распределяющая шляпа: тест на факультет.
//
// Ручек три, и такими они стали из-за одного требования: тест проходят на
// работе, и посреди него человеку звонят. Поэтому ответ уезжает на сервер
// СРАЗУ, по одному (POST /answer), состояние спрашивается при каждом открытии
// (GET /state), а результат считается на сервере в конце (POST /finish).
// Никакого «сохраним, когда дойдёт до конца»: свёрнутая вкладка, перезагрузка
// телефона и вход с другого устройства не должны стоить пройденного.
//
// Вопросы отдаются БЕЗ весов, ответы считает сервер (см. шапку faculty/quiz.js):
// иначе тест решался бы чтением исходников, а не про себя.
//
// Пройти можно ОДИН раз. Ручки «пройти заново» нет ни у пользователя, ни у
// модератора — это не настройка профиля, которую перебирают, пока не выпадет
// красивая.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { SECTIONS, publicQuestions, QUESTION_COUNT } from '../faculty/quiz.js';
import {
    loadResult, loadProgress, saveAnswer, answeredCount, finishTest, facultyCard,
} from '../faculty/store.js';

const router = Router();

// ── GET /api/faculty/state ───────────────────────────────────────────────────
// Пройден:      { status: 'done', faculty: {…}, taken_at }
// Не пройден:   { status: 'new' | 'in_progress', sections, questions, answers,
//                 answered, total }
//
// Вопросы отдаются целиком, а не по одному: сорок килобайт текста в одном
// ответе дешевле тридцати запросов, а главное — окно теста после этого
// переживает обрыв связи, не теряя того, что человек уже видит на экране.
router.get('/state', async (req, res) => {
    try {
        const done = await loadResult(req.user.id);
        if (done) {
            return res.json({
                status: 'done',
                faculty: facultyCard(done.faculty),
                taken_at: done.taken_at,
            });
        }
        const answers = await loadProgress(req.user.id);
        const answered = answeredCount(answers);
        res.json({
            status: answered ? 'in_progress' : 'new',
            sections: SECTIONS,
            questions: publicQuestions(req.user.id),
            answers,
            answered,
            total: QUESTION_COUNT,
        });
    } catch (err) {
        console.error('GET /api/faculty/state', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/faculty/answer ─────────────────────────────────────────────────
// { id, value } → { ok: true, answered, total }
// value — id варианта, число 0…4 для утверждения или массив id для расстановки.
router.post('/answer', async (req, res) => {
    const id = req.body?.id;
    if (typeof id !== 'string') return res.status(400).json({ error: 'id вопроса обязателен' });

    try {
        // Уже распределённому отвечать некуда: результат закреплён навсегда, и
        // молча копить ответы «в никуда» нечестно по отношению к человеку.
        if (await loadResult(req.user.id)) {
            return res.status(409).json({ error: 'тест уже пройден' });
        }
        const answers = await saveAnswer(req.user.id, id, req.body?.value);
        if (!answers) return res.status(400).json({ error: 'такой ответ не подходит этому вопросу' });
        res.json({ ok: true, answered: answeredCount(answers), total: QUESTION_COUNT });
    } catch (err) {
        console.error('POST /api/faculty/answer', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/faculty/finish ─────────────────────────────────────────────────
// → { faculty: {…}, fresh } | 400 { error, missing: [id, …] }
// fresh=false означает «результат уже был» — повторный вызов ничего не
// пересчитывает (двойной клик, две вкладки, повтор после обрыва сети).
router.post('/finish', async (req, res) => {
    try {
        const result = await finishTest(req.user.id);
        if (result.missing) {
            return res.status(400).json({
                error: 'ответы есть не на все вопросы',
                missing: result.missing,
            });
        }
        res.json({
            faculty: facultyCard(result.faculty),
            taken_at: result.taken_at,
            fresh: result.fresh,
        });
    } catch (err) {
        console.error('POST /api/faculty/finish', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
