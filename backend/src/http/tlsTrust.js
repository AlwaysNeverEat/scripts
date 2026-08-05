// ─────────────────────────────────────────────────────────────────────────────
// Доверие к TLS-сертификату внутренней CRM.
//
// Зачем это вообще. CRM — не наш сервер, и её сертификат периодически
// оказывается просроченным или самоподписанным. Node в таком случае честно
// рвёт соединение (CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT), и панель
// «Наличие на станции» показывает «CRM недоступна» — при том, что браузер
// работника в ту же CRM заходит: человек один раз ткнул «всё равно перейти», а
// сервер так не умеет. Чинить сертификат надо на стороне CRM, но пока его
// чинят, панель обязана работать — без неё оператор не видит остатков.
//
// Глобальный NODE_TLS_REJECT_UNAUTHORIZED=0 не годится: тем же процессом мы
// ходим в телеграм, в админку записей и в каталоги, и снимать проверку со всех
// сразу нельзя. Поэтому послабление точечное — отдельный dispatcher, который
// используется ТОЛЬКО на запросах к CRM (crm/client.js):
//
//   CRM_TLS_FINGERPRINT — отпечатки SHA-256 сертификата CRM через запятую
//       (регистр и двоеточия не важны). Цепочку не проверяем — просроченный и
//       самоподписанный пройдут, — зато сверяем сам сертификат, так что
//       подсунуть вместо CRM чужой сервер всё равно нельзя. Это основной
//       способ; отпечаток печатает `node backend/scripts/crm-tls-info.js`.
//   CRM_TLS_CA_FILE — PEM с корневым сертификатом: годится, когда CRM живёт на
//       своём удостоверяющем центре, а сам сертификат не просрочен.
//   CRM_TLS_INSECURE=1 — не проверять сертификат вообще. Последнее средство:
//       по этому же соединению уходят пароли работников от CRM.
//
// Ничего не задано — поведение прежнее, строгая проверка.
//
// Про undici. Встроенный в Node fetch не принимает dispatcher, собранный
// пакетом undici из node_modules: у внутреннего и внешнего undici разные версии
// интерфейса обработчиков, и запрос падает с «invalid onRequestStart method».
// Поэтому вместе с dispatcher отдаём и fetch из того же undici — оба берутся
// из одного пакета и друг друга понимают.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

// Ошибки проверки сертификата. Их объединяет одно: повторять запрос
// бессмысленно (в отличие от обрывов из netRetry.js), а чинить — не на сайте.
const TLS_CERT_ERRORS = new Set([
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CRM_TLS_FINGERPRINT_MISMATCH',
]);

export function isTlsCertError(err) {
    return TLS_CERT_ERRORS.has(err?.cause?.code || err?.code);
}

// Предупреждения в лог — по одному разу на текст: запросы к CRM идут потоком,
// и повторять одно и то же в каждой строке лога незачем.
const warned = new Set();
function warnOnce(text) {
    if (warned.has(text)) return;
    warned.add(text);
    console.warn(text);
}

const truthy = (v) => /^(1|true|yes|on|да)$/i.test(String(v ?? '').trim());
const hexOnly = (v) => String(v ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();

// Что именно попросили в env. Отдельной функцией — её удобно проверить тестом,
// не поднимая ни одного соединения.
export function crmTlsOptions(env = process.env) {
    const fingerprints = [];
    for (const raw of String(env.CRM_TLS_FINGERPRINT || '').split(/[,;\s]+/).filter(Boolean)) {
        const hex = hexOnly(raw);
        // Молча проглотить опечатку нельзя: админ будет думать, что пин
        // работает, а на деле соединение либо строгое, либо (при
        // CRM_TLS_INSECURE) вообще без проверки.
        if (hex.length === 64) fingerprints.push(hex);
        else warnOnce(`CRM_TLS_FINGERPRINT: «${raw}» не похож на SHA-256 (нужно 64 hex-символа) — пропускаю`);
    }
    const caFile = String(env.CRM_TLS_CA_FILE || '').trim();
    const insecure = truthy(env.CRM_TLS_INSECURE);
    return {
        fingerprints,
        caFile,
        insecure,
        active: Boolean(fingerprints.length || caFile || insecure),
    };
}

// Коннектор с проверкой отпечатка. Цепочку к этому моменту уже не проверяли
// (иначе просроченный сертификат не дожил бы сюда), поэтому сверка отпечатка —
// единственное, что отличает CRM от чужого сервера. Экспортируется ради теста:
// connect и socket в нём подставные, настоящий TLS не нужен.
export function pinnedConnector(connect, fingerprints) {
    return (options, cb) => connect(options, (err, socket) => {
        if (err) return cb(err);
        const fp = hexOnly(socket?.getPeerCertificate?.()?.fingerprint256);
        if (fingerprints.includes(fp)) return cb(null, socket);
        socket?.destroy?.();
        cb(Object.assign(
            new Error(fp
                ? `сертификат CRM (${fp.slice(0, 16)}…) не совпал с CRM_TLS_FINGERPRINT`
                : 'сервер CRM не предъявил сертификат'),
            { code: 'CRM_TLS_FINGERPRINT_MISMATCH' },
        ));
    });
}

let cached = { key: '', transport: null };

// null — послаблений не просили, ходим обычным глобальным fetch со строгой
// проверкой. Иначе Promise с парой { fetchImpl, dispatcher } из одного undici.
export function crmTlsTransport(env = process.env) {
    const opts = crmTlsOptions(env);
    if (!opts.active) return null;
    const key = JSON.stringify([opts.fingerprints, opts.caFile, opts.insecure]);
    // Agent держит пул соединений — пересобирать его на каждый запрос нельзя,
    // но и намертво кэшировать тоже: в тестах env меняется.
    if (cached.key !== key) cached = { key, transport: buildTransport(opts) };
    return cached.transport;
}

async function buildTransport(opts) {
    let undici;
    try {
        undici = await import('undici');
    } catch {
        throw Object.assign(
            new Error('задан CRM_TLS_*, но пакета undici нет — послабление TLS не работает'),
            { code: 'CRM_TLS_NO_UNDICI' },
        );
    }
    const { Agent, buildConnector, fetch: undiciFetch } = undici;

    // Файл не читается — это ошибка настройки, и она должна быть видна, а не
    // превращаться в тихую строгую проверку.
    const ca = opts.caFile ? readFileSync(opts.caFile) : undefined;
    // Проверку цепочки снимаем и когда просили отпечаток: Node зовёт
    // checkServerIdentity только после успешной проверки цепочки, так что для
    // просроченного сертификата пин иначе не сработал бы вовсе.
    const rejectUnauthorized = !(opts.insecure || opts.fingerprints.length);
    const connect = buildConnector({
        ...(ca ? { ca } : {}),
        rejectUnauthorized,
        // При возобновлении TLS-сессии сервер сертификат уже не присылает, и
        // getPeerCertificate() на таком сокете отдаёт пустой объект — пин
        // отверг бы собственную же CRM на втором запросе подряд. Кэш сессий
        // выключаем: полное рукопожатие на новое соединение нам по карману
        // (запросы к CRM и так разнесены на 400 мс), а сверять отпечаток надо
        // на каждом.
        ...(opts.fingerprints.length ? { maxCachedSessions: 0 } : {}),
    });

    if (opts.fingerprints.length) {
        warnOnce(`сертификат CRM принимается по отпечатку (CRM_TLS_FINGERPRINT, ${opts.fingerprints.length} шт.)`);
    } else if (opts.insecure) {
        warnOnce('CRM_TLS_INSECURE=1 — сертификат CRM не проверяется совсем;'
            + ' надёжнее задать CRM_TLS_FINGERPRINT (см. backend/scripts/crm-tls-info.js)');
    }

    return {
        fetchImpl: undiciFetch,
        dispatcher: new Agent({
            connect: opts.fingerprints.length ? pinnedConnector(connect, opts.fingerprints) : connect,
        }),
    };
}
