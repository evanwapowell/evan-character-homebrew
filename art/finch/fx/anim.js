/* The full animations. Every loop is a function of its phase ph in [0, 1) with whole-number cycles, so it repeats
 * seamlessly; each cast is a function of seconds. Drawn with the kit (kit.js) and the motifs (lost.js). */

const fr = (x) => ((x % 1) + 1) % 1;
const smooth = (t) => t * t * (3 - 2 * t);
/** Where an element is in its own cycle */
const cyc = (ph, off, k = 1) => fr(ph * k + off);
/** Surface, hold, sink: 0 → 1 → 0 over a cycle */
const win = (u, a = 0.25, b = 0.7) => smooth(clamp(u / a)) * (1 - smooth(clamp((u - b) / (1 - b))));
const LOOP = 8;

function ringArc(s, l, cx, cy, R, rad, a0, a1, width, color, glow) {
    s.save();
    s.strokeStyle = color;
    s.lineWidth = width;
    s.beginPath();
    s.arc(cx, cy, R * rad, a0, a1);
    s.stroke();
    s.restore();
    if (glow) {
        l.save();
        l.strokeStyle = glow;
        l.lineWidth = width * 4;
        l.filter = "blur(5px)";
        l.beginPath();
        l.arc(cx, cy, R * rad, a0, a1);
        l.stroke();
        l.restore();
    }
}

/** Silver rings with ticks, turning by rot */
function silverRingsTurning(s, l, rot, alpha = 1, inner = 0.66) {
    s.save();
    s.translate(X, Y);
    s.rotate(rot);
    s.translate(-X, -Y);
    silverRings(s, l, X, Y, AR, { alpha, inner });
    s.restore();
}

function twinkles(l, seed, ph, n = 90, color = S_.lilac) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
        const a = r() * TAU;
        const rad = AR * Math.sqrt(r()) * 0.95;
        const big = r() < 0.08;
        const k = 1 + Math.floor(r() * 3);
        const tw = 0.5 + 0.5 * Math.sin(TAU * (ph * k + r()));
        sparkle(l, X + Math.cos(a) * rad, Y + Math.sin(a) * rad, (big ? 5 + r() * 4 : 1.2 + r() * 1.5) * (0.6 + 0.4 * tw), r() < 0.2 ? S_.silver : color, (0.3 + 0.7 * tw) * (0.5 + r() * 0.5));
    }
}

/** Lost trinkets: each surfaces somewhere, drifts a little, and sinks away again */
function trinketsDrifting(s, seed, ph, n = 6) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
        const off = r();
        const a = r() * TAU;
        const rad = 0.28 + r() * 0.55;
        const dir = r() * TAU;
        const rot0 = r() * TAU;
        const u = cyc(ph, off);
        const al = win(u, 0.3, 0.6) * 0.95;
        if (al < 0.01) continue;
        const [px, py] = at(a, rad);
        s.save();
        s.globalAlpha = al;
        drawTrinket(s, px + Math.cos(dir) * u * AR * 0.12, py + Math.sin(dir) * u * AR * 0.12, AR * 0.075, TRINKETS[i % TRINKETS.length], rot0 + u * 1.4);
        s.restore();
    }
}

/* =========================================== Occult: the Masquerade of Lost Faces ================================= */

function occultLoopHQ(s, l, ph) {
    silverRingsTurning(s, l, ph * (TAU / 4));
    // Fey words, each fading in and out in its own time
    const r = rng(707);
    s.save();
    s.strokeStyle = s.fillStyle = "#c9d0ff";
    s.lineWidth = AR * 0.008;
    s.lineCap = "round";
    s.lineJoin = "round";
    for (let w = 0; w < 12; w++) {
        const n = 3 + Math.floor(r() * 4);
        const letters = Array.from({ length: n }, () => feyLetter(r));
        const off = r();
        s.globalAlpha = 0.25 + 0.75 * win(cyc(ph, off), 0.3, 0.6);
        textArc(s, X, Y, AR * 0.84, (w / 12) * TAU, letters, AR * 0.085, drawFeyLetter, { spacing: 0.48, swash: true });
    }
    s.restore();
    // Lost faces surfacing from the mist and sinking back; the King is one of them
    const exprs = ["calm", "joy", "grief", "fear", "longing", "joy", "grief"];
    for (let i = 0; i < 7; i++) {
        const u = cyc(ph, (i * 3) / 7 + 0.05);
        const al = win(u, 0.3, 0.55);
        if (al < 0.01) continue;
        const a = -Math.PI / 2 + (i / 7) * TAU + 0.06 * Math.sin(TAU * ph + i);
        const rad = 0.5 + 0.06 * Math.sin(i * 2.3) + 0.04 * (u - 0.5);
        drawFace(s, l, ...at(a, rad), AR * 0.15, exprs[i], { alpha: al, crown: i === 0, tilt: 0.15 * Math.sin(TAU * ph + i * 1.7) });
    }
    trinketsDrifting(s, 50, ph);
    twinkles(l, 30, ph);
    // Silver motes drifting outward
    const mr = rng(31);
    for (let i = 0; i < 40; i++) {
        const u = cyc(ph, mr(), 1 + Math.floor(mr() * 2));
        const a = mr() * TAU + u * 0.6;
        mote(l, ...at(a, lerp(0.2, 0.95, u)), 1.2 + mr() * 1.4, S_.lilac, Math.sin(Math.PI * u) * 0.8);
    }
}

function occultCastHQ(s, l, t) {
    const f = Math.sin(Math.PI * seg(t, 0, 0.7));
    if (f > 0) {
        const g = l.createRadialGradient(X, Y, 0, X, Y, AR * (0.3 + 0.4 * seg(t, 0, 0.7)));
        g.addColorStop(0, `rgba(210, 215, 255, ${0.75 * f})`);
        g.addColorStop(1, "rgba(120, 110, 255, 0)");
        l.fillStyle = g;
        l.fillRect(X - AR, Y - AR, AR * 2, AR * 2);
    }
    // A rush of faces spiralling out of Finch
    const exprs = ["joy", "grief", "fear", "longing", "calm", "joy", "grief", "fear", "longing"];
    for (let i = 0; i < 9; i++) {
        const d = i * 0.04;
        const u = easeOut(seg(t, 0.08 + d, 0.95 + d));
        const al = seg(t, 0.08 + d, 0.3 + d) * (1 - seg(t, 1.0 + d, 1.6 + d));
        if (al <= 0) continue;
        const a = (i / 9) * TAU + 0.4 - (1 - u) * 2.2;
        const rad = 0.1 + 0.5 * u;
        for (let k = 1; k < 6; k++) {
            const uk = Math.max(0, u - k * 0.05);
            const ak = (i / 9) * TAU + 0.4 - (1 - uk) * 2.2;
            sparkle(l, ...at(ak, 0.1 + 0.5 * uk), 3 * (1 - k / 6), S_.lilac, al * (1 - k / 6));
        }
        drawFace(s, l, ...at(a, rad), AR * (0.07 + 0.08 * u), exprs[i], { alpha: al, tilt: a });
    }
    // The silver rings and fey runes etch in behind a front sweeping clockwise from the top
    const sweep = seg(t, 0.75, 1.45);
    const out = 1 - seg(t, 1.6, 2.3);
    if (sweep > 0 && out > 0) {
        s.save();
        s.globalAlpha = out;
        const a0 = -Math.PI / 2;
        const a1 = a0 + sweep * TAU;
        for (const rr of [0.955, 0.925]) ringArc(s, l, X, Y, AR, rr, a0, a1, 2.2, "#ffffff", "rgba(200, 210, 255, 0.6)");
        feyBand(s, l, X, Y, AR, 7, { fades: false, sweep });
        s.restore();
        if (sweep < 1) sparkle(l, ...at(a1, 0.9), 24, "#ffffff", 1, t * 4);
    }
    const w = seg(t, 0.95, 1.55);
    if (w > 0 && w < 1) {
        ringPulse(l, X, Y, AR * (0.45 + 0.5 * easeOut(w)), "#e6e9ff", (1 - w) * 0.9, 5);
        ringPulse(l, X, Y, AR * (0.3 + 0.6 * easeOut(w)), "#7a72f0", (1 - w) * 0.7, 3);
    }
}

/* ========================================== Divine: Requiem of Forgotten Gods ===================================== */

function divineLoopHQ(s, l, ph) {
    const r = rng(404);
    // The two great halos, turning against each other: the "this is holy" read
    tiltedHalo(l, X, Y, AR * 0.93, 0, ph * TAU, [255, 246, 220], 0.85, 70, 5);
    tiltedHalo(l, X, Y, AR * 0.85, 0.45 + 0.1 * Math.sin(TAU * ph), -ph * TAU + 0.7, [255, 236, 190], 0.55, 72, 3);
    // Halos of every faith, tilted every which way, spinning up and shattering
    for (let i = 0; i < 10; i++) {
        const off = r();
        const [hx, hy] = at(r() * TAU, r() * 0.7);
        const rad = AR * (0.08 + r() * 0.33);
        const tilt0 = r() * 1.3;
        const rot0 = r() * TAU;
        const spin = (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2));
        const u = cyc(ph, off);
        const al = win(u, 0.2, 0.6);
        if (al < 0.01) continue;
        tiltedHalo(l, hx, hy, rad * (1 + 0.2 * u), tilt0 + 0.3 * Math.sin(TAU * u), rot0 + spin * u * TAU * 0.5, FAITHS[i % 5], al * (0.5 + 0.4 * r()), 80 + i, 1.5 + r() * 3);
    }
    // Sigils of forgotten gods surfacing at every size and angle
    for (let i = 0; i < 9; i++) {
        const off = r();
        const [sx, sy] = at(r() * TAU, 0.15 + r() * 0.7);
        const big = r() < 0.3;
        const size = AR * (big ? 0.45 + r() * 0.2 : 0.1 + r() * 0.12);
        const rot0 = r() * TAU;
        const u = cyc(ph, off);
        const al = win(u, 0.3, 0.6) * (big ? 0.35 : 0.95);
        if (al < 0.01) continue;
        s.save();
        s.globalAlpha = al;
        s.strokeStyle = `rgb(${FAITHS[i % 5].join(",")})`;
        s.translate(sx, sy);
        s.rotate(rot0 + u * (big ? 0.3 : 1.2));
        drawSigil(s, 0, 0, size, i % 6);
        s.restore();
    }
    // Light stabbing down at a slant, now here, now there
    for (let i = 0; i < 4; i++) {
        const off = r();
        const [rx, ry] = at(r() * TAU, 0.2 + r() * 0.6);
        const ang = (r() - 0.5) * 1.6;
        const u = cyc(ph, off);
        const al = smooth(clamp(u / 0.08)) * (1 - smooth(clamp((u - 0.08) / 0.3)));
        if (al > 0.01) slantRay(l, rx, ry, AR, ang, al);
    }
    // Flung debris: embers, petals, sparks
    for (let i = 0; i < 34; i++) {
        const off = r();
        const [dx, dy] = at(r() * TAU, r() * 0.8);
        const ang = r() * TAU;
        const len = AR * (0.12 + r() * 0.2);
        const curve = (r() - 0.5) * 2.5;
        const rgb = FAITHS[Math.floor(r() * 5)];
        const u = cyc(ph, off, 2);
        const al = Math.sin(Math.PI * u);
        const p = (q) => [dx + Math.cos(ang + curve * q) * len * q, dy + Math.sin(ang + curve * q) * len * q];
        const [hx, hy] = p(u);
        const [tx, ty] = p(Math.max(0, u - 0.18));
        l.save();
        l.strokeStyle = `rgba(${rgb.join(",")}, ${al})`;
        l.lineWidth = 2;
        l.lineCap = "round";
        l.beginPath();
        l.moveTo(tx, ty);
        l.lineTo(hx, hy);
        l.stroke();
        l.restore();
        sparkle(l, hx, hy, 2.5, `rgb(${rgb.join(",")})`, al);
    }
    for (let i = 0; i < 8; i++) {
        const off = r();
        const [fx, fy] = at(r() * TAU, 0.2 + r() * 0.65);
        const u = cyc(ph, off);
        feather(s, l, fx + Math.sin(TAU * u) * 10, fy - u * AR * 0.12, AR * 0.06, r() * TAU + Math.sin(TAU * u) * 0.8, win(u, 0.25, 0.6) * 0.85);
    }
    trinketsDrifting(s, 90, ph, 4);
}

function divineCastHQ(s, l, t) {
    const f = Math.sin(Math.PI * seg(t, 0, 0.8));
    if (f > 0) {
        const g = l.createRadialGradient(X, Y, 0, X, Y, AR * 0.7);
        g.addColorStop(0, `rgba(255, 250, 230, ${f})`);
        g.addColorStop(0.3, `rgba(255, 230, 170, ${0.5 * f})`);
        g.addColorStop(1, "rgba(255, 230, 170, 0)");
        l.fillStyle = g;
        l.fillRect(X - AR, Y - AR, AR * 2, AR * 2);
    }
    // Cracks of holy light racing out
    const crack = easeOut(seg(t, 0.1, 0.6));
    const cf = 1 - seg(t, 0.7, 1.3);
    if (crack > 0 && cf > 0) {
        const r = rng(4);
        l.save();
        l.strokeStyle = `rgba(255, 248, 225, ${0.95 * cf})`;
        l.shadowColor = "rgba(255, 230, 170, 1)";
        l.shadowBlur = 12;
        l.lineWidth = 2.5;
        for (let i = 0; i < 11; i++) {
            let a = (i / 11) * TAU + r() * 0.3;
            let rad = AR * 0.1;
            l.beginPath();
            l.moveTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad);
            const steps = Math.ceil(6 * crack);
            for (let k = 0; k < steps; k++) {
                a += (r() - 0.5) * 0.4;
                rad += AR * (0.07 + r() * 0.06);
                l.lineTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad);
            }
            l.stroke();
        }
        l.restore();
    }
    // Shattered halos bursting outward
    for (let i = 0; i < 7; i++) {
        const u = easeOut(seg(t, 0.2, 1.3));
        const al = seg(t, 0.2, 0.35) * (1 - seg(t, 1.0, 1.7));
        if (al <= 0) continue;
        tiltedHalo(l, ...at((i / 7) * TAU + 0.3, 0.15 + 0.5 * u), AR * (0.06 + 0.08 * u), 0.3 + i * 0.15, i + u, FAITHS[i % 5], al, 10 + i, 3);
    }
    const r = rng(9);
    for (let i = 0; i < 14; i++) {
        const a = r() * TAU;
        const u = easeOut(seg(t, 0.3 + r() * 0.2, 1.5));
        feather(s, l, ...at(a, 0.15 + 0.6 * u), AR * 0.06, a + u * 3, (1 - seg(t, 1.2, 2.0)) * seg(t, 0.3, 0.45));
    }
    const w = seg(t, 0.4, 1.1);
    if (w > 0 && w < 1) ringPulse(l, X, Y, AR * (0.3 + 0.65 * easeOut(w)), "#fff4d8", 1 - w, 6);
}

/* ========================================== Arcane: the Library of Lost Spells ==================================== */

/** A run of script on a path whose letters fade in like ink and fade out mid-word, letter by letter */
function inkRun(s, style, path, letters, h, u, color) {
    s.save();
    s.strokeStyle = s.fillStyle = color;
    s.lineWidth = Math.max(1.1, h * 0.1);
    s.lineCap = "round";
    s.lineJoin = "round";
    const n = letters.length;
    const draw = style === "fey" ? (c, L, hh) => drawFeyLetter(c, L, hh) : (c, L, hh) => drawScriptLetter(c, style, L, hh);
    let i = 0;
    textPath(s, path, letters, h, (c, L, hh) => {
        // ink arrives left to right and leaves left to right
        const k = i++ / Math.max(1, n - 1);
        const a = smooth(clamp((u - k * 0.2) / 0.15)) * (1 - smooth(clamp((u - 0.55 - k * 0.25) / 0.15)));
        if (a < 0.01) return;
        c.globalAlpha = a;
        draw(c, L, hh);
    }, { spacing: style === "fey" ? 0.5 : 0.75 });
    s.restore();
}

/** The runs: fixed per seed, each with its own path, script, size, colour, cycle offset and a slow drift */
function arcaneRuns(seed, n, inner = 0.12, outer = 0.88) {
    const r = rng(seed);
    return Array.from({ length: n }, () => {
        const style = STYLES[Math.floor(r() * STYLES.length)];
        const kind = ["line", "snake", "arc", "spiral", "snake", "arc"][Math.floor(r() * 6)];
        const h = AR * (0.035 + r() * r() * 0.09);
        const c = at(r() * TAU, inner + r() * (outer - inner) * 0.7);
        const ang = r() * TAU;
        const len = AR * (0.35 + r() * 0.55);
        const amp = AR * (0.03 + r() * 0.07);
        const waves = 1 + r() * 2;
        const rad = AR * (inner + r() * (outer - inner));
        const span = (0.5 + r() * 1.5) * (r() < 0.5 ? 1 : -1);
        const a0 = r() * TAU;
        const rr = rng(Math.floor(r() * 1e9));
        const count = 12;
        const letters = Array.from({ length: count }, () => (style === "fey" ? feyLetter(rr) : SCRIPTS[style](rr)));
        return { style, kind, h, c, ang, len, amp, waves, rad, span, a0, letters, off: r(), drift: (r() - 0.5) * 0.25, color: r() < 0.3 ? "#b8ccff" : "#e2ebff" };
    });
}
const ARCANE_RUNS = arcaneRuns(606, 24);

function runPath(R0, u) {
    const d = R0.drift * u;
    if (R0.kind === "line") return PATHS.line(R0.c[0], R0.c[1], R0.len, R0.ang + d);
    if (R0.kind === "snake") return PATHS.snake(R0.c[0], R0.c[1], R0.len, R0.ang + d, R0.amp, R0.waves);
    if (R0.kind === "arc") return PATHS.arc(X, Y, R0.rad, R0.a0 + d * 2, R0.span);
    return PATHS.spiral(R0.c[0], R0.c[1], AR * 0.03, AR * 0.2, R0.a0 + d * 3, 1.2);
}

function arcaneLoopHQ(s, l, ph) {
    silverRingsTurning(s, l, ph * (TAU / 4), 1, 0);
    for (const R0 of ARCANE_RUNS) {
        const u = cyc(ph, R0.off);
        // fit the run's letters to its path's length
        const pathLen = R0.kind === "arc" ? R0.rad * Math.abs(R0.span) : R0.kind === "spiral" ? AR * 0.9 : R0.len;
        const n = Math.max(3, Math.min(12, Math.floor(pathLen / (R0.h * (R0.style === "fey" ? 0.5 : 0.75)))));
        inkRun(s, R0.style, runPath(R0, u), R0.letters.slice(0, n), R0.h, u, R0.color);
    }
    // Pages fluttering through, bending as they go
    const pr = rng(808);
    for (let i = 0; i < 3; i++) {
        const off = pr();
        const a = pr() * TAU;
        const dir = pr() * TAU;
        const seedP = 77 + i;
        const u = cyc(ph, off);
        const al = win(u, 0.25, 0.65) * 0.9;
        if (al < 0.01) continue;
        const [px, py] = at(a, 0.3 + pr() * 0.4);
        bentPage(s, l, px + Math.cos(dir) * u * AR * 0.25, py + Math.sin(dir) * u * AR * 0.25, AR * (0.2 + 0.04 * i), dir + Math.sin(TAU * u) * 0.4, 0.45 + 0.4 * Math.sin(TAU * (ph * 3 + off)), TAU * (ph * 4 + off), al, seedP);
    }
    // A spell diagram drawing itself and fading half-finished
    const du = cyc(ph, 0.4);
    const dal = win(du, 0.1, 0.6);
    if (dal > 0.01) {
        const [dx, dy] = at(-0.9, 0.45);
        const p = clamp(du / 0.6);
        l.save();
        l.strokeStyle = `rgba(170, 200, 255, ${0.6 * dal})`;
        l.lineWidth = 1.5;
        l.shadowColor = "rgba(120, 160, 255, 1)";
        l.shadowBlur = 8;
        l.beginPath();
        l.arc(dx, dy, AR * 0.17, -Math.PI / 2, -Math.PI / 2 + TAU * 0.75 * p);
        l.stroke();
        l.translate(dx, dy);
        polygonPartial(l, 3, AR * 0.17, 0.7 * p);
        polygonPartial(l, 5, AR * 0.1, 0.85 * p);
        l.restore();
    }
    trinketsDrifting(s, 70, ph, 4);
    twinkles(l, 75, ph, 50, "#cfe0ff");
}

function arcaneCastHQ(s, l, t) {
    const f = Math.sin(Math.PI * seg(t, 0, 0.7));
    if (f > 0) {
        const g = l.createRadialGradient(X, Y, 0, X, Y, AR * 0.45);
        g.addColorStop(0, `rgba(190, 215, 255, ${0.8 * f})`);
        g.addColorStop(1, "rgba(120, 150, 255, 0)");
        l.fillStyle = g;
        l.fillRect(X - AR, Y - AR, AR * 2, AR * 2);
    }
    // Pages tumble out of Finch, fluttering
    for (let i = 0; i < 7; i++) {
        const d = i * 0.05;
        const u = easeOut(seg(t, 0.1 + d, 1.2 + d));
        const al = seg(t, 0.1 + d, 0.3 + d) * (1 - seg(t, 1.3 + d, 1.9 + d));
        if (al <= 0) continue;
        const a = (i / 7) * TAU + 0.3 + u * 0.5;
        bentPage(s, l, ...at(a, 0.1 + 0.55 * u), AR * (0.12 + 0.1 * u), a + u * 2.5, 0.4 + 0.5 * Math.sin(t * 9 + i), t * 12 + i, al, 20 + i);
    }
    // Text spilling off them in every direction
    const runs = arcaneRuns(909, 14, 0.2, 0.85);
    runs.forEach((R0, i) => {
        const u = clamp((t - 0.5 - i * 0.03) / 1.6) * 0.75;
        if (u <= 0) return;
        const pathLen = R0.kind === "arc" ? R0.rad * Math.abs(R0.span) : R0.kind === "spiral" ? AR * 0.9 : R0.len;
        const n = Math.max(3, Math.min(12, Math.floor(pathLen / (R0.h * 0.7))));
        inkRun(s, R0.style, runPath(R0, 0), R0.letters.slice(0, n), R0.h, u, "#e8efff");
    });
    const w = seg(t, 0.6, 1.3);
    if (w > 0 && w < 1) ringPulse(l, X, Y, AR * (0.3 + 0.65 * easeOut(w)), "#cfe0ff", 1 - w, 5);
}

/* ============================================ Primal: the Lands That Were Lost ==================================== */

const LANDS = [
    ["fungi", -0.5, -0.2, 0.3, 0.0],
    ["ruin", 0.42, -0.42, 0.27, 0.17],
    ["crystal", 0.45, 0.4, 0.25, 0.34],
    ["vines", -0.25, 0.55, 0.26, 0.5],
    ["crystal", -0.48, 0.25, 0.24, 0.67],
    ["fungi", 0.15, -0.6, 0.26, 0.83],
];

/** Precomputed mycelium threads between pairs of lands */
const THREADS = (() => {
    const r = rng(515);
    const out = [];
    for (let i = 0; i < LANDS.length; i++) {
        for (const j of [(i + 1) % LANDS.length, (i + 2) % LANDS.length]) {
            const [, ax, ay] = LANDS[i];
            const [, bx, by] = LANDS[j];
            const pts = [];
            for (let k = 0; k <= 24; k++) {
                const t = k / 24;
                const wob = Math.sin(Math.PI * t) * 18;
                pts.push([X + lerp(ax, bx, t) * AR + (r() - 0.5) * wob, Y + lerp(ay, by, t) * AR + (r() - 0.5) * wob]);
            }
            out.push({ i, j, pts, off: r() });
        }
    }
    return out;
})();

function landAlpha(ph, k) {
    return win(cyc(ph, LANDS[k][4]), 0.2, 0.5);
}

function primalLoopHQ(s, l, ph) {
    LANDS.forEach(([kind, px, py, rad], k) => {
        const al = landAlpha(ph, k);
        if (al > 0.01) terrainPatch(s, l, kind, X + px * AR, Y + py * AR, rad * AR, 100 + k, al);
    });
    // Mycelium between lands that are both there, with pulses of light running along it
    for (const T of THREADS) {
        const al = Math.min(landAlpha(ph, T.i), landAlpha(ph, T.j));
        if (al < 0.05) continue;
        l.save();
        l.strokeStyle = `rgba(120, 230, 200, ${0.6 * al})`;
        l.shadowColor = "rgba(120, 230, 200, 1)";
        l.shadowBlur = 8;
        l.lineWidth = 1.3;
        l.beginPath();
        T.pts.forEach(([x, y], q) => (q ? l.lineTo(x, y) : l.moveTo(x, y)));
        l.stroke();
        l.restore();
        const pu = cyc(ph, T.off, 2);
        const q = pu * (T.pts.length - 1);
        const a = T.pts[Math.floor(q)];
        const b = T.pts[Math.min(T.pts.length - 1, Math.floor(q) + 1)];
        sparkle(l, lerp(a[0], b[0], q % 1), lerp(a[1], b[1], q % 1), 4, "#c8fff0", al);
    }
    // Tangling at feet
    for (const [[tx, ty]] of AURA_TOKENS().slice(0, 3)) {
        const u = cyc(ph, tx / 997, 2);
        ringPulse(l, tx, ty + 6, 26 + 10 * u, "#7fe8c8", 0.4 * (1 - u), 2);
        mycelium(l, tx - 30, ty + 30, tx + 30, ty + 25, 300 + tx, 0.45);
    }
    // Spores rising
    const mr = rng(88);
    for (let i = 0; i < 40; i++) {
        const u = cyc(ph, mr(), 1 + Math.floor(mr() * 2));
        const [sx, sy] = at(mr() * TAU, mr() * 0.9);
        mote(l, sx + Math.sin(TAU * u) * 6, sy - u * AR * 0.15, 1.3, mr() < 0.3 ? "#f6e27a" : "#c8f0d8", Math.sin(Math.PI * u) * 0.8);
    }
    trinketsDrifting(s, 110, ph, 4);
}

function primalCastHQ(s, l, t) {
    for (let i = 0; i < 3; i++) {
        const w = seg(t, 0.05 + i * 0.12, 0.9 + i * 0.12);
        if (w > 0 && w < 1) ringPulse(l, X, Y, AR * (0.15 + 0.8 * easeOut(w)), "#9df0d8", (1 - w) * 0.8, 4);
    }
    const grow = easeOut(seg(t, 0.1, 1.0));
    const fade = 1 - seg(t, 1.4, 2.2);
    for (let i = 0; i < 10; i++) {
        const [ex, ey] = at((i / 10) * TAU + 0.2, 0.9);
        mycelium(l, X, Y, lerp(X, ex, grow), lerp(Y, ey, grow), 60 + i, fade);
    }
    const r = rng(12);
    for (let i = 0; i < 14; i++) {
        const a = r() * TAU;
        const rad = 0.25 + r() * 0.55;
        const g = easeOutBack(seg(t, 0.4 + rad * 0.6, 0.8 + rad * 0.6));
        if (g <= 0.02) continue;
        s.save();
        s.globalAlpha = fade;
        bellCap(s, l, ...at(a, rad), AR * 0.08 * g, r() < 0.5 ? "#8a7dff" : "#5fd3c8");
        s.restore();
    }
}

/* =================================================== Valet's curse =============================================== */

const MISERY_LEN = 3.9;
function miseryHQ(s, l, t) {
    const hand = [MV[0] + 40, MV[1] - 22];
    const target = [ME[0], ME[1] - 55];
    const r = 44;
    // Gathering at Valet's hand
    const gather = seg(t, 0, 0.5);
    const flight = easeInOut(seg(t, 0.5, 1.9));
    const contact = seg(t, 1.9, 2.1);
    if (t < 1.95) {
        if (t < 0.5) ringPulse(l, ...MV, 50 + gather * 8, "#7a72f0", 0.5 * (1 - gather), 2);
        const [wx, wy] = flight > 0 ? wispPath(...hand, ...target, flight) : hand;
        if (flight > 0) {
            l.save();
            l.lineCap = "round";
            const tail = Math.max(0, flight - 0.45);
            for (let i = 0; i < 40; i++) {
                const s0 = lerp(tail, flight, i / 40);
                const s1 = lerp(tail, flight, (i + 1) / 40);
                l.strokeStyle = `rgba(110, 100, 240, ${0.04 + 0.4 * (i / 40)})`;
                l.lineWidth = 2 + 8 * (i / 40);
                l.beginPath();
                l.moveTo(...wispPath(...hand, ...target, s0));
                l.lineTo(...wispPath(...hand, ...target, s1));
                l.stroke();
            }
            l.restore();
        }
        livingWisp(l, wx, wy, 6 + 10 * smooth(gather), t * 1.6, smooth(gather));
    }
    if (contact > 0 && contact < 1) {
        ringPulse(l, ...target, 20 + 30 * contact, "#a9a2ff", 1 - contact, 4);
        const mr = rng(5);
        for (let i = 0; i < 16; i++) {
            const a = mr() * TAU;
            mote(l, target[0] + Math.cos(a) * 40 * contact, target[1] + Math.sin(a) * 40 * contact, 1.6, "#c9c4ff", 1 - contact);
        }
    }
    // The control bar and strings
    const barIn = easeOutBack(seg(t, 1.95, 2.3));
    const tug = seg(t, 2.45, 2.8);
    const slack = easeIn(seg(t, 3.1, 3.8));
    if (barIn > 0 && slack < 1) {
        const yank = Math.sin(Math.PI * tug) * (1 - tug * 0.5);
        const lift = smooth(seg(t, 2.45, 3.3));
        const barY = ME[1] - r * (1.9 + 1.0 * lift) - yank * r * 0.3 + (1 - barIn) * -r * 0.4;
        const barW = r * 1.9;
        const sway = Math.sin(t * 5) * r * 0.05 * (1 - tug);
        const anchors = [[0, -0.55], [-0.62, -0.1], [0.62, -0.1], [-0.32, 0.55], [0.32, 0.55]];
        const tips = [[0, -0.25], [-0.5, 0], [0.5, 0], [-0.22, 0.32], [0.22, 0.32]];
        const faceY = ME[1] - r * 1.35 * lift;
        anchors.forEach(([ax, ay], i) => {
            const drop = easeOut(seg(t, 2.0 + i * 0.05, 2.25 + i * 0.05));
            if (drop <= 0) return;
            const tx = ME[0] + sway + tips[i][0] * barW;
            const ty = barY + tips[i][1] * barW;
            const ex = ME[0] + ax * r * lerp(1, 0.65, lift);
            const ey = lerp(ME[1] + ay * r, faceY + ay * r * 0.7, lift) + slack * r * 0.6;
            const taut = tug > 0 && tug < 1;
            l.save();
            l.globalAlpha = 1 - slack;
            l.lineWidth = taut ? 1.6 : 1.1;
            l.strokeStyle = taut ? "rgba(240, 242, 255, 0.95)" : "rgba(190, 190, 255, 0.85)";
            l.shadowColor = "rgba(140, 130, 255, 1)";
            l.shadowBlur = 8;
            l.beginPath();
            l.moveTo(tx, ty);
            l.quadraticCurveTo(lerp(tx, ex, 0.5) + slack * 14, lerp(ty, ey, 0.5) + slack * 20, lerp(tx, ex, drop), lerp(ty, ey, drop));
            l.stroke();
            l.restore();
        });
        s.save();
        s.globalAlpha = seg(t, 1.95, 2.1) * (1 - slack);
        s.translate(ME[0] + sway, barY);
        s.rotate(Math.sin(t * 4) * 0.06 * (1 - tug) + slack * 0.4);
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
        // The stolen face, drawn up and dissolving as it goes
        if (lift > 0) {
            const fa = smooth(seg(t, 2.45, 2.7)) * (1 - smooth(seg(t, 2.9, 3.6)));
            s.save();
            s.globalAlpha = fa * 0.95;
            s.translate(ME[0], faceY);
            s.beginPath();
            s.ellipse(0, 0, r * 0.45, r * 0.6, 0, 0, TAU);
            const g = s.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
            g.addColorStop(0, "#f3f4fb");
            g.addColorStop(1, "#a6addb");
            s.fillStyle = g;
            s.fill();
            s.restore();
            const fg = l.createRadialGradient(ME[0], faceY, 0, ME[0], faceY, r);
            fg.addColorStop(0, `rgba(160, 160, 255, ${0.45 * fa})`);
            fg.addColorStop(1, "rgba(160, 160, 255, 0)");
            l.fillStyle = fg;
            l.beginPath();
            l.arc(ME[0], faceY, r, 0, TAU);
            l.fill();
            if (tug > 0 && tug < 1) ringPulse(l, ...ME, r * (1.1 + 0.4 * tug), "#7a72f0", 1 - tug, 3);
            const mr = rng(3);
            for (let i = 0; i < 18; i++) {
                const u = seg(t, 2.8 + mr() * 0.4, 3.7);
                if (u <= 0 || u >= 1) continue;
                mote(l, ME[0] + (mr() - 0.5) * r * 1.2, faceY - u * r * 0.9 + (mr() - 0.5) * r, 1.6, "#d8defe", 1 - u);
            }
        }
    }
}

/* =================================================== The charge ================================================== */

const CHARGE_LEN = 3.2;
function chargeHQ(s, l, t) {
    const hand = [CW[0] + 30, CW[1] - 30];
    const path = (u) => [lerp(hand[0], CC[0], u), lerp(hand[1], CC[1] - 46, u) - Math.sin(Math.PI * u) * 70];
    const kindle = seg(t, 0, 0.4);
    const flight = easeInOut(seg(t, 0.4, 1.5));
    const land = seg(t, 1.5, 2.1);
    const fade = seg(t, 2.1, 3.2);
    if (t < 1.55) {
        if (flight > 0) {
            l.save();
            l.lineCap = "round";
            const tail = Math.max(0, flight - 0.5);
            for (let i = 0; i < 40; i++) {
                const s0 = lerp(tail, flight, i / 40);
                const s1 = lerp(tail, flight, (i + 1) / 40);
                l.strokeStyle = `rgba(255, 238, 205, ${0.03 + 0.3 * (i / 40)})`;
                l.lineWidth = 2 + 7 * (i / 40);
                l.beginPath();
                l.moveTo(...path(s0));
                l.lineTo(...path(s1));
                l.stroke();
            }
            l.restore();
        }
        const [mx, my] = flight > 0 ? path(flight) : [hand[0] + 8, hand[1] - 10];
        kindMote(l, mx, my + Math.sin(t * 6) * 2, 4 + 5 * smooth(kindle), 0.3 + 0.7 * smooth(kindle));
    }
    if (land > 0) {
        const swell = Math.sin(Math.PI * clamp(land * 0.7 + fade * 0.3)) * (1 - fade);
        const g = l.createRadialGradient(CC[0], CC[1], 10, CC[0], CC[1], 90 + 30 * land);
        g.addColorStop(0, `rgba(255, 244, 220, ${0.5 * swell})`);
        g.addColorStop(0.5, `rgba(255, 230, 190, ${0.18 * swell})`);
        g.addColorStop(1, "rgba(255, 230, 190, 0)");
        l.fillStyle = g;
        l.beginPath();
        l.arc(...CC, 120, 0, TAU);
        l.fill();
        if (land < 1) ringPulse(l, ...CC, 44 + 14 * land, "#fff2da", 0.8 * (1 - land), 3);
        ringPulse(l, ...CC, 50, "#f5e8d0", 0.35 * (1 - fade), 2);
        // The mote settles at the top of the token and slowly dims
        const mx = lerp(CC[0], CC[0] + 34, smooth(fade));
        const my = lerp(CC[1] - 46, CC[1] - 34, smooth(fade));
        kindMote(l, mx, my + Math.sin(t * 3) * 2, 9 - 3 * fade, 1 - fade * 0.9);
    }
}

/* =================================================== Scenes ====================================================== */

const HQ = {
    occult: { border: OCC_BORDER, mist: {}, loop: occultLoopHQ, cast: occultCastHQ, castLen: 2.4 },
    divine: { border: [236, 214, 140], mist: { hi: [0.95, 0.9, 0.78], storm: true }, edge: [1, 0.92, 0.7], loop: divineLoopHQ, cast: divineCastHQ, castLen: 2.1 },
    arcane: { border: [63, 127, 224], mist: { hi: [0.45, 0.6, 1.0] }, loop: arcaneLoopHQ, cast: arcaneCastHQ, castLen: 2.6 },
    primal: { border: [79, 158, 58], mist: { hi: [0.4, 0.85, 0.75], density: 0.8 }, edge: [0.5, 0.95, 0.8], loop: primalLoopHQ, cast: primalCastHQ, castLen: 2.3 },
};

for (const [name, P] of Object.entries(HQ)) {
    const start = 0.6;
    SCENES[`hq-${name}`] = {
        duration: start + LOOP + 1.5,
        draw(ctx, t) {
            kit ??= new Kit();
            ctx.drawImage(background(), 0, 0);
            if (t >= start) {
                const lt = t - start;
                const ph = fr(lt / LOOP);
                const noiseOff = [Math.cos(TAU * ph) * 0.8, Math.sin(TAU * ph) * 0.8];
                // pf2e's aura: fill, the looping texture at 0.8, border
                const { s, l } = kit.begin();
                P.loop(s, l, ph);
                const img = kit.render({ mist: { x: X, y: Y, R: AR, ph, density: 1, ...P.mist }, seed: 1, edge: P.edge, noiseOff });
                ctx.save();
                ctx.fillStyle = `rgba(${P.border.join(",")}, 0.08)`;
                ctx.beginPath();
                ctx.arc(X, Y, AR, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 0.85;
                ctx.drawImage(img, 0, 0);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = `rgba(${P.border.join(",")}, 0.75)`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(X, Y, AR, 0, TAU);
                ctx.stroke();
                ctx.restore();
                // Sequencer's cast on top
                if (lt <= P.castLen) {
                    const c = kit.begin();
                    P.cast(c.s, c.l, lt);
                    ctx.drawImage(kit.render({ seed: 2, edge: P.edge, noiseOff: [lt * 0.6, 0] }), 0, 0);
                }
            }
            for (const [p, tk] of AURA_TOKENS()) token(ctx, ...p, tk);
        },
    };
}

SCENES["hq-misery"] = {
    duration: MISERY_LEN + 0.6,
    draw(ctx, t) {
        overFrame(ctx, [
            [MV, VALET],
            [ME, ENEMY],
        ], (s, l) => miseryHQ(s, l, t - 0.3), { edge: [0.55, 0.55, 1.0] });
    },
};
SCENES["hq-charge"] = {
    duration: CHARGE_LEN + 0.6,
    draw(ctx, t) {
        overFrame(ctx, [
            [CW, FINCH],
            [CC, ALLY],
        ], (s, l) => chargeHQ(s, l, t - 0.3), { edge: [1, 0.92, 0.8] });
    },
};
