#!/usr/bin/env python3
"""Лист с НАРИСОВАННОЙ клеткой → прозрачный лист для общего резака скинов.

    python3 design/skins/uncheck.py design/skins/<пак>/sheet.png
    python3 design/skins/cut-skin.py design/skins/<пак>/sheet-alpha.png <пак>

GPT раз за разом отдаёт «прозрачный фон» клеткой прямо в RGB, сколько ни
проси в промпте (снеговик, олень; у Матиза так же, но там свой скрипт из-за
стёкол). Вычесть её по цвету углов (with_alpha в резаке) нельзя: клетка
двухцветная, а снеговик сам белый. Отличает их ОТТЕНОК: клетка строго серая (R=G=B), а снег
нарисован с холодным синим отливом. Поэтому фон — связные куски светлых
БЕСЦВЕТНЫХ пикселей, в которых есть ОБА цвета клетки: так уходит и фон от
краёв, и середина рамки (до неё от краёв не дойти — кольцо замкнуто), а
белый блик на снеговике остаётся — он одноцветный. Размер куска не важен:
у оленя клетка застряла в щелях между рогом и ушком, а это кусочки в сотню
пикселей.
"""

import os
import sys
from collections import deque

from PIL import Image, ImageFilter



# Проходы дочистки края и насколько цветным может быть ореол. `--strong` —
# для листа, где поверх клетки нарисовано ещё и СВЕЧЕНИЕ (лампочки Гринча):
# оно бледно-цветное, и строгий порог его не берёт.
EDGE_PASSES, EDGE_SAT, EDGE_MIN = 3, 30, 196


def checker(p):
    r, g, b = p[:3]
    return max(r, g, b) - min(r, g, b) <= 4 and min(r, g, b) >= 222


def main():
    global EDGE_PASSES, EDGE_SAT, EDGE_MIN
    argv = sys.argv[1:]
    boxes = []
    while '--flood' in argv:
        i = argv.index('--flood')
        boxes.append(tuple(int(v) for v in argv[i + 1].split(',')))
        del argv[i:i + 2]
    args = [a for a in argv if a != '--strong']
    if '--strong' in argv:
        EDGE_PASSES, EDGE_SAT, EDGE_MIN = 6, 70, 170
    if len(args) != 1:
        sys.exit('запуск: uncheck.py <лист.png> [--strong] [--flood x0,y0,x1,y1 …]  → рядом <лист>-alpha.png')
    src = args[0]
    out_path = os.path.splitext(src)[0] + '-alpha.png'
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    bg = bytearray(w * h)
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if seen[i] or not checker(px[sx, sy]):
                continue
            comp, light, dark, mid = [], 0, 0, 0
            q = deque([(sx, sy)])
            seen[i] = 1
            while q:
                x, y = q.popleft()
                comp.append(y * w + x)
                v = px[x, y][0]
                light += v >= 248
                dark += v <= 240
                mid += 241 <= v <= 247
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and checker(px[nx, ny]):
                            seen[j] = 1
                            q.append((nx, ny))
            n = len(comp)
            # Порог по размеру маленький нарочно: кармашки между рогом, ушком и
            # ободком замкнуты и малы, но шире клетки — оба цвета в них есть.
            # Белый блик в глазу одноцветный и остаётся при любом размере.
            # Белая вязка шапки снеговика двухцветна тоже, но в ней ПЛАВНЫЕ
            # тени, а у клетки два ровных тона почти без промежуточных.
            if n > 40 and light > n * 0.08 and dark > n * 0.08 and mid < n * 0.12:
                for j in comp:
                    bg[j] = 1
    # Дочистка края. У рисовки без тёмного контура (мех и лампочки Гринча)
    # клетка подмешана в краевые пиксели, и после заливки вокруг остаётся
    # светлый ореол. Снимаем светлые почти бесцветные пиксели, касающиеся фона,
    # в несколько проходов. Рисовке с контуром это ничего не стоит: у неё фон
    # граничит с тёмной обводкой, а не с белым.
    def fringe(p):
        r, g, b = p[:3]
        return min(r, g, b) >= EDGE_MIN and max(r, g, b) - min(r, g, b) <= EDGE_SAT
    for _ in range(EDGE_PASSES):
        hit = []
        for y in range(1, h - 1):
            row = y * w
            for x in range(1, w - 1):
                i = row + x
                if not bg[i] and (bg[i - 1] or bg[i + 1] or bg[i - w] or bg[i + w]) and fringe(px[x, y]):
                    hit.append(i)
        for i in hit:
            bg[i] = 1
    # --flood: в заданной ОБЛАСТИ клетка просвечивает сквозь полупрозрачный
    # рисунок (вихрь холода у Лича) и подкрашена им — серой она уже не
    # считается. Там заливаем от фона по светлым бледным пикселям и снимаем
    # мелкие светлые пятна целиком. Только в области: на всём листе так же
    # ушёл бы белый туман второй рамки, нарисованный нарочно.
    def pale(p):
        r, g, b = p[:3]
        return min(r, g, b) >= 170 and max(r, g, b) - min(r, g, b) <= 85
    for x0, y0, x1, y1 in boxes:
        inside = lambda x, y: x0 <= x < x1 and y0 <= y < y1
        q = deque((x, y) for y in range(y0, y1) for x in range(x0, x1) if bg[y * w + x])
        while q:
            x, y = q.popleft()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                j = ny * w + nx
                if inside(nx, ny) and not bg[j] and pale(px[nx, ny]):
                    bg[j] = 1
                    q.append((nx, ny))
        seen2 = bytearray(w * h)
        for sy in range(y0, y1):
            for sx in range(x0, x1):
                i = sy * w + sx
                if seen2[i] or bg[i] or not pale(px[sx, sy]):
                    continue
                comp, q = [], deque([(sx, sy)])
                seen2[i] = 1
                while q:
                    x, y = q.popleft()
                    comp.append(y * w + x)
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        j = ny * w + nx
                        if inside(nx, ny) and not seen2[j] and not bg[j] and pale(px[nx, ny]):
                            seen2[j] = 1
                            q.append((nx, ny))
                # Мелкое пятно снимаем, только если оно почти БЕСЦВЕТНОЕ: точки
                # на плаще белые, а блики на льду и клинке голубые — их оставить.
                if len(comp) < 400 and all(max(px[j % w, j // w][:3]) - min(px[j % w, j // w][:3]) <= 35 for j in comp):
                    for j in comp:
                        bg[j] = 1
    alpha = Image.frombytes('L', (w, h), bytes(0 if v else 255 for v in bg))
    # Край клетки у контура сглажен — на пиксель внутрь, потом мягко.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    # Под прозрачным — ровный цвет, а не клетка: резак сравнивает соседние
    # строки туловища целиком, с прозрачными краями, и ступенька клетки
    # читалась бы как рисунок, который меняется по длине.
    out = Image.composite(im, Image.new('RGB', im.size, (240, 246, 252)), alpha.point(lambda v: 255 if v else 0)).convert('RGBA')
    out.putalpha(alpha)
    out.save(out_path)
    print(f'готово: {out_path}')


if __name__ == '__main__':
    main()
