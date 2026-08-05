import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crmTlsOptions, crmTlsTransport, isTlsCertError, pinnedConnector } from './tlsTrust.js';

// Отпечаток в том виде, в каком его отдаёт node:tls — с двоеточиями и в
// верхнем регистре; в .env его вписывают как придётся.
const FP = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'
    + ':AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const FP_HEX = FP.replace(/:/g, '');

function fakeSocket(fingerprint256) {
    let destroyed = false;
    return {
        getPeerCertificate: () => (fingerprint256 ? { fingerprint256 } : {}),
        destroy: () => { destroyed = true; },
        destroyed: () => destroyed,
    };
}

test('crmTlsOptions: ничего не задано — строгая проверка', () => {
    const opts = crmTlsOptions({});
    assert.equal(opts.active, false);
    assert.equal(crmTlsTransport({}), null);
});

test('crmTlsOptions: отпечаток читается с двоеточиями, в любом регистре и списком', () => {
    const opts = crmTlsOptions({ CRM_TLS_FINGERPRINT: `${FP.toLowerCase()}, ${FP}` });
    assert.deepEqual(opts.fingerprints, [FP_HEX, FP_HEX]);
    assert.equal(opts.active, true);
});

test('crmTlsOptions: огрызок вместо отпечатка отбрасывается, а не молча включает пин', () => {
    // Иначе получилось бы худшее из двух: проверка цепочки снята, а сверять
    // сертификат не с чем.
    const opts = crmTlsOptions({ CRM_TLS_FINGERPRINT: 'ab:cd:ef' });
    assert.deepEqual(opts.fingerprints, []);
    assert.equal(opts.active, false);
});

test('crmTlsOptions: CRM_TLS_INSECURE понимает 1/true/да, но не 0 и не пустое', () => {
    assert.equal(crmTlsOptions({ CRM_TLS_INSECURE: '1' }).insecure, true);
    assert.equal(crmTlsOptions({ CRM_TLS_INSECURE: 'true' }).insecure, true);
    assert.equal(crmTlsOptions({ CRM_TLS_INSECURE: 'да' }).insecure, true);
    assert.equal(crmTlsOptions({ CRM_TLS_INSECURE: '0' }).insecure, false);
    assert.equal(crmTlsOptions({ CRM_TLS_INSECURE: '' }).active, false);
});

test('pinnedConnector: свой сертификат пропускает', () => {
    const socket = fakeSocket(FP);
    const connect = (_opts, cb) => cb(null, socket);
    let got;
    pinnedConnector(connect, [FP_HEX])({}, (err, s) => { got = { err, s }; });
    assert.equal(got.err, null);
    assert.equal(got.s, socket);
    assert.equal(socket.destroyed(), false);
});

test('pinnedConnector: чужой сертификат рвёт соединение', () => {
    // Ради этого пин и нужен: проверка цепочки снята, и без сверки отпечатка
    // пароли работников ушли бы на любой сервер, отозвавшийся по этому адресу.
    const socket = fakeSocket('11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF'
        + ':11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF');
    const connect = (_opts, cb) => cb(null, socket);
    let got;
    pinnedConnector(connect, [FP_HEX])({}, (err, s) => { got = { err, s }; });
    assert.equal(got.err.code, 'CRM_TLS_FINGERPRINT_MISMATCH');
    assert.equal(got.s, undefined);
    assert.equal(socket.destroyed(), true);
});

test('pinnedConnector: ошибку подключения пробрасывает как есть', () => {
    const boom = Object.assign(new Error('нет связи'), { code: 'ECONNREFUSED' });
    let got;
    pinnedConnector((_o, cb) => cb(boom), [FP_HEX])({}, (err) => { got = err; });
    assert.equal(got, boom);
});

test('isTlsCertError: просроченный и самоподписанный — да, обрыв сокета — нет', () => {
    const cert = new TypeError('fetch failed');
    cert.cause = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    assert.equal(isTlsCertError(cert), true);

    const selfSigned = new TypeError('fetch failed');
    selfSigned.cause = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    assert.equal(isTlsCertError(selfSigned), true);

    const socketErr = new TypeError('fetch failed');
    socketErr.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    assert.equal(isTlsCertError(socketErr), false);
});
