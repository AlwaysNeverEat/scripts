#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Что за сертификат сейчас у CRM и что вписать в deploy/.env.
//
//   node backend/scripts/crm-tls-info.js
//   node backend/scripts/crm-tls-info.js crm.zamena-masla-spot.ru
//
// На сервере Node на хосте нет — запускать тем же образом, что и сборку сайта:
//
//   docker run --rm --network host -v "$PWD:/app" -w /app node:22-alpine \
//       node backend/scripts/crm-tls-info.js
//
// Печатает кому выдан, кем, до какого числа и отпечаток SHA-256 — готовой
// строкой для CRM_TLS_FINGERPRINT. Сертификат при этом НЕ проверяется: смысл
// скрипта ровно в том, чтобы посмотреть на просроченный или самоподписанный,
// который штатное соединение отвергает.
//
// Отпечаток меняется при каждой перевыпуске сертификата — после обновления на
// стороне CRM переменную придётся обновить (или, если сертификат стал
// нормальным, просто убрать: строгая проверка лучше пина).
// ─────────────────────────────────────────────────────────────────────────────

import tls from 'node:tls';

const arg = process.argv[2] || process.env.CRM_BASE_URL || 'https://crm.zamena-masla-spot.ru';
const url = new URL(arg.includes('://') ? arg : `https://${arg}`);
const host = url.hostname;
const port = Number(url.port) || 443;

const socket = tls.connect({
    host,
    port,
    servername: host,
    rejectUnauthorized: false, // иначе просроченный сертификат не посмотреть
    timeout: 15_000,
}, () => {
    const cert = socket.getPeerCertificate(true);
    if (!cert || !Object.keys(cert).length) {
        console.error(`${host}:${port} не предъявил сертификат`);
        socket.destroy();
        process.exitCode = 1;
        return;
    }
    const fp = String(cert.fingerprint256 || '').replace(/:/g, '').toUpperCase();
    const expired = cert.valid_to && new Date(cert.valid_to) < new Date();
    const selfSigned = cert.issuer && cert.subject
        && JSON.stringify(cert.issuer) === JSON.stringify(cert.subject);

    console.log(`хост:      ${host}:${port}`);
    console.log(`кому:      ${cert.subject?.CN || '—'}`);
    console.log(`кем выдан: ${cert.issuer?.CN || cert.issuer?.O || '—'}${selfSigned ? ' (самоподписанный)' : ''}`);
    console.log(`действует: ${cert.valid_from} — ${cert.valid_to}${expired ? '  ← ПРОСРОЧЕН' : ''}`);
    console.log(`проверка:  ${socket.authorized ? 'проходит' : `не проходит (${socket.authorizationError})`}`);
    console.log('');
    console.log('в deploy/.env:');
    console.log(`CRM_TLS_FINGERPRINT=${fp}`);
    if (socket.authorized) {
        console.log('');
        console.log('Сертификат в порядке — переменная не нужна, строгая проверка лучше пина.');
    }
    socket.destroy();
});

socket.on('timeout', () => {
    console.error(`${host}:${port} не отвечает (таймаут)`);
    socket.destroy();
    process.exitCode = 1;
});

socket.on('error', (err) => {
    console.error(`не удалось подключиться к ${host}:${port}: ${err.message}`);
    process.exitCode = 1;
});
