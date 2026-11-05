import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const files = ["effects.js", "traditions.js", "gl-occult.js", "preview.js", "gl-preview.js", "kit.js", "lost.js"];
const html = `<!doctype html><html><body>${files.map((f) => `<script>${readFileSync(join(here, f), "utf8")}</script>`).join("\n")}
<script>
window.sheet = (style, seed) => {
  const c = document.createElement("canvas"); c.width = c.height = 1200;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1200, 1200);
  ctx.strokeStyle = ctx.fillStyle = "#fff"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const r = rng(seed), h = 120, seen = new Set(), glyphs = [];
  // 24 distinct glyphs, none a mirror of another
  while (glyphs.length < 24) {
    const L = SCRIPTS[style](r);
    const key = JSON.stringify(L);
    if (seen.has(key)) continue;
    if (style === "blocky" && L.cells.filter(Boolean).length < 3) continue;
    if (style === "dotted" && L.dots.filter(Boolean).length < 3) continue;
    seen.add(key); glyphs.push(L);
  }
  glyphs.forEach((L, i) => {
    const x = 120 + (i % 6) * 192, y = 230 + Math.floor(i / 6) * 260;
    ctx.save(); ctx.translate(x, y); ctx.lineWidth = 9;
    drawScriptLetter(ctx, style, L, h);
    ctx.restore();
  });
  return c.toDataURL("image/png");
};
</script></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
for (const [style, seed] of [["runic", 12], ["blocky", 13], ["dotted", 14], ["circuit", 16]]) {
  const d = await page.evaluate(([s, n]) => sheet(s, n), [style, seed]);
  writeFileSync(join(here, "..", "script-refs", `${style}.png`), Buffer.from(d.split(",")[1], "base64"));
}
await browser.close();
