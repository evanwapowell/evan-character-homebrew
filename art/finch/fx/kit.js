/* The mockup kit: shapes drawn on two 2D canvases (a "solid" layer that dissolves like a fading memory where it's
 * partly transparent, and a "light" layer that's added as glow), composited by a shader with an optional mist
 * emanation, then bloomed. Needs gl-occult.js for the shared GLSL and the bloom shaders. */

const COMPOSE_FS =
    COMMON +
    NOISE +
    `
in vec2 vUv; out vec4 o;
uniform sampler2D uSolid, uLight;
uniform vec2 uRes;
uniform float uSeed, uPh, uDensity, uHaze, uStorm;
uniform vec2 uNoiseOff;
uniform vec4 uMist; // cx, cy, R in pixels (y up), on
uniform vec3 uBase, uMid, uHi, uEdge;

const vec3 FAITH[5] = vec3[](vec3(1.0, 0.95, 0.82), vec3(1.0, 0.45, 0.25), vec3(0.3, 0.88, 0.82), vec3(0.8, 0.85, 0.95), vec3(0.55, 0.42, 1.0));
void main() {
    vec2 px = vUv * uRes;
    vec2 wob = uHaze * vec2(fbm(vec3(px / 70.0 + uNoiseOff * 0.3, uSeed)), fbm(vec3(px / 70.0 + 13.1 + uNoiseOff * 0.3, uSeed)));
    vec4 S = texture(uSolid, (px + wob) / uRes);
    vec4 L = texture(uLight, vUv);

    // Dissolve: a solid shape's alpha is how well it's remembered; noise decides which parts are already lost
    float a = S.a;
    float n = clamp(0.5 + 0.9 * fbm(vec3(px / 20.0 + uNoiseOff, uSeed + 5.0)), 0.02, 0.98);
    float vis = smoothstep(n - 0.04, n + 0.04, a) * step(0.004, a);
    vec3 sc = S.rgb / max(a, 1e-4);
    float edge = exp(-pow((a - n) / 0.05, 2.0)) * step(0.02, a) * step(a, 0.985);
    vec3 col = sc * vis + uEdge * edge * 1.3;
    float al = clamp(max(vis, edge * 0.7), 0.0, 1.0);

    // Mist: a dark blue-violet base with drifting grey-violet smoke, inside the emanation
    vec3 mc = vec3(0.0);
    float ma = 0.0;
    if (uMist.w > 0.5) {
        vec2 p = (px - uMist.xy) / uMist.z;
        float r = length(p);
        if (r < 1.02) {
            float inside = smoothstep(1.0, 0.965, r);
            vec3 P = vec3(p * 1.5, uSeed);
            vec2 w = vec2(fbm(P + orbit(uPh, 0.45, 0.35)), fbm(P + vec3(5.2, 1.3, 2.0) + orbit(uPh + 0.37, 0.45, 0.35)));
            float e = clamp(0.5 + 0.6 * fbm(vec3(p * 2.3 + 1.5 * w, 3.0 + uSeed) + orbit(-uPh, 0.3, 0.5)), 0.0, 1.0);
            float bias = mix(0.4, 1.0, smoothstep(0.1, 0.95, r));
            float dark = 0.55 * uDensity * inside;
            float wa = pow(e, 3.0) * 0.55 * uDensity * bias * inside;
            float ridge = pow(clamp(1.0 - abs(fbm(vec3(p * 3.0 + 0.9 * w, 7.0 + uSeed))), 0.0, 1.0), 14.0) * bias * inside * 0.45;
            mc = uBase * dark + mix(uMid, uHi, e * e) * wa + uHi * ridge * 0.5;
            ma = dark + wa * 0.6 + ridge * 0.2;
            if (uStorm > 0.5) {
                // Storm cells, one faith's colour each, churning into one another; seams of holy light where they meet
                float hf = fbm(vec3(p * 1.2 + 1.1 * w, 21.0 + uSeed)) + 0.25 * fbm(vec3(p * 4.0 + 2.0 * w, 5.0 + uSeed));
                float hh = clamp(0.5 + 1.1 * hf, 0.0, 0.999) * 5.0;
                int i0 = int(floor(hh));
                float fr = fract(hh);
                vec3 fc = mix(FAITH[i0], FAITH[min(i0 + 1, 4)], smoothstep(0.75, 1.0, fr));
                float turb = pow(clamp(0.45 + 0.9 * fbm(vec3(p * 3.5 + 2.0 * w, 9.0 + uSeed)), 0.0, 1.0), 2.2);
                float seam = exp(-pow(fr / 0.035, 2.0)) + exp(-pow((1.0 - fr) / 0.035, 2.0));
                float crack = seam * smoothstep(0.1, 0.9, 0.5 + gnoise(vec3(p * 30.0, uSeed + 2.0))) * inside;
                float core = exp(-r * r * 6.0);
                mc += fc * turb * 1.0 * inside + vec3(1.0, 0.97, 0.86) * (crack * 1.6 + core * 0.35);
                ma += turb * 0.45 * inside + crack * 0.6 + core * 0.25;
            }
        }
    }
    vec3 c = col * al + mc * (1.0 - al);
    float A = al + ma * (1.0 - al);
    c += L.rgb;
    A = max(A, max(L.r, max(L.g, L.b)) * 0.85);
    o = vec4(c, clamp(A, 0.0, 1.0));
}`;

class Kit {
    constructor(w = 1280, h = 720) {
        this.w = w;
        this.h = h;
        this.canvas = document.createElement("canvas");
        this.canvas.width = w;
        this.canvas.height = h;
        const gl = (this.gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true }));
        gl.getExtension("EXT_color_buffer_float");
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const R = OccultRenderer.prototype;
        this.program = R.program;
        this.use = R.use;
        this.drawQuad = R.drawQuad;
        this.prog = {
            compose: this.program(QUAD_VS, COMPOSE_FS),
            bright: this.program(QUAD_VS, BRIGHT_FS),
            blur: this.program(QUAD_VS, BLUR_FS),
            final: this.program(QUAD_VS, FINAL_FS),
        };
        this.fbo = {
            scene: this.target(w, h),
            h1: this.target(w / 2, h / 2),
            h2: this.target(w / 2, h / 2),
            q1: this.target(w / 4, h / 4),
            q2: this.target(w / 4, h / 4),
        };
        this.solid = this.layer();
        this.light = this.layer();
        this.texS = gl.createTexture();
        this.texL = gl.createTexture();
    }

    layer() {
        const c = document.createElement("canvas");
        c.width = this.w;
        c.height = this.h;
        return c;
    }

    target(w, h) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        for (const [k, v] of [
            [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
            [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        ])
            gl.texParameteri(gl.TEXTURE_2D, k, v);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex, fb, w, h };
    }

    bind(t) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
        gl.viewport(0, 0, t ? t.w : this.w, t ? t.h : this.h);
    }

    upload(tex, canvas) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }

    /** Clear the layers for a new frame and hand back their contexts */
    begin() {
        const s = this.solid.getContext("2d");
        const l = this.light.getContext("2d");
        for (const c of [s, l]) {
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.globalAlpha = 1;
            c.globalCompositeOperation = "source-over";
            c.clearRect(0, 0, this.w, this.h);
        }
        l.globalCompositeOperation = "lighter";
        return { s, l };
    }

    /** mist: { x, y, R, ph, density, base, mid, hi } in canvas pixels (y down) */
    render({ mist = null, seed = 0, haze = 2.5, edge = [0.6, 0.62, 1.0], bloom = 1.0, noiseOff = [0, 0] } = {}) {
        const gl = this.gl;
        this.upload(this.texS, this.solid);
        this.upload(this.texL, this.light);
        const F = this.fbo;
        this.bind(F.scene);
        gl.disable(gl.BLEND);
        const m = mist ?? {};
        this.use(
            this.prog.compose,
            {
                uRes: [this.w, this.h],
                uSeed: seed,
                uPh: m.ph ?? 0,
                uDensity: m.density ?? 1,
                uHaze: haze,
                uNoiseOff: noiseOff,
                uStorm: m.storm ? 1 : 0,
                uMist: mist ? [m.x, this.h - m.y, m.R, 1] : [0, 0, 1, 0],
                uBase: m.base ?? [0.03, 0.03, 0.07],
                uMid: m.mid ?? [0.2, 0.21, 0.3],
                uHi: m.hi ?? [0.42, 0.42, 0.86],
                uEdge: edge,
            },
            { uSolid: this.texS, uLight: this.texL },
        );
        this.drawQuad(this.prog.compose);
        this.bind(F.h1);
        this.use(this.prog.bright, {}, { uSrc: F.scene.tex });
        this.drawQuad(this.prog.bright);
        const blur = (src, dst, dir) => {
            this.bind(dst);
            this.use(this.prog.blur, { uDir: dir }, { uSrc: src.tex });
            this.drawQuad(this.prog.blur);
        };
        for (const st of [1.5, 3]) {
            blur(F.h1, F.h2, [st / F.h1.w, 0]);
            blur(F.h2, F.h1, [0, st / F.h1.h]);
        }
        blur(F.h1, F.q1, [0, 0]);
        for (const st of [2, 4]) {
            blur(F.q1, F.q2, [st / F.q1.w, 0]);
            blur(F.q2, F.q1, [0, st / F.q1.h]);
        }
        this.bind(null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.use(this.prog.final, { uBloom: bloom }, { uSrc: F.scene.tex, uB1: F.h1.tex, uB2: F.q1.tex });
        this.drawQuad(this.prog.final);
        gl.finish();
        return this.canvas;
    }
}
