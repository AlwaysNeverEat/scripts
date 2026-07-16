// ─────────────────────────────────────────────────────────────────────────────
// Доступ к БД для скриптов импорта — два режима:
//   1) DATABASE_URL — обычное pg-подключение (как scripts/seed.js);
//   2) SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — тот же SQL через HTTPS
//      Management API Supabase (когда сырой TCP наружу закрыт).
// ─────────────────────────────────────────────────────────────────────────────

const SB_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SB_REF = process.env.SUPABASE_PROJECT_REF;
const SB_QUERY_INTERVAL_MS = Math.max(0, Number(process.env.SUPABASE_QUERY_INTERVAL_MS || 350));
const SB_MAX_ATTEMPTS = Math.max(1, Number(process.env.SUPABASE_QUERY_ATTEMPTS || 30));
let lastSupabaseQueryAt = 0;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function throttleSupabaseQuery() {
    if (!SB_QUERY_INTERVAL_MS) return;
    const wait = lastSupabaseQueryAt + SB_QUERY_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSupabaseQueryAt = Date.now();
}

function retryAfterMs(res, fallbackMs) {
    const retryAfter = res.headers.get('retry-after');
    if (!retryAfter) return fallbackMs;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(fallbackMs, seconds * 1000);
    const date = Date.parse(retryAfter);
    return Number.isFinite(date) ? Math.max(fallbackMs, date - Date.now()) : fallbackMs;
}

// Возвращает функцию query(text, params) → { rows }.
export async function makeQuery() {
    if (SB_TOKEN && SB_REF) {
        console.log(`БД: Supabase Management API (проект ${SB_REF})`);
        return supabaseHttpQuery;
    }
    const { query } = await import('../../src/db/client.js');
    return query;
}

// Литерал для подстановки параметра в SQL (Management API не принимает
// параметризованные запросы). standard_conforming_strings в Postgres включён
// по умолчанию — достаточно удвоить одинарные кавычки.
export function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return `'${String(v).replace(/\0/g, '').replace(/'/g, "''")}'`;
}

async function supabaseHttpQuery(text, params = []) {
    const sql = text.replace(/\$(\d+)/g, (_, n) => sqlLiteral(params[Number(n) - 1]));
    for (let attempt = 1; ; attempt++) {
        await throttleSupabaseQuery();
        const res = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}/database/query`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${SB_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: sql }),
        });
        const body = await res.text();
        // 429/5xx — временное: ждём и повторяем (наши запросы идемпотентны).
        // Management API режет частые UPDATE'ы, поэтому дополнительно уважаем
        // Retry-After и даём больше попыток: лучше переждать лимит, чем
        // закрыть окно конвейера после нескольких часов работы.
        if ((res.status === 429 || res.status >= 500) && attempt < SB_MAX_ATTEMPTS) {
            const fallback = Math.min(120000, 2000 * 2 ** Math.min(attempt - 1, 6));
            const ms = retryAfterMs(res, fallback);
            console.warn(`  Supabase API ${res.status}, ретрай ${attempt}/${SB_MAX_ATTEMPTS - 1} через ${Math.ceil(ms / 1000)}с…`);
            await sleep(ms);
            continue;
        }
        if (!res.ok) throw new Error(`Supabase API HTTP ${res.status}: ${body.slice(0, 300)}`);
        let rows;
        try { rows = JSON.parse(body); } catch { rows = []; }
        return { rows: Array.isArray(rows) ? rows : [] };
    }
}

// Порт matchEngineCodes из userscript/src/oil-calculator/app.js: коды двигателей
// совпадают, если любой токен одного входит в любой токен другого.
export function matchEngineCodes(a, b) {
    if (!a || !b) return false;
    const as = String(a).toUpperCase().split(/[,;/\s]+/).map(s => s.trim()).filter(Boolean);
    const bs = String(b).toUpperCase().split(/[,;/\s]+/).map(s => s.trim()).filter(Boolean);
    for (const x of as) for (const y of bs) {
        if (x === y || x.includes(y) || y.includes(x)) return true;
    }
    return false;
}
