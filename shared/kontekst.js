// Пасхалка «Контекстно»: правила, общие для сервера и браузера.
//
// Слово угадывается не по буквам, а по смыслу: на каждую догадку игра
// отвечает её местом в списке слов, отсортированном по смысловой близости к
// загаданному. 1 — это оно и есть, 25 000 — «вы не там».

// Ниже этих границ догадка считается тёплой/горячей. Числа не с потолка: у
// word2vec первые сотни соседей — это ещё «про то же самое», а после пары
// тысяч связь на глаз уже не читается.
export const HOT_RANK = 300;
export const WARM_RANK = 2000;

export function normalizeWord(word) {
    return String(word || '').trim().toLowerCase().replace(/ё/g, 'е');
}

// Слово из русских букв — всё остальное до словаря не доходит.
export function isWordShape(word) {
    return /^[а-я]{2,}$/.test(normalizeWord(word));
}

export function rankHeat(rank) {
    if (rank <= HOT_RANK) return 'hot';
    if (rank <= WARM_RANK) return 'warm';
    return 'cold';
}

/**
 * Насколько догадка близка, в долях 0…1 — для полоски в интерфейсе.
 * Шкала логарифмическая: разница между 5-м и 50-м местом важна, между
 * 20 000-м и 25 000-м — нет, а на линейной шкале обе полоски были бы пустыми.
 */
export function rankProgress(rank, vocabSize) {
    if (rank <= 1) return 1;
    if (rank >= vocabSize) return 0;
    return 1 - Math.log(rank) / Math.log(vocabSize);
}
