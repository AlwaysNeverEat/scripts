# Скины — исходники и нарезка

Скин — это пак из четырёх картинок, нарисованных ОДНИМ листом:

| На листе | В сборке | Где на сайте |
|---|---|---|
| длинный кот (голова, долгое ровное туловище, лапы) | `head.webp`, `body.webp`, `feet.webp` | капсула записи на 2+ получаса: голова сверху, туловище плиткой, лапы снизу |
| кот целиком, компактный | `single.webp` | капсула записи на один получас |
| рамка-кольцо с пустой серединой | `frame.webp` | любая аватарка человека |
| широкий баннер 4:1 | `banner.webp` | шапка профиля и строки его звонков в ленте лидов |

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

## Хэллоуин — редкий пак

Пак `halloween` заведён в `SKIN_PACKS` с `ready: false` и весом 2 против 10 у
котика и лисы (≈9% против ≈45%): пока картинки не нарезаны, в кейсы он не
попадает. Пришёл лист — `cut-skin.py <лист> halloween`, снять `ready: false`.

Раскладка та же, что у котика, поэтому резак тот же. На записях вместо кота —
ДЛИННЫЙ ПРИЗРАК: голова сверху, ровная простыня туловищем, волнистый подол
снизу.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is a sticker sheet for a RARE website skin pack called "Spooky Halloween".
Draw exactly FOUR separate objects, each surrounded by at least 60 px of empty
transparent space, nothing touching another object or the canvas edge, no text,
no labels, no watermark, no drop shadows on the background. Every object must be
FULLY OPAQUE — no translucent ghosts, no soft glow fading into the background.

Style: cute-but-spooky kawaii Halloween, clean thick dark outlines, soft flat
shading, sticker style. Palette: pumpkin orange, deep night purple, bone white,
a little toxic green for magic glow. Spooky and special — this is the rare pack.

1) LEFT EDGE, full height of the canvas — "LONG GHOST": a cute ghost seen from the
   front, like the "longcat" meme but a ghost. From top to bottom: round head with
   big black eyes and a tiny smile, a little witch hat or a pumpkin-stem hat, small
   arms holding a tiny jack-o'-lantern under the chin; then a VERY LONG STRAIGHT
   BODY made of a plain bone-white sheet with perfectly parallel vertical sides;
   then a wavy, tattered sheet hem at the very bottom. The body must be plain and
   uniform — no folds, no stripes, no shading changes along its length — so any
   horizontal slice of it looks identical. Object about 170 px wide and about
   940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). A spooky Halloween night: big full moon, a crooked haunted
   house on a hill, a graveyard with a few tilted tombstones, bats, a spider web
   in a corner, a bubbling cauldron with green glow, candles, a black cat in a
   witch hat, carved jack-o'-lanterns. Every element appears ONLY ONCE — no
   repeated, copy-pasted motifs. All the action is on the RIGHT half; the LEFT
   half stays calm (dark purple night sky with a few stars) because text will be
   placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px: a closed circular ring
   made of a twisted pumpkin vine with leaves and tiny curls; a carved
   jack-o'-lantern sits on top of the ring, a cute little skull hangs at the
   bottom, a small bat perches on one side and a candle with a little flame on the
   other. The CENTER is a perfectly EMPTY TRANSPARENT CIRCLE (a profile photo
   goes there); the ring band is thin, about 10–12% of the frame diameter, and the
   ring is closed all the way around.

4) BOTTOM RIGHT — a small cute ghost peeking out of a carved jack-o'-lantern
   (whole object visible), fits in a square of about 320×320 px.
```
