// ─────────────────────────────────────────────────────────────────────────────
// Граница, ради которой пользователю отдан ТОЛЬКО ТОН.
//
// Акцент выбирает человек, а надпись на кнопке пишем мы: --accent-fg почти
// чёрный в тёмной теме и белый в светлой. Держится это на том, что СВЕТЛОТА И
// НАСЫЩЕННОСТЬ акцента остаются нашими и не зависят от выбора. Проверяем ровно
// это: НИ ОДИН из 360 тонов не роняет контраст надписи ниже WCAG AA (4.5:1).
//
// Числа берутся ИЗ style.css, а не переписаны сюда: иначе тест проверял бы
// свою копию, а живая тема тем временем уехала бы. Правка светлоты «на глаз»
// обязана ронять этот тест, а не молча портить кнопки.
// ─────────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'style.css'), 'utf8');

// «--accent: oklch(0.80 0.17 var(--accent-hh));» → { l: 0.8, c: 0.17 }
function accentLC(afterMarker) {
    const from = afterMarker ? css.indexOf(afterMarker) : 0;
    assert.notEqual(from, -1, `в style.css нет блока ${afterMarker}`);
    const m = /--accent:\s*oklch\(([\d.]+)\s+([\d.]+)\s+var\(--accent-hh\)\)/.exec(css.slice(from));
    assert.ok(m, `не нашёл --accent после ${afterMarker || 'начала файла'}`);
    return { l: Number(m[1]), c: Number(m[2]) };
}

// «--accent-fg: oklch(0.12 0.02 252);» — чернила поверх акцента.
function accentFg(afterMarker) {
    const from = afterMarker ? css.indexOf(afterMarker) : 0;
    const m = /--accent-fg:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(css.slice(from));
    assert.ok(m, `не нашёл --accent-fg после ${afterMarker || 'начала файла'}`);
    return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

// ── oklch → sRGB ────────────────────────────────────────────────────────────
// Тот же путь, которым идёт браузер: OKLab → линейный sRGB → гамма. Выход за
// охват просто зажимается в 0…1 — браузер приводит цвет умнее (убавляет
// насыщенность, сохраняя светлоту), и это делает его результат СВЕТЛЕЕ нашего,
// то есть контраст с тёмными чернилами у него выше, а с белыми ниже. Разница
// на наших светлотах — доли процента, и порог 4.5 берётся с запасом.
function oklchToRgb({ l, c, h }) {
    const hr = (h * Math.PI) / 180;
    const a = c * Math.cos(hr);
    const b = c * Math.sin(hr);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const lin = [
        +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    ];
    return lin.map(v => Math.min(1, Math.max(0, v)));
}

// Относительная яркость WCAG считается по ЛИНЕЙНЫМ каналам — гамма-коррекция
// и обратное преобразование сократились бы, поэтому её тут просто нет.
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(colorA, colorB) {
    const l1 = luminance(oklchToRgb(colorA));
    const l2 = luminance(oklchToRgb(colorB));
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

for (const [name, marker] of [['тёмная', null], ['светлая', ':root[data-theme="light"]']]) {
    test(`${name} тема: надпись на акценте читается при ЛЮБОМ тоне`, () => {
        const { l, c } = accentLC(marker);
        const fg = accentFg(marker);

        let worst = { ratio: Infinity, hue: null };
        for (let hue = 0; hue < 360; hue++) {
            const ratio = contrast({ l, c, h: hue }, fg);
            if (ratio < worst.ratio) worst = { ratio, hue };
        }

        assert.ok(
            worst.ratio >= AA,
            `тон ${worst.hue}° даёт ${worst.ratio.toFixed(2)}:1 — ниже AA (${AA}:1). `
            + `Светлота акцента (${l}) выбрана так, чтобы этого не случалось ни при каком тоне; `
            + `если её меняли — меняйте вместе с --accent-fg.`,
        );
    });
}

test('акцент считается от одного тона, а не задан цветом', () => {
    // Если кто-то впишет в --accent готовый градус вместо var(--accent-hh),
    // ручка пользователя молча перестанет работать в этой теме.
    const uses = css.match(/--accent:\s*oklch\([^)]*var\(--accent-hh\)\)/g) || [];
    assert.equal(uses.length, 2, 'ожидалось по одному --accent на тему, оба от var(--accent-hh)');
});
