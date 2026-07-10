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

test('линейка added: 5/50/100/500/1000, названия и пороги', () => {
  const ladder = [
    ['cars_added_5', 5, 'Эксперт расчетов 5'],
    ['cars_added_50', 50, 'Эксперт расчетов 50'],
    ['cars_added_100', 100, 'Эксперт расчетов 100'],
    ['cars_added_500', 500, 'Эксперт расчетов 500'],
    ['cars_added_1000', 1000, 'Экспертище'],
  ];
  for (const [id, threshold, title] of ladder) {
    const a = achievementById(id);
    assert.ok(a, id);
    assert.equal(a.metric, 'added');
    assert.equal(a.threshold, threshold);
    assert.equal(a.title, title);
  }
});

test('diffAchievements: 100 добавленных — вся нижняя часть линейки разом', () => {
  const { grant, revoke } = diffAchievements({ added: 100, edited: 0 }, []);
  assert.deepEqual(grant, ['cars_added_5', 'cars_added_50', 'cars_added_100']);
  assert.deepEqual(revoke, []);
});

test('diffAchievements: упал со 100 до 99 — отзывается только сотня', () => {
  const unlocked = ['cars_added_5', 'cars_added_50', 'cars_added_100'];
  const { grant, revoke } = diffAchievements({ added: 99, edited: 0 }, unlocked);
  assert.deepEqual(grant, []);
  assert.deepEqual(revoke, ['cars_added_100']);
});
