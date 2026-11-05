/* Preview of the shader version, composited the way Foundry would: pf2e's aura (fill, texture at 0.8 alpha, border),
 * then Sequencer's cast on top at full alpha, then the tokens */
let occult = null;
SCENES["gl-occult"] = {
    duration: 0.6 + MW_LOOP + 2,
    draw(ctx, t) {
        occult ??= new OccultRenderer();
        const m = [640, 400];
        const [r, g, b] = TRADITIONS.occult.color;
        ctx.drawImage(background(), 0, 0);
        caption(ctx, "Manifest Will (occult) — The Masquerade · shader version", `Cast, then the aura's ${MW_LOOP}-second seamless loop · 10-foot emanation`);
        const start = 0.6;
        const R = (G * 5) / 2;
        if (t >= start) {
            const lt = t - start;
            ctx.save();
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.10)`;
            ctx.beginPath();
            ctx.arc(...m, R, 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 0.8;
            ctx.drawImage(occult.render({ ph: (lt % MW_LOOP) / MW_LOOP }), m[0] - R, m[1] - R, 2 * R, 2 * R);
            ctx.restore();
            ctx.save();
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(...m, R, 0, TAU);
            ctx.stroke();
            ctx.restore();
            if (lt <= 2.3) ctx.drawImage(occult.render({ castT: lt }), m[0] - R, m[1] - R, 2 * R, 2 * R);
        }
        token(ctx, ...m, WITCH);
        token(ctx, m[0] - 150, m[1] + 50, VALET);
        token(ctx, m[0] + 100, m[1] - 150, ALLY2);
        token(ctx, m[0] + 450, m[1] + 50, ENEMY);
    },
};
SCENES["gl-debug"] = {
    duration: 1,
    draw(ctx, t) {
        occult ??= new OccultRenderer();
        ctx.fillStyle = "#222"; ctx.fillRect(0, 0, W, H);
        if (t >= 5) {
            ctx.drawImage(occult.render({ ph: 0 }), 20, 60, 600, 600);
            ctx.drawImage(occult.render({ ph: 0.99999 }), 660, 60, 600, 600);
            return;
        }
        ctx.drawImage(occult.render({ ph: 0.0625 }), 20, 60, 600, 600);
        ctx.drawImage(occult.render({ castT: t }), 660, 60, 600, 600);
    },
};
