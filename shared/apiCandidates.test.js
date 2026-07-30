import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApiCandidates } from './apiCandidates.js';

const RENDER = 'https://cars-db-backend.onrender.com';

test('свой домен идёт первым, адрес из сборки — запасным', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: 'k-spot.ru', buildBase: RENDER }),
        ['https://api.k-spot.ru', RENDER],
    );
});

test('www отбрасывается — api вешается на голый домен', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: 'www.k-spot.ru', buildBase: RENDER }),
        ['https://api.k-spot.ru', RENDER],
    );
});

test('на github.io своего домена нет — только адрес из сборки', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: 'alwaysnevereat.github.io', buildBase: RENDER }),
        [RENDER],
    );
});

test('на localhost список пуст — ходим относительными путями через прокси Vite', () => {
    assert.deepEqual(buildApiCandidates({ hostname: 'localhost' }), []);
    assert.deepEqual(buildApiCandidates({ hostname: '127.0.0.1' }), []);
});

test('сайт по IP не даёт имени api.<домен>', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: '192.168.1.50', buildBase: RENDER }),
        [RENDER],
    );
});

test('ручной список вклинивается между своим доменом и сборкой', () => {
    assert.deepEqual(
        buildApiCandidates({
            hostname: 'k-spot.ru',
            buildBase: RENDER,
            extras: ['https://api2.k-spot.ru', 'https://spare.example.com/'],
        }),
        ['https://api.k-spot.ru', 'https://api2.k-spot.ru', 'https://spare.example.com', RENDER],
    );
});

test('дубли схлопываются: сборка уже указывает на свой домен', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: 'k-spot.ru', buildBase: 'https://api.k-spot.ru/' }),
        ['https://api.k-spot.ru'],
    );
});

test('хвостовые слэши срезаются — иначе получим //health', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: 'localhost', extras: ['https://a.example.com///'] }),
        ['https://a.example.com'],
    );
});

test('пустые и мусорные значения не попадают в список', () => {
    assert.deepEqual(
        buildApiCandidates({ hostname: '', buildBase: '', extras: ['', '   ', null] }),
        [],
    );
});
