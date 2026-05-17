// ==UserScript==
// @name         GoodWill: Скопировать 3 артикула
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        *://goodfil.com/*
// @match        *://*.goodfil.com/*
// @match        *://catalog.goodfil.com/*
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/GoodWill-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-1.0.user(1).js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/GoodWill-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-1.0.user(1).js
// ==/UserScript==

(function () {
'use strict';

// Определяем тип фильтра по артикулу
function getTypeByCode(code) {
    var c = code.trim().toUpperCase();
    // Салонный: AG ... CF или AG ... CFC в конце
    if (/^AG\s+\d+.*\sCFC?$/.test(c)) {
        return 'cabin';
    }
    // Масляный: OG ...
    if (/^OG\s+/.test(c)) {
        return 'oil';
    }
    // Воздушный: AG ... (без CF/CFC)
    if (/^AG\s+/.test(c)) {
        return 'air';
    }
    return null;
}

// Ищем все артикулы на странице
function findProductCodes() {
    var results = [];
    var allElements = document.querySelectorAll('*');

    for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];

        // Пропускаем скрипты, стили, наши кнопки
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') {
            continue;
        }
        if (el.classList.contains('gw-copy-btn')) {
            continue;
        }

        // Ищем текстовые узлы с артикулом
        for (var j = 0; j < el.childNodes.length; j++) {
            var node = el.childNodes[j];
            if (node.nodeType !== Node.TEXT_NODE) {
                continue;
            }

            var text = node.textContent.trim();
            // Паттерн артикула GoodWill: OG/AG/FG + пробел + цифры + возможно буквы
            if (/^(OG|AG|FG)\s+\d+/.test(text) && text.length < 25) {
                // Проверяем что кнопка ещё не добавлена
                if (el.querySelector('.gw-copy-btn')) {
                    continue;
                }
                results.push({ el: el, code: text });
                break;
            }
        }
    }

    return results;
}

// Добавляем кнопки к каждому артикулу
function addCardButtons() {
    var items = findProductCodes();

    for (var i = 0; i < items.length; i++) {
        var item = items[i];

        if (item.el.querySelector('.gw-copy-btn')) {
            continue;
        }

        (function (code, container) {
            var btn = document.createElement('button');
            btn.className = 'gw-copy-btn';
            btn.textContent = '📋';
            btn.title = 'Копировать ' + code;
            btn.style.cssText = [
                'display: inline-block',
                'margin-left: 6px',
                'padding: 2px 6px',
                'background: #1976D2',
                'color: white',
                'border: none',
                'border-radius: 4px',
                'cursor: pointer',
                'font-size: 11px',
                'vertical-align: middle',
                'line-height: 1.4'
            ].join(';');

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                GM_setClipboard(code);
                btn.textContent = '✅';
                setTimeout(function () {
                    btn.textContent = '📋';
                }, 1500);
            });

            container.appendChild(btn);
        })(item.code, item.el);
    }
}

// Главная кнопка — копировать 3 артикула
function addMainButton() {
    if (document.getElementById('gw-copy-main')) {
        return;
    }

    var btn = document.createElement('button');
    btn.id = 'gw-copy-main';
    btn.textContent = '📋 Скопировать 3 артикула';
    btn.style.cssText = [
        'position: fixed',
        'bottom: 20px',
        'right: 20px',
        'z-index: 99999',
        'padding: 10px 18px',
        'background: #1976D2',
        'color: white',
        'border: none',
        'border-radius: 6px',
        'cursor: pointer',
        'font-size: 14px',
        'font-weight: bold',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.3)'
    ].join(';');

    btn.addEventListener('click', copyThree);
    document.body.appendChild(btn);
}

function copyThree() {
    var btn = document.getElementById('gw-copy-main');

    // Берём коды из уже добавленных кнопок на карточках
    var copyBtns = document.querySelectorAll('.gw-copy-btn');
    var result = { air: null, oil: null, cabin: null };
    var allFound = [];

    for (var i = 0; i < copyBtns.length; i++) {
        var code = copyBtns[i].title.replace('Копировать ', '').trim();
        if (!code) {
            continue;
        }
        var type = getTypeByCode(code);
        allFound.push(code + ' → ' + (type || 'не распознан'));
        if (!type) {
            continue;
        }
        if (!result[type]) {
            result[type] = code;
        }
    }

    console.log('[GW] Все коды:\n' + allFound.join('\n'));
    console.log('[GW] Результат: вф=' + result.air + ' мф=' + result.oil + ' сф=' + result.cabin);

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
        alert('Не найдено: ' + missing.join(', ') + '\n\nВсе коды:\n' + allFound.join('\n'));
        return;
    }

    var copyText = [result.air, result.oil, result.cabin].join('\n');
    GM_setClipboard(copyText);
    btn.textContent = '✅ Скопировано!';
    setTimeout(function () {
        btn.textContent = '📋 Скопировать 3 артикула';
    }, 2500);
}

function init() {
    addMainButton();

    var observer = new MutationObserver(function () {
        if (!document.getElementById('gw-copy-main')) {
            addMainButton();
        }
        addCardButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Первый запуск с задержкой — Vue рендерит не сразу
    setTimeout(addCardButtons, 1000);
    setTimeout(addCardButtons, 2500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


})();