import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leadPhones, leadKey } from './leadCars.js';

test('номера лида: любой формат, без повторов, ключ не зависит от порядка', () => {
    assert.deepEqual(leadPhones(['+7 (921) 003-82-18', '89119157910', '79210038218', '']), ['79119157910', '79210038218']);
    assert.equal(leadKey(['79210038218', '79119157910']), leadKey(['79119157910', '79210038218']));
    // Готовый ключ разбирается обратно, а не склеивается в 22 цифры.
    assert.equal(leadKey('79119157910,79210038218'), '79119157910,79210038218');
    assert.equal(leadKey('9119157910'), '79119157910');
    assert.equal(leadKey(['123', null]), '');
});
