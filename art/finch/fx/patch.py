"""A terrain patch: keep the painting opaque, trim off the bright outline Gemini drew, and feather the edge."""
import sys
import numpy as np
from PIL import Image, ImageFilter
src, dst, trim = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src).convert("RGB")
im = np.asarray(img).astype(np.float32) / 255
solid = (im.max(axis=2) > 0.12).astype(np.uint8) * 255
m = Image.fromarray(solid, "L").filter(ImageFilter.MedianFilter(9))
# fill holes: anything enclosed counts as inside
from PIL import ImageDraw
filled = m.copy()
ImageDraw.floodfill(filled, (0, 0), 128)
filled = filled.point(lambda v: 0 if v == 128 else 255)
for _ in range(trim):
    filled = filled.filter(ImageFilter.MinFilter(9))
alpha = filled.filter(ImageFilter.GaussianBlur(14))
# a ragged, noisy edge rather than a clean blur
noise = Image.effect_noise(img.size, 80).filter(ImageFilter.GaussianBlur(6))
a = np.asarray(alpha).astype(np.float32) / 255
nz = np.asarray(noise).astype(np.float32) / 255
a = np.clip((a - 0.5) * 2.2 + (nz - 0.5) * 0.6 * (1 - np.abs(a - 0.5) * 2) + 0.5, 0, 1)
out = Image.fromarray((np.dstack([im, a]) * 255).astype(np.uint8), "RGBA")
out = out.crop(out.getbbox())
out.save(dst)
print(dst, out.size)
