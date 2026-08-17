# Иконки меню игр — исходники

Здесь лежат присланные иконки как есть: пять штук 430×430 RGBA, по одной на
пасхалку. В сборку они не попадают — в `frontend/src/assets/` лежат их копии
256×256, и меню (`frontend/src/games.js`) импортирует именно их.

| Исходник | В сборке | Игра |
|---|---|---|
| `wordle.png` | `assets/game-wordle.png` | Вордле |
| `context.png` | `assets/game-kontekst.png` | Контекстно |
| `sweeper.png` | `assets/game-minesweeper.png` | Сапёр |
| `tetris.png` | `assets/game-tetris.png` | Тетрис |
| `3three.png` | `assets/game-troika.png` | Тройка |

## Почему 256, а не как прислали

На экране иконка не больше 84px, то есть 256 покрывает даже трёхкратную
плотность пикселей с запасом. Исходники весят по 200 КБ штука — мегабайт на
пять иконок в меню, которое открывают раз в неделю поиграть. После пересжатия
получается ~75 КБ, и это уже не жалко: чанк меню грузится только по слову
«игры», в обычной жизни сайта его никто не качает.

## Как пересобрать

ImageMagick и cwebp на сервере нет и не нужно — рядом лежит `resize.mjs`,
одноразовый ресайзер PNG на голом Node (zlib + распаковка/сборка PNG вручную).
Усреднение по площади считается на предумноженной альфе, иначе по краю иконки
проступает ореол из прозрачных, но цветных пикселей.

```bash
cd design/game-icons
node resize.mjs wordle.png  ../../frontend/src/assets/game-wordle.png      256
node resize.mjs context.png ../../frontend/src/assets/game-kontekst.png    256
node resize.mjs sweeper.png ../../frontend/src/assets/game-minesweeper.png 256
node resize.mjs tetris.png  ../../frontend/src/assets/game-tetris.png      256
node resize.mjs 3three.png  ../../frontend/src/assets/game-troika.png      256
```

Скрипт умеет ровно то, что понадобилось: 8-битный RGBA без чересстрочности.
Другой формат он не проглотит и честно об этом скажет.

Позже за ним пришли гербы факультетов (`design/faculty-crests/prepare.mjs`) —
им нужен неквадратный ресайз, — поэтому чтение, запись и усреднение из него
экспортируются. Команды выше от этого не изменились: иконки пересобираются
байт-в-байт как раньше.

Новая игра — новая иконка сюда, копия в `assets/` и строка в `GAMES`
(`frontend/src/games.js`). Сетка меню считает три колонки, шестая иконка
встанет во второй ряд сама.
