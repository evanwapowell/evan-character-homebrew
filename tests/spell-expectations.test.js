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
    // pf2e 8.x links an effect for each degree, which grants the critical failure's stunned 2; 7.x links none
    Synesthesia: {
        v13: { criticalFailure: ["stunned 2"] },
        v14: {
            success: ["effect: Spell Effect: Synesthesia (Success)"],
            failure: ["effect: Spell Effect: Synesthesia (Failure)"],
            criticalFailure: ["effect: Spell Effect: Synesthesia (Failure)"],
        },
    },
    "Leaden Steps": {
        success: ["effect: Spell Effect: Leaden Steps"],
        failure: ["effect: Spell Effect: Leaden Steps"],
        criticalFailure: ["effect: Spell Effect: Leaden Steps"],
    },
    // "becomes sickened 1 if it fails a Will save (or sickened 2 on a critical failure)"
    "Evil Eye": { failure: ["sickened 1"], criticalFailure: ["sickened 2"] },
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
