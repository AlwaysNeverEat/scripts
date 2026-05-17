// ==UserScript==
// @name         Копировать запись
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Добавляет кнопку копирования записи на страницу редактирования
// @match        *://*/admin/record/*
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/%D0%9A%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C-1.0.user(1).js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/%D0%9A%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C-1.0.user(1).js
// ==/UserScript==

(function () {
    'use strict';

    function addCopyButton() {
        // Ждём пока форма загрузится
        const form = document.querySelector('.edit-record-form');
        if (!form) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '📋 Скопировать запись';
        btn.style.cssText = `
            margin-left: 10px;
            padding: 6px 14px;
            background: #5cb85c;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        `;

        btn.addEventListener('click', function () {
            const dateEl = document.querySelector('select[name="date"]');
            const timeEl = document.querySelector('select[name="time"]');
            const addressEl = document.querySelector('select[name="address_id"]');

            const date = dateEl ? dateEl.value : '—';
            const time = timeEl ? timeEl.value : '—';
            const address = addressEl
                ? addressEl.options[addressEl.selectedIndex].text.trim()
                : '—';

            const text = `${date} ${time} ${address} (Сергей)`;

            GM_setClipboard(text);

            btn.textContent = '✅ Скопировано!';
            setTimeout(() => {
                btn.textContent = '📋 Скопировать запись';
            }, 2000);
        });

        // Вставляем кнопку рядом с кнопкой "Сохранить"
        const saveBtn = form.querySelector('button[type="submit"]');
        if (saveBtn) {
            saveBtn.parentNode.insertBefore(btn, saveBtn.nextSibling);
        }
    }

    // Небольшая задержка — страница грузит select через AJAX
    setTimeout(addCopyButton, 800);
})();