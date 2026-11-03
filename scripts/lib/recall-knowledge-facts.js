/**
 * What a character learns from Recall Knowledge and Exploit Vulnerability: the answers to the questions players can
 * ask about a creature, believable lies for critical failures and Dubious Knowledge, and the degree of success. This
 * file has no Foundry dependencies, so it can be run in Node. scripts/recall-knowledge.js builds the creature's
 * profile from its actor:
 *
 * {
 *     name, level, traits: [slug], publicNotes: html,
 *     weaknesses: [{ type, label, fullLabel, value }],   // label: type and exceptions; fullLabel: with the value
 *     resistances: [{ type, label, fullLabel, value }],
 *     immunities: [{ type, label }],
 *     saves: { fortitude: { label, mod }, reflex: {...}, will: {...} },
 *     abilities: [{ id, name, slug, kind: "strike" | "action", category, actionType, cost, traits, description,
 *                  modifier, damageTypes }],                // description: the ability's text, as HTML
 *     spellcasting: [{ id, tradition, traditionLabel, categoryLabel }],
 *     senses: [{ type, label }],
 *     speeds: [{ type, label, value }],                 // label: "fly"; the land Speed has type "land"
 *     lieTypes: [{ type, label }],                      // damage types a lie can name
 *     traditions: [{ value, label }],
 * }
 */

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** The questions a player can ask. "Other" is answered by the GM. */
const QUESTIONS = [
    { id: "weaknesses", label: "What is it weak to?" },
    { id: "defenses", label: "What does it resist, or what is it immune to?" },
    { id: "saves", label: "Which of its saves is weakest, and which is strongest?" },
    { id: "abilities", label: "What's its most dangerous attack or ability?" },
    { id: "spells", label: "Does it cast spells?" },
    { id: "senses", label: "How does it sense and move?" },
    { id: "other", label: "Something else (write your question)" },
];

/** Abilities common to many creatures, which aren't what makes one dangerous */
const ORDINARY_ABILITIES = new Set([
    "attack-of-opportunity",
    "reactive-strike",
    "grab",
    "improved-grab",
    "knockdown",
    "improved-knockdown",
    "push",
    "improved-push",
    "trip",
]);

/** Creature types: a false name comes from a creature that shares one */
const CREATURE_TYPES = new Set([
    "aberration",
    "animal",
    "astral",
    "beast",
    "celestial",
    "construct",
    "dragon",
    "dream",
    "elemental",
    "ethereal",
    "fey",
    "fiend",
    "fungus",
    "giant",
    "humanoid",
    "monitor",
    "ooze",
    "plant",
    "shade",
    "spirit",
    "time",
    "undead",
]);

/** Precious materials: a creature can be weak to them, but a lie about immunities doesn't name them */
const MATERIALS = new Set(["silver", "cold-iron", "adamantine", "orichalcum"]);

const VISION_SENSES = new Set(["darkvision", "greater-darkvision", "low-light-vision", "see-invisibility"]);

/** The tradition a lie gives a creature that doesn't cast spells, from its type */
const TRADITION_BY_TRAIT = {
    aberration: "occult",
    astral: "occult",
    celestial: "divine",
    construct: "arcane",
    dragon: "arcane",
    dream: "occult",
    elemental: "primal",
    fey: "primal",
    fiend: "divine",
    fungus: "primal",
    monitor: "divine",
    ooze: "occult",
    plant: "primal",
    spirit: "occult",
    undead: "divine",
    animal: "primal",
    beast: "primal",
};

const list = (items) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const lower = (text) => String(text ?? "").toLowerCase();
const pick = (items, random) => items[Math.floor(random() * items.length) % items.length];

function ordinal(n) {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
    return `${n}${suffix}`;
}

/**
 * The degree of success, as pf2e works it out: 10 over or under the DC, a natural 20 or 1 moving it a step, then any
 * adjustment from the character's abilities. `adjustments` is pf2e's DegreeAdjustmentsRecord ({ all, success, ... },
 * each { label, amount }), or null. Returns the index into DEGREES and the adjustment's label, if one applied.
 */
function degreeOfSuccess({ total, die, dc, adjustments = null }) {
    let degree = total - dc >= 10 ? 3 : dc - total >= 10 ? 0 : total >= dc ? 2 : 1;
    if (die === 20) degree = Math.min(3, degree + 1);
    else if (die === 1) degree = Math.max(0, degree - 1);

    for (const outcome of ["all", ...DEGREES]) {
        const { label, amount } = adjustments?.[outcome] ?? {};
        if (!amount || !label) continue;
        if (outcome !== "all" && DEGREES.indexOf(outcome) !== degree) continue;
        if ((degree === 3 && amount === 1) || (degree === 0 && amount === -1)) continue;
        const fixed = DEGREES.indexOf(amount);
        return { degree: fixed >= 0 ? fixed : Math.min(3, Math.max(0, degree + amount)), adjustment: label };
    }
    return { degree, adjustment: null };
}

/* The answers */

function weaknessesAnswer(profile) {
    const { weaknesses } = profile;
    if (weaknesses.length === 0) return { text: "It has no weaknesses.", reveal: { weaknesses: ["*"] } };
    return {
        text: `It's weak to ${list(weaknesses.map((w) => lower(w.label)))}.`,
        reveal: { weaknesses: weaknesses.map((w) => w.type) },
    };
}

function defensesAnswer(profile) {
    const { resistances, immunities } = profile;
    if (resistances.length === 0 && immunities.length === 0) {
        return { text: "It has no resistances or immunities.", reveal: { resistances: ["*"], immunities: ["*"] } };
    }
    const parts = [];
    if (resistances.length > 0) parts.push(`It resists ${list(resistances.map((r) => lower(r.label)))}.`);
    if (immunities.length > 0) parts.push(`It's immune to ${list(immunities.map((i) => lower(i.label)))}.`);
    return {
        text: parts.join(" "),
        reveal: {
            resistances: resistances.length > 0 ? resistances.map((r) => r.type) : ["*"],
            immunities: immunities.length > 0 ? immunities.map((i) => i.type) : ["*"],
        },
    };
}

/** The saves, from weakest to strongest, grouped where they're equal */
function rankSaves(profile) {
    const saves = Object.entries(profile.saves).map(([slug, save]) => ({ slug, ...save }));
    const mods = [...new Set(saves.map((s) => s.mod))].sort((a, b) => a - b);
    return mods.map((mod) => saves.filter((s) => s.mod === mod));
}

function describeSaves(weakest, strongest) {
    const names = (saves) => list(saves.map((s) => s.label));
    const weak =
        weakest.length > 1 ? `Its ${names(weakest)} saves are its weakest` : `Its weakest save is ${names(weakest)}`;
    const strong =
        strongest.length > 1
            ? `its ${names(strongest)} saves are its strongest`
            : `its strongest is ${names(strongest)}`;
    return `${weak}, and ${strong}.`;
}

function savesAnswer(profile) {
    const ranks = rankSaves(profile);
    const slugs = Object.keys(profile.saves);
    if (ranks.length <= 1)
        return { text: "Its saves are all about as strong as each other.", reveal: { saves: slugs } };
    const weakest = ranks[0];
    const strongest = ranks[ranks.length - 1];
    return {
        text: describeSaves(weakest, strongest),
        reveal: { saves: [...weakest, ...strongest].map((s) => s.slug) },
    };
}

/** Its abilities, most dangerous first: offensive abilities that set it apart, then its Strikes, best first */
function rankAbilities(profile) {
    const special = profile.abilities
        .filter((a) => a.kind === "action" && a.category === "offensive" && !ORDINARY_ABILITIES.has(a.slug))
        .map((a, index) => ({ a, index, score: dangerScore(a) }))
        .sort((x, y) => y.score - x.score || x.index - y.index)
        .map((x) => x.a);
    const strikes = profile.abilities
        .filter((a) => a.kind === "strike")
        .sort((a, b) => (b.modifier ?? 0) - (a.modifier ?? 0));
    return [...special, ...strikes];
}

/** Traits of abilities that do lasting harm */
const DANGEROUS_TRAITS = new Set([
    "curse",
    "disease",
    "poison",
    "death",
    "incapacitation",
    "fear",
    "emotion",
    "mental",
]);

/**
 * How dangerous an offensive ability looks: one that forces a save (a DC in its text) or does lasting harm (a curse, a
 * disease, a poison) over one that doesn't, then by its action cost. Changing shape is how it fights, not the threat.
 */
function dangerScore(ability) {
    const text = String(ability.description ?? "");
    const save = /@Check\[(?:fortitude|reflex|will)|\bDC \d+|\bbasic (?:Fortitude|Reflex|Will)\b/i.test(text) ? 4 : 0;
    const harm = (ability.traits ?? []).some((t) => DANGEROUS_TRAITS.has(t)) ? 3 : 0;
    const shape = (ability.traits ?? []).includes("polymorph") && ability.actionType === "action" ? -3 : 0;
    return save + harm + shape + (ability.cost ?? 0);
}

function describeAbility(ability) {
    if (ability.kind !== "strike") return `Its most dangerous ability is ${ability.name}.`;
    const damage = ability.damageTypes?.length > 0 ? ` (${list(ability.damageTypes.map(lower))})` : "";
    return `Its most dangerous attack is its ${lower(ability.name)}${damage}.`;
}

function abilitiesAnswer(profile) {
    const [ability] = rankAbilities(profile);
    if (!ability) return { text: "It has no attacks or abilities to speak of.", reveal: {} };
    return { text: describeAbility(ability), reveal: { abilities: [ability.id] } };
}

function spellsAnswer(profile) {
    const entries = profile.spellcasting;
    if (entries.length === 0) return { text: "It doesn't cast spells.", reveal: { spells: ["*"] } };
    // By tradition: "arcane spells (prepared and innate)"
    const byTradition = new Map();
    for (const entry of entries) {
        const kinds = byTradition.get(entry.traditionLabel) ?? new Set();
        if (entry.categoryLabel) kinds.add(lower(entry.categoryLabel));
        byTradition.set(entry.traditionLabel, kinds);
    }
    const kinds = [...byTradition].map(
        ([tradition, how]) => `${lower(tradition)} spells${how.size > 0 ? ` (${list([...how])})` : ""}`,
    );
    return { text: `It casts ${list(kinds)}.`, reveal: { spells: entries.map((e) => e.id) } };
}

function describeMovement(speeds) {
    const land = speeds.find((s) => s.type === "land");
    const others = speeds.filter((s) => s.type !== "land" && s.value > 0);
    const otherText = list(others.map((s) => `a ${lower(s.label)} Speed of ${s.value} feet`));
    if (land?.value > 0) return `Its Speed is ${land.value} feet${others.length > 0 ? `, with ${otherText}` : ""}.`;
    if (others.length > 0) return `It has ${otherText}.`;
    return "It can't move on its own.";
}

function sensesAnswer(profile) {
    const senses =
        profile.senses.length > 0
            ? `It has ${list(profile.senses.map((s) => lower(s.label)))}.`
            : "It has no special senses.";
    return {
        text: `${senses} ${describeMovement(profile.speeds)}`,
        reveal: { senses: profile.senses.map((s) => s.type), speeds: profile.speeds.map((s) => s.type) },
    };
}

const ANSWERS = {
    weaknesses: weaknessesAnswer,
    defenses: defensesAnswer,
    saves: savesAnswer,
    abilities: abilitiesAnswer,
    spells: spellsAnswer,
    senses: sensesAnswer,
};

/**
 * The true answer to a question: { text, reveal }, where `reveal` lists what the answer tells, for the Bestiary: types
 * of weaknesses, resistances and immunities ("*" for "none"), save slugs, ability IDs, spellcasting entry IDs, sense
 * and movement types. "Other" questions are answered by the GM, so their text is empty.
 */
function answer(profile, question) {
    return ANSWERS[question]?.(profile) ?? { text: "", reveal: {} };
}

/* The lies */

function weaknessesLie(profile, random) {
    const real = new Set(profile.weaknesses.map((w) => w.type));
    // The most dangerous lie: weak to something it resists or is immune to
    const resisted = [...profile.resistances, ...profile.immunities]
        .map((r) => profile.lieTypes.find((t) => t.type === r.type))
        .filter((t) => t && !real.has(t.type));
    const candidates = resisted.length > 0 ? resisted : profile.lieTypes.filter((t) => !real.has(t.type));
    if (candidates.length === 0) return null;
    const type = pick(candidates, random);
    return { text: `It's weak to ${lower(type.label)}.`, fake: { weaknesses: [type.type] } };
}

function defensesLie(profile, random) {
    const resisted = new Set([...profile.resistances, ...profile.immunities].map((r) => r.type));
    // Resisting what it's weak to keeps the party away from its real weakness
    const weak = profile.weaknesses
        .map((w) => profile.lieTypes.find((t) => t.type === w.type))
        .filter((t) => t && !resisted.has(t.type));
    if (weak.length > 0) {
        const type = pick(weak, random);
        return { text: `It resists ${lower(type.label)}.`, fake: { resistances: [type.type] } };
    }
    // Immune to an energy, not a material: no one's "immune to silver"
    const candidates = profile.lieTypes.filter((t) => !resisted.has(t.type) && !MATERIALS.has(t.type));
    if (candidates.length === 0) return null;
    const type = pick(candidates, random);
    return { text: `It's immune to ${lower(type.label)}.`, fake: { immunities: [type.type] } };
}

function savesLie(profile, random) {
    const ranks = rankSaves(profile);
    if (ranks.length <= 1) {
        // All the same: name one as much weaker than the others
        const saves = ranks[0] ?? [];
        if (saves.length < 2) return null;
        const weakest = pick(saves, random);
        return {
            text: describeSaves(
                [weakest],
                saves.filter((s) => s !== weakest),
            ),
            fake: {},
        };
    }
    // The other way around
    return { text: describeSaves(ranks[ranks.length - 1], ranks[0]), fake: {} };
}

function abilitiesLie(profile, random) {
    const [real] = rankAbilities(profile);
    const others = profile.abilities.filter((a) => a !== real);
    // Something unthreatening: a defensive or passive ability, or its weakest attack
    const truth = real ? describeAbility(real) : null;
    const harmless = others.filter((a) => a.kind === "action" && a.category !== "offensive");
    // Its weakest attack that doesn't read the same as the real answer (two daggers, say)
    const strikes = others
        .filter((a) => a.kind === "strike" && describeAbility(a) !== truth)
        .sort((a, b) => (a.modifier ?? 0) - (b.modifier ?? 0));
    if (harmless.length > 0) return { text: `Its most dangerous ability is ${pick(harmless, random).name}.`, fake: {} };
    if (strikes.length > 0) return { text: describeAbility(strikes[0]), fake: {} };
    if (real) return { text: "It has no attacks or abilities to speak of.", fake: {} };
    return null;
}

function spellsLie(profile, random) {
    if (profile.spellcasting.length > 0) return { text: "It doesn't cast spells.", fake: {} };
    const likely = profile.traits.map((t) => TRADITION_BY_TRAIT[t]).find(Boolean);
    const tradition = profile.traditions.find((t) => t.value === likely) ?? pick(profile.traditions, random);
    if (!tradition) return null;
    return { text: `It casts ${lower(tradition.label)} spells.`, fake: {} };
}

function sensesLie(profile) {
    const sees = profile.senses.some((s) => VISION_SENSES.has(s.type));
    const senses = sees ? "It has no special senses, so it needs light to see." : "It has darkvision.";
    const flies = profile.speeds.some((s) => s.type === "fly" && s.value > 0);
    const land = profile.speeds.find((s) => s.type === "land")?.value ?? 0;
    let movement;
    if (flies) {
        movement = describeMovement(profile.speeds.filter((s) => s.type !== "fly"));
    } else {
        const climb = { type: "climb", label: "climb", value: Math.max(20, land) };
        movement = describeMovement([...profile.speeds.filter((s) => s.type !== "climb"), climb]);
    }
    return { text: `${senses} ${movement}`, fake: {} };
}

const LIES = {
    weaknesses: weaknessesLie,
    defenses: defensesLie,
    saves: savesLie,
    abilities: abilitiesLie,
    spells: spellsLie,
    senses: sensesLie,
};

/**
 * A believable lie in answer to a question: { text, fake }, where `fake` lists made-up weaknesses, resistances and
 * immunities by type, for the Bestiary. Null for "Other" questions, and when no lie fits.
 */
function lie(profile, question, random = Math.random) {
    return LIES[question]?.(profile, random) ?? null;
}

/**
 * A false name: another creature's, of the same type and about the same level, and not a unique one (a named NPC
 * would be an odd thing to mistake it for). `candidates` are [{ name, level, traits, rarity }]. Null when none is
 * close enough.
 */
function falseName(profile, candidates, random = Math.random) {
    const types = new Set(profile.traits.filter((t) => CREATURE_TYPES.has(t)));
    if (types.size === 0) return null;
    const own = lower(profile.name);
    // Not the creature itself, or a variant of it ("Wight" for a "Wight Commander")
    const usable = candidates.filter(
        (c) => c.name && c.rarity !== "unique" && !lower(c.name).includes(own) && !own.includes(lower(c.name)),
    );
    for (const range of [1, 2, 4]) {
        const close = usable.filter((c) => Math.abs((c.level ?? 0) - profile.level) <= range);
        const sameType = close.filter((c) => (c.traits ?? []).some((t) => types.has(t)));
        if (sameType.length > 0) return pick(sameType, random).name;
    }
    return null;
}

/**
 * What a Recall Knowledge check tells the character, for the GM to approve: { name, lore, answers }.
 *
 * - Success: the creature's name and the answer to the question. Critical success: its lore entry too.
 * - Critical failure: a false name (when one can be found) and a lie in answer to the question.
 * - Failure: nothing, or with Dubious Knowledge, the true answer and a lie about something else, in either order.
 *
 * Each answer is { question, text, false, reveal, fake }. `random` makes the lies repeatable in tests.
 */
function draft({ profile, degree, question, dubious = false, names = [], random = Math.random }) {
    const outcome = typeof degree === "number" ? DEGREES[degree] : degree;
    const truth = () => ({ question, false: false, fake: {}, ...answer(profile, question) });
    const untruth = (about = question) => {
        const told = lie(profile, about, random);
        return { question: about, false: true, reveal: {}, text: told?.text ?? "", fake: told?.fake ?? {} };
    };

    if (outcome === "criticalSuccess" || outcome === "success") {
        return {
            name: { text: profile.name, false: false },
            lore: outcome === "criticalSuccess" && !!profile.publicNotes,
            answers: [truth()],
        };
    }
    if (outcome === "criticalFailure") {
        const name = falseName(profile, names, random);
        return { name: name ? { text: name, false: true } : null, lore: false, answers: [untruth()] };
    }
    if (dubious) {
        // A lie about another subject, so the two don't contradict each other outright
        const others = QUESTIONS.map((q) => q.id).filter((id) => id !== "other" && id !== question && LIES[id]);
        const told = untruth(pick(others, random));
        const answers = random() < 0.5 ? [truth(), told] : [told, truth()];
        return { name: null, lore: false, answers };
    }
    return { name: null, lore: false, answers: [] };
}

/**
 * What Exploit Vulnerability tells the thaumaturge, by degree of success: { text, reveal, values }, where `values`
 * says the amounts of the weaknesses and resistances are revealed too.
 */
function exploitResult(profile, degree) {
    const outcome = typeof degree === "number" ? DEGREES[degree] : degree;
    const { weaknesses, resistances, immunities } = profile;
    if (outcome === "criticalSuccess") {
        const parts = [
            weaknesses.length > 0
                ? `Weaknesses: ${list(weaknesses.map((w) => lower(w.fullLabel)))}.`
                : "No weaknesses.",
            resistances.length > 0
                ? `Resistances: ${list(resistances.map((r) => lower(r.fullLabel)))}.`
                : "No resistances.",
            immunities.length > 0 ? `Immunities: ${list(immunities.map((i) => lower(i.label)))}.` : "No immunities.",
        ];
        const exploit =
            weaknesses.length > 0
                ? "You can exploit its mortal weakness or a personal antithesis."
                : "You can exploit a personal antithesis.";
        return {
            text: `${parts.join(" ")} ${exploit}`,
            reveal: {
                weaknesses: weaknesses.length > 0 ? weaknesses.map((w) => w.type) : ["*"],
                resistances: resistances.length > 0 ? resistances.map((r) => r.type) : ["*"],
                immunities: immunities.length > 0 ? immunities.map((i) => i.type) : ["*"],
            },
            values: true,
        };
    }
    if (outcome === "success") {
        if (weaknesses.length === 0) {
            return {
                text: "It has no weaknesses: you can exploit a personal antithesis.",
                reveal: { weaknesses: ["*"] },
                values: true,
            };
        }
        const highest = Math.max(...weaknesses.map((w) => w.value ?? 0));
        const top = weaknesses.filter((w) => (w.value ?? 0) === highest);
        const shown = top[0];
        return {
            text: `Its highest weakness is ${lower(shown.fullLabel)}. You can exploit its mortal weakness or a personal antithesis.`,
            reveal: { weaknesses: [shown.type] },
            values: true,
        };
    }
    if (outcome === "failure")
        return { text: "You can exploit only a personal antithesis.", reveal: {}, values: false };
    return { text: "You're off-guard until the start of your next turn.", reveal: {}, values: false };
}

export {
    DEGREES,
    QUESTIONS,
    answer,
    capitalize,
    degreeOfSuccess,
    draft,
    exploitResult,
    falseName,
    lie,
    ordinal,
    rankAbilities,
};
