"""Cut a sprite out of black and recolour it to the shared palette, so every face shares one tint."""
import sys
import numpy as np
from PIL import Image
src, dst, tint = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
m = im.max(axis=2)
floor, full = 0.07, 0.4
a = np.clip((m - floor) / (full - floor), 0, 1) ** 1.1
lum = (0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2])
lum = np.clip(lum / np.maximum(a, 1e-3), 0, 1)
# Map brightness through a gradient: slate shadow -> cool porcelain -> white, keeping the original's light and shade
ramps = {
    "porcelain": [(0.0, (0.20, 0.22, 0.30)), (0.45, (0.50, 0.54, 0.66)), (0.75, (0.80, 0.83, 0.92)), (1.0, (0.97, 0.98, 1.0))],
    "slate": [(0.0, (0.14, 0.15, 0.18)), (0.45, (0.36, 0.38, 0.43)), (0.75, (0.55, 0.58, 0.63)), (1.0, (0.78, 0.80, 0.84))],
}[tint]
xs = np.array([p for p, _ in ramps])
out = np.zeros(im.shape, np.float32)
for c in range(3):
    out[..., c] = np.interp(lum, xs, np.array([col[c] for _, col in ramps]))
# Keep a little of the original colour so the silver crown and hues don't go flat
out = out * 0.85 + np.clip(im / np.maximum(a[..., None], 1e-3), 0, 1) * 0.15
img = Image.fromarray((np.dstack([out, a]) * 255).astype(np.uint8), "RGBA")
img = img.crop(img.getbbox())
img.save(dst)
print(dst, img.size)
