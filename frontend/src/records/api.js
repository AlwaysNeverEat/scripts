// API-клиент страницы «Записи». В отличие от main.js здесь нет Bearer-токена:
// доступ общий, персональных сессий сайта у этой страницы нет — только грубый
// x-api-key (как у всех клиентов) и серверные креды оригинальной админки.

const API_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const API_KEY = (typeof __API_KEY__ !== 'undefined' && __API_KEY__) ? __API_KEY__ : '';

export async function apiFetch(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (API_KEY) headers['x-api-key'] = API_KEY;
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
