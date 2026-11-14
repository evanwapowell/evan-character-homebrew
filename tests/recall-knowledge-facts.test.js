import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { degreeOfSuccess, draft, exploitResult, QUESTIONS } from "../scripts/lib/recall-knowledge-facts.js";

/** A repeatable stand-in for Math.random */
function sequence(...values) {
    let i = 0;
    return () => values[i++ % values.length];
}

const EMPTY = {
    name: "Nothing",
    level: 0,
    traits: [],
    publicNotes: "",
    weaknesses: [],
    resistances: [],
    immunities: [],
    saves: {},
    abilities: [],
    spellcasting: [],
    senses: [],
    speeds: [],
    lieTypes: [],
    traditions: [],
};

const GHOUL = {
    ...EMPTY,
    name: "Ghoul",
    level: 1,
    traits: ["undead"],
    publicNotes: "<p>Ghouls feed on the dead.</p>",
    weaknesses: [{ type: "vitality", label: "Vitality", fullLabel: "Vitality 5", value: 5 }],
    immunities: [{ type: "death-effects", label: "Death Effects" }],
    saves: {
        fortitude: { label: "Fortitude", mod: 4 },
        reflex: { label: "Reflex", mod: 8 },
        will: { label: "Will", mod: 5 },
    },
    abilities: [
        { id: "jaws", name: "Jaws", slug: "jaws", kind: "strike", modifier: 9, damageTypes: ["Piercing"] },
        { id: "claw", name: "Claw", slug: "claw", kind: "strike", modifier: 9, damageTypes: ["Slashing"] },
        {
            id: "paralysis",
            name: "Ghoul Fever",
            slug: "ghoul-fever",
            kind: "action",
            category: "offensive",
            actionType: "passive",
            traits: ["disease"],
            description: "<p>@Check[fortitude|dc:16]</p>",
        },
    ],
    senses: [{ type: "darkvision", label: "Darkvision" }],
    speeds: [
        { type: "land", label: "land", value: 30 },
        { type: "burrow", label: "burrow", value: 5 },
    ],
    lieTypes: [
        { type: "fire", label: "Fire" },
        { type: "vitality", label: "Vitality" },
        { type: "void", label: "Void" },
    ],
    traditions: [
        { value: "arcane", label: "Arcane" },
        { value: "divine", label: "Divine" },
    ],
};

const NAMES = [
    { name: "Zombie Shambler", level: 1, traits: ["undead", "mindless"], rarity: "common" },
    { name: "Goblin Warrior", level: 1, traits: ["humanoid", "goblin"], rarity: "common" },
    { name: "Ghoul Stalker", level: 2, traits: ["undead"], rarity: "common" },
    { name: "Named Lich", level: 1, traits: ["undead"], rarity: "unique" },
];

describe("degreeOfSuccess", () => {
    it("reads 10 over and under the DC", () => {
        assert.equal(degreeOfSuccess({ total: 25, die: 10, dc: 15 }).degree, 3);
        assert.equal(degreeOfSuccess({ total: 24, die: 10, dc: 15 }).degree, 2);
        assert.equal(degreeOfSuccess({ total: 15, die: 10, dc: 15 }).degree, 2);
        assert.equal(degreeOfSuccess({ total: 14, die: 10, dc: 15 }).degree, 1);
        assert.equal(degreeOfSuccess({ total: 6, die: 10, dc: 15 }).degree, 1);
        assert.equal(degreeOfSuccess({ total: 5, die: 10, dc: 15 }).degree, 0);
    });

    it("moves a step on a natural 20 or 1, within the four degrees", () => {
        assert.equal(degreeOfSuccess({ total: 14, die: 20, dc: 15 }).degree, 2);
        assert.equal(degreeOfSuccess({ total: 40, die: 20, dc: 15 }).degree, 3);
        assert.equal(degreeOfSuccess({ total: 15, die: 1, dc: 15 }).degree, 1);
        assert.equal(degreeOfSuccess({ total: 0, die: 1, dc: 15 }).degree, 0);
    });

    it("applies an adjustment from the character's abilities", () => {
        const adjustments = { criticalFailure: { label: "Assurance", amount: 1 } };
        assert.deepEqual(degreeOfSuccess({ total: 2, die: 1, dc: 15, adjustments }), {
            degree: 1,
            adjustment: "Assurance",
        });
        assert.deepEqual(degreeOfSuccess({ total: 14, die: 10, dc: 15, adjustments }), {
            degree: 1,
            adjustment: null,
        });
    });
});

describe("draft", () => {
    it("on a success, tells the name and one true answer", () => {
        const result = draft({ profile: GHOUL, degree: "success", question: "weaknesses" });
        assert.deepEqual(result.name, { text: "Ghoul", false: false });
        assert.equal(result.lore, false);
        assert.equal(result.answers.length, 1);
        assert.equal(result.answers[0].false, false);
        assert.equal(result.answers[0].text, "It's weak to vitality.");
        assert.deepEqual(result.answers[0].reveal, { weaknesses: ["vitality"] });
    });

    it("on a critical success, adds the lore entry", () => {
        const result = draft({ profile: GHOUL, degree: 3, question: "saves" });
        assert.equal(result.name.text, "Ghoul");
        assert.equal(result.lore, true);
        assert.equal(result.answers[0].text, "Its weakest save is Fortitude, and its strongest is Reflex.");
    });

    it("has no lore entry to add when the creature has none", () => {
        const result = draft({ profile: { ...GHOUL, publicNotes: "" }, degree: "criticalSuccess", question: "saves" });
        assert.equal(result.lore, false);
    });

    it("on a critical failure, gives a false name and a lie", () => {
        const result = draft({
            profile: GHOUL,
            degree: "criticalFailure",
            question: "weaknesses",
            names: NAMES,
            random: sequence(0),
        });
        // Same type, close in level, not unique, and not a variant of its own name
        assert.deepEqual(result.name, { text: "Zombie Shambler", false: true });
        assert.equal(result.answers.length, 1);
        const [lie] = result.answers;
        assert.equal(lie.false, true);
        assert.notEqual(lie.text, "");
        assert.notEqual(lie.text, "It's weak to vitality.");
        assert.deepEqual(lie.reveal, {});
    });

    it("on a failure with Dubious Knowledge, gives one true and one false answer about different things", () => {
        for (const order of [0.1, 0.9]) {
            const result = draft({
                profile: GHOUL,
                degree: "failure",
                question: "weaknesses",
                dubious: true,
                random: sequence(0, order),
            });
            assert.equal(result.name, null);
            assert.equal(result.lore, false);
            assert.equal(result.answers.length, 2);
            const truth = result.answers.find((a) => !a.false);
            const lie = result.answers.find((a) => a.false);
            assert.equal(truth.question, "weaknesses");
            assert.equal(truth.text, "It's weak to vitality.");
            assert.notEqual(lie.question, "weaknesses");
            assert.notEqual(lie.question, "other");
        }
    });

    it("on a plain failure, tells nothing", () => {
        assert.deepEqual(draft({ profile: GHOUL, degree: "failure", question: "weaknesses" }), {
            name: null,
            lore: false,
            answers: [],
        });
    });

    it("doesn't crash on a creature with nothing to tell, for any question or degree", () => {
        for (const { id } of QUESTIONS) {
            for (const degree of ["criticalSuccess", "success", "failure", "criticalFailure"]) {
                for (const dubious of [false, true]) {
                    const result = draft({ profile: EMPTY, degree, question: id, dubious, random: sequence(0.5) });
                    assert.ok(Array.isArray(result.answers), `${id} ${degree}`);
                }
            }
        }
        const answer = draft({ profile: EMPTY, degree: "success", question: "weaknesses" }).answers[0];
        assert.equal(answer.text, "It has no weaknesses.");
    });
});

describe("exploitResult", () => {
    it("on a critical success, tells every weakness, resistance and immunity with values", () => {
        const result = exploitResult(GHOUL, "criticalSuccess");
        assert.match(result.text, /Weaknesses: vitality 5\./);
        assert.match(result.text, /No resistances\./);
        assert.match(result.text, /Immunities: death effects\./);
        assert.equal(result.values, true);
    });

    it("on a success, tells the highest weakness", () => {
        const result = exploitResult(GHOUL, "success");
        assert.match(result.text, /^Its highest weakness is vitality 5\./);
        assert.deepEqual(result.reveal, { weaknesses: ["vitality"] });
    });

    it("on a failure, only a personal antithesis; on a critical failure, off-guard", () => {
        assert.equal(exploitResult(GHOUL, "failure").values, false);
        assert.match(exploitResult(GHOUL, 0).text, /off-guard/);
    });
});
