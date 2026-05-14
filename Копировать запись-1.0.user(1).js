// ==UserScript==
// @name         Копировать запись
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Добавляет кнопку копирования записи на страницу редактирования
// @match        *://*/admin/record/*
// @grant        GM_setClipboard
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