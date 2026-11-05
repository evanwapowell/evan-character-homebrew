"""Cut glowing sprites out of black and slice a sheet into its separate items (rows, then columns, split at gaps)."""
import sys
import numpy as np
from PIL import Image

def alpha_of(im, floor=0.07, full=0.4):
    m = im.max(axis=2)
    return np.clip((m - floor) / (full - floor), 0, 1) ** 1.1

def runs(profile, min_gap):
    """Spans where profile is non-zero, merging gaps shorter than min_gap"""
    on = profile > 0
    spans, start, gap = [], None, 0
    for i, v in enumerate(on):
        if v:
            if start is None:
                start = i
            gap = 0
            end = i
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                spans.append((start, end + 1))
                start = None
    if start is not None:
        spans.append((start, end + 1))
    return spans

src, prefix = sys.argv[1], sys.argv[2]
FLOOR, FULL = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0.07, 0.4)
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
a = alpha_of(im, FLOOR, FULL)
mask = a > 0.05
rgb = np.clip(im / np.maximum(a[..., None], 1e-3), 0, 1)
rgba = (np.dstack([rgb, a]) * 255).astype(np.uint8)
n = 0
for y0, y1 in runs(mask.sum(1), 40):
    for x0, x1 in runs(mask[y0:y1].sum(0), 40):
        if (x1 - x0) * (y1 - y0) < 150 * 150:
            continue
        n += 1
        pad = 20
        crop = Image.fromarray(rgba[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad], "RGBA")
        crop.save(f"{prefix}-{n}.png")
        print(f"{prefix}-{n}.png", crop.size)
