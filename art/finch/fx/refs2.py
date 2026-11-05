"""Richer reference glyphs for the carved runes and the technical notation: 24 distinct each, white on black."""
import random
from PIL import Image, ImageDraw

def sheet(make, path, seed, keyf):
    r = random.Random(seed)
    glyphs, seen = [], set()
    while len(glyphs) < 24:
        g = make(r)
        k = keyf(g)
        if k in seen:
            continue
        seen.add(k)
        glyphs.append(g)
    im = Image.new("RGB", (1200, 1200), "black")
    d = ImageDraw.Draw(im)
    for i, g in enumerate(glyphs):
        cx, cy = 120 + (i % 6) * 192, 190 + (i // 6) * 260
        for kind, pts in g:
            P = [(cx + x * 120, cy + y * 120) for x, y in pts]
            if kind == "line":
                d.line(P, fill="white", width=11, joint="curve")
                for p in (P[0], P[-1]):
                    d.ellipse((p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5), fill="white")
            elif kind == "ring":
                (x, y), = P
                d.ellipse((x - 14, y - 14, x + 14, y + 14), outline="white", width=8)
            elif kind == "dot":
                (x, y), = P
                d.ellipse((x - 11, y - 11, x + 11, y + 11), fill="white")
            elif kind == "box":
                (x, y), = P
                d.rectangle((x - 12, y - 12, x + 12, y + 12), fill="white")
    im.save(path)

def rune(r):
    """Carved runes: one stem cut with two or three features (no forks or second stems, which read as Y, H or N)"""
    out = [("line", [(0.0, -0.5), (0.0, 0.5)])]
    ys = r.sample([-0.42, -0.15, 0.12, 0.38], k=2 + r.randrange(2))
    for y in ys:
        f = r.choice(["branch", "branch", "chevron", "diamond", "tick", "barb"])
        s = r.choice([-1, 1])
        if f == "branch":
            out.append(("line", [(0.0, y), (s * 0.3, y + r.choice([-0.2, 0.2]))]))
        elif f == "chevron":
            out.append(("line", [(-0.22, y + 0.2), (0.0, y), (0.22, y + 0.2)]))
        elif f == "diamond":
            out.append(("line", [(0.0, y - 0.12), (0.16, y + 0.05), (0.0, y + 0.22), (-0.16, y + 0.05), (0.0, y - 0.12)]))
        elif f == "tick":
            out.append(("line", [(-0.14, y + 0.08), (0.14, y - 0.08)]))
        else:
            out.append(("line", [(0.0, y), (s * 0.18, y - 0.12), (s * 0.18, y + 0.08)]))
    return out

def notation(r):
    """Arcane technical notation: right-angled paths on a 3x3 grid, ending in rings, dots or small squares"""
    nodes = [(x, y) for x in (-0.3, 0.0, 0.3) for y in (-0.45, 0.0, 0.45)]
    out = []
    p = r.choice(nodes)
    path = [p]
    for _ in range(3 + r.randrange(2)):
        q = r.choice([n for n in nodes if (n[0] == p[0]) != (n[1] == p[1]) and n not in path])
        path.append(q)
        p = q
    out.append(("line", path))
    out.append((r.choice(["ring", "dot", "box"]), [path[-1]]))
    out.append((r.choice(["ring", "dot"]), [path[0]]))
    if r.random() < 0.4:
        m = path[1]
        out.append(("line", [(m[0] - 0.12, m[1]), (m[0] + 0.12, m[1])] if path[0][0] == m[0] else [(m[0], m[1] - 0.12), (m[0], m[1] + 0.12)]))
    return out

key = lambda g: repr(sorted(repr(x) for x in g))
sheet(rune, "script-refs/runic.png", 21, key)
sheet(notation, "script-refs/circuit.png", 23, key)
ims = [Image.open(f"script-refs/{s}.png").resize((500, 500)) for s in ["runic", "circuit"]]
sh = Image.new("RGB", (1000, 500))
for i, im in enumerate(ims):
    sh.paste(im, (i * 500, 0))
sh.save("fx/out/refs2.png")
