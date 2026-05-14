// ==UserScript==
// @name         SPOT: Поиск цен по артикулам (умный, с автоопределением типа)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Принимает любое количество артикулов, тип фильтра (вф/мф/сф/тф) определяется автоматически по названию товара
// @match        *://*/analyse/free*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // ─── Стили для модального окна ─────────────────────────────────────────────
    GM_addStyle(`
        #spot-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 100000;
            display: flex; align-items: center; justify-content: center;
        }
        #spot-modal-content {
            background: #fff; border-radius: 10px; padding: 20px;
            max-width: 720px; width: 90%; max-height: 85vh; overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4); color: #333;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #spot-modal h3 { margin: 0 0 15px; color: #2a7a2a; font-size: 18px; }
        .spot-filter-group {
            margin-bottom: 15px; border: 1px solid #e0e0e0;
            border-radius: 6px; padding: 12px; background: #fafafa;
        }
        .spot-filter-group h4 {
            margin: 0 0 10px; color: #005CA9; font-size: 14px;
            display: flex; align-items: center; justify-content: space-between;
            flex-wrap: wrap; gap: 6px;
        }
        .spot-filter-group h4 .spot-sku-tag {
            font-size: 11px; color: #888; font-weight: normal;
            background: #eee; padding: 2px 6px; border-radius: 3px;
        }
        .spot-filter-item {
            display: flex; align-items: center; padding: 8px 10px;
            margin: 4px 0; background: #fff; border-radius: 4px;
            cursor: pointer; transition: background 0.2s;
            border: 1px solid #eee;
        }
        .spot-filter-item:hover { background: #f0f9f0; border-color: #2a7a2a; }
        .spot-filter-item input { margin-right: 10px; cursor: pointer; transform: scale(1.1); }
        .spot-filter-item label { flex: 1; cursor: pointer; font-size: 13px; line-height: 1.4; }
        .spot-filter-price {
            font-weight: bold; color: #2a7a2a; margin-left: 12px;
            white-space: nowrap; font-size: 14px;
        }
        .spot-best-badge {
            background: #2a7a2a; color: white; padding: 2px 8px;
            border-radius: 12px; font-size: 10px; margin-left: 8px;
            font-weight: normal;
        }
        .spot-type-badge {
            display: inline-block; padding: 1px 6px; border-radius: 3px;
            font-size: 10px; margin-left: 6px; font-weight: normal;
            background: #e3f2fd; color: #1565c0;
        }
        #spot-modal-buttons {
            display: flex; gap: 10px; justify-content: flex-end;
            margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;
        }
        #spot-modal-buttons button {
            padding: 10px 24px; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 600; font-size: 14px;
            transition: background 0.2s;
        }
        #spot-copy-btn { background: #2a7a2a; color: white; }
        #spot-copy-btn:hover { background: #1e5a1e; }
        #spot-close-btn { background: #e0e0e0; color: #333; }
        #spot-close-btn:hover { background: #ccc; }
        .spot-select-all {
            font-size: 12px; color: #005CA9; cursor: pointer;
            font-weight: normal; text-decoration: none;
        }
        .spot-select-all:hover { text-decoration: underline; }
        .spot-not-found { color: #999; font-style: italic; padding: 8px 0; }
        .spot-unknown-warn {
            background: #fff3cd; border: 1px solid #ffe69c;
            color: #856404; padding: 8px 10px; border-radius: 4px;
            font-size: 12px; margin-bottom: 10px;
        }
    `);

    // ─── Классификация типа фильтра по названию товара ────────────────────────
    // Возвращает один из ключей TYPES или null если не определилось
    const TYPES = {
        'вф': { label: 'вф', name: 'Воздушный', order: 1 },
        'мф': { label: 'мф', name: 'Масляный',  order: 2 },
        'сф': { label: 'сф', name: 'Салонный',  order: 3 },
        'тф': { label: 'тф', name: 'Топливный', order: 4 }, // на всякий случай
    };

    function detectType(name) {
        const s = name.toLowerCase();
        // Порядок проверок важен: "воздушный фильтр салона" — это салонный, не воздушный
        if (/салон|кондиционер/.test(s) || /фильтр\s+салона/.test(s) || /воздушный\s+фильтр\s+салона/.test(s)) {
            return 'сф';
        }
        if (/масл/.test(s)) return 'мф';
        if (/топлив/.test(s)) return 'тф';
        if (/воздушн/.test(s)) return 'вф';
        return null;
    }

    // ─── Кнопка панели ─────────────────────────────────────────────────────────
    function addButton() {
        if (document.body.contains(document.getElementById('spot-panel'))) return;

        const stationSelect = document.getElementById('field__stations');
        let stationOptions = '<option value="">— все станции —</option>';
        if (stationSelect) {
            Array.from(stationSelect.options).forEach(opt => {
                if (!opt.value) return;
                const selected = opt.selected ? 'selected' : '';
                stationOptions += `<option value="${opt.value}" ${selected}>${opt.text.trim()}</option>`;
            });
        }

        const isCollapsed = sessionStorage.getItem('spot-panel-collapsed') === 'true';

        const panel = document.createElement('div');
        panel.id = 'spot-panel';
        panel.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 99999;
            background: #2a7a2a; color: white; border-radius: 8px;
            padding: 10px; font-size: 13px; font-weight: 500;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3); width: 260px;
            transition: all 0.2s ease;
        `;

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <span>🏪 Станция:</span>
                <button id="spot-toggle-btn" title="Свернуть/развернуть"
                    style="background:none; border:none; color:white; cursor:pointer;
                           font-size:16px; padding:0 4px; line-height:1; margin-left:8px;">
                    ${isCollapsed ? '▼' : '▲'}
                </button>
            </div>
            <div id="spot-content" style="${isCollapsed ? 'display:none;' : ''}">
                <select id="spot-station" style="width:100%; border-radius:4px; border:none;
                    padding:5px; color:#000; font-size:12px; box-sizing:border-box; margin-bottom:8px;">
                    ${stationOptions}
                </select>
                <div style="margin:8px 0 5px; font-size:12px;">📋 Артикулы (любое количество):</div>
                <textarea id="spot-input" placeholder="C 21 014&#10;W 712/95&#10;CU 26 010&#10;...каждый с новой строки"
                    style="width:100%; height:90px; font-size:12px; resize:vertical;
                           border-radius:4px; border:none; padding:5px; color:#000; box-sizing:border-box;"></textarea>
                <button id="spot-search-btn"
                    style="margin-top:8px; width:100%; padding:8px; background:#005CA9;
                           color:white; border:none; border-radius:4px; cursor:pointer;
                           font-size:13px; font-weight:600;">
                    🔍 Найти и выбрать
                </button>
                <div id="spot-status" style="margin-top:6px; font-size:11px; min-height:14px; color:#e8f4e8;"></div>
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('spot-search-btn').addEventListener('click', run);

        const toggleBtn = document.getElementById('spot-toggle-btn');
        const content = document.getElementById('spot-content');

        toggleBtn.addEventListener('click', () => {
            const collapsed = content.style.display === 'none';
            content.style.display = collapsed ? '' : 'none';
            toggleBtn.textContent = collapsed ? '▼' : '▲';
            sessionStorage.setItem('spot-panel-collapsed', !collapsed);
        });

        panel.querySelector('div:first-child').addEventListener('dblclick', () => toggleBtn.click());
    }

    // ─── Модальное окно с выбором фильтров ───────────────────────────────────
    // groups: массив групп { sku, type, items: [{name, price, rawPrice, isBest, type}] }
    function showSelectionModal(groups, unknownItems) {
        const oldModal = document.getElementById('spot-modal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.id = 'spot-modal';

        let groupsHtml = '';

        // Сортируем группы по порядку: вф → мф → сф → тф → неопределённые → пустые
        const sorted = [...groups].sort((a, b) => {
            const oa = a.type ? TYPES[a.type].order : 99;
            const ob = b.type ? TYPES[b.type].order : 99;
            return oa - ob;
        });

        sorted.forEach((group, gIdx) => {
            const { sku, type, items } = group;

            if (!items.length) {
                groupsHtml += `
                    <div class="spot-filter-group">
                        <h4>
                            <span>❌ Не найдено <span class="spot-sku-tag">${escapeHtml(sku)}</span></span>
                        </h4>
                        <div class="spot-not-found">По этому артикулу варианты не нашлись</div>
                    </div>
                `;
                return;
            }

            const groupTypeName = type ? `${TYPES[type].name} (${type.toUpperCase()})` : '⚠️ Тип не определён';

            let itemsHtml = '';
            items.forEach((item, itemIdx) => {
                const checked = item.isBest ? 'checked' : '';
                const bestBadge = item.isBest ? '<span class="spot-best-badge">★ лучшая цена</span>' : '';
                // Показываем тип позиции если он отличается от типа группы (доминирующего)
                const itemTypeBadge = (item.type && item.type !== type)
                    ? `<span class="spot-type-badge">${item.type}</span>`
                    : '';
                itemsHtml += `
                    <div class="spot-filter-item">
                        <input type="checkbox" id="spot-${gIdx}-${itemIdx}" ${checked}
                               data-group="${gIdx}" data-idx="${itemIdx}">
                        <label for="spot-${gIdx}-${itemIdx}">${escapeHtml(item.name)}${itemTypeBadge}</label>
                        <span class="spot-filter-price">${item.price}р${bestBadge}</span>
                    </div>
                `;
            });

            groupsHtml += `
                <div class="spot-filter-group">
                    <h4>
                        <span>${groupTypeName} <span class="spot-sku-tag">${escapeHtml(sku)}</span> — вариантов: ${items.length}</span>
                        <span class="spot-select-all" data-group="${gIdx}">✓ выбрать все</span>
                    </h4>
                    ${itemsHtml}
                </div>
            `;
        });

        const unknownWarn = unknownItems.length
            ? `<div class="spot-unknown-warn">⚠️ Для ${unknownItems.length} артикул(ов) тип фильтра не удалось определить из названия — отмечены меткой «Тип не определён». Они тоже доступны для копирования, но без префикса вф/мф/сф.</div>`
            : '';

        modal.innerHTML = `
            <div id="spot-modal-content">
                <h3>🎯 Выберите фильтры для копирования</h3>
                ${unknownWarn}
                ${groupsHtml}
                <div id="spot-modal-buttons">
                    <button id="spot-close-btn">✕ Закрыть</button>
                    <button id="spot-copy-btn">📋 Копировать выбранное</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('spot-close-btn').addEventListener('click', () => modal.remove());

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        modal.querySelectorAll('.spot-select-all').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const gIdx = btn.dataset.group;
                modal.querySelectorAll(`input[type="checkbox"][data-group="${gIdx}"]`)
                    .forEach(cb => cb.checked = true);
            });
        });

        document.getElementById('spot-copy-btn').addEventListener('click', () => {
            const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
            const results = [];

            checkboxes.forEach(cb => {
                const gIdx = parseInt(cb.dataset.group);
                const idx  = parseInt(cb.dataset.idx);
                const group = sorted[gIdx];
                const item  = group?.items?.[idx];
                if (!item) return;
                // Префикс берём из ТИПА КОНКРЕТНОЙ ПОЗИЦИИ, а не группы — это надёжнее.
                // Если позиция без типа — fallback на тип группы.
                const label = item.type || group.type || '';
                const prefix = label ? label + ' ' : '';
                results.push(`${prefix}${item.name} - ${item.price}р`);
            });

            if (results.length === 0) {
                alert('⚠️ Выберите хотя бы один фильтр для копирования!');
                return;
            }

            const copyText = results.join('\n');
            GM_setClipboard(copyText);

            const status = document.getElementById('spot-status');
            if (status) {
                status.textContent = '✅ Скопировано в буфер!';
                setTimeout(() => { if(status) status.textContent = ''; }, 3000);
            }

            modal.remove();
            console.log('[SPOT] Скопировано:\n' + copyText);
        });
    }

    // ─── Основная функция поиска ─────────────────────────────────────────────
    async function run() {
        const input = document.getElementById('spot-input').value.trim();
        const status = document.getElementById('spot-status');
        const btn = document.getElementById('spot-search-btn');

        const skus = input.split('\n').map(l => l.trim()).filter(Boolean);
        if (skus.length === 0) {
            status.textContent = '⚠️ Вставьте хотя бы один артикул';
            return;
        }

        btn.disabled = true;

        const groups = [];
        const unknownItems = [];

        for (let i = 0; i < skus.length; i++) {
            const sku = skus[i];
            status.textContent = `⏳ Поиск ${i + 1}/${skus.length}: ${sku}...`;

            let items = [];
            try {
                items = await searchSkuAll(sku);
            } catch (e) {
                console.error(`[SPOT] Ошибка по "${sku}":`, e);
                items = [];
            }

            // Тип уже определён в searchSkuAll по полному названию (с "Воздушный фильтр", "Масляный" и т.п.).
            // Здесь только собираем неопознанные для предупреждения.
            items.forEach(it => {
                if (!it.type) unknownItems.push(it);
            });

            // Помечаем самую дешёвую
            if (items.length) {
                const minPrice = Math.min(...items.map(it => it.rawPrice));
                items.forEach(it => { it.isBest = (it.rawPrice === minPrice); });
            }

            // Доминирующий тип группы — тот, который встречается чаще всего среди найденных позиций
            const groupType = dominantType(items);

            groups.push({ sku, type: groupType, items });

            if (i < skus.length - 1) await sleep(400);
        }

        const totalFound = groups.reduce((s, g) => s + g.items.length, 0);
        showSelectionModal(groups, unknownItems);
        status.textContent = totalFound
            ? `✅ Найдено позиций: ${totalFound}. Выберите в окне 👇`
            : '⚠️ По всем артикулам ничего не найдено';
        btn.disabled = false;
    }

    // ─── Доминирующий тип в группе результатов ───────────────────────────────
    function dominantType(items) {
        const counts = {};
        items.forEach(it => {
            if (it.type) counts[it.type] = (counts[it.type] || 0) + 1;
        });
        let best = null, max = 0;
        for (const t in counts) {
            if (counts[t] > max) { max = counts[t]; best = t; }
        }
        return best;
    }

    // ─── Поиск ВСЕХ вариантов артикула ───────────────────────────────────────
    async function searchSkuAll(sku) {
        const stationId = document.getElementById('spot-station')?.value || '';
        const stationParam = stationId ? `stations[]=${stationId}&` : '';

        const url = `/analyse/free?${stationParam}stationsColumns=&withCatalogItems=${encodeURIComponent(sku)}&selectionPeriod=&orderByField=price&orderByOrder=ASC`;

        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) return [];

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const rows = doc.querySelectorAll('tbody tr.table__row');
        if (!rows.length) return [];

        const results = [];

        for (const row of rows) {
            const nameCell  = row.querySelector('td[data-name="name"]');
            const priceCell = row.querySelector('td[data-name="price"]');
            if (!nameCell || !priceCell) continue;

            const nameText = nameCell.textContent.trim();
            if (!nameText) continue;

            const priceRaw = parseRawPrice(priceCell.textContent);
            if (priceRaw <= 0) continue;

            results.push({
                rawName: nameText,                  // полное название для определения типа
                name: extractName(nameText),        // очищенное название для отображения
                price: roundPrice(priceCell.textContent),
                rawPrice: priceRaw
            });
        }

        // Тип определяем по ИСХОДНОМУ названию (в нём есть слова "Воздушный фильтр", "Масляный", "Салонный").
        // extractName ниже выкусывает эти слова из отображаемого имени, поэтому detectType надо вызывать ДО.
        results.forEach(r => {
            r.type = detectType(r.rawName);
            delete r.rawName;
        });

        results.sort((a, b) => a.rawPrice - b.rawPrice);
        return results.slice(0, 10);
    }

    // ─── Вспомогательные функции ─────────────────────────────────────────────
    function parseRawPrice(text) {
        const cleaned = text.replace(/\s/g, '').replace(',', '.');
        const match = cleaned.match(/(\d+)\.(\d+)/);
        if (!match) return parseInt(text.replace(/\D/g, '')) || 0;
        return parseFloat(match[1] + '.' + match[2]);
    }

    function roundPrice(text) {
        const cleaned = text.replace(/\s/g, '').replace(',', '.');
        const match = cleaned.match(/(\d+)\.(\d+)/);
        if (!match) return parseInt(text.replace(/\D/g, '')) || 0;
        const rubles = parseInt(match[1]);
        const kopecks = parseInt(match[2]);
        return kopecks >= 50 ? rubles + 1 : rubles;
    }

    function extractName(raw) {
        let s = raw.replace(/^[A-Z0-9]+\s+/i, '').trim();

        const filterTypes = [
            'Воздушный фильтр салона', 'Фильтр салона', 'Салонный фильтр',
            'Воздушный фильтр', 'Масляный фильтр', 'Топливный фильтр',
        ];
        for (const ft of filterTypes) {
            if (s.toLowerCase().startsWith(ft.toLowerCase())) {
                s = s.slice(ft.length).trim();
                break;
            }
        }
        s = s.replace(/\s*\(\d+\)\s*$/, '').trim();
        return s || raw;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ─── Инициализация ───────────────────────────────────────────────────────
    function init() {
        addButton();
        const observer = new MutationObserver(() => {
            if (!document.getElementById('spot-search-btn')) {
                addButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();