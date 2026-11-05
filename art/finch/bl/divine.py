"""Manifest Will (divine), "Requiem of Forgotten Gods": a divine storm front, in Blender.

Billowing storm cloud, tinted in patches with the forgotten faiths' colours and lit (not glowing) so it has real form;
flashes of coloured lightning inside it, each a faith's colour, flickering like lightning and lighting the cloud from
within; the forgotten gods' sigils half-hidden in the cloud; a few feathers and lost trinkets drifting. The intro bursts
the storm out from Finch with a crack of holy light.

  python divine.py --mode loop|intro --out DIR [--frames A-B] [--res 600] [--samples 20]
"""

import argparse
import math
import os
import random

import bpy  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(HERE, "..", "sprites")
TAU = math.tau
LOOP_FRAMES, INTRO_FRAMES = 480, 60

ap = argparse.ArgumentParser()
ap.add_argument("--mode", default="loop")
ap.add_argument("--out", default=os.path.join(HERE, "divine-out"))
ap.add_argument("--frames", default=None)
ap.add_argument("--res", type=int, default=600)
ap.add_argument("--samples", type=int, default=20)
args = ap.parse_args()

src = open(os.path.join(HERE, "occult.py")).read()
exec(compile("import bmesh\n" + src[src.index("def clamp"):src.index("# --------------------------------------------------------------------------------------------------- build")], "occult-helpers", "exec"))
sc = bpy.context.scene
sc.render.use_motion_blur = False
sc.cycles.volume_step_rate = 1.5
R = random.Random(23)

FAITHS = [(1.0, 0.82, 0.5), (0.7, 0.62, 1.0), (1.0, 0.92, 0.72), (0.45, 0.4, 0.95), (1.0, 0.72, 0.38)]
GOLDS = [(1.0, 0.82, 0.5), (1.0, 0.92, 0.72), (1.0, 0.72, 0.38)]
VIOLETS = [(0.5, 0.42, 1.0), (0.38, 0.36, 0.85), (0.7, 0.62, 1.0)]
HOLY = (1.0, 0.95, 0.82)


def cloud_material():
    """Billowing storm cloud that scatters light, tinted in patches with the faiths' colours"""
    m, nt = new_mat("cloud")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    co = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]

    def offset(prefix):
        cx = nt.nodes.new("ShaderNodeCombineXYZ")
        for i, axis in enumerate("xyz"):
            nt.links.new(value(nt, f"{prefix}{axis}"), cx.inputs[i])
        return cx.outputs[0]

    def vop(op, a, b=None, s=None):
        n = nt.nodes.new("ShaderNodeVectorMath")
        n.operation = op
        nt.links.new(a, n.inputs[0])
        if b is not None:
            nt.links.new(b, n.inputs[1])
        if s is not None:
            n.inputs["Scale"].default_value = s
        return n.outputs[0]

    stretch = nt.nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    nt.links.new(co, stretch.inputs[0])
    stretch.inputs[1].default_value = (1.0, 1.0, 3.0)  # taller billows than the slab is thick
    p = stretch.outputs[0]
    n1 = node(nt, "ShaderNodeTexNoise", Scale=1.0, Detail=3.0, Roughness=0.5)
    nt.links.new(vop("ADD", vop("SCALE", p, s=1.3), offset("o1")), n1.inputs["Vector"])
    warp = nt.nodes.new("ShaderNodeVectorMath")
    warp.operation = "MULTIPLY_ADD"
    nt.links.new(n1.outputs["Color"], warp.inputs[0])
    warp.inputs[1].default_value = (2.0, 2.0, 2.0)
    warp.inputs[2].default_value = (-1.0, -1.0, -1.0)
    wp = vop("ADD", vop("ADD", vop("SCALE", p, s=2.2), warp.outputs[0]), offset("o2"))
    n2 = node(nt, "ShaderNodeTexNoise", Scale=1.0, Detail=8.0, Roughness=0.62)
    nt.links.new(wp, n2.inputs["Vector"])
    puff = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", n2.outputs["Fac"], 0.4), 3.5, clamp_=True)
    n3 = node(nt, "ShaderNodeTexNoise", Scale=0.6, Detail=1.0, Roughness=0.4)
    nt.links.new(vop("ADD", co, offset("o3")), n3.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    nt.links.new(n3.outputs["Fac"], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    stops = [0.36, 0.45, 0.5, 0.55, 0.64]
    els[0].position, els[0].color = stops[0], (*FAITHS[0], 1)
    els[1].position, els[1].color = stops[-1], (*FAITHS[-1], 1)
    for pos, c in zip(stops[1:-1], FAITHS[1:-1]):
        e = els.new(pos)
        e.color = (*c, 1)
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.inputs["Factor"].default_value = 0.15
    tint.inputs["A"].default_value = (0.62, 0.63, 0.7, 1)
    nt.links.new(ramp.outputs["Color"], tint.inputs["B"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(co, sep.inputs[0])
    r = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", sep.outputs[0], sep.outputs[0]), math_node(nt, "MULTIPLY", sep.outputs[1], sep.outputs[1])))
    rim = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", 0.985, r), 20.0, clamp_=True)
    grow = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", value(nt, "billow", 2.0), r), 4.0, clamp_=True)
    # thinner over the middle so the tokens there stay readable
    clear = nt.nodes.new("ShaderNodeMapRange")
    clear.interpolation_type = "SMOOTHSTEP"
    nt.links.new(r, clear.inputs["Value"])
    clear.inputs["From Min"].default_value = 0.1
    clear.inputs["From Max"].default_value = 0.7
    clear.inputs["To Min"].default_value = 0.45
    clear.inputs["To Max"].default_value = 1.0
    mask = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", rim, grow), clear.outputs["Result"])
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    nt.links.new(tint.outputs["Result"], vol.inputs["Color"])
    vol.inputs["Anisotropy"].default_value = 0.25
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "ADD", math_node(nt, "MULTIPLY", math_node(nt, "POWER", puff, 1.2), 12.0), 0.35), mask), vol.inputs["Density"])
    # a faint glow of their own so the billows read between flashes
    nt.links.new(ramp.outputs["Color"], vol.inputs["Emission Color"])
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", math_node(nt, "POWER", puff, 3.0), 0.35), mask), vol.inputs["Emission Strength"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return m


def colour_points(name, n, colour):
    m, nt = new_mat(name + "-mat")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    br = nt.nodes.new("ShaderNodeAttribute")
    br.attribute_name = "bright"
    e = node(nt, "ShaderNodeEmission", Color=(*colour, 1))
    nt.links.new(math_node(nt, "MULTIPLY", br.outputs["Fac"], 7.0), e.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(math_node(nt, "MINIMUM", math_node(nt, "MULTIPLY", br.outputs["Fac"], 1.5), 1.0), mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(e.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return points(name, n, m)


def set_points(cloud, co, radius, bright):
    me = cloud.data
    me.vertices.foreach_set("co", co)
    me.attributes["radius"].data.foreach_set("value", radius)
    me.attributes["bright"].data.foreach_set("value", bright)
    me.update()



# --------------------------------------------------------------------------------------------------- build

bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=1.0, depth=0.36, location=(0, 0, -0.18))
cloud = bpy.context.active_object
cloud_mat = cloud_material()
cloud.data.materials.append(cloud_mat)


def front_material(name, tint):
    """One storm front: a lumpy cloud mass with a hard, billowing edge, tinted one faith's colour"""
    m, nt = new_mat(name)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    co = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    off = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, axis in enumerate("xyz"):
        nt.links.new(value(nt, f"o{axis}"), off.inputs[i])
    vs = nt.nodes.new("ShaderNodeVectorMath")
    vs.operation = "SCALE"
    nt.links.new(co, vs.inputs[0])
    vs.inputs["Scale"].default_value = 3.0
    va = nt.nodes.new("ShaderNodeVectorMath")
    va.operation = "ADD"
    nt.links.new(vs.outputs[0], va.inputs[0])
    nt.links.new(off.outputs[0], va.inputs[1])
    n = node(nt, "ShaderNodeTexNoise", Scale=1.0, Detail=9.0, Roughness=0.68)
    nt.links.new(va.outputs[0], n.inputs["Vector"])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(co, ln.inputs[0])
    shape = math_node(nt, "ADD", math_node(nt, "SUBTRACT", 1.0, ln.outputs["Value"]), math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", n.outputs["Fac"], 0.5), 2.0))
    body = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", shape, 0.2), 14.0, clamp_=True)
    # clip to the emanation (world position)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    r = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", sep.outputs[0], sep.outputs[0]), math_node(nt, "MULTIPLY", sep.outputs[1], sep.outputs[1])))
    rim = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", 0.97, r), 14.0, clamp_=True)
    grow = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", value(nt, "billow", 2.0), r), 4.0, clamp_=True)
    mask = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", body, rim), grow)
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*[0.3 * 0.7 + 0.7 * c for c in tint], 1)
    vol.inputs["Anisotropy"].default_value = 0.3
    nt.links.new(math_node(nt, "MULTIPLY", mask, 60.0), vol.inputs["Density"])
    vol.inputs["Emission Color"].default_value = (*tint, 1)
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "POWER", body, 4.0), math_node(nt, "MULTIPLY", mask, 0.9)), vol.inputs["Emission Strength"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return m


# Two rings of fronts turning in opposite directions, so they keep driving into each other
fronts = []
for i in range(6):
    ring = i % 2
    mat = front_material(f"front-{i}", (GOLDS if ring == 0 else VIOLETS)[i // 2])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=24, ring_count=12)
    ob = bpy.context.active_object
    ob.name = f"front-{i}"
    ob.data.materials.append(mat)
    size = (0.36 + R.random() * 0.14, 0.26 + R.random() * 0.1, 0.16)
    fronts.append((ob, mat, size, i / 6 * TAU + R.random() * 0.4, 0.42 if ring == 0 else 0.62, 1 if ring == 0 else -1, R.random() * TAU, R.random()))


def front_pos(f, ph):
    ob, mat, size, a0, rad, direction, wob, off = f
    a = a0 + direction * TAU * ph * 2
    rr = rad + 0.14 * math.sin(TAU * (ph * 3 + off))
    return math.cos(a) * rr, math.sin(a) * rr, a

# Dim, cool light from above so the cloud has form between the flashes
sun = bpy.data.lights.new("sky", "SUN")
sun.energy = 7.0
sun.color = (0.85, 0.85, 0.9)
sun.angle = 0.6
sun_ob = link(bpy.data.objects.new("sky", sun))
sun_ob.rotation_euler = (1.05, 0.35, 0.0)

# Lightning: lights inside the cloud, each a faith's colour, each firing a few times a loop as a quick flicker
flashes = []
for i in range(7):
    li = point_light(f"flash-{i}", 0.0, (1.0, 0.85, 0.6) if i % 2 == 0 else (0.7, 0.6, 1.0), 0.12)
    a, rad = R.random() * TAU, 0.25 + R.random() * 0.6
    li.location = (math.cos(a) * rad, math.sin(a) * rad, -0.12)
    events = sorted(R.random() for _ in range(4 + R.randrange(3)))
    flashes.append((li, events, [R.random() * 0.06 for _ in range(3)]))


bolts = []
for i in range(len(flashes) * 0):  # no visible bolts: the flashes alone light the cloud
    colour = (1.0, 0.88, 0.62) if i % 2 == 0 else (0.75, 0.66, 1.0)
    mat = emit_material(f"bolt-{i}", colour, 0.0)
    cu = bpy.data.curves.new(f"bolt-{i}", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.007
    sp = cu.splines.new("POLY")
    sp.points.add(15)
    cu.materials.append(mat)
    link(bpy.data.objects.new(f"bolt-{i}", cu))
    bolts.append((sp, mat))


def afterglow(ph, events, gaps):
    """Like lightning(), but lingering for most of a second: how long a struck sigil stays visible"""
    total = 0.0
    for e in events:
        d = fr(ph - e - gaps[0]) * LOOP_FRAMES / 30
        if d < 1.2:
            total += math.exp(-d * 3.5) * min(1.0, d * 30 + 0.3)
    return total


def lightning(ph, events, gaps):
    """Brightness at loop phase ph: each event is two or three sharp spikes in quick succession"""
    total = 0.0
    for e in events:
        for k, g in enumerate(gaps[: 2 + (int(e * 10) % 2)]):
            d = fr(ph - e - k * 0.012 - g) * LOOP_FRAMES / 30  # seconds since this spike
            if d < 0.5:
                total += math.exp(-d * 18) * (1.0 if k == 0 else 0.6)
    return total


sigils = []
# One sigil inside each front, tinted to its family. Sizes vary widely: the golden tree largest, the lion smallest.
SIZES = {1: 0.13, 2: 0.07, 3: 0.2, 4: 0.1, 5: 0.26, 6: 0.3}
FRONT_SIGIL = [6, 5, 2, 3, 1, 4]  # front i (inner ring even, gold; outer odd, violet) carries this sigil
for i, k in enumerate(FRONT_SIGIL):
    path = os.path.join(SPRITES, "tinted", f"sigil-{k}.png")
    img = bpy.data.images.load(path, check_existing=True)
    mat = sprite_material(f"sigil-{i}", path, 1.0, glow=(1.0, 0.85, 0.6) if i % 2 == 0 else (0.7, 0.6, 1.0))
    h = SIZES[k]
    ob = plane(f"sigil-{i}", mat, h * img.size[0] / img.size[1], h)
    sigils.append((ob, mat, i, R.random(), R.random() * TAU, 0.06 + R.random() * 0.08, (R.random() - 0.5) * 1.4))

feathers = []
for i in range(5):
    path = os.path.join(SPRITES, f"feather-{i % 3 + 1}.png")
    img = bpy.data.images.load(path, check_existing=True)
    mat = sprite_material(f"feather-{i}", path, 1.3, glow=(1.0, 0.9, 0.7))
    ob = plane(f"feather-{i}", mat, 0.11 * img.size[0] / img.size[1], 0.11)
    a, rad = R.random() * TAU, 0.25 + R.random() * 0.6
    feathers.append((ob, mat, math.cos(a) * rad, math.sin(a) * rad, R.random(), R.random() * TAU))

trinkets = []
for i in range(3):
    path = os.path.join(SPRITES, f"trinket-{R.randrange(6) + 1}.png")
    img = bpy.data.images.load(path, check_existing=True)
    mat = sprite_material(f"trinket-{i}", path, 1.0, glow=(0.9, 0.85, 0.7))
    ob = plane(f"trinket-{i}", mat, 0.12 * img.size[0] / img.size[1], 0.12)
    trinkets.append((ob, mat, R.random(), R.random() * TAU, 0.3 + R.random() * 0.55, R.random() * TAU, R.random() * TAU))

# Golden motes, whipped around chaotically: whole-number frequencies keep every path seamless over the loop
NMOTE = 170
motes_cloud = colour_points("motes", NMOTE, (1.0, 0.82, 0.45))
motes = [(R.random() * TAU, 0.15 + R.random() * 0.8, R.choice([-4, -3, -2, 2, 3, 4]), R.randrange(3, 8), R.random(), R.randrange(2, 5), R.random(), R.random()) for _ in range(NMOTE)]

# intro only: the crack of holy light over Finch
burst = point_light("burst", 0.0, HOLY, 0.1)
burst.location = (0, 0, -0.1)
cracks = []
for i in range(9):
    mat = emit_material(f"crack-{i}", HOLY, 0.0)
    cu = bpy.data.curves.new(f"crack-{i}", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.004
    sp = cu.splines.new("POLY")
    sp.points.add(7)
    cu.materials.append(mat)
    link(bpy.data.objects.new(f"crack-{i}", cu))
    a = i / 9 * TAU + R.random() * 0.4
    pts, rad = [], 0.08
    for _ in range(8):
        pts.append((math.cos(a) * rad, math.sin(a) * rad))
        a += (R.random() - 0.5) * 0.5
        rad += 0.08 + R.random() * 0.06
    cracks.append((sp, mat, pts))


def update(scene, *_):
    t = scene.frame_current - 1 + scene.frame_subframe
    if args.mode == "intro":
        ti = t / 30
        ph = fr((t - INTRO_FRAMES) / LOOP_FRAMES)
        billow = 1.15 * ease_out(seg(ti, 0.1, 1.6))
        appear = seg(ti, 1.0, 2.0)
    else:
        ti, ph = None, fr(t / LOOP_FRAMES)
        billow, appear = 2.0, 1.0
    th = TAU * ph
    offs = {"o1": (math.cos(th) * 0.7, math.sin(th) * 0.7, 0.6 * math.sin(th)), "o2": (math.cos(-th) * 0.5 + 3.1, math.sin(-th) * 0.5 - 1.7, 0.7 * math.sin(th)), "o3": (math.cos(th) * 0.35, math.sin(th) * 0.35, 0.25 * math.cos(th))}
    for k, v in offs.items():
        for axis, x in zip("xyz", v):
            set_val(cloud_mat, f"{k}{axis}", x)
    set_val(cloud_mat, "billow", billow)
    for f in fronts:
        ob, mat, size, a0, rad, direction, wob, off = f
        x, y, a = front_pos(f, ph)
        ob.location = (x, y, -0.12)
        ob.rotation_euler.z = a + math.pi / 2 + 0.3 * math.sin(TAU * ph * 2 + wob)
        b = 1 + 0.12 * math.sin(TAU * (ph * 3 + off))
        ob.scale = (size[0] * b, size[1] / b, size[2])
        for axis, v in zip("xyz", (math.cos(TAU * ph * 4 + wob) * 0.9, math.sin(TAU * ph * 4 + wob) * 0.9, 0.7 * math.sin(TAU * ph * 2))):
            set_val(mat, f"o{axis}", v)
        set_val(mat, "billow", billow)
    for j, (li, events, gaps) in enumerate(flashes):
        # between a front of the inner ring and its nearest front of the outer ring
        fa = fronts[(2 * j) % 6]
        ax, ay, _ = front_pos(fa, ph)
        fb = min((f for f in fronts if f[5] != fa[5]), key=lambda f: (front_pos(f, ph)[0] - ax) ** 2 + (front_pos(f, ph)[1] - ay) ** 2)
        bx, by, _ = front_pos(fb, ph)
        li.location = ((ax + bx) / 2, (ay + by) / 2, -0.04)
        b = lightning(ph, events, gaps)
        li.data.energy = 500.0 * b * appear
        # the bolt arcs from front to front, jagged anew for each strike
        if not bolts:
            continue
        sp, bmat = bolts[j]
        strike = int(ph * LOOP_FRAMES / 6)
        rj = random.Random(j * 1000 + strike)
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        # reach well past both fronts' centres: at least 0.55 of the radius long
        span = max(0.55, ln * 1.6)
        mx, my = (ax + bx) / 2, (ay + by) / 2
        ax, ay = mx - dx / ln * span / 2, my - dy / ln * span / 2
        dx, dy = dx / ln * span, dy / ln * span
        for q, pt in enumerate(sp.points):
            u = q / (len(sp.points) - 1)
            jag = (rj.random() - 0.5) * 0.16 * math.sin(math.pi * u)
            pt.co = (ax + dx * u + nx * jag, ay + dy * u + ny * jag, 0.08, 1.0)
        set_val(bmat, "strength", 6.0 * min(1.5, b))
        set_val(bmat, "alpha", min(1.0, b * 1.6) * appear if b > 0.15 else 0.0)
    flash_pos = [(li.location.x, li.location.y, afterglow(ph, ev, gp)) for li, ev, gp in flashes]
    for ob, mat, i, off, rot0, out_, side in sigils:
        fx, fy, fa = front_pos(fronts[i], ph)
        fx, fy = fx + math.cos(fa + side) * out_, fy + math.sin(fa + side) * out_
        ob.location = (fx, fy, 0.0)
        ob.rotation_euler.z = rot0 + fa * 0.5
        lit = sum(b * math.exp(-((fx - x) ** 2 + (fy - y) ** 2) / 0.08) for x, y, b in flash_pos)
        # hidden in the cloud until lightning strikes near it, then glimpsed and fading back
        shown = min(1.0, lit * 1.4)
        set_val(mat, "fade", shown)
        set_val(mat, "opacity", shown * appear)
        set_val(mat, "strength", 1.2 + 3.0 * shown)
    for ob, mat, x, y, off, rot0 in feathers:
        u = fr(ph * 2 + off)
        ang = math.atan2(y, x) + TAU * (ph * 2 + off) * (1 if (off * 10) % 2 < 1 else -1)
        rr = math.hypot(x, y) + 0.12 * math.sin(TAU * (ph * 3 + off))
        ob.location = (math.cos(ang) * rr, math.sin(ang) * rr, 0.04)
        ob.rotation_euler.z = ang + rot0 + 2.0 * math.sin(TAU * (ph * 4 + off))
        set_val(mat, "fade", win(u, 0.25, 0.6))
        set_val(mat, "opacity", 0.8 * appear)
    for ob, mat, off, a, rad, dirn, rot0 in trinkets:
        u = fr(ph * 2 + off)
        ang = a + TAU * ph * 2 * (1 if dirn > math.pi else -1)
        ob.location = (math.cos(ang) * rad, math.sin(ang) * rad, 0.03)
        ob.rotation_euler.z = rot0 + TAU * ph * 4
        set_val(mat, "fade", win(u, 0.3, 0.6))
        set_val(mat, "opacity", appear)
    co, radius, bright = [], [], []
    for a0, r0, k, m, o1, n, o2, sz in motes:
        a = a0 + TAU * ph * k + 0.7 * math.sin(TAU * (ph * m + o1))
        rr = min(0.95, r0 + 0.18 * math.sin(TAU * (ph * n + o2)))
        co += [math.cos(a) * rr, math.sin(a) * rr, 0.05]
        radius.append(0.0025 + 0.004 * sz)
        bright.append((0.5 + 0.5 * math.sin(TAU * (ph * (m + n) * 2 + o2))) ** 3 * (0.4 + 0.6 * sz) * min(1.0, billow - rr + 0.5))
    set_points(motes_cloud, co, radius, bright)
    if ti is not None:
        f = math.exp(-max(0.0, ti - 0.05) * 5) if ti > 0.05 else ti / 0.05
        burst.data.energy = 120.0 * f
        grow = ease_out(seg(ti, 0.05, 0.4))
        fade = 1 - seg(ti, 0.5, 1.1)
        for sp, mat, pts in cracks:
            n = len(pts)
            reach = grow * (n - 1)
            for j, p in enumerate(sp.points):
                k = min(j, reach)
                i0 = int(k)
                i1 = min(i0 + 1, n - 1)
                q = k - i0
                p.co = (pts[i0][0] + (pts[i1][0] - pts[i0][0]) * q, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * q, 0.02, 1.0)
            set_val(mat, "strength", 6 * fade)
            set_val(mat, "alpha", fade if grow > 0 else 0.0)
    else:
        burst.data.energy = 0.0
        for sp, mat, pts in cracks:
            set_val(mat, "alpha", 0.0)


sc.frame_start, sc.frame_end = 1, INTRO_FRAMES if args.mode == "intro" else LOOP_FRAMES
bpy.app.handlers.frame_change_pre.append(update)
if args.frames:
    a, b = (int(x) for x in args.frames.split("-"))
    sc.frame_start, sc.frame_end = a, b
os.makedirs(args.out, exist_ok=True)
sc.render.filepath = os.path.join(args.out, "")
bpy.ops.render.render(animation=True)
print("rendered", sc.frame_start, "to", sc.frame_end)
