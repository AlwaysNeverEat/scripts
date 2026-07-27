// API-клиент страницы «Записи». Доступ к самим записям общий — он держится на
// грубом x-api-key (как у всех клиентов) и серверных кредах оригинальной
// админки, аккаунт сайта для него не нужен. Токен сессии всё же прикладываем,
// если он есть: по нему бэкенд отвечает, кто смотрит, а от этого зависит
// подпись оператора в строке для Битрикса. Нет токена — просто гость.

const API_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const API_KEY = (typeof __API_KEY__ !== 'undefined' && __API_KEY__) ? __API_KEY__ : '';
const TOKEN_KEY = 'cars_db_session_token'; // тот же ключ, что в main.js

export async function apiFetch(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (API_KEY) headers['x-api-key'] = API_KEY;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let fetchBody;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
    }
    const res = await fetch(API_BASE + path, { method, headers, body: fetchBody });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const errVal = json && json.error;
        const isObj = errVal && typeof errVal === 'object';
        const err = new Error((isObj ? (errVal.message || errVal.code) : errVal) || `API ${res.status}`);
        if (isObj && errVal.code) err.code = errVal.code;
        err.status = res.status;
        throw err;
    }
    return json;
}
