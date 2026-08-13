// Таблицы пасхалки «Контекстно»: словарь, словоформы и ранги близости.
//
// Всё тяжёлое посчитано заранее (build-tables.py, см. README.md рядом): модели
// word2vec на сервере нет, Python не нужен, зависимостей ноль.
//
// ranks.bin — матрица uint16 LE: строка на каждое слово-ответ, столбец на
// каждое слово словаря, значение — место этого слова по смысловой близости
// (1 = само загаданное). Файл держим ОТКРЫТЫМ и читаем из него два байта по
// смещению: 22 МБ незачем поднимать в память ради одного числа за попытку.

import { openSync, readSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { normalizeWord } from '../../../shared/kontekst.js';

const here = (file) => new URL(file, import.meta.url);

// Таблицы — 22 МБ данных, которых может не оказаться (обрезанный клон, сбой
// выкладки). Пасхалка при этом просто не открывается; ронять из-за неё весь
// API, включая записи и калькулятор, было бы несоразмерно — поэтому загрузка
// в try/catch, а роут смотрит на READY.
let VOCAB = [];
let ANSWERS_LIST = [];
let WORD_ID = new Map();
let ANSWER_ROW = new Map();
let ROW_BYTES = 0;
let ranksFd = null;
let ready = false;

try {
    VOCAB = readFileSync(here('./vocab.txt'), 'utf8').split('\n').filter(Boolean);
    ANSWERS_LIST = readFileSync(here('./answers.txt'), 'utf8').split('\n').filter(Boolean);
    WORD_ID = new Map(VOCAB.map((w, i) => [w, i]));
    ANSWER_ROW = new Map(ANSWERS_LIST.map((w, i) => [w, i]));
    ROW_BYTES = VOCAB.length * 2;

    // Файл и словарь собираются одним скриптом; расхождение означает, что
    // обновили только половину — а это ранги от другого словаря.
    const expected = ANSWERS_LIST.length * ROW_BYTES;
    const actual = statSync(here('./ranks.bin')).size;
    if (actual !== expected) {
        throw new Error(`ranks.bin не совпадает со словарём: ${actual} байт вместо ${expected}`);
    }
    ranksFd = openSync(here('./ranks.bin'), 'r');
    ready = true;
} catch (err) {
    console.warn('kontekst: таблицы не загружены, пасхалка отключена —', err.message);
}

export const ANSWERS = ANSWERS_LIST;
export const VOCAB_SIZE = VOCAB.length;
export const ANSWERS_COUNT = ANSWERS_LIST.length;
export const READY = ready;

// Словоформы («машиной» → «машина») — 295 тысяч пар, поэтому поднимаем их не
// на старте процесса, а при первой попытке: в пасхалку играют не каждый день,
// а память бэкенд делит с записями и снимком базы.
let forms = null;

function formsMap() {
    if (!forms) {
        forms = new Map();
        const text = gunzipSync(readFileSync(here('./forms.txt.gz'))).toString('utf8');
        for (const line of text.split('\n')) {
            const sp = line.indexOf(' ');
            if (sp > 0) forms.set(line.slice(0, sp), line.slice(sp + 1));
        }
    }
    return forms;
}

/**
 * Слово игрока → слово словаря. Принимаем любую форму: «машиной», «машины» и
 * «машина» — это одна догадка, спорить с падежами игра не должна.
 * Возвращает null, если такого слова в словаре нет.
 */
export function resolveWord(input) {
    const w = normalizeWord(input);
    if (!w || !ready) return null;
    if (WORD_ID.has(w)) return w;
    const lemma = formsMap().get(w);
    return lemma && WORD_ID.has(lemma) ? lemma : null;
}

/** Место слова по близости к загаданному: 1 — оно и есть, VOCAB_SIZE — край. */
export function rankOf(answer, word) {
    if (!ready) return null;
    const row = ANSWER_ROW.get(answer);
    const id = WORD_ID.get(word);
    if (row === undefined || id === undefined) return null;
    const buf = Buffer.allocUnsafe(2);
    readSync(ranksFd, buf, 0, 2, row * ROW_BYTES + id * 2);
    return buf.readUInt16LE(0);
}

/** Слова с местами 1..n — для подсказок и для «сдаюсь». */
export function closestWords(answer, n) {
    if (!ready) return [];
    const row = ANSWER_ROW.get(answer);
    if (row === undefined) return [];
    const buf = Buffer.allocUnsafe(ROW_BYTES);
    readSync(ranksFd, buf, 0, ROW_BYTES, row * ROW_BYTES);
    const out = [];
    for (let id = 0; id < VOCAB_SIZE; id++) {
        const rank = buf.readUInt16LE(id * 2);
        if (rank <= n) out.push({ word: VOCAB[id], rank });
    }
    return out.sort((a, b) => a.rank - b.rank);
}

/**
 * Слово для подсказки: из мест [from…to] берём самое употребимое.
 *
 * Не «слово ровно на этом месте»: у слова «группа» четырёхсотое место занимает
 * «турслет», и такая подсказка только сбивает. Словарь отсортирован по
 * частотности, поэтому «самое известное» — это наименьший id.
 */
export function hintWord(answer, from, to) {
    if (!ready) return null;
    const row = ANSWER_ROW.get(answer);
    if (row === undefined) return null;
    const buf = Buffer.allocUnsafe(ROW_BYTES);
    readSync(ranksFd, buf, 0, ROW_BYTES, row * ROW_BYTES);
    for (let id = 0; id < VOCAB_SIZE; id++) {
        const rank = buf.readUInt16LE(id * 2);
        if (rank >= from && rank <= to) return { word: VOCAB[id], rank };
    }
    return null;
}
