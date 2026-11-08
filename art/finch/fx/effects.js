/* Fey-prince witch animations, drawn on a 2D canvas. Each effect is a pure function of time, so the same code renders
 * the transparent asset files and the previews. */

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => {
    const c1 = 2.2;
    return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** 0 → 1 over [inA, inB], held, then 1 → 0 over [outA, outB] */
const window_ = (t, inA, inB, outA, outB) => Math.min(seg(t, inA, inB), 1 - seg(t, outA, outB));

function rng(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const C = {
    gold: "#f2c96b",
    goldHi: "#fff3c8",
    goldDeep: "#a8752a",
    violet: "#7a72f0",
    magenta: "#6f86ff",
    plum: "#141a3e",
    plumMid: "#2f3584",
    ivory: "#f6eedc",
    lilac: "#d8defe",
    ink: "#0b0e24",
    bruise: "#4c55b8",
};

/* ---------- Small shapes ---------- */

function sparkle(ctx, x, y, r, color, alpha = 1, rot = 0) {
    if (alpha <= 0 || r <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = r * 2.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 - TAU / 4;
        const rr = i % 2 ? r * 0.22 : r;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/** Thistle-down: a soft seed with fine filaments, the motes of the fey court */
function mote(ctx, x, y, r, color, alpha, rot = 0) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
    g.addColorStop(0, color);
    g.addColorStop(0.35, color + "99");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color + "88";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        ctx.lineTo(Math.cos(a) * r * 3, Math.sin(a) * r * 3);
    }
    ctx.stroke();
    ctx.restore();
}

function crownPath(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-0.5 * s, 0);
    ctx.lineTo(-0.5 * s, -0.36 * s);
    ctx.lineTo(-0.25 * s, -0.16 * s);
    ctx.lineTo(0, -0.5 * s);
    ctx.lineTo(0.25 * s, -0.16 * s);
    ctx.lineTo(0.5 * s, -0.36 * s);
    ctx.lineTo(0.5 * s, 0);
    ctx.closePath();
}

function drawCrown(ctx, x, y, s, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = fill;
    crownPath(ctx, s);
    ctx.fill();
    for (const [px, py] of [
        [-0.5, -0.36],
        [0, -0.5],
        [0.5, -0.36],
    ]) {
        ctx.beginPath();
        ctx.arc(px * s, py * s - 0.05 * s, 0.07 * s, 0, TAU);
        ctx.fill();
    }
    ctx.fillRect(-0.5 * s, 0.03 * s, s, 0.1 * s);
    ctx.restore();
}

/** A domino mask, width s, centered */
function dominoPath(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-0.5 * s, -0.12 * s);
    ctx.bezierCurveTo(-0.32 * s, -0.3 * s, -0.1 * s, -0.24 * s, 0, -0.13 * s);
    ctx.bezierCurveTo(0.1 * s, -0.24 * s, 0.32 * s, -0.3 * s, 0.5 * s, -0.12 * s);
    ctx.bezierCurveTo(0.46 * s, 0.12 * s, 0.3 * s, 0.22 * s, 0.15 * s, 0.17 * s);
    ctx.bezierCurveTo(0.07 * s, 0.14 * s, 0.04 * s, 0.05 * s, 0, 0.05 * s);
    ctx.bezierCurveTo(-0.04 * s, 0.05 * s, -0.07 * s, 0.14 * s, -0.15 * s, 0.17 * s);
    ctx.bezierCurveTo(-0.3 * s, 0.22 * s, -0.46 * s, 0.12 * s, -0.5 * s, -0.12 * s);
    ctx.closePath();
    for (const sx of [-1, 1]) {
        const cx = sx * 0.22 * s;
        ctx.moveTo(cx - 0.12 * s, -0.02 * s);
        ctx.quadraticCurveTo(cx, -0.12 * s, cx + 0.12 * s, -0.02 * s);
        ctx.quadraticCurveTo(cx, 0.06 * s, cx - 0.12 * s, -0.02 * s);
        ctx.closePath();
    }
}

function drawDomino(ctx, x, y, s, fill, stroke) {
    ctx.save();
    ctx.translate(x, y);
    dominoPath(ctx, s);
    ctx.fillStyle = fill;
    ctx.fill("evenodd");
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1, s * 0.025);
        ctx.stroke();
    }
    ctx.restore();
}

/** A theatre mask: mood 1 is comedy, -1 tragedy. Height ~1.05 s. */
function faceMaskPath(ctx, s, mood) {
    ctx.beginPath();
    ctx.moveTo(0, -0.5 * s);
    ctx.bezierCurveTo(0.3 * s, -0.5 * s, 0.42 * s, -0.32 * s, 0.4 * s, -0.06 * s);
    ctx.bezierCurveTo(0.38 * s, 0.24 * s, 0.2 * s, 0.5 * s, 0, 0.55 * s);
    ctx.bezierCurveTo(-0.2 * s, 0.5 * s, -0.38 * s, 0.24 * s, -0.4 * s, -0.06 * s);
    ctx.bezierCurveTo(-0.42 * s, -0.32 * s, -0.3 * s, -0.5 * s, 0, -0.5 * s);
    ctx.closePath();
    for (const sx of [-1, 1]) {
        const cx = sx * 0.17 * s;
        const cy = -0.1 * s;
        // Tragedy: the outer corner droops; comedy: eyes curve up into crescents
        const outer = [cx + sx * 0.11 * s, cy + (mood < 0 ? 0.06 : -0.02) * s];
        const inner = [cx - sx * 0.1 * s, cy + (mood < 0 ? -0.04 : 0.01) * s];
        ctx.moveTo(...inner);
        ctx.quadraticCurveTo(cx, cy - (mood < 0 ? 0.1 : 0.12) * s, ...outer);
        ctx.quadraticCurveTo(cx, cy + (mood < 0 ? 0.06 : 0.0) * s, ...inner);
        ctx.closePath();
    }
    if (mood > 0) {
        ctx.moveTo(-0.2 * s, 0.17 * s);
        ctx.quadraticCurveTo(0, 0.28 * s, 0.2 * s, 0.17 * s);
        ctx.quadraticCurveTo(0, 0.42 * s, -0.2 * s, 0.17 * s);
    } else {
        ctx.moveTo(-0.18 * s, 0.36 * s);
        ctx.quadraticCurveTo(0, 0.16 * s, 0.18 * s, 0.36 * s);
        ctx.quadraticCurveTo(0, 0.27 * s, -0.18 * s, 0.36 * s);
    }
    ctx.closePath();
}

const CRACK = [
    [0.06, -0.5],
    [0.0, -0.36],
    [0.09, -0.25],
    [-0.03, -0.1],
    [0.05, 0.02],
    [-0.06, 0.16],
    [0.02, 0.26],
];

function drawFaceMask(ctx, x, y, s, { mood = 1, fill = C.ivory, stroke = C.gold, crack = 0, glow = null } = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = s * 0.35;
    }
    faceMaskPath(ctx, s, mood);
    const g = ctx.createLinearGradient(0, -0.5 * s, 0, 0.55 * s);
    g.addColorStop(0, fill);
    g.addColorStop(1, shade(fill, -0.18));
    ctx.fillStyle = g;
    ctx.fill("evenodd");
    ctx.shadowBlur = 0;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke();
    if (crack > 0) {
        const n = CRACK.length - 1;
        const reach = crack * n;
        ctx.beginPath();
        ctx.moveTo(CRACK[0][0] * s, CRACK[0][1] * s);
        for (let i = 1; i <= n; i++) {
            const f = clamp(reach - (i - 1));
            if (f <= 0) break;
            ctx.lineTo(lerp(CRACK[i - 1][0], CRACK[i][0], f) * s, lerp(CRACK[i - 1][1], CRACK[i][1], f) * s);
        }
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = Math.max(1.5, s * 0.045);
        ctx.shadowColor = C.violet;
        ctx.shadowBlur = s * 0.15;
        ctx.stroke();
    }
    ctx.restore();
}

function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
        Math.round(clamp(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount, 0, 255)),
    );
    return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function diamond(ctx, x, y, r, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.2, r * 0.75, 0);
    ctx.quadraticCurveTo(r * 0.2, r * 0.2, 0, r);
    ctx.quadraticCurveTo(-r * 0.2, r * 0.2, -r * 0.75, 0);
    ctx.quadraticCurveTo(-r * 0.2, -r * 0.2, 0, -r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
}

/* ---------- Threads ---------- */

/** A thread from a toward b, drawn to `progress`, with a travelling wobble that dies down by `settle` */
function drawThread(
    ctx,
    ax,
    ay,
    bx,
    by,
    { progress = 1, start = 0, wobble = 0, phase = 0, waves = 3, color = C.gold, core = C.goldHi, width = 2, alpha = 1 },
) {
    if (alpha <= 0 || progress <= start) return;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.max(12, Math.round(len / 6));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const s = lerp(start, progress, i / steps);
        const env = Math.sin(Math.PI * clamp(s));
        const off = wobble * env * Math.sin(s * waves * TAU - phase);
        pts.push([ax + dx * s + nx * off, ay + dy * s + ny * off]);
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [w, col, blur] of [
        [width * 3, color + "55", width * 5],
        [width, core, width * 3],
    ]) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
        ctx.stroke();
    }
    ctx.restore();
    return pts.at(-1);
}

/* ---------- Fey glyphs ---------- */

function makeGlyph(r) {
    const strokes = [];
    if (r() < 0.55) strokes.push({ t: "line", a: [0, -0.45], b: [0, 0.45] });
    else {
        const s = r() * TAU;
        strokes.push({ t: "arc", c: [0, 0], r: 0.36, s, e: s + TAU * (0.5 + r() * 0.3) });
    }
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
        const k = r();
        if (k < 0.45) {
            const s = r() * TAU;
            strokes.push({
                t: "arc",
                c: [(r() - 0.5) * 0.4, (r() - 0.5) * 0.6],
                r: 0.12 + r() * 0.2,
                s,
                e: s + TAU * (0.35 + r() * 0.4),
            });
        } else if (k < 0.8) {
            const y = (r() - 0.5) * 0.7;
            const dir = r() < 0.5 ? -1 : 1;
            strokes.push({ t: "line", a: [0, y], b: [dir * (0.2 + r() * 0.25), y + (r() - 0.5) * 0.4] });
        } else {
            strokes.push({ t: "dot", c: [(r() - 0.5) * 0.6, (r() - 0.5) * 0.7] });
        }
    }
    return strokes;
}

function drawGlyph(ctx, glyph, size, progress = 1) {
    const n = glyph.length;
    ctx.beginPath();
    glyph.forEach((st, i) => {
        const p = clamp(progress * n - i);
        if (p <= 0) return;
        if (st.t === "line") {
            ctx.moveTo(st.a[0] * size, st.a[1] * size);
            ctx.lineTo(lerp(st.a[0], st.b[0], p) * size, lerp(st.a[1], st.b[1], p) * size);
        } else if (st.t === "arc") {
            const e = lerp(st.s, st.e, p);
            ctx.moveTo((st.c[0] + Math.cos(st.s) * st.r) * size, (st.c[1] + Math.sin(st.s) * st.r) * size);
            ctx.arc(st.c[0] * size, st.c[1] * size, st.r * size, st.s, e);
        } else {
            ctx.moveTo(st.c[0] * size + size * 0.05, st.c[1] * size);
            ctx.arc(st.c[0] * size, st.c[1] * size, size * 0.05 * p, 0, TAU);
        }
    });
    ctx.stroke();
}

const GLYPHS = (() => {
    const r = rng(7);
    return Array.from({ length: 6 }, () => makeGlyph(r));
})();

/* =====================================================================================================================
 * 1. Designate Witch's Charge — "Stitching the Mark"
 * The witch looses a gilded needle trailing the Prince's gold thread. It flies to the charge, runs a ring of stitches
 * around them, and pulls the thread tight into a crowned knot: the charge is sewn into the witch's story. The thread
 * between them lingers for a moment.
 * ================================================================================================================== */

const MARK = { glint: 0.0, flightStart: 0.12, sew: 0.6, pull: 0.62, end: 2.0 };

/** The needle, pointing along +x, length s: a tapered gold shaft with its eye at the back */
function drawNeedle(ctx, x, y, s, angle, alpha = 1) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = s * 0.35;
    const g = ctx.createLinearGradient(0, -s * 0.05, 0, s * 0.05);
    g.addColorStop(0, C.goldHi);
    g.addColorStop(1, C.goldDeep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0);
    ctx.quadraticCurveTo(s * 0.1, -s * 0.07, -s * 0.5, -s * 0.06);
    ctx.arc(-s * 0.5, 0, s * 0.06, -Math.PI / 2, Math.PI / 2, true);
    ctx.quadraticCurveTo(s * 0.1, s * 0.07, s * 0.5, 0);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(40, 24, 8, 0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // The eye, with the thread through it
    ctx.fillStyle = C.plum;
    ctx.beginPath();
    ctx.ellipse(-s * 0.4, 0, s * 0.07, s * 0.022, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    sparkle(ctx, x + Math.cos(angle) * s * 0.5, y + Math.sin(angle) * s * 0.5, s * 0.12, "#ffffff", 0.9 * alpha);
}

/** The needle in flight, with a few sparks shed behind it. Loopable (the sparks flicker). */
function markNeedleInFlight(ctx, x, y, s, angle, t) {
    for (let i = 1; i <= 4; i++) {
        const back = i * s * 0.35;
        sparkle(
            ctx,
            x - Math.cos(angle) * back,
            y - Math.sin(angle) * back + Math.sin(t * 40 + i) * s * 0.06,
            s * 0.09 * (1 - i / 5),
            C.gold,
            0.7 * (1 - i / 5),
        );
    }
    drawNeedle(ctx, x, y, s, angle);
}

/**
 * At the charge, `t` seconds after the needle arrives from direction `inAngle` (the angle it was flying at). It sews a
 * ring of stitches around the token of radius r, starting where it came in, then pulls the thread tight.
 */
function markLanding(ctx, x, y, r, t, inAngle) {
    const ringR = r * 1.15;
    const a0 = inAngle + Math.PI; // the side it arrived on
    const sew = easeInOut(seg(t, 0, MARK.sew));
    const pull = seg(t, MARK.pull, MARK.pull + 0.25);
    const fade = seg(t, MARK.end - 0.6, MARK.end);
    const a = a0 + sew * TAU;

    // Stitches behind the needle, slanting across the ring; pulled tight, they draw flat into a solid gold ring
    const N = 16;
    ctx.save();
    ctx.globalAlpha *= 1 - fade;
    ctx.lineCap = "round";
    ctx.strokeStyle = C.goldHi;
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha *= 0.6;
    ctx.beginPath();
    ctx.arc(x, y, ringR, a0, a0 + Math.max(sew, 0.0001) * TAU);
    ctx.stroke();
    ctx.globalAlpha /= 0.6;
    ctx.lineWidth = 2.6;
    for (let k = 0; k < N; k++) {
        if (k / N > sew) break;
        const sa = a0 + (k / N) * TAU;
        const span = (TAU / N) * 0.35;
        const out = (r * 0.13) * (1 - pull);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(sa - span) * (ringR - out), y + Math.sin(sa - span) * (ringR - out));
        ctx.lineTo(x + Math.cos(sa + span) * (ringR + out), y + Math.sin(sa + span) * (ringR + out));
        ctx.stroke();
    }
    if (pull > 0) {
        ctx.globalAlpha *= pull;
        ctx.lineWidth = 3.5;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, TAU);
        ctx.stroke();
    }
    ctx.restore();

    // The needle running around the ring, tangent to it
    if (sew < 1) {
        drawNeedle(ctx, x + Math.cos(a) * ringR, y + Math.sin(a) * ringR, r * 0.95, a + Math.PI / 2);
    } else if (pull < 1) {
        // The needle vanishes in a glint where the knot is tied
        sparkle(ctx, x + Math.cos(a0) * ringR, y + Math.sin(a0) * ringR, r * 0.35 * (1 - pull), "#ffffff", 1 - pull);
    }

    // Pulled tight: a flash, a ripple, and the crowned knot at the top
    if (pull > 0) {
        ringPulse(ctx, x, y, ringR * (1 + 0.5 * easeOut(pull)), C.goldHi, (1 - pull) * 0.9, 2.5);
        ctx.save();
        ctx.globalAlpha *= (1 - fade) * clamp(pull * 2);
        ctx.shadowColor = C.gold;
        ctx.shadowBlur = 12;
        drawCrown(ctx, x, y - ringR - 6 + (1 - easeOutBack(pull)) * 12, r * 0.5, C.gold);
        ctx.restore();
        const sr = rng(11);
        for (let i = 0; i < 14; i++) {
            const born = MARK.pull + sr() * 0.3;
            const life = seg(t, born, born + 0.7);
            if (life <= 0 || life >= 1) continue;
            const sa = sr() * TAU;
            const d = ringR * (0.9 + life * 0.5);
            sparkle(ctx, x + Math.cos(sa) * d, y + Math.sin(sa) * d - life * 14, 3 + sr() * 3, C.goldHi, 1 - life);
        }
    }
}

/** The gold thread from the witch to the needle: pays out behind it, holds taut, then fades */
function markTether(ctx, ax, ay, bx, by, t, flight) {
    const out = seg(t, MARK.flightStart, MARK.flightStart + flight);
    const land = MARK.flightStart + flight;
    const alpha = 1 - seg(t, land + MARK.pull, land + MARK.pull + 0.9);
    drawThread(ctx, ax, ay, bx, by, {
        progress: out,
        wobble: 10 * (1 - seg(t, land, land + 0.5)),
        phase: t * 18,
        waves: 2.5,
        width: 1.6,
        alpha: 0.9 * alpha,
    });
}

/** The glint at the witch's hand as the needle appears */
function markGlint(ctx, x, y, r, t) {
    const g = seg(t, MARK.glint, MARK.flightStart + 0.15);
    if (g <= 0 || g >= 1) return;
    sparkle(ctx, x + r * 0.5, y - r * 0.3, r * 0.35 * Math.sin(Math.PI * g), C.goldHi, 1, g * 2);
}

/* =====================================================================================================================
 * 2. Familiar of Ongoing Misery — "Strings Attached"
 * Valet has no strings of his own: he hands them to someone else. A dark thread lashes from Valet to the creature,
 * a marionette's control bar forms over it and drops strings onto it, jerks them taut, and a cracked tragedy mask
 * flashes over it before the strings fall slack and fade.
 * ================================================================================================================== */

const MISERY = { pulse: 0, lash: 0.05, lashDur: 0.3, bar: 0.32, strings: 0.45, tug: 0.85, mask: 0.95, slack: 1.6, end: 2.4 };

/** At Valet: a silent violet pulse */
function miseryPulse(ctx, x, y, r, t) {
    const p = seg(t, MISERY.pulse, MISERY.pulse + 0.45);
    if (p <= 0 || p >= 1) return;
    ringPulse(ctx, x, y, r * (0.8 + easeOut(p) * 0.8), C.violet, (1 - p) * 0.9, 3);
}

/** Valet's thread lashing to the target */
function miseryLash(ctx, ax, ay, bx, by, t) {
    const out = easeOut(seg(t, MISERY.lash, MISERY.lash + MISERY.lashDur));
    const fadeTail = seg(t, MISERY.tug, MISERY.tug + 0.5);
    drawThread(ctx, ax, ay, bx, by, {
        progress: out,
        start: fadeTail,
        wobble: 14 * (1 - seg(t, MISERY.lash, MISERY.tug)),
        phase: t * 22,
        waves: 2,
        color: C.violet,
        core: "#161c48",
        width: 2.4,
        alpha: 1 - seg(t, MISERY.tug + 0.2, MISERY.tug + 0.6),
    });
}

/** Everything at the target, with t the effect's time. r is the token's radius. */
function miseryTarget(ctx, x, y, r, t) {
    const barIn = easeOutBack(seg(t, MISERY.bar, MISERY.bar + 0.3));
    const fallAway = easeIn(seg(t, MISERY.slack, MISERY.slack + 0.6));
    const barAlpha = seg(t, MISERY.bar, MISERY.bar + 0.15) * (1 - fallAway);
    // The tug: the bar yanks upward and settles
    const tugP = seg(t, MISERY.tug, MISERY.tug + 0.35);
    const yank = Math.sin(Math.PI * tugP) * (1 - tugP * 0.5);
    const barY = y - r * 1.9 - yank * r * 0.28 + (1 - barIn) * -r * 0.4;
    const sway = Math.sin(t * 5) * r * 0.05 * (1 - tugP);
    const barW = r * 1.9;

    // Attachment points on the creature: head, hands, knees
    const anchors = [
        [0, -0.55],
        [-0.62, -0.1],
        [0.62, -0.1],
        [-0.32, 0.55],
        [0.32, 0.55],
    ].map(([ax, ay]) => [x + ax * r, y + ay * r + yank * r * -0.06]);
    // Where each string hangs from the bar
    const tips = [
        [0, -0.25],
        [-0.5, 0],
        [0.5, 0],
        [-0.22, 0.32],
        [0.22, 0.32],
    ].map(([tx, ty]) => [x + sway + tx * barW, barY + ty * barW]);

    // Strings drop one after another, glow brighter on the tug, then fall slack
    anchors.forEach((anchor, i) => {
        const drop = easeOut(seg(t, MISERY.strings + i * 0.05, MISERY.strings + i * 0.05 + 0.25));
        if (drop <= 0) return;
        const [tx, ty] = tips[i];
        const slackDrop = fallAway * r * 0.5;
        const taut = tugP > 0 && tugP < 1 ? 1 : 0;
        drawThread(ctx, tx, ty, anchor[0], anchor[1] + slackDrop, {
            progress: drop,
            wobble: (taut ? 0 : 3) + fallAway * 10,
            phase: t * 6 + i,
            waves: 1,
            color: taut ? C.lilac : C.violet,
            core: taut ? "#ffffff" : C.lilac,
            width: taut ? 1.4 : 1,
            alpha: 0.9 * (1 - fallAway),
        });
    });

    // The control bar: a marionette's crossed wooden bars with gold caps
    if (barAlpha > 0) {
        ctx.save();
        ctx.globalAlpha *= barAlpha;
        ctx.translate(x + sway, barY);
        ctx.rotate(Math.sin(t * 4) * 0.06 * (1 - tugP) + fallAway * 0.5);
        ctx.shadowColor = C.violet;
        ctx.shadowBlur = 14;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#202a5e";
        ctx.lineWidth = r * 0.17;
        ctx.beginPath();
        ctx.moveTo(-barW * 0.5, 0);
        ctx.lineTo(barW * 0.5, 0);
        ctx.moveTo(0, -barW * 0.25);
        ctx.lineTo(0, barW * 0.36);
        ctx.moveTo(-barW * 0.22, barW * 0.32);
        ctx.lineTo(barW * 0.22, barW * 0.32);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#4a58aa";
        ctx.lineWidth = r * 0.04;
        ctx.stroke();
        for (const [tx, ty] of [
            [0, -0.25],
            [-0.5, 0],
            [0.5, 0],
            [-0.22, 0.32],
            [0.22, 0.32],
        ]) {
            ctx.beginPath();
            ctx.arc(tx * barW, ty * barW, r * 0.09, 0, TAU);
            ctx.fillStyle = C.gold;
            ctx.shadowColor = C.gold;
            ctx.shadowBlur = 8;
            ctx.fill();
        }
        ctx.restore();
    }

    // On the tug: a shock at the creature, then the cracked tragedy mask
    if (tugP > 0 && tugP < 1) ringPulse(ctx, x, y, r * (0.9 + tugP * 0.7), C.violet, (1 - tugP) * 0.9, 3);
    const m = seg(t, MISERY.mask, MISERY.mask + 0.25);
    const mOut = seg(t, MISERY.slack + 0.1, MISERY.end - 0.1);
    if (m > 0 && mOut < 1) {
        const s = r * 1.45 * (0.7 + 0.3 * easeOutBack(m)) * (1 + mOut * 0.2);
        ctx.save();
        ctx.globalAlpha *= m * (1 - mOut) * 0.95;
        drawFaceMask(ctx, x, y - mOut * r * 0.3, s, {
            mood: -1,
            fill: "#dfe4fb",
            stroke: C.bruise,
            crack: easeOut(seg(t, MISERY.mask + 0.2, MISERY.mask + 0.4)),
            glow: C.violet,
        });
        ctx.restore();
        // Splinters as it cracks
        const sr = rng(5);
        for (let i = 0; i < 10; i++) {
            const born = MISERY.mask + 0.25 + sr() * 0.2;
            const life = seg(t, born, born + 0.6);
            if (life <= 0 || life >= 1) continue;
            const a = -Math.PI / 2 + (sr() - 0.5) * 2.4;
            const d = r * (0.3 + life * 0.9);
            mote(ctx, x + Math.cos(a) * d, y - r * 0.2 + Math.sin(a) * d, 1.6 + sr() * 1.5, C.lilac, 1 - life);
        }
    }
    // The bar breaks into motes as it fades
    if (fallAway > 0 && fallAway < 1) {
        const sr = rng(9);
        for (let i = 0; i < 12; i++) {
            const px = x + (sr() - 0.5) * barW;
            const py = barY + (sr() - 0.5) * barW * 0.4 - fallAway * r * 0.6 * (0.5 + sr());
            mote(ctx, px, py, 1.5 + sr() * 1.5, C.violet, (1 - fallAway) * 0.9);
        }
    }
}

function ringPulse(ctx, x, y, radius, color, alpha, width) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    ctx.restore();
}

/* =====================================================================================================================
 * 3. Manifest Will (occult) — "The Masquerade"
 * Esoteric symbology etches the air: a court's circle of fey glyphs and stitched gold, four masks of the masquerade
 * that keep the witch's allies hidden (lesser cover), and drifting thistle-down. The loop is seamless; the cast is a
 * card flourish that fans out from the witch and bursts into the circle.
 * ================================================================================================================== */

const MW_LOOP = 8;

/** The looping aura texture. R is the emanation's radius (half the texture). */
function manifestLoop(ctx, cx, cy, R, t, { intro = 1 } = {}) {
    const L = MW_LOOP;
    const ph = ((t % L) + L) % L / L; // 0..1 around the loop
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha *= intro;

    // A faint violet haze, darker toward the edge like a stage's pool of light
    const haze = ctx.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
    haze.addColorStop(0, "rgba(110, 110, 240, 0.10)");
    haze.addColorStop(0.75, "rgba(70, 70, 180, 0.16)");
    haze.addColorStop(1, "rgba(80, 30, 110, 0.0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();

    const breathe = 0.85 + 0.15 * Math.sin(ph * TAU);

    // Outer double ring with ticks: rotates 90° a loop (4-fold pattern)
    ctx.save();
    ctx.rotate(ph * (TAU / 4));
    ctx.strokeStyle = C.gold;
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = 8;
    ctx.globalAlpha *= 0.85 * breathe;
    ctx.lineWidth = R * 0.008;
    for (const rr of [0.955, 0.925]) {
        ctx.beginPath();
        ctx.arc(0, 0, R * rr, 0, TAU);
        ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU;
        const long = i % 12 === 0;
        ctx.moveTo(Math.cos(a) * R * 0.925, Math.sin(a) * R * 0.925);
        ctx.lineTo(Math.cos(a) * R * (long ? 0.995 : 0.955), Math.sin(a) * R * (long ? 0.995 : 0.955));
    }
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + TAU / 8;
        ctx.save();
        ctx.rotate(a);
        diamond(ctx, R * 0.94, 0, R * 0.03, C.goldHi);
        ctx.restore();
    }
    ctx.restore();

    // Glyph band: 24 glyphs (6 repeated 4 times), counter-rotating 90° a loop
    ctx.save();
    ctx.rotate(-ph * (TAU / 4));
    ctx.strokeStyle = "#b8c4ff";
    ctx.shadowColor = C.magenta;
    ctx.shadowBlur = 10;
    ctx.lineWidth = R * 0.009;
    ctx.lineCap = "round";
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const flicker = 0.6 + 0.4 * Math.sin(ph * TAU * 2 + i * 1.7); // whole cycles: seamless
        ctx.save();
        ctx.globalAlpha *= flicker * breathe;
        ctx.rotate(a);
        ctx.translate(0, -R * 0.84);
        drawGlyph(ctx, GLYPHS[i % 6], R * 0.085);
        ctx.restore();
    }
    ctx.restore();

    // Inner stitched ring with stars: rotates 180° a loop (8 stars, 2 alternating sizes)
    ctx.save();
    ctx.rotate(ph * Math.PI);
    ctx.strokeStyle = C.gold;
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = 6;
    ctx.globalAlpha *= 0.75 * breathe;
    ctx.lineWidth = R * 0.006;
    ctx.setLineDash([R * 0.035, R * 0.02]);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.66, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((i / 8) * TAU);
        sparkle(ctx, R * 0.66, 0, R * (i % 2 ? 0.026 : 0.042), i % 2 ? C.gold : C.lilac, 1, Math.PI / 4);
        ctx.restore();
    }
    ctx.restore();

    // The four masks of the masquerade, still, breathing in turn
    const masks = [
        { a: -Math.PI / 2, kind: "crown" },
        { a: 0, kind: "comedy" },
        { a: Math.PI / 2, kind: "domino" },
        { a: Math.PI, kind: "tragedy" },
    ];
    masks.forEach((mk, i) => {
        const glow = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(ph * TAU - i * (TAU / 4)));
        const mx = Math.cos(mk.a) * R * 0.5;
        const my = Math.sin(mk.a) * R * 0.5;
        ctx.save();
        ctx.globalAlpha *= glow * breathe;
        drawMasqueradeMask(ctx, mx, my, R * 0.2, mk.kind);
        ctx.restore();
    });

    // Thistle-down drifting around and outward; each mote's path repeats every loop
    const mr = rng(21);
    for (let i = 0; i < 26; i++) {
        const offset = mr();
        const a0 = mr() * TAU;
        const lanes = 1 + Math.floor(mr() * 2); // whole number of laps per loop: seamless
        const life = (ph + offset) % 1;
        const a = a0 + life * TAU * 0.25 * lanes;
        const rad = R * lerp(0.25, 0.92, life);
        const alpha = Math.sin(Math.PI * life) * 0.85;
        mote(ctx, Math.cos(a) * rad, Math.sin(a) * rad, R * (0.008 + mr() * 0.008), C.lilac, alpha, life * 3);
    }

    ctx.restore();
}

function drawMasqueradeMask(ctx, x, y, s, kind) {
    ctx.save();
    ctx.shadowColor = C.magenta;
    ctx.shadowBlur = s * 0.4;
    if (kind === "domino") drawDomino(ctx, x, y, s * 1.1, "#c7cff8", C.gold);
    else if (kind === "crown") {
        drawFaceMask(ctx, x, y + s * 0.08, s * 0.8, { mood: 1, fill: "#e8ecfc", stroke: C.gold });
        ctx.shadowColor = C.gold;
        drawCrown(ctx, x, y - s * 0.38, s * 0.5, C.gold);
    } else drawFaceMask(ctx, x, y, s * 0.85, { mood: kind === "comedy" ? 1 : -1, fill: "#e2e7fb", stroke: C.gold });
    ctx.restore();
}

/** The cast: the four masks of the masquerade fly out from the witch to their places, and the circle etches in */
function manifestCast(ctx, cx, cy, R, t) {
    ctx.save();
    ctx.translate(cx, cy);
    // Glint at the witch
    const g = seg(t, 0, 0.3);
    if (g > 0 && g < 1) sparkle(ctx, 0, 0, R * 0.18 * Math.sin(Math.PI * g), C.goldHi, 1, g * 3);

    // A veil of light ripples out first
    const veil = seg(t, 0.05, 0.7);
    if (veil > 0 && veil < 1) {
        const vg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * (0.2 + 0.8 * easeOut(veil)));
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(0.85, `rgba(140, 150, 255, ${0.35 * (1 - veil)})`);
        vg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = vg;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.fill();
    }

    const masks = ["crown", "comedy", "domino", "tragedy"];
    masks.forEach((kind, i) => {
        const delay = i * 0.08;
        const out = easeOutBack(seg(t, 0.15 + delay, 0.75 + delay));
        if (out <= 0) return;
        const settle = seg(t, 0.75 + delay, 1.3 + delay);
        const fade = seg(t, 1.4, 2.0);
        const a = -Math.PI / 2 + (i / 4) * TAU - (1 - clamp(out)) * 1.4;
        const rad = R * 0.5 * out;
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad;
        // A trail of sparks along the spiral
        for (let k = 1; k < 7; k++) {
            const o = Math.max(0, clamp(out) - k * 0.06);
            const ak = -Math.PI / 2 + (i / 4) * TAU - (1 - o) * 1.4;
            sparkle(ctx, Math.cos(ak) * R * 0.5 * o, Math.sin(ak) * R * 0.5 * o, R * 0.025 * (1 - k / 7), C.lilac, (1 - k / 7) * (1 - settle));
        }
        ctx.save();
        ctx.globalAlpha *= 1 - fade;
        ctx.translate(x, y);
        ctx.rotate((1 - clamp(out)) * -2.5);
        const s = R * 0.2 * (1 + 0.35 * Math.sin(Math.PI * settle));
        ctx.shadowColor = C.goldHi;
        ctx.shadowBlur = 24 * (1 - settle);
        drawMasqueradeMask(ctx, 0, 0, s, kind);
        ctx.restore();
        if (settle > 0 && settle < 1) ringPulse(ctx, x, y, R * 0.12 * (1 + settle), C.goldHi, (1 - settle) * 0.8, 2);
    });
    // Shockwave as the masks take their places
    const w = seg(t, 0.85, 1.45);
    if (w > 0 && w < 1) {
        ringPulse(ctx, 0, 0, R * (0.5 + 0.5 * easeOut(w)), C.goldHi, (1 - w) * 0.9, R * 0.02);
        ringPulse(ctx, 0, 0, R * (0.3 + 0.62 * easeOut(w)), C.magenta, (1 - w) * 0.7, R * 0.012);
    }
    // The glyphs etch in a burst of light
    const etch = seg(t, 0.95, 1.55);
    const etchOut = seg(t, 1.6, 2.2);
    if (etch > 0 && etchOut < 1) {
        ctx.save();
        ctx.strokeStyle = C.goldHi;
        ctx.shadowColor = C.gold;
        ctx.shadowBlur = 14;
        ctx.lineWidth = R * 0.012;
        ctx.lineCap = "round";
        ctx.globalAlpha *= 1 - etchOut;
        for (let i = 0; i < 24; i++) {
            ctx.save();
            ctx.rotate((i / 24) * TAU);
            ctx.translate(0, -R * 0.84);
            drawGlyph(ctx, GLYPHS[i % 6], R * 0.085, clamp(etch * 1.6 - (i % 6) * 0.1));
            ctx.restore();
        }
        ctx.restore();
    }
    // Thistle-down thrown up by the burst
    const mr = rng(3);
    for (let i = 0; i < 30; i++) {
        const born = 0.95 + mr() * 0.25;
        const life = seg(t, born, born + 1.1);
        if (life <= 0 || life >= 1) continue;
        const a = mr() * TAU;
        const rad = R * (0.3 + 0.65 * easeOut(life) * (0.6 + mr() * 0.4));
        mote(ctx, Math.cos(a) * rad, Math.sin(a) * rad, R * (0.01 + mr() * 0.01), mr() < 0.5 ? C.lilac : C.goldHi, 1 - life);
    }
    ctx.restore();
}

const MW_CAST_DURATION = 2.3;
