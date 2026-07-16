// ─────────────────────────────────────────────────────────────────────────────
// HTTP-хелпер для скрейперов импорта: вежливый fetch с ограничением частоты,
// ретраями, поддержкой HTTPS_PROXY и кастомными CA.
//
// CA: podbor.upec.pro не отдаёт промежуточный сертификат GlobalSign, поэтому
// он лежит рядом (certs/globalsign-alphassl-2025.pem) и добавляется к
// системным корням. Если задан NODE_EXTRA_CA_CERTS (например, прокси с
// подменой TLS) — его содержимое тоже подхватывается.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { Agent, ProxyAgent, fetch } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildCa() {
    const ca = [...tls.rootCertificates];
    const intermediate = path.join(__dirname, 'certs', 'globalsign-alphassl-2025.pem');
    if (fs.existsSync(intermediate)) ca.push(fs.readFileSync(intermediate, 'utf8'));
    const extra = process.env.NODE_EXTRA_CA_CERTS;
    if (extra && fs.existsSync(extra)) ca.push(fs.readFileSync(extra, 'utf8'));
    return ca;
}

const CA = buildCa();
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';

export const dispatcher = PROXY
    ? new ProxyAgent({ uri: PROXY, requestTls: { ca: CA } })
    : new Agent({ connect: { ca: CA } });

// ── Ограничение частоты: не чаще одного запроса в RPS_INTERVAL мс ──────────
const RPS_INTERVAL = Number(process.env.SCRAPE_INTERVAL_MS || 1000);
let lastRequestAt = 0;

async function politePause() {
    const wait = lastRequestAt + RPS_INTERVAL - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Вежливый fetch: пауза между запросами + ретраи с бэкоффом на сетевые/5xx.
// redirect: 'manual' — редиректы ASP.NET обрабатываем сами (нужен Location).
export async function politeFetch(url, opts = {}) {
    const attempts = opts.attempts ?? 4;
    for (let attempt = 1; ; attempt++) {
        await politePause();
        try {
            const res = await fetch(url, {
                dispatcher,
                redirect: 'manual',
                ...opts,
                headers: { 'User-Agent': UA, ...(opts.headers || {}) },
            });
            if (res.status >= 500 && attempt < attempts) {
                await backoff(attempt, `HTTP ${res.status} от ${new URL(url).host}`);
                continue;
            }
            return res;
        } catch (e) {
            if (attempt >= attempts) throw e;
            await backoff(attempt, e.message);
        }
    }
}

async function backoff(attempt, reason) {
    const ms = 2000 * 2 ** (attempt - 1);
    console.warn(`  ретрай ${attempt} через ${ms / 1000}с: ${reason}`);
    await new Promise(r => setTimeout(r, ms));
}

// ── Примитивная cookie-банка на один хост (сессия ASP.NET у Motul) ─────────
export class CookieJar {
    constructor() { this.cookies = new Map(); }

    absorb(res) {
        const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        for (const line of set) {
            const [pair] = line.split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
    }

    header() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
}

// Атомарная запись JSON (пишем во временный файл и переименовываем).
export function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
}

export function readJson(file, fallback) {
    try {
        const buf = fs.readFileSync(file);
        const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}
