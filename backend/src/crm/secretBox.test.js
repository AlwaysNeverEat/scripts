import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSecretConfigured, openSecret, sealSecret } from './secretBox.js';

const SECRET = 'test-secret-key-not-a-real-one';

function withSecret(value, fn) {
    const prev = process.env.CRM_LINK_SECRET;
    if (value === null) delete process.env.CRM_LINK_SECRET;
    else process.env.CRM_LINK_SECRET = value;
    try { return fn(); } finally {
        if (prev === undefined) delete process.env.CRM_LINK_SECRET;
        else process.env.CRM_LINK_SECRET = prev;
    }
}

test('пароль шифруется и расшифровывается обратно', () => {
    withSecret(SECRET, () => {
        const sealed = sealSecret('пароль CRM 123');
        assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
        assert.doesNotMatch(sealed, /пароль/);
        assert.equal(openSecret(sealed), 'пароль CRM 123');
    });
});

test('каждый раз новый шифртекст (свой nonce), но тот же пароль', () => {
    withSecret(SECRET, () => {
        const a = sealSecret('one-and-the-same');
        const b = sealSecret('one-and-the-same');
        assert.notEqual(a, b);
        assert.equal(openSecret(a), openSecret(b));
    });
});

test('без CRM_LINK_SECRET привязка отключена, а не «шифрует» открытым текстом', () => {
    withSecret(null, () => {
        assert.equal(linkSecretConfigured(), false);
        assert.equal(sealSecret('пароль'), null);
    });
    // слишком короткий ключ считаем отсутствующим
    withSecret('short', () => {
        assert.equal(linkSecretConfigured(), false);
        assert.equal(sealSecret('пароль'), null);
    });
});

test('чужой ключ, битая и чужая строка не дают пароля', () => {
    const sealed = withSecret(SECRET, () => sealSecret('пароль CRM 123'));
    withSecret('another-secret-key-entirely', () => {
        assert.equal(openSecret(sealed), null);
    });
    withSecret(SECRET, () => {
        const [v, iv, tag, ct] = sealed.split('.');
        // порча шифртекста ловится тегом GCM, а не отдаёт мусор
        const broken = [v, iv, tag, ct.slice(0, -2) + (ct.endsWith('A') ? 'BB' : 'AA')].join('.');
        assert.equal(openSecret(broken), null);
        assert.equal(openSecret('v2.a.b.c'), null);
        assert.equal(openSecret('не тот формат'), null);
        assert.equal(openSecret(null), null);
    });
});
