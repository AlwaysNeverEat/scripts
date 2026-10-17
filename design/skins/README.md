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

## Снеговик — обычный пак зимы

Первый пак «Холодрыжества» (`SEASONS` в `shared/cases.js`), лист —
`snowman/sheet.png`, раскладка и резак — как у енота. Ловушка та же, что у
полосок енота: пуговицы и угольки по всему туловищу дают шов на каждой
плитке длинного снеговика. Поэтому пуговицы только в верхнем куске, под шарфом,
а туловище — ровный снег.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is a sticker sheet for a website skin pack called "Cute Snowman". Draw exactly
FOUR separate objects, each surrounded by at least 60 px of empty transparent
space, nothing touching another object or the canvas edge, no text, no labels,
no watermark, no drop shadows on the background. Every object FULLY OPAQUE with
clean edges — no soft glow, falling snow or sparkles fading into the background.

Same character in all four: a cute kawaii chibi snowman — round snowy head with
a carrot nose, coal-dot eyes that are big and shiny, rosy cheeks, a small smile,
a red-and-white knitted beanie with a pompom, a long red knitted scarf, little
twig arms with mittens, clean thick dark-navy outlines, soft flat shading,
sticker style, frosty winter palette (white, icy blue, cranberry red, a little
gold).

1) LEFT EDGE, full height of the canvas — "LONG SNOWMAN": the snowman seen from
   the front, standing upright like the "longcat" meme, extremely long body.
   From top to bottom: head with the beanie, scarf and carrot nose (twig arms
   with mittens holding a tiny wrapped gift right under the scarf, two coal
   buttons only here), then a VERY LONG STRAIGHT TORSO with perfectly parallel
   vertical sides, then the bottom snowball with a couple of small coal stones
   and a little snowdrift at the base. The torso must be PLAIN UNIFORM WHITE
   SNOW — no buttons, no stones, no scarf ends, no shading changes along its
   length — so any horizontal slice of it looks identical. Object about 170 px
   wide and about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Cozy snowy evening: the snowman stands in the RIGHT third
   between two small snowy fir trees with warm garland lights, a sled and a
   snowball pile next to him. The LEFT two thirds stay calm and simple (soft
   twilight-blue gradient, at most a few tiny snowflakes) because text will be
   placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px: a closed circular ring
   made of a red knitted scarf wound with snowy fir twigs and small snowflakes;
   the snowman's head with the beanie and carrot nose peeks over the top of the
   ring, two mittens hold the bottom. The CENTER is a perfectly EMPTY
   TRANSPARENT CIRCLE (a profile photo goes there); the ring band is thin,
   about 10–12% of the frame diameter, and the ring is closed all the way
   around.

4) BOTTOM RIGHT — the same snowman whole, sitting compactly in a little
   snowdrift and holding a mug of hot cocoa, fits in a square of about
   320×320 px.
```

Что проверить до нарезки: туловище длинного снеговика — ровный снег без
пуговиц, кольцо рамки замкнуто и середина пустая, фон правда прозрачный.

Первый лист GPT отдал с клеткой, нарисованной в RGB. Вычитает её
`uncheck.py` (клетка строго серая, снег — с синим отливом):

```bash
python3 design/skins/uncheck.py design/skins/snowman/sheet.png
python3 design/skins/cut-skin.py design/skins/snowman/sheet-alpha.png snowman
```

## Санта — обычный пак зимы

Лист — `santa/sheet.png`, раскладка как у снеговика, но вместо кольца рамки —
ШАПКА: аватар не обводится, а надевает её. Режется с `--hat` — резак сам
сажает шапку на макушку (шире аватара на волосок меньше, заходит на него на
треть, `HAT_W` и `HAT_OVERLAP` в `cut-skin.py`):

```bash
python3 design/skins/cut-skin.py design/skins/santa/sheet.png santa --hat
```

Ловушка — пуговицы и
ремень: на туловище длинного Санты их нет, ремень с пряжкой — в нижнем куске,
над ногами. Белая опушка шубы идёт по центру СВЕРХУ ВНИЗ ровной полосой — она
одинакова в каждой строке и шва не даёт. Про прозрачность в промпте сказано
дважды: снеговика GPT отдал с клеткой, нарисованной в картинке.

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a website skin pack
called "Cute Santa". Draw exactly FOUR separate objects, each surrounded by at
least 60 px of empty transparent space, nothing touching another object or the
canvas edge, no text, no labels, no watermark, no drop shadows on the
background. Every object FULLY OPAQUE with clean edges — no soft glow, falling
snow or sparkles fading into the background.

Same character in all four: a cute kawaii chibi Santa Claus — round rosy face,
big shiny eyes, a fluffy white beard and mustache, a red hat with white fur trim
and a white pompom, a red coat with white fur trim, black boots, white mittens,
clean thick dark-navy outlines, soft flat shading, sticker style, festive winter
palette (cranberry red, white, gold, a little pine green and icy blue).

1) LEFT EDGE, full height of the canvas — "LONG SANTA": Santa seen from the
   front, standing upright like the "longcat" meme, extremely long body.
   From top to bottom: head with the hat and the beard (mittens holding a tiny
   wrapped gift right under the beard), then a VERY LONG STRAIGHT TORSO with
   perfectly parallel vertical sides, then a black belt with a golden buckle,
   short legs and black boots standing on a little snowdrift. The torso must be
   PLAIN UNIFORM RED COAT with ONE straight vertical white fur stripe down the
   exact center — no buttons, no belt, no pockets, no folds, no shading changes
   along its length — so any horizontal slice of it looks identical. Object
   about 170 px wide and about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Cozy snowy night: Santa sits in a small red wooden sleigh
   full of gift boxes in the RIGHT third, next to a snowy fir tree with warm
   garland lights. The LEFT two thirds stay calm and simple (soft night-blue
   gradient, at most a few tiny stars and snowflakes) because text will be
   placed over it.

3) BOTTOM CENTER — a SANTA HAT on its own (no character, no head), about
   440 px wide: a cute plump red Santa hat with a thick fluffy white fur brim
   and a big white pompom, the tip flopping softly to one side, a tiny sprig of
   holly with red berries tucked into the brim. Seen from the front, as if worn:
   the brim is a wide, nearly straight horizontal band at the BOTTOM, slightly
   curved like it sits on a round head, so it can be placed on top of a round
   profile photo. Nothing below the brim — no hair, no face, no ears.

4) BOTTOM RIGHT — the same Santa whole, sitting compactly on a big red gift
   sack and waving one mitten, fits in a square of about 320×320 px.
```

Что проверить до нарезки: на туловище нет пуговиц и ремня (ремень только
внизу), белая полоса по центру ровная по всей длине, шапка одна, без головы
под ней, и низ опушки ровный.

## Олень — обычный пак зимы

Лист — `deer/sheet.png`. Вместо кольца — РОЖКИ на ободке, как шапка Санты:
аватар их надевает. Режется с `--band`, а не `--hat`: шапку сажают низом на
треть аватара, и ободок так висел над головой. По `--band` ширина аватара —
расстояние между кончиками дуги, а внутренний край дуги ложится на макушку.
GPT опять нарисовал клетку вместо прозрачного фона:

```bash
python3 design/skins/uncheck.py design/skins/deer/sheet.png
python3 design/skins/cut-skin.py design/skins/deer/sheet-alpha.png deer --band
```

Ловушка туловища та же: шарф, пятна и пуговицы только в верхнем куске, а
туловище — ровная коричневая шерсть с одной светлой полосой по центру.

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a website skin pack
called "Cute Reindeer". Draw exactly FOUR separate objects, each surrounded by
at least 60 px of empty transparent space, nothing touching another object or
the canvas edge, no text, no labels, no watermark, no drop shadows on the
background. Every object FULLY OPAQUE with clean edges — no soft glow, falling
snow or sparkles fading into the background.

Same character in all four: a cute kawaii chibi reindeer — warm brown fur, a
cream muzzle and cream belly, big shiny eyes, rosy cheeks, a shiny red nose,
small soft ears, little branching golden-brown antlers, a red knitted scarf, a
tiny golden bell on a red ribbon, clean thick dark-navy outlines, soft flat
shading, sticker style, festive winter palette (warm brown, cream, cranberry
red, gold, a little pine green and icy blue).

1) LEFT EDGE, full height of the canvas — "LONG REINDEER": the reindeer seen
   from the front, standing upright like the "longcat" meme, extremely long
   body. From top to bottom: head with antlers, ears, red nose and the scarf
   (front hooves holding a tiny wrapped gift right under the scarf), then a
   VERY LONG STRAIGHT TORSO with perfectly parallel vertical sides, then short
   hind legs with little dark hooves and a tiny fluffy tail standing on a
   little snowdrift. The torso must be PLAIN UNIFORM BROWN FUR with ONE
   straight vertical cream stripe down the exact center (the belly) — no
   spots, no bell, no scarf ends, no shading changes along its length — so any
   horizontal slice of it looks identical. Object about 170 px wide and about
   940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Cozy snowy night: the reindeer stands in the RIGHT third in
   a snowy clearing next to a fir tree with warm garland lights, its red nose
   softly glowing, a few gift boxes in the snow. The LEFT two thirds stay calm
   and simple (soft night-blue gradient, at most a few tiny stars and
   snowflakes) because text will be placed over it.

3) BOTTOM CENTER — REINDEER ANTLERS HEADBAND on its own (no character, no head),
   about 440 px wide: a soft red velvet headband shaped like a gentle arch, with
   two cute plump branching golden-brown antlers sticking up from it, two small
   furry brown reindeer ears with pink insides at the sides of the band, a sprig
   of holly with red berries and a tiny golden bell in the middle of the band.
   Seen from the front, as if worn: the headband is at the BOTTOM, slightly
   curved like it sits on top of a round head, so it can be placed on top of a
   round profile photo. Nothing below the headband — no hair, no face.

4) BOTTOM RIGHT — the same reindeer whole, sitting compactly in a little
   snowdrift and holding a mug of hot cocoa, red nose shining, fits in a square
   of about 320×320 px.
```

Что проверить до нарезки: туловище — ровная шерсть с одной полосой, рожки
нарисованы отдельно, без головы под ободком, и ободок — самая широкая часть
внизу (иначе резак примет за ободок рога).

## Сова — обычный пак зимы

Лист — `owl/sheet.png`. Рамки нет и здесь, и это не шапка: полярная сова
СИДИТ на аватаре и обнимает его крыльями — свисающие концы крыльев
спускаются по бокам, как кончики ободка оленя. Поэтому режется с `--band`:
ширина аватара — между концами крыльев, а когти (первое снизу по середине)
ложатся на макушку.

```bash
python3 design/skins/cut-skin.py design/skins/owl/sheet.png owl --band
```

Ловушка туловища: у полярной совы пёстрые крапинки по всему телу — на
длинной сове их нет, туловище — ровное белое перо с одной голубоватой полосой
по центру. Крапинки только на голове, крыльях и хвосте.

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a website skin pack
called "Cute Snowy Owl". Draw exactly FOUR separate objects, each surrounded by
at least 60 px of empty transparent space, nothing touching another object or
the canvas edge, no text, no labels, no watermark, no drop shadows on the
background. Every object FULLY OPAQUE with clean edges — no soft glow, falling
snow or sparkles fading into the background.

Same character in all four: a cute kawaii chibi snowy owl — round fluffy white
body, a few small dark speckles on the head and wings only, huge round golden
eyes with big shiny highlights, a tiny dark beak, little feather "ear" tufts, a
short icy-blue knitted scarf with a white snowflake pattern, small dark talons,
clean thick dark-navy outlines, soft flat shading, sticker style, frosty winter
palette (white, icy blue, deep navy, gold, a little warm orange lantern light).

1) LEFT EDGE, full height of the canvas — "LONG OWL": the owl seen from the
   front, standing upright like the "longcat" meme, extremely long body.
   From top to bottom: head with ear tufts and big golden eyes, the scarf, the
   wing tips folded in front holding a tiny glowing lantern right under the
   scarf, then a VERY LONG STRAIGHT TORSO with perfectly parallel vertical
   sides, then little dark talons and short tail feathers standing on a little
   snowdrift. The torso must be PLAIN UNIFORM WHITE FEATHERS with ONE straight
   vertical pale icy-blue stripe down the exact center — no speckles, no
   feather scales, no shading changes along its length — so any horizontal
   slice of it looks identical. Object about 170 px wide and about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Calm moonlit winter night: the owl sits on a snowy pine
   branch in the RIGHT third under a big glowing full moon, a small lantern
   hanging from the branch, snowy pine tops below. The LEFT two thirds stay calm
   and simple (soft night-blue gradient, at most a few tiny stars) because text
   will be placed over it.

3) BOTTOM CENTER — the owl PERCHED ON A ROUND AVATAR, about 460 px wide, drawn
   WITHOUT the avatar itself: the owl sits on top, its talons gripping an
   invisible round edge, and it hugs that invisible circle with its wings — both
   wings spread out and drape down to the left and right in a smooth arch, like
   a headband, the wing tips are the lowest points of the object on the far
   left and far right. Between the wings, under the talons, there is only empty
   transparent space (a round profile photo goes there). The owl looks happy,
   eyes closed in a smile, the scarf tail fluttering.

4) BOTTOM RIGHT — the same owl whole, sitting compactly in a little snowdrift
   and holding a tiny glowing lantern with one wing, fits in a square of about
   320×320 px.
```

Этот лист GPT отдал по-настоящему прозрачным, но с полупрозрачным голубым
свечением вокруг предметов (вопреки промпту). На сайте его не видно: резак
ужимает на предумноженной альфе, и слабое свечение растворяется.

Что проверить до нарезки: туловище длинной совы — ровное перо с одной
полосой, без крапинок; у совы на аватаре концы крыльев — самое нижнее слева и
справа, а под когтями пусто (никакого круга, ветки или снега).

## Гринч — редкий пак зимы

Лист — `grinch/sheet.png`. Редкий обязан выглядеть дороже обычных, поэтому
в промпте рисовка богаче (контровой свет, блики, светящиеся лампочки), а
рамка — не вещь на голове, а СЮЖЕТ: Гринч ворует аватар. Кольцо — украденная
гирлянда, голова выглядывает сверху, пальцы обхватывают кольцо сзади. Пустая
середина есть, поэтому режется обычно, без `--hat`/`--band`:

```bash
python3 design/skins/uncheck.py design/skins/grinch/sheet.png --strong
python3 design/skins/cut-skin.py design/skins/grinch/sheet-alpha.png grinch
```

Лист пришёл с клеткой, а рисовка реалистичная, без тёмного контура: клетка
подмешана в край меха, а вокруг лампочек нарисовано бледное свечение поверх
неё. `--strong` дочищает край сильнее (6 проходов, ореол до заметно цветного) —
на листах с обводкой он не нужен.

Ловушка туловища: мех Гринча так и просит прядей по всему телу — на длинном
Гринче туловище ровное зелёное, без прядей и без полосы.

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a RARE, premium website
skin pack called "The Grinch". Draw exactly FOUR separate objects, each
surrounded by at least 60 px of empty transparent space, nothing touching
another object or the canvas edge, no text, no labels, no watermark, no drop
shadows on the background. Every object FULLY OPAQUE with clean edges — no soft
glow, falling snow or sparkles fading into the background.

Same character in all four: a cute but mischievous chibi Grinch — fuzzy
lime-green fur, a sly wide grin, narrow yellow-green eyes with red irises and a
cheeky raised eyebrow, a crooked, slightly tattered red Santa hat with white fur
trim and a drooping pompom, long thin green fingers. Style: premium collectible
sticker — clean thick dark outlines, rich painterly shading with a cool
moonlight rim light on one side and warm light from Christmas bulbs on the
other, glossy highlights, more detail than a basic sticker but still cute and
readable at small size. Palette: lime and olive green, cranberry red, gold,
deep night blue, warm bulb colors.

1) LEFT EDGE, full height of the canvas — "LONG GRINCH": the Grinch seen from
   the front, standing upright like the "longcat" meme, extremely long body.
   From top to bottom: head with the crooked Santa hat and sly grin, long
   fingers holding a stolen glowing Christmas ornament right under the chin,
   then a VERY LONG STRAIGHT TORSO with perfectly parallel vertical sides, then
   big fuzzy green feet, one of them stepping on a squashed gift box. The torso
   must be PLAIN UNIFORM GREEN FUR — no fur strands, no stripes, no belly patch,
   no shading changes along its length — so any horizontal slice of it looks
   identical. Object about 170 px wide and about 940 px tall.

2) TOP RIGHT — wide BANNER, about 1150×290 px, a fully filled rectangle (opaque,
   square corners). Snowy night on a rooftop: in the RIGHT third the Grinch
   sneaks along the snowy roof edge dragging a huge sack of stolen presents, a
   string of stolen Christmas lights trailing behind him, the warm windows of a
   cozy snowy town glowing far below. The LEFT two thirds stay calm and simple
   (soft night-blue gradient with a faint big moon glow, at most a few tiny
   stars) because text will be placed over it.

3) BOTTOM CENTER — round AVATAR FRAME, about 520×520 px, telling a story: the
   Grinch is STEALING the round photo. The closed circular ring is a tangled
   STRING OF CHRISTMAS LIGHTS with glowing colorful bulbs, tinsel and a couple of
   ornaments; the Grinch's head with the crooked Santa hat and sly grin peeks
   over the top of the ring, and his long thin green fingers creep around the
   ring from behind on the left and right, gripping it as if pulling it away.
   The CENTER is a perfectly EMPTY TRANSPARENT CIRCLE (a profile photo goes
   there); the ring band is thin, about 10–12% of the frame diameter, and the
   ring is closed all the way around.

4) BOTTOM RIGHT — the same Grinch whole, sitting smugly on top of a pile of
   stolen gift boxes and hugging a golden Christmas-tree star, fits in a square
   of about 320×320 px.
```

Что проверить до нарезки: туловище ровное зелёное без прядей, кольцо
гирлянды замкнуто и середина пустая, пальцы — СНАРУЖИ кольца, а не поверх
середины (иначе они закроют фото).

## Саб-Зиро — редкий пак зимы, рамка с ДВУМЯ состояниями

Лист — `subzero/sheet.png`, предметов ПЯТЬ: внизу слева направо рамка, та же
рамка во льду и Саб-Зиро на одну запись. Ледяная рамка — `frame-fx.webp`:
сайт раз в семь секунд проявляет её поверх обычной (лёд нарастает от кольца на
края фото, держится и тает; «Второе состояние рамки» в `skins.css`).
Полупрозрачность льда даёт CSS (пик 85%), рисовать её не надо — GPT её всё
равно не умеет. Совмещаются две рамки по ВНЕШНЕМУ краю, поэтому кольцо
снаружи у обеих обязано быть одинаковым, а лёд нарастать только ВНУТРЬ.

```bash
python3 design/skins/uncheck.py design/skins/subzero/sheet.png   # если клетка
python3 design/skins/cut-skin.py design/skins/subzero/sheet-alpha.png subzero --fx
```

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a RARE, premium website
skin pack called "Sub-Zero". Draw exactly FIVE separate objects, each
surrounded by at least 50 px of empty transparent space, nothing touching
another object or the canvas edge, no text, no labels, no watermark, no drop
shadows on the background. Every object FULLY OPAQUE with clean edges — no soft
glow, mist or snow fading into the background.

Same character everywhere: a cute but cool chibi SUB-ZERO from Mortal Kombat —
recognizable at a glance: his iconic blue ninja outfit with a dark-blue face mask covering the lower face, a silver
metal plate on the forehead, glowing icy-white eyes, a frosty breath, arms
wrapped in blue cloth, hands crackling with ice crystals. Style: premium
collectible sticker — clean thick dark-navy outlines, rich painterly shading,
cold blue rim light, glossy ice highlights, more detail than a basic sticker but
cute and readable at small size. Palette: ice blue, deep navy, silver, white
frost, a little cyan glow.

1) LEFT EDGE, full height of the canvas — "LONG SUB-ZERO": Sub-Zero seen from the
   front, standing upright like the "longcat" meme, extremely long body. From
   top to bottom: head with mask and glowing eyes, hands right under the chin
   holding a small glowing ice orb, then a VERY LONG STRAIGHT TORSO with
   perfectly parallel vertical sides, then short legs in blue boots standing on
   a small chunk of ice. The torso must be PLAIN UNIFORM BLUE CLOTH with ONE
   straight vertical darker-blue stripe down the exact center — no belt, no
   folds, no armor plates, no shading changes along its length — so any
   horizontal slice of it looks identical. Object about 170 px wide and about
   920 px tall.

2) TOP RIGHT — wide BANNER, about 1150×280 px, a fully filled rectangle
   (opaque, square corners). Frozen mountain temple at night: in the RIGHT third
   Sub-Zero stands in his fighting pose with an ice blast forming between his
   hands, icicles and frozen pillars around, cold blue moonlight. The LEFT two
   thirds stay calm and simple (soft dark-blue gradient, at most a few tiny
   snowflakes) because text will be placed over it.

BOTTOM ROW, left to right, three objects:

3) AVATAR FRAME, NORMAL — about 380×380 px: a closed circular ring of jagged
   clear-blue ice crystals and frost; Sub-Zero's masked head peeks over the
   top of the ring with glowing eyes, and his two frosty hands grip the ring on
   the left and right. The CENTER is a perfectly EMPTY TRANSPARENT CIRCLE (a
   profile photo goes there); the ring band is thin, about 10–12% of the
   diameter, and closed all the way around.

4) AVATAR FRAME, FROZEN — EXACTLY THE SAME frame as object 3 (same size, same
   ring, same head and hands, same position of every detail on the OUTSIDE),
   but now the ice has spread INWARD: thick frost and sharp ice crystals grow
   from the inner edge of the ring toward the middle, covering about the outer
   third of the inner circle, with frosty cracks and sparkles. The very center
   (about 40% of the inner diameter) stays EMPTY TRANSPARENT. Nothing changes
   outside the ring.

5) Sub-Zero whole, sitting cross-legged on a block of ice, one hand raised
   with a small ice crystal floating above the palm, fits in a square of about
   300×300 px.
```

Что проверить до нарезки: у рамок 3 и 4 снаружи всё одинаково (голова, руки,
кольцо — то же место и размер), лёд в 4 только внутри и середина пустая;
предметов ровно пять.

## Король-лич — легендарка зимы

Лист — `lichking/sheet.png`, предметов ШЕСТЬ — легендарке положено больше,
чем остальным:

- слева вместо «длинного кота» — ЛЕДЯНАЯ СКОРБЬ остриём вниз: меч длинный
  сам по себе, и тянуть в длину Лича незачем. Рукоять с черепом — голова
  полосы, клинок — туловище, остриё во льду — лапы;
- шапка профиля сверху — Лич на Ледяном Троне;
- СВОЯ ПОЛОСА ДЛЯ СТРОКИ ЗВОНКА (`leads.webp`, резак `--leads`) — плоская,
  под ней шапкой профиля. Без неё лента лидов повторяет шапку профиля один в
  один, и у легендарки это выглядит дёшево. Строка звонка ~56px высотой,
  картинка прижата вправо, левые две трети закрывает цвет строки;
- внизу слева направо: рамка, та же рамка во втором состоянии (`--fx`: руны
  вспыхивают, внутрь ползёт ледяной туман — проявляется раз в 7 секунд) и
  Лич на одну запись — в полный рост, с мечом (трон уже на шапке, шлем —
  на лидах: картинки пака не повторяют друг друга).

```bash
python3 design/skins/uncheck.py design/skins/lichking/sheet.png --flood 1020,560,1480,1010
python3 design/skins/cut-skin.py design/skins/lichking/sheet-alpha.png lichking --fx --leads
```

`--flood` — область Лича в полный рост: вихрь холода GPT нарисовал
полупрозрачным поверх клетки, клетка в нём голубая и обычным вычитанием не
узнаётся. В области фон заливается по светлым бледным пикселям; на весь лист
так нельзя — ушёл бы белый туман второй рамки.

На тесном листе GPT дотянул поднятый меч Лича (предмет 6) вплотную до низа
полосы лидов — пятна слиплись при любом допуске. С `--leads` резак сам
прорезает зазор под и над сплошными полосами (`carve_bands`), в их ширину:
меч теряет десяток пикселей острия, а длинная Ледяная Скорбь слева не
задевается.

Ловушка туловища: настоящая Ледяная Скорбь сужается к острию и вся в рунах,
а сужение и разные руны по длине — шов на каждой плитке. Клинок на листе —
с ПАРАЛЛЕЛЬНЫМИ краями и одной ровной светящейся канавкой по центру; руны и
сужение — только у гарды (верхний кусок) и у острия (нижний).

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a LEGENDARY, top-tier
website skin pack called "The Lich King". Draw exactly SIX separate objects,
each surrounded by at least 40 px of empty transparent space, nothing touching
another object or the canvas edge, no text, no labels, no watermark, no drop
shadows on the background. Every object FULLY OPAQUE with clean edges — no soft
glow, mist or snow fading into the background.

Same character everywhere: a chibi but menacing THE LICH KING (Arthas) from
World of Warcraft — recognizable at a glance: the spiked Helm of Domination
with glowing icy-blue eyes in the dark visor, a heavy dark saronite armor with
skull pauldrons and frost runes, a flowing dark cape, and the runeblade
FROSTMOURNE with its glowing blue runes. Style: legendary collectible art —
clean thick dark outlines, rich painterly shading, strong icy-cyan rim light,
glowing runes, frost particles, epic and detailed but still readable at small
size. Palette: dark steel, icy cyan and blue, white frost, a touch of cold
violet.

1) LEFT EDGE, full height of the canvas — "LONG FROSTMOURNE": the runeblade
   Frostmourne alone (no character), standing vertically POINT-DOWN, seen
   straight from the front, extremely long. From top to bottom: the pommel and
   grip, the ornate crossguard with the horned skull and frosty wings, glowing
   runes right under the crossguard, then a VERY LONG STRAIGHT BLADE with
   perfectly parallel edges, then the last part of the blade narrowing to the
   point, pierced into a small jagged chunk of ice. The long part of the blade
   must be PLAIN UNIFORM DARK STEEL with ONE straight glowing cyan fuller line
   down the exact center — no runes, no tapering, no notches, no shading
   changes along its length — so any horizontal slice of it looks identical.
   Object about 160 px wide at the crossguard and about 940 px tall.

TO THE RIGHT, top to bottom:

2) PROFILE BANNER — about 1180×270 px, a fully filled rectangle (opaque,
   square corners). Icecrown Citadel at night: in the RIGHT third the Lich King
   sits on the Frozen Throne atop a jagged ice spire, Frostmourne across his
   knees glowing, the green-blue aurora and the citadel towers behind him. The
   LEFT two thirds stay calm and simple (soft dark-blue gradient with a faint
   aurora, at most a few tiny snowflakes) because text will be placed over it.

3) LEAD ROW STRIP — about 1180×170 px, a fully filled VERY FLAT rectangle
   (opaque, square corners), a DIFFERENT scene from the banner: a close-up of
   the Lich King's helm and glowing eyes on the RIGHT, with Frostmourne held
   horizontally beside it, frost mist drifting to the left. Everything
   important stays inside the RIGHT 35%; the LEFT 65% is a calm dark-blue
   gradient with only faint mist, because text and a colored panel will cover
   it.

BOTTOM ROW, left to right, three objects:

4) AVATAR FRAME, NORMAL — about 360×360 px: a closed circular ring of jagged
   saronite spikes and ice; the Helm of Domination sits on top of the ring like
   a crown, glowing eyes in its visor, and Frostmourne crosses behind the ring
   diagonally, its hilt sticking out at the top-left and its tip at the
   bottom-right. The CENTER is a perfectly EMPTY TRANSPARENT CIRCLE (a profile
   photo goes there); the ring band is thin, about 10–12% of the diameter, and
   closed all the way around.

5) AVATAR FRAME, EMPOWERED — EXACTLY THE SAME frame as object 4 (same size,
   same ring, same helm and sword, same position of every detail on the
   OUTSIDE), but now every rune on Frostmourne and the ring blazes bright cyan,
   the helm's eyes flare, and thick icy mist with frost crystals curls INWARD
   from the ring over the outer third of the inner circle. The very center
   (about 40% of the inner diameter) stays EMPTY TRANSPARENT.

6) The Lich King whole, standing in a powerful pose: Frostmourne raised in one
   hand, the other gauntlet casting a swirl of frost, cape flowing, fits in a
   square of about 300×300 px.
```

Что проверить до нарезки: предметов ровно шесть; полоса лидов заметно
площе шапки и с другой сценой; у рамок 4 и 5 снаружи всё одинаково, туман
только внутрь, середина пустая; клинок длинной Ледяной Скорби ровный, с
одной канавкой, без сужения.

## Гарри Поттер — легендарка зимы

Лист — `potter/sheet.png`, шесть предметов, как у Лича (`--fx --leads`):

- слева — МЕТЛА «Молния» вертикально, на конце древка сидит Букля (голова
  полосы), древко — туловище, прутья — лапы;
- шапка профиля — заснеженный Хогвартс ночью, Гарри пролетает на метле;
- своя полоса лидов — Гарри крупным планом с Люмосом на палочке;
- внизу: рамка-кольцо из шарфа Гриффиндора со снитчем наверху, она же во
  втором состоянии — серебристый свет заклинания затекает внутрь кольца, — и маленький Гарри с Люмосом.

```bash
python3 design/skins/uncheck.py design/skins/potter/sheet.png   # если клетка
python3 design/skins/cut-skin.py design/skins/potter/sheet-alpha.png potter --fx --leads
```

Первый промпт с именами («Harry Potter», шрам, Хогвартс, патронус-олень)
GPT нарисовал, а фильтр не отдал: «similarity to third-party content». Ниже
— без имён и самых узнаваемых примет; узнаётся по образу, а название пака
на сайте всё равно «Гарри Поттер».

Ловушка туловища: древко метлы деревянное, а волокна и сучки по длине — шов.
На листе оно ровное, с одной светлой полосой блика; золотые цифры и обмотка —
только у Букли наверху.

```text
Create ONE image, 1536×1024 (landscape), PNG with a REAL fully TRANSPARENT
background (alpha channel) — do NOT draw a checkerboard pattern, the empty area
must be actually transparent. It is a sticker sheet for a LEGENDARY, top-tier
website skin pack called "Young Wizard". All characters and designs are
ORIGINAL — not based on any existing film, book or franchise. Draw exactly SIX
separate objects, each surrounded by at least 40 px of empty transparent space,
nothing touching another object or the canvas edge, no text, no labels, no
logos, no watermark, no drop shadows on the background. Every object FULLY
OPAQUE with clean edges — no soft glow, snow or sparkles fading into the
background.

Same character everywhere: a cute original chibi boy wizard — messy dark hair,
big round glasses, bright green eyes, a cheerful smile, a long knitted scarf
with wide red and gold stripes, a black wizard school robe, a slim wooden wand;
his companion is a fluffy white snowy owl. Style: legendary collectible art —
clean dark outlines, rich painterly shading, warm golden candle light against
cold blue winter night, glossy highlights, magical sparkles, detailed but
readable at small size. Palette: red and gold, deep night blue, snow white,
silver-blue magic light.

1) LEFT EDGE, full height of the canvas — "LONG BROOM": a sleek racing
   broomstick standing vertically, seen straight from the front, extremely
   long, no rider. From top to bottom: the white snowy owl perched on the top
   end of the handle, wings slightly open, small golden fittings right under
   her, then a VERY LONG STRAIGHT HANDLE with perfectly parallel sides, then the
   bundle of twigs fanning out at the bottom with a few sparkles of magic. The
   long part must be PLAIN UNIFORM POLISHED DARK WOOD with ONE straight vertical
   light highlight — no grain, no knots, no fittings, no shading changes along
   its length — so any horizontal slice of it looks identical. Object about
   160 px wide (owl and twigs) and about 940 px tall.

TO THE RIGHT, top to bottom:

2) PROFILE BANNER — about 1180×270 px, a fully filled rectangle (opaque,
   square corners). A grand old magic school castle in deep winter at night,
   snowy towers, warm golden windows, a frozen lake; in the RIGHT third the boy
   wizard flies past on his broom with his striped scarf streaming behind him,
   the owl flying next to him. The LEFT two thirds stay calm and simple
   (dark-blue night sky with soft falling snow, at most a few tiny stars)
   because text will be placed over it.

3) LEAD ROW STRIP — about 1180×170 px, a fully filled VERY FLAT rectangle
   (opaque, square corners), a DIFFERENT shot: a close-up of the boy wizard's
   face on the RIGHT — round glasses, scarf pulled up to the nose — holding up
   his wand with a bright white light glowing at its tip, the light spilling to
   the left into snowy darkness. Everything important stays inside the RIGHT
   35%; the LEFT 65% is calm dark-blue snowy darkness, because text and a
   colored panel will cover it.

BOTTOM ROW, left to right, three objects:

4) AVATAR FRAME, NORMAL — about 360×360 px: a closed circular ring made of the
   twisted knitted red-and-gold striped scarf with fringed ends hanging at the
   bottom; a small golden winged ball sits on top of the ring with its thin
   silver wings spread wide. The CENTER is a perfectly EMPTY TRANSPARENT CIRCLE
   (a profile photo goes there); the ring band is thin, about 10–12% of the
   diameter, and closed all the way around.

5) AVATAR FRAME, SPELL CAST — EXACTLY THE SAME frame as object 4 (same size,
   same scarf ring, same golden winged ball, same position of every detail on
   the OUTSIDE), but now bright silver-blue magic light swirls INWARD from the
   ring over the outer third of the inner circle, with glowing wisps and tiny
   stars in it. The very center (about 40% of the inner diameter) stays EMPTY
   TRANSPARENT. Nothing changes outside the ring.

6) The boy wizard whole, standing in his robe and striped scarf, holding his
   wand up with a light glowing at the tip, a cheerful look, fits in a square
   of about 300×300 px.
```

Что проверить до нарезки: предметов ровно шесть; древко ровное, Букля
наверху, прутья внизу; рамки 4 и 5 снаружи одинаковые, патронус только
внутри и середина пустая.
