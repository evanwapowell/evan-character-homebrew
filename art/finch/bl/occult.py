"""Manifest Will (occult), the Masquerade of Lost Faces, in Blender.

Top-down orthographic view of the emanation: radius 1 unit fills the frame. Everything is a function of time, set by a
frame-change handler, so motion blur sees sub-frames and the loop repeats seamlessly (its phase ph goes 0 to 1).

  python occult.py --mode loop|intro --out DIR [--frames A-B] [--res 800] [--samples 24]
"""

import argparse
import math
import os
import random

import bpy  # must come first: it makes bmesh importable
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(HERE, "..", "sprites")
ASSETS = os.path.join(HERE, "assets")
LOOP_FRAMES = 480  # 16 s
INTRO_FRAMES = 60  # 2 s
TAU = math.tau

ap = argparse.ArgumentParser()
ap.add_argument("--mode", default="loop")
ap.add_argument("--out", default=os.path.join(HERE, "out"))
ap.add_argument("--frames", default=None)
ap.add_argument("--res", type=int, default=800)
ap.add_argument("--samples", type=int, default=24)
args = ap.parse_args()


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def seg(t, a, b):
    return clamp((t - a) / (b - a))


def smooth(t):
    return t * t * (3 - 2 * t)


def fr(x):
    return x % 1.0


def win(u, a=0.25, b=0.7):
    return smooth(clamp(u / a)) * (1 - smooth(clamp((u - b) / (1 - b))))


def ease_out(t):
    return 1 - (1 - t) ** 3


# ----------------------------------------------------------------------------------------------------------- scene

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = args.samples
sc.cycles.use_denoising = True
for d in ("OPENIMAGEDENOISE", "OPTIX"):
    try:
        sc.cycles.denoiser = d
        break
    except TypeError:
        pass
sc.cycles.max_bounces = 2
sc.cycles.diffuse_bounces = 0
sc.cycles.glossy_bounces = 0
sc.cycles.transmission_bounces = 0
sc.cycles.volume_bounces = 0
sc.cycles.transparent_max_bounces = 24
sc.cycles.volume_step_rate = 2.0
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = args.res
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "Standard"
sc.render.fps = 30
sc.render.use_motion_blur = False
sc.render.motion_blur_shutter = 0.6

world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0
sc.world = world

cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam.ortho_scale = 2.0
cam_ob = bpy.data.objects.new("cam", cam)
cam_ob.location = (0, 0, 5)
sc.collection.objects.link(cam_ob)
sc.camera = cam_ob


def link(ob):
    sc.collection.objects.link(ob)
    return ob


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    for attr in ("emission_sampling",):
        if hasattr(m, attr):
            setattr(m, attr, "NONE")
    if hasattr(m, "cycles") and hasattr(m.cycles, "emission_sampling"):
        m.cycles.emission_sampling = "NONE"
    return m, m.node_tree


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def math_node(nt, op, a=None, b=None, clamp_=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp_
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def value(nt, name, v=0.0):
    n = nt.nodes.new("ShaderNodeValue")
    n.name = name
    n.outputs[0].default_value = v
    return n.outputs[0]


# ----------------------------------------------------------------------------------------------- materials


def sprite_material(name, path, strength, glow=(0.62, 0.66, 1.0), seq=None, reveal=False):
    """An image that emits its own light; 'fade' dissolves it through noise with a glowing edge, like a memory going"""
    m, nt = new_mat(name)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(path, check_existing=True)
    img.alpha_mode = "STRAIGHT"
    if seq:
        img.source = "SEQUENCE"
        tex.image_user.frame_duration = seq
        tex.image_user.frame_start = 1
        tex.image_user.use_cyclic = True
        tex.image_user.use_auto_refresh = True
    tex.image = img
    tex.interpolation = "Linear"
    uv = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    noise = node(nt, "ShaderNodeTexNoise", Scale=7.0, Detail=4.0, Roughness=0.6)
    nt.links.new(uv.outputs["Object"], noise.inputs["Vector"])
    fade = value(nt, "fade", 1.0)
    # d > 0 where the image survives; the dissolve front glows
    d = math_node(nt, "SUBTRACT", math_node(nt, "MULTIPLY", fade, 1.3), noise.outputs["Fac"])
    vis = math_node(nt, "MULTIPLY_ADD", d, 14.0)
    vis.node.inputs[2].default_value = 0.5
    vis = math_node(nt, "MINIMUM", math_node(nt, "MAXIMUM", vis, 0.0), 1.0)
    edge = math_node(nt, "SUBTRACT", 1.0, math_node(nt, "MULTIPLY", math_node(nt, "ABSOLUTE", d), 9.0), clamp_=True)
    edge = math_node(nt, "MULTIPLY", edge, math_node(nt, "LESS_THAN", fade, 0.97))
    alpha = tex.outputs["Alpha"]
    if reveal:
        # sweep clockwise from the top: radial gradient of object coords
        grad = nt.nodes.new("ShaderNodeTexGradient")
        grad.gradient_type = "RADIAL"
        nt.links.new(uv.outputs["Object"], grad.inputs["Vector"])
        u = math_node(nt, "FRACT", math_node(nt, "SUBTRACT", 0.75, grad.outputs["Fac"]))
        sweep = value(nt, "sweep", 1.0)
        alpha = math_node(nt, "MULTIPLY", alpha, math_node(nt, "LESS_THAN", u, sweep))
        front = math_node(nt, "SUBTRACT", 1.0, math_node(nt, "MULTIPLY", math_node(nt, "ABSOLUTE", math_node(nt, "SUBTRACT", u, sweep)), 30.0), clamp_=True)
        alpha = math_node(nt, "MAXIMUM", alpha, math_node(nt, "MULTIPLY", front, math_node(nt, "MULTIPLY", tex.outputs["Alpha"], 1.0)))
    a_vis = math_node(nt, "MULTIPLY", alpha, vis)
    a_edge = math_node(nt, "MULTIPLY", alpha, edge)
    e1 = node(nt, "ShaderNodeEmission")
    nt.links.new(tex.outputs["Color"], e1.inputs["Color"])
    strength_n = value(nt, "strength", strength)
    nt.links.new(strength_n, e1.inputs["Strength"])
    e2 = node(nt, "ShaderNodeEmission", Color=(*glow, 1.0))
    nt.links.new(math_node(nt, "MULTIPLY", a_edge, 4.0), e2.inputs["Strength"])
    # emission scaled by visibility so dissolving parts go dark, not grey
    mix_e = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(vis, mix_e.inputs["Fac"])
    black = node(nt, "ShaderNodeEmission", Strength=0.0)
    nt.links.new(black.outputs[0], mix_e.inputs[1])
    nt.links.new(e1.outputs[0], mix_e.inputs[2])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(mix_e.outputs[0], add.inputs[0])
    nt.links.new(e2.outputs[0], add.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    a_all = math_node(nt, "MINIMUM", math_node(nt, "MAXIMUM", a_vis, math_node(nt, "MULTIPLY", a_edge, 0.8)), 1.0)
    nt.links.new(math_node(nt, "MULTIPLY", a_all, value(nt, "opacity", 1.0)), mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(add.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def emit_material(name, color, strength, dash=None, reveal=False):
    m, nt = new_mat(name)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = node(nt, "ShaderNodeEmission", Color=(*color, 1.0))
    nt.links.new(value(nt, "strength", strength), e.inputs["Strength"])
    fac = value(nt, "alpha", 1.0)
    co = nt.nodes.new("ShaderNodeTexCoord")
    if dash or reveal:
        grad = nt.nodes.new("ShaderNodeTexGradient")
        grad.gradient_type = "RADIAL"
        nt.links.new(co.outputs["Object"], grad.inputs["Vector"])
        if dash:
            fac = math_node(nt, "MULTIPLY", fac, math_node(nt, "LESS_THAN", math_node(nt, "FRACT", math_node(nt, "MULTIPLY", grad.outputs["Fac"], dash)), 0.6))
        if reveal:
            u = math_node(nt, "FRACT", math_node(nt, "SUBTRACT", 0.75, grad.outputs["Fac"]))
            fac = math_node(nt, "MULTIPLY", fac, math_node(nt, "LESS_THAN", u, value(nt, "sweep", 1.0)))
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fac, mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(e.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def set_val(mat, name, v):
    mat.node_tree.nodes[name].outputs[0].default_value = v


# --------------------------------------------------------------------------------------------------- objects


def plane(name, mat, w, h):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co.x + 0.5, lp.vert.co.y + 0.5)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    ob.scale = (w, h, 1)
    return ob


def torus(name, major, minor, mat, z=0.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=384, minor_segments=8, location=(0, 0, z))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


def ticks(name, mat, z):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for i in range(48):
        a = i / 48 * TAU
        r0, r1 = 0.925, (0.995 if i % 12 == 0 else 0.955)
        w = 0.0035
        c, s = math.cos(a), math.sin(a)
        px, py = -s * w, c * w
        vs = [bm.verts.new((c * r0 + px, s * r0 + py, z)), bm.verts.new((c * r1 + px, s * r1 + py, z)), bm.verts.new((c * r1 - px, s * r1 - py, z)), bm.verts.new((c * r0 - px, s * r0 - py, z))]
        bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def points(name, n, mat):
    """A cloud of n points; positions, radii and brightness are set each frame"""
    me = bpy.data.meshes.new(name)
    me.vertices.add(n)
    for attr in ("radius", "bright", "tint"):
        me.attributes.new(attr, "FLOAT", "POINT")
    ob = link(bpy.data.objects.new(name, me))
    ng = bpy.data.node_groups.new(name + "-gn", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi, go = ng.nodes.new("NodeGroupInput"), ng.nodes.new("NodeGroupOutput")
    m2p = ng.nodes.new("GeometryNodeMeshToPoints")
    na = ng.nodes.new("GeometryNodeInputNamedAttribute")
    na.data_type = "FLOAT"
    na.inputs["Name"].default_value = "radius"
    sm = ng.nodes.new("GeometryNodeSetMaterial")
    sm.inputs["Material"].default_value = mat
    ng.links.new(gi.outputs[0], m2p.inputs["Mesh"])
    ng.links.new(na.outputs["Attribute"], m2p.inputs["Radius"])
    ng.links.new(m2p.outputs["Points"], sm.inputs["Geometry"])
    ng.links.new(sm.outputs["Geometry"], go.inputs[0])
    mod = ob.modifiers.new("pts", "NODES")
    mod.node_group = ng
    return ob


def point_material(name):
    m, nt = new_mat(name)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    br = nt.nodes.new("ShaderNodeAttribute")
    br.attribute_name = "bright"
    ti = nt.nodes.new("ShaderNodeAttribute")
    ti.attribute_name = "tint"
    mixc = nt.nodes.new("ShaderNodeMix")
    mixc.data_type = "RGBA"
    nt.links.new(ti.outputs["Fac"], mixc.inputs["Factor"])
    mixc.inputs["A"].default_value = (0.8, 0.84, 1.0, 1)
    mixc.inputs["B"].default_value = (1.0, 1.0, 1.0, 1)
    e = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mixc.outputs["Result"], e.inputs["Color"])
    nt.links.new(math_node(nt, "MULTIPLY", br.outputs["Fac"], 6.0), e.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(math_node(nt, "MINIMUM", math_node(nt, "MULTIPLY", br.outputs["Fac"], 1.5), 1.0), mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(e.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def mist_material():
    """Volumetric mist: domain-warped noise that drifts round a closed loop, denser and brighter toward the edge"""
    m, nt = new_mat("mist")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    co = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]

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

    def vscale(a, s):
        n = nt.nodes.new("ShaderNodeVectorMath")
        n.operation = "SCALE"
        nt.links.new(a, n.inputs[0])
        n.inputs["Scale"].default_value = s
        return n.outputs[0]

    p1 = vadd(vscale(co, 1.5), offset("o1"))
    n1 = node(nt, "ShaderNodeTexNoise", Scale=1.0, Detail=3.0, Roughness=0.5)
    nt.links.new(p1, n1.inputs["Vector"])
    warp = nt.nodes.new("ShaderNodeVectorMath")
    warp.operation = "MULTIPLY_ADD"
    nt.links.new(n1.outputs["Color"], warp.inputs[0])
    warp.inputs[1].default_value = (1.6, 1.6, 1.6)
    warp.inputs[2].default_value = (-0.8, -0.8, -0.8)
    p2 = vadd(vadd(vscale(co, 2.3), warp.outputs[0]), offset("o2"))
    n2 = node(nt, "ShaderNodeTexNoise", Scale=1.0, Detail=6.0, Roughness=0.58)
    nt.links.new(p2, n2.inputs["Vector"])
    e = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", n2.outputs["Fac"], 0.47), 6.5, clamp_=True)
    e3 = math_node(nt, "POWER", e, 2.0)
    # radial: fade to nothing at the rim, thinner at the centre so the tokens stay clear
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(co, sep.inputs[0])
    r = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", sep.outputs[0], sep.outputs[0]), math_node(nt, "MULTIPLY", sep.outputs[1], sep.outputs[1])))
    rim = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", 0.985, r), 25.0, clamp_=True)
    bias_n = nt.nodes.new("ShaderNodeMapRange")
    bias_n.interpolation_type = "SMOOTHSTEP"
    nt.links.new(r, bias_n.inputs["Value"])
    bias_n.inputs["From Min"].default_value = 0.1
    bias_n.inputs["From Max"].default_value = 0.95
    bias_n.inputs["To Min"].default_value = 0.35
    bias_n.inputs["To Max"].default_value = 1.0
    grow = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", value(nt, "billow", 2.0), r), 5.0, clamp_=True)
    mask = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", rim, bias_n.outputs["Result"]), grow)
    density = math_node(nt, "MULTIPLY", math_node(nt, "ADD", math_node(nt, "MULTIPLY", e3, 9.0), 2.2), mask)
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.05, 0.05, 0.08, 1)
    vol.inputs["Absorption Color"].default_value = (0.0, 0.0, 0.0, 1)
    nt.links.new(density, vol.inputs["Density"])
    mixc = nt.nodes.new("ShaderNodeMix")
    mixc.data_type = "RGBA"
    nt.links.new(e, mixc.inputs["Factor"])
    mixc.inputs["A"].default_value = (0.12, 0.13, 0.24, 1)
    mixc.inputs["B"].default_value = (0.36, 0.34, 1.0, 1)
    nt.links.new(mixc.outputs["Result"], vol.inputs["Emission Color"])
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", math_node(nt, "POWER", e, 4.0), 2.4), mask), vol.inputs["Emission Strength"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return m


def point_light(name, energy, color=(0.78, 0.82, 1.0), radius=0.08):
    li = bpy.data.lights.new(name, "POINT")
    li.energy = energy
    li.color = color
    li.shadow_soft_size = radius
    return link(bpy.data.objects.new(name, li))


# --------------------------------------------------------------------------------------------------- build
# One scene for both modes. "intro" builds the aura up (the mist billows out, the ring and runes draw in) over the
# 2 seconds that lead into the loop: its phase runs from just before 0 up to 0, so its last frame hands straight over
# to the loop's first.

R = random.Random(11)
FACE_FILES = ["king", "delight", "joy", "calm", "longing", "grief", "fear"]


def face_aspect(name):
    img = bpy.data.images.load(os.path.join(SPRITES, f"face-{name}.png"), check_existing=True)
    return img.size[0] / img.size[1]


bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=1.0, depth=0.3, location=(0, 0, -0.15))
mist = bpy.context.active_object
mist_mat = mist_material()
mist.data.materials.append(mist_mat)
mist_lights = []
for i in range(5):
    a = i / 5 * TAU + 0.4
    li = point_light(f"mist-light-{i}", 0.04, (0.62, 0.66, 1.0), 0.2)
    li.location = (math.cos(a) * 0.62, math.sin(a) * 0.62, -0.05)
    mist_lights.append(li)

silver = emit_material("silver", (0.86, 0.89, 0.97), 2.2, reveal=True)
torus("ring-a", 0.955, 0.0035, silver, 0.02)
torus("ring-b", 0.925, 0.0028, silver, 0.02)
tick_ob = ticks("ticks", silver, 0.021)
dash_mat = emit_material("dash", (0.8, 0.84, 0.95), 1.4, dash=60, reveal=True)
inner = torus("inner", 0.66, 0.0025, dash_mat, 0.02)
band_mat = sprite_material("band", os.path.join(ASSETS, "band", "0001.png"), 1.8, seq=LOOP_FRAMES, reveal=True)
band = plane("band", band_mat, 2.0, 2.0)
band.location.z = 0.03
if args.mode == "intro":
    # the intro is the 2 s before the loop starts: show the band's last frames
    for n in band_mat.node_tree.nodes:
        if n.type == "TEX_IMAGE":
            n.image_user.frame_offset = LOOP_FRAMES - INTRO_FRAMES

# The front of the sweep while the ring draws in
front_mat = emit_material("front", (1, 1, 1), 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, location=(0, 0, 0.05))
front_ob = bpy.context.active_object
front_ob.data.materials.append(front_mat)
front_light = point_light("front-light", 0.0, (0.9, 0.92, 1.0), 0.03)

# Faces scattered through the mist at different sizes and depths, kept apart and clear of Finch at the centre
placed = []
while len(placed) < len(FACE_FILES):
    a = R.random() * TAU
    rad = 0.3 + R.random() * 0.52
    size = 0.18 + R.random() * 0.22
    x, y = math.cos(a) * rad, math.sin(a) * rad
    if all(math.hypot(x - px, y - py) > (size + ps) * 0.55 for px, py, ps, _ in placed):
        placed.append((x, y, size, -0.02 - R.random() * 0.1))
faces = []
for i, name in enumerate(FACE_FILES):
    x, y, size, z = placed[i]
    mat = sprite_material(f"face-{i}", os.path.join(SPRITES, f"face-{name}.png"), 0.9)
    ob = plane(f"face-{i}", mat, size * face_aspect(name), size)
    li = point_light(f"face-light-{i}", 0.0, (0.75, 0.8, 1.0), 0.06)
    faces.append((ob, mat, li, x, y, z, i / len(FACE_FILES) + R.random() * 0.05, R.random() * TAU))

trinkets = []
for i in range(6):
    path = os.path.join(SPRITES, f"trinket-{i + 1}.png")
    img = bpy.data.images.load(path, check_existing=True)
    mat = sprite_material(f"trinket-{i}", path, 1.0, glow=(0.7, 0.74, 1.0))
    h = 0.11 + R.random() * 0.04
    ob = plane(f"trinket-{i}", mat, h * img.size[0] / img.size[1], h)
    trinkets.append((ob, mat, R.random(), R.random() * TAU, 0.3 + R.random() * 0.55, R.random() * TAU, R.random() * TAU))

NSTAR, NMOTE = 260, 120
cloud = points("cloud", NSTAR + NMOTE, point_material("stars"))
stars = [(R.random() * TAU, math.sqrt(R.random()) * 0.95, R.random() < 0.06, 1 + R.randrange(3), R.random(), R.random() < 0.2) for _ in range(NSTAR)]
motes = [(R.random(), R.random() * TAU, 1 + R.randrange(2), R.random()) for _ in range(NMOTE)]


def face_fade(u):
    """Surface slowly, linger, recede slowly, then stay gone: active for 60% of the face's cycle"""
    if u >= 0.6:
        return 0.0
    return win(u / 0.6, 0.42, 0.58)


def update(scene, *_):
    t = scene.frame_current - 1 + scene.frame_subframe
    if args.mode == "intro":
        ti = t / 30
        ph = fr((t - INTRO_FRAMES) / LOOP_FRAMES)
        billow = 1.15 * ease_out(seg(ti, 0.0, 1.6))
        sweep = smooth(seg(ti, 0.5, 1.7))
        appear = seg(ti, 1.2, 2.0)
    else:
        ph = fr(t / LOOP_FRAMES)
        billow, sweep, appear = 2.0, 1.0, 1.0
    th = TAU * ph
    for k, v in zip("xyz", (math.cos(th) * 0.45, math.sin(th) * 0.45, 0.35 * math.sin(th))):
        set_val(mist_mat, f"o1{k}", v)
    for k, v in zip("xyz", (math.cos(-th) * 0.3 + 3.1, math.sin(-th) * 0.3 - 1.7, 0.5 * math.sin(th))):
        set_val(mist_mat, f"o2{k}", v)
    set_val(mist_mat, "billow", billow)
    for li in mist_lights:
        li.data.energy = 0.04 * min(1.0, billow)
    for m in (silver, dash_mat, band_mat):
        set_val(m, "sweep", sweep)
    on = 1.0 if 0 < sweep < 1 else 0.0
    a1 = math.pi / 2 - sweep * TAU
    front_ob.location = (math.cos(a1) * 0.94, math.sin(a1) * 0.94, 0.05)
    set_val(front_mat, "strength", 30 * on)
    set_val(front_mat, "alpha", on)
    front_light.location = front_ob.location
    front_light.data.energy = 0.6 * on
    tick_ob.rotation_euler.z = ph * TAU / 4
    inner.rotation_euler.z = ph * math.pi
    for ob, mat, li, x, y, z, off, wob in faces:
        f = face_fade(fr(ph + off))
        drift = 0.025
        ob.location = (x + drift * math.sin(th + wob), y + drift * math.cos(th * 2 + wob), z)
        ob.rotation_euler.z = 0.12 * math.sin(th + wob)
        set_val(mat, "fade", f)
        set_val(mat, "opacity", 0.42 * f * appear)
        li.location = (ob.location.x, ob.location.y, z - 0.02)
        li.data.energy = 0.05 * f * appear
    for ob, mat, off, a, rad, dirn, rot0 in trinkets:
        u = fr(ph * 2 + off)
        set_val(mat, "fade", win(u, 0.3, 0.6))
        set_val(mat, "opacity", appear)
        ob.location = (math.cos(a) * rad + math.cos(dirn) * u * 0.12, math.sin(a) * rad + math.sin(dirn) * u * 0.12, 0.05)
        ob.rotation_euler.z = rot0 + u * 1.4
    co, radius, bright, tint = [], [], [], []
    for a, rad, big, k, off, silv in stars:
        tw = 0.5 + 0.5 * math.sin(TAU * (ph * k * 2 + off))
        co += [math.cos(a) * rad, math.sin(a) * rad, 0.04]
        radius.append((0.006 if big else 0.0025) * (0.7 + 0.3 * tw))
        bright.append((0.25 + 0.75 * tw) * (1.0 if big else 0.6) * clamp((billow - rad) * 4))
        tint.append(1.0 if silv else 0.0)
    for off, a0, k, sz in motes:
        u = fr(ph * k * 2 + off)
        a = a0 + u * 0.6
        rad = 0.2 + 0.75 * u
        co += [math.cos(a) * rad, math.sin(a) * rad, 0.05]
        radius.append(0.004 + sz * 0.004)
        bright.append(math.sin(math.pi * u) * 0.5 * clamp((billow - rad) * 4))
        tint.append(0.3)
    me = cloud.data
    me.vertices.foreach_set("co", co)
    me.attributes["radius"].data.foreach_set("value", radius)
    me.attributes["bright"].data.foreach_set("value", bright)
    me.attributes["tint"].data.foreach_set("value", tint)
    me.update()


sc.frame_start, sc.frame_end = 1, INTRO_FRAMES if args.mode == "intro" else LOOP_FRAMES

bpy.app.handlers.frame_change_pre.append(update)
if args.frames:
    a, b = (int(x) for x in args.frames.split("-"))
    sc.frame_start, sc.frame_end = a, b
os.makedirs(args.out, exist_ok=True)
sc.render.filepath = os.path.join(args.out, "")
bpy.ops.render.render(animation=True)
print("rendered", sc.frame_start, "to", sc.frame_end)
