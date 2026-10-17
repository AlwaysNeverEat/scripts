// ─────────────────────────────────────────────────────────────────────────────
// Выбранный лид — мостик между вкладками «Лиды» и «Записи».
//
// Звонок → карточка лида → запись: по этой цепочке оператор раньше
// перепечатывал имя и телефон из одной вкладки в другую. Теперь «Лиды»
// кладут сюда открытую карточку (кто и с какого номера), а окно создания
// записи берёт её и заполняет поля само: имя с заглушкой «двс» после него
// и телефон.
//
// Модуль общий для обоих чанков (vite отдаёт один экземпляр), хранит ОДНО
// значение в памяти вкладки — без localStorage: лид, выбранный вчера или в
// другой вкладке браузера, к сегодняшней записи отношения не имеет.
//
// У выбора есть срок (LEAD_FILL_TTL_MS от последнего касания карточки):
// звонок превращается в запись за минуты, а через час после лида оператор
// почти наверняка записывает уже кого-то другого — подставить ему
// утреннего клиента значит заставить стирать чужое имя.
// ─────────────────────────────────────────────────────────────────────────────

import { formatRuPhone } from '../../shared/crmRecords.js';

export const LEAD_FILL_TTL_MS = 30 * 60 * 1000;
// Заглушка услуги после имени — так имя записи пишут руками («Иван двс»).
export const SERVICE_STUB = 'двс';

let picked = null; // { name, phone, at }

// «Лиды» сообщают, какая карточка открыта; null — никакая.
export function setPickedLead(lead, now = Date.now()) {
    const phone = String(lead?.phone || '').replace(/\D/g, '');
    const name = String(lead?.name || '').replace(/\s+/g, ' ').trim();
    picked = lead && (phone || name) ? { name, phone, at: now } : null;
}

// Работа с лидом в другой вкладке (привязали машину в калькуляторе) — то же
// касание карточки: срок выбора отсчитывается заново.
export function touchPickedLead(now = Date.now()) {
    if (picked && now - picked.at <= LEAD_FILL_TTL_MS) picked.at = now;
}

export function pickedLead(now = Date.now()) {
    if (!picked || now - picked.at > LEAD_FILL_TTL_MS) return null;
    return picked;
}

// Что подставить в окно создания записи. Телефон — в маске поля
// («+7 (931) 204-71-01»), имя — с заглушкой услуги; имени нет — одна
// заглушка, её всё равно дописывают.
export function leadFill(lead) {
    if (!lead) return null;
    const name = [lead.name, SERVICE_STUB].filter(Boolean).join(' ');
    return { name, phone: lead.phone ? formatRuPhone(lead.phone) : '', leadName: lead.name || '' };
}

// ── Машины лида (привязки — leadCars.js, /api/lead-cars) ─────────────────────

// «Kia Rio» — так машину пишут в комментарии записи: кратко, марка и модель,
// без поколения и мотора (их видно, открыв машину из карточки лида).
export function carShort(car) {
    return [car?.brand, car?.model].map(s => String(s || '').trim()).filter(Boolean).join(' ');
}

// Комментарий новой записи из привязанных машин. Две одинаковые модели
// (две Kia Rio разных поколений) пишутся один раз — в комментарии они
// неотличимы, а повтор читался бы как опечатка.
export function leadComment(cars) {
    return [...new Set((cars || []).map(carShort).filter(Boolean))].join(', ');
}
