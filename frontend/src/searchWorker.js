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

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'snapshot') {
        prepared = prepareCars(msg.cars || []);
        self.postMessage({ type: 'ready', version: msg.version });
    } else if (msg.type === 'query') {
        // _search (Set-ы) и search_text наружу не отдаём — карточкам они не нужны,
        // а клонировать их через postMessage дорого.
        const cars = rankCars(msg.q, prepared)
            .map(({ _search, search_text, ...car }) => car);
        self.postMessage({ type: 'results', gen: msg.gen, q: msg.q, cars });
    }
};
