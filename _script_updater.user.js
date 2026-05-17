// ==UserScript==
// @name         _Script Updater
// @namespace    https://github.com/AlwaysNeverEat/scripts
// @version      1.0
// @description  Автоматически обновляет все скрипты из приватного GitHub репо
// @author       AlwaysNeverEat
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
    'use strict';

    const GITHUB_TOKEN  = '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';
    const GITHUB_OWNER  = 'AlwaysNeverEat';
    const GITHUB_REPO   = 'scripts';
    const SELF_FILENAME = '_script_updater.user.js';
    const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

    const log = (...args) => console.log('[ScriptUpdater]', ...args);

    // ── HTTP ─────────────────────────────────────────────────────────────────

    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
                onload:  r => r.status >= 200 && r.status < 300
                    ? resolve(r.responseText)
                    : reject(new Error(`HTTP ${r.status} — ${url}`)),
                onerror: e => reject(new Error(`Network error: ${e.error}`)),
            });
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function parseMeta(content, field) {
        const m = content.match(new RegExp(`@${field}[ \\t]+(.+)`));
        return m ? m[1].trim() : null;
    }

    function isNewer(a, b) {
        if (!b) return true;
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const na = pa[i] ?? 0, nb = pb[i] ?? 0;
            if (na > nb) return true;
            if (na < nb) return false;
        }
        return false;
    }

    // btoa не умеет в многобайтовые символы — оборачиваем через encodeURIComponent
    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    // ── Core ──────────────────────────────────────────────────────────────────

    async function checkUpdates() {
        // Ставим временную метку сразу чтобы параллельные вкладки не задваивали проверку
        GM_setValue('last_check', Date.now());
        log('Проверяем обновления...');

        let listing;
        try {
            const raw = await gmFetch(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/`
            );
            listing = JSON.parse(raw);
        } catch (e) {
            log('Ошибка при получении списка файлов:', e.message);
            return;
        }

        const scripts = listing.filter(f =>
            f.type === 'file' &&
            f.name.endsWith('.user.js') &&
            f.name !== SELF_FILENAME
        );

        log(`Найдено скриптов в репо: ${scripts.length}`);

        let updatedCount = 0;

        for (const file of scripts) {
            try {
                log(`Проверяем: ${file.name}`);
                const content = await gmFetch(file.download_url);
                const name    = parseMeta(content, 'name');
                const version = parseMeta(content, 'version');

                if (!name || !version) {
                    log(`${file.name}: не удалось прочитать @name или @version — пропуск`);
                    continue;
                }

                const key    = `${file.name}_version`;
                const stored = GM_getValue(key, null);

                log(`${file.name}: сохранена=${stored ?? 'нет'}, в репо=${version}`);

                if (isNewer(version, stored)) {
                    log(`Обновляем ${file.name}: ${stored ?? '—'} → ${version}`);
                    const b64 = utf8ToBase64(content);
                    GM_openInTab(`data:application/javascript;base64,${b64}`, {
                        active: true,
                        insert: true,
                    });
                    GM_setValue(key, version);
                    updatedCount++;
                } else {
                    log(`${file.name}: актуален (${version})`);
                }
            } catch (e) {
                log(`Ошибка при обработке ${file.name}:`, e.message);
            }
        }

        if (updatedCount > 0) {
            GM_notification({
                title: 'Script Updater',
                text: `Найдено обновлений: ${updatedCount}. Нажми Install в открытых вкладках.`,
                timeout: 8000,
            });
            log(`Готово. Открыты вкладки для ${updatedCount} обновления(й).`);
        } else {
            log('Все скрипты актуальны.');
        }
    }

    // ── Entry points ──────────────────────────────────────────────────────────

    GM_registerMenuCommand('Проверить обновления скриптов сейчас', () => {
        GM_setValue('last_check', 0);
        checkUpdates();
    });

    const lastCheck = GM_getValue('last_check', 0);
    if (Date.now() - lastCheck >= CHECK_INTERVAL) {
        checkUpdates();
    } else {
        log(`Следующая проверка: ${new Date(lastCheck + CHECK_INTERVAL).toLocaleString()}`);
    }

})();
