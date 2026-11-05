/* Storyboard frames: a few key moments of each piece, drawn with the mockup kit */

let kit = null;
const FINCH = { label: "Finch", initial: "F", hue: 245, ring: "#59c3ff" };
const AM = [640, 400];
const AR = 250;
const AURA_TOKENS = () => [
    [AM, FINCH],
    [[AM[0] - 150, AM[1] + 50], VALET],
    [[AM[0] + 100, AM[1] - 150], ALLY2],
    [[AM[0] + 450, AM[1] + 50], ENEMY],
];

function auraFrame(ctx, { border, mist, draw, seed = 1, edge }) {
    kit ??= new Kit();
    ctx.drawImage(background(), 0, 0);
    const { s, l } = kit.begin();
    draw(s, l);
    const img = kit.render({ mist: { x: AM[0], y: AM[1], R: AR, ph: 0.2, density: 1, ...mist }, seed, edge });
    ctx.save();
    ctx.fillStyle = `rgba(${border.join(",")}, 0.08)`;
    ctx.beginPath();
    ctx.arc(...AM, AR, 0, TAU);
    ctx.fill();
    ctx.drawImage(img, 0, 0);
    ctx.strokeStyle = `rgba(${border.join(",")}, 0.75)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(...AM, AR, 0, TAU);
    ctx.stroke();
    ctx.restore();
    for (const [p, t] of AURA_TOKENS()) token(ctx, ...p, t);
}

/** Effects over the tokens (Sequencer's default) */
function overFrame(ctx, tokens, draw, { seed = 1, edge } = {}) {
    kit ??= new Kit();
    ctx.drawImage(background(), 0, 0);
    for (const [p, t] of tokens) token(ctx, ...p, t);
    const { s, l } = kit.begin();
    draw(s, l);
    ctx.drawImage(kit.render({ seed, edge, haze: 1.5 }), 0, 0);
}

const [X, Y] = AM;
const at = (ang, rad) => [X + Math.cos(ang) * AR * rad, Y + Math.sin(ang) * AR * rad];

/* ---------- Occult ---------- */
const OCC_BORDER = [104, 96, 232];
const FACES = ["calm", "joy", "grief", "fear", "longing", "joy", "grief", "longing"];

function occultLoop(s, l, seed, alphas, offset) {
    silverRings(s, l, X, Y, AR);
    feyBand(s, l, X, Y, AR, 7 + seed, {});
    starfield(l, X, Y, AR, 30 + seed);
    trinkets(s, X, Y, AR, 50 + seed, 5);
    // The King is one of the faces, no larger and no longer-lived than the rest
    for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i / 7) * TAU + offset;
        drawFace(s, l, ...at(a, 0.5 + 0.08 * Math.sin(i * 2.3)), AR * 0.15, i === 0 ? "calm" : FACES[i], { alpha: alphas[i], tilt: Math.sin(i) * 0.2, crown: i === 0 });
    }
}

const BOARDS = {
    occult: {
        title: "Manifest Will (occult) — The Masquerade of Lost Faces",
        crop: [370, 130, 540, 540],
        frames: [
            {
                label: "Cast: Finch exhales the mist; a rush of lost faces streams out",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: OCC_BORDER,
                        mist: { density: 0.55 },
                        draw: (s, l) => {
                            const g = l.createRadialGradient(X, Y, 0, X, Y, AR * 0.5);
                            g.addColorStop(0, "rgba(200, 205, 255, 0.6)");
                            g.addColorStop(1, "rgba(120, 110, 255, 0)");
                            l.fillStyle = g;
                            l.fillRect(X - AR, Y - AR, AR * 2, AR * 2);
                            for (let i = 0; i < 9; i++) {
                                const a = (i / 9) * TAU + 0.6;
                                const rad = 0.22 + (i % 3) * 0.13;
                                drawFace(s, l, ...at(a - rad * 1.6, rad), AR * (0.08 + rad * 0.12), FACES[i % 8], { alpha: 0.55 + 0.4 * ((i * 7) % 3) / 2, tilt: a });
                            }
                            starfield(l, X, Y, AR * 0.6, 3, 40);
                        },
                    }),
            },
            {
                label: "Cast: the silver ring and fey runes etch in behind a sweeping front",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: OCC_BORDER,
                        draw: (s, l) => {
                            silverRings(s, l, X, Y, AR, { alpha: 1 });
                            feyBand(s, l, X, Y, AR, 7, { fades: false, sweep: 0.62 });
                            const [fx, fy] = at(-Math.PI / 2 + 0.62 * TAU, 0.84);
                            sparkle(l, fx, fy, 26, "#ffffff", 1);
                            ringPulse(l, X, Y, AR * 0.8, "#cfd6ff", 0.7, 6);
                            for (let i = 0; i < 7; i++) drawFace(s, l, ...at(-Math.PI / 2 + (i / 7) * TAU, 0.52),  AR * 0.15, i ? FACES[i] : "calm", { alpha: 0.9, crown: i === 0 });
                            starfield(l, X, Y, AR, 31);
                        },
                    }),
            },
            {
                label: "Loop: faces surface from the mist and sink back; the King is among them",
                draw: (ctx) => auraFrame(ctx, { border: OCC_BORDER, mist: { ph: 0.3 }, seed: 2, draw: (s, l) => occultLoop(s, l, 0, [0.6, 0.85, 0.5, 0.2, 0.7, 0.35, 0.95], 0) }),
            },
            {
                label: "Loop, moments later: other faces, other trinkets",
                draw: (ctx) => auraFrame(ctx, { border: OCC_BORDER, mist: { ph: 0.6 }, seed: 3, draw: (s, l) => occultLoop(s, l, 1, [0.2, 0.15, 0.9, 0.75, 0.55, 0.85, 0.5], 0.35) }),
            },
        ],
    },

    divine: {
        title: "Manifest Will (divine) — Requiem of Forgotten Gods",
        crop: [370, 130, 540, 540],
        frames: [
            {
                label: "Cast: holy light cracks open over Finch; shattered halos burst outward",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: [236, 214, 140],
                        mist: { density: 0.6, hi: [0.98, 0.92, 0.75], storm: true },
                        edge: [1, 0.92, 0.7],
                        draw: (s, l) => {
                            const g = l.createRadialGradient(X, Y, 0, X, Y, AR * 0.6);
                            g.addColorStop(0, "rgba(255, 250, 230, 1)");
                            g.addColorStop(0.3, "rgba(255, 230, 170, 0.5)");
                            g.addColorStop(1, "rgba(255, 230, 170, 0)");
                            l.fillStyle = g;
                            l.fillRect(X - AR, Y - AR, AR * 2, AR * 2);
                            const r = rng(4);
                            l.strokeStyle = "rgba(255, 248, 225, 0.9)";
                            l.shadowColor = "rgba(255, 230, 170, 1)";
                            l.shadowBlur = 12;
                            l.lineWidth = 2.5;
                            for (let i = 0; i < 9; i++) {
                                let a = (i / 9) * TAU + r() * 0.3;
                                let rad = AR * 0.12;
                                l.beginPath();
                                l.moveTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad);
                                for (let k = 0; k < 5; k++) {
                                    a += (r() - 0.5) * 0.35;
                                    rad += AR * (0.06 + r() * 0.06);
                                    l.lineTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad);
                                }
                                l.stroke();
                            }
                            l.shadowBlur = 0;
                            for (let i = 0; i < 6; i++) brokenHalo(l, ...at((i / 6) * TAU + 0.3, 0.55), AR * 0.12, FAITHS[i % 5], 0.9, 10 + i, 3);
                            for (let i = 0; i < 10; i++) feather(s, l, ...at(r() * TAU, 0.35 + r() * 0.5), AR * 0.07, r() * TAU, 0.8);
                        },
                    }),
            },
            {
                label: "Loop: storm-cells of forgotten faiths churn into each other, crackling where they meet",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: [236, 214, 140],
                        mist: { hi: [0.95, 0.9, 0.78], ph: 0.4, storm: true },
                        edge: [1, 0.92, 0.7],
                        draw: (s, l) => divineLoop2(s, l, 0),
                    }),
            },
            {
                label: "Loop: tilted halos spin and shatter, light stabs down at angles, sigils and debris tumble",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: [236, 214, 140],
                        mist: { hi: [0.95, 0.9, 0.78], ph: 0.7, storm: true },
                        edge: [1, 0.92, 0.7],
                        seed: 4,
                        draw: (s, l) => {
                            divineLoop2(s, l, 1);
                            slantRay(l, ...at(0.6, 0.5), AR, 0.5, 1);
                            tiltedHalo(l, ...at(0.6, 0.5), AR * 0.16, 0.9, 0.4, FAITHS[0], 1, 99, 4);
                        },
                    }),
            },
        ],
    },

    arcane: {
        title: "Manifest Will (arcane) — The Library of Lost Spells",
        crop: [370, 130, 540, 540],
        frames: [
            {
                label: "Cast: torn pages tumble out of Finch, text spilling off them in every direction",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: [63, 127, 224],
                        mist: { density: 0.55, hi: [0.45, 0.6, 1.0] },
                        draw: (s, l) => {
                            const r = rng(8);
                            // Pages tumble out of Finch, text spilling off them in every direction
                            for (let i = 0; i < 6; i++) {
                                const a = (i / 6) * TAU + 0.3;
                                bentPage(s, l, ...at(a, 0.3 + (i % 2) * 0.16), AR * 0.22, a + 0.5, 0.5 + r() * 0.6, r() * TAU, 0.9, 20 + i);
                            }
                            chaoticText(s, r, 16, { inner: 0.2, outer: 0.85 });
                            const g = l.createRadialGradient(X, Y, 0, X, Y, AR * 0.35);
                            g.addColorStop(0, "rgba(190, 215, 255, 0.7)");
                            g.addColorStop(1, "rgba(120, 150, 255, 0)");
                            l.fillStyle = g;
                            l.fillRect(X - AR, Y - AR, AR * 2, AR * 2);
                        },
                    }),
            },
            {
                label: "Close-up: a page bends and flutters as it drifts, its writing glowing on it",
                draw: (ctx) => {
                    kit ??= new Kit();
                    ctx.fillStyle = "#14131c";
                    ctx.fillRect(0, 0, W, H);
                    const { s, l } = kit.begin();
                    [
                        [0.2, 0.3],
                        [0.9, 1.6],
                        [0.5, 3.3],
                    ].forEach(([bend, phase], i) => bentPage(s, l, 470 + i * 170, 400, 120, -0.15 + i * 0.12, bend, phase, 1, 33));
                    ctx.drawImage(kit.render({ haze: 0 }), 0, 0);
                    ctx.fillStyle = "#9a98c8";
                    ctx.font = "16px Inter";
                    ctx.textAlign = "center";
                    ["now", "a moment later", "later still"].forEach((t, i) => ctx.fillText(t, 470 + i * 170, 530));
                },
            },
            {
                label: "Loop: lost scripts of every size run across, around, snaking and spiralling, fading out mid-word",
                draw: (ctx) => auraFrame(ctx, { border: [63, 127, 224], mist: { hi: [0.45, 0.6, 1.0], ph: 0.3 }, draw: (s, l) => arcaneLoop2(s, l, 0) }),
            },
            {
                label: "Loop, moments later: other words surface; loose pages and a half-drawn diagram drift through",
                draw: (ctx) => auraFrame(ctx, { border: [63, 127, 224], mist: { hi: [0.45, 0.6, 1.0], ph: 0.65 }, seed: 5, draw: (s, l) => arcaneLoop2(s, l, 1) }),
            },
        ],
    },

    primal: {
        title: "Manifest Will (primal) — The Lands That Were Lost",
        crop: [370, 130, 540, 540],
        frames: [
            {
                label: "Cast: the ground ripples like a lifted curtain; mycelium races outward",
                draw: (ctx) =>
                    auraFrame(ctx, {
                        border: [79, 158, 58],
                        mist: { density: 0.5, hi: [0.4, 0.85, 0.75] },
                        edge: [0.5, 0.95, 0.8],
                        draw: (s, l) => {
                            for (let i = 0; i < 3; i++) ringPulse(l, X, Y, AR * (0.35 + i * 0.22), "#9df0d8", 0.6 - i * 0.15, 4);
                            for (let i = 0; i < 9; i++) mycelium(l, X, Y, ...at((i / 9) * TAU, 0.85 + (i % 2) * 0.1), 60 + i, 1);
                            const r = rng(12);
                            for (let i = 0; i < 8; i++) bellCap(s, l, ...at(r() * TAU, 0.25 + r() * 0.3), AR * 0.07, r() < 0.5 ? "#8a7dff" : "#5fd3c8");
                        },
                    }),
            },
            {
                label: "Loop: glimpses of lost lands fade in and out — fungal glade, old ruin, crystal cave, flowering vines",
                draw: (ctx) => auraFrame(ctx, { border: [79, 158, 58], mist: { hi: [0.4, 0.85, 0.75], ph: 0.3, density: 0.8 }, edge: [0.5, 0.95, 0.8], draw: (s, l) => primalLoop2(s, l, 0) }),
            },
            {
                label: "Loop, moments later: the lands swap places; mycelium tangles at their feet",
                draw: (ctx) => auraFrame(ctx, { border: [79, 158, 58], mist: { hi: [0.4, 0.85, 0.75], ph: 0.7, density: 0.8 }, edge: [0.5, 0.95, 0.8], seed: 6, draw: (s, l) => primalLoop2(s, l, 1) }),
            },
        ],
    },

    misery: {
        title: "Familiar of Ongoing Misery — Valet Points",
        crop: [260, 130, 600, 400],
        frames: [0, 4, 1, 2, 3].map((k) => ({
            label: {
                0: "Valet points; a dark wisp of magic gathers at his hand",
                4: "Close-up: tendrils unfurl and curl, draw back into the core, and new ones form",
                1: "It drifts lazily toward the victim, turning and twisting",
                2: "Contact: a silver control bar forms and its strings drop",
                3: "The tug: a pale, faceless face is drawn up out of them and dissolves",
            }[k],
            draw: (ctx) => miseryBoard(ctx, k),
        })),
    },

    charge: {
        title: "Designate Witch's Charge — A Light to Find Them By",
        crop: [150, 250, 800, 320],
        frames: [0, 1, 2, 3].map((k) => ({
            label: [
                "A warm mote of light kindles in Finch's hand",
                "It floats to the charge on a gentle arc, trailing a soft afterglow",
                "It settles on them, and its glow swells into a lantern-light around them",
                "A little of the light stays with them a moment, then fades",
            ][k],
            draw: (ctx) => chargeBoard(ctx, k),
        })),
    },
};

function ghostPage(s, l, x, y, size, rot, alpha, seed) {
    const r = rng(seed);
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    s.fillStyle = "#c8d3ee";
    s.fillRect(-size * 0.35, -size * 0.5, size * 0.7, size);
    s.strokeStyle = "#5a6690";
    s.lineWidth = 1.2;
    const style = Object.keys(SCRIPTS)[Math.floor(r() * 6)];
    for (let row = 0; row < 6; row++) {
        for (let c = 0; c < 5; c++) {
            if (r() < 0.2) continue;
            s.save();
            s.translate(-size * 0.25 + c * size * 0.12, -size * 0.32 + row * size * 0.14);
            drawScriptLetter(s, style, SCRIPTS[style](r), size * 0.08);
            s.restore();
        }
    }
    s.restore();
}

function divineLoop2(s, l, v) {
    const r = rng(40 + v);
    // Two great broken halos around the whole emanation, the clearest "this is holy" read, turning against each other
    tiltedHalo(l, X, Y, AR * 0.93, 0, 0, [255, 246, 220], 0.9, 70 + v, 5);
    tiltedHalo(l, X, Y, AR * 0.84, 0.5, 0.7 + v, [255, 236, 190], 0.55, 72 + v, 3);
    // Halos of every faith, tilted every which way, overlapping
    for (let i = 0; i < 9; i++) {
        const [hx, hy] = at(r() * TAU, r() * 0.7);
        tiltedHalo(l, hx, hy, AR * (0.08 + r() * 0.35), r() * 1.3, r() * TAU, FAITHS[i % 5], 0.4 + r() * 0.5, 80 + i + v * 10, 1.5 + r() * 3);
    }
    // Sigils of forgotten gods at every size and angle: some huge and ghostly, some small and bright
    for (let i = 0; i < 9; i++) {
        const [sx, sy] = at(r() * TAU, 0.15 + r() * 0.7);
        const big = r() < 0.3;
        s.save();
        s.globalAlpha = big ? 0.25 + r() * 0.2 : 0.45 + r() * 0.55;
        s.strokeStyle = `rgb(${FAITHS[i % 5].join(",")})`;
        s.translate(sx, sy);
        s.rotate(r() * TAU);
        drawSigil(s, 0, 0, AR * (big ? 0.45 + r() * 0.2 : 0.1 + r() * 0.12), i % 6);
        s.restore();
    }
    // Light stabbing down at a slant from more than one direction
    for (let i = 0; i < 2; i++) slantRay(l, ...at(r() * TAU, 0.2 + r() * 0.6), AR, (r() - 0.5) * 1.6, 0.6 + r() * 0.4);
    // Flung debris: embers, petals, sparks, feathers
    for (let i = 0; i < 22; i++) {
        const [dx, dy] = at(r() * TAU, r() * 0.85);
        debris(l, dx, dy, r() * TAU, AR * (0.08 + r() * 0.15), (r() - 0.5) * 2.5, FAITHS[Math.floor(r() * 5)], 0.5 + r() * 0.5);
    }
    for (let i = 0; i < 6; i++) feather(s, l, ...at(r() * TAU, 0.2 + r() * 0.7), AR * 0.06, r() * TAU, 0.3 + r() * 0.6);
    trinkets(s, X, Y, AR, 90 + v, 4);
}

const STYLES = ["fey", ...Object.keys(SCRIPTS)];

/** Runs of text in every script, size and path: straight across, round, snaking, spiralling */
function chaoticText(s, r, n, { inner = 0.12, outer = 0.88 } = {}) {
    for (let i = 0; i < n; i++) {
        const style = STYLES[Math.floor(r() * STYLES.length)];
        const kind = ["line", "snake", "arc", "spiral", "snake", "arc"][Math.floor(r() * 6)];
        const h = AR * (0.035 + r() * r() * 0.09);
        const [cx, cy] = at(r() * TAU, inner + r() * (outer - inner) * 0.7);
        let path;
        let len;
        if (kind === "line") {
            len = AR * (0.3 + r() * 0.5);
            path = PATHS.line(cx, cy, len, r() * TAU);
        } else if (kind === "snake") {
            len = AR * (0.4 + r() * 0.6);
            path = PATHS.snake(cx, cy, len, r() * TAU, AR * (0.03 + r() * 0.07), 1 + r() * 2);
        } else if (kind === "arc") {
            const rad = AR * (inner + r() * (outer - inner));
            const span = (0.5 + r() * 1.5) * (r() < 0.5 ? 1 : -1);
            len = rad * Math.abs(span);
            path = PATHS.arc(X, Y, rad, r() * TAU, span);
        } else {
            len = AR * 1.2;
            path = PATHS.spiral(cx, cy, AR * 0.03, AR * (0.12 + r() * 0.15), r() * TAU, 1.2);
        }
        const count = Math.max(3, Math.min(22, Math.floor(len / (h * (style === "fey" ? 0.5 : 0.75)))));
        const alpha = r() < 0.3 ? 0.15 + r() * 0.2 : 0.45 + r() * 0.55;
        scriptRun(s, style, path, count, h, alpha, r, r() < 0.3 ? "#b8ccff" : "#e2ebff");
    }
}

function arcaneLoop2(s, l, v) {
    const r = rng(60 + v);
    silverRings(s, l, X, Y, AR, { inner: 0 });
    chaoticText(s, r, 26);
    // A half-drawn spell diagram ghosting through
    l.save();
    l.strokeStyle = "rgba(170, 200, 255, 0.55)";
    l.lineWidth = 1.5;
    l.shadowColor = "rgba(120, 160, 255, 1)";
    l.shadowBlur = 8;
    const [dx, dy] = at(v ? 2.4 : -0.9, 0.45);
    l.beginPath();
    l.arc(dx, dy, AR * 0.17, 0, TAU * 0.7);
    l.stroke();
    l.save();
    l.translate(dx, dy);
    polygonPartial(l, 3, AR * 0.17, 0.6);
    polygonPartial(l, 5, AR * 0.1, 0.8);
    l.restore();
    l.restore();
    bentPage(s, l, ...at(v ? -0.5 : 2.0, 0.6), AR * 0.24, v ? 0.5 : -0.4, 0.8, v ? 2.2 : 0.6, 0.85, 77 + v);
    bentPage(s, l, ...at(v ? 2.6 : 0.6, 0.35), AR * 0.2, v ? -1.1 : 1.3, 0.6, v ? 4.0 : 1.5, 0.45, 78 + v);
    trinkets(s, X, Y, AR, 70 + v, 4);
    starfield(l, X, Y, AR, 75 + v, 50);
}

function primalLoop2(s, l, v) {
    const layouts = [
        [
            ["fungi", -0.5, -0.2, 0.3, 0.9],
            ["ruin", 0.42, -0.42, 0.27, 0.65],
            ["crystal", 0.45, 0.4, 0.25, 0.4],
            ["vines", -0.25, 0.55, 0.26, 0.8],
        ],
        [
            ["crystal", -0.45, -0.3, 0.28, 0.85],
            ["fungi", 0.4, 0.38, 0.3, 0.75],
            ["vines", 0.42, -0.45, 0.25, 0.35],
            ["ruin", -0.3, 0.55, 0.26, 0.6],
        ],
    ][v];
    for (const [kind, px, py, rad, alpha] of layouts) terrainPatch(s, l, kind, X + px * AR, Y + py * AR, rad * AR, 100 + px * 10 + v, alpha);
    // Mycelium joins the patches and creeps to creatures' feet
    for (let i = 0; i < layouts.length; i++) {
        const [, ax, ay] = layouts[i];
        const [, bx, by] = layouts[(i + 1) % layouts.length];
        mycelium(l, X + ax * AR, Y + ay * AR, X + bx * AR, Y + by * AR, 200 + i + v * 5, 0.8);
    }
    for (const [[tx, ty]] of AURA_TOKENS().slice(0, 3)) {
        mycelium(l, X + layouts[0][1] * AR, Y + layouts[0][2] * AR, tx, ty + 30, 300 + tx, 0.6);
        ringPulse(l, tx, ty + 6, 30, "#7fe8c8", 0.35, 2);
    }
    trinkets(s, X, Y, AR, 110 + v, 4);
    starfield(l, X, Y, AR, 115 + v, 40);
}

const MV = [350, 450];
const ME = [750, 390];
function miseryBoard(ctx, k) {
    if (k === 4) {
        // Three moments of the wisp, enlarged, a second apart
        kit ??= new Kit();
        ctx.fillStyle = "#14131c";
        ctx.fillRect(0, 0, W, H);
        const { s, l } = kit.begin();
        [0, 0.8, 1.6].forEach((t, i) => livingWisp(l, 380 + i * 200, 330, 34, t));
        ctx.drawImage(kit.render({ haze: 0 }), 0, 0);
        ctx.fillStyle = "#9a98c8";
        ctx.font = "16px Inter";
        ctx.textAlign = "center";
        ["now", "a moment later", "later still"].forEach((t, i) => ctx.fillText(t, 380 + i * 200, 470));
        return;
    }
    overFrame(ctx, [
        [MV, VALET],
        [ME, ENEMY],
    ], (s, l) => {
        const hand = [MV[0] + 40, MV[1] - 22];
        const target = [ME[0], ME[1] - 55];
        if (k === 0) {
            livingWisp(l, ...hand, 15, 0.4, 0.9);
            ringPulse(l, ...MV, 52, "#7a72f0", 0.5, 2);
        }
        if (k === 1) {
            // A soft ribbon trail, widening and brightening toward the wisp
            l.save();
            l.lineCap = "round";
            l.shadowColor = "rgba(110, 100, 255, 1)";
            l.shadowBlur = 14;
            for (let i = 0; i < 40; i++) {
                const s0 = (i / 40) * 0.55;
                const s1 = ((i + 1) / 40) * 0.55;
                l.strokeStyle = `rgba(110, 100, 240, ${0.05 + 0.4 * (i / 40)})`;
                l.lineWidth = 2 + 8 * (i / 40);
                l.beginPath();
                l.moveTo(...wispPath(...hand, ...target, s0));
                l.lineTo(...wispPath(...hand, ...target, s1));
                l.stroke();
            }
            l.restore();
            livingWisp(l, ...wispPath(...hand, ...target, 0.55), 16, 1.3);
        }
        if (k >= 2) {
            const r = 44;
            const barY = ME[1] - r * (k === 3 ? 2.9 : 1.9);
            const barW = r * 1.9;
            if (k === 2) {
                ringPulse(l, ...target, 40, "#a9a2ff", 0.9, 4);
                livingWisp(l, ...target, 16, 2.2, 0.6);
            }
            // strings
            const anchors = [[0, -0.55], [-0.62, -0.1], [0.62, -0.1], [-0.32, 0.55], [0.32, 0.55]];
            const tips = [[0, -0.25], [-0.5, 0], [0.5, 0], [-0.22, 0.32], [0.22, 0.32]];
            l.save();
            l.lineWidth = k === 3 ? 1.6 : 1.1;
            l.strokeStyle = k === 3 ? "rgba(235, 238, 255, 0.95)" : "rgba(190, 190, 255, 0.85)";
            l.shadowColor = "rgba(140, 130, 255, 1)";
            l.shadowBlur = 8;
            anchors.forEach(([ax, ay], i) => {
                l.beginPath();
                l.moveTo(ME[0] + tips[i][0] * barW, barY + tips[i][1] * barW);
                const endY = k === 3 ? ME[1] - r * 1.35 + ay * r * 0.7 : ME[1] + ay * r;
                l.lineTo(ME[0] + ax * (k === 3 ? r * 0.65 : r), k === 2 ? lerp(barY, endY, 0.8 + i * 0.04) : endY);
                l.stroke();
            });
            l.restore();
            // the silver control bar
            s.save();
            s.translate(ME[0], barY);
            s.lineCap = "round";
            s.strokeStyle = "#cfd5e6";
            s.lineWidth = r * 0.15;
            s.beginPath();
            s.moveTo(-barW * 0.5, 0);
            s.lineTo(barW * 0.5, 0);
            s.moveTo(0, -barW * 0.25);
            s.lineTo(0, barW * 0.36);
            s.moveTo(-barW * 0.22, barW * 0.32);
            s.lineTo(barW * 0.22, barW * 0.32);
            s.stroke();
            s.strokeStyle = "#8d96ad";
            s.lineWidth = r * 0.04;
            s.stroke();
            s.restore();
            l.save();
            l.shadowColor = "rgba(160, 150, 255, 1)";
            l.shadowBlur = 16;
            l.strokeStyle = "rgba(170, 160, 255, 0.5)";
            l.lineWidth = r * 0.2;
            l.beginPath();
            l.moveTo(ME[0] - barW * 0.5, barY);
            l.lineTo(ME[0] + barW * 0.5, barY);
            l.stroke();
            l.restore();
            if (k === 3) {
                // the stolen face: pale and featureless, rising on the strings, already half gone
                s.save();
                s.globalAlpha = 0.62;
                s.translate(ME[0], ME[1] - r * 1.35);
                s.beginPath();
                s.ellipse(0, 0, r * 0.45, r * 0.6, 0, 0, TAU);
                const g = s.createLinearGradient(0, -r * 0.55, 0, r * 0.55);
                g.addColorStop(0, "#f3f4fb");
                g.addColorStop(1, "#a6addb");
                s.fillStyle = g;
                s.fill();
                s.restore();
                const fg = l.createRadialGradient(ME[0], ME[1] - r * 1.35, 0, ME[0], ME[1] - r * 1.35, r);
                fg.addColorStop(0, "rgba(160, 160, 255, 0.45)");
                fg.addColorStop(1, "rgba(160, 160, 255, 0)");
                l.fillStyle = fg;
                l.beginPath();
                l.arc(ME[0], ME[1] - r * 1.35, r, 0, TAU);
                l.fill();
                ringPulse(l, ...ME, r * 1.3, "#7a72f0", 0.6, 3);
                const rr = rng(3);
                for (let i = 0; i < 14; i++) mote(l, ME[0] + (rr() - 0.5) * r * 1.2, ME[1] - r * (0.8 + rr() * 0.9), 1.6, "#d8defe", 0.8);
            }
        }
    }, { edge: [0.55, 0.55, 1.0] });
}

const CW = [250, 410];
const CC = [850, 410];
function chargeBoard(ctx, k) {
    overFrame(ctx, [
        [CW, FINCH],
        [CC, ALLY],
    ], (s, l) => {
        const hand = [CW[0] + 30, CW[1] - 30];
        const path = (t) => [lerp(hand[0], CC[0], t), lerp(hand[1], CC[1] - 30, t) - Math.sin(Math.PI * t) * 70];
        if (k === 0) kindMote(l, hand[0] + 8, hand[1] - 10, 8, 1);
        if (k === 1) {
            // A soft ribbon of afterglow behind it
            l.save();
            l.lineCap = "round";
            for (let i = 0; i < 40; i++) {
                const t0 = (i / 40) * 0.5;
                const t1 = ((i + 1) / 40) * 0.5;
                l.strokeStyle = `rgba(255, 238, 205, ${0.03 + 0.3 * (i / 40)})`;
                l.lineWidth = 2 + 7 * (i / 40);
                l.beginPath();
                l.moveTo(...path(t0));
                l.lineTo(...path(t1));
                l.stroke();
            }
            l.restore();
            kindMote(l, ...path(0.5), 9, 1);
        }
        if (k === 2) {
            const g = l.createRadialGradient(CC[0], CC[1], 10, CC[0], CC[1], 115);
            g.addColorStop(0, "rgba(255, 244, 220, 0.45)");
            g.addColorStop(0.5, "rgba(255, 230, 190, 0.16)");
            g.addColorStop(1, "rgba(255, 230, 190, 0)");
            l.fillStyle = g;
            l.beginPath();
            l.arc(...CC, 115, 0, TAU);
            l.fill();
            ringPulse(l, ...CC, 52, "#fff2da", 0.6, 3);
            kindMote(l, CC[0], CC[1] - 46, 9, 1);
        }
        if (k === 3) {
            ringPulse(l, ...CC, 50, "#f5e8d0", 0.3, 2);
            kindMote(l, CC[0] + 34, CC[1] - 34, 6, 0.55);
        }
    }, { edge: [1, 0.92, 0.8] });
}

for (const [name, board] of Object.entries(BOARDS)) {
    board.frames.forEach((f, i) => {
        SCENES[`board-${name}-${i}`] = { duration: 1, draw: f.draw };
    });
}
