// Render preview scenes to mp4, or stills for checking: node render.mjs <scene> [--stills t1,t2,...]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const [scene, flag, list] = process.argv.slice(2);
const FPS = 30;

const html = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1280" height="720"></canvas>
<script>${readFileSync(join(here, "effects.js"), "utf8")}</script>
<script>${readFileSync(join(here, "traditions.js"), "utf8")}</script>
<script>${readFileSync(join(here, "gl-occult.js"), "utf8")}</script>
<script>${readFileSync(join(here, "preview.js"), "utf8")}
${readFileSync(join(here, "gl-preview.js"), "utf8")}
${readFileSync(join(here, "kit.js"), "utf8")}
${readFileSync(join(here, "lost.js"), "utf8")}
${readFileSync(join(here, "boards.js"), "utf8")}
${readFileSync(join(here, "wtest.js"), "utf8")}
${readFileSync(join(here, "anim.js"), "utf8")}
window.frame = (name, t) => { const ctx = document.getElementById('c').getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = 1; ctx.clearRect(0,0,W,H); SCENES[name].draw(ctx, t);
  return document.getElementById('c').toDataURL('image/png'); };
window.duration = (name) => SCENES[name].duration;
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);

const png = async (t) => Buffer.from((await page.evaluate(([n, t]) => frame(n, t), [scene, t])).split(",")[1], "base64");

if (scene === "boards") {
    const names = await page.evaluate((only) => Object.keys(SCENES).filter((n) => n.startsWith("board-" + (only ?? ""))), flag);
    for (const n of names) {
        const data = await page.evaluate((n) => frame(n, 0), n);
        writeFileSync(join(out, `${n}.png`), Buffer.from(data.split(",")[1], "base64"));
    }
    writeFileSync(join(out, "boards.json"), JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(BOARDS).map(([k, b]) => [k, { title: b.title, crop: b.crop, labels: b.frames.map((f) => f.label) }])))));
} else if (flag === "--stills") {
    for (const t of list.split(",").map(Number)) writeFileSync(join(out, `${scene}-${t.toFixed(2)}.png`), await png(t));
} else {
    const duration = await page.evaluate((n) => duration(n), scene);
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", join(out, `${scene}.mp4`)],
        { stdio: ["pipe", "inherit", "inherit"] });
    for (let i = 0; i < Math.round(duration * FPS); i++) ff.stdin.write(await png(i / FPS));
    ff.stdin.end();
    await new Promise((res) => ff.on("close", res));
}
await browser.close();
