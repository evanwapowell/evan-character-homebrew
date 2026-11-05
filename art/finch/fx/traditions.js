/* Manifest Will's other three traditions, for a witch with Multifaceted Will. Each has a seamless loop (the aura's
 * texture) and a one-shot cast. Loaded after effects.js. */

function haze(ctx, R, inner, outer) {
    const g = ctx.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
    g.addColorStop(0, inner);
    g.addColorStop(0.75, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
}

/** Double ring with ticks, rotated by rot (keep it a multiple of 90° a loop for a seamless loop) */
function tickRing(ctx, R, rot, color, alpha) {
    ctx.save();
    ctx.rotate(rot);
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
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
    ctx.restore();
}

function polygon(ctx, n, r, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
        const a = rot + (i / n) * TAU;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
}

/** Stroke a polygon only up to `p` of its perimeter, for drawing it on */
function polygonPartial(ctx, n, r, p, rot = -Math.PI / 2) {
    const total = n * p;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rot) * r, Math.sin(rot) * r);
    for (let i = 0; i < n; i++) {
        const f = clamp(total - i);
        if (f <= 0) break;
        const a0 = rot + (i / n) * TAU;
        const a1 = rot + ((i + 1) / n) * TAU;
        ctx.lineTo(lerp(Math.cos(a0), Math.cos(a1), f) * r, lerp(Math.sin(a0), Math.sin(a1), f) * r);
    }
    ctx.stroke();
}

/* =====================================================================================================================
 * Arcane — "The Coin Walk"
 * Raw energy and magical formulae circulate: a hexagram and square of construction lines, a band of notation, and
 * the Prince's gold coins orbiting and flipping like a con artist walking a coin across his knuckles.
 * ================================================================================================================== */

const A = { blue: "#3f7fe0", ice: "#bfe0ff", silver: "#e3ecf8", deep: "#1d3f7a" };
const NOTATION = (() => {
    const r = rng(101);
    return Array.from({ length: 8 }, () => makeGlyph(r));
})();

/** A gold coin; flip in [0, 1] is the visible width, showing the crowned face or the masked reverse */
function drawCoin(ctx, x, y, s, flip, face = true) {
    const w = Math.max(Math.abs(flip), 0.06);
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = s * 0.8;
    // The coin's edge, seen as it turns
    ctx.fillStyle = C.goldDeep;
    ctx.beginPath();
    ctx.ellipse(s * 0.08 * (1 - w), 0, (s / 2) * w + s * 0.05 * (1 - w), s / 2, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.scale(w, 1);
    const g = ctx.createRadialGradient(-s * 0.15, -s * 0.15, s * 0.05, 0, 0, s / 2);
    g.addColorStop(0, C.goldHi);
    g.addColorStop(1, C.gold);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = C.goldDeep;
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.4, 0, TAU);
    ctx.stroke();
    if (face) drawCrown(ctx, 0, s * 0.12, s * 0.42, C.goldDeep);
    else drawDomino(ctx, 0, 0, s * 0.55, C.goldDeep);
    ctx.restore();
}

const ARCANE_LOOP = 8;

function arcaneLoop(ctx, cx, cy, R, t) {
    const ph = (((t % ARCANE_LOOP) + ARCANE_LOOP) % ARCANE_LOOP) / ARCANE_LOOP;
    const breathe = 0.85 + 0.15 * Math.sin(ph * TAU);
    ctx.save();
    ctx.translate(cx, cy);
    haze(ctx, R, "rgba(63, 127, 224, 0.10)", "rgba(40, 90, 190, 0.16)");
    tickRing(ctx, R, ph * (TAU / 4), A.ice, 0.85 * breathe);

    // Construction lines: a hexagram turning 60° a loop and a square turning back 90°
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = A.ice;
    ctx.shadowColor = A.blue;
    ctx.shadowBlur = 10;
    ctx.lineWidth = R * 0.007;
    ctx.globalAlpha *= 0.7 * breathe;
    ctx.save();
    ctx.rotate(ph * (TAU / 6));
    for (const off of [0, Math.PI]) {
        polygon(ctx, 3, R * 0.72, -Math.PI / 2 + off);
        ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72, R * 0.045, 0, TAU);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.36, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(-ph * (TAU / 4));
    polygon(ctx, 4, R * 0.5, 0);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // Notation band: 16 glyphs (8 repeated twice) turning 180° a loop
    ctx.save();
    ctx.rotate(ph * Math.PI);
    ctx.strokeStyle = A.silver;
    ctx.shadowColor = A.blue;
    ctx.shadowBlur = 8;
    ctx.lineWidth = R * 0.007;
    ctx.lineCap = "round";
    for (let i = 0; i < 16; i++) {
        ctx.save();
        ctx.globalAlpha *= (0.55 + 0.45 * Math.sin(ph * TAU * 3 + i * 1.3)) * breathe;
        ctx.rotate((i / 16) * TAU);
        ctx.translate(0, -R * 0.6);
        drawGlyph(ctx, NOTATION[i % 8], R * 0.06);
        ctx.restore();
    }
    ctx.restore();

    // Six coins walking the orbit, 60° a loop, each flipping a whole number of times
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * TAU + ph * (TAU / 6);
        const turn = ph * TAU * 2 + i * 0.9;
        const flip = Math.cos(turn);
        const x = Math.cos(a) * R * 0.84;
        const y = Math.sin(a) * R * 0.84;
        drawCoin(ctx, x, y, R * 0.12, flip, flip > 0);
        // A glint as the face comes square to the eye
        const glint = Math.pow(Math.max(0, Math.cos(turn * 2)), 24) * (flip > 0 ? 1 : 0.6);
        sparkle(ctx, x + R * 0.02, y - R * 0.02, R * 0.05 * glint, "#ffffff", glint);
    }

    // Motes of raw energy circling inward
    const mr = rng(31);
    for (let i = 0; i < 20; i++) {
        const life = (ph * (1 + Math.floor(mr() * 2)) + mr()) % 1;
        const a = mr() * TAU - life * TAU * 0.5;
        const rad = R * lerp(0.92, 0.2, life);
        sparkle(ctx, Math.cos(a) * rad, Math.sin(a) * rad, R * 0.012, A.ice, Math.sin(Math.PI * life) * 0.8);
    }
    ctx.restore();
}

/** The cast: a coin flicked up from the witch splits into the six orbiting coins as the formula draws itself */
function arcaneCast(ctx, cx, cy, R, t) {
    ctx.save();
    ctx.translate(cx, cy);
    // The flick: one coin rises, spinning, and pops
    const up = seg(t, 0.05, 0.6);
    if (up > 0 && up < 1) {
        const h = Math.sin(Math.PI * up) * R * 0.32;
        drawCoin(ctx, 0, -h, R * (0.08 + 0.05 * up), Math.cos(up * TAU * 3), Math.cos(up * TAU * 3) > 0);
    }
    if (up >= 1) {
        const pop = seg(t, 0.6, 0.85);
        if (pop < 1) sparkle(ctx, 0, 0, R * 0.2 * Math.sin(Math.PI * pop), "#ffffff", 1);
    }
    // Six coins fly out on a spiral
    for (let i = 0; i < 6; i++) {
        const out = easeOut(seg(t, 0.62, 1.2));
        if (out <= 0) continue;
        const done = seg(t, 1.25, 1.6);
        if (done >= 1) continue;
        const a = -Math.PI / 2 + (i / 6) * TAU - (1 - out) * 2.2;
        const x = Math.cos(a) * R * 0.84 * out;
        const y = Math.sin(a) * R * 0.84 * out;
        ctx.save();
        ctx.globalAlpha *= 1 - done;
        drawCoin(ctx, x, y, R * 0.12, Math.cos(t * 14 + i), true);
        ctx.restore();
        // A trail of blue light
        for (let k = 1; k < 6; k++) {
            const o = Math.max(0, out - k * 0.05);
            const ak = -Math.PI / 2 + (i / 6) * TAU - (1 - o) * 2.2;
            sparkle(ctx, Math.cos(ak) * R * 0.84 * o, Math.sin(ak) * R * 0.84 * o, R * 0.02 * (1 - k / 6), A.ice, (1 - k / 6) * (1 - done));
        }
    }
    // The hexagram and square draw themselves on, bright, then hand over to the loop
    const draw = easeInOut(seg(t, 0.8, 1.5));
    const fadeOut = seg(t, 1.6, 2.3);
    if (draw > 0 && fadeOut < 1) {
        ctx.save();
        ctx.globalAlpha *= 1 - fadeOut;
        ctx.strokeStyle = "#ffffff";
        ctx.shadowColor = A.blue;
        ctx.shadowBlur = 18;
        ctx.lineWidth = R * 0.014;
        ctx.lineCap = "round";
        polygonPartial(ctx, 3, R * 0.72, draw);
        polygonPartial(ctx, 3, R * 0.72, draw, Math.PI / 2);
        polygonPartial(ctx, 4, R * 0.5, draw, 0);
        ctx.restore();
    }
    const w = seg(t, 1.2, 1.7);
    if (w > 0 && w < 1) ringPulse(ctx, 0, 0, R * (0.4 + 0.55 * easeOut(w)), A.ice, (1 - w) * 0.9, R * 0.018);
    ctx.restore();
}

/* =====================================================================================================================
 * Divine — "The Turning of Lives"
 * Divine power crashes in a cycle of life and death, as the Prince lives a life, forgets it and begins another: a sun
 * and a moon chase each other around the circle, and the blossoms between them bloom in the sun's light and wither to
 * ash as the moon passes.
 * ================================================================================================================== */

const D = { gold: "#e8c547", dawn: "#fff2c4", moon: "#d6e4ff", ash: "#9e98ac", rose: "#ffd6e6" };
const DIVINE_LOOP = 12;

function drawSun(ctx, x, y, s, spin) {
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.6);
    g.addColorStop(0, "rgba(255, 242, 196, 0.9)");
    g.addColorStop(0.35, "rgba(232, 197, 71, 0.5)");
    g.addColorStop(1, "rgba(232, 197, 71, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.6, 0, TAU);
    ctx.fill();
    ctx.rotate(spin);
    ctx.fillStyle = D.gold;
    ctx.shadowColor = D.gold;
    ctx.shadowBlur = s;
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const rr = i % 2 ? s * 0.55 : s * (i % 4 ? 0.8 : 0.95);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = D.dawn;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.42, 0, TAU);
    ctx.fill();
    ctx.restore();
}

function drawMoon(ctx, x, y, s, facing) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing);
    ctx.shadowColor = D.moon;
    ctx.shadowBlur = s;
    ctx.fillStyle = D.moon;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.55, 0, TAU);
    ctx.arc(s * 0.22, -s * 0.08, s * 0.47, 0, TAU, true);
    ctx.fill("evenodd");
    ctx.restore();
}

/** A five-petalled blossom; life 1 is full bloom, 0 withered to ash */
function drawBlossom(ctx, x, y, s, life, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const open = 0.35 + 0.65 * life;
    const col = life > 0.5 ? D.rose : D.ash;
    ctx.globalAlpha *= 0.35 + 0.65 * life;
    ctx.shadowColor = life > 0.5 ? D.gold : "rgba(0,0,0,0)";
    ctx.shadowBlur = s * 0.6 * life;
    for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.rotate((i / 5) * TAU);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, -s * 0.32 * open, s * 0.2 * open, s * 0.34 * open, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
    }
    ctx.fillStyle = life > 0.5 ? D.gold : "#6e6878";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.13, 0, TAU);
    ctx.fill();
    ctx.restore();
}

function divineLoop(ctx, cx, cy, R, t) {
    const ph = (((t % DIVINE_LOOP) + DIVINE_LOOP) % DIVINE_LOOP) / DIVINE_LOOP;
    const sunA = -Math.PI / 2 + ph * TAU;
    ctx.save();
    ctx.translate(cx, cy);
    haze(ctx, R, "rgba(232, 197, 71, 0.08)", "rgba(200, 160, 60, 0.12)");

    // Day follows the sun around the circle; night trails behind it
    const day = ctx.createConicGradient(sunA - Math.PI, 0, 0);
    day.addColorStop(0, "rgba(120, 140, 200, 0.14)");
    day.addColorStop(0.5, "rgba(255, 230, 150, 0.2)");
    day.addColorStop(1, "rgba(120, 140, 200, 0.14)");
    ctx.fillStyle = day;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.92, 0, TAU);
    ctx.fill();

    tickRing(ctx, R, ph * (TAU / 4), D.gold, 0.85);
    ctx.save();
    ctx.strokeStyle = D.gold;
    ctx.shadowColor = D.gold;
    ctx.shadowBlur = 6;
    ctx.globalAlpha *= 0.6;
    ctx.lineWidth = R * 0.006;
    ctx.setLineDash([R * 0.03, R * 0.025]);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.42, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // Twelve blossoms: each blooms as the sun nears and withers as the moon passes
    for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * TAU;
        const toSun = Math.cos(a - sunA); // 1 under the sun, -1 under the moon
        const life = clamp(0.5 + 0.75 * toSun);
        const x = Math.cos(a) * R * 0.62;
        const y = Math.sin(a) * R * 0.62;
        drawBlossom(ctx, x, y, R * 0.11, life, a + ph * TAU);
        // Ash drifts off the withered ones
        if (toSun < -0.3) {
            const mr = rng(200 + i);
            for (let k = 0; k < 3; k++) {
                const l = (ph * 6 + mr()) % 1;
                mote(ctx, x + (mr() - 0.5) * R * 0.08, y - l * R * 0.12, R * 0.006, D.ash, (1 - l) * 0.7 * -toSun);
            }
        }
    }

    drawSun(ctx, Math.cos(sunA) * R * 0.82, Math.sin(sunA) * R * 0.82, R * 0.1, ph * TAU * 2);
    drawMoon(ctx, Math.cos(sunA + Math.PI) * R * 0.82, Math.sin(sunA + Math.PI) * R * 0.82, R * 0.16, sunA);

    // Motes of light rising where the sun is
    const mr = rng(77);
    for (let i = 0; i < 18; i++) {
        const l = (ph * 4 + mr()) % 1;
        const a = sunA + (mr() - 0.5) * 2.2;
        const rad = R * (0.3 + mr() * 0.6);
        mote(ctx, Math.cos(a) * rad, Math.sin(a) * rad - l * R * 0.08, R * 0.008, D.dawn, Math.sin(Math.PI * l) * 0.8);
    }
    ctx.restore();
}

/** The cast: a sunrise from the witch. Rays sweep out, the blossoms burst open, and a crown of light rings out. */
function divineCast(ctx, cx, cy, R, t) {
    ctx.save();
    ctx.translate(cx, cy);
    const rise = seg(t, 0, 0.5);
    const flare = Math.sin(Math.PI * seg(t, 0.1, 1.2));
    if (flare > 0) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.7);
        g.addColorStop(0, `rgba(255, 242, 196, ${0.85 * flare})`);
        g.addColorStop(1, "rgba(232, 197, 71, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.7, 0, TAU);
        ctx.fill();
    }
    // Rays
    const out = easeOut(seg(t, 0.25, 1.1));
    const fade = seg(t, 1.0, 1.9);
    if (out > 0 && fade < 1) {
        ctx.save();
        ctx.rotate(out * 0.5);
        ctx.globalAlpha *= 1 - fade;
        ctx.strokeStyle = D.dawn;
        ctx.shadowColor = D.gold;
        ctx.shadowBlur = 16;
        ctx.lineCap = "round";
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * TAU;
            ctx.lineWidth = R * (i % 2 ? 0.01 : 0.02);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22);
            const len = R * (0.3 + 0.62 * out) * (i % 2 ? 0.8 : 1);
            ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
            ctx.stroke();
        }
        ctx.restore();
    }
    // The crown of light at the centre as it rises
    if (rise > 0 && fade < 1) {
        ctx.save();
        ctx.globalAlpha *= easeOut(rise) * (1 - fade);
        ctx.shadowColor = D.gold;
        ctx.shadowBlur = 20;
        drawCrown(ctx, 0, -R * 0.2 - easeOut(rise) * R * 0.08, R * 0.2, D.dawn);
        ctx.restore();
    }
    const w = seg(t, 0.5, 1.2);
    if (w > 0 && w < 1) ringPulse(ctx, 0, 0, R * (0.3 + 0.65 * easeOut(w)), D.dawn, (1 - w), R * 0.02);
    // Petals thrown out
    const mr = rng(55);
    for (let i = 0; i < 24; i++) {
        const born = 0.4 + mr() * 0.3;
        const l = seg(t, born, born + 1.2);
        if (l <= 0 || l >= 1) continue;
        const a = mr() * TAU;
        const rad = R * (0.2 + 0.75 * easeOut(l) * (0.6 + mr() * 0.4));
        ctx.save();
        ctx.globalAlpha *= 1 - l;
        ctx.translate(Math.cos(a) * rad, Math.sin(a) * rad);
        ctx.rotate(l * 6 + i);
        ctx.fillStyle = D.rose;
        ctx.shadowColor = D.gold;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.ellipse(0, 0, R * 0.012, R * 0.024, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

/* =====================================================================================================================
 * Primal — "The Fairy Ring"
 * Plants and fungus symbolic of the patron grow and wither: a fairy ring of mushrooms that springs up and rots away in
 * a wave around the circle, inside a briar of violet roses that bloom and wilt in turn. Spores drift up.
 * ================================================================================================================== */

const P = { green: "#4f9e3a", moss: "#8fd16a", leaf: "#3b7a2c", bark: "#3a2a1c", rose: "#7a6cf0", cap: "#5b63d4", spot: "#fbe9d0", rot: "#6b5a3a" };
const PRIMAL_LOOP = 8;

/** A mushroom seen from the side; grow in [0, 1], wither darkens and slumps it */
function drawMushroom(ctx, x, y, s, grow, wither, tilt) {
    if (grow <= 0.02) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt + wither * 0.5);
    ctx.scale(grow, grow * (1 - wither * 0.45));
    const cap = wither > 0.4 ? P.rot : P.cap;
    ctx.shadowColor = wither > 0.4 ? "rgba(0,0,0,0)" : P.cap;
    ctx.shadowBlur = s * 0.5;
    ctx.fillStyle = wither > 0.4 ? "#8a7a62" : P.spot;
    ctx.beginPath();
    ctx.roundRect(-s * 0.09, -s * 0.45, s * 0.18, s * 0.45, s * 0.05);
    ctx.fill();
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.45, s * 0.36, s * 0.24, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    if (wither < 0.4) {
        ctx.fillStyle = P.spot;
        for (const [sx, sy, sr] of [
            [-0.16, -0.55, 0.05],
            [0.08, -0.62, 0.045],
            [0.2, -0.5, 0.035],
        ]) {
            ctx.beginPath();
            ctx.arc(sx * s, sy * s, sr * s, 0, TAU);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawRose(ctx, x, y, s, life, rot) {
    if (life <= 0.02) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha *= clamp(life * 1.5);
    const col = life > 0.35 ? P.rose : P.rot;
    ctx.shadowColor = life > 0.35 ? P.rose : "rgba(0,0,0,0)";
    ctx.shadowBlur = s * 0.6;
    ctx.fillStyle = col;
    const open = 0.4 + 0.6 * life;
    for (let ring = 0; ring < 3; ring++) {
        const n = 5 - ring;
        for (let i = 0; i < n; i++) {
            ctx.save();
            ctx.rotate((i / n) * TAU + ring * 0.6);
            ctx.beginPath();
            ctx.ellipse(0, -s * 0.2 * open * (1 - ring * 0.3), s * 0.16 * (1 - ring * 0.25), s * 0.22 * open * (1 - ring * 0.3), 0, 0, TAU);
            ctx.globalAlpha *= 0.85;
            ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = shade(col, -0.2 * (ring + 1));
    }
    ctx.restore();
}

function primalLoop(ctx, cx, cy, R, t) {
    const ph = (((t % PRIMAL_LOOP) + PRIMAL_LOOP) % PRIMAL_LOOP) / PRIMAL_LOOP;
    ctx.save();
    ctx.translate(cx, cy);
    haze(ctx, R, "rgba(79, 158, 58, 0.09)", "rgba(50, 110, 40, 0.16)");

    // The briar: two thorny vines braided around the edge, swaying
    const sway = Math.sin(ph * TAU) * R * 0.008;
    ctx.save();
    ctx.lineCap = "round";
    for (const [k, col, lw] of [
        [0, P.leaf, 0.018],
        [Math.PI, "#2f5f24", 0.014],
    ]) {
        ctx.beginPath();
        for (let i = 0; i <= 240; i++) {
            const a = (i / 240) * TAU;
            const rr = R * 0.88 + Math.sin(a * 10 + k) * R * 0.03 + sway;
            i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = R * lw;
        ctx.shadowColor = P.green;
        ctx.shadowBlur = 6;
        ctx.stroke();
    }
    // Thorns and leaves along the vine
    ctx.fillStyle = P.moss;
    for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        const rr = R * 0.88 + Math.sin(a * 10) * R * 0.03 + sway;
        ctx.save();
        ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
        ctx.rotate(a + (i % 2 ? 0.9 : -0.9) + Math.PI / 2);
        if (i % 3 === 0) {
            ctx.fillStyle = P.leaf;
            ctx.beginPath();
            ctx.ellipse(0, -R * 0.03, R * 0.014, R * 0.03, 0, 0, TAU);
            ctx.fill();
        } else {
            ctx.fillStyle = "#a9c98a";
            ctx.beginPath();
            ctx.moveTo(-R * 0.006, 0);
            ctx.lineTo(0, -R * 0.022);
            ctx.lineTo(R * 0.006, 0);
            ctx.fill();
        }
        ctx.restore();
    }
    ctx.restore();

    // Eight roses on the briar, blooming and wilting in a wave that goes round once a loop
    for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * TAU;
        const life = 0.5 + 0.5 * Math.sin(ph * TAU - (i / 8) * TAU);
        const rr = R * 0.88 + Math.sin(a * 10) * R * 0.03 + sway;
        drawRose(ctx, Math.cos(a) * rr, Math.sin(a) * rr, R * 0.13, life, a);
    }

    // The fairy ring: 16 mushrooms that spring up and rot away, the wave going round twice a loop
    for (let i = 0; i < 16; i++) {
        const a = -Math.PI / 2 + (i / 16) * TAU;
        const c = (((ph * 2 - i / 16) % 1) + 1) % 1; // each mushroom's own cycle
        const grow = easeOutBack(seg(c, 0, 0.25)) * (1 - seg(c, 0.8, 1));
        const wither = seg(c, 0.5, 0.8);
        const x = Math.cos(a) * R * 0.66;
        const y = Math.sin(a) * R * 0.66;
        drawMushroom(ctx, x, y + R * 0.06, R * 0.2, grow, wither, (i % 3 - 1) * 0.15);
        // Puffs of spores as it rots
        if (wither > 0 && c < 1) {
            const mr = rng(300 + i);
            for (let k = 0; k < 3; k++) {
                const l = clamp((c - 0.55) / 0.45);
                mote(ctx, x + (mr() - 0.5) * R * 0.1, y - R * 0.05 - l * R * 0.12, R * 0.007, "#d8e8a0", Math.sin(Math.PI * l) * 0.8);
            }
        }
    }

    // Spores and fireflies rising
    const mr = rng(88);
    for (let i = 0; i < 20; i++) {
        const l = (ph * (1 + Math.floor(mr() * 2)) + mr()) % 1;
        const a = mr() * TAU;
        const rad = R * (0.2 + mr() * 0.7);
        mote(ctx, Math.cos(a) * rad, Math.sin(a) * rad - l * R * 0.1, R * 0.008, i % 3 ? "#d8f0a0" : "#f6e27a", Math.sin(Math.PI * l) * 0.8);
    }
    ctx.restore();
}

/** The cast: six briar tendrils lash out from the witch to the edge, and the fairy ring springs up behind them */
function primalCast(ctx, cx, cy, R, t) {
    ctx.save();
    ctx.translate(cx, cy);
    const grow = easeOut(seg(t, 0.05, 0.75));
    const fade = seg(t, 1.3, 2.1);
    if (grow > 0 && fade < 1) {
        ctx.save();
        ctx.globalAlpha *= 1 - fade;
        ctx.lineCap = "round";
        for (let i = 0; i < 6; i++) {
            const a0 = (i / 6) * TAU;
            ctx.beginPath();
            const steps = 50;
            for (let k = 0; k <= steps; k++) {
                const s = (k / steps) * grow;
                const a = a0 + s * 1.6 + Math.sin(s * 9) * 0.08;
                const rr = R * (0.18 + 0.72 * s);
                k ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            }
            ctx.strokeStyle = P.moss;
            ctx.lineWidth = R * 0.022 * (1 - grow * 0.4);
            ctx.shadowColor = P.green;
            ctx.shadowBlur = 12;
            ctx.stroke();
            // A rose bud at the tip that opens as it arrives
            const aTip = a0 + grow * 1.6 + Math.sin(grow * 9) * 0.08;
            const rTip = R * (0.18 + 0.72 * grow);
            drawRose(ctx, Math.cos(aTip) * rTip, Math.sin(aTip) * rTip, R * 0.1, 0.3 + 0.7 * seg(t, 0.6, 1.0), aTip);
        }
        ctx.restore();
    }
    // The ring springs up, one mushroom after another
    for (let i = 0; i < 16; i++) {
        const a = -Math.PI / 2 + (i / 16) * TAU;
        const g = easeOutBack(seg(t, 0.6 + i * 0.03, 0.9 + i * 0.03)) * (1 - fade);
        drawMushroom(ctx, Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66 + R * 0.06, R * 0.2, g, 0, 0);
    }
    const w = seg(t, 0.7, 1.3);
    if (w > 0 && w < 1) ringPulse(ctx, 0, 0, R * (0.35 + 0.6 * easeOut(w)), P.moss, (1 - w), R * 0.018);
    // A burst of leaves
    const mr = rng(66);
    for (let i = 0; i < 22; i++) {
        const born = 0.5 + mr() * 0.4;
        const l = seg(t, born, born + 1.1);
        if (l <= 0 || l >= 1) continue;
        const a = mr() * TAU;
        const rad = R * (0.2 + 0.7 * easeOut(l) * (0.6 + mr() * 0.4));
        ctx.save();
        ctx.globalAlpha *= 1 - l;
        ctx.translate(Math.cos(a) * rad, Math.sin(a) * rad);
        ctx.rotate(l * 5 + i);
        ctx.fillStyle = i % 4 ? P.moss : P.rose;
        ctx.beginPath();
        ctx.ellipse(0, 0, R * 0.012, R * 0.026, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

/** Each tradition: loop, loop length, cast, cast length, and pf2e aura colour (matching Aura: Manifest Will) */
const TRADITIONS = {
    arcane: { title: "The Coin Walk", loop: arcaneLoop, period: ARCANE_LOOP, cast: arcaneCast, castLen: 2.3, color: [63, 127, 224] },
    divine: { title: "The Turning of Lives", loop: divineLoop, period: DIVINE_LOOP, cast: divineCast, castLen: 2.0, color: [232, 197, 71] },
    occult: { title: "The Masquerade", loop: manifestLoop, period: MW_LOOP, cast: manifestCast, castLen: MW_CAST_DURATION, color: [104, 96, 232] },
    primal: { title: "The Fairy Ring", loop: primalLoop, period: PRIMAL_LOOP, cast: primalCast, castLen: 2.1, color: [79, 158, 58] },
};
