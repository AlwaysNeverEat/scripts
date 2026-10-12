# Лист-ЗАГЛУШКА для пака «Котик»: та же раскладка, что просим у GPT (см.
# README.md рядом), нарисованная простыми фигурами. Нужен, чтобы механика
# скинов работала и проверялась ДО того, как придёт настоящий арт, — и чтобы
# резак (cut-skin.py) был проверен на листе, который ведёт себя как настоящий:
# прозрачный фон, четыре предмета, длинный кот с ровным туловищем.
#
# Запуск: python3 design/skins/placeholder-sheet.py design/skins/cat/sheet-placeholder.png

import sys
from PIL import Image, ImageDraw

SS = 3                      # рисуем втрое крупнее и ужимаем — сглаженные края
W, H = 1536, 1024
FUR, INK, PINK, CHEEK = (251, 227, 200, 255), (91, 58, 41, 255), (244, 160, 170, 255), (248, 190, 190, 255)
LW = 5 * SS

img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
s = lambda *v: [x * SS for x in v]


def ellipse(cx, cy, rx, ry, fill=FUR, outline=INK, width=LW):
    d.ellipse(s(cx - rx, cy - ry, cx + rx, cy + ry), fill=fill, outline=outline, width=width)


def ear(x0, y0, x1, y1, x2, y2):
    d.polygon(s(x0, y0, x1, y1, x2, y2), fill=FUR, outline=INK, width=LW)
    mx, my = (x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3
    k = 0.5
    d.polygon(s(mx + (x0 - mx) * k, my + (y0 - my) * k, mx + (x1 - mx) * k, my + (y1 - my) * k,
                mx + (x2 - mx) * k, my + (y2 - my) * k), fill=PINK)


def face(cx, cy, r):
    ear(cx - r * 0.95, cy - r * 0.35, cx - r * 0.75, cy - r * 1.35, cx - r * 0.15, cy - r * 0.85)
    ear(cx + r * 0.95, cy - r * 0.35, cx + r * 0.75, cy - r * 1.35, cx + r * 0.15, cy - r * 0.85)
    ellipse(cx, cy, r, r * 0.88)
    for side in (-1, 1):
        ellipse(cx + side * r * 0.38, cy - r * 0.02, r * 0.09, r * 0.12, fill=INK, outline=None)
        ellipse(cx + side * r * 0.58, cy + r * 0.28, r * 0.14, r * 0.08, fill=CHEEK, outline=None)
        for k in (-1, 1):
            d.line(s(cx + side * r * 0.75, cy + r * (0.18 + k * 0.07), cx + side * r * 1.25, cy + r * (0.12 + k * 0.16)), fill=INK, width=2 * SS)
    d.polygon(s(cx - r * 0.09, cy + r * 0.15, cx + r * 0.09, cy + r * 0.15, cx, cy + r * 0.27), fill=PINK)
    d.arc(s(cx - r * 0.18, cy + r * 0.18, cx, cy + r * 0.42), 0, 180, fill=INK, width=3 * SS)
    d.arc(s(cx, cy + r * 0.18, cx + r * 0.18, cy + r * 0.42), 0, 180, fill=INK, width=3 * SS)


def paw(cx, cy, r):
    ellipse(cx, cy, r, r * 0.75)
    for k in (-1, 0, 1):
        d.line(s(cx + k * r * 0.35, cy - r * 0.2, cx + k * r * 0.35, cy + r * 0.25), fill=INK, width=2 * SS)


# 1. Длинный кот слева: голова, ровное туловище, лапы и хвост.
lx, top, bottom, tw = 130, 60, 975, 112
d.arc(s(lx + 20, bottom - 210, lx + 120, bottom - 40), 270, 90, fill=INK, width=LW + 8 * SS)
d.arc(s(lx + 20, bottom - 210, lx + 120, bottom - 40), 270, 90, fill=FUR, width=8 * SS)
d.rounded_rectangle(s(lx - tw / 2, top + 120, lx + tw / 2, bottom - 40), radius=56 * SS, fill=FUR, outline=INK, width=LW)
paw(lx - 30, bottom - 30, 30)
paw(lx + 30, bottom - 30, 30)
face(lx, top + 95, 78)
paw(lx - 34, top + 205, 24)
paw(lx + 34, top + 205, 24)

# 2. Баннер справа сверху: спокойная левая часть, кот справа.
bx0, by0, bx1, by1 = 330, 50, 1490, 340
band = Image.new('RGBA', ((bx1 - bx0) * SS, (by1 - by0) * SS))
bd = ImageDraw.Draw(band)
for x in range(band.width):
    t = x / band.width
    bd.line([(x, 0), (x, band.height)], fill=(int(255 - 10 * t), int(228 - 18 * t), int(236 - 40 * t), 255))
img.alpha_composite(band, (bx0 * SS, by0 * SS))
for i, (px, py) in enumerate([(420, 270), (500, 230), (580, 280), (660, 240), (740, 290)]):
    ellipse(px, py, 11, 9, fill=(246, 196, 206, 255), outline=None)
ellipse(1260, 270, 170, 55)
face(1150, 200, 70)
paw(1080, 300, 26)
paw(1150, 305, 26)
d.arc(s(1340, 190, 1460, 300), 200, 20, fill=INK, width=LW + 6 * SS)

# 3. Рамка аватара: кольцо с ушами сверху и лапками снизу, центр пустой.
fx, fy, fr, ring = 760, 690, 210, 34
ear(fx - 150, fy - 120, fx - 160, fy - 265, fx - 40, fy - 195)
ear(fx + 150, fy - 120, fx + 160, fy - 265, fx + 40, fy - 195)
ellipse(fx, fy, fr, fr)
d.ellipse(s(fx - fr + ring, fy - fr + ring, fx + fr - ring, fy + fr - ring), fill=(0, 0, 0, 0), outline=INK, width=LW)
paw(fx - 60, fy + fr - 8, 34)
paw(fx + 60, fy + fr - 8, 34)

# 4. Кот на одну запись: сидит «буханкой».
cx, cy = 1250, 760
d.arc(s(cx + 40, cy - 20, cx + 190, cy + 160), 300, 100, fill=INK, width=LW + 8 * SS)
d.arc(s(cx + 40, cy - 20, cx + 190, cy + 160), 300, 100, fill=FUR, width=8 * SS)
ellipse(cx, cy + 70, 150, 105)
face(cx - 20, cy - 30, 95)
paw(cx - 70, cy + 160, 30)
paw(cx + 30, cy + 165, 30)

img = img.resize((W, H), Image.LANCZOS)
img.save(sys.argv[1])
