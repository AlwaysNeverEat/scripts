#!/usr/bin/env python3
"""Лист Матиза → прозрачный лист для общего резака скинов.

    python3 design/skins/matiz/prep-sheet.py
    python3 design/skins/cut-skin.py design/skins/matiz/sheet-alpha.png matiz

GPT отдал реалистичный лист НЕПРОЗРАЧНЫМ: «прозрачный фон» — клетка,
нарисованная прямо в RGB (у листов заданий было так же). Общий резак ищет
предметы по альфе, поэтому сперва этот скрипт делает альфу сам:

  • фон — заливка ОТ КРАЁВ листа по пикселям клетки (светло-серые, без
    цвета). Баннер — сплошной прямоугольник, заливка его не трогает;
  • середина колеса окружена шиной со всех сторон, и заливка от краёв до неё
    не доходит — её заливаем отдельно, от центра самого колеса;
  • сквозь СТЁКЛА Матиза GPT тоже нарисовал клетку (стекло «прозрачное»).
    Цветом её от серебристого кузова не отличить, а сетка клетки неровная
    (шаг ~11,4 px и плавает), так что вычесть её нельзя. Первая попытка —
    размывать там, где есть рябь с шагом клетки, — смазала и кузов у кромок.
    Поэтому стёкла заданы МНОГОУГОЛЬНИКАМИ этого самого листа (GLASS), и
    внутри них тонируются только СВЕТЛЫЕ пиксели — клетка и блики; сиденья и
    торпедо тёмные и остаются как есть. Перегенерируют лист — координаты
    надо снять заново (сетка с подписями — в истории README).
"""

import os
from collections import deque

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'sheet.png')
OUT = os.path.join(HERE, 'sheet-alpha.png')

# Стёкла на листе (координаты sheet.png): заднее окно у Матиза под башней,
# лобовое и два боковых у Матиза на одну запись.
GLASS = [
    [(92, 716), (228, 716), (232, 760), (88, 760)],
    [(1055, 712), (1110, 641), (1291, 636), (1276, 716)],
    [(1302, 650), (1318, 640), (1358, 640), (1362, 712), (1300, 716)],
    [(1368, 642), (1412, 642), (1425, 715), (1375, 717)],
]
# Тон стекла — тёмный серо-синий, как у остального остекления на листе.
TINT = (52, 60, 70)


def is_checker(p):
    r, g, b = p[:3]
    return min(r, g, b) > 185 and max(r, g, b) - min(r, g, b) < 14


def flood(img, seeds, mask):
    w, h = img.size
    px = img.load()
    q = deque(seeds)
    while q:
        x, y = q.popleft()
        if mask[y][x] or not is_checker(px[x, y]):
            continue
        mask[y][x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny][nx]:
                q.append((nx, ny))


def components(mask, w, h):
    """Связные куски НЕ фона: [(x0, y0, x1, y1)]."""
    seen = [[False] * w for _ in range(h)]
    out = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if mask[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if n > 2000:
                out.append((x0, y0, x1 + 1, y1 + 1))
    return out


def main():
    img = Image.open(SRC).convert('RGB')
    w, h = img.size
    bg = [[False] * w for _ in range(h)]
    flood(img, [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)], bg)

    boxes = components(bg, w, h)
    if len(boxes) != 4:
        raise SystemExit(f'ждали четыре предмета, нашли {len(boxes)}: {boxes}')
    # Колесо — тот предмет, у которого середина bbox осталась клеткой.
    px = img.load()
    wheel = [b for b in boxes if is_checker(px[(b[0] + b[2]) // 2, (b[1] + b[3]) // 2])]
    if len(wheel) != 1:
        raise SystemExit('не нашли колесо с пустой серединой')
    x0, y0, x1, y1 = wheel[0]
    flood(img, [((x0 + x1) // 2, (y0 + y1) // 2)], bg)

    # Тонировка: светлое внутри стёкол — клетка и блики; переводим в тон
    # стекла, оставляя каплю исходной яркости, чтобы стекло не было плоским.
    glass = Image.new('L', (w, h), 0)
    gd = ImageDraw.Draw(glass)
    for poly in GLASS:
        gd.polygon(poly, fill=255)
    gp = glass.load()
    out = img.copy()
    op = out.load()
    fixed = 0
    for y in range(h):
        for x in range(w):
            if not gp[x, y] or bg[y][x]:
                continue
            r, g, b = px[x, y]
            lum = (r + g + b) / 3
            if lum > 120 and max(r, g, b) - min(r, g, b) < 40:
                k = (lum - 120) / 135 * 0.25
                op[x, y] = tuple(round(t + (255 - t) * k * 0.35) for t in TINT)
                fixed += 1
    # Шов «перекрашено / нет» внутри стекла смягчаем лёгким размытием по маске.
    out = Image.composite(out.filter(ImageFilter.GaussianBlur(1.2)), out, glass)

    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                ap[x, y] = 0
    # Край: на пиксель внутрь (там кайма смешения с клеткой) и чуть мягче.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    res = out.convert('RGBA')
    res.putalpha(alpha)
    res.save(OUT)
    print(f'{OUT}: предметов {len(boxes)}, стекла поправлено {fixed} px')


if __name__ == '__main__':
    main()
