// ==UserScript==
// @name         ZMS CRM — Продлить запись + Умное удаление
// @namespace    zamena-masla-spot.ru
// @version      1.0
// @description  Кнопка «Продлить» в окне редактирования записи + подтверждение удаления похожих (длинных) записей
// @match        https://zamena-masla-spot.ru/admin/record*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%9F%D1%80%D0%BE%D0%B4%D0%BB%D0%B8%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20%2B%20%D0%A3%D0%BC%D0%BD%D0%BE%D0%B5%20%D1%83%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-1.0.user(1).js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%9F%D1%80%D0%BE%D0%B4%D0%BB%D0%B8%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20%2B%20%D0%A3%D0%BC%D0%BD%D0%BE%D0%B5%20%D1%83%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-1.0.user(1).js
// ==/UserScript==

/**

- КАК УСТАНОВИТЬ:
- 1. Установите расширение Tampermonkey в браузер
- 1. Нажмите «Создать новый скрипт»
- 1. Вставьте весь этот код, сохраните (Ctrl+S)
- 1. Перезагрузите CRM
-
- ВАЖНО: Если при продлении появляется ошибка создания слотов —
- замените ‘/admin/record/update’ на ‘/admin/record/create’
- в функции createExtensionSlot() ниже.
  */

(function () {
'use strict';


// ─────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────

/** Прибавляет минуты к строке времени "HH:MM" */
function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + mins;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

/** Форматирует количество 30-минутных слотов в читаемую строку */
function formatDuration(numSlots) {
    const mins = numSlots * 30;
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return `${h} ч ${m} мин`;
    if (h) return `${h} ч`;
    return `${m} мин`;
}

/** Создаёт тёмный оверлей и вставляет HTML внутрь */
function createOverlay(innerHtml) {
    const el = document.createElement('div');
    el.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:rgba(0,0,0,.58)', 'z-index:9999999',
        'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');
    el.innerHTML = innerHtml;
    document.body.appendChild(el);
    return el;
}

/** Оверлей-загрузчик */
function showLoader(msg) {
    return createOverlay(
        `<div style="color:#fff;font-size:18px;font-family:Arial,sans-serif;
                     text-shadow:0 1px 4px rgba(0,0,0,.5);">${msg}</div>`
    );
}

// ─────────────────────────────────────────
// РОУТИНГ
// ─────────────────────────────────────────

const path = window.location.pathname;

if (path.startsWith('/admin/record/edit')) {
    initExtendButton();
}

if (path.startsWith('/admin/record/create')) {
    initExtendButton();
}

if (path === '/admin/record' || path === '/admin/record/') {
    initSmartDelete();
}


// ═════════════════════════════════════════════════════════════════
// БЛОК 1 — КНОПКА «ПРОДЛИТЬ» (страница редактирования записи)
// ═════════════════════════════════════════════════════════════════

function initExtendButton() {
    const form = document.querySelector('.edit-record-form');
    if (!form) return;

    const saveBtn = form.querySelector('button[type="submit"]');
    if (!saveBtn) return;

    // Создаём кнопку
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '⏱ Продлить';
    btn.style.cssText = [
        'margin-left:10px', 'padding:6px 16px',
        'background:#e67e00', 'color:#fff',
        'border:none', 'border-radius:4px',
        'font-size:14px', 'font-weight:bold', 'cursor:pointer'
    ].join(';');
    btn.addEventListener('mouseover', () => btn.style.background = '#c96e00');
    btn.addEventListener('mouseout',  () => btn.style.background = '#e67e00');

    saveBtn.insertAdjacentElement('afterend', btn);

    btn.addEventListener('click', async () => {
        // Читаем данные формы
        const addressId = form.querySelector('[name="address_id"]')?.value;
        const date      = form.querySelector('[name="date"]')?.value;
        const timeEl    = form.querySelector('[name="time"]');
        const nameEl    = form.querySelector('[name="name"]');
        const backEl    = form.querySelector('[name="back"]');

        // Базовые проверки
        if (!timeEl?.value) {
            alert('⏳ Подождите — расписание ещё загружается. Попробуйте снова через секунду.');
            return;
        }
        if (!nameEl?.value?.trim()) {alert('⚠️ Сначала заполните имя клиента.');
            return;
        }

        const curTime = timeEl.value;
        const endTime = addMinutes(curTime, 30); // конец текущего слота

        // Запрашиваем расписание у API
        const spin = showLoader('⏳ Проверяем доступное время...');

        let apiSlots;
        try {
            const apiDay = date.replace(/(\d+)\.(\d+)\.(\d+)/, '$3-$2-$1') + 'T00:00:00';
            const resp = await fetch(
                `/jsApi/serviceTimes?addressId=${addressId}&day=${apiDay}&duration=30&format=full&source=admin`,
                { method: 'POST' }
            );
            apiSlots = await resp.json();
        } catch (err) {
            spin.remove();
            alert('❌ Ошибка при обращении к API расписания:\n' + err.message);
            return;
        }
        spin.remove();

        // ──────────────────────────────────────────────────────
        // Ищем последовательные СВОБОДНЫЕ слоты начиная с endTime
        //
        // API возвращает isAvailable: false для СВОБОДНЫХ слотов.
        // (isAvailable: true = занят, что и используется в оригинальном коде CRM)
        // ──────────────────────────────────────────────────────
        const freeSlots = [];
        let reachedEnd = false;

        for (const s of apiSlots) {
            if (s.time === endTime) reachedEnd = true;
            if (!reachedEnd) continue;

            if (s.isAvailable === false) {
                // Слот свободен — можно продлить сюда
                freeSlots.push(s.time);
            } else {
                // Слот занят — дальше смотреть не нужно (продление должно быть непрерывным)
                break;
            }

            if (s.time === '20:00') break; // последний слот, заканчивающийся в 20:30
        }

        if (freeSlots.length === 0) {
            alert(`❌ Продление невозможно.\n\nСлот ${endTime} уже занят или достигнут конец рабочего дня (20:30).`);
            return;
        }

        // Показываем модальное окно выбора продления
        showExtendModal({
            freeSlots,
            curTime,
            endTime,
            form,
            addressId,
            date,
            name: nameEl.value.trim(),
            backUrl: backEl?.value || '/admin/record'
        });
    });
}

function showExtendModal({ freeSlots, curTime, endTime, form, addressId, date, name, backUrl }) {
    const options = freeSlots.map((slotStart, i) => {
        const n      = i + 1;
        const tillEnd = addMinutes(slotStart, 30);
        return `<option value="${n}">+${formatDuration(n)} &nbsp;→&nbsp; запись до ${tillEnd}</option>`;
    }).join('');

    const el = createOverlay(`
        <div style="
            background:#fff; border-radius:10px; padding:28px;
            max-width:430px; width:90%; font-family:Arial,sans-serif;
            box-shadow:0 8px 32px rgba(0,0,0,.35);
        ">
            <h3 style="margin:0 0 10px;color:#333;font-size:17px;">⏱ Продление записи</h3>

            <p style="margin:0 0 4px;color:#555;font-size:14px;">
                Текущий слот: <b>${curTime} – ${endTime}</b>
            </p>
            <p style="margin:0 0 18px;color:#555;font-size:14px;">
                Клиент: <b>${name}</b>
            </p>

            <label style="display:block;margin-bottom:6px;font-weight:bold;color:#444;font-size:14px;">
                На сколько продлить:
            </label>
            <select id="__zms_ext_sel" style="
                width:100%; padding:9px; font-size:15px;
                border:2px solid #ddd; border-radius:6px; margin-bottom:18px; outline:none;
            ">
                ${options}
            </select>

            <div style="
                background:#fff8e1; border:1px solid #ffc107; border-radius:7px;
                padding:11px 14px; margin-bottom:20px; font-size:13px; color:#7a5c00;
                line-height:1.5;
            ">
                ⚠️ Дополнительные слоты будут созданы с номером
                <b>+7 111 111 11 11</b>.<br>Имя сохраняется, описание остаётся пустым.<br>
                <b>SMS клиенту не отправится.</b>
            </div>

            <div style="display:flex;gap:10px;">
                <button id="__zms_ext_ok" style="
                    flex:1; padding:12px; background:#e67e00; color:#fff;
                    border:none; border-radius:6px; font-size:15px;
                    font-weight:bold; cursor:pointer;
                ">✓ Продлить и сохранить</button>
                <button id="__zms_ext_no" style="
                    flex:1; padding:12px; background:#eee; color:#555;
                    border:none; border-radius:6px; font-size:15px; cursor:pointer;
                ">Отмена</button>
            </div>
        </div>
    `);

    el.querySelector('#__zms_ext_no').addEventListener('click', () => el.remove());

    el.querySelector('#__zms_ext_ok').addEventListener('click', async () => {
        const count       = parseInt(el.querySelector('#__zms_ext_sel').value);
        const slotsToAdd  = freeSlots.slice(0, count);
        el.remove();

        const spin = showLoader('💾 Сохраняем основную запись и создаём продления...');

        try {
            // 1) Сохраняем текущую запись (основной слот)
            await fetch('/admin/record/update', {
                method: 'POST',
                body: new FormData(form)
            });

            // 2) Создаём дополнительные слоты
            for (const slotTime of slotsToAdd) {
                await createExtensionSlot({ addressId, date, slotTime, name, backUrl });
            }

            spin.remove();
            window.location.href = backUrl; // возврат в расписание
        } catch (err) {
            spin.remove();
            alert('❌ Ошибка при сохранении:\n' + err.message +
                  '\n\nПроверьте расписание — часть слотов могла создаться.');
        }
    });
}

/**
 * Создаёт один дополнительный слот (продление).
 * Имя — то же, телефон — заглушка, комментарий — пустой.
 *
 * Если сервер не принимает пустой id через /update,
 * замените URL на '/admin/record/create'.
 */
async function createExtensionSlot({ addressId, date, slotTime, name, backUrl }) {
    const fd = new FormData();
    fd.append('id',          '');               // пустой id = новая запись
    fd.append('address_id',  addressId);
    fd.append('date',        date);
    fd.append('time',        slotTime);
    fd.append('name',        name);
    fd.append('phone',       '+71111111111');   // заглушка — SMS не отправится
    fd.append('car_number',  '');
    fd.append('comment',     '');               // описание пустое
    fd.append('back',        backUrl);

    const resp = await fetch('/admin/record/update', { method: 'POST', body: fd });
    if (!resp.ok) {
        throw new Error(`Сервер вернул ${resp.status} для слота ${slotTime}`);
    }
}


// ═════════════════════════════════════════════════════════════════
// БЛОК 2 — УМНОЕ УДАЛЕНИЕ (страница общей таблицы записей)
// ═════════════════════════════════════════════════════════════════

function initSmartDelete() {
    // Собираем все видимые записи со страницы
    // Структура: { name, startTime, endTime, addressId, href }
    const allRecords = [];

    document.querySelectorAll('.r-stat-head').forEach(div => {
        const delLink = div.querySelector('a[href*="/admin/record/delete"]');
        if (!delLink) return;

        // address_id из ссылки удаления (?address_id=N)
        const addrMatch = delLink.href.match(/address_id=(\d+)/);
        const addressId = addrMatch ? addrMatch[1] : null;

        // Время из текста блока: "09:00-09:30" или "09:00–09:30"
        const timeMatch = div.textContent.match(/(\d{2}:\d{2})[-–](\d{2}:\d{2})/);
        const startTime = timeMatch ? timeMatch[1] : null; // "09:00"
        const endTime   = timeMatch ? timeMatch[2] : null; // "09:30"

        // Имя: текст после "удалить" до " / +7" (или до " /")
        const rawText   = div.textContent.replace(/\s+/g, ' ').trim();
        const nameMatch = rawText.match(/удалить\s+(.+?)\s*\/\s*(?:\+7|$)/);const name = nameMatch ? nameMatch[1].trim() : '';

        if (name && addressId && startTime && delLink.href) {
            allRecords.push({ name, startTime, endTime, addressId, href: delLink.href });
        }
    });

    // Перехватываем все ссылки удаления
    document.querySelectorAll('a[href*="/admin/record/delete"]').forEach(link => {
        link.removeAttribute('onclick');

        link.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();

            const thisHref = link.href;
            const thisRec  = allRecords.find(r => r.href === thisHref);
            const name     = thisRec?.name    || '—';
            const timeStr  = thisRec ? `${thisRec.startTime}–${thisRec.endTime}` : '';

            // ──────────────────────────────────────────────────────
            // Ищем продления: та же станция, то же имя,
            // слоты идут СТРОГО ПОДРЯД после удаляемого (без пробелов).
            // Если в цепочке есть разрыв — дальше не смотрим.
            // ──────────────────────────────────────────────────────
            const similar = [];

            if (thisRec) {
                // Кандидаты: та же станция, то же имя, другая запись
                const candidates = allRecords.filter(r =>
                    r.href      !== thisHref &&
                    r.addressId === thisRec.addressId &&
                    r.name      === thisRec.name
                );

                // Строим цепочку последовательных слотов после thisRec
                let expectedStart = thisRec.endTime; // конец текущего = начало следующего
                while (true) {
                    const next = candidates.find(r => r.startTime === expectedStart);
                    if (!next) break; // пробел во времени — цепочка закончилась
                    similar.push(next);
                    expectedStart = next.endTime;
                }
            }

            showDeleteModal({ name, timeStr, thisHref, similar });
        });
    });
}

function showDeleteModal({ name, timeStr, thisHref, similar }) {
    // Блок с похожими записями (если есть)
    const simItems = similar.map((r, i) => `
        <label style="
            display:flex; align-items:center; gap:10px;
            padding:9px 10px; background:#fff;
            border:1px solid #ffe0b2; border-radius:6px;
            margin-bottom:5px; cursor:pointer;
        ">
            <input
                type="checkbox"
                class="__zms_sim_cb"
                data-href="${r.href}"
                checked
                style="width:16px;height:16px;accent-color:#dc3545;cursor:pointer;flex-shrink:0;"
            >
            <span style="font-size:14px;color:#333;">
                <b>${r.name}</b>
                ${r.startTime ? `<span style="color:#888;"> — ${r.startTime}–${r.endTime}</span>` : ''}
            </span>
        </label>
    `).join('');

    const simBlock = similar.length ? `
        <div style="
            background:#fff3e0; border:1px solid #ff9800;
            border-radius:8px; padding:14px; margin-bottom:20px;
        ">
            <p style="margin:0 0 6px;font-weight:bold;color:#e65100;font-size:14px;">
                ⚠️ Найдены похожие записи с тем же именем (${similar.length} шт.)
            </p>
            <p style="margin:0 0 12px;color:#777;font-size:13px;">
                Это может быть одна длинная запись. Выберите, что ещё удалить:
            </p>
            ${simItems}
        </div>
    ` : '';

    const el = createOverlay(`
        <div style="
            background:#fff; border-radius:10px; padding:28px;
            max-width:470px; width:90%; font-family:Arial,sans-serif;
            box-shadow:0 8px 32px rgba(0,0,0,.35);
            max-height:85vh; overflow-y:auto;
        ">
            <h3 style="margin:0 0 12px;color:#dc3545;font-size:17px;">🗑️ Удаление записи</h3>
            <p style="margin:0 0 20px;color:#444;font-size:15px;">
                Удалить: <b>${name}</b>${timeStr ? `<span style="color:#888;font-size:14px;"> (${timeStr})</span>` : ''}
            </p>

            ${simBlock}

            <div style="display:flex;gap:10px;">
                <button id="__zms_del_ok" style="
                    flex:1; padding:12px; background:#dc3545; color:#fff;
                    border:none; border-radius:6px; font-size:15px;
                    font-weight:bold; cursor:pointer;
                ">🗑️ Удалить</button>
                <button id="__zms_del_no" style="
                    flex:1; padding:12px; background:#eee; color:#555;
                    border:none; border-radius:6px; font-size:15px; cursor:pointer;
                ">Отмена</button>
            </div>
        </div>
    `);

    el.querySelector('#__zms_del_no').addEventListener('click', () => el.remove());

    el.querySelector('#__zms_del_ok').addEventListener('click', async () => {
        // Собираем href'ы ПЕРЕД закрытием оверлея
        const toDelete = [thisHref];
        el.querySelectorAll('.__zms_sim_cb').forEach(cb => {
            if (cb.checked) toDelete.push(cb.dataset.href);
        });

        el.remove();

        const spin = showLoader(`🗑️ Удаляем ${toDelete.length} ${toDelete.length === 1 ? 'запись' : 'записи'}...`);

        try {
            for (const href of toDelete) {
                await fetch(href); // GET-запрос на delete-ссылку
            }
            spin.remove();
            window.location.reload();
        } catch (err) {
            spin.remove();
            alert('❌ Ошибка при удалении:\n' + err.message);
            window.location.reload();
        }
    });
}


})();