// Словари пасхалки «Вордле» и выбор слова дня.
//
// Два списка, и это разные вещи:
//   • dictionary.txt — что вообще принимается как попытка (25 699 слов, любые
//     формы). Список широкий нарочно: отказ «нет такого слова» на живом слове
//     раздражает сильнее, чем принятая экзотика.
//   • answers.txt — из чего загадывается слово (915 частотных существительных
//     в им. п. ед. ч.). Загадывать из большого словаря нельзя: «абазу» никто
//     не отгадает.
// Откуда взяты списки и как их пересобрать — README.md рядом.
//
// Слово у каждого аккаунта своё: индекс — хэш от (id пользователя + дата МСК),
// поэтому в базе ничего хранить не нужно, а «сегодняшнее» слово одинаково для
// всех запросов этого человека в эти сутки и меняется в 00:00 МСК само.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeWord, isWordShape, WORD_LENGTH } from '../../../shared/wordle.js';

function loadList(file) {
    return readFileSync(new URL(file, import.meta.url), 'utf8')
        .split('\n')
        .map(normalizeWord)
        .filter(w => w.length === WORD_LENGTH);
}

const ANSWERS = loadList('./answers.txt');
const DICTIONARY = new Set(loadList('./dictionary.txt'));
// Загаданное всегда должно приниматься как попытка — иначе игрок не сможет
// ввести собственный ответ.
for (const w of ANSWERS) DICTIONARY.add(w);

// Соль — чтобы слово нельзя было посчитать, зная только свой id и дату
// (списки лежат в открытом репозитории). Секрет не критичный: слово и так не
// уходит клиенту до конца игры, поэтому дефолт есть и без переменной окружения.
const SALT = process.env.WORDLE_SALT || 'k-spot-wordle';

export const ANSWERS_COUNT = ANSWERS.length;
export const DICTIONARY_SIZE = DICTIONARY.size;

export function isKnownWord(word) {
    return isWordShape(word) && DICTIONARY.has(normalizeWord(word));
}

/** Слово дня для конкретного аккаунта: одно и то же весь день, своё у каждого. */
export function answerFor(userId, day) {
    const digest = createHash('sha256').update(`${SALT}:${userId}:${day}`).digest();
    // 32 бита из хэша хватает: перекос от остатка на 915 вариантов исчезающе мал.
    const n = digest.readUInt32BE(0);
    return ANSWERS[n % ANSWERS.length];
}
