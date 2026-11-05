// 2D assets for the Blender pilot: the fey-rune band (looping sequence and a static copy), the map, and overlays
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const s = c.getContext("2d");
  const R = 512, r = rng(707);
  s.strokeStyle = s.fillStyle = "#ffffff"; s.lineWidth = R * 0.009; s.lineCap = "round"; s.lineJoin = "round";
  for (let w = 0; w < 12; w++) {
    const n = 3 + Math.floor(r() * 4);
    const letters = Array.from({ length: n }, () => feyLetter(r));
    const off = r();
    s.globalAlpha = fades ? 0.25 + 0.75 * win(cyc(ph, off), 0.3, 0.6) : 1;
    textArc(s, R, R, R * 0.84, (w / 12) * TAU, letters, R * 0.085, drawFeyLetter, { spacing: 0.48, swash: true });
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
const save = (p, d) => writeFileSync(p, Buffer.from(d.split(",")[1], "base64"));
for (const k of ["bg", "ring", "border", "tokens"]) save(join(out, `${k}.png`), await page.evaluate((k) => assets[k](), k));
save(join(out, "band-static.png"), await page.evaluate(() => assets.band(0, false)));
const N = 480;
for (let i = 0; i < N; i++) save(join(out, "band", `${String(i + 1).padStart(4, "0")}.png`), await page.evaluate((ph) => assets.band(ph, true), i / N));
await browser.close();
console.log("assets done");
