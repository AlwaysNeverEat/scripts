import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSessid } from './client.js';

// sessid — единственное, что мы вычитываем из разметки портала, и без него не
// проходит ни один пишущий запрос. Записан он в разных местах по-разному,
// поэтому проверяем все виды, которые встречались живьём.
test('sessid берётся из конфига ядра', () => {
    const html = '<script>(window.BX||{}).message({"bitrix_sessid":"bfa219678549c3558ec4a2d15623eaae"})</script>';
    assert.equal(extractSessid(html), 'bfa219678549c3558ec4a2d15623eaae');
});

test('sessid берётся из старой переменной', () => {
    const html = "<script>var bx_sessid='0123456789abcdef0123456789abcdef';</script>";
    assert.equal(extractSessid(html), '0123456789abcdef0123456789abcdef');
});

test('sessid берётся из адреса ajax-обработчика', () => {
    const html = '<div data-url="/bitrix/components/bitrix/crm.lead.details/ajax.php?sessid=\'aaaaaaaabbbbbbbbccccccccdddddddd\'"></div>';
    assert.equal(extractSessid(html), 'aaaaaaaabbbbbbbbccccccccdddddddd');
});

// Страница логина sessid не содержит, и это ровно тот признак, по которому
// клиент понимает, что сессия умерла. Вернуть отсюда что попало нельзя.
test('на странице без sessid возвращается null', () => {
    assert.equal(extractSessid('<html><body>войдите</body></html>'), null);
    assert.equal(extractSessid(''), null);
    assert.equal(extractSessid(null), null);
});
