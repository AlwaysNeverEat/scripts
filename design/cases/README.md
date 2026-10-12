# Кейсы — сундуки, ключ и обложка

Окно кейсов (`frontend/src/cases.js`) подхватывает картинки **по имени файла**
из `frontend/src/assets/cases/`, таблицы соответствия нет:

| Файл | Что это |
|---|---|
| `cover.webp` | обложка над кейсами (заголовок «Кейсы» кладётся поверх, в спокойную середину) |
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
