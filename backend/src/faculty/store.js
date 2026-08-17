// Хранение распределения: черновик ответов и закреплённый навсегда результат
// (см. db/migrations/029_faculty.sql).
//
// Тут собрано всё, что ходит в базу по факультетам, — и присоединение
// факультета к любому списку пользователей тоже (FACULTY_JOIN ниже): плашка
// стоит рядом с ником в топе, в ленте машины и в мини-топах игр, и запрос за
// ней должен быть один и тот же во всех местах.

import { query } from '../db/client.js';
import { facultyById } from '../../../shared/faculties.js';
import {
    QUESTIONS, QUESTION_COUNT, normalizeAnswer, facultyFromAnswers,
} from './quiz.js';

// ── Присоединение факультета к выдаче пользователей ──────────────────────────
// Везде, где рядом с ником показывается плашка роли, показывается и факультет.
// Строка джойна одна на все такие запросы: разъехавшись, они дали бы человеку
// разный вид на разных экранах, а это ровно то, чего плашка не должна делать.
export const FACULTY_JOIN = 'LEFT JOIN faculty_results fr ON fr.user_id = u.id';
export const FACULTY_COLUMNS = 'fr.faculty';

/**
 * Плашка факультета для строки списка: только то, что рисуется рядом с ником.
 * Описание, качества и прочий текст карточки сюда не кладём — в топе на сотню
 * строк это сотня лишних абзацев.
 */
export function facultyBadge(id) {
    const f = facultyById(id);
    return f ? { id: f.id, name: f.name, prefix: f.prefix } : null;
}

/** Полная карточка для профиля. */
export function facultyCard(id) {
    const f = facultyById(id);
    if (!f) return null;
    return {
        id: f.id,
        name: f.name,
        prefix: f.prefix,
        founder: f.founder,
        symbol: f.symbol,
        colors: f.colors,
        qualities: f.qualities,
        tagline: f.tagline,
        about: f.about,
        strengths: f.strengths,
        watch: f.watch,
    };
}

// ── Результат ────────────────────────────────────────────────────────────────

/** Закреплённый факультет пользователя или null, если тест ещё не пройден. */
export async function loadResult(userId) {
    const r = await query(
        'SELECT faculty, taken_at FROM faculty_results WHERE user_id = $1',
        [userId],
    );
    if (!r.rows.length) return null;
    return { faculty: r.rows[0].faculty, taken_at: r.rows[0].taken_at };
}

// ── Черновик ─────────────────────────────────────────────────────────────────

export async function loadProgress(userId) {
    const r = await query('SELECT answers FROM faculty_progress WHERE user_id = $1', [userId]);
    return r.rows.length ? (r.rows[0].answers || {}) : {};
}

/**
 * Сохранить один ответ. Пишем СРАЗУ, по одному: тест прерывают звонком, и
 * «сохраним, когда дойдёт до конца» означало бы, что прерванный тест начинается
 * заново.
 *
 * Слияние делает сама база (answers || excluded.answers), а не «прочитали,
 * дописали, записали»: две открытые вкладки одного человека иначе затирали бы
 * ответы друг друга.
 */
export async function saveAnswer(userId, questionId, rawValue) {
    const value = normalizeAnswer(questionId, rawValue);
    if (value === null) return null;
    const r = await query(
        `INSERT INTO faculty_progress (user_id, answers)
              VALUES ($1, jsonb_build_object($2::text, $3::jsonb))
         ON CONFLICT (user_id) DO UPDATE
                SET answers = faculty_progress.answers || excluded.answers,
                    updated_at = now()
          RETURNING answers`,
        [userId, questionId, JSON.stringify(value)],
    );
    return r.rows[0].answers || {};
}

/** Сколько вопросов уже отвечено (и годятся ли эти ответы). */
export function answeredCount(answers) {
    return QUESTIONS.filter(q => normalizeAnswer(q.id, answers?.[q.id]) !== null).length;
}

/** Вопросы, без которых считать нельзя. */
export function missingQuestions(answers) {
    return QUESTIONS.filter(q => normalizeAnswer(q.id, answers?.[q.id]) === null).map(q => q.id);
}

/**
 * Закрыть тест: посчитать факультет и закрепить его НАВСЕГДА.
 *
 * Вставка идёт с ON CONFLICT DO NOTHING и результат перечитывается — то есть
 * второй вызов (двойной клик, две вкладки, повтор запроса после обрыва сети)
 * не пересчитывает факультет, а возвращает уже выданный. Пересдачи нет, и
 * случайно получиться она тоже не должна.
 */
export async function finishTest(userId) {
    const already = await loadResult(userId);
    if (already) return { faculty: already.faculty, taken_at: already.taken_at, fresh: false };

    const answers = await loadProgress(userId);
    const missing = missingQuestions(answers);
    if (missing.length) return { missing };

    const { faculty, scores } = facultyFromAnswers(answers);

    await query(
        `INSERT INTO faculty_results (user_id, faculty, scores, answers)
              VALUES ($1, $2, $3::jsonb, $4::jsonb)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, faculty, JSON.stringify(scores), JSON.stringify(answers)],
    );
    // Черновик больше не нужен: результат закреплён, и переигрывать нечего.
    await query('DELETE FROM faculty_progress WHERE user_id = $1', [userId]);

    const saved = await loadResult(userId);
    return { faculty: saved.faculty, taken_at: saved.taken_at, fresh: true };
}

export { QUESTION_COUNT };
