# Фишки пасхалки «Тройка» — исходники

Здесь лежат 36 присланных текстур как есть: **6 видов фишек × 6 состояний**,
каждая 181×190 (у `red_vertically.png` холст на 10px выше — это единственное
исключение, и при сборке лишние строки снизу отрезаются).

В игре они не используются напрямую: тридцать шесть файлов — это тридцать шесть
запросов при открытии окна, и первые полсекунды поле стояло бы пустым. Из них
собран ОДИН спрайт `frontend/src/assets/troika-tiles.webp` (768×768, ~150 КБ),
и именно он попадает в сборку. Исходники держим здесь, чтобы спрайт можно было
пересобрать — другого размера, с новым видом фишки или с новой «штучкой».

## Раскладка спрайта

Строка — вид фишки, столбец — состояние. Порядок ОБЯЗАН совпадать с константами
в `shared/troika.js`: CSS считает `background-position` прямо из них
(`KINDS` даёт строку, `NONE…CLOCK` — столбец), никакой таблицы соответствий
между кодом и картинкой нет.

|   | `''` (обычная) | `_horizontally` | `_vertically` | `_bomb` | `_crystal` | `_clock` |
|---|---|---|---|---|---|---|
| 0 `ring` | `circle_blue` | ракета по строке | ракета по столбцу | бомба | призма | часы |
| 1 `square` | `cube_blue` | … | | | | |
| 2 `triangle` | `orange` | | | | | |
| 3 `hex` | `green` | | | | | |
| 4 `star` | `purple` | | | | | |
| 5 `drop` | `red` | | | | | |

То есть файл `<вид><состояние>.png` встаёт в клетку (строка вида, столбец
состояния).

## Как пересобрать

Клетка спрайта — квадрат 128×128 (исходные 181×190 вписываются в него с
незаметным сжатием по высоте на 5%; клетки на поле квадратные, и так плашки
всех фишек остаются одного размера). 128px хватает с запасом: на экране фишка
не больше 44px, то есть даже на трёхкратной плотности пикселей она не мылится.

С ImageMagick и cwebp:

```bash
cd design/troika-tiles
montage \
  circle_blue{,_horizontally,_vertically,_bomb,_crystal,_clock}.png \
  cube_blue{,_horizontally,_vertically,_bomb,_crystal,_clock}.png \
  orange{,_horizontally,_vertically,_bomb,_crystal,_clock}.png \
  green{,_horizontally,_vertically,_bomb,_crystal,_clock}.png \
  purple{,_horizontally,_vertically,_bomb,_crystal,_clock}.png \
  red{,_horizontally,_vertically,_bomb,_crystal,_clock}.png \
  -tile 6x6 -geometry 128x128! -background none /tmp/troika-tiles.png

cwebp -q 82 -alpha_q 100 /tmp/troika-tiles.png -o ../../frontend/src/assets/troika-tiles.webp
```

Качество 82 выбрано по глазам: 90 даёт +40 КБ без видимой разницы, 72 начинает
мылить блики на плашках. PNG на этом же спрайте весит 1.2 МБ — восьмикратно
больше, поэтому webp (его понимают все браузеры, которые понимают `oklch` из
нашего же CSS).

После пересборки проверить: `npx vite` → `/dev-troika.html`.
