/* Preview scenes: a mock battle map with tokens, playing each effect where and when the module would. */

const W = 1280;
const H = 720;
const G = 100; // pixels per 5-foot square, Foundry's default

let bgCache = null;
function background() {
    if (bgCache) return bgCache;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    const r = rng(42);
    ctx.fillStyle = "#2c2a30";
    ctx.fillRect(0, 0, W, H);
    // Flagstones, two to a square, with worn variation
    for (let y = -G / 2; y < H; y += G / 2) {
        const shift = (Math.round(y / (G / 2)) % 2) * (G / 4);
        for (let x = -G; x < W; x += G / 2) {
            const l = 34 + r() * 14;
            ctx.fillStyle = `hsl(${250 + r() * 30}, 6%, ${l * 0.55}%)`;
            ctx.fillRect(x + shift + 1.5, y + 1.5, G / 2 - 3, G / 2 - 3);
        }
    }
    for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"}, ${r() * 0.05})`;
        ctx.fillRect(r() * W, r() * H, 2, 2);
    }
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += G) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, H);
    }
    for (let y = 0; y <= H; y += G) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();
    bgCache = c;
    return c;
}

function token(ctx, x, y, { label, initial, hue, ring }) {
    const r = G * 0.44;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, `hsl(${hue}, 35%, 42%)`);
    g.addColorStop(1, `hsl(${hue}, 40%, 18%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `600 ${r * 0.9}px "DejaVu Serif"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, x, y + 2);
    ctx.font = `600 15px Inter`;
    const tw = ctx.measureText(label).width + 14;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y + r + 6, tw, 22, 4);
    ctx.fill();
    ctx.fillStyle = "#f1eef5";
    ctx.fillText(label, x, y + r + 18);
    ctx.restore();
}

function caption(ctx, title, sub) {
    ctx.save();
    ctx.fillStyle = "rgba(10,6,16,0.72)";
    ctx.beginPath();
    ctx.roundRect(24, 22, Math.max(ctx.measureText(sub).width, 520) + 40, 70, 8);
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.font = `600 24px "DejaVu Serif"`;
    ctx.fillText(title, 44, 55);
    ctx.fillStyle = "#d9d2e4";
    ctx.font = `400 15px Inter`;
    ctx.fillText(sub, 44, 80);
    ctx.restore();
}

const WITCH = { label: "Witch", initial: "W", hue: 280, ring: "#59c3ff" };
const VALET = { label: "Valet", initial: "V", hue: 30, ring: "#59c3ff" };
const ALLY = { label: "Charge (ally)", initial: "A", hue: 200, ring: "#59c3ff" };
const ALLY2 = { label: "Ally", initial: "B", hue: 160, ring: "#59c3ff" };
const ENEMY = { label: "Enemy", initial: "E", hue: 0, ring: "#ff5a5a" };

const SCENES = {
    charge: {
        duration: 3.4,
        draw(ctx, t) {
            const w = [250, 410];
            const c = [850, 410];
            ctx.drawImage(background(), 0, 0);
            caption(ctx, "Designate Witch's Charge — Stitching the Mark", "30 feet · the needle flies at Sequencer's moveTowards speed");
            token(ctx, ...w, WITCH);
            token(ctx, ...c, ALLY);
            const lt = t - 0.4;
            const r = G * 0.44;
            const from = [w[0] + r * 0.5, w[1] - r * 0.3];
            const angle = Math.atan2(c[1] - from[1], c[0] - from[0]);
            const entry = [c[0] - Math.cos(angle) * r * 1.15, c[1] - Math.sin(angle) * r * 1.15];
            const flight = Math.hypot(entry[0] - from[0], entry[1] - from[1]) / 1100;
            markGlint(ctx, ...w, r, lt);
            markTether(ctx, ...from, ...entry, lt, flight);
            const f = seg(lt, MARK.flightStart, MARK.flightStart + flight);
            if (f > 0 && f < 1) markNeedleInFlight(ctx, lerp(from[0], entry[0], f), lerp(from[1], entry[1], f), r * 0.95, angle, lt);
            const land = lt - (MARK.flightStart + flight);
            if (land >= 0 && land <= MARK.end) markLanding(ctx, ...c, r, land, angle);
        },
    },
    misery: {
        duration: 3.6,
        draw(ctx, t) {
            const v = [350, 450];
            const e = [750, 390];
            ctx.drawImage(background(), 0, 0);
            caption(ctx, "Familiar of Ongoing Misery — Strings Attached", "Valet has no strings of his own; he gives them to someone else");
            token(ctx, ...v, VALET);
            token(ctx, ...e, ENEMY);
            const lt = t - 0.4;
            const r = G * 0.44;
            miseryPulse(ctx, ...v, r, lt);
            miseryLash(ctx, ...v, e[0], e[1] - r * 1.9, lt);
            if (lt >= 0 && lt <= MISERY.end) miseryTarget(ctx, ...e, r, lt);
        },
    },
};

/** One scene per tradition, named mw-<tradition>: the cast, then one full loop plus a little */
function manifestScene(key) {
    const tr = TRADITIONS[key];
    const start = 0.6;
    return {
        duration: start + tr.period + 2,
        draw(ctx, t) {
            const m = [640, 400];
            const [r, g, b] = tr.color;
            ctx.drawImage(background(), 0, 0);
            const name = key[0].toUpperCase() + key.slice(1);
            caption(ctx, `Manifest Will (${name}) — ${tr.title}`, `Cast, then the aura's ${tr.period}-second seamless loop · 10-foot emanation`);
            const R = (G * 5) / 2;
            if (t >= start) {
                ctx.save();
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.10)`;
                ctx.beginPath();
                ctx.arc(...m, R, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 0.8;
                tr.loop(ctx, ...m, R, t - start);
                ctx.restore();
                ctx.save();
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(...m, R, 0, TAU);
                ctx.stroke();
                ctx.restore();
                if (t - start <= tr.castLen) tr.cast(ctx, ...m, R, t - start);
            }
            token(ctx, ...m, WITCH);
            token(ctx, m[0] - 150, m[1] + 50, VALET);
            token(ctx, m[0] + 100, m[1] - 150, ALLY2);
            token(ctx, m[0] + 450, m[1] + 50, ENEMY);
        },
    };
}
for (const key of Object.keys(TRADITIONS)) SCENES[`mw-${key}`] = manifestScene(key);
