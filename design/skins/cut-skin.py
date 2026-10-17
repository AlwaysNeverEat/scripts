# Нарезка листа скина (см. README.md рядом) на картинки для сайта.
#
# Лист — ПОКАЗ, а не спрайт: GPT раскладывает четыре предмета как хочет, и
# координаты «на глаз» он не держит. Поэтому предметы ищутся как связные пятна
# «не прозрачно» и узнаются ПО ФОРМЕ, а не по месту:
#   • самый вытянутый ввысь — длинный кот (капсулы записей);
#   • самый вытянутый вширь — баннер карточки лида;
#   • из двух оставшихся тот, у кого в середине дыра, — рамка аватара (с --hat
#     рамки-кольца нет: внизу по центру лежит ШАПКА, она садится на макушку;
#     с --band там ОБОДОК с рожками, дуга обнимает аватар);
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
# Насколько соседние строки туловища могут различаться (средняя разница каналов).
# 12 — мультяшный кот с гладкой заливкой. У реалистичного листа (короб Матиза
# с фактурой ткани) соседние строки рябят сильнее, и ровного туловища с таким
# допуском не найти — для него резак запускают с --rough.
ROW_TOL = 12

# Размеры на выходе — с запасом под плотность пикселей 2×.
STRIP_W = 112       # ширина полосы длинного кота (на капсуле ~44px)
SINGLE_H = 128      # высота кота на одну запись (капсула ~39px)
FRAME = 384         # сторона рамки (аватар 96px, рамка шире него)
BANNER_W = 1400     # баннер карточки лида (карточка до ~1000px)
LEADS_H = 160       # своя полоса строки звонка (--leads): строка ~56px, запас под 2× и больше


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


def blobs(alpha, join=JOIN, solid=SOLID):
    """Пятна «не прозрачно» по грубой сетке: [(x0, y0, x1, y1), …] в пикселях листа."""
    w, h = alpha.size
    gw, gh = (w + CELL - 1) // CELL, (h + CELL - 1) // CELL
    small = alpha.point(lambda v: 255 if v > solid else 0).resize((gw, gh), Image.BOX)
    grid = small.point(lambda v: 255 if v > 8 else 0)
    if join:
        grid = grid.filter(ImageFilter.MaxFilter(join * 2 + 1))
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


# Попытки найти ровно `want` предметов: сперва с запасом, который собирает
# предмет из кусочков (хвост отдельно от кота), потом всё строже. GPT ставит
# предметы как придётся, и бывает, что тыква на рамке почти касается низа
# баннера — тогда запас сшивает их в один, а без запаса они разделяются.
def carve_bands(sheet, gap=2 * CELL + 2):
    """Отрезать сплошные полосы (шапку, полосу лидов) от того, что к ним
    прилипло. На тесном листе в шесть предметов GPT дотягивает соседей до
    края полосы вплотную (поднятый меч Лича упёрся в полосу лидов), и пятна
    склеиваются при любом допуске. Полоса узнаётся по строкам, где сплошной
    непрозрачный отрезок шире половины листа; под и над такими строками
    прорезается зазор шире двух клеток поиска (иначе пятна по сетке CELL
    остаются соседями) — сосед теряет десяток пикселей, а не весь лист."""
    a = sheet.getchannel('A')
    w, h = a.size
    px = a.load()

    def solid_run(y):
        """Строка полосы: самый длинный сплошной отрезок шире половины листа,
        расширенный влево и вправо через МЕЛКИЕ разрывы (до 8px): у края
        полосы сглаженные пиксели рвут отрезок, а соседний предмет (меч слева)
        отделён настоящим промежутком — на нём расширение и встаёт."""
        run, best = 0, (0, -1)
        for x in range(w):
            run = run + 1 if px[x, y] > SOLID else 0
            if run > best[1] - best[0] + 1:
                best = (x - run + 1, x)
        if best[1] - best[0] + 1 <= w // 2:
            return None
        x0, x1 = best

        def grow(x, step):
            gap = 0
            while 0 <= x + step < w and gap <= 8:
                x += step
                gap = 0 if px[x, y] > SOLID else gap + 1
            return x - step * gap
        return grow(x0, -1), grow(x1, 1)
    runs = [solid_run(y) for y in range(h)]
    # Зазор — только в ширину самой полосы: меч слева тянется на весь лист
    # в высоту, и строка целиком разрубила бы его на куски.
    for y in range(h):
        r = runs[y]
        if not r:
            continue
        x0, x1 = r
        if y + 1 >= h or not runs[y + 1]:
            for yy in range(y + 1, min(h, y + 1 + gap)):
                for x in range(x0, x1 + 1):
                    px[x, yy] = 0
        if y == 0 or not runs[y - 1]:
            for yy in range(max(0, y - gap), y):
                for x in range(x0, x1 + 1):
                    px[x, yy] = 0
    sheet.putalpha(a)


def find_items(alpha, want):
    for join, solid in ((JOIN, SOLID), (1, 100), (0, 160)):
        found = blobs(alpha, join, solid)
        if len(found) == want:
            return found
    die(f'на листе {len(found)} предметов вместо {want} — раскладка изменилась ({found})')


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
        return d / n < ROW_TOL

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


def save_ring(frame, out, meta, fx=None):
    """Рамка: середина дыры — в центр квадрата, размер дыры — в meta (по нему
    CSS растягивает рамку так, чтобы дыра легла ровно на аватар).

    fx — та же рамка во втором состоянии. Дыры у неё может и не быть (лёд
    затягивает фото), поэтому совмещается она по ВНЕШНЕМУ краю: обе картинки
    обрезаны впритык (tight), и вторая растягивается до размеров первой и
    кладётся в квадрат тем же сдвигом."""
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
    if fx is not None:
        sq2 = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq2.paste(rs(fx, frame.size), (round(side / 2 - hcx), round(side / 2 - hcy)))
        save(rs(sq2, (FRAME, FRAME)), os.path.join(out, 'frame-fx.webp'))
        meta['frame']['fx'] = True


# Шапка в долях диаметра аватара: ОПУШКА шириной чуть меньше аватара, а низом
# заходит на него больше чем на треть — сидит на макушке, а не парит над головой.
HAT_W = 0.92
HAT_OVERLAP = 0.38


def save_hat(hat, out, meta):
    """Рамка-шапка (--hat): кольца нет, аватар не обводится, а «надевает»
    шапку. CSS про это не знает — квадрат строится так же, с аватаром в
    центре, и `hole` в meta — это доля аватара в квадрате, как у кольца."""
    # Меряем по ОПУШКЕ (нижней пятой шапки), а не по всей картинке: кончик с
    # помпоном свисает вбок, и по рамке картинки шапка садилась бы набекрень
    # мимо головы. Опушка — по центру аватара и шириной HAT_W.
    a = hat.getchannel('A').load()
    xs = [x for y in range(hat.height * 4 // 5, hat.height) for x in range(hat.width) if a[x, y] > 128]
    bx0, bx1 = min(xs), max(xs)
    D = 1000
    k = HAT_W * D / (bx1 - bx0)
    w, h = round(hat.width * k), round(hat.height * k)
    off = ((bx0 + bx1) / 2 - hat.width / 2) * k     # насколько середина опушки правее середины картинки
    rise = D / 2 - HAT_OVERLAP * D + h          # от центра аватара до верха шапки
    reach = w / 2 + abs(off)                     # от центра аватара до дальнего бока шапки
    side = int(2 * max(D / 2, reach, rise)) + 2
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    c = side / 2
    sq.paste(rs(hat, (w, h)), (round(c - w / 2 - off), round(c - rise)))
    save(rs(sq, (FRAME, FRAME)), os.path.join(out, 'frame.webp'))
    meta['frame'] = {'hole': round(D / side, 4), 'hat': True}


# Ободок (рожки оленя): дуга сама нарисована по кругу головы, и кончики её
# расходятся ровно на ширину этой головы. Поэтому ширина аватара — расстояние
# между кончиками (с волоском запаса), а по высоте внутренний край дуги ложится
# на макушку с нахлёстом BAND_OVERLAP: так ободок обнимает аватар, а не висит
# над ним, как висел бы, если сажать его по-шапочному — низом на треть.
BAND_W = 1.02
BAND_OVERLAP = 0.04


def save_band(band, out, meta):
    """Рамка-ободок (--band): как шапка, но мерится по кончикам и по
    внутреннему краю дуги посередине."""
    a = band.getchannel('A').load()
    xs = [x for y in range(band.height * 9 // 10, band.height) for x in range(band.width) if a[x, y] > 128]
    bx0, bx1 = min(xs), max(xs)
    mid = (bx0 + bx1) // 2
    # Внутренний край дуги: от низа по середине вверх до первого рисунка.
    seat = next((y for y in range(band.height - 1, -1, -1) if a[mid, y] > 128), None)
    if seat is None or seat > band.height * 0.9:
        die('у ободка не видно дуги посередине — внизу по центру сплошной рисунок')
    D = 1000
    k = D * BAND_W / (bx1 - bx0)
    w, h = round(band.width * k), round(band.height * k)
    off = ((bx0 + bx1) / 2 - band.width / 2) * k
    seat_y = -D / 2 + BAND_OVERLAP * D           # где внутренний край дуги, от центра аватара
    top = seat_y - seat * k                      # верх картинки, от центра аватара
    reach = max(w / 2 + abs(off), -top, top + h)
    side = int(2 * max(D / 2, reach)) + 2
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    c = side / 2
    sq.paste(rs(band, (w, h)), (round(c - w / 2 - off), round(c + top)))
    save(rs(sq, (FRAME, FRAME)), os.path.join(out, 'frame.webp'))
    meta['frame'] = {'hole': round(D / side, 4), 'hat': True}


def main():
    global ROW_TOL
    args = [a for a in sys.argv[1:] if a not in ('--rough', '--hat', '--band', '--fx', '--leads')]
    if '--rough' in sys.argv:
        ROW_TOL = 30
    band_mode = '--band' in sys.argv
    hat_mode = '--hat' in sys.argv or band_mode
    fx_mode = '--fx' in sys.argv
    leads_mode = '--leads' in sys.argv
    if len(args) != 2:
        die('запуск: cut-skin.py <лист.png> <пак> [--rough] [--hat | --band] [--fx] [--leads]')
    src, pack = args
    out = os.path.normpath(os.path.join(HERE, '..', '..', 'frontend', 'src', 'assets', 'skins', pack))
    sheet = with_alpha(Image.open(src))

    if leads_mode:
        carve_bands(sheet)
    found = find_items(sheet.getchannel('A'), 4 + fx_mode + leads_mode)
    items = [tight(sheet.crop(b)) for b in found]
    left_of = {id(i): b[0] for i, b in zip(items, found)}
    longcat = max(items, key=lambda i: i.height / i.width)
    # --leads: у пака своя полоса для строки звонка — она ПЛОЩЕ шапки профиля.
    # Иначе звонок рисуется той же шапкой, и на лидах видно ровно то же, что в
    # профиле (у легендарки это выглядит дёшево).
    wide = sorted(items, key=lambda i: i.width / i.height, reverse=True)
    leads = wide[0] if leads_mode else None
    banner = wide[1] if leads_mode else wide[0]
    rest = [i for i in items if i is not longcat and i is not banner and i is not leads]
    # --fx: внизу ТРИ предмета слева направо — рамка, та же рамка во втором
    # состоянии (лёд у Саб-Зиро) и кот на одну запись. Второе состояние сайт
    # проявляет поверх первого (skins.css, «Второе состояние рамки»).
    fx = None
    if fx_mode:
        if len(rest) != 3:
            die('с --fx внизу должно быть три предмета: рамка, рамка во втором состоянии, кот')
        rest.sort(key=lambda i: left_of[id(i)])
        fx = rest.pop(1)
    if len(rest) != 2 or longcat.height < longcat.width * 2.5 or banner.width < banner.height * 2.5:
        die('не узнать длинного кота и баннер по форме — раскладка изменилась')
    if hat_mode:
        # Вместо кольца — шапка: на листе она внизу ПО ЦЕНТРУ, кот — справа.
        frame = min(rest, key=lambda i: left_of[id(i)])
    else:
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
    if leads is not None:
        if leads.width < leads.height * 4:
            die('полоса для лидов не плоская — раскладка изменилась')
        ld = leads.convert('RGB').resize((round(leads.width * LEADS_H / leads.height), LEADS_H), Image.LANCZOS)
        save(ld, os.path.join(out, 'leads.webp'))
        meta['leads'] = {'ratio': round(ld.width / ld.height, 4)}

    if band_mode:
        save_band(frame, out, meta)
    elif hat_mode:
        save_hat(frame, out, meta)
    else:
        save_ring(frame, out, meta, fx)

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
