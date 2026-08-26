import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatPhoneInput, phoneDigits, phoneComplete,
    formatPlateInput, plateComplete, plateFull, searchValueFull,
    clientSearchPath, parseClientSearch, parseClientCard, parseSale, crmStampValue,
    maskedFieldEdit,
} from './crmClients.js';

// Разметка в фикстурах снята с реальных страниц CRM (обрезана до нужных мест).

test('маска телефона собирается по мере ввода и съедает 7/8 в начале', () => {
    assert.equal(formatPhoneInput(''), '');
    assert.equal(formatPhoneInput('9'), '+7 (9');
    assert.equal(formatPhoneInput('981'), '+7 (981)');
    assert.equal(formatPhoneInput('9819651'), '+7 (981) 965-1');
    assert.equal(formatPhoneInput('9819651916'), '+7 (981) 965-19-16');
    assert.equal(formatPhoneInput('89819651916'), '+7 (981) 965-19-16');
    assert.equal(formatPhoneInput('+7 (981) 965-19-16'), '+7 (981) 965-19-16');
    // Лишние цифры не сдвигают номер, а просто не влезают.
    assert.equal(formatPhoneInput('898196519160000'), '+7 (981) 965-19-16');
});

test('телефон считается введённым только на десяти цифрах', () => {
    assert.equal(phoneDigits('+7 (981) 965-19-16'), '9819651916');
    assert.equal(phoneComplete('+7 (981) 965-19-1'), false);
    assert.equal(phoneComplete('+7 (981) 965-19-16'), true);
});

test('маска гос. номера позиционная, латиница превращается в кириллицу', () => {
    assert.equal(formatPlateInput('к926аа147'), 'К926АА147');
    assert.equal(formatPlateInput('k926aa147'), 'К926АА147');   // набрано в другой раскладке
    assert.equal(formatPlateInput('К 926 АА 147'), 'К926АА147');
    // Буква на месте цифры (и наоборот) не вводится — номер не съезжает.
    assert.equal(formatPlateInput('К9К26'), 'К926');
    // Ж и прочие не-ГОСТовские буквы на знаке не бывают — не вводятся вовсе.
    assert.equal(formatPlateInput('Ж'), '');
    assert.equal(formatPlateInput('ЖК926АА147'), 'К926АА147');
    assert.equal(formatPlateInput('К926АА1478'), 'К926АА147');
});

test('гос. номер полон и с двузначным, и с трёхзначным регионом', () => {
    assert.equal(plateComplete('К926АА14'), true);
    assert.equal(plateComplete('К926АА147'), true);
    assert.equal(plateComplete('К926АА'), false);
    assert.equal(plateComplete('К926А147'), false);
});

test('«номер валиден» и «номер добран» у гос. номера — РАЗНЫЕ вопросы', () => {
    // Регион бывает и двузначным, и трёхзначным, поэтому на восьми символах
    // номер уже валиден, но человек, скорее всего, ещё печатает третью цифру.
    // Тот, кто решает «пора идти в CRM», обязан их различать — иначе поиск
    // уходит за несуществующим номером ровно в момент набора.
    assert.equal(plateComplete('К926АА14'), true);
    assert.equal(plateFull('К926АА14'), false);

    assert.equal(plateComplete('К926АА147'), true);
    assert.equal(plateFull('К926АА147'), true);

    assert.equal(plateFull('К926АА'), false);

    // У телефона длина одна, поэтому «набран» и «добран» — это одно и то же.
    assert.equal(searchValueFull('phone', '+7 (981) 965-19-1'), false);
    assert.equal(searchValueFull('phone', '+7 (981) 965-19-16'), true);
    assert.equal(searchValueFull('plate', 'К926АА14'), false);
    assert.equal(searchValueFull('plate', 'К926АА147'), true);
});

test('адрес поиска повторяет форму CRM: телефон в маске, номер нормализован', () => {
    const path = clientSearchPath({ phone: '89819651916', date: '26.08.2026' });
    assert.match(path, /^\/dial_clients\/\?/);
    const q = new URLSearchParams(path.split('?')[1]);
    assert.equal(q.get('phone'), '+7 (981) 965-19-16');
    assert.equal(q.get('vehicleNumber'), '');
    assert.equal(q.get('date'), '26.08.2026');

    const byPlate = new URLSearchParams(clientSearchPath({ plate: 'k926aa147' }).split('?')[1]);
    assert.equal(byPlate.get('vehicleNumber'), 'К926АА147');
    assert.equal(byPlate.get('phone'), '');
});

const SEARCH_FOUND = `
    <h3>Найденные клиенты</h3>
    <div class="found-clients-list">
        <div>
            <a href="http://crm.zamena-masla-spot.ru/clients/151465">
                Георгий				</a>
        </div>
        <div>
            <a href="http://crm.zamena-masla-spot.ru/clients/151466">Пётр</a>
        </div>
    </div>
    <script>$("#search-client-by-phone").mask("+7 (000) 000-00-00");</script>`;

const SEARCH_EMPTY = `
    <h3>Ничего не найдено</h3>
    <div class="found-clients-list">
        	</div>
    <script>$("#search-client-by-phone").mask("+7 (000) 000-00-00");</script>`;

test('список найденных клиентов разбирается, пустой — это не ошибка', () => {
    const found = parseClientSearch(SEARCH_FOUND);
    assert.deepEqual(found.clients, [
        { id: '151465', name: 'Георгий' },
        { id: '151466', name: 'Пётр' },
    ]);
    assert.equal(found.searched, true);

    const empty = parseClientSearch(SEARCH_EMPTY);
    assert.deepEqual(empty.clients, []);
    assert.equal(empty.searched, true);

    // Страница логина CRM списка не содержит вовсе — это другое состояние.
    assert.equal(parseClientSearch('<form><input type="password"></form>').searched, false);
});

const CLIENT = `
<h3>Поиск</h3>
<div>
    <a class="field__link" href="/edit?type=clients&amp;id=151465">Редактировать</a>
    <p>
        Имя:
        Георгий					</p>
    <p>
        Телефон:
        79819651916					</p>
    <p>
        Бонусный счет:
        334.<small>50</small>					</p>
    <p>
        День рождения:
        01.12.-0001					</p>
    <div>
        <div>
            <span class="vehicle-numbers-header">Номера</span>
            <a class="field__link" href="/edit?type=vehicle_numbers">Добавить</a>
        </div>
        <div>
            К926АА147							</div>
        <div>
            К926АА14							</div>
    </div>
</div>
<h1>Продажи клиента Георгий</h1>
<table id="clients" class="table sortableTable ">
    <tbody><tr class="table__row " data-id="3606371">
        <td class="table__cell" data-name="TABLE_INDEX">5</td>
        <td class="table__cell  id" data-name="id">3606371</td>
        <td class="table__cell link name" data-name="name" data-key="name">
            <a href="http://crm.zamena-masla-spot.ru/sale/3606371" class="field__link">Продажа №3606371</a>
        </td>
        <td class="table__cell  seller" data-name="seller">Забродин Николай Николаевич</td>
        <td class="table__cell  station_name" data-name="station_name">Руставели 69</td>
        <td class="table__cell  count" data-name="count">11</td>
        <td class="table__cell  paid_bonus double" data-name="paid_bonus">0.<small>00</small></td>
        <td class="table__cell  sum double" data-name="sum">2&nbsp;416.<small>00</small></td>
        <td class="table__cell  received_bonus double" data-name="received_bonus">96.<small>00</small></td>
        <td class="table__cell  mileage" data-name="mileage">0</td>
        <td class="table__cell  vehicle_number" data-name="vehicle_number">К926АА147</td>
        <td class="table__cell  date_create" data-name="date_create">28.07.2026 19:34:32</td>
        <td class="table__cell  closed_at" data-name="closed_at">28.07.2026 19:35:32</td>
        <td class="table__cell  call_center_comment" data-name="call_center_comment">только покупка</td>
    </tr></tbody>
</table>`;

test('карточка клиента: панель слева и таблица обслуживаний', () => {
    const c = parseClientCard(CLIENT, 151465);
    assert.equal(c.id, '151465');
    assert.equal(c.name, 'Георгий');
    assert.equal(c.phone, '79819651916');
    assert.equal(c.bonus, 334.5);
    // 01.12.-0001 — это «дату не заполняли», а не день рождения.
    assert.equal(c.birthday, null);
    assert.deepEqual(c.plates, ['К926АА147', 'К926АА14']);

    assert.equal(c.sales.length, 1);
    assert.deepEqual(c.sales[0], {
        id: '3606371',
        seller: 'Забродин Николай Николаевич',
        station: 'Руставели 69',
        count: 11,
        paidBonus: 0,
        sum: 2416,
        receivedBonus: 96,
        mileage: 0,
        plate: 'К926АА147',
        createdAt: '28.07.2026 19:34:32',
        closedAt: '28.07.2026 19:35:32',
        comment: 'только покупка',
    });
});

test('клиента без имени и без номеров карточка переживает', () => {
    const c = parseClientCard('<p>Телефон: 79990001122</p>', 7);
    assert.equal(c.name, 'Без имени');
    assert.deepEqual(c.plates, []);
    assert.deepEqual(c.sales, []);
    assert.equal(c.bonus, null);
});

const SALE = `
<p>Номер товарного чека: 3606371</p>
<p class="paid-line-sale">Оплачено: 2416.00
    <span class="payment-icon"><img class="image_icon" src="/img/cashless_e0c9.png" alt="cashless.png"></span>
</p>
<h1>Продажа №3606371 от 28.07.2026 19:35 Руставели 69</h1>
<table id="sales_items" class="table sortableTable fullwidth">
    <tbody><tr class="table__row " data-id="2817648">
        <td class="table__cell" data-name="TABLE_INDEX">1</td>
        <td class="table__cell  id" data-name="id">2817648</td>
        <td class="table__cell  name" data-name="name">3711 Моторное масло Liqui Moly 5W-30 Top Tec 205l</td>
        <td class="table__cell  price double" data-name="price">240.00</td>
        <td class="table__cell  count" data-name="count">10</td>
        <td class="table__cell  sum double" data-name="sum">2&nbsp;400.00</td>
        <td class="table__cell  percent" data-name="discount">0%</td>
        <td class="table__cell  discount_sum double" data-name="discount_sum">0.00</td>
        <td class="table__cell  total_sum double" data-name="total_sum">2&nbsp;399.60</td>
        <td class="table__cell  no_loyalty" data-name="no_loyalty">0</td>
        <td class="table__cell  time_services" data-name="time_services"></td>
    </tr>
    <tr class="table__row " data-id="2818289">
        <td class="table__cell" data-name="TABLE_INDEX">2</td>
        <td class="table__cell  id" data-name="id">2818289</td>
        <td class="table__cell  name" data-name="name">Услуги SPOT Расходники: Бутылка 1 литр</td>
        <td class="table__cell  price double" data-name="price">16.40</td>
        <td class="table__cell  count" data-name="count">1</td>
        <td class="table__cell  sum double" data-name="sum">16.40</td>
        <td class="table__cell  percent" data-name="discount">0%</td>
        <td class="table__cell  discount_sum double" data-name="discount_sum">0.00</td>
        <td class="table__cell  total_sum double" data-name="total_sum">16.40</td>
        <td class="table__cell  no_loyalty" data-name="no_loyalty">1</td>
        <td class="table__cell  time_services" data-name="time_services">5</td>
    </tr></tbody>
</table>`;

test('чек: заголовок, оплата и позиции', () => {
    const s = parseSale(SALE, 3606371);
    assert.equal(s.id, '3606371');
    assert.equal(s.date, '28.07.2026 19:35');
    assert.equal(s.station, 'Руставели 69');
    assert.equal(s.paid, 2416);
    // Способ оплаты CRM рисует только картинкой — подписи в разметке нет.
    assert.equal(s.payment, 'cashless');
    assert.equal(s.items.length, 2);
    assert.equal(s.items[0].name, '3711 Моторное масло Liqui Moly 5W-30 Top Tec 205l');
    assert.equal(s.items[0].price, 240);
    assert.equal(s.items[0].count, 10);
    assert.equal(s.items[0].total, 2399.6);
    // Пустая ячейка — null, а не 0: «услуга без времени» и «ноль минут» разное.
    assert.equal(s.items[0].minutes, null);
    assert.equal(s.items[1].minutes, 5);
});

test('отметка времени CRM сравнивается как дата, а не как строка', () => {
    // Лексикографически «28.07.2026» меньше «07.02.2024» — вот ради чего это.
    assert.ok(crmStampValue('28.07.2026 19:34:32') > crmStampValue('07.02.2024 18:55:04'));
    assert.ok(crmStampValue('18.09.2024 19:10') > crmStampValue('02.04.2024 17:28'));
    // Без времени тоже сравнимо, мусор уезжает в конец.
    assert.ok(crmStampValue('01.01.2025') > crmStampValue(''));
    assert.equal(crmStampValue('никогда'), 0);
});

test('обслуживания в карточке идут от свежих к старым', () => {
    const row = (id, closed) => `
        <tr class="table__row " data-id="${id}">
            <td class="table__cell  station_name" data-name="station_name">Руставели 69</td>
            <td class="table__cell  sum double" data-name="sum">1&nbsp;000.<small>00</small></td>
            <td class="table__cell  closed_at" data-name="closed_at">${closed}</td>
        </tr>`;
    // CRM отдаёт их по возрастанию — оператору нужен обратный порядок.
    const html = `<table id="clients">${row(1, '07.02.2024 19:10:40')}`
        + `${row(2, '28.07.2026 19:35:32')}${row(3, '18.09.2024 19:10:52')}</table>`;
    assert.deepEqual(parseClientCard(html, 1).sales.map(s => s.id), ['2', '3', '1']);
});

// ── Правка поля под маской ───────────────────────────────────────────────────
// Тут проверяется РЕДАКТИРОВАНИЕ, а не форматирование: набрать номер мало,
// его ещё стирают, правят в середине и вставляют из буфера.

// Модель поля ввода: держит значение и каретку и умеет то, что делает браузер
// (напечатать символ, нажать Backspace/Delete), прогоняя правку через маску.
function field(kind, value = '', caret = null) {
    let state = { value, caret: caret ?? value.length };
    const edit = (raw, pos, deleting) => {
        state = maskedFieldEdit(kind, { value: raw, caret: pos, deleting, previous: state.value });
        return api;
    };
    const api = {
        type(text) {
            for (const ch of text) {
                const { value: v, caret: c } = state;
                edit(v.slice(0, c) + ch + v.slice(c), c + 1, null);
            }
            return api;
        },
        // Браузер сначала убирает символ сам, и только потом зовёт обработчик.
        backspace(times = 1) {
            for (let i = 0; i < times; i++) {
                const { value: v, caret: c } = state;
                if (!c) break;
                edit(v.slice(0, c - 1) + v.slice(c), c - 1, 'back');
            }
            return api;
        },
        del(times = 1) {
            for (let i = 0; i < times; i++) {
                const { value: v, caret: c } = state;
                if (c >= v.length) break;
                edit(v.slice(0, c) + v.slice(c + 1), c, 'forward');
            }
            return api;
        },
        paste(text) {  // вставка поверх выделенного всего поля
            return edit(text, text.length, null);
        },
        at(pos) { state.caret = pos; return api; },
        get value() { return state.value; },
        get caret() { return state.caret; },
    };
    return api;
}

test('телефон набирается посимвольно, каретка идёт следом', () => {
    const f = field('phone').type('9819651916');
    assert.equal(f.value, '+7 (981) 965-19-16');
    assert.equal(f.caret, 18);
});

test('Backspace по дорисованной скобке всё-таки стирает', () => {
    // Из-за этого и написан maskedFieldEdit: человек видит «+7 (921)», жмёт
    // стереть, браузер убирает «)», маска возвращает её на место — и поле
    // выглядит намертво застрявшим.
    const f = field('phone').type('921');
    assert.equal(f.value, '+7 (921)');
    f.backspace();
    assert.equal(f.value, '+7 (92)'.replace(')', ''));  // «+7 (92»
    f.backspace();
    assert.equal(f.value, '+7 (9');
    f.backspace();
    assert.equal(f.value, '');
});

test('стирание длинного номера доходит до пустого поля, а не застревает', () => {
    const f = field('phone').type('9819651916');
    f.backspace(10);
    assert.equal(f.value, '');
    assert.equal(f.caret, 0);
});

test('правка середины номера не выкидывает каретку в хвост', () => {
    const f = field('phone').type('9819651916');
    // Каретка после «8» в коде 981; Backspace убирает именно «8», а хвост
    // номера подтягивается влево — так же, как это делает сама CRM.
    f.at(6).backspace();
    assert.equal(f.value, '+7 (919) 651-91-6');
    // Каретка осталась между «9» и «1», а не уехала в конец строки.
    assert.equal(f.caret, 5);
    f.type('8');
    assert.equal(f.value, '+7 (981) 965-19-16');
    assert.equal(f.caret, 6);
});

test('вставка номера из буфера в любом виде даёт один и тот же результат', () => {
    for (const raw of ['89819651916', '+7 981 965 19 16', '7(981)965-19-16', '9819651916']) {
        assert.equal(field('phone').paste(raw).value, '+7 (981) 965-19-16', raw);
    }
});

test('гос. номер: набор, стирание и чужая раскладка', () => {
    const f = field('plate').type('k926aa147');
    assert.equal(f.value, 'К926АА147');
    assert.equal(f.caret, 9);
    f.backspace(3);
    assert.equal(f.value, 'К926АА');
    // Разделителей на знаке нет — застревать нечему, но проверяем до конца.
    f.backspace(6);
    assert.equal(f.value, '');
});

test('Delete вперёд по разделителю тоже стирает, а не топчется', () => {
    const f = field('phone').type('9819651916');
    f.at(8).del();               // каретка перед пробелом после «)»
    assert.equal(f.value, '+7 (981) 651-91-6');
});
