import test from 'node:test';
import assert from 'node:assert/strict';

import {
    describeCarChanges, changedFieldLabels, fieldLabel, shortUrl,
} from './carDiff.js';

// Строку поля из нужной группы достать по ключу — так тесты читаются без
// знания порядка групп.
function row(changed, key) {
    const { groups } = describeCarChanges(changed);
    for (const g of groups) {
        const r = g.rows.find(x => x.key === key);
        if (r) return { ...r, group: g.label };
    }
    return null;
}

test('пустое событие не даёт ни одной строки', () => {
    assert.deepEqual(describeCarChanges(null), { total: 0, same: 0, groups: [] });
    assert.deepEqual(describeCarChanges({}), { total: 0, same: 0, groups: [] });
});

test('простое поле получает русскую подпись, группу и вид изменения', () => {
    const r = row({ kw: { from: null, to: 72 } }, 'kw');
    assert.equal(r.label, 'Мощность, кВт');
    assert.equal(r.group, 'Машина');
    assert.equal(r.kind, 'value');
    assert.equal(r.op, 'added');
    assert.equal(r.from, null);
    assert.equal(r.to, '72');

    assert.equal(row({ notes: { from: 'старое', to: null } }, 'notes').op, 'removed');
    assert.equal(row({ model: { from: 'Kalina', to: 'Kalina II' } }, 'model').op, 'changed');
});

test('топливо показывается словом, нераспознанное — с оговоркой', () => {
    assert.equal(row({ fuel_type: { from: '01', to: '05' } }, 'fuel_type').to, 'дизель');
    assert.equal(row({ fuel_type: { from: null, to: 'Дизель' } }, 'fuel_type').to, 'дизель');
    assert.match(row({ fuel_type: { from: null, to: 'керосин' } }, 'fuel_type').to, /не распознано/);
});

test('«1.60» из базы и 1.6 из формы — не изменение, а разное написание', () => {
    // Постгрес отдаёт numeric строкой, форма — числом; строка «было 1.6 → стало
    // 1.6» заставила бы искать разницу, которой нет.
    const nothing = describeCarChanges({ engine_volume: { from: '1.60', to: 1.6 } });
    assert.equal(nothing.total, 0);
    assert.equal(nothing.same, 1, 'поле не пропадает бесследно — оно посчитано');

    assert.equal(row({ engine_volume: { from: '1.60', to: 1.8 } }, 'engine_volume').from, '1.6');
});

test('в фильтрах остаются только изменившиеся, подписи не перепутаны', () => {
    // Ровно тот случай со скриншота: масляный не трогали, салонный вписали,
    // воздушный отметили как отсутствующий.
    const r = row({
        filter_part_numbers: {
            from: { mf: { part: 'LO-1901', absent: false }, sf: { part: '', absent: false }, vf: { part: '', absent: false } },
            to:   { mf: { part: 'LO-1901', absent: false }, sf: { part: 'CU 2434', absent: false }, vf: { part: null, absent: true } },
        },
    }, 'filter_part_numbers');

    assert.equal(r.kind, 'items');
    assert.equal(r.items.length, 2, 'масляный не менялся и в список не попал');

    const sf = r.items.find(i => i.label.includes('Салонный'));
    assert.equal(sf.to, 'CU 2434');
    assert.equal(sf.from, null);

    // CLAUDE.md: vf — ВОЗДУШНЫЙ, mf — масляный, sf — салонный. Перепутанная
    // подпись здесь означает неверный артикул у оператора.
    const vf = r.items.find(i => i.label.includes('Воздушный'));
    assert.equal(vf.to, 'фильтра у машины нет');
    assert.equal(r.items.find(i => i.label.includes('Масляный')), undefined);
});

test('«артикул стёрли» и «фильтра у машины нет» — разные строки', () => {
    const erased = row({ filter_part_numbers: {
        from: { mf: { part: 'W 914/2' } }, to: { mf: { part: '' } },
    } }, 'filter_part_numbers');
    assert.equal(erased.items[0].op, 'removed');
    assert.equal(erased.items[0].to, null);

    const absent = row({ filter_part_numbers: {
        from: { mf: { part: 'W 914/2' } }, to: { mf: { absent: true } },
    } }, 'filter_part_numbers');
    assert.equal(absent.items[0].op, 'changed');
    assert.equal(absent.items[0].to, 'фильтра у машины нет');
});

test('флаги обслуживания читаются как «поставили» и «сняли»', () => {
    const r = row({ service_flags: { from: { atNoFull: true }, to: { atNoFull: false, noSumpFilter: true } } },
        'service_flags');
    const set = r.items.find(i => i.text === 'поставили');
    const off = r.items.find(i => i.text === 'сняли');
    assert.equal(set.label, 'Фильтра в поддоне нет');
    assert.equal(off.label, 'АКПП полную не делаем');
    assert.equal(set.op, 'added');
    assert.equal(off.op, 'removed');
});

test('ссылки на источники: подпись сайта, короткий адрес и полный в href', () => {
    const long = 'https://www.mann-filter.com/ru-ru/catalog/search-results.html?mode=application&vehicleMake=LADA';
    const r = row({ source_links: { from: { motul: 'https://motul.lubricantadvisor.com/advice.aspx?data=1' }, to: {
        motul: 'https://motul.lubricantadvisor.com/advice.aspx?data=1', mann: long } } }, 'source_links');

    assert.equal(r.items.length, 1, 'неизменившийся Motul в список не попал');
    assert.equal(r.items[0].label, 'Mann-Filter');
    assert.equal(r.items[0].href, long);
    assert.ok(r.items[0].to.length < 45, 'адрес показывается коротким');
});

test('агрегаты разворачиваются в «агрегат · что именно»', () => {
    const r = row({ fluid_capacities: {
        from: { engine: { volumeService: 4.5 }, automatic: { volumeTotal: 8, isCvt: true } },
        to:   { engine: { volumeService: 4.2, motulProducts: ['MOTUL 8100'] }, automatic: { volumeTotal: 8, isCvt: true } },
    } }, 'fluid_capacities');

    const labels = r.items.map(i => i.label);
    assert.deepEqual(labels, ['ДВС · объём частичной, л', 'ДВС · масла и допуска']);
    assert.equal(r.items[0].from, '4.5');
    assert.equal(r.items[0].to, '4.2');
    assert.equal(r.items[1].to, 'MOTUL 8100');
});

test('свой агрегат сравнивается по названию, а не по месту в списке', () => {
    const r = row({ fluid_capacities: {
        from: { custom: [{ label: 'Редуктор', volumeTotal: 1 }] },
        to:   { custom: [{ label: 'Раздатка', volumeTotal: 0.9 }, { label: 'Редуктор', volumeTotal: 1.2 }] },
    } }, 'fluid_capacities');

    const labels = r.items.map(i => i.label);
    assert.ok(labels.includes('Свой агрегат «Редуктор» · объём полной, л'));
    assert.ok(labels.includes('Свой агрегат «Раздатка» · объём полной, л'));
});

test('теги и допуска показываются добавленными и убранными строками', () => {
    const r = row({ tags: { from: ['пенсия', 'такси'], to: ['пенсия', 'редкая'] } }, 'tags');
    assert.equal(r.kind, 'list');
    assert.deepEqual(r.added, ['редкая']);
    assert.deepEqual(r.removed, ['такси']);
    assert.equal(r.op, 'changed');

    const app = row({ car_approvals: { from: [], to: ['ACEA A3/B4'] } }, 'car_approvals');
    assert.equal(app.op, 'added');
    assert.deepEqual(app.removed, []);
});

test('изменение, которое не удалось разобрать, показывается сырьём, а не пропадает', () => {
    const r = row({ fluid_capacities: { from: { engine: { unknownKey: 1 } }, to: { engine: { unknownKey: 2 } } } },
        'fluid_capacities');
    assert.equal(r.items.length, 1, 'незнакомый ключ агрегата всё равно строка');

    const same = row({ service_flags: { from: { atNoFull: false }, to: {} } }, 'service_flags');
    assert.equal(same.kind, 'value');
    assert.equal(same.raw, true);
});

test('поле не из вкладок правки попадает в «Прочее», а не теряется', () => {
    const { total, groups } = describeCarChanges({ some_new_column: { from: 1, to: 2 } });
    assert.equal(total, 1);
    assert.equal(groups.at(-1).label, 'Прочее');
    assert.equal(groups.at(-1).rows[0].label, 'some_new_column');
});

test('группы идут в порядке вкладок окна правки', () => {
    const { groups } = describeCarChanges({
        tags: { from: [], to: ['x'] },
        kw: { from: 1, to: 2 },
        filter_part_numbers: { from: {}, to: { mf: { part: 'W 1' } } },
    });
    assert.deepEqual(groups.map(g => g.label), ['Машина', 'Фильтры ДВС', 'Теги и заметка']);
});

test('подписи для карточки в ленте идут в том же порядке и без пустых правок', () => {
    assert.deepEqual(
        changedFieldLabels({ tags: { from: [], to: ['x'] }, kw: { from: null, to: 72 } }),
        ['Мощность, кВт', 'Теги'],
    );
    // В карточке не должно быть поля, которого в окне нет.
    assert.deepEqual(changedFieldLabels({ year_to: { from: '2019', to: 2019 } }), []);
    assert.equal(fieldLabel('bhp'), 'Мощность, л.с.');
    assert.equal(fieldLabel('нет_такого'), 'нет_такого');
});

test('короткий адрес оставляет узнаваемое: сайт и путь', () => {
    assert.equal(shortUrl('https://www.ravenol.ru/catalog/car/123'), 'ravenol.ru/catalog/car/123');
    assert.equal(shortUrl('https://example.com/'), 'example.com');
    assert.equal(shortUrl(''), '');
    assert.ok(shortUrl('https://a.ru/x?y=1').endsWith('?…'));
});
