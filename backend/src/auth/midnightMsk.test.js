// Граница суток по МСК — самое коварное место во всей фиче: один просчёт
// в знаке смещения разлогинивает всех либо на 3 часа раньше, либо позже.
// Запуск: node --test backend/src

import test from 'node:test';
import assert from 'node:assert/strict';

import { lastMidnightMsk, isSessionAlive } from './midnightMsk.js';

test('полночь МСК 2026-07-11 00:00:00 = 2026-07-10 21:00:00 UTC', () => {
  const midnight = lastMidnightMsk(new Date('2026-07-10T22:00:00.000Z'));
  assert.equal(midnight.toISOString(), '2026-07-10T21:00:00.000Z');
});

test('за 1мс до полночи МСК ещё вчерашняя полночь', () => {
  // 2026-07-10T20:59:59.999Z = 2026-07-10T23:59:59.999+03 — последняя мс уходящих суток
  const midnight = lastMidnightMsk(new Date('2026-07-10T20:59:59.999Z'));
  assert.equal(midnight.toISOString(), '2026-07-09T21:00:00.000Z');
});

test('ровно в момент полночи МСК уже наступившая полночь', () => {
  // 2026-07-10T21:00:00.000Z = 2026-07-11T00:00:00.000+03 — ровно полночь
  const midnight = lastMidnightMsk(new Date('2026-07-10T21:00:00.000Z'));
  assert.equal(midnight.toISOString(), '2026-07-10T21:00:00.000Z');
});

test('через 1мс после полночи МСК — та же новая полночь', () => {
  const midnight = lastMidnightMsk(new Date('2026-07-10T21:00:00.001Z'));
  assert.equal(midnight.toISOString(), '2026-07-10T21:00:00.000Z');
});

test('isSessionAlive: сессия, созданная вчера, мертва после полночи МСК', () => {
  const createdAt = new Date('2026-07-10T20:00:00.000Z'); // вчера по МСК
  const now = new Date('2026-07-10T21:00:00.001Z'); // уже наступила новая полночь МСК
  assert.equal(isSessionAlive(createdAt, now), false);
});

test('isSessionAlive: сессия, созданная сегодня после полночи МСК, жива', () => {
  const createdAt = new Date('2026-07-10T21:00:00.000Z'); // ровно в полночь МСК
  const now = new Date('2026-07-10T23:00:00.000Z');
  assert.equal(isSessionAlive(createdAt, now), true);
});

test('isSessionAlive: созданная ровно в полночь МСК считается живой (>=, не >)', () => {
  const createdAt = new Date('2026-07-10T21:00:00.000Z');
  const now = new Date('2026-07-10T21:00:00.000Z');
  assert.equal(isSessionAlive(createdAt, now), true);
});

test('работает и на границе месяца/года (МСК-дата переходит на следующий месяц/год)', () => {
  // 2026-12-31T21:00:00Z UTC = 2027-01-01T00:00:00+03 — Новый год по МСК
  const midnight = lastMidnightMsk(new Date('2026-12-31T21:00:00.001Z'));
  assert.equal(midnight.toISOString(), '2026-12-31T21:00:00.000Z');
});
