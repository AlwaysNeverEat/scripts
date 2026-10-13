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

Пак `halloween` в `SKIN_PACKS` с весом 2 против 10 у котика и лисы (≈9%
против ≈45%), лист — `halloween/sheet.png`. Пока у пака нет картинок, он
стоит с `ready: false` и в кейсы не попадает — так новые паки и заводятся.

На этом листе тыква рамки почти касалась низа баннера, и запас, которым резак
собирает предмет из кусочков, сшивал их в один. Теперь резак в таком случае
пробует строже (`find_items`), пока не найдёт ровно нужное число предметов.

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

## Енотик — обычный пак

Раскладка та же, что у котика и лисы, резак тот же. Енот уже есть на обложке
«Осеннего кавая» — пак лежит в осеннем сезоне как обычный (вес 10, как
котик и лиса), лист — `raccoon/sheet.png`.

У этого листа альфа предметов 253–254, а не 255 (GPT так отдал), — резаку
это не мешает: он смотрит на порог `SOLID`, а не на «полностью непрозрачно».

У енота одна ловушка: полосатый хвост и маска так и просят полосок по всему
телу, а туловище длинного енота обязано быть однотонным — полоски по длине
дают шов на каждой плитке. Поэтому в промпте полоски только на хвосте, а хвост
внизу.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is a sticker sheet for a website skin pack called "Cute Raccoon". Draw exactly
FOUR separate objects, each surrounded by at least 60 px of empty transparent
space, nothing touching another object or the canvas edge, no text, no labels,
no watermark, no drop shadows on the background. Every object FULLY OPAQUE with
clean edges — no soft glow fading into the background.

Same character in all four: a cute kawaii chibi raccoon — soft grey fur, a dark
"bandit mask" around big shiny eyes, white muzzle and white eyebrow marks, small
round ears with light insides, pink nose, rosy cheeks, clean thick dark outlines,
soft flat shading, sticker style, cozy autumn palette (grey, cream, warm orange
leaf accents).

1) LEFT EDGE, full height of the canvas — "LONG RACCOON": the raccoon seen from
   the front, standing upright like the "longcat" meme, extremely long body.
   From top to bottom: head with ears and the mask (front paws holding a tiny
   acorn right under the chin), then a VERY LONG STRAIGHT TORSO with perfectly
   parallel vertical sides, then hind legs with little dark paws and the
   striped ringed tail curling at the bottom. The torso must be PLAIN UNIFORM
   GREY FUR — no stripes, no rings, no belly patch, no shading changes along
   its length — so any horizontal slice of it looks identical. Stripes exist
   ONLY on the tail. Object about 170 px wide and about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Cozy autumn forest at golden hour: the raccoon peeks out of
   a hollow tree log on the RIGHT third, surrounded by a few fallen maple
   leaves, acorns and a small mushroom. The LEFT two thirds stay calm and simple
   (soft warm-to-grey gradient, at most a couple of tiny falling leaves)
   because text will be placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px: a closed circular ring
   woven from autumn twigs and small maple leaves in orange and red; the
   raccoon's ears and masked eyes peek over the top of the ring, two little dark
   paws hold the bottom, and the striped tail curls around one side. The CENTER
   is a perfectly EMPTY TRANSPARENT CIRCLE (a profile photo goes there); the
   ring band is thin, about 10–12% of the frame diameter, and the ring is closed
   all the way around.

4) BOTTOM RIGHT — the same raccoon sitting compactly, hugging its fluffy striped
   tail and holding an acorn (whole body visible), fits in a square of about
   320×320 px.
```

Что проверить до нарезки: туловище длинного енота однотонное (полоски только
на хвосте), кольцо рамки замкнуто и середина пустая, фон ПРАВДА прозрачный —
у листов заданий GPT рисовал клетку прямо в картинке, и резак скинов (он ищет
предметы по альфе) на таком листе ничего не найдёт.

## Зайчик — обычный пак

Раскладка та же, резак тот же; зайцы тоже есть на обложке «Осеннего кавая».
Пак обычный (вес 10), лист — `bunny/sheet.png`.

На записях заяц заметно уже енота, и это не поломка: ширина полосы
считается так, чтобы голова и лапы вместе влезли в запись на час, а голова
у зайца с ушами почти вдвое выше своей ширины (`strip.head` 1,86 против
1,15 у енота).
Ловушки у зайца две, и обе в промпте: длинные уши (у рамки они выше кольца и
не должны его разрывать, у длинного зайца — не уходить за край листа) и
пушистый хвостик-помпон, который хочется посадить на туловище — тогда плитка
туловища повторяет его через каждые полкапсулы. Поэтому хвостик — только у
сидящего зайца, а у длинного — внизу, у лап.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is a sticker sheet for a website skin pack called "Cute Bunny". Draw exactly
FOUR separate objects, each surrounded by at least 60 px of empty transparent
space, nothing touching another object or the canvas edge, no text, no labels,
no watermark, no drop shadows on the background. Every object FULLY OPAQUE with
clean edges — no soft glow fading into the background.

Same character in all four: a cute kawaii chibi bunny — soft cream-white fur
with light warm-beige patches, long upright ears with pink insides, big shiny
dark eyes, tiny pink nose, rosy cheeks, clean thick dark-brown outlines, soft
flat shading, sticker style, cozy autumn palette (cream, beige, warm orange
leaf accents).

1) LEFT EDGE, full height of the canvas — "LONG BUNNY": the bunny seen from
   the front, standing upright like the "longcat" meme, extremely long body.
   From top to bottom: head with the long ears fully inside the canvas (front
   paws holding a small carrot right under the chin), then a VERY LONG
   STRAIGHT TORSO with perfectly parallel vertical sides, then hind legs with
   big soft feet and a round fluffy pom-pom tail peeking out at the very
   bottom. The torso must be PLAIN UNIFORM CREAM FUR — no patches, no belly
   spot, no tail on it, no shading changes along its length — so any
   horizontal slice of it looks identical. Object about 170 px wide and about
   940 px tall, ears included.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). A cozy autumn meadow at golden hour: the bunny sits on the
   RIGHT third among fallen maple leaves, next to a small pumpkin and a couple
   of carrots, ears up. The LEFT two thirds stay calm and simple (soft
   warm-to-cream gradient, at most a couple of tiny falling leaves) because
   text will be placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px: a closed circular ring
   woven from autumn twigs, small maple leaves and a few tiny carrots; the
   bunny's head and long ears peek over the top of the ring (the ears stand up
   ABOVE the ring and do not break it), two little paws hold the bottom. The
   CENTER is a perfectly EMPTY TRANSPARENT CIRCLE (a profile photo goes there);
   the ring band is thin, about 10–12% of the frame diameter, and the ring is
   closed all the way around.

4) BOTTOM RIGHT — the same bunny sitting compactly as a round ball of fluff,
   hugging a carrot, pom-pom tail visible (whole body visible), fits in a
   square of about 320×320 px.
```

Что проверить до нарезки: уши длинного зайца целиком в листе, туловище
однотонное (ни пятен, ни хвостика на нём), кольцо рамки замкнуто под ушами,
фон прозрачный.

## Матиз курьера — легендарка

Пак `matiz` в `SKIN_PACKS` (`tier: 'legendary'`, вес 1), лист —
`matiz/sheet.png`. Этот лист GPT отдал НЕПРОЗРАЧНЫМ (клетка нарисована в RGB,
и сквозь стёкла машины — тоже), поэтому нарезка в два шага:

```bash
python3 design/skins/matiz/prep-sheet.py          # клетка → альфа, стёкла тонируются
python3 design/skins/cut-skin.py design/skins/matiz/sheet-alpha.png matiz --rough
```

`prep-sheet.py` пишет `sheet-alpha.png` (в git не лежит — собирается из
`sheet.png`); стёкла в нём заданы многоугольниками именно этого листа.
`--rough` поднимает допуск резака на «ровное туловище»: у реалистичного
короба фактура ткани, и соседние строки рябят сильнее, чем у мультяшного
кота.

Первый заход провалился, и по вине промпта: мультяшный стиль и запрет
логотипов дали «какую-то жёлтую машинку», а длинный Матиз ВИДОМ СВЕРХУ
читался как автобус — сверху у любой жёлтой машины одна и та же крыша. Этот
пак держится на узнаваемости, поэтому второй промпт — реализм, настоящий
Daewoo Matiz первого поколения и брендированный короб «Яндекс Еды».

Раскладка частей поменялась под узнаваемость:

- **записи** — Матиз СПЕРЕДИ внизу (это «лапы»), а на крыше у него башня
  термокоробов: верхний короб с логотипом — «голова», ровная жёлтая стенка
  короба — «туловище». На длинной записи растёт короб, а не машина, и Матиз
  узнаётся на любой длине. Логотип только на верхнем коробе — туловище обязано
  быть однотонным, иначе плитка повторяла бы надпись через каждые полкапсулы;
- **рамка** — КОЛЕСО Матиза (шина с диском), а не руль: у руля спицы ложатся
  поверх аватарки, а у колеса середина — это и есть дыра диска;
- шапка и машина на одну запись — Матиз с коробом, как есть.

Если GPT откажется рисовать чужой логотип или напишет его кривыми буквами —
переспросить тем же промптом; надпись на коробе тут половина шутки.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background
(real alpha transparency, NOT a drawn checkerboard). It is an asset sheet for a
LEGENDARY skin pack of an internal company website: "Yandex Eda courier on a
Daewoo Matiz". Draw exactly FOUR separate objects, each surrounded by at least
60 px of empty transparent space, nothing touching another object or the canvas
edge. No watermark. Every object FULLY OPAQUE with clean edges — no soft glow
fading into the background.

Style: REALISTIC, high-detail semi-photoreal digital painting / 3D render, real
proportions, real materials (car paint reflections, rubber, insulated fabric).
NOT cartoon, NOT chibi, NOT kawaii, no faces on the car.

The car: a real first-generation Daewoo Matiz (1998–2008): tiny 5-door city
hatchback, tall rounded "bubble" body, big round-oval headlights, small grille
with the Daewoo badge, black plastic bumpers, steel wheels. Color: faded
silver-grey or white, a little worn — a typical courier's car.
The delivery box: the bright Yandex Eda yellow (#FCE000) insulated courier box
with the black "Яндекс Еда" wordmark printed on it, exactly like the real
Yandex Eda courier backpacks.

1) LEFT EDGE, full height of the canvas — "TOWER OF ORDERS": a very tall stack
   made of ONE extremely tall Yandex Eda insulated box standing on the roof rack
   of the Matiz. From top to bottom: the top of the box with its handle and the
   "Яндекс Еда" wordmark; then a VERY LONG STRAIGHT plain yellow box wall with
   perfectly parallel vertical sides — PLAIN UNIFORM YELLOW FABRIC, no text, no
   seams, no straps, no shading changes along its length, so any horizontal
   slice of it looks identical; then at the very bottom the Matiz seen strictly
   FROM THE FRONT (headlights, grille, bumper, wheels), carrying the box on its
   roof. The car is exactly as wide as the box or slightly wider. Object about
   180 px wide and about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). A rainy Russian city at night: wet asphalt reflecting
   street lights and shop signs, the Matiz with a Yandex Eda box on the roof
   rack drives toward the viewer on the RIGHT third, headlights on, a courier
   in a yellow Yandex Eda jacket at the wheel. The LEFT two thirds stay calm and
   dark (blurred night city lights) because text will be placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px: a Matiz WHEEL seen
   straight from the side — a black tire with visible tread and a thin steel
   rim ring, with a small Yandex Eda yellow sticker on the tire sidewall. The
   whole CENTER of the wheel (where the hub and disc would be) is a perfectly
   EMPTY TRANSPARENT CIRCLE — no hub, no bolts, no spokes; a profile photo goes
   there. The tire band is about 12–14% of the frame diameter and closed all
   the way around.

4) BOTTOM RIGHT — the same Matiz in a three-quarter front view with a Yandex Eda
   box strapped to the roof rack (whole car visible), fits in a square of about
   340×340 px.
```

Что проверить до нарезки: Матиз узнаётся (круглые фары, «пузатый» кузов), на
верхнем коробе и на баннере есть «Яндекс Еда», туловище башни однотонное без
надписей и швов, у колеса пустая середина без ступицы, фон по-настоящему
прозрачный.
