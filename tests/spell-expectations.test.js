/**
 * Results written by hand for commonly used spells that the parsers get right and must keep getting right, checked
 * against pf2e's own data at the pinned commits. Unlike the baselines (which record whatever the parsers say today,
 * wrong results included), a failure here is a regression. Skipped when pf2e's data isn't fetched.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { OUTCOMES } from "../scripts/lib/spell-condition-parser.js";
import { PINS, loadData, skipWithoutData } from "../tools/pf2e-data.mjs";
import { linkedEffects, proposeConditions } from "../tools/parse-spells.mjs";

const caster = (amount, unit) => `for ${amount} ${unit} (caster's turn start)`;

/** What the Apply button proposes for each degree of success (degrees left out propose nothing) */
const CONDITIONS = {
    Fear: {
        success: ["frightened 1"],
        failure: ["frightened 2"],
        criticalFailure: ["frightened 3", `fleeing ${caster(1, "round")}`],
    },
    Slow: {
        success: [`slowed 1 ${caster(1, "round")}`],
        failure: [`slowed 1 ${caster(1, "minute")}`],
        criticalFailure: [`slowed 2 ${caster(1, "minute")}`],
    },
    Stupefy: {
        success: [`stupefied 1 ${caster(1, "round")}`],
        failure: [`stupefied 2 ${caster(1, "minute")}`],
        criticalFailure: [`stupefied 3 ${caster(1, "minute")}`],
    },
    Enfeeble: {
        success: [`enfeebled 1 ${caster(1, "round")}`],
        failure: [`enfeebled 2 ${caster(1, "minute")}`],
        criticalFailure: [`enfeebled 3 ${caster(1, "minute")}`],
    },
    Paralyze: {
        success: ["stunned 1"],
        failure: [`paralyzed ${caster(1, "round")}`],
        criticalFailure: [`paralyzed ${caster(4, "rounds")}`],
    },
    "Dizzying Colors": {
        success: [`dazzled ${caster(1, "round")}`],
        failure: ["stunned 1", `blinded ${caster(1, "round")}`, `dazzled ${caster(1, "minute")}`],
        criticalFailure: [`stunned ${caster(1, "round")}`, `blinded ${caster(1, "minute")}`],
    },
    "Noise Blast": {
        failure: [`deafened ${caster(1, "round")}`],
        criticalFailure: [`deafened ${caster(1, "minute")}`, "stunned 1"],
    },
    // Fleeing for as long as it's frightened
    "Vision of Death": {
        success: ["frightened 1"],
        failure: ["frightened 2"],
        criticalFailure: ["frightened 4", "fleeing while frightened"],
    },
    "Scramble Body": {
        failure: ["sickened 1"],
        criticalFailure: ["sickened 2", "slowed 1 while sickened"],
    },
    // "while it's sickened, it's also Slowed 1": the link comes before the condition
    "Divine Wrath": { failure: ["sickened 1"], criticalFailure: ["sickened 2", "slowed 1 while sickened"] },
    // "You are Stunned 1 and the spell ends": the caster's
    "Mind Games": { failure: ["stunned 1"], criticalFailure: ["stunned 2"] },
    // "It then takes the effects of a failure"
    "Laughing Fit": { failure: ["slowed 1"], criticalFailure: ["prone", "slowed 1"] },
    // "As success, with a duration of 1 hour", "As success, with an unlimited duration"
    "Curse of Lost Time": {
        success: [`clumsy 1 ${caster(1, "round")}`, `enfeebled 1 ${caster(1, "round")}`],
        failure: [`clumsy 1 ${caster(1, "hour")}`, `enfeebled 1 ${caster(1, "hour")}`],
        criticalFailure: ["clumsy 1", "enfeebled 1"],
    },
    // "As failure, but the creature is permanently Enfeebled 2 and Drained 2"
    "Chroma Leach": {
        success: [`enfeebled 2 ${caster(1, "round")}`],
        failure: [`enfeebled 2 ${caster(1, "minute")}`, "drained 1"],
        criticalFailure: ["enfeebled 2", "drained 2"],
    },
    // Petrified once slowed takes every action, so it's offered unchecked
    Petrify: {
        success: [`slowed 1 ${caster(1, "round")}`],
        failure: ["slowed 1", "petrified [later or conditional: unchecked]"],
        criticalFailure: ["slowed 2", "petrified [later or conditional: unchecked]"],
    },
    // "If it's asleep, it wakes up and is Paralyzed for 1 round"
    "Waking Nightmare": {
        success: ["frightened 1"],
        failure: ["frightened 2", `paralyzed ${caster(1, "round")} [later or conditional: unchecked]`],
        criticalFailure: ["frightened 3", `paralyzed ${caster(1, "round")} [later or conditional: unchecked]`],
    },
    // pf2e 8.x links an effect for each degree, which grants the critical failure's stunned 2; 7.x links none
    Synesthesia: {
        v13: { criticalFailure: ["stunned 2"] },
        v14: {
            success: ["effect: Spell Effect: Synesthesia (Success)"],
            failure: ["effect: Spell Effect: Synesthesia (Failure)"],
            criticalFailure: ["effect: Spell Effect: Synesthesia (Failure)"],
        },
    },
    // "As success, but the effect is permanent", each with its own effect; "As failure, and…" adds to failure's
    "Outcast's Curse": {
        success: ["effect: Spell Effect: Outcast's Curse (Success)"],
        failure: ["effect: Spell Effect: Outcast's Curse (Failure)"],
        criticalFailure: ["effect: Spell Effect: Outcast's Curse (Failure)"],
    },
    "Faerie Dust": {
        failure: ["effect: Spell Effect: Faerie Dust (Failure)"],
        criticalFailure: [
            "effect: Spell Effect: Faerie Dust (Failure)",
            "effect: Spell Effect: Faerie Dust (Critical Failure)",
        ],
    },
    // The effect after the entries isn't for a success that only takes half damage
    "Clinging Ice": {
        failure: ["effect: Spell Effect: Clinging Ice"],
        criticalFailure: ["effect: Spell Effect: Clinging Ice"],
    },
    // The effect after the entries is the caster's ("If this kills it, you gain…")
    "Death Knell": { success: ["dying"] },
    "Leaden Steps": {
        success: ["effect: Spell Effect: Leaden Steps"],
        failure: ["effect: Spell Effect: Leaden Steps"],
        criticalFailure: ["effect: Spell Effect: Leaden Steps"],
    },
    // "becomes sickened 1 if it fails a Will save (or sickened 2 on a critical failure)"
    "Evil Eye": { failure: ["sickened 1"], criticalFailure: ["sickened 2"] },
    // "On a critical failure, the target is also Enfeebled 1 until the start of your next turn"
    "Void Warp": { criticalFailure: [`enfeebled 1 ${caster(1, "round")}`] },
    // "On a failure, … and on a critical failure, it's also Immobilized for 1 round"
    "Entangling Flora": { criticalFailure: [`immobilized ${caster(1, "round")}`] },
    // "must succeed at a Reflex save or an Acrobatics check against your spell DC or fall Prone"
    Grease: { failure: ["prone"], criticalFailure: ["prone"] },
    // Dazzled for neutral creatures, blinded for evil ones: neither is checked
    "Radiant Heart of Devotion": {
        failure: [
            `dazzled ${caster(1, "round")} [later or conditional: unchecked]`,
            `blinded ${caster(1, "round")} [later or conditional: unchecked]`,
        ],
        criticalFailure: [
            `dazzled ${caster(1, "round")} [later or conditional: unchecked]`,
            `blinded ${caster(1, "round")} [later or conditional: unchecked]`,
        ],
    },
    // "Sickened 1 each time it damages you"; "As failure, but the sickened value is 2"
    "Wilding Word": {
        failure: ["sickened 1 [later or conditional: unchecked]"],
        criticalFailure: ["sickened 2 [later or conditional: unchecked]"],
    },
    // "Until the beginning of their next turn"
    "Curse of Recoil": {
        success: ["off-guard for 1 round (its turn start)"],
        failure: ["effect: Spell Effect: Curse of Recoil (Failure)", "off-guard for 1 round (its turn start)"],
        criticalFailure: ["effect: Spell Effect: Curse of Recoil (Critical Failure)"],
    },
    // "When it returns, it takes full damage and is Sickened 1": it always returns, at the end of the caster's turn
    "Cast into Time": { failure: ["sickened 1"], criticalFailure: ["sickened 2"] },
    // Stunned for 1 round, if it chooses that over giving up the item; "the duration is 4 rounds" is the spell's
    "Charitable Urge": {
        success: ["stunned 1"],
        failure: [`stunned ${caster(1, "round")} [later or conditional: unchecked]`],
        criticalFailure: [`stunned ${caster(1, "round")} [later or conditional: unchecked]`],
    },
    "Scrounger's Glee": { failure: ["frightened 1"], criticalFailure: ["frightened 2"] },
};

/** The effects listed for a spell without a save, and the defaults by rank cast at (where the choice changes) */
const LINKS = {
    Heroism: { listed: ["Spell Effect: Heroism"], defaults: { 3: ["Spell Effect: Heroism"] } },
    // The immunities aren't applied by default
    Shield: { listed: ["Spell Effect: Shield", "Effect: Shield Immunity"], defaults: { 1: ["Spell Effect: Shield"] } },
    Guidance: {
        listed: ["Spell Effect: Guidance", "Effect: Guidance Immunity"],
        defaults: { 1: ["Spell Effect: Guidance"] },
    },
    // The heightened entry's version replaces the base effect from 2nd rank
    Tailwind: {
        listed: ["Spell Effect: Tailwind", "Spell Effect: Tailwind (8 hours)"],
        defaults: { 1: ["Spell Effect: Tailwind"], 2: ["Spell Effect: Tailwind (8 hours)"] },
    },
    // The aura, not the cover linked in its text
    // The 24-hour effect is linked beside the plain one, and heightened to 5th the duration changes (issue #53)
    Darkvision: {
        listed: ["Spell Effect: Darkvision", "Spell Effect: Darkvision (24 hours)"],
        defaults: { 2: ["Spell Effect: Darkvision"], 5: ["Spell Effect: Darkvision (24 hours)"] },
    },
    "Manifest Will (this module)": { listed: ["Aura: Manifest Will"], defaults: { 1: ["Aura: Manifest Will"] } },
    // A battle form's variants: the user picks
    "Dinosaur Form": {
        listed: ["Ankylosaurus", "Brontosaurus", "Deinonychus", "Stegosaurus", "Triceratops", "Tyrannosaurus"].map(
            (form) => `Spell Effect: Dinosaur Form (${form})`,
        ),
        defaults: { 4: [] },
    },
    // pf2e 8.x has one effect for every form; 7.x has a variant per form
    "Animal Form": {
        v13: {
            listed: [
                ...["Ape", "Bear", "Bull", "Canine", "Cat", "Crab", "Crocodile", "Deer", "Frog", "Orca", "Seal"],
                ...["Shark", "Snake"],
            ].map((form) => `Spell Effect: Animal Form (${form})`),
            defaults: { 2: [] },
        },
        v14: { listed: ["Spell Effect: Animal Form"], defaults: { 2: ["Spell Effect: Animal Form"] } },
    },
};

const forVersion = (expected, version) => expected[version] ?? expected;

for (const version of Object.keys(PINS)) {
    describe(`hand-checked spells on pf2e ${version} (${PINS[version].branch})`, () => {
        const skip = skipWithoutData(version);
        let data;
        const spell = (name) => {
            const own = name.endsWith(" (this module)");
            const found = data.spells.find((s) => !!s.own === own && s.name === name.replace(" (this module)", ""));
            assert.ok(found, `pf2e ${version} has no spell named ${name}`);
            return found;
        };
        before(() => {
            if (!skip) data = loadData(version);
        });

        for (const [name, expected] of Object.entries(CONDITIONS)) {
            it(`${name}: the Apply button's conditions`, { skip }, () => {
                const actual = {};
                for (const outcome of OUTCOMES) {
                    const proposed = proposeConditions(spell(name), outcome, data);
                    if (proposed.length > 0) actual[outcome] = proposed;
                }
                assert.deepEqual(actual, forVersion(expected, version));
            });
        }
        for (const [name, expected] of Object.entries(LINKS)) {
            it(`${name}: the effects offered and applied by default`, { skip }, () => {
                assert.deepEqual(linkedEffects(spell(name), data), forVersion(expected, version));
            });
        }
    });
}
