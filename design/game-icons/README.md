# Иконки меню игр — исходники

Здесь лежат присланные иконки как есть: одиннадцать штук 430×430 RGBA, по одной
на пасхалку. В сборку они не попадают — в `frontend/src/assets/` лежат их копии
256×256, и меню (`frontend/src/games.js`) импортирует именно их.

| Исходник | В сборке | Игра |
|---|---|---|
| `wordle.png` | `assets/game-wordle.png` | Вордле |
| `context.png` | `assets/game-kontekst.png` | Контекстно |
| `sweeper.png` | `assets/game-minesweeper.png` | Сапёр |
| `tetris.png` | `assets/game-tetris.png` | Тетрис |
| `3three.png` | `assets/game-troika.png` | Тройка |
| `solitaire.png` | `assets/game-solitaire.png` | Пасьянс |
| `pool.png` | `assets/game-pool.png` | Бильярд |
| `durak.png` | `assets/game-durak.png` | Дурак |
| `roguelike.png` | `assets/game-roguelike.png` | Рогалик |
| `battleship.png` | `assets/game-battleship.png` | Морской бой |
| `mahjong.png` | `assets/game-mahjong.png` | Маджонг |

Одиннадцатая (маджонг) приехала отдельно и ВДВОЕ КРУПНЕЕ остальных — квадрат
1254×1254 на два мегабайта, — и лежит здесь уже приведённой к общему виду:
уменьшенной до 430 и с телом, вписанным в те же 401. Иначе в сетке меню она
оказалась бы заметно мельче соседей (её тело занимало 371×347 из 430) и съехала
бы вверх, а в git ушли бы два мегабайта ради картинки, которую показывают в 84
пикселя.

Вторая пятёрка приехала ОДНИМ листом JPEG — пять плиток в ряд на белом фоне, —
и лежит здесь уже разрезанной и с прозрачным фоном: плитки вырезаны по границе
белого построчно (маска считалась в четырёхкратном размере, чтобы край не
получился ступеньками), а не скруглённым прямоугольником поверх — форма плиток
ближе к суперэллипсу, и промах в пару пикселей виден как срезанный угол. Тело
плитки вписано в те же 401 из 430, что и у первой пятёрки, иначе в сетке меню
новые иконки оказались бы крупнее старых. Весят они чуть больше первых (90–110 КБ
против 75) — исходник был JPEG, и его шум PNG честно хранит.

## Почему 256, а не как прислали

На экране иконка не больше 84px, то есть 256 покрывает даже трёхкратную
плотность пикселей с запасом. Исходники весят по 200 КБ штука — два мегабайта на
десять иконок в меню, которое открывают раз в неделю поиграть. После пересжатия
получается 75–110 КБ, и это уже не жалко: чанк меню грузится только по слову
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
node resize.mjs solitaire.png  ../../frontend/src/assets/game-solitaire.png  256
node resize.mjs pool.png       ../../frontend/src/assets/game-pool.png       256
node resize.mjs durak.png      ../../frontend/src/assets/game-durak.png      256
node resize.mjs roguelike.png  ../../frontend/src/assets/game-roguelike.png  256
node resize.mjs battleship.png ../../frontend/src/assets/game-battleship.png 256
node resize.mjs mahjong.png    ../../frontend/src/assets/game-mahjong.png    256
```

Скрипт умеет ровно то, что понадобилось: 8-битный RGBA без чересстрочности.
Другой формат он не проглотит и честно об этом скажет.

Позже за ним пришли гербы факультетов (`design/faculty-crests/prepare.mjs`) —
им нужен неквадратный ресайз, — поэтому чтение, запись и усреднение из него
экспортируются. Команды выше от этого не изменились: иконки пересобираются
байт-в-байт как раньше.

Новая игра — новая иконка сюда, копия в `assets/` и строка в `GAMES`
(`frontend/src/games.js`). Сетка меню считает три колонки, следующая иконка
встанет в новый ряд сама.
