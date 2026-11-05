"""Bloom a Blender render and composite it the way Foundry would: map, pf2e's aura fill, the looping texture at 0.85,
the border, Sequencer's cast on top, then the tokens."""
import sys
import numpy as np
from PIL import Image, ImageFilter

A = "bl/assets/"
BG = Image.open(A + "bg.png").convert("RGBA")
FILL = Image.open(A + "ring.png")
BORDER = Image.open(A + "border.png")
TOKENS = Image.open(A + "tokens.png")
X, Y, R = 640, 400, 250


def bloom(path, strength=1.0):
    """Straight-alpha PNG -> premultiplied, add two blurred copies of its bright parts, back to an RGBA image"""
    im = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255
    rgb, a = im[..., :3] * im[..., 3:4], im[..., 3]
    bright = np.clip(rgb - 0.5, 0, None)
    b8 = Image.fromarray((np.clip(bright, 0, 1) * 255).astype(np.uint8))
    w = im.shape[1]
    glow = sum(np.asarray(b8.filter(ImageFilter.GaussianBlur(w * k))).astype(np.float32) / 255 * g for k, g in ((0.005, 0.8), (0.015, 0.6), (0.035, 0.25)))
    rgb = rgb + glow * strength
    rgb = 1 - np.exp(-rgb * 1.15)
    a = np.clip(np.maximum(a, rgb.max(2) * 0.9), 0, 1)
    straight = np.where(a[..., None] > 1e-4, rgb / np.maximum(a[..., None], 1e-4), 0)
    return Image.fromarray((np.dstack([np.clip(straight, 0, 1), a]) * 255).astype(np.uint8), "RGBA")


def frame(loop_png=None, cast_png=None, loop_alpha=0.85):
    out = BG.copy()
    if loop_png:
        out.alpha_composite(FILL)
        tex = bloom(loop_png).resize((2 * R, 2 * R), Image.LANCZOS)
        if loop_alpha < 1:
            tex.putalpha(tex.getchannel("A").point(lambda v: int(v * loop_alpha)))
        out.alpha_composite(tex, (X - R, Y - R))
        out.alpha_composite(BORDER)
    if cast_png:
        out.alpha_composite(bloom(cast_png, 1.2).resize((2 * R, 2 * R), Image.LANCZOS), (X - R, Y - R))
    out.alpha_composite(TOKENS)
    return out.convert("RGB")


if __name__ == "__main__":
    frame(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "-" else None).save(sys.argv[3])
