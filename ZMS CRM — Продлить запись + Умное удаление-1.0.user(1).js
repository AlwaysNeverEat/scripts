// ==UserScript==
// @name         ZMS CRM — Продлить запись + Умное удаление
// @namespace    zamena-masla-spot.ru
// @version      1.1
// @description  Временная заглушка: отключены изменения CRM, оставлена только информационная плашка
// @match        https://zamena-masla-spot.ru/admin/record*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%9F%D1%80%D0%BE%D0%B4%D0%BB%D0%B8%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20%2B%20%D0%A3%D0%BC%D0%BD%D0%BE%D0%B5%20%D1%83%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-1.0.user(1).js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%9F%D1%80%D0%B4%D0%BB%D0%B8%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20%2B%20%D0%A3%D0%BC%D0%BD%D0%BE%D0%B5%20%D1%83%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-1.0.user(1).js
// ==/UserScript==

/*
  ОРИГИНАЛЬНАЯ ЛОГИКА СКРИПТА (продление/удаление) ВРЕМЕННО ОТКЛЮЧЕНА.
  Этот скрипт больше не изменяет записи CRM и только показывает информационную плашку.
*/

(function () {
  'use strict';

  function createInfoUI() {
    if (document.getElementById('__zms_design_btn')) return;

    const btn = document.createElement('button');
    btn.id = '__zms_design_btn';
    btn.textContent = 'а где дизайн';
    btn.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:2147483647',
      'padding:10px 14px',
      'border:none',
      'border-radius:10px',
      'background:#1f2937',
      'color:#fff',
      'font:600 14px/1.2 Arial,sans-serif',
      'cursor:pointer',
      'box-shadow:0 8px 24px rgba(0,0,0,.25)'
    ].join(';');

    const modal = document.createElement('div');
    modal.id = '__zms_design_modal';
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,.45)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'z-index:2147483647'
    ].join(';');

    modal.innerHTML = `
      <div style="max-width:540px;width:92%;background:#fff;border-radius:12px;padding:20px 18px;
                  box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:Arial,sans-serif;color:#111;">
        <div style="font-size:15px;line-height:1.45;margin-bottom:16px;">
          На данный момент замечен баг: CRM не открывается/работает корректно при изменённом дизайне.
          Причина пока не выяснена, поэтому временно нужно пользоваться старым дизайном.
        </div>
        <button id="__zms_design_ok" style="padding:10px 16px;border:none;border-radius:8px;background:#2563eb;
                color:#fff;font-weight:600;cursor:pointer;">окей</button>
      </div>
    `;

    btn.addEventListener('click', () => {
      modal.style.display = 'flex';
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });

    document.body.appendChild(btn);
    document.body.appendChild(modal);

    const ok = document.getElementById('__zms_design_ok');
    if (ok) {
      ok.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createInfoUI, { once: true });
  } else {
    createInfoUI();
  }
})();
