import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_SCORE, SOLO_MAX, DUEL_HP, DUEL_FORFEIT_MISSES, DUEL_MAX_ROUNDS,
    haversineKm, roundScore, scoreGuess, isGuess, multiplierFor,
    createDuel, startRound, submitGuess, resolveRound, canAdvance, markSeen,
    resignDuel, isPlausibleRun,
} from './geo.js';
import { POINTS, JITTER_KM, pickPoint } from './geoPoints.js';

const POINT = { lat: 55.75, lng: 37.62, pano: 'p', label: 'Россия' };

// ── Расстояние и очки ────────────────────────────────────────────────────────

test('расстояние считается по большому кругу', () => {
    // Москва — Петербург, примерно 635 км по прямой.
    const d = haversineKm({ lat: 55.75, lng: 37.62 }, { lat: 59.94, lng: 30.31 });
    assert.ok(Math.abs(d - 635) < 15, `получилось ${d}`);
    // Через полшара — половина окружности Земли.
    const half = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    assert.ok(Math.abs(half - 20015) < 5, `получилось ${half}`);
});

test('пять тысяч — потолок, и он достижим только вблизи точки', () => {
    assert.equal(roundScore(0), MAX_SCORE);
    assert.equal(roundScore(0.01), MAX_SCORE);
    assert.ok(roundScore(1) < MAX_SCORE);
    for (const km of [0, 1, 10, 100, 1000, 5000, 20000]) {
        const s = roundScore(km);
        assert.ok(s >= 0 && s <= MAX_SCORE, `${km} км дало ${s}`);
    }
});

test('очки убывают с расстоянием и не обнуляются на другом конце мира', () => {
    let prev = Infinity;
    for (const km of [0.5, 5, 50, 500, 5000, 15000]) {
        const s = roundScore(km);
        assert.ok(s < prev, `${km} км не меньше предыдущего`);
        prev = s;
    }
    // Зоны нуля у формулы нет: промах даже на десять тысяч километров стоит
    // несколько очков, и в дуэли, где считается разница, это заметно.
    assert.ok(roundScore(10000) > 0);
    assert.equal(scoreGuess(POINT, null).score, 0);
    assert.equal(scoreGuess(POINT, null).distance_km, null);
});

test('кривая догадка — не ноль очков, а отказ', () => {
    assert.ok(isGuess({ lat: 0, lng: 0 }));
    assert.ok(!isGuess({ lat: 91, lng: 0 }));
    assert.ok(!isGuess({ lat: 0, lng: 181 }));
    assert.ok(!isGuess({ lat: NaN, lng: 0 }));
    assert.ok(!isGuess(null));
});

// ── Множитель ────────────────────────────────────────────────────────────────

test('множитель меняется каждые два раунда', () => {
    // Как просили: на втором 1.5, на четвёртом 2, дальше по 0.5.
    assert.equal(multiplierFor(1), 1);
    assert.equal(multiplierFor(2), 1.5);
    assert.equal(multiplierFor(3), 1.5);
    assert.equal(multiplierFor(4), 2);
    assert.equal(multiplierFor(5), 2);
    assert.equal(multiplierFor(6), 2.5);
    assert.equal(multiplierFor(8), 3);
    assert.equal(multiplierFor(10), 3.5);
});

// ── Дуэль ────────────────────────────────────────────────────────────────────

function duelAt(round, { mode = 'move' } = {}) {
    const duel = createDuel({ mode });
    duel.round = round - 1;
    startRound(duel, POINT, 1000);
    return duel;
}

test('урон — это разница очков, умноженная на множитель раунда', () => {
    const duel = duelAt(2);
    // Первый ткнул в точку (5000), второй промахнулся на полмира.
    submitGuess(duel, 0, { lat: POINT.lat, lng: POINT.lng }, 1100);
    submitGuess(duel, 1, { lat: -33.87, lng: 151.21 }, 1200);
    assert.ok(resolveRound(duel, 1300));

    const h = duel.history[0];
    assert.equal(h.mult, 1.5);
    assert.equal(h.hit, 1);
    assert.equal(h.damage, Math.round((h.scores[0] - h.scores[1]) * 1.5));
    assert.equal(duel.hp[0], DUEL_HP);
    // Точное попадание против полного промаха на втором раунде — это 7500
    // урона, то есть больше, чем всё здоровье: дуэль на этом и кончается.
    assert.equal(duel.hp[1], 0);
    assert.equal(duel.phase, 'over');
});

test('на первом раунде идеальный раунд ещё не убивает', () => {
    const duel = duelAt(1);
    submitGuess(duel, 0, { lat: POINT.lat, lng: POINT.lng }, 1100);
    submitGuess(duel, 1, { lat: -33.87, lng: 151.21 }, 1100);
    resolveRound(duel, 1200);
    const h = duel.history[0];
    assert.equal(h.mult, 1);
    assert.equal(duel.hp[1], DUEL_HP - h.damage);
    assert.ok(duel.hp[1] > 0);
    assert.equal(duel.phase, 'reveal');
});

test('одинаковые очки — урона нет', () => {
    const duel = duelAt(1);
    submitGuess(duel, 0, { lat: 10, lng: 10 }, 1100);
    submitGuess(duel, 1, { lat: 10, lng: 10 }, 1100);
    resolveRound(duel, 1200);
    assert.equal(duel.history[0].damage, 0);
    assert.equal(duel.history[0].hit, -1);
    assert.deepEqual(duel.hp, [DUEL_HP, DUEL_HP]);
});

test('здоровье не уходит в минус, а партия кончается на нуле', () => {
    const duel = duelAt(1);
    duel.hp = [DUEL_HP, 100];
    submitGuess(duel, 0, { lat: POINT.lat, lng: POINT.lng }, 1100);
    submitGuess(duel, 1, { lat: -33.87, lng: 151.21 }, 1100);
    resolveRound(duel, 1200);
    assert.equal(duel.hp[1], 0);
    assert.equal(duel.phase, 'over');
    assert.equal(duel.winner, 0);
    assert.equal(duel.reason, 'hp');
});

test('раунд закрывается по времени, неответивший получает ноль', () => {
    const duel = duelAt(1);
    submitGuess(duel, 0, { lat: POINT.lat, lng: POINT.lng }, 1100);
    // Пока время не вышло и второй не ответил — раунд открыт.
    assert.equal(resolveRound(duel, duel.deadline - 1), false);
    assert.ok(resolveRound(duel, duel.deadline + 1));
    assert.equal(duel.history[0].scores[1], 0);
    assert.equal(duel.misses[1], 1);
    assert.equal(duel.misses[0], 0);
});

test('после дедлайна догадку уже не принимают', () => {
    const duel = duelAt(1);
    const late = submitGuess(duel, 0, { lat: 0, lng: 0 }, duel.deadline + 60_000);
    assert.equal(late.ok, false);
    assert.equal(late.reason, 'too_late');
    // Небольшой запас на дорогу до сервера всё же есть.
    assert.ok(submitGuess(duel, 0, { lat: 0, lng: 0 }, duel.deadline + 1000).ok);
});

test('дважды за раунд ответить нельзя', () => {
    const duel = duelAt(1);
    assert.ok(submitGuess(duel, 0, { lat: 0, lng: 0 }, 1100).ok);
    assert.equal(submitGuess(duel, 0, { lat: 50, lng: 50 }, 1200).reason, 'already');
});

test('пропустивший два раунда подряд проигрывает, а бросившие оба — ничья', () => {
    const afk = duelAt(1);
    for (let i = 0; i < DUEL_FORFEIT_MISSES; i++) {
        submitGuess(afk, 0, { lat: 0, lng: 0 }, afk.deadline - 1000);
        resolveRound(afk, afk.deadline + 1);
        if (afk.phase === 'reveal') startRound(afk, POINT, afk.deadline + 2);
    }
    assert.equal(afk.phase, 'over');
    assert.equal(afk.winner, 0);
    assert.equal(afk.reason, 'afk');

    const gone = duelAt(1);
    for (let i = 0; i < DUEL_FORFEIT_MISSES; i++) {
        resolveRound(gone, gone.deadline + 1);
        if (gone.phase === 'reveal') startRound(gone, POINT, gone.deadline + 2);
    }
    assert.equal(gone.phase, 'over');
    assert.equal(gone.winner, null);
    assert.equal(gone.reason, 'abandoned');
});

test('следующий раунд ждёт либо обоих, либо истечения показа', () => {
    const duel = duelAt(1);
    submitGuess(duel, 0, { lat: 1, lng: 1 }, 1100);
    submitGuess(duel, 1, { lat: 2, lng: 2 }, 1100);
    resolveRound(duel, 1200);
    assert.equal(canAdvance(duel, 1300), false);
    markSeen(duel, 0);
    assert.equal(canAdvance(duel, 1300), false);
    markSeen(duel, 1);
    assert.equal(canAdvance(duel, 1300), true);

    const slow = duelAt(1);
    submitGuess(slow, 0, { lat: 1, lng: 1 }, 1100);
    submitGuess(slow, 1, { lat: 2, lng: 2 }, 1100);
    resolveRound(slow, 1200);
    assert.equal(canAdvance(slow, 1300), false);
    assert.equal(canAdvance(slow, 1200 + 60_000), true);
});

test('потолок раундов: побеждает тот, у кого больше здоровья', () => {
    const duel = duelAt(DUEL_MAX_ROUNDS);
    duel.hp = [4000, 3000];
    submitGuess(duel, 0, { lat: 1, lng: 1 }, 1100);
    submitGuess(duel, 1, { lat: 1, lng: 1 }, 1100);
    resolveRound(duel, 1200);
    assert.equal(duel.phase, 'over');
    assert.equal(duel.winner, 0);
    assert.equal(duel.reason, 'rounds');
});

test('сдача заканчивает партию в пользу соперника', () => {
    const duel = duelAt(3);
    assert.ok(resignDuel(duel, 1));
    assert.equal(duel.winner, 0);
    assert.equal(duel.reason, 'resign');
    // Дважды сдаться нельзя — иначе проигравший переписал бы итог.
    assert.equal(resignDuel(duel, 0), false);
    assert.equal(duel.winner, 0);
});

test('дуэль в ноу-мув режимах живёт по тем же правилам', () => {
    for (const mode of ['nomove', 'nmpz']) {
        const duel = duelAt(2, { mode });
        assert.equal(duel.mode, mode);
        submitGuess(duel, 0, { lat: POINT.lat, lng: POINT.lng }, 1100);
        submitGuess(duel, 1, { lat: 0, lng: 0 }, 1100);
        resolveRound(duel, 1200);
        assert.equal(duel.history[0].mult, 1.5);
        assert.ok(duel.hp[1] < DUEL_HP);
    }
    // Незнакомый режим не создаёт партию с мусором в поле.
    assert.equal(createDuel({ mode: 'что-то' }).mode, 'move');
});

// ── Соло ─────────────────────────────────────────────────────────────────────

test('соло-результат проверяется по потолку в пять точек', () => {
    assert.ok(isPlausibleRun({ score: SOLO_MAX, rounds: 5 }).ok);
    assert.ok(isPlausibleRun({ score: 0, rounds: 5 }).ok);
    assert.equal(isPlausibleRun({ score: SOLO_MAX + 1, rounds: 5 }).ok, false);
    assert.equal(isPlausibleRun({ score: -1, rounds: 5 }).ok, false);
    assert.equal(isPlausibleRun({ score: 100, rounds: 4 }).ok, false);
});

// ── Точки ────────────────────────────────────────────────────────────────────

test('опорные точки лежат на карте и покрывают много стран', () => {
    for (const p of POINTS) {
        assert.ok(p.lat >= -90 && p.lat <= 90, `широта ${p.lat}`);
        assert.ok(p.lng >= -180 && p.lng <= 180, `долгота ${p.lng}`);
        assert.ok(p.label.length > 0);
    }
    // Игра, где половина точек в одной стране, вырождается в «угадай регион».
    const byCountry = new Map();
    for (const p of POINTS) byCountry.set(p.label, (byCountry.get(p.label) || 0) + 1);
    assert.ok(byCountry.size >= 50, `стран всего ${byCountry.size}`);
    const biggest = Math.max(...byCountry.values());
    assert.ok(biggest / POINTS.length < 0.1, `на одну страну приходится ${biggest} точек`);
});

test('разброс не уводит точку дальше своего радиуса', () => {
    // Детерминированная «случайность»: перебираем углы и радиусы сеткой.
    for (let i = 0; i < 400; i++) {
        const seq = [(i % 20) / 20, ((i * 7) % 19) / 19, ((i * 13) % 17) / 17];
        let k = 0;
        const rand = () => seq[k++ % seq.length];
        const p = pickPoint(rand);
        const base = POINTS[Math.floor(seq[0] * POINTS.length) % POINTS.length];
        const away = haversineKm(base, p);
        assert.ok(away <= JITTER_KM + 1, `уехало на ${away} км от ${base.label}`);
        assert.ok(p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180);
        assert.equal(p.label, base.label);
    }
});
