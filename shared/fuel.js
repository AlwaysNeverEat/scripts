// ─────────────────────────────────────────────────────────────────────────────
// Топливо: единая точка правды для сайта и юзерскрипта.
// В базе fuel_type хранится кодом Mann (01=бензин, 02=бензин+газ, 05/06=дизель)
// либо свободным текстом («Дизель» с Ravenol). Всё нераспознанное считаем
// «не указано» — раньше оно молча показывалось как бензин, из-за чего
// дизельные машины уходили в базу и в подбор масла как бензиновые.
// ─────────────────────────────────────────────────────────────────────────────

export const FUEL_OPTIONS = [
    { code: '',   label: 'не указано' },
    { code: '01', label: 'бензин' },
    { code: '02', label: 'бензин + газ' },
    { code: '05', label: 'дизель' },
];

const DIESEL_CODES = new Set(['05', '06']);
const PETROL_CODES = new Set(['01', '02', '04']);

export function isDieselFuel(fuelType) {
    const ft = String(fuelType == null ? '' : fuelType).trim();
    return DIESEL_CODES.has(ft) || /дизел|diesel/i.test(ft);
}

export function isPetrolFuel(fuelType) {
    const ft = String(fuelType == null ? '' : fuelType).trim();
    return PETROL_CODES.has(ft) || /бензин|petrol|gasol|этанол|ethanol|\bгаз\b|lpg|cng/i.test(ft);
}

// Приводит любое значение к коду для селекта/базы: '01' | '02' | '05' | ''.
export function normalizeFuelCode(fuelType) {
    const ft = String(fuelType == null ? '' : fuelType).trim();
    if (isDieselFuel(ft)) return '05';
    if (ft === '02' || /газ|lpg|cng/i.test(ft)) return '02';
    if (isPetrolFuel(ft)) return '01';
    return '';
}

// Человекочитаемая подпись. Нераспознанный код показываем как есть со знаком
// вопроса — чтобы его исправили, а не принимали за бензин. Результат вставляют
// в innerHTML, поэтому сырое значение экранируем здесь же.
export function fuelLabel(fuelType) {
    const ft = String(fuelType == null ? '' : fuelType).trim();
    if (!ft) return '';
    if (isDieselFuel(ft)) return 'дизель';
    if (ft === '02') return 'бензин + газ';
    if (isPetrolFuel(ft)) return 'бензин';
    const safe = ft.replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    return `топливо: ${safe}?`;
}

// <option> для селекта топлива; текущее значение приводится к коду.
export function fuelSelectOptions(current) {
    const cur = normalizeFuelCode(current);
    return FUEL_OPTIONS.map(o =>
        `<option value="${o.code}"${o.code === cur ? ' selected' : ''}>${o.label}</option>`
    ).join('');
}
