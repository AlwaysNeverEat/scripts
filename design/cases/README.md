# Кейсы — сундуки, ключ и обложка

Окно кейсов (`frontend/src/cases.js`) подхватывает картинки **по имени файла**
из `frontend/src/assets/cases/`, таблицы соответствия нет:

| Файл | Что это |
|---|---|
| `cover.webp` | обложка над кейсами (название сезона — `SEASON` в `shared/cases.js` — кладётся поверх, в спокойную середину) |
| `key.webp` | ключ от большого кейса — в кошельке, на кнопках, в магазине |
| `chest-small.webp`, `chest-small-open.webp` | малый кейс закрытый и открытый |
| `chest-big.webp`, `chest-big-open.webp` | большой кейс закрытый и открытый |

Нет файла — на его месте значок вёрсткой, механика работает без картинок.

## Нарезка

```bash
python3 design/cases/cut-cases.py design/cases/sheet.png
```

Нужен Pillow. Предметы находит тот же код, что режет скины
(`design/skins/cut-skin.py`): обложка — широкий сверху, нижний ряд слева
направо — ключ, малый сундук закрытый и открытый, большой закрытый и открытый.
Открытый сундук подгоняется к закрытому по ширине КОРПУСА (GPT рисует пару
разного размера), и оба ложатся на общий холст по низу и центру — при открытии
откидывается крышка, а не прыгает весь сундук.
Тряска, свечение, вспышка открытия и лучи на экране приза — анимация в
`cases.css`, а не картинка: поэтому в листе свечения вокруг предметов быть не
должно.

Гем — пока тот же камень, что у поддержавших (`assets/badges/supporter-gem.webp`).

## Промпт для листа (ChatGPT / GPT-image)

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is an asset sheet for a cute "loot case" shop on a website. Draw exactly SIX
separate objects, each surrounded by at least 50 px of empty transparent space,
nothing touching another object or the canvas edge. No text, no letters, no
numbers, no labels, no watermark, no drop shadows, NO glow or light rays outside
the objects' outlines (glow and shaking will be animated in code later).

Shared style for everything: kawaii, clean thick dark-brown outlines, soft flat
shading, sticker style, warm autumn palette (orange, amber, gold, cream, a little
pink and deep red), matching a set of chibi cat and fox characters.

TOP — 1) CASE COVER: a wide fully filled rectangle (opaque, square corners), about
   1450×420 px, spanning the top of the canvas. A rich, busy gacha-game banner
   bursting with cute chibi animals in an autumn forest: cats and foxes in front,
   plus squirrels, hedgehogs, raccoons, owls, bunnies peeking from everywhere;
   falling maple leaves, acorns, mushrooms, pumpkins, warm golden sunset light,
   sparkles and small treasure chests and keys hidden in the scene. Dense,
   colorful, festive, joyful — every corner has something cute. Keep the very
   center a bit calmer (soft light, fewer details) because a title will be placed
   there.

BOTTOM ROW, left to right, each object about 230–260 px:
2) KEY — a single ornate golden key, the bow shaped like a cat face with fox ears,
   a tiny maple leaf charm hanging from it, drawn diagonally.
3) SMALL CHEST, CLOSED — a small cute wooden treasure chest with golden corners
   and a paw-print emblem on the lock.
4) SMALL CHEST, OPEN — exactly the same small chest with the lid open; soft warm
   light and a few sparkles INSIDE the chest only.
5) BIG CHEST, CLOSED — a larger, fancier treasure chest: deep red and gold, cat
   ears and fox ears on the lid corners, a big golden keyhole in the front, maple
   leaf ornaments.
6) BIG CHEST, OPEN — exactly the same big chest with the lid open; bright golden
   light and sparkles INSIDE the chest only.

The closed and open versions of each chest must match exactly in size, angle,
colors and position of details — only the lid differs.
```

Открытый и закрытый сундук обязаны совпадать во всём, кроме крышки: при
открытии картинка подменяется на месте, и любой сдвиг читается как «прыгнуло».

## Зима — «Холодрыжество»

Картинки сезона лежат в `assets/cases/winter-cold/` и перекрывают общие
только зимой; чего там нет — берётся общее (осеннее). Режется тем же резаком
со вторым аргументом:

```bash
python3 design/cases/cut-cases.py design/cases/winter-sheet.png winter-cold
```

Раскладка листа та же, что осенью: обложка сверху, внизу слева направо ключ,
малый закрытый и открытый, большой закрытый и открытый. Название НАПИСАНО НА
САМОЙ обложке (`titleOnCover: false` в `SEASONS`), сайт поверх ничего не
кладёт — поэтому проверить по буквам: GPT в кириллице путает и пропускает
буквы, «ХОЛОДРЫЖЕСТВО» с ошибкой — перегенерировать.

Персонажей паков (Гринч, Саб-Зиро, Гарри Поттер…) на обложку не просим: на
чужих героях GPT часто отказывает целиком, и лист не получится вовсе. На
обложке — свои зимние чиби.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is an asset sheet for a cute WINTER "loot case" shop on a website. Draw exactly
SIX separate objects, each surrounded by at least 50 px of empty transparent space,
nothing touching another object or the canvas edge. No watermark, no drop shadows,
NO glow, snow or light rays outside the objects' outlines (glow and shaking will be
animated in code later). The ONLY text in the whole image is the title on the
cover (object 1); objects 2–6 have no text, letters or numbers at all.

Shared style for everything: kawaii, clean thick dark-navy outlines, soft flat
shading, sticker style, frosty winter palette (icy blue, white, silver, deep navy)
with warm accents (cranberry red, gold, a little warm orange from garlands).

TOP — 1) CASE COVER: a wide fully filled rectangle (opaque, square corners), about
   1450×420 px, spanning the top of the canvas. A rich, busy gacha-game banner of
   a snowy winter night: cute chibi snowmen, reindeer, snowy owls, penguins, polar
   foxes and bunnies in scarves and knitted hats, sledding, throwing snowballs,
   drinking hot cocoa; snowy fir trees with garlands, a frozen lake, gift boxes,
   falling snowflakes, northern lights in the sky, small treasure chests and keys
   hidden in the scene. Dense, colorful, festive, joyful.
   In the CENTER, big and bold, the title written in RUSSIAN, exactly:
   ХОЛОДРЫЖЕСТВО
   — one word, Cyrillic capitals, every letter exactly as given, nothing added.
   Chunky, playful game-logo lettering made of ice and snow: icy-blue letters with
   white snow caps on top, small icicles hanging below, a dark-navy outline and a
   soft frosty inner highlight, so it reads clearly over the busy scene. The title
   fits fully inside the banner with margin on both sides.

BOTTOM ROW, left to right, each object about 230–260 px:
2) KEY — a single ornate silver-and-ice key, the bow shaped like a big snowflake
   with a tiny red knitted scarf tied around it, drawn diagonally.
3) SMALL CHEST, CLOSED — a small cute wooden treasure chest covered with a cap of
   snow on the lid, frosty silver corners, little icicles on the front edge and a
   snowflake emblem on the lock.
4) SMALL CHEST, OPEN — exactly the same small chest with the lid open; soft icy
   blue light and a few sparkles INSIDE the chest only.
5) BIG CHEST, CLOSED — a larger, fancier treasure chest made of blue ice and
   silver, with a thick snow cap on the lid, a cranberry-red ribbon and bow like a
   gift, a big golden keyhole in the front and snowflake ornaments.
6) BIG CHEST, OPEN — exactly the same big chest with the lid open; bright icy
   light and sparkles INSIDE the chest only.

The closed and open versions of each chest must match exactly in size, angle,
colors and position of details — only the lid differs (the snow cap stays on the
lid and moves with it).
```

Что проверить до нарезки: надпись ровно «ХОЛОДРЫЖЕСТВО», без лишних букв и
без второй строки; на ключе и сундуках нет букв; снег и свечение не выходят
за контур предметов — иначе резак склеит их с фоном.
