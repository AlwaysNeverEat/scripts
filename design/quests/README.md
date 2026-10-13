# Задания — картинки панели

Панель «Задания» в профиле (`frontend/src/quests.js`) будет подхватывать
картинки **по имени файла** из `frontend/src/assets/quests/`, как кейсы и
скины. Нет файла — остаётся вёрстка, механика от картинок не зависит.

| Файл | Что это |
|---|---|
| `week-cars.webp` | фон недельного «добавить машины в базу» — машина в цеху справа, слева спокойно под текст |
| `week-records.webp` | фон недельного «сделать N записей» — стойка записи справа, слева спокойно |
| `xp.webp` | значок опыта — у «+25 опыта», на кнопке «Забрать» |
| `stamp.webp` | печать «выполнено» — ложится на забранную карточку вместо строки «Получено» |

Лист один на всё — ради дневного лимита GPT. Режется тем же поиском предметов,
что скины и кейсы (`design/skins/cut-skin.py`): два широких сверху вниз, потом
нижний ряд слева направо.

## Промпт для листа (ChatGPT / GPT-image)

Просить по-английски — раскладку модель держит точнее.

```text
Create ONE image, 1536×1024 (landscape), PNG with a fully TRANSPARENT background.
It is an asset sheet for the "Weekly & daily quests" panel of a car-service
website (oil change shops). Draw exactly FOUR separate objects, each surrounded by
at least 50 px of empty transparent space, nothing touching another object or the
canvas edge. NO text, NO letters, NO numbers, NO logos, NO watermark anywhere.

Style for everything: premium mobile-game illustration — painterly but crisp,
rich warm lighting, soft rim light, deep night-blue and graphite tones with warm
amber/gold accents. It must look great on a DARK website. No glow fading into the
background around the small objects — every object has clean, fully opaque edges.

1) TOP — wide BANNER, about 1400×300 px, a fully filled opaque rectangle with
   square corners. Scene: a cozy modern car-service bay at night. On the RIGHT
   40% of the banner — a gorgeous, glossy modern car (sporty sedan, deep
   metallic color with beautiful reflections) on a two-post lift, warm work
   lights, a few oil canisters and a tool cart, a hint of a garage door with
   city lights behind it. The LEFT 60% stays calm and dark (smooth graphite-blue
   wall gradient, at most a faint pegboard texture) because text will be placed
   over it. The car must be entirely inside the right part, fully visible, not
   cropped.

2) MIDDLE — second wide BANNER, the same size and the same lighting/palette, so
   both look like one set. Scene: the reception desk of the same car service.
   On the RIGHT 40% — a desk with an open appointment book full of neat
   check-marked lines (marks only, no readable writing), a wall calendar with
   several days ticked, a headset with a microphone, a cup of coffee, car keys
   on a hook, and through a glass wall behind — the silhouette of a car in the
   bay. The LEFT 60% stays calm and dark, same as banner 1.

3) BOTTOM LEFT — an "XP" icon, about 220×220 px: a faceted glowing amber-gold
   crystal star with a small lightning spark inside, like an experience orb in a
   game. Opaque, clean edges, no text.

4) BOTTOM RIGHT — a "COMPLETED" stamp, about 260×260 px: a round embossed seal
   (like a wax / rubber stamp) in rich emerald green with a bold check mark in
   the middle and a decorative ring border with small stars — NO letters on the
   ring. Slightly tilted, opaque, clean edges.
```

Что проверить в ответе до нарезки: на баннерах машина и стойка целиком
справа, левая часть спокойная и тёмная (на ней будет текст задания и полоса
прогресса); нигде нет букв и цифр — GPT любит дописать «XP» на значок и
«DONE» на печать, такой лист лучше перегенерировать, чем стирать.
