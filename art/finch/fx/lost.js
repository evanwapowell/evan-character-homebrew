/* "Lost things" motifs and the storyboard frames for each piece. Needs effects.js and kit.js. */

const S_ = { silver: "#dfe4ee", hi: "#ffffff", deep: "#8d96ad", violet: "#7a72f0", blue: "#6d86ff", lilac: "#d8defe", porcelain: "#e9ecf6", ink: "#0b0e1c" };

/* ---------- Scripts ---------- */

/** Fey runes: flowing letters of stems, crescents, thorns and loops, joined by a swash along the baseline */
function feyLetter(r) {
    return { type: Math.floor(r() * 6), flip: r() < 0.5 ? 1 : -1, dot: r() < 0.35 ? (r() < 0.5 ? -1 : 1) : 0, tall: 0.75 + r() * 0.35 };
}
function drawFeyLetter(ctx, L, h) {
    const H = h * L.tall;
    const f = L.flip;
    ctx.beginPath();
    switch (L.type) {
        case 0: // stem with a curl
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -0.8 * H);
            ctx.quadraticCurveTo(0, -1.05 * H, 0.25 * f * h, -1.0 * H);
            ctx.quadraticCurveTo(0.38 * f * h, -0.88 * H, 0.22 * f * h, -0.8 * H);
            break;
        case 1: // crescent cup
            ctx.arc(0, -0.45 * H, 0.28 * h, f > 0 ? 0.1 * Math.PI : 1.1 * Math.PI, f > 0 ? 0.9 * Math.PI : 1.9 * Math.PI);
            ctx.moveTo(0, -0.45 * H);
            ctx.lineTo(0, -0.9 * H);
            break;
        case 2: // thorned stem
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -0.95 * H);
            ctx.moveTo(0, -0.55 * H);
            ctx.lineTo(0.24 * f * h, -0.72 * H);
            ctx.moveTo(0, -0.3 * H);
            ctx.lineTo(-0.16 * f * h, -0.42 * H);
            break;
        case 3: // looped stem
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -0.5 * H);
            ctx.moveTo(0.17 * h, -0.7 * H);
            ctx.arc(0, -0.7 * H, 0.17 * h, 0, TAU);
            break;
        case 4: // wave
            ctx.moveTo(-0.22 * h, -0.2 * H);
            ctx.bezierCurveTo(-0.1 * h, -1.0 * H, 0.1 * h, 0.1 * H, 0.22 * h, -0.8 * H);
            break;
        default: // double crescent
            ctx.arc(0, -0.3 * H, 0.18 * h, Math.PI, TAU);
            ctx.moveTo(0.18 * h, -0.75 * H);
            ctx.arc(0, -0.75 * H, 0.18 * h, 0, Math.PI);
    }
    ctx.stroke();
    if (L.dot) {
        ctx.beginPath();
        ctx.arc(0.05 * h, L.dot < 0 ? -1.2 * H : 0.25 * h, h * 0.06, 0, TAU);
        ctx.fill();
    }
}

/** Other lost scripts for the arcane library, each a letter maker and drawer */
const SCRIPTS = {
    runic(r) {
        const strokes = [[0, 0, 0, -1]];
        for (let i = 0; i < 1 + Math.floor(r() * 3); i++) {
            const y = -0.2 - r() * 0.7;
            strokes.push([0, y, (r() < 0.5 ? -1 : 1) * 0.35, y + (r() < 0.5 ? -0.3 : 0.3)]);
        }
        return { strokes };
    },
    cursive(r) {
        return { loops: 1 + Math.floor(r() * 2), lean: 0.2 + r() * 0.2, tail: r() < 0.5 };
    },
    blocky(r) {
        return { cells: Array.from({ length: 6 }, () => r() < 0.55) };
    },
    dotted(r) {
        return { dots: Array.from({ length: 9 }, () => r() < 0.45), bar: r() < 0.5 };
    },
    picto(r) {
        return { kind: Math.floor(r() * 6) };
    },
    circuit(r) {
        const pts = [[0, 0]];
        let x = 0,
            y = 0;
        for (let i = 0; i < 3; i++) {
            if (i % 2) x = (r() - 0.5) * 0.6;
            else y = -0.25 - r() * 0.7;
            pts.push([x, y]);
        }
        return { pts };
    },
};
function drawScriptLetter(ctx, style, L, h) {
    ctx.beginPath();
    if (style === "runic") {
        for (const [a, b, c, d] of L.strokes) {
            ctx.moveTo(a * h, b * h);
            ctx.lineTo(c * h, d * h);
        }
        ctx.stroke();
    } else if (style === "cursive") {
        ctx.moveTo(-0.3 * h, 0);
        for (let i = 0; i < L.loops; i++) {
            const x = -0.1 * h + i * 0.25 * h;
            ctx.bezierCurveTo(x + L.lean * h, -1.1 * h, x - 0.3 * h, -0.9 * h, x + 0.1 * h, 0);
        }
        if (L.tail) ctx.quadraticCurveTo(0.4 * h, 0.2 * h, 0.4 * h, -0.2 * h);
        ctx.stroke();
    } else if (style === "blocky") {
        L.cells.forEach((on, i) => {
            if (on) ctx.rect((-0.3 + (i % 2) * 0.32) * h, (-1 + Math.floor(i / 2) * 0.34) * h, 0.26 * h, 0.28 * h);
        });
        ctx.fill();
    } else if (style === "dotted") {
        L.dots.forEach((on, i) => {
            if (on) {
                ctx.moveTo((-0.25 + (i % 3) * 0.25) * h + 0.06 * h, (-0.85 + Math.floor(i / 3) * 0.3) * h);
                ctx.arc((-0.25 + (i % 3) * 0.25) * h, (-0.85 + Math.floor(i / 3) * 0.3) * h, 0.06 * h, 0, TAU);
            }
        });
        ctx.fill();
        if (L.bar) {
            ctx.beginPath();
            ctx.moveTo(-0.35 * h, -0.05 * h);
            ctx.lineTo(0.35 * h, -0.05 * h);
            ctx.stroke();
        }
    } else if (style === "picto") {
        const k = L.kind;
        if (k === 0) {
            ctx.ellipse(0, -0.5 * h, 0.32 * h, 0.17 * h, 0, 0, TAU);
            ctx.moveTo(0.08 * h, -0.5 * h);
            ctx.arc(0, -0.5 * h, 0.08 * h, 0, TAU);
        } else if (k === 1) {
            ctx.moveTo(-0.35 * h, -0.4 * h);
            ctx.quadraticCurveTo(-0.17 * h, -0.7 * h, 0, -0.4 * h);
            ctx.quadraticCurveTo(0.17 * h, -0.1 * h, 0.35 * h, -0.4 * h);
        } else if (k === 2) {
            polygon(ctx, 3, 0.4 * h);
            ctx.translate(0, 0);
        } else if (k === 3) {
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * TAU;
                ctx.moveTo(0, -0.5 * h);
                ctx.lineTo(Math.cos(a) * 0.35 * h, -0.5 * h + Math.sin(a) * 0.35 * h);
            }
        } else if (k === 4) {
            ctx.moveTo(-0.3 * h, 0);
            ctx.lineTo(0, -0.9 * h);
            ctx.lineTo(0.3 * h, 0);
            ctx.moveTo(-0.15 * h, -0.4 * h);
            ctx.lineTo(0.15 * h, -0.4 * h);
        } else {
            ctx.arc(0, -0.5 * h, 0.3 * h, 0, TAU);
            ctx.moveTo(-0.3 * h, -0.5 * h);
            ctx.lineTo(0.3 * h, -0.5 * h);
        }
        if (k === 2) {
            ctx.save();
            ctx.translate(0, -0.45 * h);
            polygon(ctx, 3, 0.4 * h);
            ctx.restore();
        }
        ctx.stroke();
    } else {
        L.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * h, y * h) : ctx.moveTo(x * h, y * h)));
        ctx.stroke();
        const [ex, ey] = L.pts.at(-1);
        ctx.beginPath();
        ctx.arc(ex * h, ey * h, 0.08 * h, 0, TAU);
        ctx.stroke();
    }
}

/** A run of text along an arc: radius rad, centred at angle a0 (0 = up, clockwise), letters of height h */
function textArc(ctx, cx, cy, rad, a0, letters, h, draw, { spacing = 0.55, swash = false } = {}) {
    const step = (h * spacing) / rad;
    const start = a0 - (step * (letters.length - 1)) / 2;
    letters.forEach((L, i) => {
        const a = start + i * step;
        ctx.save();
        ctx.translate(cx + Math.sin(a) * rad, cy - Math.cos(a) * rad);
        ctx.rotate(a);
        draw(ctx, L, h);
        ctx.restore();
    });
    if (swash) {
        ctx.beginPath();
        ctx.arc(cx, cy, rad - h * 0.02, start - Math.PI / 2 - step * 0.4, start + step * (letters.length - 0.6) - Math.PI / 2);
        ctx.stroke();
    }
}

/* ---------- Lost trinkets ---------- */

function drawTrinket(ctx, x, y, s, kind, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = S_.silver;
    ctx.strokeStyle = S_.silver;
    ctx.lineWidth = s * 0.12;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (kind === "key") {
        ctx.arc(-0.3 * s, 0, 0.2 * s, 0, TAU);
        ctx.moveTo(-0.1 * s, 0);
        ctx.lineTo(0.5 * s, 0);
        ctx.moveTo(0.35 * s, 0);
        ctx.lineTo(0.35 * s, 0.15 * s);
        ctx.moveTo(0.48 * s, 0);
        ctx.lineTo(0.48 * s, 0.18 * s);
        ctx.stroke();
    } else if (kind === "button") {
        ctx.arc(0, 0, 0.32 * s, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.globalCompositeOperation = "destination-out";
        for (const [a, b] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
        ]) {
            ctx.beginPath();
            ctx.arc(a * 0.09 * s, b * 0.09 * s, 0.05 * s, 0, TAU);
            ctx.fill();
        }
    } else if (kind === "thimble") {
        ctx.moveTo(-0.25 * s, 0.3 * s);
        ctx.lineTo(-0.2 * s, -0.15 * s);
        ctx.quadraticCurveTo(0, -0.42 * s, 0.2 * s, -0.15 * s);
        ctx.lineTo(0.25 * s, 0.3 * s);
        ctx.closePath();
        ctx.fill();
    } else if (kind === "ring") {
        ctx.arc(0, 0.05 * s, 0.25 * s, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        diamond(ctx, 0, -0.25 * s, 0.12 * s, S_.lilac);
    } else if (kind === "sock") {
        ctx.moveTo(-0.15 * s, -0.45 * s);
        ctx.lineTo(0.1 * s, -0.45 * s);
        ctx.lineTo(0.1 * s, 0.05 * s);
        ctx.quadraticCurveTo(0.45 * s, 0.1 * s, 0.4 * s, 0.32 * s);
        ctx.lineTo(-0.05 * s, 0.32 * s);
        ctx.quadraticCurveTo(-0.18 * s, 0.25 * s, -0.15 * s, 0.05 * s);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.ellipse(-0.3 * s, 0, 0.16 * s, 0.11 * s, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-0.15 * s, 0);
        ctx.lineTo(0.5 * s, 0);
        ctx.stroke();
    }
    ctx.restore();
}
const TRINKETS = ["key", "button", "thimble", "ring", "sock", "spoon"];

/** A few trinkets drifting in the emanation, each at its own state of fading in or out */
function trinkets(s, cx, cy, R, seed, n = 5) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
        const a = r() * TAU;
        const rad = R * (0.3 + r() * 0.55);
        s.save();
        s.globalAlpha = 0.35 + r() * 0.65;
        drawTrinket(s, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, R * 0.07, TRINKETS[i % TRINKETS.length], r() * TAU);
        s.restore();
    }
}

function starfield(l, cx, cy, R, seed, n = 90) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
        const a = r() * TAU;
        const rad = R * Math.sqrt(r()) * 0.95;
        const big = r() < 0.08;
        sparkle(l, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, big ? 5 + r() * 4 : 1.2 + r() * 1.5, r() < 0.2 ? S_.silver : S_.lilac, 0.5 + r() * 0.5);
    }
}

/* ---------- Faces ---------- */

/** A porcelain face with an expression: joy, grief, fear, longing, calm. Height ~1.05 s. */
function facePath(ctx, s, expr) {
    ctx.beginPath();
    ctx.moveTo(0, -0.5 * s);
    ctx.bezierCurveTo(0.3 * s, -0.5 * s, 0.42 * s, -0.32 * s, 0.4 * s, -0.06 * s);
    ctx.bezierCurveTo(0.38 * s, 0.24 * s, 0.2 * s, 0.5 * s, 0, 0.55 * s);
    ctx.bezierCurveTo(-0.2 * s, 0.5 * s, -0.38 * s, 0.24 * s, -0.4 * s, -0.06 * s);
    ctx.bezierCurveTo(-0.42 * s, -0.32 * s, -0.3 * s, -0.5 * s, 0, -0.5 * s);
    ctx.closePath();
    const E = {
        joy: { tilt: -0.02, up: 0.12, low: 0.0, mouth: "smile" },
        grief: { tilt: 0.06, up: 0.1, low: 0.06, mouth: "frown" },
        fear: { tilt: 0.0, up: 0.13, low: 0.1, mouth: "o" },
        longing: { tilt: 0.04, up: 0.07, low: 0.05, mouth: "part" },
        calm: { tilt: 0.0, up: 0.06, low: 0.04, mouth: "line" },
    }[expr];
    for (const sx of [-1, 1]) {
        const cx = sx * 0.17 * s;
        const cy = -0.1 * s;
        const outer = [cx + sx * 0.11 * s, cy + E.tilt * s];
        const inner = [cx - sx * 0.1 * s, cy - E.tilt * 0.6 * s];
        ctx.moveTo(...inner);
        ctx.quadraticCurveTo(cx, cy - E.up * s, ...outer);
        ctx.quadraticCurveTo(cx, cy + E.low * s, ...inner);
        ctx.closePath();
    }
    const m = E.mouth;
    if (m === "smile") {
        ctx.moveTo(-0.2 * s, 0.17 * s);
        ctx.quadraticCurveTo(0, 0.28 * s, 0.2 * s, 0.17 * s);
        ctx.quadraticCurveTo(0, 0.42 * s, -0.2 * s, 0.17 * s);
    } else if (m === "frown") {
        ctx.moveTo(-0.18 * s, 0.36 * s);
        ctx.quadraticCurveTo(0, 0.16 * s, 0.18 * s, 0.36 * s);
        ctx.quadraticCurveTo(0, 0.27 * s, -0.18 * s, 0.36 * s);
    } else if (m === "o") {
        ctx.moveTo(0.08 * s, 0.28 * s);
        ctx.ellipse(0, 0.28 * s, 0.08 * s, 0.11 * s, 0, 0, TAU);
    } else if (m === "part") {
        ctx.moveTo(-0.12 * s, 0.27 * s);
        ctx.quadraticCurveTo(0, 0.22 * s, 0.12 * s, 0.27 * s);
        ctx.quadraticCurveTo(0, 0.33 * s, -0.12 * s, 0.27 * s);
    } else {
        ctx.moveTo(-0.13 * s, 0.27 * s);
        ctx.quadraticCurveTo(0, 0.3 * s, 0.13 * s, 0.27 * s);
        ctx.quadraticCurveTo(0, 0.32 * s, -0.13 * s, 0.27 * s);
    }
    ctx.closePath();
}

function drawFace(s, l, x, y, size, expr, { alpha = 1, crown = false, tilt = 0 } = {}) {
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(tilt);
    facePath(s, size, expr);
    const g = s.createLinearGradient(0, -0.5 * size, 0, 0.55 * size);
    g.addColorStop(0, "#f2f4fb");
    g.addColorStop(1, "#9aa3c8");
    s.fillStyle = g;
    s.fill("evenodd");
    s.strokeStyle = S_.deep;
    s.lineWidth = Math.max(1, size * 0.025);
    s.stroke();
    if (crown) {
        s.shadowBlur = 0;
        drawCrown(s, 0, -0.5 * size, size * 0.62, S_.silver);
    }
    s.restore();
    // Halo of blue-violet light behind it
    const gl = l.createRadialGradient(x, y, 0, x, y, size * 0.9);
    gl.addColorStop(0, `rgba(110, 110, 255, ${0.35 * alpha})`);
    gl.addColorStop(1, "rgba(110, 110, 255, 0)");
    l.fillStyle = gl;
    l.beginPath();
    l.arc(x, y, size * 0.9, 0, TAU);
    l.fill();
    if (crown) {
        const cg = l.createRadialGradient(x, y - 0.65 * size, 0, x, y - 0.65 * size, size * 0.6);
        cg.addColorStop(0, `rgba(255, 255, 255, ${0.45 * alpha})`);
        cg.addColorStop(1, "rgba(255, 255, 255, 0)");
        l.fillStyle = cg;
        l.beginPath();
        l.arc(x, y - 0.65 * size, size * 0.6, 0, TAU);
        l.fill();
    }
}

/* ---------- Rings of silver and runes ---------- */

function silverRings(s, l, cx, cy, R, { ticks = true, inner = 0.66, alpha = 1 } = {}) {
    s.save();
    s.globalAlpha = alpha;
    s.strokeStyle = S_.silver;
    s.lineWidth = R * 0.008;
    for (const rr of [0.955, 0.925]) {
        s.beginPath();
        s.arc(cx, cy, R * rr, 0, TAU);
        s.stroke();
    }
    if (ticks) {
        s.beginPath();
        for (let i = 0; i < 48; i++) {
            const a = (i / 48) * TAU;
            const long = i % 12 === 0;
            s.moveTo(cx + Math.cos(a) * R * 0.925, cy + Math.sin(a) * R * 0.925);
            s.lineTo(cx + Math.cos(a) * R * (long ? 0.995 : 0.955), cy + Math.sin(a) * R * (long ? 0.995 : 0.955));
        }
        s.stroke();
    }
    if (inner) {
        s.setLineDash([R * 0.035, R * 0.02]);
        s.lineWidth = R * 0.005;
        s.beginPath();
        s.arc(cx, cy, R * inner, 0, TAU);
        s.stroke();
        s.setLineDash([]);
    }
    s.restore();
    l.save();
    l.globalAlpha = 0.5 * alpha;
    l.strokeStyle = "rgba(200, 210, 255, 0.5)";
    l.lineWidth = R * 0.03;
    l.filter = "blur(6px)";
    l.beginPath();
    l.arc(cx, cy, R * 0.94, 0, TAU);
    l.stroke();
    l.restore();
}

/** The band of fey runes: words around the circle, some fading */
function feyBand(s, l, cx, cy, R, seed, { rad = 0.84, fades = true, alpha = 1, sweep = 1 } = {}) {
    const r = rng(seed);
    const words = 12;
    s.save();
    s.strokeStyle = "#c9d0ff";
    s.fillStyle = "#c9d0ff";
    s.lineWidth = R * 0.008;
    s.lineCap = "round";
    s.lineJoin = "round";
    for (let w = 0; w < words; w++) {
        const a0 = (w / words) * TAU;
        if (a0 / TAU > sweep) continue;
        const n = 3 + Math.floor(r() * 4);
        const letters = Array.from({ length: n }, () => feyLetter(r));
        s.globalAlpha = alpha * (fades ? 0.45 + r() * 0.55 : 1);
        textArc(s, cx, cy, R * rad, a0, letters, R * 0.085, drawFeyLetter, { spacing: 0.48, swash: true });
    }
    s.restore();
}

/* ---------- Divine ---------- */

const FAITHS = [
    [255, 244, 214], // dawn-white
    [255, 120, 80], // ember
    [80, 220, 210], // sea teal
    [210, 220, 240], // moon silver
    [140, 110, 255], // deep violet
];

/** Invented holy sigils of forgotten gods */
function drawSigil(ctx, x, y, s, kind) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = s * 0.06;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (kind === 0) {
        // sun with an eye
        ctx.arc(0, 0, s * 0.25, 0, TAU);
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU;
            ctx.moveTo(Math.cos(a) * s * 0.33, Math.sin(a) * s * 0.33);
            ctx.lineTo(Math.cos(a) * s * (i % 2 ? 0.42 : 0.5), Math.sin(a) * s * (i % 2 ? 0.42 : 0.5));
        }
        ctx.moveTo(s * 0.14, 0);
        ctx.quadraticCurveTo(0, -s * 0.12, -s * 0.14, 0);
        ctx.quadraticCurveTo(0, s * 0.12, s * 0.14, 0);
    } else if (kind === 1) {
        // broken wheel
        ctx.arc(0, 0, s * 0.42, 0.3, TAU - 0.3);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + 0.5;
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42);
        }
    } else if (kind === 2) {
        // tree in a circle
        ctx.arc(0, 0, s * 0.45, 0, TAU);
        ctx.moveTo(0, s * 0.35);
        ctx.lineTo(0, -s * 0.1);
        for (const sx of [-1, 1]) {
            ctx.moveTo(0, 0);
            ctx.lineTo(sx * s * 0.22, -s * 0.22);
            ctx.moveTo(0, -s * 0.1);
            ctx.lineTo(sx * s * 0.12, -s * 0.32);
        }
    } else if (kind === 3) {
        // winged orb
        ctx.arc(0, 0, s * 0.12, 0, TAU);
        for (const sx of [-1, 1]) {
            for (let f = 0; f < 3; f++) {
                ctx.moveTo(sx * s * 0.16, 0);
                ctx.quadraticCurveTo(sx * s * 0.35, -s * (0.25 - f * 0.08), sx * s * (0.5 - f * 0.06), -s * (0.1 - f * 0.08));
            }
        }
    } else if (kind === 4) {
        // three moons
        for (let i = 0; i < 3; i++) {
            const a = -Math.PI / 2 + (i / 3) * TAU;
            const px = Math.cos(a) * s * 0.25;
            const py = Math.sin(a) * s * 0.25;
            ctx.moveTo(px + s * 0.15, py);
            ctx.arc(px, py, s * 0.15, 0, TAU);
        }
    } else {
        // spiral seal
        for (let i = 0; i <= 60; i++) {
            const a = i * 0.3;
            const rr = s * 0.04 + i * s * 0.006;
            i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(rr, 0);
        }
        ctx.rect(-s * 0.45, -s * 0.45, s * 0.9, s * 0.9);
    }
    ctx.stroke();
    ctx.restore();
}

function brokenHalo(l, x, y, rad, rgb, alpha, seed, width = 4) {
    const r = rng(seed);
    l.save();
    l.strokeStyle = `rgba(${rgb.join(",")}, ${alpha})`;
    l.lineWidth = width;
    l.shadowColor = `rgba(${rgb.join(",")}, 1)`;
    l.shadowBlur = 14;
    let a = r() * TAU;
    for (let i = 0; i < 4; i++) {
        const len = 0.8 + r() * 0.9;
        l.beginPath();
        l.arc(x, y, rad, a, a + len);
        l.stroke();
        a += len + 0.15 + r() * 0.3;
    }
    l.restore();
}

function feather(s, l, x, y, size, rot, alpha) {
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    s.fillStyle = "#fffaf0";
    s.beginPath();
    s.moveTo(0, -size * 0.5);
    s.bezierCurveTo(size * 0.2, -size * 0.2, size * 0.16, size * 0.3, 0, size * 0.5);
    s.bezierCurveTo(-size * 0.14, size * 0.3, -size * 0.18, -size * 0.2, 0, -size * 0.5);
    s.fill();
    s.restore();
    sparkle(l, x, y, size * 0.4, "#fff6d8", alpha * 0.5);
}

/** A storm band of one faith's light swirling round the vortex */
function faithStream(l, cx, cy, R, rgb, a0, span, rad0, rad1, width, alpha) {
    l.save();
    l.lineCap = "round";
    l.shadowColor = `rgba(${rgb.join(",")}, 1)`;
    l.shadowBlur = 18;
    const steps = 40;
    for (const [w, al] of [
        [width * 2.2, 0.25],
        [width, 0.7],
        [width * 0.3, 1],
    ]) {
        l.beginPath();
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = a0 + span * t;
            const rr = R * lerp(rad0, rad1, t) + Math.sin(t * 9 + a0) * R * 0.015;
            i ? l.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : l.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        l.strokeStyle = `rgba(${rgb.join(",")}, ${al * alpha})`;
        l.lineWidth = w;
        l.stroke();
    }
    l.restore();
}

/** A shaft of light stabbing down from above onto a spot (top-down, so it falls toward the bottom of the screen) */
function godRay(l, x, y, R, alpha) {
    l.save();
    const top = y - R * 0.9;
    const g = l.createLinearGradient(x, top, x, y);
    g.addColorStop(0, "rgba(255, 248, 225, 0)");
    g.addColorStop(1, `rgba(255, 248, 225, ${0.55 * alpha})`);
    l.fillStyle = g;
    l.beginPath();
    l.moveTo(x - R * 0.03, top);
    l.lineTo(x + R * 0.03, top);
    l.lineTo(x + R * 0.1, y);
    l.lineTo(x - R * 0.1, y);
    l.closePath();
    l.fill();
    const pool = l.createRadialGradient(x, y, 0, x, y, R * 0.18);
    pool.addColorStop(0, `rgba(255, 250, 235, ${0.9 * alpha})`);
    pool.addColorStop(1, "rgba(255, 250, 235, 0)");
    l.fillStyle = pool;
    l.beginPath();
    l.ellipse(x, y, R * 0.18, R * 0.1, 0, 0, TAU);
    l.fill();
    l.restore();
}

/* ---------- Primal ---------- */

function blobPath(ctx, x, y, rad, seed) {
    const r = rng(seed);
    const k = Array.from({ length: 4 }, () => [r() * 0.25, r() * TAU]);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU;
        const rr = rad * (1 + k.reduce((acc, [amp, ph], j) => acc + amp * Math.sin(a * (j + 2) + ph), 0) * 0.6);
        i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
}

function bellCap(s, l, x, y, size, hue) {
    s.save();
    s.translate(x, y);
    s.fillStyle = "#cfd8e8";
    s.fillRect(-size * 0.06, -size * 0.5, size * 0.12, size * 0.5);
    s.fillStyle = hue;
    s.beginPath();
    s.moveTo(-size * 0.32, -size * 0.45);
    s.quadraticCurveTo(0, -size * 1.05, size * 0.32, -size * 0.45);
    s.quadraticCurveTo(0, -size * 0.55, -size * 0.32, -size * 0.45);
    s.fill();
    s.restore();
    const g = l.createRadialGradient(x, y - size * 0.6, 0, x, y - size * 0.6, size * 0.8);
    g.addColorStop(0, hue + "aa");
    g.addColorStop(1, hue + "00");
    l.fillStyle = g;
    l.beginPath();
    l.arc(x, y - size * 0.6, size * 0.8, 0, TAU);
    l.fill();
}

function terrainPatch(s, l, kind, x, y, rad, seed, alpha) {
    const r = rng(seed);
    s.save();
    s.globalAlpha = alpha;
    blobPath(s, x, y, rad, seed);
    s.save();
    s.clip();
    if (kind === "fungi") {
        s.fillStyle = "#1c2a2a";
        s.fillRect(x - rad * 2, y - rad * 2, rad * 4, rad * 4);
        for (let i = 0; i < 70; i++) {
            s.fillStyle = `rgba(${60 + r() * 40}, ${100 + r() * 50}, ${80 + r() * 40}, 0.6)`;
            s.beginPath();
            s.arc(x + (r() - 0.5) * rad * 2, y + (r() - 0.5) * rad * 2, 2 + r() * 5, 0, TAU);
            s.fill();
        }
    } else if (kind === "ruin") {
        s.fillStyle = "#3b3f4c";
        s.fillRect(x - rad * 2, y - rad * 2, rad * 4, rad * 4);
        s.strokeStyle = "#20232c";
        s.lineWidth = 2.5;
        for (let i = -3; i <= 3; i++) {
            s.beginPath();
            s.moveTo(x - rad * 2, y + i * rad * 0.35 + (i % 2) * 6);
            s.lineTo(x + rad * 2, y + i * rad * 0.35 - (i % 2) * 6);
            s.stroke();
            for (let j = -4; j <= 4; j++) {
                s.beginPath();
                s.moveTo(x + j * rad * 0.4 + (i % 2) * rad * 0.2, y + i * rad * 0.35);
                s.lineTo(x + j * rad * 0.4 + (i % 2) * rad * 0.2, y + (i + 1) * rad * 0.35);
                s.stroke();
            }
        }
        // a carved rune on the old stone
        s.strokeStyle = "#7f8ab8";
        s.lineWidth = 2;
        drawFeyLetter(s, { type: 2, flip: 1, dot: 1, tall: 1 }, rad * 0.4);
        for (let i = 0; i < 40; i++) {
            s.fillStyle = `rgba(80, 130, 70, ${0.4 + r() * 0.4})`;
            s.beginPath();
            s.arc(x + (r() - 0.5) * rad * 2, y + (r() - 0.5) * rad * 2, 2 + r() * 6, 0, TAU);
            s.fill();
        }
    } else if (kind === "crystal") {
        s.fillStyle = "#1d2236";
        s.fillRect(x - rad * 2, y - rad * 2, rad * 4, rad * 4);
    } else {
        s.fillStyle = "#1f3322";
        s.fillRect(x - rad * 2, y - rad * 2, rad * 4, rad * 4);
    }
    s.restore();
    // What grows on each patch
    if (kind === "fungi") {
        for (let i = 0; i < 9; i++) {
            const a = r() * TAU;
            const d = rad * Math.sqrt(r()) * 0.75;
            bellCap(s, l, x + Math.cos(a) * d, y + Math.sin(a) * d, rad * (0.22 + r() * 0.15), r() < 0.5 ? "#8a7dff" : "#5fd3c8");
        }
        s.fillStyle = "#c4a6ff";
        for (let i = 0; i < 3; i++) {
            const a = r() * TAU;
            s.beginPath();
            s.arc(x + Math.cos(a) * rad * 0.8, y + Math.sin(a) * rad * 0.8, rad * 0.16, Math.PI, 0);
            s.fill();
        }
    } else if (kind === "crystal") {
        for (let i = 0; i < 8; i++) {
            const a = r() * TAU;
            const d = rad * Math.sqrt(r()) * 0.7;
            const cxk = x + Math.cos(a) * d;
            const cyk = y + Math.sin(a) * d;
            const h = rad * (0.25 + r() * 0.3);
            const rot = (r() - 0.5) * 0.8;
            s.save();
            s.translate(cxk, cyk);
            s.rotate(rot);
            s.fillStyle = "#a9c2ff";
            s.beginPath();
            s.moveTo(0, -h);
            s.lineTo(h * 0.22, -h * 0.6);
            s.lineTo(h * 0.18, 0);
            s.lineTo(-h * 0.18, 0);
            s.lineTo(-h * 0.22, -h * 0.6);
            s.closePath();
            s.fill();
            s.fillStyle = "#e6eeff";
            s.beginPath();
            s.moveTo(0, -h);
            s.lineTo(h * 0.22, -h * 0.6);
            s.lineTo(0, -h * 0.5);
            s.closePath();
            s.fill();
            s.restore();
            sparkle(l, cxk, cyk - h, 4, "#e6eeff", 0.8 * alpha);
        }
    } else if (kind === "vines") {
        s.strokeStyle = "#5c9a52";
        s.lineWidth = 2.5;
        s.lineCap = "round";
        for (let i = 0; i < 6; i++) {
            let a = r() * TAU;
            let px = x + Math.cos(a) * rad * 0.2;
            let py = y + Math.sin(a) * rad * 0.2;
            s.beginPath();
            s.moveTo(px, py);
            for (let k = 0; k < 14; k++) {
                a += (r() - 0.5) * 1.1;
                px += Math.cos(a) * rad * 0.08;
                py += Math.sin(a) * rad * 0.08;
                s.lineTo(px, py);
            }
            s.stroke();
            // pale flowers
            for (let p = 0; p < 5; p++) {
                s.fillStyle = "#eef0ff";
                s.beginPath();
                s.ellipse(px + Math.cos((p / 5) * TAU) * 4, py + Math.sin((p / 5) * TAU) * 4, 3.2, 2, (p / 5) * TAU, 0, TAU);
                s.fill();
            }
            sparkle(l, px, py, 4, "#ffffff", 0.6 * alpha);
        }
    }
    s.restore();
}

/** Glowing mycelium threads, from a start point wandering toward an end */
function mycelium(l, ax, ay, bx, by, seed, alpha, color = "120, 230, 200") {
    const r = rng(seed);
    l.save();
    l.strokeStyle = `rgba(${color}, ${0.8 * alpha})`;
    l.shadowColor = `rgba(${color}, 1)`;
    l.shadowBlur = 8;
    l.lineWidth = 1.3;
    for (let k = 0; k < 3; k++) {
        l.beginPath();
        let px = ax;
        let py = ay;
        l.moveTo(px, py);
        for (let i = 1; i <= 20; i++) {
            const t = i / 20;
            px = lerp(ax, bx, t) + (r() - 0.5) * 18;
            py = lerp(ay, by, t) + (r() - 0.5) * 18;
            l.lineTo(px, py);
            if (r() < 0.15) {
                l.moveTo(px, py);
                l.lineTo(px + (r() - 0.5) * 30, py + (r() - 0.5) * 30);
                l.moveTo(px, py);
            }
        }
        l.stroke();
    }
    l.restore();
}

/* ---------- Valet's wisp ---------- */

function wisp(l, x, y, size, alpha = 1, tendrilPhase = 0) {
    const g = l.createRadialGradient(x, y, 0, x, y, size * 2.6);
    g.addColorStop(0, `rgba(30, 26, 90, ${0.9 * alpha})`);
    g.addColorStop(0.18, `rgba(70, 60, 200, ${0.9 * alpha})`);
    g.addColorStop(0.35, `rgba(120, 110, 255, ${0.55 * alpha})`);
    g.addColorStop(1, "rgba(80, 70, 220, 0)");
    l.fillStyle = g;
    l.beginPath();
    l.arc(x, y, size * 2.6, 0, TAU);
    l.fill();
    // Three uneven wisps of magic trailing off it, like smoke from a candle
    l.save();
    l.lineCap = "round";
    [
        [0.0, 2.4, 0.5],
        [2.3, 1.7, -0.35],
        [4.1, 2.0, 0.25],
    ].forEach(([off, len, curl]) => {
        const a = tendrilPhase + off;
        const steps = 16;
        for (let k = 0; k < steps; k++) {
            const t0 = k / steps;
            const t1 = (k + 1) / steps;
            const p = (t) => {
                const ang = a + curl * t * 3;
                const rr = size * (0.5 + len * t);
                return [x + Math.cos(ang) * rr, y + Math.sin(ang) * rr];
            };
            l.strokeStyle = `rgba(150, 140, 255, ${0.45 * alpha * (1 - t0)})`;
            l.lineWidth = 3 * (1 - t0) + 0.5;
            l.beginPath();
            l.moveTo(...p(t0));
            l.lineTo(...p(t1));
            l.stroke();
        }
    });
    l.restore();
    // A dark heart
    const c = l.createRadialGradient(x, y, 0, x, y, size * 0.45);
    c.addColorStop(0, `rgba(200, 200, 255, ${0.9 * alpha})`);
    c.addColorStop(1, "rgba(120, 110, 255, 0)");
    l.fillStyle = c;
    l.beginPath();
    l.arc(x, y, size * 0.45, 0, TAU);
    l.fill();
}

/** The wisp's lazy corkscrew from a to b, sampled at s in [0, 1] */
function wispPath(ax, ay, bx, by, s) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const e = easeInOut(s);
    const amp = len * 0.12 * Math.sin(Math.PI * s);
    const off = amp * Math.sin(s * TAU * 1.75);
    const lift = -len * 0.08 * Math.sin(Math.PI * s);
    return [ax + dx * e + nx * off, ay + dy * e + ny * off + lift];
}

/* ---------- The moth ---------- */

function moth(s, l, x, y, size, flap, rot = 0, alpha = 1) {
    // flap: 1 open, 0 closed (wings edge-on)
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    for (const sx of [-1, 1]) {
        s.save();
        s.scale(sx * (0.25 + 0.75 * flap), 1);
        const g = s.createRadialGradient(size * 0.3, -size * 0.1, 0, size * 0.3, -size * 0.1, size * 0.7);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#c9cff5");
        s.fillStyle = g;
        s.beginPath();
        s.moveTo(0, -size * 0.05);
        s.bezierCurveTo(size * 0.25, -size * 0.6, size * 0.75, -size * 0.55, size * 0.7, -size * 0.12);
        s.bezierCurveTo(size * 0.6, size * 0.05, size * 0.25, size * 0.05, 0, size * 0.02);
        s.fill();
        s.beginPath();
        s.moveTo(0, size * 0.02);
        s.bezierCurveTo(size * 0.35, size * 0.05, size * 0.5, size * 0.4, size * 0.25, size * 0.45);
        s.bezierCurveTo(size * 0.1, size * 0.45, size * 0.03, size * 0.25, 0, size * 0.1);
        s.fill();
        // eye-spots
        s.fillStyle = "rgba(140, 150, 230, 0.7)";
        s.beginPath();
        s.arc(size * 0.42, -size * 0.25, size * 0.07, 0, TAU);
        s.fill();
        s.restore();
    }
    s.fillStyle = "#eef0ff";
    s.beginPath();
    s.ellipse(0, size * 0.05, size * 0.06, size * 0.22, 0, 0, TAU);
    s.fill();
    s.strokeStyle = "#eef0ff";
    s.lineWidth = 1;
    s.beginPath();
    s.moveTo(-size * 0.02, -size * 0.14);
    s.quadraticCurveTo(-size * 0.12, -size * 0.35, -size * 0.2, -size * 0.36);
    s.moveTo(size * 0.02, -size * 0.14);
    s.quadraticCurveTo(size * 0.12, -size * 0.35, size * 0.2, -size * 0.36);
    s.stroke();
    s.restore();
    const g = l.createRadialGradient(x, y, 0, x, y, size * 1.4);
    g.addColorStop(0, `rgba(235, 238, 255, ${0.7 * alpha})`);
    g.addColorStop(0.4, `rgba(190, 195, 255, ${0.3 * alpha})`);
    g.addColorStop(1, "rgba(190, 195, 255, 0)");
    l.fillStyle = g;
    l.beginPath();
    l.arc(x, y, size * 1.4, 0, TAU);
    l.fill();
}

/* ---------- The firefly ---------- */

/** A firefly heading along rot: small dark body, faint wing blur, glowing tail. glow in [0, 1] is its blink. */
function firefly(s, l, x, y, size, glow, rot = 0, alpha = 1) {
    const tx = x - Math.cos(rot) * size * 0.35;
    const ty = y - Math.sin(rot) * size * 0.35;
    // The glow, big and soft, pulsing with the blink
    const g = l.createRadialGradient(tx, ty, 0, tx, ty, size * (2 + 2.5 * glow));
    g.addColorStop(0, `rgba(245, 255, 200, ${alpha * (0.5 + 0.5 * glow)})`);
    g.addColorStop(0.25, `rgba(215, 245, 150, ${alpha * 0.45 * glow})`);
    g.addColorStop(1, "rgba(200, 240, 140, 0)");
    l.fillStyle = g;
    l.beginPath();
    l.arc(tx, ty, size * (2 + 2.5 * glow), 0, TAU);
    l.fill();
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    // wings, a faint blur either side
    s.fillStyle = "rgba(220, 228, 255, 0.45)";
    for (const sy of [-1, 1]) {
        s.beginPath();
        s.ellipse(size * 0.05, sy * size * 0.22, size * 0.32, size * 0.13, sy * 0.5, 0, TAU);
        s.fill();
    }
    // body: dark head and thorax, pale glowing tail
    s.fillStyle = "#1d1a2e";
    s.beginPath();
    s.ellipse(size * 0.2, 0, size * 0.2, size * 0.1, 0, 0, TAU);
    s.fill();
    s.fillStyle = `rgb(${lerp(150, 245, glow)}, ${lerp(170, 255, glow)}, ${lerp(110, 200, glow)})`;
    s.beginPath();
    s.ellipse(-size * 0.25, 0, size * 0.24, size * 0.13, 0, 0, TAU);
    s.fill();
    s.restore();
}

/* ---------- Chaotic text ---------- */

/** Letters along any path: path(t) → [x, y] for t in [0, 1]; letters are spaced by arc length and face along it */
function textPath(ctx, path, letters, h, draw, { spacing = 0.6 } = {}) {
    const N = 300;
    const pts = Array.from({ length: N + 1 }, (_, i) => path(i / N));
    const want = h * spacing;
    let acc = 0;
    let li = 0;
    for (let i = 1; i <= N && li < letters.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        acc += Math.hypot(bx - ax, by - ay);
        if (acc >= want || i === 1) {
            acc = 0;
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(Math.atan2(by - ay, bx - ax));
            draw(ctx, letters[li++], h);
            ctx.restore();
        }
    }
}

const PATHS = {
    line: (cx, cy, len, ang) => (t) => [cx + Math.cos(ang) * len * (t - 0.5), cy + Math.sin(ang) * len * (t - 0.5)],
    snake: (cx, cy, len, ang, amp, waves) => (t) => {
        const u = len * (t - 0.5);
        const v = amp * Math.sin(t * TAU * waves);
        return [cx + Math.cos(ang) * u - Math.sin(ang) * v, cy + Math.sin(ang) * u + Math.cos(ang) * v];
    },
    arc: (cx, cy, rad, a0, span) => (t) => [cx + Math.cos(a0 + span * t) * rad, cy + Math.sin(a0 + span * t) * rad],
    spiral: (cx, cy, r0, r1, a0, turns) => (t) => [cx + Math.cos(a0 + turns * TAU * t) * lerp(r0, r1, t), cy + Math.sin(a0 + turns * TAU * t) * lerp(r0, r1, t)],
};

/** One run of a script on a path, in its own size and fade */
function scriptRun(s, style, path, n, h, alpha, r, color = "#dbe6ff") {
    s.save();
    s.globalAlpha = alpha;
    s.strokeStyle = s.fillStyle = color;
    s.lineWidth = Math.max(1.1, h * 0.1);
    s.lineCap = "round";
    s.lineJoin = "round";
    if (style === "fey") textPath(s, path, Array.from({ length: n }, () => feyLetter(r)), h, drawFeyLetter, { spacing: 0.5 });
    else textPath(s, path, Array.from({ length: n }, () => SCRIPTS[style](r)), h, (c, L, hh) => drawScriptLetter(c, style, L, hh), { spacing: 0.75 });
    s.restore();
}

/** A loose page: torn on one edge, a curled corner, lines of a script, tumbling (skewed as it turns) */
function loosePage(s, l, x, y, w, rot, skew, alpha, seed) {
    const r = rng(seed);
    const h = w * 1.3;
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    s.transform(1, 0, skew, 1, 0, 0);
    s.beginPath();
    s.moveTo(-w / 2, -h / 2);
    s.lineTo(w / 2 - w * 0.18, -h / 2);
    s.lineTo(w / 2, -h / 2 + w * 0.18);
    // torn right edge
    for (let i = 1; i <= 10; i++) s.lineTo(w / 2 - r() * w * 0.06, -h / 2 + w * 0.18 + (i / 10) * (h - w * 0.18));
    s.lineTo(-w / 2, h / 2);
    s.closePath();
    const g = s.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    g.addColorStop(0, "#9ba6cc");
    g.addColorStop(1, "#5d6890");
    s.fillStyle = g;
    s.fill();
    // the curled corner, folded over
    s.beginPath();
    s.moveTo(w / 2 - w * 0.18, -h / 2);
    s.lineTo(w / 2 - w * 0.18, -h / 2 + w * 0.18);
    s.lineTo(w / 2, -h / 2 + w * 0.18);
    s.closePath();
    s.fillStyle = "#3e4870";
    s.fill();
    // lines of text
    const style = Object.keys(SCRIPTS)[Math.floor(r() * 6)];
    s.strokeStyle = s.fillStyle = "#e6ecff";
    s.lineWidth = Math.max(1.2, w * 0.016);
    for (let row = 0; row < 7; row++) {
        const len = row === 6 ? 3 : 6;
        for (let c = 0; c < len; c++) {
            s.save();
            s.translate(-w * 0.36 + c * w * 0.13, -h * 0.3 + row * h * 0.1);
            drawScriptLetter(s, style, SCRIPTS[style](r), w * 0.075);
            s.restore();
        }
    }
    s.restore();
    // a cold glow around it
    const gl = l.createRadialGradient(x, y, 0, x, y, w);
    gl.addColorStop(0, `rgba(170, 195, 255, ${0.12 * alpha})`);
    gl.addColorStop(1, "rgba(170, 195, 255, 0)");
    l.fillStyle = gl;
    l.beginPath();
    l.arc(x, y, w, 0, TAU);
    l.fill();
}

/* ---------- Divine debris and tilted halos ---------- */

/** A halo seen at an angle: an ellipse, broken in places */
function tiltedHalo(l, x, y, rad, tilt, rot, rgb, alpha, seed, width = 3) {
    const r = rng(seed);
    l.save();
    l.translate(x, y);
    l.rotate(rot);
    l.scale(1, Math.max(0.15, Math.cos(tilt)));
    l.strokeStyle = `rgba(${rgb.join(",")}, ${alpha})`;
    l.lineWidth = width;
    l.shadowColor = `rgba(${rgb.join(",")}, 1)`;
    l.shadowBlur = 12;
    let a = r() * TAU;
    for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
        const len = 0.6 + r() * 1.2;
        l.beginPath();
        l.arc(0, 0, rad, a, a + len);
        l.stroke();
        a += len + 0.1 + r() * 0.5;
    }
    l.restore();
}

/** A streak of flung debris: ember, petal or spark, curving as it flies */
function debris(l, x, y, ang, len, curve, rgb, alpha) {
    l.save();
    l.lineCap = "round";
    for (let i = 0; i < 10; i++) {
        const t0 = i / 10;
        const t1 = (i + 1) / 10;
        const p = (t) => [x + Math.cos(ang + curve * t) * len * t, y + Math.sin(ang + curve * t) * len * t];
        l.strokeStyle = `rgba(${rgb.join(",")}, ${alpha * t1})`;
        l.lineWidth = 0.6 + 2.2 * t1;
        l.beginPath();
        l.moveTo(...p(t0));
        l.lineTo(...p(t1));
        l.stroke();
    }
    l.restore();
}

/** A shaft of light from above at an angle: top-down, it falls at a slant onto its spot */
function slantRay(l, x, y, R, ang, alpha) {
    l.save();
    l.translate(x, y);
    l.rotate(ang);
    const g = l.createLinearGradient(0, -R * 0.8, 0, 0);
    g.addColorStop(0, "rgba(255, 248, 225, 0)");
    g.addColorStop(1, `rgba(255, 248, 225, ${0.6 * alpha})`);
    l.fillStyle = g;
    l.beginPath();
    l.moveTo(-R * 0.02, -R * 0.8);
    l.lineTo(R * 0.02, -R * 0.8);
    l.lineTo(R * 0.08, 0);
    l.lineTo(-R * 0.08, 0);
    l.closePath();
    l.fill();
    l.restore();
    const pool = l.createRadialGradient(x, y, 0, x, y, R * 0.15);
    pool.addColorStop(0, `rgba(255, 250, 235, ${0.95 * alpha})`);
    pool.addColorStop(1, "rgba(255, 250, 235, 0)");
    l.fillStyle = pool;
    l.beginPath();
    l.arc(x, y, R * 0.15, 0, TAU);
    l.fill();
}

/* ---------- The charge's mote ---------- */

function kindMote(l, x, y, size, alpha = 1) {
    const g = l.createRadialGradient(x, y, 0, x, y, size * 3.2);
    g.addColorStop(0, `rgba(255, 255, 250, ${alpha})`);
    g.addColorStop(0.12, `rgba(255, 246, 220, ${0.95 * alpha})`);
    g.addColorStop(0.35, `rgba(255, 228, 180, ${0.35 * alpha})`);
    g.addColorStop(1, "rgba(255, 220, 170, 0)");
    l.fillStyle = g;
    l.beginPath();
    l.arc(x, y, size * 3.2, 0, TAU);
    l.fill();
    sparkle(l, x, y, size * 1.3, "#ffffff", 0.7 * alpha, 0.4);
}

/* ---------- Valet's wisp with living tendrils ---------- */

/** At time t, each of four tendril slots is somewhere in its life: unfurling, curling, then drawing back into the core */
function livingWisp(l, x, y, size, t, alpha = 1) {
    const slots = [
        [0.3, 0.0, 0.6],
        [2.0, 0.37, -0.45],
        [3.5, 0.62, 0.35],
        [5.0, 0.85, -0.6],
    ];
    const g = l.createRadialGradient(x, y, 0, x, y, size * 2.6);
    g.addColorStop(0, `rgba(30, 26, 90, ${0.9 * alpha})`);
    g.addColorStop(0.18, `rgba(70, 60, 200, ${0.9 * alpha})`);
    g.addColorStop(0.35, `rgba(120, 110, 255, ${0.5 * alpha})`);
    g.addColorStop(1, "rgba(80, 70, 220, 0)");
    l.fillStyle = g;
    l.beginPath();
    l.arc(x, y, size * 2.6, 0, TAU);
    l.fill();
    l.save();
    l.lineCap = "round";
    for (const [base, off, curl] of slots) {
        const life = (t * 0.45 + off) % 1;
        // Out, then back in: the tip leads on the way out and is reeled in last
        const reach = Math.sin(Math.PI * life);
        const a = base + t * 0.4 + life * 0.8;
        const len = 0.3 + 2.4 * reach;
        const steps = 18;
        for (let k = 0; k < steps; k++) {
            const t0 = k / steps;
            const t1 = (k + 1) / steps;
            const p = (u) => {
                const ang = a + curl * u * 3 * (0.5 + reach);
                const rr = size * (0.4 + len * u);
                return [x + Math.cos(ang) * rr, y + Math.sin(ang) * rr];
            };
            l.strokeStyle = `rgba(150, 140, 255, ${0.5 * alpha * (1 - t0) * (0.3 + 0.7 * reach)})`;
            l.lineWidth = (3.2 * (1 - t0) + 0.4) * (0.5 + 0.5 * reach);
            l.beginPath();
            l.moveTo(...p(t0));
            l.lineTo(...p(t1));
            l.stroke();
        }
    }
    l.restore();
    const c = l.createRadialGradient(x, y, 0, x, y, size * 0.45);
    c.addColorStop(0, `rgba(200, 200, 255, ${0.9 * alpha})`);
    c.addColorStop(1, "rgba(120, 110, 255, 0)");
    l.fillStyle = c;
    l.beginPath();
    l.arc(x, y, size * 0.45, 0, TAU);
    l.fill();
}

/* ---------- Pages that bend and flutter ---------- */

const pageCache = new Map();
/** The flat page, drawn once per seed at 4× size: torn edge, folded corner, a heading and lines in one script */
function flatPage(seed, w) {
    const key = `${seed}:${w}`;
    if (pageCache.has(key)) return pageCache.get(key);
    const S = 4;
    const W = Math.round(w * S);
    const H = Math.round(w * 1.3 * S);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    const r = rng(seed);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    for (let i = 1; i <= 14; i++) ctx.lineTo(W - r() * W * 0.06, (i / 14) * H * 0.82);
    ctx.lineTo(W * 0.82, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#8590ba");
    g.addColorStop(1, "#5b6590");
    ctx.fillStyle = g;
    ctx.fill();
    // foxing and age
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(30, 34, 60, ${r() * 0.12})`;
        ctx.beginPath();
        ctx.arc(r() * W, r() * H, W * (0.02 + r() * 0.08), 0, TAU);
        ctx.fill();
    }
    ctx.restore();
    // the writing: glowing ink, one script per page, a heading and a few lines
    const style = STYLES_ALL[Math.floor(r() * STYLES_ALL.length)];
    ctx.strokeStyle = ctx.fillStyle = "#f3f6ff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const draw = (L, h) => (style === "fey" ? drawFeyLetter(ctx, L, h) : drawScriptLetter(ctx, style, L, h));
    const make = () => (style === "fey" ? feyLetter(r) : SCRIPTS[style](r));
    const head = W * 0.16;
    ctx.lineWidth = head * 0.12;
    for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.translate(W * 0.2 + k * head * 0.75, H * 0.16);
        draw(make(), head);
        ctx.restore();
    }
    const h = W * 0.09;
    ctx.lineWidth = h * 0.13;
    for (let row = 0; row < 5; row++) {
        const n = row === 4 ? 4 : 8;
        for (let k = 0; k < n; k++) {
            ctx.save();
            ctx.translate(W * 0.12 + k * h * 0.85, H * 0.32 + row * h * 1.55);
            draw(make(), h);
            ctx.restore();
        }
    }
    // some pages carry a little diagram
    if (r() < 0.5) {
        ctx.lineWidth = W * 0.012;
        ctx.beginPath();
        ctx.arc(W * 0.7, H * 0.85, W * 0.1, 0, TAU);
        ctx.stroke();
        ctx.save();
        ctx.translate(W * 0.7, H * 0.85);
        polygon(ctx, 3, W * 0.1);
        ctx.stroke();
        ctx.restore();
    }
    pageCache.set(key, c);
    return c;
}
const STYLES_ALL = ["fey", "runic", "cursive", "blocky", "dotted", "picto", "circuit"];

/**
 * A page bending like paper caught in a draught: sliced into strips across its width, each strip tilted along a
 * travelling wave (bend, phase), foreshortened and shaded by its tilt; lift raises the free edge.
 */
function bentPage(s, l, x, y, w, rot, bend, phase, alpha, seed) {
    const img = flatPage(seed, w);
    const N = 48;
    const h = w * 1.3;
    // Cumulative positions along the bent width
    const slopes = Array.from({ length: N }, (_, i) => bend * Math.sin(Math.PI * ((i + 0.5) / N) * 1.3 + phase));
    const widths = slopes.map((a) => (w / N) * Math.cos(a));
    const total = widths.reduce((a, b) => a + b, 0);
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    let px = -total / 2;
    let lift = 0;
    slopes.forEach((a, i) => {
        const sw = widths[i];
        // perspective: the raised part looks a little taller
        const sy = 1 + lift * 0.004;
        s.save();
        s.translate(px, -lift * 0.25);
        s.scale(1, sy);
        s.drawImage(img, (i / N) * img.width, 0, img.width / N + 1, img.height, 0, -h / 2, sw + 0.6, h);
        // shade by tilt: faces turned away darken, faces turned toward the light catch it
        const shade = Math.sin(a);
        s.fillStyle = shade > 0 ? `rgba(255, 255, 255, ${shade * 0.25})` : `rgba(10, 12, 30, ${-shade * 0.45})`;
        s.globalCompositeOperation = "source-atop";
        s.fillRect(0, -h / 2, sw + 0.6, h);
        s.globalCompositeOperation = "source-over";
        s.restore();
        px += sw;
        lift += Math.sin(a) * (w / N) * 2;
    });
    s.restore();
    const gl = l.createRadialGradient(x, y, 0, x, y, w);
    gl.addColorStop(0, `rgba(170, 195, 255, ${0.1 * alpha})`);
    gl.addColorStop(1, "rgba(170, 195, 255, 0)");
    l.fillStyle = gl;
    l.beginPath();
    l.arc(x, y, w, 0, TAU);
    l.fill();
}
