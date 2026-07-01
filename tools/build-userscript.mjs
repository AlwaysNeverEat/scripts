#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Сборка Tampermonkey-артефактов из userscript/src/* + shared/*.
//
// ВАЖНО: имя выходного файла закреплено — на него указывает @updateURL
// у уже установленных пользователей. Не переименовывать.
//
// Запуск: npm run build:userscript
// ─────────────────────────────────────────────────────────────────────────────

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Патч-номер версии = число коммитов: Tampermonkey видит новую версию после
// каждой пересборки (иначе обновление прайса в shared/ не доедет до людей).
let buildNo = null;
try {
    buildNo = execFileSync('git', ['rev-list', '--count', 'HEAD'],
        { cwd: ROOT, encoding: 'utf8' }).trim();
} catch { /* вне git-репозитория собираем с базовой версией */ }

const TARGETS = [
    {
        entry:  'userscript/src/oil-calculator/app.js',
        header: 'userscript/src/oil-calculator/header.txt',
        out:    'Mann + Motul Oil Calculator-2.12.user.js',
    },
    {
        entry:  'userscript/src/spot-crm-recalc/app.js',
        header: 'userscript/src/spot-crm-recalc/header.txt',
        out:    'SPOT-CRM-Пересчёт-чека-1.0.user.js',
    },
];

for (const t of TARGETS) {
    let header = fs.readFileSync(path.join(ROOT, t.header), 'utf8').trimEnd();
    if (buildNo) header = header.replace(/(@version\s+)([\d.]+)/, `$1$2.${buildNo}`);
    await esbuild.build({
        absWorkingDir: ROOT,
        entryPoints: [t.entry],
        bundle: true,
        format: 'iife',
        charset: 'utf8',
        target: ['es2020'],
        legalComments: 'none',
        banner: { js: header + '\n' },
        outfile: t.out,
    });
    const size = fs.statSync(path.join(ROOT, t.out)).size;
    console.log(`✓ ${t.out} (${(size / 1024).toFixed(0)} KB)`);
}
