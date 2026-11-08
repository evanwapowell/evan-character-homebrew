"""Manifest Will (primal), "The Lands That Were Lost", in Blender.

Glimpses of lost lands surface through a dark green mist and sink away again, each patch of ground giving way to another
in its place: a fungal glade, an old ruin with a carved rune, a crystal cave, a tangle of flowering vines. A web of glowing
mycelium runs through the ground everywhere, pulsing (the speed penalty: it tangles whoever stands in it). Spores and a
lost trinket or two drift through. The intro ripples the ground out from Finch, the mycelium races outward behind it, and
the first lands surface.

  python primal.py --mode loop|intro --out DIR [--frames A-B] [--res 600] [--samples 20]
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
ap.add_argument("--out", default=os.path.join(HERE, "primal-out"))
ap.add_argument("--frames", default=None)
ap.add_argument("--res", type=int, default=600)
ap.add_argument("--samples", type=int, default=20)
args = ap.parse_args()

src = open(os.path.join(HERE, "occult.py")).read()
exec(compile("import bmesh\n" + src[src.index("def clamp"):src.index("# --------------------------------------------------------------------------------------------------- build")], "occult-helpers", "exec"))
sc = bpy.context.scene
sc.render.use_motion_blur = False
R = random.Random(31)

THREAD = (0.4, 0.92, 0.8)  # mycelium: pale teal
THREAD2 = (0.55, 0.5, 1.0)  # with blue-violet in it


def colour_points(name, n, colour):
    m, nt = new_mat(name + "-mat")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    br = nt.nodes.new("ShaderNodeAttribute")
    br.attribute_name = "bright"
    e = node(nt, "ShaderNodeEmission", Color=(*colour, 1))
    nt.links.new(math_node(nt, "MULTIPLY", br.outputs["Fac"], 6.0), e.inputs["Strength"])
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


def web_material():
    """The mycelium web: thin glowing threads (Voronoi cell edges), only some of them lit, pulses running through"""
    m, nt = new_mat("web")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    co0 = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    co2 = nt.nodes.new("ShaderNodeVectorMath")
    co2.operation = "SCALE"
    nt.links.new(co0, co2.inputs[0])
    co2.inputs["Scale"].default_value = 2.0
    co = co2.outputs[0]

    def offset(prefix):
        cx = nt.nodes.new("ShaderNodeCombineXYZ")
        for i, axis in enumerate("xyz"):
            nt.links.new(value(nt, f"{prefix}{axis}"), cx.inputs[i])
        return cx.outputs[0]

    def vadd(a, b):
        n = nt.nodes.new("ShaderNodeVectorMath")
        n.operation = "ADD"
        nt.links.new(a, n.inputs[0])
        nt.links.new(b, n.inputs[1])
        return n.outputs[0]

    # wobble the cells so the threads wander rather than run straight
    wob = node(nt, "ShaderNodeTexNoise", Scale=3.0, Detail=2.0)
    nt.links.new(co, wob.inputs["Vector"])
    warp = nt.nodes.new("ShaderNodeVectorMath")
    warp.operation = "MULTIPLY_ADD"
    nt.links.new(wob.outputs["Color"], warp.inputs[0])
    warp.inputs[1].default_value = (0.3, 0.3, 0.0)
    warp.inputs[2].default_value = (-0.15, -0.15, 0.0)
    p = vadd(co, warp.outputs[0])
    threads = 0
    for scale, width, w in ((4.0, 120.0, 1.0), (9.0, 170.0, 0.5)):
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.feature = "DISTANCE_TO_EDGE"
        vor.inputs["Scale"].default_value = scale
        nt.links.new(p, vor.inputs["Vector"])
        line = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", 1.0, math_node(nt, "MULTIPLY", vor.outputs["Distance"], width), clamp_=True), w)
        threads = line if threads == 0 else math_node(nt, "MAXIMUM", threads, line)
    # which threads are lit, drifting slowly round the loop
    lit = node(nt, "ShaderNodeTexNoise", Scale=2.2, Detail=2.0)
    nt.links.new(vadd(co, offset("o1")), lit.inputs["Vector"])
    lit_f = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", lit.outputs["Fac"], 0.48), 5.0, clamp_=True)
    # pulses running through them
    pulse = node(nt, "ShaderNodeTexNoise", Scale=7.0, Detail=1.0)
    nt.links.new(vadd(co, offset("o2")), pulse.inputs["Vector"])
    pulse_f = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", pulse.outputs["Fac"], 0.55), 6.0, clamp_=True)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(co, sep.inputs[0])
    r = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", sep.outputs[0], sep.outputs[0]), math_node(nt, "MULTIPLY", sep.outputs[1], sep.outputs[1])))
    rim = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", 0.96, r), 20.0, clamp_=True)
    grow = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", value(nt, "billow", 2.0), r), 6.0, clamp_=True)
    f = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", threads, math_node(nt, "ADD", math_node(nt, "MULTIPLY", lit_f, 0.7), 0.0)), math_node(nt, "MULTIPLY", rim, grow))
    hue = nt.nodes.new("ShaderNodeMix")
    hue.data_type = "RGBA"
    nt.links.new(lit.outputs["Fac"], hue.inputs["Factor"])
    hue.inputs["A"].default_value = (*THREAD2, 1)
    hue.inputs["B"].default_value = (*THREAD, 1)
    e = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(hue.outputs["Result"], e.inputs["Color"])
    nt.links.new(math_node(nt, "MULTIPLY", f, math_node(nt, "ADD", math_node(nt, "MULTIPLY", pulse_f, 5.0), 1.6)), e.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(math_node(nt, "MINIMUM", math_node(nt, "MULTIPLY", f, 1.4), 1.0), mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(e.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


# --------------------------------------------------------------------------------------------------- build

# Dark green mist, its wisps blue-violet
bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=1.0, depth=0.3, location=(0, 0, -0.15))
mist = bpy.context.active_object
mist_mat = mist_material()
mist.data.materials.append(mist_mat)
for n in mist_mat.node_tree.nodes:
    if n.type == "PRINCIPLED_VOLUME":
        n.inputs["Color"].default_value = (0.03, 0.06, 0.04, 1)
    if n.type == "MIX" and n.data_type == "RGBA":
        n.inputs["A"].default_value = (0.07, 0.16, 0.11, 1)
        n.inputs["B"].default_value = (0.24, 0.55, 0.48, 1)

web_mat = web_material()
web = plane("web", web_mat, 2.0, 2.0)
web.location.z = 0.005

def clip_to_emanation(mat, edge=0.97):
    """Fade a surface material out at the emanation's edge (world radius 1), so patches stop at the aura's border"""
    nt = mat.node_tree
    outn = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    mix = outn.inputs["Surface"].links[0].from_node
    fac_src = mix.inputs["Fac"].links[0].from_socket
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    r = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", sep.outputs[0], sep.outputs[0]), math_node(nt, "MULTIPLY", sep.outputs[1], sep.outputs[1])))
    m = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", edge, r), 25.0, clamp_=True)
    nt.links.new(math_node(nt, "MULTIPLY", fac_src, m), mix.inputs["Fac"])


# Lost lands all over the emanation, out to its edge. Each place shows one land, then another; places overlap and
# kinds repeat, which is fine since they surface and fade at different times.
KINDS = ["fungi", "ruin", "crystal", "vines"]
SLOTS = []
NSLOT = 14
placed = {k: [] for k in KINDS}  # (x, y, radius) of every patch of each kind


def fits(kind, x, y, r):
    """Patches of the same kind never overlap; different kinds may"""
    return all(math.hypot(x - px, y - py) > r + pr for px, py, pr in placed[kind])


while len(SLOTS) < NSLOT:
    a, rad = R.random() * TAU, math.sqrt(R.random()) * 0.9
    x, y = math.cos(a) * rad, math.sin(a) * rad
    kinds = R.sample(KINDS, 2)
    sizes = [0.4 + R.random() * 0.24 for _ in kinds]
    # a patch's visible radius is a little under half its size (the art has a ragged, feathered edge)
    if not all(fits(k, x, y, sz * 0.45) for k, sz in zip(kinds, sizes)):
        continue
    lands = []
    i = len(SLOTS)
    for j, (kind, size) in enumerate(zip(kinds, sizes)):
        placed[kind].append((x, y, size * 0.45))
        path = os.path.join(SPRITES, f"land-{kind}.png")
        img = bpy.data.images.load(path, check_existing=True)
        mat = sprite_material(f"land-{i}-{j}", path, 0.85, glow=(0.08, 0.16, 0.13))
        clip_to_emanation(mat)
        ob = plane(f"land-{i}-{j}", mat, size * img.size[0] / img.size[1], size)
        ob.location = (x, y, -0.08 - 0.003 * (2 * i + j))
        ob.rotation_euler.z = R.random() * TAU
        lands.append((ob, mat))
    SLOTS.append((lands, R.random()))
print("PATCHES", {k: len(v) for k, v in placed.items()})

trinkets = []
for i in range(3):
    path = os.path.join(SPRITES, f"trinket-{R.randrange(6) + 1}.png")
    img = bpy.data.images.load(path, check_existing=True)
    mat = sprite_material(f"trinket-{i}", path, 0.9, glow=(0.6, 0.9, 0.8))
    ob = plane(f"trinket-{i}", mat, 0.11 * img.size[0] / img.size[1], 0.11)
    trinkets.append((ob, mat, R.random(), R.random() * TAU, 0.3 + R.random() * 0.55, R.random() * TAU, R.random() * TAU))

NSP = 160
spores = colour_points("spores", NSP, (0.8, 0.95, 0.6))
spore_seeds = [(R.random() * TAU, R.random() * 0.92, R.random() * TAU, R.random(), R.randrange(1, 4), R.random()) for _ in range(NSP)]

# intro: rings rippling out over the ground
ripples = []
for i in range(3):
    mat = emit_material(f"ripple-{i}", (0.6, 0.98, 0.85), 0.0)
    ripples.append((torus(f"ripple-{i}", 1.0, 0.006, mat, 0.02), mat, i * 0.14))


def update(scene, *_):
    t = scene.frame_current - 1 + scene.frame_subframe
    if args.mode == "intro":
        ti = t / 30
        ph = fr((t - INTRO_FRAMES) / LOOP_FRAMES)
        billow = 1.15 * ease_out(seg(ti, 0.1, 1.5))
        grow = 1.15 * ease_out(seg(ti, 0.2, 1.4))
        appear = seg(ti, 1.0, 2.0)
    else:
        ti, ph = None, fr(t / LOOP_FRAMES)
        billow = grow = 2.0
        appear = 1.0
    th = TAU * ph
    for k, v in zip("xyz", (math.cos(th) * 0.45, math.sin(th) * 0.45, 0.35 * math.sin(th))):
        set_val(mist_mat, f"o1{k}", v)
    for k, v in zip("xyz", (math.cos(-th) * 0.3 + 3.1, math.sin(-th) * 0.3 - 1.7, 0.5 * math.sin(th))):
        set_val(mist_mat, f"o2{k}", v)
    set_val(mist_mat, "billow", billow)
    for k, v in zip("xyz", (math.cos(th) * 0.5, math.sin(th) * 0.5, 0.3 * math.sin(th))):
        set_val(web_mat, f"o1{k}", v)
    for k, v in zip("xyz", (math.cos(th * 3) * 0.8, math.sin(th * 3) * 0.8, 0.4 * math.cos(th * 3))):
        set_val(web_mat, f"o2{k}", v)
    set_val(web_mat, "billow", grow)
    # lands: in each place, the first land shows in the first half of its cycle, the second in the other half
    for lands, off in SLOTS:
        u = fr(ph + off)
        for j, (ob, mat) in enumerate(lands):
            v = fr(u - 0.5 * j) * 2  # 0..2; shown over 0..1
            f = win(v, 0.3, 0.62) if v < 1 else 0.0
            set_val(mat, "fade", f)
            set_val(mat, "opacity", appear)
    for ob, mat, off, a, rad, dirn, rot0 in trinkets:
        u = fr(ph * 2 + off)
        ob.location = (math.cos(a) * rad + math.cos(dirn) * u * 0.1, math.sin(a) * rad + math.sin(dirn) * u * 0.1, 0.03)
        ob.rotation_euler.z = rot0 + u * 1.2
        set_val(mat, "fade", win(u, 0.3, 0.6))
        set_val(mat, "opacity", appear)
    co, radius, bright = [], [], []
    for a, rr, dirn, off, k, sz in spore_seeds:
        u = fr(ph * k * 2 + off)
        co += [math.cos(a) * rr + math.cos(dirn) * u * 0.06, math.sin(a) * rr + math.sin(dirn) * u * 0.06, 0.04]
        radius.append(0.003 + 0.004 * sz)
        bright.append(math.sin(math.pi * u) * 0.7 * clamp((billow - rr) * 4))
    set_points(spores, co, radius, bright)
    for ob, mat, d in ripples:
        if ti is None:
            set_val(mat, "alpha", 0.0)
            continue
        w = seg(ti, 0.05 + d, 1.0 + d)
        ob.scale = [0.1 + 0.9 * ease_out(w)] * 2 + [1]
        on = 1.0 if 0 < w < 1 else 0.0
        set_val(mat, "strength", 4.0 * (1 - w) * on)
        set_val(mat, "alpha", (1 - w) * on)


sc.frame_start, sc.frame_end = 1, INTRO_FRAMES if args.mode == "intro" else LOOP_FRAMES
bpy.app.handlers.frame_change_pre.append(update)
if args.frames:
    a, b = (int(x) for x in args.frames.split("-"))
    sc.frame_start, sc.frame_end = a, b
os.makedirs(args.out, exist_ok=True)
sc.render.filepath = os.path.join(args.out, "")
sc.render.use_overwrite = False
bpy.ops.render.render(animation=True)
print("rendered", sc.frame_start, "to", sc.frame_end)
