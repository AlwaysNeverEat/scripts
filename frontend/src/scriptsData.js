// ─────────────────────────────────────────────────────────────────────────────
// Витрина юзерскриптов для фида «Скрипты» на главной.
//
// url — это @downloadURL самого скрипта (сырой .user.js на raw.githubusercontent).
// Ссылка ведёт прямо на него: если у пользователя стоит Tampermonkey, расширение
// само перехватит переход и покажет экран установки; если нет — браузер отдаст
// файл, и тогда пригодится мини-гайд (см. scriptsFeed.js).
//
// title/desc — человеческие, не сырой @description. version/url синхронны
// метаданным скриптов в корне репозитория.
// ─────────────────────────────────────────────────────────────────────────────

export const SCRIPT_GROUPS = [
    {
        id: 'core',
        title: 'Калькулятор и база',
        scripts: [
            {
                id: 'oil-calculator',
                title: 'Калькулятор замены масла',
                desc: 'Виджет прямо на сайтах подбора: считает объём и подбирает Motul + ROLF по вашему фильтру/маслу. Кнопка «Отправить отчёт» кладёт расчёт в общую базу.',
                site: 'Mann-Filter · LYNXauto · Ravenol · Motul · UPEC · ROLF',
                version: '2.23.121',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/Mann%20%2B%20Motul%20Oil%20Calculator-2.12.user.js',
            },
            {
                id: 'db-notifier',
                title: 'Нотификатор базы',
                desc: 'Пока подбираешь машину — проверяет, не считали ли её уже. Показывает «✓ эта машина уже рассчитана» и по клику открывает её страницу на сайте.',
                site: 'Mann-Filter · LYNXauto · Ravenol',
                version: '1.2.121',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20DB%20Notifier-1.0.user.js',
            },
        ],
    },
    {
        id: 'crm',
        title: 'CRM и записи',
        scripts: [
            {
                id: 'recalc-check',
                title: 'Пересчёт чека',
                desc: 'На странице чека в CRM пересчитывает стоимость услуг по актуальным ценам одним движением.',
                site: 'CRM zamena-masla-spot.ru · /sale',
                version: '1.7.121',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT-CRM-%D0%9F%D0%B5%D1%80%D0%B5%D1%81%D1%87%D1%91%D1%82-%D1%87%D0%B5%D0%BA%D0%B0-1.0.user.js',
            },
            {
                id: 'price-search',
                title: 'Поиск цен по артикулам',
                desc: 'Вставляешь любые артикулы — тип фильтра (вф/мф/сф/тф) определяется сам по названию товара, цены подтягиваются автоматически.',
                site: 'CRM · /analyse/free',
                version: '3.1',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT-%20%D0%9F%D0%BE%D0%B8%D1%81%D0%BA%20%D1%86%D0%B5%D0%BD%20%D0%BF%D0%BE%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0%D0%BC%20(%D1%83%D0%BC%D0%BD%D1%8B%D0%B9%2C%20%D1%81%20%D0%B0%D0%B2%D1%82%D0%BE%D0%BE%D0%BF%D1%80%D0%B5%D0%B4%D0%B5%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%D0%BC%20%D1%82%D0%B8%D0%BF%D0%B0)-3.1.user(1).js',
            },
            {
                id: 'liquid-glass',
                title: 'Liquid Glass — редизайн /analyse/free',
                desc: 'Полный визуальный редизайн страницы анализа: liquid-glass интерфейс, интерактивные частицы и выдвижные панели.',
                site: 'CRM · /analyse/free',
                version: '5.4',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20CRM%20%E2%80%94%20Liquid%20Glass%20v5%20(Analyse%20Free%20Redesign)-5.0.user.js',
            },
            {
                id: 'metro-map',
                title: 'Карта метро СПб — записи по станциям',
                desc: 'Карта метро в стиле Студии Лебедева в календаре записей: несколько записей на один слот, слайдер размера, умное удаление, часы 09:00–21:00.',
                site: 'CRM · /admin/record',
                version: '8.2.4',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/CRM%20%E2%80%94%20%D0%9A%D0%B0%D1%80%D1%82%D0%B0%20%D0%BC%D0%B5%D1%82%D1%80%D0%BE%20%D0%A1%D0%9F%D0%B1%20(%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D0%B8%20%D0%BF%D0%BE%20%D1%81%D1%82%D0%B0%D0%BD%D1%86%D0%B8%D1%8F%D0%BC)%20v8-8.2.0.user.js',
            },
            {
                id: 'extend-record',
                title: 'Продлить запись + умное удаление',
                desc: 'Кнопка «Продлить» в окне записи и подтверждение при удалении длинных/похожих записей, чтобы не снести лишнее.',
                site: 'zamena-masla-spot.ru · /admin/record',
                version: '1.0',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/ZMS%20CRM%20%E2%80%94%20%D0%9F%D1%80%D0%BE%D0%B4%D0%BB%D0%B8%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20%2B%20%D0%A3%D0%BC%D0%BD%D0%BE%D0%B5%20%D1%83%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-1.0.user(1).js',
            },
            {
                id: 'copy-record',
                title: 'Копировать запись',
                desc: 'Добавляет кнопку копирования записи прямо на страницу редактирования.',
                site: 'CRM · /admin/record',
                version: '1.1',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/%D0%9A%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C-1.0.user(1).js',
            },
        ],
    },
    {
        id: 'catalogs',
        title: 'Каталоги — копировать 3 артикула',
        scripts: [
            {
                id: 'mann-3',
                title: 'MANN-FILTER — 3 артикула',
                desc: 'Копирует сразу три артикула (воздушный / масляный / салонный) с карточки каталога Mann-Filter в один клик.',
                site: 'mann-filter.com',
                version: '2.2',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/MANN-FILTER-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-2.1.user(2).js',
            },
            {
                id: 'lynx-3',
                title: 'LYNXauto — 3 артикула',
                desc: 'Копирует три ключевых артикула с карточки товара LYNXauto одним нажатием.',
                site: 'lynxauto.info',
                version: '1.1',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/LYNXauto-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-1.1.user(1).js',
            },
            {
                id: 'goodwill-3',
                title: 'GoodWill — 3 артикула',
                desc: 'Копирует три артикула с карточки каталога GoodWill (goodfil.com) в один клик.',
                site: 'goodfil.com',
                version: '1.0',
                url: 'https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/GoodWill-%20%D0%A1%D0%BA%D0%BE%D0%BF%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%82%D1%8C%203%20%D0%B0%D1%80%D1%82%D0%B8%D0%BA%D1%83%D0%BB%D0%B0-1.0.user(1).js',
            },
        ],
    },
];

// Куда ведём за самим Tampermonkey (для мини-гайда, когда расширения ещё нет).
export const TAMPERMONKEY_URL = 'https://www.tampermonkey.net/';
