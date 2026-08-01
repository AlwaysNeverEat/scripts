// Поиск в отдельном потоке. Главный поток присылает сырой снимок базы и
// запросы; здесь один раз на снимок делаем prepareCars (search_text + триграммы)
// и на каждый запрос — rankCars. Скоринг ~15к машин больше не трогает главный
// поток, поэтому ввод не фризит даже на слабых машинах.
//
// Протокол:
//   main → worker: {type:'snapshot', version, cars}  — сырые машины из /api/cars/index
//   main → worker: {type:'query', q, gen}            — gen: счётчик поколений ввода
//   worker → main: {type:'ready', version}           — снимок подготовлен
//   worker → main: {type:'results', gen, q, cars}    — cars без служебных полей
import { prepareCars, rankCars } from '../../shared/carSearch.js';

let prepared = [];
let preparedVersion = null;

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'snapshot') {
        // Тот же снимок, что уже подготовлен, не пересобираем: на телефоне это
        // был бы лишний пик памяти на ровном месте (см. ниже).
        if (msg.version != null && msg.version === preparedVersion) {
            self.postMessage({ type: 'ready', version: msg.version });
            return;
        }
        // Старый снимок отпускаем ДО сборки нового: иначе в пике живут оба
        // (~26 МБ на 13к машин), и мобильный браузер выгружает вкладку — со
        // стороны это выглядит как «сайт сам перезагрузился».
        prepared = [];
        preparedVersion = null;
        prepared = prepareCars(msg.cars || []);
        preparedVersion = msg.version ?? null;
        self.postMessage({ type: 'ready', version: msg.version });
    } else if (msg.type === 'query') {
        // _search (словарь + типизированные массивы) наружу не отдаём —
        // карточкам он не нужен, а клонировать его через postMessage дорого.
        const cars = rankCars(msg.q, prepared)
            .map(({ _search, search_text, ...car }) => car);
        self.postMessage({ type: 'results', gen: msg.gen, q: msg.q, cars });
    }
};
