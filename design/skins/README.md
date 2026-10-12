# Скины — исходники и нарезка

Скин — это пак из четырёх картинок, нарисованных ОДНИМ листом:

| На листе | В сборке | Где на сайте |
|---|---|---|
| длинный кот (голова, долгое ровное туловище, лапы) | `head.webp`, `body.webp`, `feet.webp` | капсула записи на 2+ получаса: голова сверху, туловище плиткой, лапы снизу |
| кот целиком, компактный | `single.webp` | капсула записи на один получас |
| рамка-кольцо с пустой серединой | `frame.webp` | аватар в профиле |
| широкий баннер 4:1 | `banner.webp` | шапка карточки лида |

Всё ложится в `frontend/src/assets/skins/<пак>/` вместе с `meta.json` (размер
дыры рамки, пропорции кусков кота). Сайт подхватывает файлы **по имени**,
кода править не надо — кроме строки пака в `SKIN_PACKS` (`shared/skins.js`).

Части носятся ВРОЗЬ: рамка от одного пака, баннер от другого, записи
стандартные. Поэтому пак может прийти и не целиком — часть без картинок в
выборе видна, но не нажимается.

## Нарезка

```bash
python3 design/skins/cut-skin.py design/skins/cat/sheet.png cat
```

Нужен Pillow (`pip install pillow`). Резак сам находит четыре предмета как
пятна «не прозрачно» и узнаёт их по форме (самый высокий — длинный кот, самый
широкий — баннер, с дырой — рамка). У длинного кота он сам ищет РОВНОЕ
туловище — самый длинный кусок, где строки не меняются ни шириной, ни
рисунком, — и из его середины делает бесшовную плитку. Поэтому от листа
нужно одно: туловище прямое и однотонное. Не сходится — скрипт падает со
словами, а не кладёт на сайт пустоту.

Присланный лист кладётся рядом (`cat/sheet.png`) — он исходник, по нему
пак пересобирается.

Лист GPT прозрачный, хотя в просмотрщике может выглядеть тёмным с
розовым свечением вокруг предметов: у полностью прозрачных пикселей GPT
оставляет цвет, и не всякий просмотрщик его прячет. Резак поэтому ужимает
картинки на предумноженной альфе — иначе это свечение въехало бы в края
ореолом. И ещё: туловище длинного кота у GPT залито мягким градиентом сверху
вниз — ровным резак считает его по СОСЕДНИМ строкам, а не по сравнению с
серединой.

## Промпт для листа (ChatGPT / GPT-image)

Просить лучше по-английски — раскладку модель держит точнее. Если прозрачного
фона не вышло, резак вычтет сплошной фон по цвету углов, но прозрачный чище.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is a sticker sheet for a website skin pack called "Cute Cat". Draw exactly FOUR
separate objects, each surrounded by at least 60 px of empty transparent space,
nothing touching another object or the canvas edge, no text, no labels, no
watermark, no drop shadows on the background.

Same character in all four: a cute kawaii chibi cat, cream/peach fur, pink nose and
pink inner ears, rosy cheeks, big shiny dark eyes, clean thick dark-brown outlines,
soft flat shading, sticker style, pastel palette.

1) LEFT EDGE, full height of the canvas — "LONGCAT": the same cat seen from the
   front, standing upright like the "longcat" meme, extremely long body. From top
   to bottom: head with ears (front paws tucked right under the chin), then a VERY
   LONG STRAIGHT TORSO with perfectly parallel vertical sides, then hind legs with
   little paws and a tail curling at the bottom. The torso must be plain uniform
   fur — no stripes, no spots, no belly patch, no shading changes along its length —
   so any horizontal slice of it looks identical. Object about 170 px wide and
   about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Soft pastel scene: gentle pink-to-peach gradient. The cat lies
   stretched out cozily on the RIGHT third of the banner. The LEFT two thirds stay
   calm and simple (only the soft gradient and a few tiny faint paw prints or
   sparkles) because text will be placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px: a circular ring (like a
   wreath) in the cat's colors, with two cat ears sticking up from the top of the
   ring and two little front paws holding the bottom of the ring, optionally the
   tail curling around one side. The CENTER is a perfectly EMPTY TRANSPARENT CIRCLE
   (a profile photo goes there); the ring band is thin, about 10–12% of the frame
   diameter, and the ring is closed all the way around.

4) BOTTOM RIGHT — the same cat sitting compactly as a "loaf" (whole body visible,
   tail wrapped around), fits in a square of about 320×320 px.
```

Что проверить в ответе GPT до нарезки: у длинного кота туловище действительно
прямое и однотонное (полоски — главная причина шва), у рамки кольцо замкнуто и
середина пустая, у баннера кот справа, а слева спокойно.
