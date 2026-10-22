// ==UserScript==
// @name         ZMS CRM — Быстрый ввод данных
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Плавающая панель для быстрого формирования имени и описания записи (услуги, варианты, фильтры, гарантия/коррекция).
// @match        *://*/admin/record/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%91%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9%20%D0%B2%D0%B2%D0%BE%D0%B4%20%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D1%85-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%91%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9%20%D0%B2%D0%B2%D0%BE%D0%B4%20%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D1%85-1.0.user.js
// ==/UserScript==

(function () {
    'use strict';

    function init() {
        const form = document.querySelector('.edit-record-form');
        if (!form) { setTimeout(init, 300); return; }

        const nameInput = form.querySelector('input[name="name"]');
        const commentInput = form.querySelector('textarea[name="comment"]');
        if (!nameInput || !commentInput) return;

        const state = {
            clientName: '',
            carModel: '',
            services: {
                dvs:      { enabled: false, mf: false, vf: false },
                akpp:     { enabled: false, variant: 'полный', filter: false },
                variator: { enabled: false, variant: 'полный', coarse: false, fine: false },
                mkpp:     { enabled: false },
                mosty:    { enabled: false, front: false, rear: false },
                robot:    { enabled: false, filter: false },
                kondey:   { enabled: false },
                razdatka: { enabled: false },
            },
            warranty: false,
            correction: false,
        };

        const order = ['dvs','akpp','variator','mkpp','mosty','robot','kondey','razdatka'];

        function namePart(key) {
            const s = state.services[key];
            if (!s.enabled) return null;
            switch (key) {
                case 'dvs':      return 'двс';
                case 'akpp':     return 'акпп ' + s.variant;
                case 'variator': return 'вариатор ' + s.variant;
                case 'mkpp':     return 'мкпп';
                case 'mosty': {
                    const p = [];
                    if (s.front) p.push('передний мост');
                    if (s.rear)  p.push('задний мост');
                    return p.length ? p.join(' + ') : null;
                }
                case 'robot':    return 'робот';
                case 'kondey':   return 'кондей';
                case 'razdatka': return 'раздатка';
            }
            return null;
        }

        function rebuild() {
            // ---- Имя ----
            const client = state.clientName.trim();
            const svcParts = [];
            order.forEach(k => {
                const p = namePart(k);
                if (p) svcParts.push(p);
            });

            let nameStr;
            if (client && svcParts.length) {
                // После имени плюса нет: "Имя двс + акпп полный"
                nameStr = client + ' ' + svcParts[0];
                if (svcParts.length > 1) nameStr += ' + ' + svcParts.slice(1).join(' + ');
            } else if (client) {
                nameStr = client;
            } else {
                nameStr = svcParts.join(' + ');
            }

            const suffix = [];
            if (state.warranty)   suffix.push('гарантия');
            if (state.correction) suffix.push('коррекция');
            if (suffix.length && svcParts.length) {
                nameStr += ' ' + suffix.join(' ');
            }
            nameInput.value = nameStr;

            // ---- Описание (комментарий) ----
            const desc = [];
            const car = state.carModel.trim();
            if (car) desc.push(car);

            const sv = state.services;

            if (sv.dvs.enabled) {
                if (sv.dvs.mf) desc.push('мф');
                if (sv.dvs.vf) desc.push('вф');
            }
            if (sv.akpp.enabled) {
                desc.push(sv.akpp.filter ? 'фильтр в поддоне акпп' : 'без фильтра в поддоне акпп');
            }
            if (sv.variator.enabled) {
                const vfilters = [];
                if (sv.variator.coarse) vfilters.push('фильтр грубой очистки');
                if (sv.variator.fine)   vfilters.push('фильтр тонкой очистки');
                if (vfilters.length) desc.push(...vfilters);
                else desc.push('без фильтров в поддоне вариатора');
            }
            if (sv.robot.enabled) {
                desc.push(sv.robot.filter ? 'фильтр в поддоне робота' : 'без фильтра в поддоне робота');
            }

            commentInput.value = desc.join(' + ');
        }

        // ---- UI ----
        const panel = document.createElement('div');
        panel.id = 'qf-panel';
        panel.innerHTML = `
<style>
#qf-panel {
    position: fixed;
    top: 80px;
    right: 20px;
    width: 320px;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    background: #fff;
    border: 1px solid #d3d8dd;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.12);
    padding: 14px 16px;
    z-index: 9999;
    font-family: Arial, sans-serif;
    font-size: 13px;
    color: #333;
}
#qf-panel h3 {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 700;
    color: #2a6496;
    text-align: center;
    letter-spacing: .3px;
}
#qf-panel .qf-field { margin-bottom: 10px; }
#qf-panel .qf-field > label {
    display: block;
    font-weight: 700;
    margin-bottom: 4px;
    color: #555;
}
#qf-panel input[type="text"] {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid #ccc;
    border-radius: 5px;
    box-sizing: border-box;
    font-size: 13px;
    outline: none;
}
#qf-panel input[type="text"]:focus { border-color: #2a6496; }
#qf-panel .qf-service {
    border-top: 1px solid #eee;
    padding-top: 8px;
    margin-top: 8px;
}
#qf-panel .qf-main-toggle {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    font-weight: 700;
    color: #444;
}
#qf-panel .qf-main-toggle input { margin-right: 7px; transform: scale(1.1); }
#qf-panel .qf-main-toggle.active { color: #2a6496; }
#qf-panel .qf-sub {
    margin: 6px 0 0 22px;
    display: none;
    padding: 6px 8px;
    background: #f7f9fb;
    border-radius: 5px;
}
#qf-panel .qf-sub.active { display: block; }
#qf-panel .qf-sub label {
    display: inline-flex;
    align-items: center;
    margin: 2px 10px 2px 0;
    font-weight: 400;
    cursor: pointer;
}
#qf-panel .qf-sub label input { margin-right: 4px; }
#qf-panel .qf-sub-row { display: block; margin-top: 4px; }
#qf-panel .qf-mod {
    background: #fff7e6;
    margin-top: 14px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #f0d090;
}
#qf-panel .qf-mod label {
    display: inline-flex;
    align-items: center;
    margin-right: 12px;
    cursor: pointer;
    font-weight: 700;
    color: #8a6d3b;
}
#qf-panel .qf-mod input { margin-right: 5px; }
#qf-panel .qf-reset {
    margin-top: 12px;
    width: 100%;
    padding: 7px;
    background: #f3f3f3;
    border: 1px solid #ccc;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    color: #666;
}
#qf-panel .qf-reset:hover { background: #e8e8e8; }
@media (max-width: 1300px) {
    #qf-panel { width: 280px; }
}
</style>
<h3>⚡ Быстрый ввод данных</h3>
<div class="qf-field">
    <label>Имя клиента</label>
    <input type="text" id="qf-client-name" placeholder="Иван">
</div>
<div class="qf-field">
    <label>Марка / модель машины</label>
    <input type="text" id="qf-car-model" placeholder="Toyota Camry">
</div>

<div class="qf-service" data-key="dvs">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> ДВС</label>
    <div class="qf-sub">
        <span style="color:#888;font-size:12px;">Фильтра:</span>
        <label><input type="checkbox" data-act="mf"> МФ</label>
        <label><input type="checkbox" data-act="vf"> ВФ</label>
    </div>
</div>

<div class="qf-service" data-key="akpp">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> АКПП</label>
    <div class="qf-sub">
        <label><input type="radio" name="qf-akpp-v" data-act="v-полный" checked> полный</label>
        <label><input type="radio" name="qf-akpp-v" data-act="v-частичный"> частичный</label>
        <span class="qf-sub-row">
            <label><input type="checkbox" data-act="filter"> Фильтр в поддоне</label>
        </span>
    </div>
</div>

<div class="qf-service" data-key="variator">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> Вариатор</label>
    <div class="qf-sub">
        <label><input type="radio" name="qf-variator-v" data-act="v-полный" checked> полный</label>
        <label><input type="radio" name="qf-variator-v" data-act="v-частичный"> частичный</label>
        <span class="qf-sub-row">
            <label><input type="checkbox" data-act="coarse"> Грубой очистки</label>
            <label><input type="checkbox" data-act="fine"> Тонкой очистки</label>
        </span>
    </div>
</div>

<div class="qf-service" data-key="mkpp">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> МКПП</label>
</div>

<div class="qf-service" data-key="mosty">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> Мосты</label>
    <div class="qf-sub">
        <label><input type="checkbox" data-act="front"> Передний</label>
        <label><input type="checkbox" data-act="rear"> Задний</label>
    </div>
</div>

<div class="qf-service" data-key="robot">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> Робот</label>
    <div class="qf-sub">
        <label><input type="checkbox" data-act="filter"> Фильтр в поддоне</label>
    </div>
</div>

<div class="qf-service" data-key="kondey">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> Кондей</label>
</div>

<div class="qf-service" data-key="razdatka">
    <label class="qf-main-toggle"><input type="checkbox" data-act="enable"> Раздатка</label>
</div>

<div class="qf-mod">
    <label><input type="checkbox" id="qf-warranty"> Гарантия</label>
    <label><input type="checkbox" id="qf-correction"> Коррекция</label>
</div>

<button type="button" class="qf-reset" id="qf-reset">Сбросить выбор</button>
        `;

        document.body.appendChild(panel);

        const clientNameEl = panel.querySelector('#qf-client-name');
        const carModelEl   = panel.querySelector('#qf-car-model');

        clientNameEl.addEventListener('input', () => { state.clientName = clientNameEl.value; rebuild(); });
        carModelEl.addEventListener('input',   () => { state.carModel   = carModelEl.value;   rebuild(); });

        panel.querySelectorAll('.qf-service').forEach(svc => {
            const key = svc.dataset.key;
            const mainTgl = svc.querySelector('input[data-act="enable"]');
            const mainLbl = svc.querySelector('.qf-main-toggle');
            const sub = svc.querySelector('.qf-sub');

            mainTgl.addEventListener('change', () => {
                state.services[key].enabled = mainTgl.checked;
                if (sub) sub.classList.toggle('active', mainTgl.checked);
                mainLbl.classList.toggle('active', mainTgl.checked);
                rebuild();
            });

            if (sub) {
                sub.querySelectorAll('input').forEach(inp => {
                    inp.addEventListener('change', () => {
                        const act = inp.dataset.act;
                        if (act && act.startsWith('v-')) {
                            if (inp.checked) state.services[key].variant = act.slice(2);
                        } else if (act) {
                            state.services[key][act] = inp.checked;
                        }
                        rebuild();
                    });
                });
            }
        });

        panel.querySelector('#qf-warranty').addEventListener('change', e => {
            state.warranty = e.target.checked; rebuild();
        });
        panel.querySelector('#qf-correction').addEventListener('change', e => {
            state.correction = e.target.checked; rebuild();
        });

        panel.querySelector('#qf-reset').addEventListener('click', () => {
            panel.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
            panel.querySelectorAll('input[type="radio"][data-act="v-полный"]').forEach(r => { r.checked = true; });
            panel.querySelectorAll('.qf-sub').forEach(s => s.classList.remove('active'));
            panel.querySelectorAll('.qf-main-toggle').forEach(l => l.classList.remove('active'));
            clientNameEl.value = '';
            carModelEl.value = '';
            Object.assign(state, {
                clientName: '', carModel: '', warranty: false, correction: false,
                services: {
                    dvs:      { enabled: false, mf: false, vf: false },
                    akpp:     { enabled: false, variant: 'полный', filter: false },
                    variator: { enabled: false, variant: 'полный', coarse: false, fine: false },
                    mkpp:     { enabled: false },
                    mosty:    { enabled: false, front: false, rear: false },
                    robot:    { enabled: false, filter: false },
                    kondey:   { enabled: false },
                    razdatka: { enabled: false },
                },
            });
            rebuild();
        });
    }

    setTimeout(init, 500);
})();
