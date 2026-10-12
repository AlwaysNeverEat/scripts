# Нарезка листа скина (см. README.md рядом) на картинки для сайта.
#
# Лист — ПОКАЗ, а не спрайт: GPT раскладывает четыре предмета как хочет, и
# координаты «на глаз» он не держит. Поэтому предметы ищутся как связные пятна
# «не прозрачно» и узнаются ПО ФОРМЕ, а не по месту:
#   • самый вытянутый ввысь — длинный кот (капсулы записей);
#   • самый вытянутый вширь — баннер карточки лида;
#   • из двух оставшихся тот, у кого в середине дыра, — рамка аватара;
#   • последний — кот на одну запись.
# Не сходится (пятен не четыре, у рамки нет дыры) — скрипт падает со словами,
# а не кладёт на сайт пустоту.
#
# Длинный кот режется на три куска — ГОЛОВУ, ТУЛОВИЩЕ и ЛАПЫ. Туловище
# находится само: самый длинный отрезок строк, где ширина кота почти не
# меняется. Из его середины берётся кусок и сшивается в бесшовную плитку
# (верх перетекает в низ), голова и лапы по краю стыка гаснут по прозрачности —
# так капсула любой длины собирается из «голова + туловище × N + лапы», а на
# двух слотах голова сходится с лапами без шва.
#
# Фон: прозрачный — как есть; сплошной цветной (если GPT не смог прозрачный) —
# вычитается по цвету углов листа.
#
# Запуск: python3 design/skins/cut-skin.py <лист.png> <пак>
#   → frontend/src/assets/skins/<пак>/{frame,banner,single,head,body,feet}.webp + meta.json

import json
import os
import sys
from collections import deque

from PIL import Image, ImageChops, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SOLID = 40          # прозрачно ли здесь (край сглажен, ноль не годится)
CELL = 4            # поиск пятен — по сетке 4×4: лист 1.5 Мпикс, питон не спешит
JOIN = 3            # клеток: на таком расстоянии кусочки — один предмет (хвост отдельно от кота)

# Размеры на выходе — с запасом под плотность пикселей 2×.
STRIP_W = 112       # ширина полосы длинного кота (на капсуле ~44px)
SINGLE_H = 128      # высота кота на одну запись (капсула ~39px)
FRAME = 384         # сторона рамки (аватар 96px, рамка шире него)
BANNER_W = 1400     # баннер карточки лида (карточка до ~1000px)


def rs(img, size):
    """Ресайз на ПРЕДУМНОЖЕННОЙ альфе. У полностью прозрачных пикселей листа
    GPT оставляет цвет (тёмное свечение вокруг предметов — его видно, если
    открыть лист без учёта прозрачности), и обычный ресайз протащил бы его в
    края ореолом."""
    return img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def die(msg):
    sys.exit(f'cut-skin: {msg}')


def with_alpha(sheet):
    """Прозрачный лист — как есть. Непрозрачный — фон по цвету углов вон."""
    sheet = sheet.convert('RGBA')
    lo, _ = sheet.getchannel('A').getextrema()
    if lo < 250:
        return sheet
    w, h = sheet.size
    corners = [sheet.getpixel(p)[:3] for p in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    diff = ImageChops.difference(sheet.convert('RGB'), Image.new('RGB', sheet.size, bg)).convert('L')
    # 0..24 — фон, 24..64 — плавный край, дальше — рисунок.
    alpha = diff.point(lambda v: 0 if v < 24 else 255 if v > 64 else int((v - 24) * 255 / 40))
    sheet.putalpha(alpha)
    print(f'фон непрозрачный, вычтен цвет {bg}')
    return sheet


def blobs(alpha):
    """Пятна «не прозрачно» по грубой сетке: [(x0, y0, x1, y1), …] в пикселях листа."""
    w, h = alpha.size
    gw, gh = (w + CELL - 1) // CELL, (h + CELL - 1) // CELL
    small = alpha.point(lambda v: 255 if v > SOLID else 0).resize((gw, gh), Image.BOX)
    grid = small.point(lambda v: 255 if v > 8 else 0).filter(ImageFilter.MaxFilter(JOIN * 2 + 1))
    px = grid.load()
    seen = [[False] * gw for _ in range(gh)]
    out = []
    for sy in range(gh):
        for sx in range(gw):
            if seen[sy][sx] or not px[sx, sy]:
                continue
            q = deque([(sx, sy)])
            seen[sy][sx] = True
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < gw and 0 <= ny < gh and not seen[ny][nx] and px[nx, ny]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if n > 400:  # меньше — крошки и обрезки, не предмет
                out.append((x0 * CELL, y0 * CELL, min(w, (x1 + 1) * CELL), min(h, (y1 + 1) * CELL)))
    return out


def tight(img):
    """Обрезать до непрозрачного (по порогу, а не по нулю — убирает ореол)."""
    box = img.getchannel('A').point(lambda v: 255 if v > SOLID else 0).getbbox()
    return img.crop(box)


def has_hole(img):
    w, h = img.size
    a = img.getchannel('A')
    return all(a.getpixel((int(w * fx), int(h * fy))) < SOLID
               for fx, fy in ((.5, .5), (.42, .5), (.58, .5), (.5, .42), (.5, .58)))


def row_spans(img):
    """По строкам: (левый край, правый край) непрозрачного, или None."""
    a = img.getchannel('A').load()
    w, h = img.size
    out = []
    for y in range(h):
        xs = [x for x in range(w) if a[x, y] > 128]
        out.append((xs[0], xs[-1]) if xs else None)
    return out


def torso_rows(img, spans):
    """Самый длинный отрезок строк, где кот не меняется: та же ширина и тот же
    рисунок строки. Одной ширины мало — лапки, прижатые к груди, бывают ровно
    в ширину туловища, и плитка из них вышла бы лапками до пола."""
    widths = [s[1] - s[0] if s else 0 for s in spans]
    h = len(widths)
    mid = sorted(w for w in widths[h // 4: 3 * h // 4] if w)
    if not mid:
        die('у длинного кота нет туловища')
    ref = mid[len(mid) // 2]
    # Рисунок строки сверяется с СОСЕДНЕЙ, а не с серединой кота: GPT любит
    # тянуть по туловищу мягкий градиент, и с серединой расходятся уже верх и
    # низ ровного туловища. Соседние строки градиента почти одинаковы, а на
    # лапках и мордочке строка меняется скачком.
    px = img.load()

    def same(y):
        if y == 0:
            return False
        d = n = 0
        for x in range(0, img.width, 2):
            a, b = px[x, y], px[x, y - 1]
            d += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) + abs(a[3] - b[3])
            n += 1
        return d / n < 12

    best, start = (0, 0), None
    for y, wd in enumerate(widths + [0]):
        ok = y < h and wd and abs(wd - ref) <= max(3, ref * 0.05) and same(y)
        if ok and start is None:
            start = y
        elif not ok and start is not None:
            if y - start > best[1] - best[0]:
                best = (start, y)
            start = None
    t0, t1 = best
    if t1 - t0 < ref:
        die(f'ровное туловище слишком короткое ({t1 - t0}px при ширине {ref}px) — кот не «длинный»')
    return t0, t1, ref


def fade(img, top=0, bottom=0):
    """Погасить верхние/нижние строки по прозрачности — стык без шва."""
    a = img.getchannel('A')
    w, h = img.size
    ramp = Image.new('L', (1, h), 255)
    for y in range(h):
        k = 1.0
        if top and y < top:
            k = y / top
        if bottom and y >= h - bottom:
            k = min(k, (h - 1 - y) / bottom)
        ramp.putpixel((0, y), int(255 * k))
    img.putalpha(ImageChops.multiply(a, ramp.resize((w, h))))
    return img


def seamless(strip, h, n):
    """Плитка высотой h из куска высотой h + n: верхние n строк перетекают в низ."""
    tile = strip.crop((0, 0, strip.width, h))
    tail = strip.crop((0, h, strip.width, h + n))
    for y in range(n):
        k = y / n
        row = Image.blend(tail.crop((0, y, strip.width, y + 1)), tile.crop((0, y, strip.width, y + 1)), k)
        tile.paste(row, (0, y))
    return tile


def save(img, path):
    img.save(path, 'WEBP', quality=90, method=6)
    print(f'{os.path.relpath(path)} — {img.width}×{img.height}, {os.path.getsize(path) // 1024} КБ')


def main():
    if len(sys.argv) != 3:
        die('запуск: cut-skin.py <лист.png> <пак>')
    src, pack = sys.argv[1], sys.argv[2]
    out = os.path.normpath(os.path.join(HERE, '..', '..', 'frontend', 'src', 'assets', 'skins', pack))
    sheet = with_alpha(Image.open(src))

    found = blobs(sheet.getchannel('A'))
    if len(found) != 4:
        die(f'на листе {len(found)} предметов вместо четырёх — раскладка изменилась ({found})')
    items = [tight(sheet.crop(b)) for b in found]
    longcat = max(items, key=lambda i: i.height / i.width)
    banner = max(items, key=lambda i: i.width / i.height)
    rest = [i for i in items if i is not longcat and i is not banner]
    if len(rest) != 2 or longcat.height < longcat.width * 2.5 or banner.width < banner.height * 2.5:
        die('не узнать длинного кота и баннер по форме — раскладка изменилась')
    holed = [i for i in rest if has_hole(i)]
    if len(holed) != 1:
        die('у рамки аватара нет пустой середины (или пустая середина у обоих)')
    frame = holed[0]
    single = rest[0] if rest[1] is frame else rest[1]

    os.makedirs(out, exist_ok=True)
    meta = {}

    # Баннер — непрозрачный прямоугольник: ужать по ширине.
    b = banner.convert('RGB').resize((BANNER_W, round(banner.height * BANNER_W / banner.width)), Image.LANCZOS)
    save(b, os.path.join(out, 'banner.webp'))
    meta['banner'] = {'ratio': round(b.width / b.height, 4)}

    # Рамка: середина дыры — в центр квадрата, размер дыры — в meta (по нему
    # CSS растягивает рамку так, чтобы дыра легла ровно на аватар).
    a = frame.getchannel('A')
    cx, cy = frame.width // 2, frame.height // 2
    hole = Image.new('L', frame.size, 0)
    q, seen = deque([(cx, cy)]), {(cx, cy)}
    while q:
        x, y = q.popleft()
        hole.putpixel((x, y), 255)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in seen and 0 <= nx < frame.width and 0 <= ny < frame.height and a.getpixel((nx, ny)) < 128:
                seen.add((nx, ny))
                q.append((nx, ny))
    hx0, hy0, hx1, hy1 = hole.getbbox()
    if hx0 == 0 or hy0 == 0 or hx1 == frame.width or hy1 == frame.height:
        die('пустая середина рамки выходит за её край — кольцо незамкнуто')
    hcx, hcy, hd = (hx0 + hx1) / 2, (hy0 + hy1) / 2, ((hx1 - hx0) + (hy1 - hy0)) / 2
    side = int(2 * max(hcx, frame.width - hcx, hcy, frame.height - hcy)) + 2
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(frame, (round(side / 2 - hcx), round(side / 2 - hcy)))
    save(rs(sq, (FRAME, FRAME)), os.path.join(out, 'frame.webp'))
    meta['frame'] = {'hole': round(hd / side, 4)}

    # Кот на одну запись.
    s = rs(single, (round(single.width * SINGLE_H / single.height), SINGLE_H))
    save(s, os.path.join(out, 'single.webp'))
    meta['single'] = {'ratio': round(s.width / s.height, 4)}

    # Длинный кот → голова, туловище, лапы. Все три одной ширины: полоса
    # на капсуле одна, и куски обязаны стоять в створе.
    spans = row_spans(longcat)
    t0, t1, tw = torso_rows(longcat, spans)
    over = max(4, tw // 4)                 # сколько туловища взять в голову и в лапы
    k = STRIP_W / longcat.width
    cat = rs(longcat, (STRIP_W, round(longcat.height * k)))
    T0, T1, TW, OV = round(t0 * k), round(t1 * k), round(tw * k), round(over * k)
    head = fade(cat.crop((0, 0, STRIP_W, T0 + OV)), bottom=OV)
    feet = fade(cat.crop((0, T1 - OV, STRIP_W, cat.height)), top=OV)
    body_h, blend = max(TW // 2, 8), max(OV, 4)
    mid = (T0 + T1) // 2
    if (T1 - T0) < body_h + blend + 2 * OV:
        die('туловище короче, чем нужно на плитку')
    body = seamless(cat.crop((0, mid - body_h // 2, STRIP_W, mid - body_h // 2 + body_h + blend)), body_h, blend)
    for name, img in (('head', head), ('body', body), ('feet', feet)):
        save(img, os.path.join(out, f'{name}.webp'))
    # Высоты кусков в долях ширины полосы: из них CSS считает, какой ширины
    # полосу ставить, чтобы голова и лапы уложились в слот записи.
    meta['strip'] = {'head': round(head.height / STRIP_W, 4), 'body': round(body.height / STRIP_W, 4),
                     'feet': round(feet.height / STRIP_W, 4)}

    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    print('meta.json —', json.dumps(meta))


if __name__ == '__main__':
    main()
