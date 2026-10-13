#!/usr/bin/env python3
"""Нарезка картинок панели «Задания».

    python3 design/quests/cut-quests.py

Листов два: sheet-banners.png (два баннера недельного) и sheet-icons.png
(значок опыта и печать — нижний ряд; баннеры этого листа не берём, второй
вариант вышел лучше).

Оба листа GPT отдал НЕ прозрачными: клетка «прозрачного фона» нарисована
прямо в RGB. Поэтому общий резак (design/skins/cut-skin.py, он ищет пятна по
альфе) тут не годится:
  • баннеры — сплошные прямоугольники, их рамка ищется по строкам и столбцам,
    где почти нет «клеточных» пикселей (светло-серых без цвета);
  • значок и печать вырезаются заливкой ОТ КРАЁВ своего куска по тем же
    светло-серым пикселям: внутри предметов такие тоже бывают (блик на
    печати), но с краем они не связаны и остаются.
"""

import os
import sys
from collections import deque

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'frontend', 'src', 'assets', 'quests')


def is_checker(p):
    r, g, b = p[:3]
    return min(r, g, b) > 185 and max(r, g, b) - min(r, g, b) < 14


def spans(flags, min_len):
    out, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def banners(sheet):
    w, h = sheet.size
    px = sheet.load()
    rows = [sum(not is_checker(px[x, y]) for x in range(0, w, 4)) / (w / 4) > 0.6 for y in range(h)]
    found = []
    for y0, y1 in spans(rows, 150):
        cols = [sum(not is_checker(px[x, y]) for y in range(y0, y1, 4)) / ((y1 - y0) / 4) > 0.6 for x in range(w)]
        x0, x1 = max(spans(cols, 300), key=lambda s: s[1] - s[0])
        # Пара пикселей внутрь: на краю у GPT полоса смешения с клеткой.
        found.append(sheet.crop((x0 + 3, y0 + 3, x1 - 3, y1 - 3)))
    if len(found) != 2:
        sys.exit(f'на листе баннеров ждали два прямоугольника, нашли {len(found)}')
    return found


def cutout(piece):
    """Предмет на нарисованной клетке → RGBA: заливка фона от краёв."""
    img = piece.convert('RGB')
    w, h = img.size
    px = img.load()
    bg = [[False] * w for _ in range(h)]
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        if bg[y][x] or not is_checker(px[x, y]):
            continue
        bg[y][x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx]:
                q.append((nx, ny))
    alpha = Image.new('L', (w, h), 0)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            ap[x, y] = 0 if bg[y][x] else 255
    # Край: сжать на пиксель (там светлая кайма смешения с клеткой) и чуть
    # размыть, чтобы контур не был лесенкой.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = img.convert('RGBA')
    out.putalpha(alpha)
    return out.crop(out.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())


def icons(sheet):
    w, h = sheet.size
    # Нижний ряд листа: слева звезда опыта, справа печать.
    row = sheet.crop((0, int(h * 0.64), w, h))
    px = row.load()
    cols = [any(not is_checker(px[x, y]) for y in range(0, row.size[1], 3)) for x in range(row.size[0])]
    parts = spans(cols, 60)
    if len(parts) != 2:
        sys.exit(f'в нижнем ряду ждали два предмета, нашли {len(parts)}')
    return [cutout(row.crop((x0 - 6, 0, x1 + 6, row.size[1]))) for x0, x1 in parts]


def fit(img, side):
    k = side / max(img.size)
    return img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    cars, records = banners(Image.open(os.path.join(HERE, 'sheet-banners.png')).convert('RGB'))
    xp, stamp = icons(Image.open(os.path.join(HERE, 'sheet-icons.png')).convert('RGB'))
    # Баннер на сайте шириной до ~720px — вдвое больше хватает для ретины.
    for name, img in (('week-cars', cars), ('week-records', records)):
        img = img.resize((1440, round(img.size[1] * 1440 / img.size[0])), Image.LANCZOS)
        img.save(os.path.join(OUT, f'{name}.webp'), quality=84, method=6)
        print(name, img.size)
    for name, img, side in (('xp', xp, 96), ('stamp', stamp, 256)):
        img = fit(img, side)
        img.save(os.path.join(OUT, f'{name}.webp'), quality=90, method=6)
        print(name, img.size)


if __name__ == '__main__':
    main()
