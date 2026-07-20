import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseStations, parseAnalyseFree, parseRawPrice,
    decodeOilLiters, crmOilPricePerLiter,
    normCrmName, extractViscosity, matchCrmOilRow,
    detectFilterType, cleanFilterName, FILTER_SLOTS, sortFilterRows,
} from './crmAnalyse.js';
import { getShopOils } from './oils.js';

// Фрагменты сняты с реальных страниц CRM /analyse/free (архив пользователя).

function crmRow(id, name, count, price) {
    return `<tr class="table__row "
                        data-id="${id}"
        >
            <td class="table__cell" data-name="TABLE_INDEX">1</td>
            <td class="table__cell action__group_edit_checkbox ">
<input type="checkbox" name="id[]" value="${id}" class="input group-edit-select-checkbox"></td>
            <td class="table__cell  id" data-name="id">
                            ${id}                        </td>
            <td class="table__cell  name" data-name="name">
                            ${name}                        </td>
            <td class="table__cell  count45" data-name="count45">
                            ${count}                        </td>
            <td class="table__cell  price double" data-name="price">
                            ${price}                        </td>
            </tr>`;
}

const STATIONS_SELECT = `<select data-type="enum" id="field__stations" class="multiple"
			name="stations[]" multiple size="10">
        <option>
                (не выбрано)			</option>
        <option  value="45"                 selected                >
                Ветеранов 167к8			</option>
        <option  value="11"                                 >
                Выборгское ш. 2			</option>
        <option  value="26"                                 >
                Выборгское ш. 212к8			</option>
</select>`;

const RESULTS_PAGE = `<html><body>${STATIONS_SELECT}
<table id="free" class="table sortableTable">
<thead><tr><td class="table__cell header_name center">Имя</td></tr></thead>
${crmRow('12518', '112071 Моторное масло Motul 5W-40 6100 SYN-CLEAN 60l (1х60L)', '600', '210.<small>00</small>')}
${crmRow('2825733', '202770 Моторное масло ZIC X8 SE 5W-30 (200л) (1x200L)', '2000', '180.<small>00</small>')}
${crmRow('9901', 'W 712/95 Масляный фильтр двигателя', '3', '650.<small>00</small>')}
</table></body></html>`;

const EMPTY_PAGE = `<html><body>${STATIONS_SELECT}
<table id="free"><thead><tr><td>Имя</td></tr></thead></table></body></html>`;

const LOGIN_PAGE = `<html><body><form action="/login" method="POST">
<input type="text" name="login"/><input type="password" name="password"/>
<input type="submit" value="Войти"/></form></body></html>`;

test('parseStations вынимает станции из селекта, пропуская «(не выбрано)»', () => {
    assert.deepEqual(parseStations(RESULTS_PAGE), [
        { id: '45', name: 'Ветеранов 167к8' },
        { id: '11', name: 'Выборгское ш. 2' },
        { id: '26', name: 'Выборгское ш. 212к8' },
    ]);
    assert.deepEqual(parseStations(LOGIN_PAGE), []);
});

test('parseAnalyseFree разбирает строки: имя, остаток, цена с <small>', () => {
    const { loginPage, rows } = parseAnalyseFree(RESULTS_PAGE, '45');
    assert.equal(loginPage, false);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
        id: '12518',
        name: '112071 Моторное масло Motul 5W-40 6100 SYN-CLEAN 60l (1х60L)',
        count: 600,
        priceRaw: 210.00,
    });
    assert.equal(rows[1].count, 2000);
    assert.equal(rows[2].priceRaw, 650.00);
});

test('parseAnalyseFree без stationId берёт первую count-колонку', () => {
    const { rows } = parseAnalyseFree(RESULTS_PAGE);
    assert.equal(rows[0].count, 600);
});

test('пустая выдача — не страница логина, страница логина — детектится', () => {
    const empty = parseAnalyseFree(EMPTY_PAGE, '45');
    assert.equal(empty.loginPage, false);
    assert.equal(empty.rows.length, 0);

    const login = parseAnalyseFree(LOGIN_PAGE, '45');
    assert.equal(login.loginPage, true);
    assert.equal(login.rows.length, 0);
});

test('кодировка остатка масла: значение ÷ 10 = литры', () => {
    assert.equal(decodeOilLiters(556), 55.6);  // 55.6 л
    assert.equal(decodeOilLiters(375), 37.5);
    assert.equal(decodeOilLiters(10), 1);      // 1.0 л
    assert.equal(decodeOilLiters(5), 0.5);     // «5» = 500 мл
    assert.equal(decodeOilLiters(0), 0);
});

test('цена масла в CRM — за 0.1 л: ×10 = ₽/л', () => {
    assert.equal(crmOilPricePerLiter(240.00), 2400);
    assert.equal(crmOilPricePerLiter(212.5), 2125);
});

test('parseRawPrice терпит <small>, запятые и пробелы', () => {
    assert.equal(parseRawPrice('210. 00'), 210);
    assert.equal(parseRawPrice('1 234,50'), 1234.5);
    assert.equal(parseRawPrice('650'), 650);
});

test('normCrmName чистит артикул, «Моторное масло» и фасовки (обе «х»/«x», «л»/«l»)', () => {
    assert.equal(
        normCrmName('3709 Моторное масло Liqui Moly 5W-30 Top Tec 60l (1х60L)'),
        'LIQUI MOLY 5W-30 TOP TEC');
    assert.equal(
        normCrmName('162612 Моторное масло ZIC для легковых автомобилей TOP LS 5W-30 (4л)'),
        'ZIC ДЛЯ ЛЕГКОВЫХ АВТОМОБИЛЕЙ TOP LS 5W-30');
    // артикул с буквами и без артикула вовсе
    assert.equal(normCrmName('15665B Моторное масло Castrol 5W-30 EDGE LL 208l (1x208L)'),
        'CASTROL 5W-30 EDGE LL');
    assert.equal(normCrmName('Моторное масло 5w-30 ESP (20l)'), '5W-30 ESP');
});

test('extractViscosity канонизирует и не путается в «ZERO 30 0W-30»', () => {
    assert.equal(extractViscosity('5w30'), '5W-30');
    assert.equal(extractViscosity('0W 20'), '0W-20');
    assert.equal(extractViscosity('ZIC ZERO 30 0W-30'), '0W-30');
    assert.equal(extractViscosity('Leichtlauf HC 7 5W-40'), '5W-40');
    assert.equal(extractViscosity('Масляный фильтр'), null);
});

test('matchCrmOilRow сопоставляет реальные строки CRM с каталогом', () => {
    const oils = getShopOils();
    const cases = [
        ['112071 Моторное масло Motul 5W-40 6100 SYN-CLEAN 60l (1х60L)', 'Motul', '5W-40 6100 SYN-CLEAN'],
        ['3709 Моторное масло Liqui Moly 5W-30 Top Tec 60l (1х60L)', 'Liqui Moly', '5W-30 Top Tec'],
        ['9044 Моторное масло Liqui Moly 5W-30 Molygen New Generation 60l (1x60L)', 'Liqui Moly', '5W-30 Molygen'],
        ['21268 Моторное масло Liqui Moly Leichtlauf HC 7 5W-30 A3/B4 60l (1x60L)', 'Liqui Moly', 'Leichtlauf HC 7 5W-30'],
        ['151527 Моторное масло Mobil 5W-30 Super 3000 FE 4l (4x4L)', 'Mobil', 'Super 3000 FE 5W-30'],
        ['155098 Моторное масло Mobil 10W-40 Ultra 4l (4x4L)', 'Mobil', 'Ultra 10W-40'],
        ['X3214932 Моторное масло GM 5W-30 "Dexos II" 5l (4x5L)', 'GM', '5W-30 Dexos II'],
        ['550042562 Моторное масло Shell 5W-30 Ultra AM-L Kia/Hyundai 209l (1х209L)', 'Shell', '5W-30 Ultra AM-L Kia/Hyundai'],
        ['15665B Моторное масло Castrol 5W-30 EDGE LL 208l (1x208L)', 'Castrol', '5W-30 EDGE LL'],
        ['202770 Моторное масло ZIC X8 SE 5W-30 (200л) (1x200L)', 'ZIC', 'X8 SE 5W-30'],
        ['162612 Моторное масло ZIC для легковых автомобилей TOP LS 5W-30 (4л)', 'ZIC', 'TOP LS 5W-30'],
        ['162682 Моторное масло ZIC для легковых автомобилей TOP 5W-40 (4л)', 'ZIC', 'TOP 5W-40'],
        ['162676 Моторное масло ZIC для легковых автомобилей ZERO 30 0W-30 (4л)', 'ZIC', 'ZERO 0W-30'],
        ['112129 Моторное масло Motul 5W-30 SAVE-NERGY 60l (1x60L)', 'Motul', '5W-30 SAVE-NERGY'],
        ['112057 Моторное масло Motul 5W-30 8100 X-Clean+ 60l (1x60L)', 'Motul', '5W-30 8100 X-Clean+'],
        // ROLF: различаются только допусками в хвосте — матч по токенам C3 / A5-B5
        ['104787-200 Моторное масло ROLF Professional SAE 5W-30 API SN, ACEA C3 (200л)', 'ROLF', 'Professional 5W-30 C3'],
        ['103737 Моторное масло ROLF Professional SAE 5W-30 API SP, ACEA A5/B5 (200л) (1x200L)', 'ROLF', 'Professional 5W-30 A5/B5'],
    ];
    for (const [rowName, b, n] of cases) {
        const m = matchCrmOilRow(rowName, oils);
        assert.ok(m, `не сматчилось: ${rowName}`);
        assert.equal(`${m.oil.b} ${m.oil.n}`, `${b} ${n}`, `неверный матч для: ${rowName}`);
    }
});

test('matchCrmOilRow: без бренда/вязкости или чужой товар → null', () => {
    const oils = getShopOils();
    assert.equal(matchCrmOilRow('Моторное масло 5w-30 ESP (20l)', oils), null); // бренд не указан
    assert.equal(matchCrmOilRow('W 712/95 Масляный фильтр', oils), null);       // не масло
    assert.equal(matchCrmOilRow('9903 Моторное масло Xado 5W-30 Atomic (4л)', oils), null); // нет в каталоге
});

test('фильтры: тип по названию и чистка имени (порт из SPOT-скрипта)', () => {
    assert.equal(detectFilterType('Воздушный фильтр салона Corolla'), 'сф');
    assert.equal(detectFilterType('Масляный фильтр двигателя'), 'мф');
    assert.equal(detectFilterType('Топливный фильтр'), 'тф');
    assert.equal(detectFilterType('Воздушный фильтр'), 'вф');
    assert.equal(detectFilterType('Свеча зажигания'), null);

    assert.equal(cleanFilterName('W712/95 Масляный фильтр двигателя (3)'), 'двигателя');
    assert.equal(FILTER_SLOTS.find(s => s.key === 'vf').crmType, 'вф');
    assert.equal(FILTER_SLOTS.find(s => s.key === 'mf').crmType, 'мф');
});

test('sortFilterRows: лучшая цена — минимальная, наличие важнее цены', () => {
    // Сценарий из бага: дорогой оригинал шёл первым в выдаче CRM и попадал
    // в расчёт вместо дешёвого аналога.
    const rows = [
        { id: '1', name: '5Q0 819 669 Фильтр салона VAG', count: 1, priceRaw: 6538 },
        { id: '2', name: 'LAC-1948 Фильтр салона LYNXauto', count: 2, priceRaw: 611 },
        { id: '3', name: 'LAC-1948C Фильтр салона угольный LYNXauto', count: 1, priceRaw: 908 },
    ];
    assert.deepEqual(sortFilterRows(rows).map(r => r.id), ['2', '3', '1']);

    // Нет в наличии — вниз, даже если дешевле; цена 0 (не распозналась) — в конец группы
    const mixed = [
        { id: 'a', name: 'x', count: 0, priceRaw: 100 },
        { id: 'b', name: 'x', count: 5, priceRaw: 0 },
        { id: 'c', name: 'x', count: 3, priceRaw: 900 },
        { id: 'd', name: 'x', count: 1, priceRaw: 300 },
    ];
    assert.deepEqual(sortFilterRows(mixed).map(r => r.id), ['d', 'c', 'b', 'a']);

    // Исходный массив не мутируется, пустой/undefined вход не падает
    assert.deepEqual(rows.map(r => r.id), ['1', '2', '3']);
    assert.deepEqual(sortFilterRows(undefined), []);
});
