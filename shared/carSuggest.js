// ─────────────────────────────────────────────────────────────────────────────
// Подсказки при ручном вводе марки/модели/двигателя — защита базы от дублей.
//
// Проблема простая и дорогая: один человек заводит «Volkswagen», другой на той
// же машине пишет «VW», третий — «Фольксваген». В базе получаются три марки,
// поиск по каждой находит треть машин, а каскад «Теги» показывает три ветки
// вместо одной. Свести их потом можно только руками.
//
// Поэтому поле ввода в форме «Добавить машину» не пустое: оно показывает то,
// что УЖЕ есть в базе (rankOptions), и предупреждает, когда набранное похоже на
// существующее значение (similarValues). Сопоставление идёт не по строке, а по
// ключу: без регистра, без пунктуации и пробелов, с кириллическими двойниками
// латиницы («С5» и «C5» — одно и то же), плюс словарь синонимов и транслит из
// translit.js — по нему «фольксваген» и «vw» приводят к «volkswagen».
//
// Модуль намеренно НИЧЕГО не запрещает: новые марки и модели появляются
// постоянно, и запрет ввода был бы хуже дубля. Он только показывает.
// ─────────────────────────────────────────────────────────────────────────────

import { normalize, expandQuery } from './translit.js';

// Кириллические буквы, неотличимые от латинских: на русской раскладке половину
// «C5 (T19C)» легко набрать кириллицей — визуально то же самое, а значение в
// базе получается другое. Тот же список, что в frontend/src/tagSearch.js.
const CYR_LOOKALIKE = {
    'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
    'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
};

/**
 * Ключ для сравнения значений: «VW », «vw» и «В-W» дают один ключ.
 * Пробелы убираем целиком — «Land Rover» и «LandRover» это одна марка.
 */
export function normKey(s) {
    return normalize(s)
        .replace(/[авекмнорстух]/g, ch => CYR_LOOKALIKE[ch] || ch)
        .replace(/\s+/g, '');
}

// Все написания, к которым сводится строка по словарю синонимов и транслиту.
function keyVariants(s) {
    return new Set(expandQuery(String(s ?? '')).map(normKey).filter(Boolean));
}

function bigrams(s) {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
}

/**
 * Похожесть двух значений (коэффициент Дайса по биграммам ключей), 0…1.
 * Ловит опечатки и лишние символы: «Voklswagen» против «Volkswagen» ≈ 0.78.
 */
export function similarity(a, b) {
    const A = normKey(a), B = normKey(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (A.length < 2 || B.length < 2) return 0;
    const ga = bigrams(A), gb = bigrams(B);
    const pool = new Map();
    for (const g of ga) pool.set(g, (pool.get(g) || 0) + 1);
    let hits = 0;
    for (const g of gb) {
        const n = pool.get(g) || 0;
        if (n > 0) { pool.set(g, n - 1); hits++; }
    }
    return (2 * hits) / (ga.length + gb.length);
}

// Значения приходят и списком строк, и списком {value, count} из /suggest.
function toOption(raw) {
    if (raw == null) return null;
    if (typeof raw === 'string') return { value: raw, count: null };
    if (typeof raw.value !== 'string') return null;
    return { value: raw.value, count: raw.count ?? null };
}

/**
 * Точное совпадение с уже существующим значением (с точностью до ключа).
 * Возвращает написание ИЗ БАЗЫ — именно его и надо сохранять, чтобы «vw»
 * не завёл вторую марку рядом с «Volkswagen».
 */
export function exactMatch(input, values) {
    const key = normKey(input);
    if (!key) return null;
    for (const raw of values || []) {
        const o = toOption(raw);
        if (o && normKey(o.value) === key) return o;
    }
    return null;
}

/**
 * Существующие значения, на которые похоже набранное.
 * reason объясняет, ПОЧЕМУ похоже — от этого зависит тон подсказки:
 *   same    — это оно и есть, только другим регистром/пунктуацией;
 *   synonym — то же самое по словарю/транслиту («vw» → «Volkswagen»);
 *   prefix  — одно начинается с другого («Focus» → «Focus III»);
 *   part    — одно содержит другое целиком;
 *   similar — похоже по буквам (опечатка).
 */
export function similarValues(input, values, { limit = 4, min = 0.62 } = {}) {
    const key = normKey(input);
    if (!key) return [];
    const inputVariants = keyVariants(input);
    const out = [];

    for (const raw of values || []) {
        const o = toOption(raw);
        if (!o) continue;
        const k = normKey(o.value);
        if (!k) continue;

        let reason = null, score = 0;
        if (k === key) {
            reason = 'same'; score = 1;
        } else if (inputVariants.has(k) || keyVariants(o.value).has(key)) {
            reason = 'synonym'; score = 0.97;
        } else if (key.length >= 2 && k.length >= 2 && (k.startsWith(key) || key.startsWith(k))) {
            reason = 'prefix'; score = 0.9;
        } else if (key.length >= 3 && k.length >= 3 && (k.includes(key) || key.includes(k))) {
            reason = 'part'; score = 0.8;
        } else {
            const s = similarity(key, k);
            if (s >= min) { reason = 'similar'; score = s; }
        }
        if (reason) out.push({ ...o, reason, score });
    }

    return out
        .sort((a, b) => b.score - a.score || (b.count || 0) - (a.count || 0)
            || String(a.value).localeCompare(String(b.value)))
        .slice(0, limit);
}

/**
 * Список для выпадашки: что показать под полем при наборе.
 * Пустой ввод — весь список как есть (самые частые сверху, их уже отсортировал
 * сервер). С вводом — совпадения по началу/подстроке любого варианта написания,
 * а если таких нет — близкие по буквам (человек ищет то, что помнит неточно).
 */
export function rankOptions(input, options, { limit = 40 } = {}) {
    const list = (options || []).map(toOption).filter(Boolean);
    const key = normKey(input);
    if (!key) return list.slice(0, limit);

    const variants = [...keyVariants(input)];
    const scored = [];
    for (const o of list) {
        const k = normKey(o.value);
        if (!k) continue;
        let score = 0;
        for (const v of variants) {
            if (k === v) score = Math.max(score, 100);
            else if (k.startsWith(v)) score = Math.max(score, 80);
            else if (k.includes(v)) score = Math.max(score, 60);
        }
        if (!score) {
            const s = similarity(key, k);
            if (s >= 0.5) score = 40 * s;
        }
        if (score) scored.push({ o, score });
    }

    return scored
        .sort((a, b) => b.score - a.score || (b.o.count || 0) - (a.o.count || 0)
            || String(a.o.value).localeCompare(String(b.o.value)))
        .slice(0, limit)
        .map(x => x.o);
}
