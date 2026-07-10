import test from 'node:test';
import assert from 'node:assert/strict';

import { diffAchievements, achievementById, ACHIEVEMENTS } from './achievements.js';

test('линейка содержит cars_added_5 с порогом 5 по метрике added', () => {
  const a = achievementById('cars_added_5');
  assert.ok(a);
  assert.equal(a.metric, 'added');
  assert.equal(a.threshold, 5);
});

test('diffAchievements: ниже порога и нет ачивки — ничего не происходит', () => {
  const { grant, revoke } = diffAchievements({ added: 4, edited: 0 }, []);
  assert.deepEqual(grant, []);
  assert.deepEqual(revoke, []);
});

test('diffAchievements: достиг порога — ачивка начисляется', () => {
  const { grant, revoke } = diffAchievements({ added: 5, edited: 0 }, []);
  assert.deepEqual(grant, ['cars_added_5']);
  assert.deepEqual(revoke, []);
});

test('diffAchievements: уже есть и всё ещё заслужена — не дублируется', () => {
  const { grant, revoke } = diffAchievements({ added: 7, edited: 0 }, ['cars_added_5']);
  assert.deepEqual(grant, []);
  assert.deepEqual(revoke, []);
});

test('diffAchievements: счётчик упал ниже порога — ачивка отзывается', () => {
  // модератор переназначил машину другому пользователю: было 5, стало 4
  const { grant, revoke } = diffAchievements({ added: 4, edited: 0 }, ['cars_added_5']);
  assert.deepEqual(grant, []);
  assert.deepEqual(revoke, ['cars_added_5']);
});

test('diffAchievements: отсутствующая метрика трактуется как 0', () => {
  const { grant, revoke } = diffAchievements({}, ['cars_added_5']);
  assert.deepEqual(grant, []);
  assert.deepEqual(revoke, ['cars_added_5']);
});

test('у всех ачивок уникальные id', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
});
