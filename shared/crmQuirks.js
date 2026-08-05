// ─────────────────────────────────────────────────────────────────────────────
// Особенности автомобилей из CRM — единый список правил «эту машину так не
// обслуживаем» / «смотреть по факту» / «к сведению».
//
// Раньше кусок этого списка лежал прямо в юзерскрипте (массив марок, которым
// «полную не делаем») и второй копией — в shouldDefaultToPartial(). Копии
// расходились, а сам список из CRM никуда, кроме головы оператора, не попадал.
// Теперь правило пишется здесь один раз, а сайт и калькулятор показывают его
// в одинаковой формулировке.
//
// ВАЖНО про слова: в CRM «аппаратная замена» = «полная». Если аппарат
// подключить некуда — полную не делаем, но ЧАСТИЧНУЮ делаем всегда. Поэтому
// в текстах ниже нет «замену не делаем» без уточнения: пишем «полную не
// делаем, частичную делаем», иначе оператор откажет клиенту целиком.
//
// Правило: { id, scope, severity, text, note?, brands?, models?, when?, noFullAt? }
//   scope    — к какому агрегату относится: engine | automatic | manual | general;
//   severity — block (так не делаем), warn (смотреть по факту), info (к сведению);
//   noFullAt — правило запрещает полную замену АКПП/вариатора;
//   partialDefault — расчёт по умолчанию частичный (следует из noFullAt, но
//              ставится и там, где полная возможна только по факту).
// ─────────────────────────────────────────────────────────────────────────────

export const SEVERITY_LABELS = {
    block: 'так не делаем',
    warn:  'смотреть по факту',
    info:  'к сведению',
};

// Марки в данных приходят латиницей (Motul, Ravenol, база), но из CRM и от
// оператора прилетает кириллица — приводим к одному написанию.
const BRAND_ALIASES = {
    'шкода': 'skoda', 'сеат': 'seat', 'ауди': 'audi', 'форд': 'ford',
    'ситроен': 'citroen', 'ситроэн': 'citroen', 'citroën': 'citroen',
    'пежо': 'peugeot', 'рено': 'renault', 'вольво': 'volvo',
    'ниссан': 'nissan', 'мазда': 'mazda', 'тойота': 'toyota',
    'мицубиси': 'mitsubishi', 'митсубиши': 'mitsubishi', 'мицубиши': 'mitsubishi',
    'фольксваген': 'volkswagen', 'vw': 'volkswagen', 'фолькс': 'volkswagen',
    'порше': 'porsche', 'бмв': 'bmw', 'мерседес': 'mercedes', 'мерс': 'mercedes',
    'mercedes benz': 'mercedes', 'хундай': 'hyundai', 'хёндай': 'hyundai',
    'хендай': 'hyundai', 'киа': 'kia', 'шевроле': 'chevrolet', 'опель': 'opel',
    'кадиллак': 'cadillac', 'джили': 'geely', 'гили': 'geely', 'чери': 'chery',
    'грейт вол': 'great wall', 'greatwall': 'great wall',
};

// Марки концерна GM, у которых МКПП без сливной пробки (правило 7 из CRM).
const GM_BRANDS = ['chevrolet', 'opel', 'cadillac', 'gmc', 'buick', 'hummer', 'daewoo'];

// Роботы этих марок — DSG и PowerShift, их не обслуживаем (правило 17).
const WET_ROBOT_BRANDS = ['volkswagen', 'skoda', 'seat', 'audi', 'porsche', 'ford', 'volvo'];

// Внедорожники Skoda/Seat: им полная возможна, но по факту подключения.
const SKODA_SEAT_SUV = ['kodiaq', 'karoq', 'kamiq', 'yeti', 'ateca', 'tarraco', 'arona'];

// Диакритика снимается разложением: иначе Citroën превращается в «citro n»
// и правило для французов мимо этой марки проходит.
function normStr(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zа-я0-9]+/g, ' ')
        .trim();
}

function canonBrand(raw) {
    const n = normStr(raw);
    if (BRAND_ALIASES[n]) return BRAND_ALIASES[n];
    // «Volkswagen Passat» в поле марки, «Mercedes-Benz» → «mercedes benz»
    const first = n.split(' ')[0];
    return BRAND_ALIASES[first] && n.split(' ').length <= 2 ? BRAND_ALIASES[first] : n;
}

function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

// Контекст для правил. Принимает и запись базы (brand/model/engine_volume),
// и car-объект калькулятора (makeShort/modelShort/volume) — форматы разные,
// а правило должно быть одно.
export function quirkContext(car, data) {
    const src = car || {};
    const brand = canonBrand(src.makeShort || src.brand || src.make || '');
    let model = normStr(src.modelShort || src.model || '');
    // «Mazda 6» и «Mazda6» в поле модели — убираем марку, чтобы правило
    // искало по «6», а не по «mazda6».
    if (brand && model.startsWith(brand)) model = model.slice(brand.length).trim();

    const generation = normStr(src.generation || '');
    const auto = (data && data.automatic) || null;

    return {
        brand,
        model,
        modelTokens: new Set([...model.split(' '), ...generation.split(' ')].filter(Boolean)),
        generation,
        engineCode: normStr(src.engineCode || src.engine_code || ''),
        volume: num(src.volume != null && src.volume !== '' ? src.volume : src.engine_volume),
        bhp: num(src.bhp),
        year: num(src.yearFrom || src.year_from),
        fuel: normStr(src.fuelType || src.fuel_type || ''),
        hasAuto: !!auto,
        isCvt: !!(auto && auto.isCvt),
        isDct: !!(auto && auto.isDct),
        hasManual: !!(data && data.manual),
    };
}

// Шаблон модели — набор слов, все должны найтись в модели/поколении:
// 'land cruiser 200' совпадёт с «Land Cruiser 200», но не с «Land Cruiser 300».
function modelHits(ctx, patterns) {
    if (!patterns || !patterns.length) return true;
    return patterns.some(p => normStr(p).split(' ').every(t => ctx.modelTokens.has(t)));
}

export const CRM_QUIRKS = [
    // 1. Skoda / Seat — аппарат не подключить
    {
        id: 'skoda-seat-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['skoda', 'seat'],
        when: (ctx) => !modelHits(ctx, SKODA_SEAT_SUV),
        text: 'Полную (аппаратную) замену не делаем — аппарат не подключается к системе охлаждения. Частичную делаем.',
        note: 'Полная на этих марках допустима только на внедорожниках.',
    },
    {
        id: 'skoda-seat-suv-at-by-fact',
        // Пока подключение не проверили — расчёт частичной: это единственный
        // вариант, который на этой машине точно сделают.
        scope: 'automatic', severity: 'warn', partialDefault: true,
        brands: ['skoda', 'seat'],
        models: SKODA_SEAT_SUV,
        text: 'Полную (аппаратную) на Skoda и Seat делаем только на внедорожниках — этот как раз внедорожник. Смотрим по факту: подключается ли аппарат и есть ли переходники.',
    },

    // 2. Audi A4 / A5 / A6 — вариатор под высоким давлением
    {
        id: 'audi-a456-cvt-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['audi'],
        models: ['a4', 'a5', 'a6'],
        text: 'Вариатор (мультитроник): полную (аппаратную) не делаем — в системе охлаждения вариатора высокое давление. Частичную делаем.',
        note: 'У этого вариатора есть ещё фильтр тонкой очистки жидкости.',
    },

    // 3. Ford — пробка МКПП и Kuga
    {
        id: 'ford-manual-neutral',
        scope: 'manual', severity: 'warn',
        brands: ['ford'],
        text: 'Ручка КПП при замене должна стоять на нейтрали. Если воткнута передача, при закручивании сливной пробки ломается механизм шарика — пробку придётся менять.',
    },
    {
        id: 'ford-kuga-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['ford'], models: ['kuga'],
        text: 'Полную (аппаратную) не делаем — у этой АКПП нет системы охлаждения. Частичную делаем.',
        note: 'Фильтр в этой АКПП не меняется.',
    },

    // 4. Ford Focus — шестиступенчатая МКПП на DCTF
    {
        id: 'ford-focus-manual-dctf',
        scope: 'manual', severity: 'info',
        brands: ['ford'], models: ['focus'],
        text: 'Если МКПП шестиступенчатая — заливаем масло DCTF.',
    },

    // 5. Французы — нет системы охлаждения АКПП
    {
        id: 'psa-renault-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['citroen', 'peugeot', 'renault'],
        text: 'Полную (аппаратную) не делаем ни на одной модели этой марки — нет системы охлаждения АКПП. Частичную делаем.',
    },

    // 6. Не откачать через щуп — только слив
    {
        id: 'engine-no-express',
        scope: 'engine', severity: 'block',
        models: ['hover', 'prado', 'land cruiser 200', 'lc200', 'pajero sport'],
        text: 'Экспресс-замену масла ДВС не делаем — откачкой масло полностью не убрать. Меняем только сливом через пробку.',
        note: 'В CRM правило записано для мотора 2.4D (с 2019 года).',
    },

    // 7. GM — МКПП без сливной пробки
    {
        id: 'gm-manual-sump',
        scope: 'manual', severity: 'warn',
        brands: GM_BRANDS,
        text: 'В МКПП нет сливной пробки — снимаем поддон, под ним прокладка. Прокладку мастер подбирает строго по VIN, они разные.',
        note: 'Считаем как «замена масла МКПП» + «замена фильтра КПП / с.у. поддона».',
    },

    // 8-9. VW Polo и Tiguan — контура охлаждения нет
    {
        id: 'vw-polo-tiguan-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['volkswagen'], models: ['polo', 'tiguan'],
        text: 'Аппаратно (полную) не делаем — нет контура охлаждения АКПП, подключаться некуда. Делаем частичную.',
        note: 'На разных комплектациях подключение иногда есть — смотреть по факту.',
    },

    // 10. Touareg / Cayenne 3.6 — фильтр можно перепутать с теплообменником
    {
        id: 'touareg-cayenne-oil-filter',
        scope: 'engine', severity: 'warn',
        models: ['touareg', 'cayenne'],
        when: (ctx) => ctx.volume == null || Math.abs(ctx.volume - 3.6) < 0.15,
        text: 'Мотор 3.6 (280 л.с.): масляный фильтр внизу по левой стороне. Прямо над ним теплообменник с очень похожей крышкой — не перепутать.',
        note: 'Артикул масляного фильтра — HU 932/6n.',
    },

    // 11. Volvo — высокое давление в АКПП
    {
        id: 'volvo-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['volvo'],
        text: 'Аппаратно (полную) не делаем — высокое давление рабочей жидкости АКПП. Вместо неё предлагаем частичную три раза подряд: с запуском двигателя и перебором режимов АКПП.',
    },

    // 12. Вариаторы Nissan и Outlander 3 — два фильтра
    {
        id: 'nissan-cvt-fine-filter',
        scope: 'automatic', severity: 'info',
        when: (ctx) => ctx.isCvt && (ctx.brand === 'nissan'
            || (ctx.brand === 'mitsubishi' && modelHits(ctx, ['outlander']))),
        text: 'В вариаторе два фильтра — грубой и тонкой очистки. За замену фильтра тонкой очистки берём дополнительно нормо-час.',
    },

    // 13. Mazda 6 — аппарат не подключить
    {
        id: 'mazda6-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['mazda'], models: ['6'],
        text: 'Полную (аппаратную) замену не делаем — аппарат не подключается к системе охлаждения. Частичную делаем.',
    },

    // 14. Фильтр АКПП: в шестиступенчатых его физически не поменять
    {
        id: 'at-filter-6ab',
        scope: 'automatic', severity: 'info',
        when: (ctx) => ctx.hasAuto && !ctx.isCvt && !ctx.isDct
            && ctx.brand !== 'bmw' && ctx.brand !== 'mercedes',
        text: 'Почти во всех шестиступенчатых автоматах фильтр АКПП заменить технически нельзя, даже если он там стоит. Исключения — BMW и Mercedes.',
        note: 'Меняется ли фильтр на этой машине и с какого года — смотреть в списке «Фильтра в АКПП».',
    },
    {
        id: 'camry-at-filter-fixed',
        scope: 'automatic', severity: 'info',
        brands: ['toyota'], models: ['camry'],
        text: 'В восьмиступенчатой АКПП Камри фильтр несменный.',
    },
    {
        id: 'creta-at-filter-fixed',
        scope: 'automatic', severity: 'info',
        brands: ['hyundai'], models: ['creta'],
        text: 'Фильтр АКПП на Крете не меняется.',
    },

    // 16. VAG 1.4 TSI (DJKA) + АКПП AQ 300-8F
    {
        id: 'vag-aq300-atf',
        scope: 'automatic', severity: 'info',
        brands: ['skoda', 'volkswagen'],
        models: ['karoq', 'taos', 'jetta', 'octavia'],
        when: (ctx) => ctx.engineCode.includes('djka')
            || ctx.modelTokens.has('taos') || ctx.modelTokens.has('karoq')
            || ctx.modelTokens.has('a8')
            || (ctx.volume != null && Math.abs(ctx.volume - 1.4) < 0.05 && (ctx.year == null || ctx.year >= 2018)),
        text: 'Поперечный 1.4 TSI 150 л.с. (DJKA) с восьмиступенчатой АКПП AQ 300-8F: допуск по маслу VAG ATF G 053 001 A2.',
        note: 'На Рольфе и ZIC эти машины не бьются — допуск смотреть у Ravenol.',
    },

    // 17. Роботы
    {
        id: 'dsg-powershift-no-service',
        scope: 'automatic', severity: 'block',
        when: (ctx) => ctx.isDct && WET_ROBOT_BRANDS.includes(ctx.brand),
        text: 'Масло в роботах DSG и PowerShift не меняем.',
    },
    {
        id: 'robot-other-as-is',
        scope: 'automatic', severity: 'info',
        when: (ctx) => ctx.isDct && !WET_ROBOT_BRANDS.includes(ctx.brand),
        text: 'Это не DSG и не PowerShift — в остальных роботах масло меняем как есть.',
    },

    // 19. Chery Tiggo 8 — робот Getrag обслуживается как механика
    {
        id: 'chery-tiggo8-getrag',
        scope: 'automatic', severity: 'info',
        brands: ['chery'], models: ['tiggo 8'],
        text: 'Замена масла в роботе Getrag делается как в обычной механике — входит ровно 4 литра.',
    },

    // 20. BMW — только по факту
    {
        id: 'bmw-at-by-fact',
        scope: 'automatic', severity: 'warn',
        brands: ['bmw'],
        text: 'Аппаратную (полную) делаем только по факту: смотрим на месте, подключается ли аппарат и есть ли переходники.',
    },

    // 21. Hyundai / Kia — посторонние предметы в масляном фильтре
    {
        id: 'hyundai-kia-oil-filter-check',
        scope: 'engine', severity: 'warn',
        brands: ['hyundai', 'kia'],
        text: 'Перед установкой масляного фильтра проверь его сердцевину: на Хендай и Киа в ней находят посторонние предметы. Оставшаяся внутри пробка забьёт масляный канал.',
    },

    // 22. Geely Tugella
    {
        id: 'geely-tugella-at-no-full',
        scope: 'automatic', severity: 'block', noFullAt: true,
        brands: ['geely'], models: ['tugella'],
        text: 'Полную замену в АКПП на Тугелле не сделать. Делаем частичную.',
    },
];

// Все особенности из CRM, подходящие этой машине.
// car — запись базы или car-объект калькулятора, data — объёмы жидкостей
// (нужны, чтобы отличить вариатор от робота и от обычной АКПП).
export function crmQuirksFor(car, data) {
    const ctx = quirkContext(car, data);
    if (!ctx.brand && !ctx.model) return [];
    const out = [];
    for (const q of CRM_QUIRKS) {
        if (q.brands && !q.brands.includes(ctx.brand)) continue;
        if (q.models && !modelHits(ctx, q.models)) continue;
        if (q.when && !q.when(ctx)) continue;
        out.push({
            id: q.id, scope: q.scope, severity: q.severity,
            text: q.text, note: q.note || '', noFullAt: !!q.noFullAt,
            partialDefault: !!(q.noFullAt || q.partialDefault),
        });
    }
    return out;
}

// Особенности для карточки конкретного агрегата в калькуляторе.
// aggregate — элемент getAggregates(): у АКПП group 'auto', у ДВС 'engine',
// у МКПП key 'manual'.
export function crmQuirksForAggregate(car, data, aggregate) {
    const scope = aggregate && (aggregate.group === 'engine' ? 'engine'
        : aggregate.group === 'auto' ? 'automatic'
        : aggregate.key === 'manual' ? 'manual' : null);
    if (!scope) return [];
    return crmQuirksFor(car, data).filter(q => q.scope === scope);
}

// Правда ли, что полную замену АКПП/вариатора этой машине не делаем.
export function crmNoFullAt(car, data) {
    return crmQuirksFor(car, data).some(q => q.noFullAt);
}

// Считать ли по умолчанию частичную. Шире, чем crmNoFullAt: там, где полная
// возможна только «по факту подключения», по умолчанию тоже считаем частичную —
// её на этой машине сделают в любом случае.
export function crmPrefersPartial(car, data) {
    return crmQuirksFor(car, data).some(q => q.partialDefault);
}
