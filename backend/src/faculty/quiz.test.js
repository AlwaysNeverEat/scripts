// Тесты распределяющей шляпы. Здесь проверяется не «работает ли код», а
// СВОЙСТВА теста, ради которых он и написан: что варианты не тянут сами по
// себе, что все четыре факультета достижимы, что характер по ответам
// восстанавливается, и что клиенту не уезжают веса.
//
// Прогонять ОБЯЗАТЕЛЬНО после любой правки вопросов или эталонов: половина
// свойств тут статистические, и одно неудачное число в весах ломает их молча.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    QUESTIONS, QUESTION_COUNT, SECTIONS, SCALE_LABELS, AXIS_IDS,
    publicQuestions, normalizeAnswer, scoreAnswers, pickFaculty, facultyFromAnswers,
    __internals,
} from './quiz.js';
import { FACULTY_IDS, facultyById } from '../../../shared/faculties.js';

// Свой генератор с фиксированным зерном: статистические проверки должны падать
// и проходить одинаково у всех, а не «иногда на CI».
function rnd(seed) {
    let s = seed;
    return () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomAnswers(next) {
    const answers = {};
    for (const q of QUESTIONS) {
        if (q.type === 'scale') {
            answers[q.id] = Math.floor(next() * SCALE_LABELS.length);
        } else if (q.type === 'order') {
            const ids = q.items.map(i => i.id);
            for (let i = ids.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                [ids[i], ids[j]] = [ids[j], ids[i]];
            }
            answers[q.id] = ids;
        } else {
            answers[q.id] = q.options[Math.floor(next() * q.options.length)].id;
        }
    }
    return answers;
}

// ── Устройство опросника ─────────────────────────────────────────────────────

test('вопросов достаточно, id уникальны, блоки существуют', () => {
    assert.ok(QUESTION_COUNT >= 25, 'тест короче 25 вопросов — это уже гадание');
    const ids = QUESTIONS.map(q => q.id);
    assert.equal(new Set(ids).size, ids.length, 'повторяющийся id вопроса');
    const sections = new Set(SECTIONS.map(s => s.id));
    for (const q of QUESTIONS) {
        assert.ok(sections.has(q.section), `вопрос ${q.id} ссылается на несуществующий блок`);
        if (q.type === 'scale') {
            // У утверждения выбирают не вариант, а степень согласия — список
            // ему не нужен, зато вес обязателен.
            assert.ok(q.w, `у утверждения ${q.id} нет весов`);
            continue;
        }
        const list = q.type === 'order' ? q.items : q.options;
        assert.ok(Array.isArray(list) && list.length >= 2, `у вопроса ${q.id} нечего выбирать`);
        const optIds = list.map(o => o.id);
        assert.equal(new Set(optIds).size, optIds.length, `повтор id варианта в ${q.id}`);
    }
});

test('каждый вопрос с вариантами уравновешен: сам набор никуда не тянет', () => {
    for (const q of QUESTIONS) {
        if (q.type !== 'choice' && q.type !== 'pair') continue;
        for (const axis of AXIS_IDS) {
            const sum = q.options.reduce((s, o) => s + o.w[axis], 0);
            assert.equal(sum, 0, `вопрос ${q.id}: варианты в сумме тянут шкалу ${axis} на ${sum}`);
        }
    }
    // У расстановки по важности баланс обеспечивают сами места (+2, +1, −1, −2
    // в сумме дают ноль), поэтому её пункты уравновешивать не нужно.
    assert.equal(__internals.ORDER_WEIGHTS.reduce((s, v) => s + v, 0), 0);
});

test('каждая шкала набирается вопросами в обе стороны', () => {
    for (const axis of AXIS_IDS) {
        let plus = 0;
        let minus = 0;
        for (const q of QUESTIONS) {
            const list = q.type === 'scale' ? [q] : (q.type === 'order' ? q.items : q.options);
            for (const item of list) {
                if (item.w[axis] > 0) plus++;
                if (item.w[axis] < 0) minus++;
            }
        }
        assert.ok(plus >= 5, `шкалу ${axis} почти нечем поднять (${plus})`);
        assert.ok(minus >= 5, `шкалу ${axis} почти нечем опустить (${minus})`);
    }
});

test('согласие со всем подряд никуда не ведёт', () => {
    // Человек, который на каждое утверждение отвечает «точно про меня» (или
    // наоборот), не должен получать характер: блок «Про себя» уравновешен.
    for (const value of [0, 4]) {
        const answers = {};
        for (const q of QUESTIONS) if (q.type === 'scale') answers[q.id] = value;
        const scores = scoreAnswers(answers);
        for (const axis of AXIS_IDS) {
            assert.equal(scores[axis], 0, `«${value === 4 ? 'всё про меня' : 'ничего не про меня'}» сдвинуло ${axis}`);
        }
    }
});

test('середина шкалы не двигает ничего', () => {
    const answers = {};
    for (const q of QUESTIONS) if (q.type === 'scale') answers[q.id] = 2;
    assert.deepEqual(scoreAnswers(answers), { courage: 0, ambition: 0, intellect: 0, loyalty: 0 });
});

// ── Что отдаётся в браузер ───────────────────────────────────────────────────

test('клиенту не уезжают веса', () => {
    const json = JSON.stringify(publicQuestions('user-1'));
    assert.equal(json.includes('"w"'), false, 'веса вопросов утекли на клиент');
    for (const axis of AXIS_IDS) {
        assert.equal(json.includes(axis), false, `название шкалы ${axis} утекло на клиент`);
    }
    assert.equal(json.includes('gryffindor'), false, 'факультеты видны в вопросах');
});

test('порядок свой у каждого, но не меняется между заходами', () => {
    const first = publicQuestions('user-1');
    const again = publicQuestions('user-1');
    const other = publicQuestions('user-2');

    assert.deepEqual(first, again, 'один и тот же аккаунт получил разный порядок — тест нельзя продолжить');
    assert.equal(first.length, QUESTION_COUNT);
    assert.notDeepEqual(first.map(q => q.id), other.map(q => q.id), 'у всех одинаковый порядок');

    // Перемешивается только внутренность блока: сценарий теста сохраняется.
    const order = SECTIONS.map(s => s.id);
    const seen = first.map(q => order.indexOf(q.section));
    assert.deepEqual(seen, seen.slice().sort((a, b) => a - b), 'блоки перемешались между собой');

    // Ни один вопрос не потерялся при перемешивании.
    assert.deepEqual(new Set(first.map(q => q.id)), new Set(QUESTIONS.map(q => q.id)));
});

// ── Проверка ответов ─────────────────────────────────────────────────────────

test('мусорный ответ не проходит', () => {
    const choice = QUESTIONS.find(q => q.type === 'choice');
    assert.equal(normalizeAnswer(choice.id, 'нет-такого-варианта'), null);
    assert.equal(normalizeAnswer(choice.id, 0), null);
    assert.equal(normalizeAnswer(choice.id, choice.options[1].id), choice.options[1].id);

    const scale = QUESTIONS.find(q => q.type === 'scale');
    assert.equal(normalizeAnswer(scale.id, -1), null);
    assert.equal(normalizeAnswer(scale.id, SCALE_LABELS.length), null);
    assert.equal(normalizeAnswer(scale.id, 1.5), null);
    assert.equal(normalizeAnswer(scale.id, '3'), 3, 'число строкой из JSON — нормальный ответ');

    const order = QUESTIONS.find(q => q.type === 'order');
    const ids = order.items.map(i => i.id);
    assert.deepEqual(normalizeAnswer(order.id, ids.slice().reverse()), ids.slice().reverse());
    assert.equal(normalizeAnswer(order.id, ids.slice(0, 3)), null, 'неполная расстановка');
    assert.equal(normalizeAnswer(order.id, [ids[0], ids[0], ids[1], ids[2]]), null, 'повтор пункта');
    assert.equal(normalizeAnswer(order.id, [...ids.slice(1), 'чужой']), null, 'чужой пункт');

    assert.equal(normalizeAnswer('нет-такого-вопроса', 'что-угодно'), null);
});

test('мусор в базе не роняет подсчёт и не влияет на него', () => {
    const next = rnd(7);
    const answers = randomAnswers(next);
    const clean = scoreAnswers(answers);
    const dirty = scoreAnswers({ ...answers, 'вопрос-которого-нет': 'ответ', d1: 99 });
    // d1 испорчен, поэтому не учитывается — остальное считается как считалось.
    assert.equal(typeof dirty.courage, 'number');
    assert.deepEqual(scoreAnswers({ ...answers, 'вопрос-которого-нет': 'ответ' }), clean);
});

// ── Результат ────────────────────────────────────────────────────────────────

test('все четыре факультета достижимы и никто не забирает половину', () => {
    const next = rnd(2024);
    const counts = Object.fromEntries(FACULTY_IDS.map(id => [id, 0]));
    const N = 4000;
    for (let i = 0; i < N; i++) {
        const { faculty } = facultyFromAnswers(randomAnswers(next));
        assert.ok(counts[faculty] !== undefined, `неизвестный факультет ${faculty}`);
        counts[faculty]++;
    }
    for (const id of FACULTY_IDS) {
        const share = counts[id] / N;
        assert.ok(share > 0.08, `${id} почти недостижим (${(share * 100).toFixed(1)}%)`);
        assert.ok(share < 0.5, `${id} забирает половину людей (${(share * 100).toFixed(1)}%)`);
    }
});

test('характер по ответам восстанавливается', () => {
    // Симулируем людей: у каждого свой характер по четырём шкалам, и на каждый
    // вопрос он выбирает вариант, который ближе к нему (с шумом — люди отвечают
    // неровно). Проверяем, что тест возвращает тот же факультет, к которому
    // человек и относится. Это главная проверка всей затеи: если она падает,
    // тест меряет не то, что написано в шапке quiz.js.
    const next = rnd(31337);
    const dot = (w, ch) => AXIS_IDS.reduce((s, a) => s + w[a] * ch[a], 0);
    const noisy = (w, ch) => dot(w, ch) / 40 + (next() - 0.5);

    let hit = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) {
        const character = Object.fromEntries(AXIS_IDS.map(a => [a, (next() * 2 - 1) * 100]));
        const answers = {};
        for (const q of QUESTIONS) {
            if (q.type === 'scale') {
                const v = dot(q.w, character) / 60 + (next() - 0.5);
                answers[q.id] = Math.max(0, Math.min(4, Math.round(v * 2 + 2)));
            } else if (q.type === 'order') {
                answers[q.id] = q.items
                    .map(item => ({ id: item.id, s: noisy(item.w, character) }))
                    .sort((a, b) => b.s - a.s)
                    .map(x => x.id);
            } else {
                answers[q.id] = q.options
                    .map(o => ({ id: o.id, s: noisy(o.w, character) }))
                    .sort((a, b) => b.s - a.s)[0].id;
            }
        }
        if (facultyFromAnswers(answers).faculty === pickFaculty(character)) hit++;
    }
    const accuracy = hit / N;
    assert.ok(accuracy > 0.75, `тест угадывает характер только в ${(accuracy * 100).toFixed(1)}% случаев`);
});

test('результат воспроизводим: те же ответы — тот же факультет', () => {
    const answers = randomAnswers(rnd(11));
    const first = facultyFromAnswers(answers);
    const second = facultyFromAnswers({ ...answers });
    assert.deepEqual(first, second);
});

test('у каждого эталона есть описание, и наоборот', () => {
    for (const id of FACULTY_IDS) {
        assert.ok(__internals.PROTOTYPES[id], `у факультета ${id} нет эталона — в него никто не попадёт`);
        const f = facultyById(id);
        assert.ok(f.name && f.prefix && f.about, `у факультета ${id} нет описания для карточки`);
        assert.ok(f.prefix.length <= 8, `префикс «${f.prefix}» не влезет рядом с ником`);
        assert.ok(Array.isArray(f.qualities) && f.qualities.length >= 3);
    }
    for (const id of Object.keys(__internals.PROTOTYPES)) {
        assert.ok(FACULTY_IDS.includes(id), `эталон ${id} не описан в shared/faculties.js`);
    }
});

test('эталоны разнесены и сравнимы по силе', () => {
    const norm = id => Math.sqrt(AXIS_IDS.reduce((s, a) => s + __internals.PROTOTYPES[id][a] ** 2, 0));
    const norms = FACULTY_IDS.map(norm);
    // Эталон, который ближе к нулю остальных, забирал бы всех, кто отвечал
    // ровно: середина поля не должна принадлежать одному факультету.
    assert.ok(Math.max(...norms) / Math.min(...norms) < 1.25, 'эталоны сильно разной длины');
    for (let i = 0; i < FACULTY_IDS.length; i++) {
        for (let j = i + 1; j < FACULTY_IDS.length; j++) {
            const a = __internals.PROTOTYPES[FACULTY_IDS[i]];
            const b = __internals.PROTOTYPES[FACULTY_IDS[j]];
            const d = Math.sqrt(AXIS_IDS.reduce((s, ax) => s + (a[ax] - b[ax]) ** 2, 0));
            assert.ok(d > 60, `${FACULTY_IDS[i]} и ${FACULTY_IDS[j]} почти в одной точке`);
        }
    }
});
