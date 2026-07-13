// ─────────────────────────────────────────────────────────────────────────────
// Доступ к БД для скриптов импорта — два режима:
//   1) DATABASE_URL — обычное pg-подключение (как scripts/seed.js);
//   2) SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — тот же SQL через HTTPS
//      Management API Supabase (когда сырой TCP наружу закрыт).
// ─────────────────────────────────────────────────────────────────────────────

const SB_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SB_REF = process.env.SUPABASE_PROJECT_REF;

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
        if ((res.status === 429 || res.status >= 500) && attempt < 6) {
            const ms = 3000 * 2 ** (attempt - 1);
            console.warn(`  Supabase API ${res.status}, ретрай через ${ms / 1000}с…`);
            await new Promise(r => setTimeout(r, ms));
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
