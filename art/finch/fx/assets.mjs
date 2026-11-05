// 2D assets for the Blender pilot: the fey-rune band (looping sequence and a static copy), the map, and overlays
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "bl", "assets");
mkdirSync(join(out, "band"), { recursive: true });
const files = ["effects.js", "traditions.js", "gl-occult.js", "preview.js", "gl-preview.js", "kit.js", "lost.js", "boards.js", "anim.js"];
const html = `<!doctype html><html><body>${files.map((f) => `<script>${readFileSync(join(here, f), "utf8")}</script>`).join("\n")}
<script>
// The fey band alone, white on transparent, 1024 px across the emanation's diameter; each word fades in its own time
function band(ph, fades) {
  // Words of Evan's fey glyphs (sprites/fey) around the ring, each word fading in its own time
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const s = c.getContext("2d");
  const R = 512, r = rng(707), rad = R * 0.835, h = R * 0.085;
  for (let w = 0; w < 12; w++) {
    const n = 3 + Math.floor(r() * 3);
    const word = Array.from({ length: n }, () => GLYPH_IMGS[Math.floor(r() * GLYPH_IMGS.length)]);
    const off = r();
    s.globalAlpha = fades ? 0.25 + 0.75 * win(cyc(ph, off), 0.3, 0.6) : 1;
    const widths = word.map((g) => (g.width / g.height) * h * 0.9);
    const gap = h * 0.08;
    const total = widths.reduce((a, b) => a + b + gap, -gap) / rad;
    let a = (w / 12) * TAU - total / 2;
    word.forEach((g, i) => {
      const wa = widths[i] / rad;
      const ac = a + wa / 2;
      s.save();
      s.translate(R + Math.sin(ac) * rad, R - Math.cos(ac) * rad);
      s.rotate(ac);
      s.drawImage(g, -widths[i] / 2, -h, widths[i], h);
      s.restore();
      a += wa + gap / rad;
    });
  }
  return c.toDataURL("image/png");
}
function layer(draw) { const c = document.createElement("canvas"); c.width = 1280; c.height = 720; draw(c.getContext("2d")); return c.toDataURL("image/png"); }
window.assets = {
  band, 
  bg: () => layer((ctx) => ctx.drawImage(background(), 0, 0)),
  ring: () => layer((ctx) => {
    const [r, g, b] = [104, 96, 232];
    ctx.fillStyle = \`rgba(\${r}, \${g}, \${b}, 0.08)\`; ctx.beginPath(); ctx.arc(X, Y, AR, 0, TAU); ctx.fill();
  }),
  border: () => layer((ctx) => {
    ctx.strokeStyle = "rgba(104, 96, 232, 0.75)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X, Y, AR, 0, TAU); ctx.stroke();
  }),
  tokens: () => layer((ctx) => { for (const [p, t] of AURA_TOKENS()) token(ctx, ...p, t); }),
};
</script></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const glyphDir = join(here, "..", "sprites", "fey");
const glyphs = readdirSync(glyphDir).filter((f) => f.endsWith(".png")).sort().map((f) => "data:image/png;base64," + readFileSync(join(glyphDir, f)).toString("base64"));
await page.evaluate(async (urls) => {
  window.GLYPH_IMGS = await Promise.all(urls.map((u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; })));
}, glyphs);
const save = (p, d) => writeFileSync(p, Buffer.from(d.split(",")[1], "base64"));
for (const k of ["bg", "ring", "border", "tokens"]) save(join(out, `${k}.png`), await page.evaluate((k) => assets[k](), k));
save(join(out, "band-static.png"), await page.evaluate(() => assets.band(0, false)));
const N = 480;
for (let i = 0; i < N; i++) save(join(out, "band", `${String(i + 1).padStart(4, "0")}.png`), await page.evaluate((ph) => assets.band(ph, true), i / N));
await browser.close();
console.log("assets done");
