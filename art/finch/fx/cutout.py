"""Cut a sprite out of a flat black background: bright parts opaque, dim glow partly transparent, black gone."""
import sys
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
m = im.max(axis=2)
# JPEG leaves faint noise in the black; ignore anything below the floor
floor, full = 0.06, 0.38
a = np.clip((m - floor) / (full - floor), 0, 1) ** 1.1
rgb = np.where(a[..., None] > 0, np.clip(im / np.maximum(a[..., None], 1e-3), 0, 1), 0)
out = np.dstack([rgb, a])
img = Image.fromarray((out * 255).astype(np.uint8), "RGBA")
img = img.crop(img.getbbox())
img.save(dst)
print(dst, img.size)
