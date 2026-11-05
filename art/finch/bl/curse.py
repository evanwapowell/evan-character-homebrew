"""Familiar of Ongoing Misery, "Valet Points", in Blender. Two clips, as Sequencer will play them:

  wisp:   a seamless 3 s loop of the dark wisp (volumetric glow, tendrils that unfurl, curl and draw back in, a trailing
          tail along -x). Sequencer moves it from Valet to the target and turns it to face its way.
  impact: 2.6 s at the target, centred on the token: contact puff, the silver control bar materialising above it, the
          strings dropping and jerking taut, the faceless face drawn up out of the creature and dissolving.

Units are grid squares (1 = 5 ft = 100 px at Foundry's default grid).

  python curse.py --mode wisp|impact --out DIR [--frames A-B] [--samples 24] [--scale 2]
"""

import argparse
import math
import os
import random
import sys

import bpy  # noqa: F401  (needed before bmesh)

HERE = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(HERE, "..", "sprites")
TAU = math.tau

ap = argparse.ArgumentParser()
ap.add_argument("--mode", default="impact")
ap.add_argument("--out", default=os.path.join(HERE, "curse-out"))
ap.add_argument("--frames", default=None)
ap.add_argument("--samples", type=int, default=24)
ap.add_argument("--scale", type=float, default=2.0, help="pixels per grid square / 100")
cli = ap.parse_args()

# Reuse the occult script's helpers and render setup (everything between its arguments and its build section)
src = open(os.path.join(HERE, "occult.py")).read()
helpers = src[src.index("def clamp"):src.index("# --------------------------------------------------------------------------------------------------- build")]


class _Args:
    mode = "curse"
    samples = cli.samples
    res = 100


args = _Args()
exec(compile("import bmesh\n" + helpers, "occult-helpers", "exec"))

sc = bpy.context.scene
sc.render.use_motion_blur = False
cam = sc.camera
PX = 100 * cli.scale
if cli.mode == "wisp":
    W, H = 1.6, 1.0
    FRAMES = 90
else:
    W, H = 2.4, 3.6
    FRAMES = 78
cam.data.ortho_scale = max(W, H)
sc.render.resolution_x = int(W * PX)
sc.render.resolution_y = int(H * PX)
sc.frame_start, sc.frame_end = 1, FRAMES
R = random.Random(5)


def curve_object(name, n, mat, width):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = width
    cu.bevel_resolution = 2
    sp = cu.splines.new("POLY")
    sp.points.add(n - 1)
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu)), sp


def set_curve(sp, pts, radii):
    for p, (x, y, z), r in zip(sp.points, pts, radii):
        p.co = (x, y, z, 1.0)
        p.radius = r


def glow_volume(name, radius, core=(0.86, 0.87, 0.92), mid=(0.48, 0.47, 0.6), outer=(0.15, 0.15, 0.21)):
    """A soft ball of volumetric light: bright small heart, blue-violet body, dark indigo rim; noise gives it smoke"""
    m, nt = new_mat(name)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    co = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    off = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, k in enumerate("xyz"):
        nt.links.new(value(nt, f"o{k}"), off.inputs[i])
    vadd = nt.nodes.new("ShaderNodeVectorMath")
    vadd.operation = "ADD"
    sc_ = nt.nodes.new("ShaderNodeVectorMath")
    sc_.operation = "SCALE"
    nt.links.new(co, sc_.inputs[0])
    sc_.inputs["Scale"].default_value = 3.0 / radius
    nt.links.new(sc_.outputs[0], vadd.inputs[0])
    nt.links.new(off.outputs[0], vadd.inputs[1])
    noise = node(nt, "ShaderNodeTexNoise", Scale=1.0, Detail=5.0, Roughness=0.6)
    nt.links.new(vadd.outputs[0], noise.inputs["Vector"])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(co, ln.inputs[0])
    r = math_node(nt, "DIVIDE", ln.outputs["Value"], radius)
    fall = math_node(nt, "POWER", math_node(nt, "SUBTRACT", 1.0, r, clamp_=True), 1.6)
    smoke = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", noise.outputs["Fac"], 0.3), 2.2, clamp_=True)
    amount = value(nt, "amount", 1.0)
    dens = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", fall, math_node(nt, "ADD", smoke, 0.25)), math_node(nt, "MULTIPLY", amount, 40.0))
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(r, ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (*core, 1)
    els[1].position, els[1].color = 0.7, (*outer, 1)
    e = els.new(0.22)
    e.color = (*mid, 1)
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.02, 0.02, 0.05, 1)
    nt.links.new(dens, vol.inputs["Density"])
    nt.links.new(ramp.outputs["Color"], vol.inputs["Emission Color"])
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", fall, math_node(nt, "ADD", smoke, 0.4)), math_node(nt, "MULTIPLY", amount, 26.0)), vol.inputs["Emission Strength"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=32, ring_count=16)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(m)
    return ob, m


def wisp_rig(cx, cy, size):
    """Volumetric core plus tendrils; returns an updater taking (phase 0..1 of a loop, overall alpha, centre)"""
    core, core_mat = glow_volume("wisp-core", size)
    halo, halo_mat = glow_volume("wisp-halo", size * 2.2, core=(0.52, 0.52, 0.64), mid=(0.36, 0.35, 0.48), outer=(0.1, 0.1, 0.15))
    tend = []
    for i in range(5):
        mat = emit_material(f"tendril-{i}", (0.62, 0.62, 0.74), 1.0)
        ob, sp = curve_object(f"tendril-{i}", 24, mat, size * 0.07)
        # base angle, cycle offset, curl, whole cycles per loop
        tend.append((ob, sp, mat, i / 5 * TAU + R.random() * 0.6, R.random(), (R.random() - 0.5) * 1.2, 1 + R.randrange(2)))
    tails = []
    for i in range(0):
        mat = emit_material(f"tail-{i}", (0.5, 0.5, 0.62), 0.8)
        ob, sp = curve_object(f"tail-{i}", 28, mat, size * 0.12)
        tails.append((ob, sp, mat, i))

    def update(ph, alpha, cx, cy, grow=1.0):
        th = TAU * ph
        for m in (core_mat, halo_mat):
            for k, v in zip("xyz", (math.cos(th) * 0.6, math.sin(th) * 0.6, 0.4 * math.sin(th))):
                set_val(m, f"o{k}", v)
        set_val(core_mat, "amount", alpha)
        set_val(halo_mat, "amount", 0.35 * alpha)
        core.location = halo.location = (cx, cy, 0)
        core.scale = halo.scale = [0.4 + 0.6 * grow] * 3
        for ob, sp, mat, base, off, curl, k in tend:
            life = fr(ph * k + off)
            reach = math.sin(math.pi * life)  # out, then reeled back in
            a = base + th * 0.5 + life * 0.8
            length = size * (0.4 + 1.9 * reach) * grow
            pts, radii = [], []
            for j in range(24):
                u = j / 23
                ang = a + curl * u * 3 * (0.5 + reach)
                rr = size * 0.35 + length * u
                pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr, 0.02))
                radii.append((1 - u) * (0.4 + 0.6 * reach) + 0.05)
            set_curve(sp, pts, radii)
            set_val(mat, "alpha", alpha * 0.55 * reach)
            set_val(mat, "strength", 1.2 * (0.3 + 0.7 * reach))
        for ob, sp, mat, i in tails:
            pts, radii = [], []
            for j in range(28):
                u = j / 27
                wob = math.sin(u * 5 - th * 2 + i * 2.1) * size * 0.35 * u
                pts.append((cx - size * 0.3 - u * size * 4.2 * grow, cy + wob + (i - 0.5) * size * 0.25 * u, 0.0))
                radii.append((1 - u) ** 1.5 + 0.03)
            set_curve(sp, pts, radii)
            set_val(mat, "alpha", alpha * 0.4)

    return update


if cli.mode == "wisp":
    upd = wisp_rig(0.3, 0.0, 0.13)

    def handler(scene, *_):
        t = scene.frame_current - 1 + scene.frame_subframe
        upd(fr(t / FRAMES), 1.0, 0.3, 0.0)

else:
    # The creature's token sits low in the frame, the bar above it
    TX, TY, TR = 0.0, -0.8, 0.44
    BAR_Y, BAR_H = 0.62, 1.15
    bar_img = bpy.data.images.load(os.path.join(SPRITES, "control-bar.png"))
    aspect = bar_img.size[0] / bar_img.size[1]
    bar_mat = sprite_material("bar", os.path.join(SPRITES, "control-bar.png"), 1.25, glow=(0.66, 0.66, 0.78))
    bar = plane("bar", bar_mat, BAR_H * aspect, BAR_H)
    # Cap positions in the sprite (u, v from top-left), measured from the image
    CAPS = [(0.275, 0.175), (0.724, 0.173), (0.307, 0.827), (0.728, 0.827)]

    def bar_point(u, v, bx, by, rot):
        x, y = (u - 0.5) * BAR_H * aspect, (0.5 - v) * BAR_H
        c, s = math.cos(rot), math.sin(rot)
        return bx + x * c - y * s, by + x * s + y * c

    SIGIL = os.path.join(SPRITES, "fey", "01.png")
    face_img = bpy.data.images.load(SIGIL)
    face_mat = sprite_material("stolen", SIGIL, 1.4, glow=(0.62, 0.6, 0.86))
    FH = 0.58
    face = plane("stolen", face_mat, FH * face_img.size[0] / face_img.size[1], FH)
    strings = []
    for i in range(5):
        mat = emit_material(f"string-{i}", (0.55, 0.52, 0.88), 1.4)
        ob, sp = curve_object(f"string-{i}", 16, mat, 0.007)
        strings.append((ob, sp, mat))
    puff, puff_mat = glow_volume("puff", 0.42, core=(0.78, 0.78, 0.86), mid=(0.45, 0.44, 0.58), outer=(0.13, 0.13, 0.19))
    ring_mat = emit_material("ring", (0.76, 0.76, 0.84), 0.0)
    ring = torus("ring", 1.0, 0.008, ring_mat, 0.02)
    arrive = wisp_rig(TX, TY + TR * 0.5, 0.13)
    NM = 140
    cloud = points("motes", NM, point_material("motes"))
    motes = [(R.random() - 0.5, R.random(), R.random(), R.random()) for _ in range(NM)]
    # head, two hands, two feet on the creature; the head string hangs from the crossing
    ANCH = [(0.0, 0.55), (-0.62, 0.1), (0.62, 0.1), (-0.32, -0.55), (0.32, -0.55)]

    def handler(scene, *_):
        t = (scene.frame_current - 1 + scene.frame_subframe) / 30
        # the wisp arrives (it is still the moving clip for the first frames) and bursts
        a_w = 1 - seg(t, 0.0, 0.2)
        arrive(fr(t / 3), a_w, TX, TY + TR * 0.5, 1.0 + 0.6 * seg(t, 0, 0.2))
        burst = seg(t, 0.0, 0.5)
        puff.location = (TX, TY + TR * 0.5, 0)
        puff.scale = [0.3 + 0.9 * ease_out(burst)] * 3
        set_val(puff_mat, "amount", 0.9 * (1 - burst) if burst < 1 else 0.0)
        w = seg(t, 0.02, 0.45)
        ring.location = (TX, TY, 0.02)
        ring.scale = [TR * (0.9 + 1.0 * ease_out(w))] * 2 + [1]
        set_val(ring_mat, "strength", 4 * (1 - w) if 0 < w < 1 else 0.0)
        set_val(ring_mat, "alpha", (1 - w) if 0 < w < 1 else 0.0)
        # the bar materialises, jerks the strings up, then dissolves
        tug = seg(t, 0.85, 1.2)
        yank = math.sin(math.pi * tug) * (1 - 0.5 * tug)
        lift = smooth(seg(t, 0.85, 1.7))
        slack = seg(t, 1.95, 2.55)
        by = BAR_Y + 0.18 * lift + 0.12 * yank
        rot = 0.05 * math.sin(t * 4) * (1 - tug) + 0.25 * slack
        bar.location = (TX, by, 0.05)
        bar.rotation_euler.z = rot
        set_val(bar_mat, "fade", smooth(seg(t, 0.12, 0.5)) * (1 - smooth(slack)))
        # the stolen face rises out of the creature on the strings
        fy = TY + 0.72 * lift
        face.location = (TX, fy, 0.03)
        face.scale = (FH * face_img.size[0] / face_img.size[1] * (0.8 + 0.2 * lift), FH * (0.8 + 0.2 * lift), 1)
        set_val(face_mat, "fade", smooth(seg(t, 0.85, 1.15)) * (1 - smooth(seg(t, 1.6, 2.3))))
        set_val(face_mat, "opacity", 0.95)
        ends = [bar_point(0.5, 0.5, TX, by, rot)] + [bar_point(u, v, TX, by, rot) for u, v in CAPS]
        taut = 0 < tug < 1
        for i, (ob, sp, mat) in enumerate(strings):
            drop = ease_out(seg(t, 0.35 + i * 0.05, 0.65 + i * 0.05))
            ax, ay = ANCH[i]
            # anchors on the creature until the face comes up, then on the face
            on_creature = (TX + ax * TR, TY + ay * TR)
            on_face = (TX + ax * FH * 0.3, fy + ay * FH * 0.45)
            ex = on_creature[0] + (on_face[0] - on_creature[0]) * lift
            ey = on_creature[1] + (on_face[1] - on_creature[1]) * lift - slack * 0.3
            sx, sy = ends[i]
            pts = []
            for j in range(16):
                u = j / 15 * drop
                sag = (0.0 if taut else 0.03 + slack * 0.25) * math.sin(math.pi * u)
                pts.append((sx + (ex - sx) * u + sag * 0.5, sy + (ey - sy) * u - sag, 0.04))
            set_curve(sp, pts, [1.0] * 16)
            set_val(mat, "alpha", (1 - slack) if drop > 0 else 0.0)
            set_val(mat, "strength", 2.2 if taut else 1.4)
        # motes shed as the face dissolves
        co, radius, bright, tint = [], [], [], []
        for dx, born, k, sz in motes:
            life = seg(t, 1.5 + born * 0.7, 2.4 + born * 0.4)
            co += [TX + dx * 0.55, fy + (k - 0.5) * 0.4 + life * 0.35, 0.05]
            radius.append(0.008 + 0.01 * sz)
            bright.append((1 - life) * 0.7 if 0 < life < 1 else 0.0)
            tint.append(0.4)
        me = cloud.data
        me.vertices.foreach_set("co", co)
        me.attributes["radius"].data.foreach_set("value", radius)
        me.attributes["bright"].data.foreach_set("value", bright)
        me.attributes["tint"].data.foreach_set("value", tint)
        me.update()


bpy.app.handlers.frame_change_pre.append(handler)
if cli.frames:
    a, b = (int(x) for x in cli.frames.split("-"))
    sc.frame_start, sc.frame_end = a, b
os.makedirs(cli.out, exist_ok=True)
sc.render.filepath = os.path.join(cli.out, "")
bpy.ops.render.render(animation=True)
print("rendered", sc.frame_start, "to", sc.frame_end)
