# Пересборка камня поддержавшего из оригинала 512px (см. README.md рядом).
#   python3 -m venv /tmp/v && /tmp/v/bin/pip install Pillow
#   /tmp/v/bin/python design/badges/gem-resize.py design/badges/supporter-gem-512.webp \
#       frontend/src/assets/badges/supporter-gem.webp \
#       frontend/src/assets/badges/supporter-gem-still.webp 64
# Кадры и их длительности переносятся как есть, loop=0 — бесконечный повтор.
import sys
from PIL import Image, ImageSequence
src, out_anim, out_still, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
im = Image.open(src)
frames, durs = [], []
for f in ImageSequence.Iterator(im):
    durs.append(f.info.get('duration', 40))
    frames.append(f.convert('RGBA').resize((size, size), Image.LANCZOS))
frames[0].save(out_anim, 'WEBP', save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=80, method=6, lossless=False, minimize_size=True)
frames[0].save(out_still, 'WEBP', quality=90, method=6)
print(len(frames), 'frames, total', sum(durs), 'ms')
