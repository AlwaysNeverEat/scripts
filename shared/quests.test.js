import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    pickDaily, pickWeekly, measureDaily, measureWeekly, questText, weeklyNote, cleanBotReport,
    TEMPLATES, GAMES, DUEL_GAMES, DAILY_COUNT, DAILY_XP, WEEKLY_XP, WEEKLY_CARS_MIN,
    mskDay, mskWeek, weekStart, dayStart,
} from './quests.js';

const days = (n) => Array.from({ length: n }, (_, i) => mskDay(Date.parse('2026-01-01T12:00:00Z') + i * 86400_000));

test('дневные: одинаковые на тот же день, свои у каждого', () => {
    const a = pickDaily({ userId: 'u1', day: '2026-10-13' });
    assert.deepEqual(pickDaily({ userId: 'u1', day: '2026-10-13' }), a);
    const others = ['u2', 'u3', 'u4', 'u5'].map(u => JSON.stringify(pickDaily({ userId: u, day: '2026-10-13' })));
    assert.ok(others.some(o => o !== JSON.stringify(a)));
});

test('дневные: три разные игры, парных не больше одной, DOOM не бывает', () => {
    for (const day of days(200)) {
        const qs = pickDaily({ userId: 'u-' + day.slice(-2), day });
        assert.equal(qs.length, DAILY_COUNT);
        assert.equal(new Set(qs.map(q => q.game)).size, DAILY_COUNT);
        assert.ok(qs.filter(q => DUEL_GAMES.includes(q.game)).length <= 1);
        for (const q of qs) {
            assert.ok(q.game in GAMES, q.game);
            assert.equal(q.xp, DAILY_XP);
            assert.ok(questText(q).length > 10);
        }
    }
});

test('дневные: за год выпадает каждая игра и каждый шаблон', () => {
    const seen = new Set();
    for (const day of days(365)) for (const u of ['a', 'b', 'c']) for (const q of pickDaily({ userId: u, day })) seen.add(q.id);
    for (const t of TEMPLATES) assert.ok(seen.has(t.id), t.id);
});

test('порог от рекорда: тройка 60% лучшего, круглым числом; без рекорда — по умолчанию', () => {
    const find = (bests) => {
        for (const day of days(400)) {
            const q = pickDaily({ userId: 'x', day, bests }).find(x => x.id === 'troika-score');
            if (q) return q;
        }
    };
    assert.equal(find({}).params.score, 4000);
    assert.equal(find({ troika: 12_340 }).params.score, 7500);
    assert.equal(find({ troika: 1000 }).params.score, 2500);
});

test('мера «время»: засчитывается только уложившаяся победа', () => {
    const q = { id: 'mahjong-time', params: { min: 6 } };
    assert.equal(measureDaily(q, []).done, false);
    const slow = measureDaily(q, [{ data: { seconds: 480 } }]);
    assert.equal(slow.done, false);
    assert.ok(slow.frac > 0.7 && slow.frac < 0.8);
    assert.match(slow.label, /8:00/);
    assert.equal(measureDaily(q, [{ data: { seconds: 480 } }, { data: { seconds: 359 } }]).done, true);
});

test('мера «очки»: лучшая партия, а не сумма', () => {
    const q = { id: 'troika-score', params: { score: 5000 } };
    const r = measureDaily(q, [{ data: { score: 3000 } }, { data: { score: 3000 } }]);
    assert.equal(r.done, false);
    assert.equal(r.frac, 0.6);
    assert.equal(measureDaily(q, [{ data: { score: 5200 } }]).label, '5 000 / 5 000');
});

test('мера «счёт»: две победы в сапёра', () => {
    const q = { id: 'minesweeper-wins', params: { n: 2 } };
    assert.equal(measureDaily(q, [{ data: { won: true, seconds: 10 } }]).label, '1 / 2');
    assert.equal(measureDaily(q, [{ data: { won: true } }, { data: { won: true } }]).done, true);
});

test('слова: попытки и подсказки', () => {
    assert.equal(measureDaily({ id: 'wordle-tries', params: { tries: 4 } }, [{ data: { won: true, guesses: 5 } }]).done, false);
    assert.equal(measureDaily({ id: 'wordle-tries', params: { tries: 4 } }, [{ data: { won: true, guesses: 4 } }]).done, true);
    assert.equal(measureDaily({ id: 'kontekst-nohint', params: {} }, [{ data: { won: true, guesses: 40, hints: 1 } }]).done, false);
});

test('парные: бот слабее нужного не считается, человек — всегда', () => {
    const q = { id: 'durak-win', params: { level: 1 } };
    assert.equal(measureDaily(q, [{ data: { won: true, vs: 'bot', level: 0 } }]).done, false);
    assert.equal(measureDaily(q, [{ data: { won: true, vs: 'bot', level: 2 } }]).done, true);
    assert.equal(measureDaily(q, [{ data: { won: true, vs: 'human' } }]).done, true);
});

test('отчёт о партии с ботом: только победа, только парные игры, уровень по списку', () => {
    assert.deepEqual(cleanBotReport({ game: 'checkers', won: true, level: 'master' }), { game: 'checkers', data: { won: true, vs: 'bot', level: 2 } });
    assert.equal(cleanBotReport({ game: 'tetris', won: true, level: 'hard' }), null);
    assert.equal(cleanBotReport({ game: 'pool', won: false, level: 'hard' }), null);
    assert.equal(cleanBotReport({ game: 'pool', won: true, level: 'god' }), null);
});

test('недельное: записи только тем, кто записывает; цель +15%, машины не меньше пола', () => {
    for (let w = 0; w < 30; w++) {
        const week = `2026-W${w}`;
        const q = pickWeekly({ userId: 'u', week, avg: { records: 2, cars: 0 } });
        assert.equal(q.kind, 'cars');
        assert.equal(q.params.target, WEEKLY_CARS_MIN);
        assert.equal(q.xp, WEEKLY_XP);
    }
    const kinds = new Set();
    for (let w = 0; w < 30; w++) {
        const q = pickWeekly({ userId: 'op', week: `w${w}`, avg: { records: 40, cars: 20 } });
        kinds.add(q.kind);
        assert.equal(q.params.target, q.kind === 'records' ? 46 : 23);
    }
    assert.deepEqual([...kinds].sort(), ['cars', 'records']);
});

test('недельное по сменам: при 2/2 цель не прыгает за графиком', () => {
    // 10 записей за смену (140 за 14 смен): в четырёхсменную 46, в трёхсменную 35 —
    // «на 15% больше обычного» в обе. От недели было бы 35 × 1.15 = 41 всегда:
    // в трёхсменную это на треть больше обычного за смену.
    const at = (expected) => {
        for (let w = 0; w < 30; w++) {
            const q = pickWeekly({ userId: 'op', week: `w${w}`, avg: { records: 35, cars: 0 }, shifts: { days: 14, expected } });
            if (q.kind === 'records') return q;
        }
    };
    assert.equal(at(4).params.target, 46);
    assert.equal(at(3).params.target, 35);
    assert.equal(at(3).params.perShift, 10);
    assert.equal(weeklyNote(at(3)), 'обычно у вас 10 записей за смену, на этой неделе 3 смены — цель на 15% больше');
    // Машины: пол остаётся.
    const cars = pickWeekly({ userId: 'u', week: 'w1', avg: { records: 0, cars: 2 }, shifts: { days: 8, expected: 3 } });
    assert.equal(cars.params.target, WEEKLY_CARS_MIN);
    assert.match(weeklyNote(cars), /цель не меньше 10/);
});

test('недельное: мера и подписи', () => {
    const q = { kind: 'records', params: { target: 46, avg: 40 } };
    assert.deepEqual(measureWeekly(q, { records: 23 }), { done: false, frac: 0.5, label: '23 / 46' });
    assert.equal(measureWeekly(q, { records: 50 }).label, '46 / 46');
    assert.equal(questText(q), 'Сделать 46 записей за неделю');
    assert.match(weeklyNote(q), /40 записей/);
    assert.match(weeklyNote({ kind: 'cars', params: { target: 10, avg: 2.5 } }), /2,5 машины в неделю — цель не меньше 10/);
    assert.match(weeklyNote({ kind: 'cars', params: { target: 23, avg: 20 } }), /цель на 15% больше/);
});

test('сутки и неделя — по Москве, неделя с понедельника', () => {
    // Вс 11.10 23:30 МСК — ещё прошлая неделя; Пн 12.10 00:30 МСК — уже новая.
    assert.equal(mskWeek(Date.parse('2026-10-11T20:30:00Z')), '2026-10-05');
    assert.equal(mskWeek(Date.parse('2026-10-11T21:30:00Z')), '2026-10-12');
    assert.equal(mskDay(Date.parse('2026-10-12T21:30:00Z')), '2026-10-13');
    assert.equal(new Date(dayStart(Date.parse('2026-10-13T10:00:00Z'))).toISOString(), '2026-10-12T21:00:00.000Z');
    assert.equal(new Date(weekStart(Date.parse('2026-10-18T10:00:00Z'))).toISOString(), '2026-10-11T21:00:00.000Z');
});
