// ─────────────────────────────────────────────────────────────────────────────
// Префиксы классов, у которых ОДИН хозяин.
//
// Стили всех разделов лежат в одном документе: кейсы грузятся вместе с
// профилем, «Клиент» — вместе с сайтом, и одинаковый класс в двух файлах
// молча перебивает один другим. Так уже было: первые кейсы жили на префиксе
// «cs-», и их .cs-bar (полоска опыта в 8px) сплющил строку поиска «Клиента»,
// а .cs-card сломал его карточку. В песочницах этого не видно — там грузятся
// стили одного раздела.
//
// Тест держит простое правило: класс с префиксом хозяина объявляет только
// файл хозяина. Новый раздел со своим префиксом — строка в OWNERS.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OWNERS = {
    'cs-': 'clientSearch.css',
    'kc-': 'cases.css',
    'qt-': 'quests.css',
    'tr-': 'trades.css',
};

function cssFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return d.name === 'assets' ? [] : cssFiles(p);
        return d.name.endsWith('.css') ? [p] : [];
    });
}

test('класс с чужим префиксом не объявляется в других файлах', () => {
    const bad = [];
    for (const file of cssFiles(SRC)) {
        const name = path.basename(file);
        // Комментарии вон: в них префиксы упоминаются словами.
        const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [prefix, owner] of Object.entries(OWNERS)) {
            if (name === owner) continue;
            const hits = css.match(new RegExp(`\\.${prefix}[\\w-]+`, 'g'));
            if (hits) bad.push(`${name}: ${[...new Set(hits)].join(', ')} — префикс «${prefix}» принадлежит ${owner}`);
        }
    }
    assert.deepEqual(bad, []);
});
