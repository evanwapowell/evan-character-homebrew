/**
 * Reads the effect links in a spell's description, for applying them to the spell's targets. pf2e links a spell's
 * effects in paragraphs of their own (`<p>@UUID[…]</p>`), and puts effects for heightened versions in the heightened
 * entries at the end, after an `<hr>`. Links inside sentences are references to other things, like cover.
 *
 * No Foundry dependencies, so it can be run in Node.
 */

const LINK = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
const SECTION = /<strong>\s*(Heightened\s*\(([^)]*)\)|Amp(?:\s*Heightened\s*\(([^)]*)\))?)\s*<\/strong>/gi;

/** "3rd" → 3; "+1" and anything else → null */
function fixedRank(text) {
    const match = String(text ?? "").match(/^\s*(\d+)(?:st|nd|rd|th)\s*$/i);
    return match ? Number(match[1]) : null;
}

function stripTags(html) {
    return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
}

/**
 * Every `@UUID` link in the description, in order: its UUID and label, whether it stands in a paragraph of its own,
 * and the heightened or amp entry it's in, if any (`{ label, rank }`, the rank only for a fixed rank like "3rd").
 */
export function parseLinks(html) {
    html = String(html ?? "");
    const firstRule = html.search(/<hr\b/i);
    const sections = [...html.matchAll(SECTION)]
        .filter((m) => firstRule >= 0 && m.index > firstRule)
        .map((m) => ({
            index: m.index,
            label: m[1].trim(),
            rank: /^amp/i.test(m[1]) ? null : fixedRank(m[2]),
            amp: /^amp/i.test(m[1]),
        }));

    const links = [];
    for (const match of html.matchAll(LINK)) {
        const start = html.lastIndexOf("<p", match.index);
        const closeBefore = html.lastIndexOf("</p>", match.index);
        const end = html.indexOf("</p>", match.index);
        let standalone = false;
        if (start >= 0 && start > closeBefore && end >= 0) {
            const paragraph = html.slice(html.indexOf(">", start) + 1, end);
            standalone = stripTags(paragraph.replace(LINK, "")).trim() === "";
        }
        const section = sections.findLast((s) => s.index < match.index) ?? null;
        links.push({
            uuid: match[1],
            label: match[2] ?? null,
            standalone,
            section: section ? { label: section.label, rank: section.rank, amp: section.amp } : null,
        });
    }
    // Each UUID once, where it first appears
    return links.filter((link, i) => links.findIndex((l) => l.uuid === link.uuid) === i);
}

/** "Spell Effect: Dinosaur Form (Ankylosaurus)" → "Spell Effect: Dinosaur Form" */
function stem(name) {
    return String(name ?? "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
}

/** "Aura: Manifest Will" and "Spell Effect: Manifest Will" → "manifest will" */
function bareName(name) {
    return String(name ?? "")
        .replace(/^[^:]*:\s*/, "")
        .trim()
        .toLowerCase();
}

/** Whether an effect is one degree of success's, like "Spell Effect: Mind Swap (Critical Success)" */
function isOutcomeEffect(name) {
    return /\((?:critical )?(?:success|failure)\)\s*$/i.test(String(name ?? ""));
}

/**
 * Whether an effect in a heightened entry is that entry's version of the spell's effect: another effect is the base
 * version (Iron Gut (3rd Rank) beside Iron Gut), or its name gives the rank. pf2e also puts a spell's only effect
 * after its heightened entries, as with Heroism, which then is the base effect.
 */
function isHeightenedVersion(effect, effects) {
    if (!effect.section?.rank || effect.section.amp) return false;
    if (/\(\d+(?:st|nd|rd|th) rank\)\s*$/i.test(effect.name ?? "")) return true;
    return effects.some((e) => e !== effect && !e.section && stem(e.name) === stem(effect.name));
}

/**
 * Which of a spell's effects to apply by default at a cast rank. `effects` are the links that are effects, each with
 * its `name`. Returns their UUIDs.
 *
 * - A heightened entry's version of the effect, for a rank the spell is cast at or above, replaces the base effect
 *   (Iron Gut (3rd Rank) for Iron Gut); of several such entries, the highest rank's.
 * - Base effects are the ones in paragraphs of their own, or when there are none, the effects linked in the text. When
 *   several are versions of one effect, like a battle form's, none is chosen and the user picks, unless one is the
 *   plain effect (Magic's Vessel rather than Magic's Vessel (Resistance)).
 * - Amp effects, one degree of success's effects and immunities (Shield's starts later) aren't chosen, nor the effect an
 *   aura hands out to creatures in it (Spell Effect: Manifest Will beside Aura: Manifest Will).
 */
export function defaultEffects(effects, castRank) {
    const chosen = new Set();
    const versions = effects.filter((e) => e.standalone && isHeightenedVersion(e, effects));
    const reached = versions.filter((e) => e.section.rank <= (castRank ?? 0));
    const top = Math.max(0, ...reached.map((e) => e.section.rank));
    const replacing = reached.filter((e) => e.section.rank === top);
    for (const effect of replacing) chosen.add(effect.uuid);
    const replaced = new Set(replacing.map((e) => stem(e.name)));

    const eligible = effects.filter(
        (e) =>
            !versions.includes(e) &&
            !e.section?.amp &&
            !(e.section && !e.standalone) &&
            !isOutcomeEffect(e.name) &&
            !/\bImmunity\b/i.test(e.name ?? "") &&
            !replaced.has(stem(e.name)),
    );
    const auras = new Set(effects.filter((e) => /^Aura:/i.test(e.name ?? "")).map((e) => bareName(e.name)));
    const standalone = eligible.filter((e) => e.standalone && (/^Aura:/i.test(e.name) || !auras.has(bareName(e.name))));
    const base = standalone.length > 0 || versions.length > 0 ? standalone : eligible;
    const groups = new Map();
    for (const effect of base) {
        const key = stem(effect.name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(effect);
    }
    for (const [key, group] of groups) {
        const plain = group.find((e) => String(e.name ?? "").trim() === key);
        if (group.length === 1) chosen.add(group[0].uuid);
        else if (plain) chosen.add(plain.uuid);
    }
    return effects.filter((e) => chosen.has(e.uuid)).map((e) => e.uuid);
}
