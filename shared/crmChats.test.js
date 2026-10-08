// «Открытые линии» новой CRM: ответы в той форме, в какой их рисует код самой
// CRM (omni_dialogs / omni_thread / omni_counts), с выдуманными людьми.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    parseDialogs, parseThread, parseUnread, parseClientMatches, chatRefusal, newUnread, channelLabel, parseWaiting,
} from './crmChats.js';

test('список диалогов: кто на том конце — как в CRM', () => {
    const ds = parseDialogs({ dialogs: [
        { id: 1, client: 'Ершов Андрей', client_id: 199305, peer_name: 'Andrey', channel: 'tg', unread: 2, last_dir: 'in', last_text: 'Сколько стоит?', last_at: '2026-10-08 10:01:00', assignee: '' },
        { id: 2, peer_name: '', peer_username: 'damir', channel: 'max', unread: 0, last_dir: 'out', last_text: 'Ждём вас' },
        { id: 3, peer_id: 777, channel: 'vk' },
        { channel: 'vk' },
    ] });
    assert.deepEqual(ds.map(d => d.who), ['Ершов Андрей', '@damir', '#777']);
    assert.equal(ds[0].unread, 2);
    assert.equal(ds[0].clientId, '199305');
    assert.equal(ds[1].lastOut, true);
    assert.equal(ds[2].unread, 0, 'пусто — ноль, а не NaN');
});

test('диалог: шапка и сообщения', () => {
    const t = parseThread({ ok: true,
        dialog: { id: 5, peer_name: 'Олег', peer_username: 'oleg', channel: 'tg', phone: '79310000001', client_id: 199305, assigned_to: 4, status: 'open' },
        messages: [
            { dir: 'in', body: 'Здравствуйте', at: '2026-10-08 10:00:00' },
            { dir: 'out', body: 'Добрый день', author: 'Ищенко', at: '2026-10-08 10:01:00', att: [{}, {}], err: 'blocked' },
        ] });
    assert.equal(t.dialog.clientId, '199305');
    assert.equal(t.dialog.assigned, true);
    assert.equal(t.dialog.closed, false);
    assert.equal(t.messages[1].out, true);
    assert.equal(t.messages[1].attachments, 2);
    assert.equal(t.messages[1].failed, true);
});

test('счётчик, поиск клиента, отказ, подписи каналов', () => {
    assert.equal(parseUnread({ unread: '3' }), 3);
    assert.equal(parseUnread(null), 0);
    assert.deepEqual(parseClientMatches({ items: [{ id: 1, name: 'Олег', phone: '7931' }, { name: 'без id' }] }),
        [{ id: '1', name: 'Олег', phone: '7931' }]);
    assert.equal(chatRefusal({ ok: true }), null);
    assert.equal(chatRefusal({ ok: false, error: 'blocked' }), 'blocked');
    assert.equal(chatRefusal({ dialogs: [] }), null, 'ответ без ok — не отказ');
    assert.equal(channelLabel('tg'), 'Telegram');
});

test('новые сообщения — только рост, и не на первом замере', () => {
    assert.equal(newUnread(null, 5), 0, 'после F5 висящие непрочитанные — не новость');
    assert.equal(newUnread(2, 5), 3);
    assert.equal(newUnread(5, 1), 0, 'прочитали — не новость');
});

test('ждут оператора', () => {
    assert.deepEqual(parseWaiting({ waiting: [{ id: 9, who: '', channel: 'max', last_text: 'позовите человека' }, {}] }),
        [{ id: '9', who: 'Клиент', channel: 'max', lastText: 'позовите человека' }]);
    assert.deepEqual(parseWaiting(null), []);
});
