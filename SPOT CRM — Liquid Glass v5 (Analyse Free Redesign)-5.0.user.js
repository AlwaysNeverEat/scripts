// ==UserScript==
// @name         SPOT CRM — Liquid Glass v5 (Analyse Free Redesign)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Временная заглушка: редизайн отключён, добавлена только информационная плашка
// @match        *://*/analyse/free*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20CRM%20%E2%80%94%20Liquid%20Glass%20v5%20(Analyse%20Free%20Redesign)-5.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20CRM%20%E2%80%94%20Liquid%20Glass%20v5%20(Analyse%20Free%20Redesign)-5.0.user.js
// ==/UserScript==

/*
  Оригинальная логика Liquid Glass (редизайн CRM) временно отключена.
  Скрипт ничего не меняет в CRM, кроме отображения информационной плашки.
*/

(function () {
  'use strict';

  function initNotice() {
    if (document.getElementById('__spot_design_btn')) return;

    const button = document.createElement('button');
    button.id = '__spot_design_btn';
    button.textContent = 'а где дизайн';
    button.style.cssText = [
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
    modal.id = '__spot_design_modal';
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,.45)',
      'z-index:2147483647'
    ].join(';');

    modal.innerHTML = `
      <div style="max-width:560px;width:92%;background:#fff;border-radius:12px;padding:20px 18px;
                  box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:Arial,sans-serif;color:#111;">
        <div style="font-size:15px;line-height:1.45;margin-bottom:16px;">
          На данный момент замечен баг с тем, что CRM работает некорректно при изменённом дизайне.
          Причина пока неизвестна, поэтому временно придётся пользоваться старым дизайном.
        </div>
        <button id="__spot_design_ok" style="padding:10px 16px;border:none;border-radius:8px;background:#2563eb;
                color:#fff;font-weight:600;cursor:pointer;">окей</button>
      </div>
    `;

    button.addEventListener('click', () => {
      modal.style.display = 'flex';
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    });

    document.body.appendChild(button);
    document.body.appendChild(modal);

    const okButton = document.getElementById('__spot_design_ok');
    if (okButton) {
      okButton.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotice, { once: true });
  } else {
    initNotice();
  }
})();
