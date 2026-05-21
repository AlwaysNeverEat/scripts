// ==UserScript==
// @name         MANN-FILTER: Скопировать 3 артикула
// @namespace    http://tampermonkey.net/
// @version      2.2
// @match        *://www.mann-filter.com/*/catalog/search-results*
// @match        *://www.mann-filter.com/*/catalog*
// @match        *://www.mann-filter.com/*
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/MANN-FILTER-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-2.1.user(2).js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/MANN-FILTER-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-2.1.user(2).js
// ==/UserScript==

(function () {
'use strict';

function addButton() {
    if (document.getElementById('mf-copy-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'mf-copy-btn';
    btn.textContent = '📋 Скопировать 3 артикула';
    btn.style.cssText = [
        'position: fixed',
        'bottom: 20px',
        'right: 20px',
        'z-index: 99999',
        'padding: 10px 18px',
        'background: #005CA9',
        'color: white',
        'border: none',
        'border-radius: 6px',
        'cursor: pointer',
        'font-size: 14px',
        'font-weight: bold',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.3)'
    ].join(';');
    btn.addEventListener('click', copyArtikuls);
    document.body.appendChild(btn);
}

function getCardType(titleText) {
    var t = titleText.toLowerCase();
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

function cabinPriority(sku) {
    if (/^FP\b/i.test(sku)) {
        return 99;
    }
    if (/^CU\b/i.test(sku)) {
        return 1;
    }
    if (/^CUK\b/i.test(sku)) {
        return 2;
    }
    return 3;
}

function isOutdated(card) {
    var dateRange = card.querySelector('.cmp-DateRange');
    if (!dateRange) {
        return false;
    }

    var icon = dateRange.querySelector('.cmp-icon--arrow-right');
    if (!icon) {
        return false;
    }

    var node = icon.previousSibling;
    while (node) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
            return false;
        }
        node = node.previousSibling;
    }

    return true;
}

function findCards() {
    var selectors = [
        '[class*="product-item"]',
        '[class*="productItem"]',
        '[class*="catalog-item"]',
        '[class*="result-item"]',
        '[class*="product-card"]',
        '[class*="productCard"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        var found = document.querySelectorAll(sel);
        if (found.length > 0) {
            var cards = Array.from(found).filter(function (el) {
                return !el.parentElement.closest(sel);
            });
            if (cards.length > 0) {
                console.log('[MF] Карточки: ' + sel + ' (' + cards.length + ')');
                return cards;
            }
        }
    }

    return [];
}

function copyArtikuls() {
    var btn = document.getElementById('mf-copy-btn');
    var cards = findCards();

    if (cards.length === 0) {
        alert('Карточки товаров не найдены. Дождитесь загрузки результатов.');
        return;
    }

    var result = {
        air: null,
        oil: null,
        cabin: null,
        cabinPrio: 99
    };

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var text = card.innerText || card.textContent || '';
        var lower = text.toLowerCase();

        if (lower.indexOf('доступный') === -1) {
            continue;
        }

        if (isOutdated(card)) {
            var keyEl = card.querySelector('[class*="product-key"]');
            console.log('[MF] Устаревший: ' + (keyEl ? keyEl.textContent.trim() : ''));
            continue;
        }

        // Ищем конкретный элемент с типом фильтра у MANN-FILTER
        var titleEl = card.querySelector('[class*="result-item-title"], [class*="item-title"], [class*="filter-type"]');
        // Если не нашли — берём весь текст карточки
        var titleText = titleEl ? titleEl.textContent : text;
        var type = getCardType(titleText);

        if (!type) {
            continue;
        }

                var skuMatch = text.match(/\b([A-Z]{1,3}K?\s?\d[\d\s\/\-]{0,10}(?:\s*[a-z]{1,2})?)\b/i);
        if (!skuMatch) {
            continue;
        }
        var sku = skuMatch[1].trim();

        if (type === 'cabin') {
            var prio = cabinPriority(sku);
            if (prio === 99) {
                continue;
            }
            if (prio < result.cabinPrio) {
                result.cabin = sku;
                result.cabinPrio = prio;
            }
        } else {
            if (!result[type]) {
                result[type] = sku;
            }
        }
    }

    console.log('[MF] Найдено: вф=' + result.air + ' мф=' + result.oil + ' сф=' + result.cabin);

    var missing = [];
    if (!result.air) {
        missing.push('воздушный фильтр');
    }
    if (!result.oil) {
        missing.push('масляный фильтр');
    }
    if (!result.cabin) {
        missing.push('салонный фильтр');
    }

    if (missing.length > 0) {
        alert('Не найдено:\n• ' + missing.join('\n• '));
        return;
    }

    var copyText = [result.air, result.oil, result.cabin].join('\n');
    GM_setClipboard(copyText);
    btn.textContent = '✅ Скопировано!';
    console.log('[MF] Скопировано:\n' + copyText);
    setTimeout(function () {
        btn.textContent = '📋 Скопировать 3 артикула';
    }, 2500);
}

function addCardButtons() {
    var cards = findCards();

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];

        if (card.querySelector('.mf-card-copy-btn')) {
            continue;
        }

        var text = card.innerText || card.textContent || '';
        var skuMatch = text.match(/\b([A-Z]{1,3}K?\s?\d[\d\s\/\-]{0,10}(?:\s*[a-z]{1,2})?)\b/i);
        if (!skuMatch) {
            continue;
        }
        var sku = skuMatch[1].trim();

        if (/^FP\b/i.test(sku)) {
            continue;
        }

        (function (sku) {
            var btn = document.createElement('button');
            btn.className = 'mf-card-copy-btn';
            btn.textContent = '📋 ' + sku;
            btn.style.cssText = [
                'display: block',
                'margin: 8px auto 0',
                'padding: 4px 10px',
                'background: #005CA9',
                'color: white',
                'border: none',
                'border-radius: 4px',
                'cursor: pointer',
                'font-size: 12px',
                'font-weight: bold'
            ].join(';');

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                GM_setClipboard(sku);
                btn.textContent = '✅ ' + sku;
                setTimeout(function () {
                    btn.textContent = '📋 ' + sku;
                }, 1500);
            });

            card.appendChild(btn);
        })(sku);
    }
}

function init() {
    addButton();

    var observer = new MutationObserver(function () {
        if (!document.getElementById('mf-copy-btn')) {
            addButton();
        }
        addCardButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();