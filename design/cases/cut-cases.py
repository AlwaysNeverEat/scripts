# Нарезка листа кейсов (README.md рядом) на картинки для окна кейсов.
#
# Лист — показ, а не спрайт: предметы ищутся как пятна «не прозрачно» тем же
# кодом, что режет скины (design/skins/cut-skin.py), и узнаются по месту:
# верхний широкий — обложка, нижний ряд слева направо — ключ, малый сундук
# закрытый и открытый, большой закрытый и открытый.
#
# Пару «закрыт / открыт» GPT рисует разного размера (у большого открытый
# корпус заметно уже). Окно подменяет картинку НА МЕСТЕ, поэтому открытый
# подгоняется по ширине корпуса, и оба кладутся на общий холст по низу и
# центру: корпус стоит там же, а крышка просто откидывается — иначе сундук при
# открытии «прыгал» бы.
#
# Запуск: python3 design/cases/cut-cases.py design/cases/sheet.png
#   → frontend/src/assets/cases/{cover,key,chest-small,chest-small-open,chest-big,chest-big-open}.webp

import importlib.util
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('cut_skin', os.path.join(HERE, '..', 'skins', 'cut-skin.py'))
cs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cs)

OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'frontend', 'src', 'assets', 'cases'))
COVER_W = 1400
KEY = 160          # сторона ключа (на экране до ~40px)
CHEST = 400        # сторона холста сундука (на экране до ~200px)


def fit(img, side):
    """В квадрат side×side, по низу и центру, без растяжения."""
    k = side / max(img.width, img.height)
    small = cs.rs(img, (max(1, round(img.width * k)), max(1, round(img.height * k))))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(small, ((side - small.width) // 2, side - small.height))
    return sq


def base_width(img):
    """Ширина корпуса — по нижней пятой картинки: там крышки нет ни у какого."""
    a = img.getchannel('A')
    band = a.crop((0, round(img.height * 0.8), img.width, img.height)).point(lambda v: 255 if v > cs.SOLID else 0)
    box = band.getbbox()
    return box[2] - box[0] if box else img.width


def pair(closed, opened):
    """Оба сундука на общий холст: низ и центр совпадают, а открытый ужат или
    растянут так, чтобы КОРПУС был той же ширины, — GPT рисует их разного
    размера, и без этого сундук при открытии сжимался бы на глазах."""
    k = base_width(closed) / base_width(opened)
    if abs(k - 1) > 0.01:
        opened = cs.rs(opened, (round(opened.width * k), round(opened.height * k)))
    w, h = max(closed.width, opened.width), max(closed.height, opened.height)
    out = []
    for im in (closed, opened):
        c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        c.paste(im, ((w - im.width) // 2, h - im.height))
        out.append(fit(c, CHEST))
    return out


def main():
    if len(sys.argv) != 2:
        cs.die('запуск: cut-cases.py <лист.png>')
    sheet = cs.with_alpha(Image.open(sys.argv[1]))
    found = cs.find_items(sheet.getchannel('A'), 6)
    cover = max(found, key=lambda b: (b[2] - b[0]) / (b[3] - b[1]))
    row = sorted((b for b in found if b is not cover), key=lambda b: b[0])
    if (cover[2] - cover[0]) < 2.5 * (cover[3] - cover[1]) or any(b[1] < cover[3] - 10 for b in row):
        cs.die('обложка не сверху или не широкая — раскладка изменилась')
    key, sm, sm_open, big, big_open = (cs.tight(sheet.crop(b)) for b in row)

    os.makedirs(OUT, exist_ok=True)
    c = cs.tight(sheet.crop(cover)).convert('RGB')
    cs.save(c.resize((COVER_W, round(c.height * COVER_W / c.width)), Image.LANCZOS), os.path.join(OUT, 'cover.webp'))
    cs.save(fit(key, KEY), os.path.join(OUT, 'key.webp'))
    for name, im in zip(('chest-small', 'chest-small-open'), pair(sm, sm_open)):
        cs.save(im, os.path.join(OUT, f'{name}.webp'))
    for name, im in zip(('chest-big', 'chest-big-open'), pair(big, big_open)):
        cs.save(im, os.path.join(OUT, f'{name}.webp'))


if __name__ == '__main__':
    main()
