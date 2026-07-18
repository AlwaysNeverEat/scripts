// ─────────────────────────────────────────────────────────────────────────────
// Пересчёт мощности двигателя. Метрическая лошадиная сила (PS):
//   1 л.с. = 0.73549875 кВт  ⇒  кВт = л.с. × 0.73549875,  л.с. = кВт ÷ 0.73549875.
// Нужно, чтобы у каждой машины были ОБА поля: источники часто дают только одно.
// ─────────────────────────────────────────────────────────────────────────────

export const KW_PER_PS = 0.73549875;

const asNum = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

export const hpFromKw = (kw) => { const n = asNum(kw); return n == null ? null : Math.round(n / KW_PER_PS); };
export const kwFromHp = (hp) => { const n = asNum(hp); return n == null ? null : Math.round(n * KW_PER_PS); };

// Дополняет пару: если известно хотя бы одно из kw/bhp — возвращает оба
// (недостающее вычисляет). Заданные значения не меняет.
export function completePower(kw, bhp) {
    let k = asNum(kw), b = asNum(bhp);
    if (k != null && b == null) b = hpFromKw(k);
    else if (b != null && k == null) k = kwFromHp(b);
    return { kw: k, bhp: b };
}
