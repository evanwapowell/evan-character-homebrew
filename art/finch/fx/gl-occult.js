/* Manifest Will (occult), "The Masquerade", rendered with WebGL2 shaders: domain-warped ether, rings and glyphs of
 * light, spectral masks, particle thistle-down, and bloom. Output is premultiplied RGBA, the aura's texture square.
 * Needs effects.js for the glyph and mask shapes. */

const GL_W = 800; // texture size, as shipped

const NOISE = `
vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
        mix(mix(dot(hash3(i + vec3(0, 0, 0)), f - vec3(0, 0, 0)), dot(hash3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
            mix(dot(hash3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)), dot(hash3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
        mix(mix(dot(hash3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)), dot(hash3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
            mix(dot(hash3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)), dot(hash3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y),
        u.z);
}
const mat3 OCT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * gnoise(p); p = OCT * p * 2.02; a *= 0.5; }
    return s;
}
`;

const COMMON = `#version 300 es
precision highp float;
#define TAU 6.28318530718
#define PI 3.14159265359
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float line(float x, float c, float w) { float d = (x - c) / w; return exp(-d * d); }
float seg(float t, float a, float b) { return clamp((t - a) / (b - a), 0.0, 1.0); }
float easeOut(float t) { return 1.0 - pow(1.0 - t, 3.0); }
float easeOutBack(float t) { float c1 = 2.2; float u = t - 1.0; return 1.0 + (c1 + 1.0) * u * u * u + c1 * u * u; }
// A closed loop through noise space: sampling along it makes the animation seamless
vec3 orbit(float ph, float r, float z) { return vec3(r * cos(TAU * ph), r * sin(TAU * ph), z * sin(TAU * ph)); }
const vec3 GOLD = vec3(0.95, 0.79, 0.42);
const vec3 GOLD_HI = vec3(1.0, 0.95, 0.78);
const vec3 VIOLET = vec3(0.45, 0.45, 1.0);
const vec3 LILAC = vec3(0.82, 0.86, 1.0);
const float MASK_H = 0.15; // half-size of a mask's cell, in emanation radii
`;

const QUAD_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/* Masks: shared sampling of the atlas (fill, outline, glow), 2×2 cells: crown, comedy, domino, tragedy */
const MASKS = `
uniform sampler2D uMaskFill, uMaskLine, uMaskBlur;
vec3 maskSample(int k, vec2 m) {
    // m in [-1, 1] across the cell
    if (abs(m.x) > 1.0 || abs(m.y) > 1.0) return vec3(0.0);
    vec2 cell = vec2(float(k % 2), float(1 - k / 2)) * 0.5;
    vec2 uv = cell + (m * 0.5 + 0.5) * 0.5;
    return vec3(texture(uMaskFill, uv).a, texture(uMaskLine, uv).a, texture(uMaskBlur, uv).a);
}
`;

const AURA_FS =
    COMMON +
    NOISE +
    MASKS +
    `
in vec2 vUv; out vec4 o;
uniform float uPh;
uniform sampler2D uGlyph, uGlyphBlur;

void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    if (r > 1.02) { o = vec4(0.0); return; }
    float inside = smoothstep(1.0, 0.965, r);
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // The ether: domain-warped noise drifting round a closed loop, brighter toward the edge
    vec3 P = vec3(p * 1.5, 0.0);
    vec2 w = vec2(fbm(P + orbit(uPh, 0.45, 0.35)), fbm(P + vec3(5.2, 1.3, 2.0) + orbit(uPh + 0.37, 0.45, 0.35)));
    float e = 0.5 + 0.6 * fbm(vec3(p * 2.3 + 1.5 * w, 3.0) + orbit(-uPh, 0.3, 0.5));
    float edgeBias = mix(0.3, 1.0, smoothstep(0.1, 0.95, r));
    float ee = clamp(e, 0.0, 1.0);
    float ea = clamp((0.04 + 0.55 * pow(ee, 4.0)) * edgeBias, 0.0, 1.0);
    vec3 ec = mix(vec3(0.04, 0.05, 0.18), vec3(0.3, 0.32, 0.9), ee);
    col += ec * ea;
    alpha += (0.05 * edgeBias + ea) * 0.75;
    // Fine filaments where the warp folds over
    float ridge = 1.0 - abs(fbm(vec3(p * 3.0 + 0.9 * w, 7.0) + orbit(uPh + 0.6, 0.3, 0.4)));
    ridge = pow(clamp(ridge, 0.0, 1.0), 10.0) * edgeBias;
    col += mix(VIOLET, LILAC, 0.5) * ridge * 0.45;
    alpha += ridge * 0.25;

    // Outer rings of gold light, flickering along their length, with two comets running round
    float flick = 0.75 + 0.5 * fbm(vec3(cos(a) * 2.5, sin(a) * 2.5, 11.0) + orbit(uPh, 0.6, 0.6));
    float head = PI * 0.5 - TAU * uPh;
    float d1 = mod(head - a + TAU, TAU);
    float d2 = mod(head + PI - a + TAU, TAU);
    float comet = exp(-d1 * 1.8) + exp(-d2 * 1.8);
    float rings = line(r, 0.955, 0.0045) + 0.7 * line(r, 0.925, 0.0035);
    col += GOLD * rings * flick * (0.9 + 2.5 * comet);
    col += GOLD * line(r, 0.94, 0.035) * 0.25 * (0.6 + comet);
    alpha += rings * 0.8;
    // Ticks, turning 90° a loop
    float u = a / TAU + uPh * 0.25;
    float k = floor(u * 48.0 + 0.5);
    float da = abs(fract(u * 48.0 + 0.5) - 0.5) / 48.0 * TAU * r;
    bool long_ = mod(k, 12.0) < 0.5;
    float tick = exp(-pow(da / 0.0035, 2.0)) * step(0.925, r) * step(r, long_ ? 0.995 : 0.955);
    col += GOLD * tick * flick * 0.9;
    alpha += tick * 0.6;

    // Glyph band, counter-rotating 90° a loop, shimmering glyph by glyph
    vec2 q = rot(uPh * TAU * 0.25) * p;
    vec2 guv = q * 0.5 + 0.5;
    float gs = texture(uGlyph, guv).a;
    float gb = texture(uGlyphBlur, guv).a;
    float ga = atan(q.y, q.x);
    float idx = floor(mod(PI * 0.5 - ga + PI / 24.0, TAU) / TAU * 24.0);
    float shimmer = 0.55 + 0.45 * sin(TAU * uPh * 2.0 + mod(idx, 6.0) * 1.7); // the band turns 6 glyphs a loop
    shimmer *= 0.8 + 0.4 * fbm(vec3(q * 9.0, 2.0) + orbit(uPh, 0.8, 0.8));
    col += (vec3(0.86, 0.9, 1.0) * gs * 1.1 + VIOLET * gb * 1.4) * shimmer;
    alpha += (gs * 0.8 + gb * 0.4) * shimmer;

    // Inner ring of stitches with eight stars, turning 180° a loop
    float dash = smoothstep(0.35, 0.45, fract(a / TAU * 60.0 - uPh * 30.0)) * smoothstep(0.95, 0.85, fract(a / TAU * 60.0 - uPh * 30.0));
    float stitch = line(r, 0.66, 0.003) * dash;
    col += GOLD * stitch * 0.8 + GOLD * line(r, 0.66, 0.02) * 0.08;
    alpha += stitch * 0.6;
    float cellA = TAU / 8.0;
    float sa = a - uPh * PI;
    float si = floor((sa + cellA * 0.5) / cellA);
    float la = sa - si * cellA;
    vec2 sq = vec2(r - 0.66, la * r);
    float big = mod(si, 2.0) < 0.5 ? 1.0 : 0.6;
    float star = (0.00035 / (abs(sq.x * sq.y) + 0.00004)) * exp(-length(sq) * 30.0 / big) * big;
    star += exp(-dot(sq, sq) / (0.0001 * big)) * 1.5;
    col += mix(LILAC, GOLD_HI, big - 0.6 > 0.1 ? 0.0 : 1.0) * star * 0.6;
    alpha += min(star, 1.0) * 0.4;

    // The four masks, spectral porcelain that wavers like heat haze and breathes in turn
    for (int i = 0; i < 4; i++) {
        float ang = PI * 0.5 - float(i) * PI * 0.5;
        vec2 c = 0.5 * vec2(cos(ang), sin(ang));
        vec2 wob = 0.04 * vec2(fbm(vec3(p * 7.0, 20.0 + float(i)) + orbit(uPh, 0.7, 0.7)),
                               fbm(vec3(p * 7.0, 30.0 + float(i)) + orbit(uPh + 0.25, 0.7, 0.7)));
        vec2 m = (p - c) / MASK_H + wob;
        vec3 s = maskSample(i, m);
        if (s.x + s.y + s.z <= 0.0) continue;
        float breathe = 0.55 + 0.45 * (0.5 + 0.5 * sin(TAU * uPh - float(i) * TAU / 4.0));
        float grain = 0.85 + 0.3 * fbm(vec3(m * 3.0, 40.0 + float(i)));
        vec3 porcelain = mix(vec3(0.55, 0.6, 0.95), vec3(0.95, 0.96, 1.0), clamp(m.y * 0.5 + 0.6, 0.0, 1.0)) * grain;
        col += porcelain * s.x * 0.75 * breathe + GOLD * s.y * 1.1 * breathe + VIOLET * s.z * 0.9 * breathe;
        alpha += (s.x * 0.65 + s.y * 0.7 + s.z * 0.3) * breathe;
    }

    o = vec4(col * inside, clamp(alpha, 0.0, 1.0) * inside);
}`;

/* Thistle-down for the loop: each mote's path repeats a whole number of times a loop */
const MOTES_VS =
    COMMON +
    `
in vec4 aSeed;
uniform float uPh, uScale;
out float vAlpha; out float vGold; out float vStar;
void main() {
    float lanes = 1.0 + floor(aSeed.y * 2.0);
    float life = fract(uPh * lanes + aSeed.x);
    float dir = aSeed.w < 0.5 ? 1.0 : -1.0;
    float a = aSeed.z * TAU + dir * life * TAU * 0.25 * lanes;
    float rad = mix(0.18, 0.97, life) + 0.02 * sin(TAU * life * 3.0 + aSeed.z * 20.0);
    gl_Position = vec4(rad * cos(a), rad * sin(a), 0.0, 1.0);
    vStar = step(0.93, fract(aSeed.x * 13.7));
    gl_PointSize = mix(2.5, 7.0, fract(aSeed.w * 7.1)) * uScale * (1.0 + vStar * 2.5);
    vAlpha = sin(PI * life) * mix(0.4, 1.0, fract(aSeed.y * 5.3));
    vGold = step(0.82, fract(aSeed.x * 7.3));
}`;

const MOTES_FS =
    COMMON +
    `
in float vAlpha; in float vGold; in float vStar;
out vec4 o;
void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    float core = exp(-d * 9.0);
    float halo = exp(-d * 2.5) * 0.35;
    float star = vStar * (max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y)) + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x)));
    float i = (core + halo + star) * vAlpha;
    vec3 col = mix(LILAC, GOLD_HI, vGold);
    o = vec4(col * i, i * 0.5);
}`;

/* The cast: a veil of light, the masks spiralling out to their places with motion blur, a chromatic shockwave, and
 * the glyphs etching in behind a sweeping front */
const CAST_FS =
    COMMON +
    NOISE +
    MASKS +
    `
in vec2 vUv; out vec4 o;
uniform float uT;
uniform sampler2D uGlyph, uGlyphBlur;

vec4 maskPath(int k, float t) {
    float delay = float(k) * 0.08;
    float out_ = easeOutBack(seg(t, 0.15 + delay, 0.75 + delay));
    float oc = clamp(out_, 0.0, 1.0);
    float ang = PI * 0.5 - float(k) * PI * 0.5 + (1.0 - oc) * 1.4;
    return vec4(0.5 * out_ * vec2(cos(ang), sin(ang)), (1.0 - oc) * 2.5, out_);
}

void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float t = uT;
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // Flare at the witch
    float f = sin(PI * seg(t, 0.0, 0.7));
    float flare = exp(-r * r / (0.004 + 0.03 * f)) * f;
    col += GOLD_HI * flare * 2.0;
    alpha += flare;

    // A veil of blue light ripples out
    float v = seg(t, 0.05, 0.75);
    float vr = 0.12 + 0.88 * easeOut(v);
    float veil = line(r, vr, 0.05 + 0.08 * v) * (1.0 - v) * (0.7 + 0.6 * fbm(vec3(p * 4.0, t * 2.0)));
    col += VIOLET * veil * 0.6;
    alpha += veil * 0.3;

    // The masks, with motion blur along their spiral
    float fade = seg(t, 1.4, 2.0);
    for (int k = 0; k < 4; k++) {
        vec3 acc = vec3(0.0);
        float settle = seg(t, 0.75 + float(k) * 0.08, 1.3 + float(k) * 0.08);
        for (int j = 0; j < 5; j++) {
            vec4 mp = maskPath(k, t - float(j) * 0.014);
            if (mp.w <= 0.0) continue;
            float sc = 1.0 + 0.35 * sin(PI * settle);
            vec2 m = rot(mp.z) * (p - mp.xy) / (MASK_H * sc);
            acc += maskSample(k, m);
        }
        acc /= 5.0;
        float hot = 1.0 - settle;
        col += (vec3(0.62, 0.66, 0.95) * acc.x * 0.5 + GOLD * acc.y * 1.1 + mix(VIOLET, GOLD_HI, hot * 0.5) * acc.z * (0.45 + 0.4 * hot)) * (1.0 - fade);
        alpha += (acc.x * 0.8 + acc.y * 0.8 + acc.z * 0.4) * (1.0 - fade);
        // A ring of light as each takes its place
        vec4 home = maskPath(k, 3.0);
        float pr = length(p - home.xy);
        float pulse = line(pr, 0.12 + 0.12 * settle, 0.01) * (settle > 0.0 ? 1.0 - settle : 0.0);
        col += GOLD_HI * pulse;
        alpha += pulse * 0.5;
    }

    // Chromatic shockwave as the masks arrive
    float w = seg(t, 0.85, 1.5);
    if (w > 0.0 && w < 1.0) {
        float rw = 0.4 + 0.6 * easeOut(w);
        float fall = 1.0 - w;
        vec3 wave = vec3(line(r, rw + 0.012, 0.012), line(r, rw, 0.012), line(r, rw - 0.012, 0.012));
        col += (wave * vec3(1.0, 0.95, 1.2) + VIOLET * line(r, rw - 0.05, 0.06) * 0.4) * fall * 1.4;
        alpha += (wave.g + 0.2 * line(r, rw - 0.05, 0.06)) * fall;
    }

    // The glyphs etch in behind a front sweeping clockwise from the top
    float sweep = seg(t, 0.9, 1.5) * 1.08;
    float etchOut = seg(t, 1.6, 2.3);
    float ua = fract((PI * 0.5 - a) / TAU);
    float revealed = step(ua, sweep) * step(0.001, sweep);
    float front = exp(-pow((sweep - ua) * 25.0, 2.0)) * step(sweep, 1.07) * step(0.001, sweep);
    vec2 guv = p * 0.5 + 0.5;
    float gs = texture(uGlyph, guv).a;
    float gb = texture(uGlyphBlur, guv).a;
    col += (GOLD_HI * gs * 1.6 * revealed + GOLD_HI * gb * front * 3.0 + GOLD * gb * revealed * 0.6) * (1.0 - etchOut);
    alpha += (gs * revealed + gb * front) * (1.0 - etchOut);

    o = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

/* Thistle-down for the cast: sparks trailing the masks, then a burst outward */
const CAST_MOTES_VS =
    COMMON +
    `
in vec4 aSeed;
uniform float uT, uScale;
out float vAlpha; out float vGold; out float vStar;
vec2 maskPos(int k, float t) {
    float delay = float(k) * 0.08;
    float out_ = easeOutBack(seg(t, 0.15 + delay, 0.75 + delay));
    float ang = PI * 0.5 - float(k) * PI * 0.5 + (1.0 - clamp(out_, 0.0, 1.0)) * 1.4;
    return 0.5 * out_ * vec2(cos(ang), sin(ang));
}
void main() {
    vStar = step(0.9, fract(aSeed.x * 13.7));
    vGold = step(0.6, fract(aSeed.x * 7.3));
    if (aSeed.w < 0.55) {
        int k = int(floor(aSeed.x * 4.0));
        float born = 0.15 + float(k) * 0.08 + aSeed.y * 0.7;
        float life = seg(uT, born, born + 0.5);
        vec2 pos = maskPos(k, born) + (aSeed.zw - 0.25) * 0.08 + vec2(0.0, 0.05 * life);
        gl_Position = vec4(pos, 0.0, 1.0);
        vAlpha = (life > 0.0 && life < 1.0) ? (1.0 - life) : 0.0;
        gl_PointSize = mix(3.0, 8.0, aSeed.z) * uScale * (1.0 + vStar * 2.0);
    } else {
        float born = 0.9 + aSeed.y * 0.3;
        float life = seg(uT, born, born + 1.2);
        float ang = aSeed.z * TAU;
        float rad = 0.25 + 0.72 * easeOut(life) * mix(0.55, 1.0, fract(aSeed.w * 9.1));
        gl_Position = vec4(rad * cos(ang), rad * sin(ang), 0.0, 1.0);
        vAlpha = (life > 0.0 && life < 1.0) ? (1.0 - life) : 0.0;
        gl_PointSize = mix(2.5, 7.0, fract(aSeed.w * 3.3)) * uScale * (1.0 + vStar * 2.0);
    }
}`;

/* Bloom: bright pass, separable blur at two scales, then composite with soft tone mapping */
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uSrc;
void main() { vec4 c = texture(uSrc, vUv); o = vec4(max(c.rgb - 0.4, 0.0), 0.0); }`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uDir;
void main() {
    float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    vec3 s = texture(uSrc, vUv).rgb * w[0];
    for (int i = 1; i < 5; i++) {
        s += texture(uSrc, vUv + uDir * float(i)).rgb * w[i];
        s += texture(uSrc, vUv - uDir * float(i)).rgb * w[i];
    }
    o = vec4(s, 0.0);
}`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uSrc, uB1, uB2; uniform float uBloom;
void main() {
    vec4 c = texture(uSrc, vUv);
    vec3 b = texture(uB1, vUv).rgb * 0.9 + texture(uB2, vUv).rgb * 0.8;
    vec3 col = c.rgb + b * uBloom;
    col = 1.0 - exp(-col * 1.1);
    float a = max(c.a, max(col.r, max(col.g, col.b)));
    o = vec4(col, clamp(a, 0.0, 1.0));
}`;

/* ---------------------------------------------------------------------------------------------------------------- */

function makeOccultTextures() {
    const S = 1024;
    const R = S / 2;
    const canvas = () => {
        const c = document.createElement("canvas");
        c.width = c.height = S;
        return c;
    };
    const blurred = (src, px) => {
        const c = canvas();
        const ctx = c.getContext("2d");
        ctx.filter = `blur(${px}px)`;
        ctx.drawImage(src, 0, 0);
        ctx.drawImage(src, 0, 0);
        return c;
    };

    // Glyph ring, upright, the 24 glyphs at 0.84 R
    const glyph = canvas();
    {
        const ctx = glyph.getContext("2d");
        ctx.translate(R, R);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = R * 0.01;
        ctx.lineCap = "round";
        for (let i = 0; i < 24; i++) {
            ctx.save();
            ctx.rotate((i / 24) * TAU);
            ctx.translate(0, -R * 0.84);
            drawGlyph(ctx, GLYPHS[i % 6], R * 0.085);
            ctx.restore();
        }
    }

    // Mask atlas: 2×2 cells of half-size MASK_H radii, so a cell spans 2 × 0.15 R of the emanation
    const fill = canvas();
    const outline = canvas();
    const cellPx = S / 2;
    const s = (0.2 / (2 * 0.15)) * cellPx; // the masks' size in the old 2D design, s = 0.2 R
    const kinds = ["crown", "comedy", "domino", "tragedy"];
    kinds.forEach((kind, k) => {
        const cx = (k % 2) * cellPx + cellPx / 2;
        const cy = Math.floor(k / 2) * cellPx + cellPx / 2;
        for (const [c, mode] of [
            [fill, "fill"],
            [outline, "line"],
        ]) {
            const ctx = c.getContext("2d");
            ctx.save();
            ctx.translate(cx, cy);
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = s * 0.03;
            ctx.lineJoin = "round";
            const shape = () => {
                if (kind === "domino") {
                    ctx.scale(1.1, 1.1);
                    dominoPath(ctx, s);
                } else if (kind === "crown") {
                    ctx.translate(0, s * 0.1);
                    faceMaskPath(ctx, s * 0.8, 1);
                } else faceMaskPath(ctx, s * 0.85, kind === "comedy" ? 1 : -1);
            };
            ctx.save();
            shape();
            if (mode === "fill") ctx.fill("evenodd");
            else ctx.stroke();
            ctx.restore();
            if (kind === "crown" && mode === "line") drawCrown(ctx, 0, -s * 0.3, s * 0.5, "#fff");
            ctx.restore();
        }
    });
    return { glyph, glyphBlur: blurred(glyph, 7), fill, outline, maskBlur: blurred(fill, 14) };
}

class OccultRenderer {
    constructor(size = GL_W) {
        this.size = size;
        this.canvas = document.createElement("canvas");
        this.canvas.width = this.canvas.height = size;
        const gl = (this.gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true }));
        gl.getExtension("EXT_color_buffer_float");
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        this.prog = {
            aura: this.program(QUAD_VS, AURA_FS),
            motes: this.program(MOTES_VS, MOTES_FS),
            cast: this.program(QUAD_VS, CAST_FS),
            castMotes: this.program(CAST_MOTES_VS, MOTES_FS),
            bright: this.program(QUAD_VS, BRIGHT_FS),
            blur: this.program(QUAD_VS, BLUR_FS),
            final: this.program(QUAD_VS, FINAL_FS),
        };
        const r = rng(1234);
        const seeds = (n) => {
            const b = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Array.from({ length: n * 4 }, r)), gl.STATIC_DRAW);
            return { b, n };
        };
        this.moteSeeds = seeds(650);
        this.castSeeds = seeds(500);
        const tex = makeOccultTextures();
        this.tex = Object.fromEntries(Object.entries(tex).map(([k, c]) => [k, this.texture(c)]));
        this.fbo = { scene: this.target(size), h1: this.target(size / 2), h2: this.target(size / 2), q1: this.target(size / 4), q2: this.target(size / 4) };
    }

    program(vs, fs) {
        const gl = this.gl;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n"));
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        return p;
    }

    texture(canvas) {
        const gl = this.gl;
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }

    target(size) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex, fb, size };
    }

    use(p, uniforms = {}, textures = {}) {
        const gl = this.gl;
        gl.useProgram(p);
        for (const [k, v] of Object.entries(uniforms)) {
            const loc = gl.getUniformLocation(p, k);
            if (Array.isArray(v)) gl[`uniform${v.length}f`](loc, ...v);
            else gl.uniform1f(loc, v);
        }
        Object.entries(textures).forEach(([k, t], i) => {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.uniform1i(gl.getUniformLocation(p, k), i);
        });
    }

    drawQuad(p) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        const loc = gl.getAttribLocation(p, "aPos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    drawPoints(p, { b, n }) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        const loc = gl.getAttribLocation(p, "aSeed");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, n);
    }

    bind(target) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
        const s = target ? target.size : this.size;
        gl.viewport(0, 0, s, s);
    }

    /** Render one frame: the loop at phase `ph` (0..1) if loop is set, the cast at `castT` seconds if set */
    render({ ph = null, castT = null }) {
        const gl = this.gl;
        const T = this.tex;
        const scale = this.size / 800;
        this.bind(this.fbo.scene);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.BLEND);
        const maskTex = { uMaskFill: T.fill, uMaskLine: T.outline, uMaskBlur: T.maskBlur };
        if (ph !== null) {
            this.use(this.prog.aura, { uPh: ph }, { uGlyph: T.glyph, uGlyphBlur: T.glyphBlur, ...maskTex });
            this.drawQuad(this.prog.aura);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.use(this.prog.motes, { uPh: ph, uScale: scale });
            this.drawPoints(this.prog.motes, this.moteSeeds);
        }
        if (castT !== null) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.use(this.prog.cast, { uT: castT }, { uGlyph: T.glyph, uGlyphBlur: T.glyphBlur, ...maskTex });
            this.drawQuad(this.prog.cast);
            this.use(this.prog.castMotes, { uT: castT, uScale: scale });
            this.drawPoints(this.prog.castMotes, this.castSeeds);
        }
        gl.disable(gl.BLEND);
        // Bloom
        const F = this.fbo;
        this.bind(F.h1);
        this.use(this.prog.bright, {}, { uSrc: F.scene.tex });
        this.drawQuad(this.prog.bright);
        const blur = (src, dst, dir) => {
            this.bind(dst);
            this.use(this.prog.blur, { uDir: dir }, { uSrc: src.tex });
            this.drawQuad(this.prog.blur);
        };
        for (const step of [1.5, 3]) {
            blur(F.h1, F.h2, [step / F.h1.size, 0]);
            blur(F.h2, F.h1, [0, step / F.h1.size]);
        }
        blur(F.h1, F.q1, [0, 0]);
        for (const step of [2, 4]) {
            blur(F.q1, F.q2, [step / F.q1.size, 0]);
            blur(F.q2, F.q1, [0, step / F.q1.size]);
        }
        this.bind(null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.use(this.prog.final, { uBloom: 1.0 }, { uSrc: F.scene.tex, uB1: F.h1.tex, uB2: F.q1.tex });
        this.drawQuad(this.prog.final);
        gl.finish();
        return this.canvas;
    }
}
