"""Ищет одиночные «вспышки» — кадры, где разница с соседом втрое больше, чем
у соседних пар. Так ловится кадр, в котором половина экрана сменилась разом
(заливка без запаса за углы, пропавший слой). Удары «Тыдыщ!» — законные
скачки, их список печатается отдельно, чтобы сверить глазами.

    ffmpeg -i ролик.mp4 -vf scale=160:90,format=gray -f rawvideo - | python3 popscan.py 60
"""
import sys

fps = float(sys.argv[1]) if len(sys.argv) > 1 else 60
W, H = 160, 90
data = sys.stdin.buffer.read()
n = len(data) // (W * H)
frames = [data[i * W * H:(i + 1) * W * H] for i in range(n)]
d = [0.0] + [sum(abs(a - b) for a, b in zip(frames[i], frames[i - 1])) / (W * H) for i in range(1, n)]
HIT0, BAR = 22.68, 4 * 60 / 114
hits = [HIT0 + k * BAR for k in range(8)]
for i in range(2, n - 2):
    around = max(d[i - 2], d[i - 1], d[i + 1], d[i + 2], 0.5)
    if d[i] > 3 * around and d[i] > 4:
        t = i / fps
        tag = 'удар' if any(abs(t - h) < 0.05 for h in hits) else 'ПРОВЕРИТЬ'
        print(f'{t:7.3f} с  кадр {i:5d}  Δ={d[i]:6.1f}  соседи ≤ {around:5.1f}  {tag}')
print(f'кадров: {n}')
