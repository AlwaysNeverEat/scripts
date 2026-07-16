// ─────────────────────────────────────────────────────────────────────────────
// HTTP-хелпер для скрейперов импорта: ограничение частоты, тайм-ауты, ретраи,
// поддержка HTTPS_PROXY и кастомных CA.
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

const RPS_INTERVAL = Math.max(0, Number(process.env.SCRAPE_INTERVAL_MS || 1000));
const DEFAULT_TIMEOUT_MS = Math.max(5000, Number(process.env.HTTP_TIMEOUT_MS || 45000));
let lastRequestAt = 0;

async function politePause() {
    const wait = lastRequestAt + RPS_INTERVAL - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// opts.attempts и opts.timeoutMs относятся к этому хелперу и не передаются
// undici. Без явного signal каждый запрос обрывается по тайм-ауту, поэтому
// Windows-конвейер больше не может бесконечно молчать на зависшем сайте.
export async function politeFetch(url, opts = {}) {
    const {
        attempts = 4,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        headers = {},
        signal,
        ...fetchOptions
    } = opts;

    for (let attempt = 1; ; attempt++) {
        await politePause();
        try {
            const requestSignal = signal || AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
            const res = await fetch(url, {
                dispatcher,
                redirect: 'manual',
                ...fetchOptions,
                signal: requestSignal,
                headers: { 'User-Agent': UA, ...headers },
            });
            if ((res.status === 429 || res.status >= 500) && attempt < attempts) {
                await backoff(attempt, `HTTP ${res.status} от ${new URL(url).host}`);
                continue;
            }
            return res;
        } catch (error) {
            const reason = error?.name === 'TimeoutError'
                ? `тайм-аут ${Math.round(timeoutMs / 1000)}с у ${new URL(url).host}`
                : String(error?.message || error);
            if (attempt >= attempts) throw new Error(`${reason} (попыток: ${attempts})`, { cause: error });
            await backoff(attempt, reason);
        }
    }
}

async function backoff(attempt, reason) {
    const ms = Math.min(30000, 2000 * 2 ** (attempt - 1));
    console.warn(`  HTTP: ${reason}; повтор ${attempt} через ${Math.ceil(ms / 1000)}с`);
    await new Promise(resolve => setTimeout(resolve, ms));
}

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
        return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    }
}

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
