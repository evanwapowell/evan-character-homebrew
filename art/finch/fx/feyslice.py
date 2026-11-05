import numpy as np
from PIL import Image
from scipy import ndimage
im = np.asarray(Image.open("sprites/raw/fey-sheet.jpg").convert("RGB")).astype(np.float32) / 255
m = im.max(2)
a = np.clip((m - 0.08) / (0.45 - 0.08), 0, 1)
core = m > 0.35
rows = [(104, 552), (810, 1307), (1498, 1941)]
n = 0
for y0, y1 in rows:
    blob = ndimage.binary_dilation(core[y0:y1], structure=np.ones((71, 5)))
    lab, k = ndimage.label(blob)
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(core[y0:y1], lab, range(1, k + 1))
    items = sorted([(o[1].start, o, i + 1) for i, o in enumerate(objs) if sizes[i] > 800])
    print("row", y0, "->", len(items), "glyphs")
    for x, o, idx in items:
        n += 1
        sel = ndimage.binary_dilation(lab[o] == idx, iterations=8)
        ys, xs = slice(y0 + o[0].start, y0 + o[0].stop), o[1]
        alpha = a[ys, xs] * sel
        rgb = np.clip(im[ys, xs] / np.maximum(alpha[..., None], 1e-3), 0, 1)
        g = Image.fromarray((np.dstack([rgb, alpha]) * 255).astype(np.uint8), "RGBA")
        g.crop(g.getbbox()).save(f"sprites/fey/{n:02d}.png")
cols = 8
sheet = Image.new("RGBA", (cols * 150, ((n + cols - 1) // cols) * 190), (40, 40, 50, 255))
for i in range(n):
    g = Image.open(f"sprites/fey/{i+1:02d}.png"); s = min(130 / g.width, 170 / g.height)
    g = g.resize((int(g.width * s), int(g.height * s)), Image.LANCZOS)
    sheet.alpha_composite(g, ((i % cols) * 150 + (150 - g.width) // 2, (i // cols) * 190 + (190 - g.height) // 2))
sheet.convert("RGB").save("fx/out/fey-sliced.png")
print(n)
