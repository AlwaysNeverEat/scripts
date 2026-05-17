// ==UserScript==
// @name         LYNXauto: Скопировать 3 артикула
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        *://lynxauto.info/*
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/LYNXauto-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-1.1.user(1).js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/LYNXauto-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-1.1.user(1).js
// ==/UserScript==

(function () {
'use strict';


function getFilterType(typeText) {
    var t = typeText.toLowerCase();
    if (t.indexOf('салон') !== -1 || t.indexOf('cabin') !== -1) {
        return 'cabin';
    }
    if (t.indexOf('масл') !== -1 || t.indexOf('oil') !== -1) {
        return 'oil';
    }
    if (t.indexOf('воздуш') !== -1 || t.indexOf('air') !== -1) {
        return 'air';
    }
    return null;
}

function getRowSku(row) {
    var link = row.getAttribute('data-link') || '';
    var match = link.match(/\/([A-Z]{1,3}-[\d]+[A-Z]*)\.html/i);
    if (match) return match[1];
    return null;
}

function findRows() {
    return document.querySelectorAll('tr.listtable-item');
}

function addCardButtons() {
    var rows = findRows();
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.querySelector('.lynx-copy-btn')) continue;

        var sku = getRowSku(row);
        if (!sku) continue;

        (function (sku, row) {
            var btn = document.createElement('button');
            btn.className = 'lynx-copy-btn';
            btn.textContent = '📋 ' + sku;
            btn.style.cssText = [
                'display:inline-block',
                'margin-left:8px',
                'padding:2px 8px',
                'background:#005CA9',
                'color:white',
                'border:none',
                'border-radius:4px',
                'cursor:pointer',
                'font-size:11px',
                'vertical-align:middle',
                'position:relative',
                'z-index:9999'
            ].join(';');

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                GM_setClipboard(sku);
                btn.textContent = '✅ ' + sku;
                setTimeout(function () {
                    btn.textContent = '📋 ' + sku;
                }, 1500);
                return false;
            }, true); // true = перехватываем на фазе capture, раньше jQuery

            var firstEl = row.firstElementChild;
            if (firstEl) {
                row.insertBefore(btn, firstEl);
            } else {
                row.appendChild(btn);
            }
        })(sku, row);
    }
}

function addMainButton() {
    if (document.getElementById('lynx-copy-main')) return;

    var btn = document.createElement('button');
    btn.id = 'lynx-copy-main';
    btn.textContent = '📋 Скопировать 3 артикула';
    btn.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'right:20px',
        'z-index:99999',
        'padding:10px 18px',
        'background:#005CA9',
        'color:white',
        'border:none',
        'border-radius:6px',
        'cursor:pointer',
        'font-size:14px',
        'font-weight:bold',
        'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
    ].join(';');

    btn.addEventListener('click', copyThree);
    document.body.appendChild(btn);
}

function copyThree() {
    var btn = document.getElementById('lynx-copy-main');
    var rows = findRows();
    var result = { air: null, oil: null, cabin: null };

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var sku = getRowSku(row);
        if (!sku) continue;

        var typeEl = row.querySelector('span.list_showtable-name2');
        if (!typeEl) continue;

        var type = getFilterType(typeEl.textContent.trim());
        if (!type) continue;

        if (!result[type]) {
            result[type] = sku;
        }

        if (result.air && result.oil && result.cabin) break;
    }

    console.log('[LYNX] Найдено: вф=' + result.air + ' мф=' + result.oil + ' сф=' + result.cabin);

    var missing = [];
    if (!result.air)   missing.push('воздушный фильтр');
    if (!result.oil)   missing.push('масляный фильтр');if (!result.cabin) missing.push('салонный фильтр');

    if (missing.length > 0) {
        alert('Не найдено:\n• ' + missing.join('\n• '));
        return;
    }

    var copyText = [result.air, result.oil, result.cabin].join('\n');
    GM_setClipboard(copyText);
    btn.textContent = '✅ Скопировано!';
    console.log('[LYNX] Скопировано:\n' + copyText);
    setTimeout(function () {
        btn.textContent = '📋 Скопировать 3 артикула';
    }, 2500);
}

function init() {
    addMainButton();

    var observer = new MutationObserver(function () {
        if (!document.getElementById('lynx-copy-main')) {
            addMainButton();
        }
        addCardButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(addCardButtons, 800);
    setTimeout(addCardButtons, 2000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


})();