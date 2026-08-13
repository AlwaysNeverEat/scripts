// Пасхалка «Вордле»: правила игры одним файлом.
//
// Раскраска попытки живёт здесь, а не в UI, по той же причине, что и остальная
// логика в shared/: считает её сервер (слово он клиенту не отдаёт), а тесты
// гоняют ту же функцию, что и прод.
//
// Буквы приводим к нижнему регистру и «ё»→«е»: в словаре и в списке ответов
// «ё» нет вовсе, и заставлять человека попадать в неё на клавиатуре — вредно.

export const WORD_LENGTH = 5;
export const MAX_TRIES = 6;

export function normalizeWord(word) {
    return String(word || '').trim().toLowerCase().replace(/ё/g, 'е');
}

// Слово из ровно пяти русских букв — всё остальное до словаря не доходит.
export function isWordShape(word) {
    return new RegExp(`^[а-я]{${WORD_LENGTH}}$`).test(normalizeWord(word));
}

/**
 * Раскраска попытки: 'hit' — буква на своём месте, 'near' — есть в слове, но
 * не здесь, 'miss' — нет вовсе.
 *
 * Два прохода, а не один: повторяющиеся буквы иначе врут. В слове «карта» на
 * попытку «аллея» первая «а» не должна светиться жёлтым дважды — жёлтых ровно
 * столько, сколько осталось букв после вычета точных совпадений.
 */
export function markGuess(answer, guess) {
    const a = normalizeWord(answer).split('');
    const g = normalizeWord(guess).split('');
    const marks = new Array(g.length).fill('miss');

    // Первый проход — точные попадания; израсходованные буквы ответа гасим.
    const left = new Map();
    for (let i = 0; i < g.length; i++) {
        if (g[i] === a[i]) marks[i] = 'hit';
        else left.set(a[i], (left.get(a[i]) || 0) + 1);
    }
    // Второй — жёлтые, пока в остатке есть такая буква.
    for (let i = 0; i < g.length; i++) {
        if (marks[i] === 'hit') continue;
        const rest = left.get(g[i]) || 0;
        if (rest > 0) {
            marks[i] = 'near';
            left.set(g[i], rest - 1);
        }
    }
    return marks;
}

export function isWin(marks) {
    return marks.length === WORD_LENGTH && marks.every(m => m === 'hit');
}
