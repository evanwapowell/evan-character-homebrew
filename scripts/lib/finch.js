/**
 * The "Finch version" animations: custom animations made for one character (a changeling witch who is secretly the
 * Forgotten Prince, with lost things as his theme) for Manifest Will and Familiar of Ongoing Misery. The files are in
 * `animations/finch/`; their source art and the Blender scenes that render them are in `art/finch/` in the repository.
 *
 * Sequencer plays them; JB2A isn't needed. Arcane Manifest Will has no Finch animation yet and keeps its JB2A one.
 */

const DIR = "modules/evan-character-homebrew/animations/finch";

/**
 * Manifest Will, by tradition: a 2-second intro that builds the aura from nothing, then a seamless 16-second loop. Both
 * are square, their edge at the emanation's edge.
 */
const AURAS = {
    divine: { intro: `${DIR}/divine-intro.webm`, loop: `${DIR}/divine-loop.webm` },
    occult: { intro: `${DIR}/occult-intro.webm`, loop: `${DIR}/occult-loop.webm` },
    primal: { intro: `${DIR}/primal-intro.webm`, loop: `${DIR}/primal-loop.webm` },
};
/** The opacity they were designed at, over the aura's own fill */
const AURA_OPACITY = 0.85;

/**
 * Familiar of Ongoing Misery: a looping wisp (1.6 × 1 squares, its core 0.3 squares right of the clip's centre) that
 * drifts to the creature, then the impact (2.4 × 3.6 squares, the creature's token 0.8 squares below its centre): the
 * control bar, the strings, and a fey sigil drawn up out of the creature.
 */
const CURSE = { wisp: `${DIR}/curse-wisp.webm`, impact: `${DIR}/curse-impact.webm` };

/** How long the wisp gathers at the familiar, and how fast it drifts: 2.5 seconds over 20 feet */
const WISP_GATHER_MS = 600;
const WISP_MS_PER_FOOT = 125;
const WISP_MIN_TRAVEL_MS = 1200;

function auraFiles(tradition) {
    return AURAS[tradition] ?? null;
}

/**
 * Point the Aura rule elements of an Aura: Manifest Will source at the Finch loops, for the traditions that have one.
 * With `sequencer`, the loop is played by Sequencer after the intro instead, so the aura gets no texture of its own
 * (otherwise the finished aura would show before the intro has built it). Returns the new rules, or null if unchanged.
 */
function finchAuraRules(rules, { sequencer }) {
    let changed = false;
    const updated = rules.map((rule) => {
        if (rule?.key !== "Aura" || rule.slug !== "manifest-will") return rule;
        const tradition = Object.keys(AURAS).find((t) => (rule.predicate ?? []).includes(`manifest-will:${t}`));
        if (!tradition) return rule;
        const appearance = { ...(rule.appearance ?? {}) };
        appearance.texture = sequencer
            ? null
            : { ...(appearance.texture ?? {}), src: AURAS[tradition].loop, alpha: AURA_OPACITY };
        changed = true;
        return { ...rule, appearance };
    });
    return changed ? updated : null;
}

/**
 * Build the aura on a token: the intro, then the loop, attached to the token and persisting until the aura effect is
 * deleted (Sequencer ends it then). `sequence` is a new Sequence.
 */
function playAura(sequence, { token, tradition, auraEffect }) {
    const files = AURAS[tradition];
    const size = Math.max(token.document.width, token.document.height) + 4; // the token plus 10 feet all round
    const attach = { bindRotation: false };
    return sequence
        .effect()
        .file(files.intro)
        .attachTo(token, attach)
        .size(size, { gridUnits: true })
        .opacity(AURA_OPACITY)
        .belowTokens()
        .waitUntilFinished(-100)
        .effect()
        .file(files.loop)
        .attachTo(token, attach)
        .size(size, { gridUnits: true })
        .opacity(AURA_OPACITY)
        .belowTokens()
        .fadeIn(100)
        .persist()
        .tieToDocuments(auraEffect)
        .origin(auraEffect.uuid)
        .name(`evan-character-homebrew.finch-manifest-will.${auraEffect.id}`)
        .play();
}

/** The familiar's wisp drifts to the creature, then the control bar draws a sigil up out of it */
function playCurse(sequence, { familiarToken, targetToken, distance }) {
    const travel = Math.max(WISP_MIN_TRAVEL_MS, distance * WISP_MS_PER_FOOT);
    return sequence
        .effect()
        .file(CURSE.wisp)
        .atLocation(familiarToken)
        .size({ width: 1.6, height: 1 }, { gridUnits: true })
        .spriteOffset({ x: -0.3 }, { gridUnits: true })
        .fadeIn(WISP_GATHER_MS)
        .scaleIn(0.3, WISP_GATHER_MS, { ease: "easeOutCubic" })
        .moveTowards(targetToken, { ease: "easeInOutSine", delay: WISP_GATHER_MS, rotate: false })
        .duration(WISP_GATHER_MS + travel)
        .loopProperty("sprite", "position.y", {
            from: -0.12,
            to: 0.12,
            duration: 700,
            pingPong: true,
            gridUnits: true,
            ease: "easeInOutSine",
        })
        .waitUntilFinished(-150)
        .effect()
        .file(CURSE.impact)
        .atLocation(targetToken, { offset: { y: -0.8 }, gridUnits: true })
        .size({ width: 2.4, height: 3.6 }, { gridUnits: true })
        .play();
}

export { AURAS, AURA_OPACITY, CURSE, auraFiles, finchAuraRules, playAura, playCurse };
