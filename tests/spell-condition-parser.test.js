import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGrantedConditions, parseSpellOutcome, preselectDegree } from "../scripts/lib/spell-condition-parser.js";

// pf2e's conditions, with their compendium IDs
const CONDITIONS = [
    ["blinded", "Blinded", "XgEqL1kFApUbl5Z2"],
    ["concealed", "Concealed", "DmAIPqOBomZ7H95W"],
    ["confused", "Confused", "yblD8fOR1J8rDwEQ"],
    ["dazzled", "Dazzled", "TkIyaNPgTZFBCCuh"],
    ["fleeing", "Fleeing", "sDPxOjQ9kx2RZE8D"],
    ["frightened", "Frightened", "TBSHQspnbcqxsmjL"],
    ["sickened", "Sickened", "fesd1n5eVhpCSS18"],
    ["slowed", "Slowed", "xYTAsEpcJE1Ccni3"],
    ["stunned", "Stunned", "dfCMdR4wnpbYNTix"],
    ["prone", "Prone", "j91X7x0XSomq8d60"],
    ["hidden", "Hidden", "iU0fEDdBp3rXpTMC"],
].map(([slug, name, id]) => ({ slug, name, id }));

const LABELS = {
    criticalSuccess: ["Critical Success"],
    success: ["Success"],
    failure: ["Failure"],
    criticalFailure: ["Critical Failure"],
};

const parse = (html, outcome, spellDuration = "") =>
    parseSpellOutcome(html, outcome, { conditions: CONDITIONS, labels: LABELS, spellDuration });

const rounds = (value, relativeTo = "caster", expiry = "turn-start") => ({
    value,
    dice: null,
    unit: "rounds",
    expiry,
    relativeTo,
});
const minutes = (value) => ({ value, dice: null, unit: "minutes", expiry: "turn-start", relativeTo: "caster" });
const condition = (slug, value, duration = null, extra = {}) => ({
    slug,
    value,
    duration,
    linkedTo: null,
    fromSpellDuration: false,
    ...extra,
});

// The spells' descriptions in pf2e's source (packs/pf2e/spells), which link conditions by name
const FEAR = [
    "<p>You plant fear in the target; it must attempt a Will save.</p>",
    "<hr />",
    "<p><strong>Critical Success</strong> The target is unaffected.</p>",
    "<p><strong>Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Frightened]{Frightened 1}.</p>",
    "<p><strong>Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Frightened]{Frightened 2}.</p>",
    "<p><strong>Critical Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Frightened]{Frightened 3} and @UUID[Compendium.pf2e.conditionitems.Item.Fleeing] for 1 round.</p>",
    "<hr />",
    "<p><strong>Heightened (3rd)</strong> You can target up to five creatures.</p>",
].join("\n");

const SLOW = [
    "<p>You dilate the flow of time around the target, slowing its actions.</p>",
    "<hr />",
    "<p><strong>Critical Success</strong> The target is unaffected.</p>",
    "<p><strong>Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Slowed]{Slowed 1} for 1 round.</p>",
    "<p><strong>Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Slowed]{Slowed 1} for 1 minute.</p>",
    "<p><strong>Critical Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Slowed]{Slowed 2} for 1 minute.</p>",
    "<hr />",
    "<p><strong>Heightened (6th)</strong> You can target up to 10 creatures.</p>",
].join("\n");

const BLINDNESS = [
    "<p>You blind the target. The effect is determined by the target's Fortitude save. The target then becomes temporarily immune for 1 minute.</p>",
    "<hr />",
    "<p><strong>Critical Success</strong> The target is unaffected.</p>",
    "<p><strong>Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.Blinded] until its next turn begins.</p>",
    "<p><strong>Failure</strong> The target is Blinded for 1 minute.</p>",
    "<p><strong>Critical Failure</strong> The target is Blinded permanently.</p>",
].join("\n");

describe("parseSpellOutcome on pf2e's spells", () => {
    it("Fear: frightened by degree, and fleeing for 1 round on a critical failure", () => {
        assert.deepEqual(parse(FEAR, "criticalSuccess"), { effects: [], conditions: [] });
        assert.deepEqual(parse(FEAR, "success").conditions, [condition("frightened", 1)]);
        assert.deepEqual(parse(FEAR, "failure").conditions, [condition("frightened", 2)]);
        assert.deepEqual(parse(FEAR, "criticalFailure", "varies").conditions, [
            condition("frightened", 3),
            condition("fleeing", null, rounds(1)),
        ]);
    });

    it("Slow: slowed 1 for a round, slowed 1 or 2 for a minute", () => {
        assert.deepEqual(parse(SLOW, "criticalSuccess", "1 minute").conditions, []);
        assert.deepEqual(parse(SLOW, "success", "1 minute").conditions, [condition("slowed", 1, rounds(1))]);
        assert.deepEqual(parse(SLOW, "failure", "1 minute").conditions, [condition("slowed", 1, minutes(1))]);
        assert.deepEqual(parse(SLOW, "criticalFailure", "1 minute").conditions, [condition("slowed", 2, minutes(1))]);
    });

    it("Blindness: until the target's next turn, for a minute, or permanently", () => {
        assert.deepEqual(parse(BLINDNESS, "criticalSuccess").conditions, []);
        assert.deepEqual(parse(BLINDNESS, "success").conditions, [
            condition("blinded", null, rounds(1, "target", "turn-start")),
        ]);
        assert.deepEqual(parse(BLINDNESS, "failure").conditions, [condition("blinded", null, minutes(1))]);
        assert.deepEqual(parse(BLINDNESS, "criticalFailure").conditions, [condition("blinded", null)]);
    });
});

describe("parseSpellOutcome on other phrasings", () => {
    it("reads an entry that refers to another ('As failure, but...') and lets the later value win", () => {
        const html = [
            "<p><strong>Success</strong> The target is dazzled for 1 round.</p>",
            "<p><strong>Failure</strong> The target is stunned 1 and dazzled for 1 minute.</p>",
            "<p><strong>Critical Failure</strong> As failure, but the target is stunned 2.</p>",
        ].join("");
        assert.deepEqual(parse(html, "criticalFailure").conditions, [
            condition("stunned", 2),
            condition("dazzled", null, minutes(1)),
        ]);
    });

    it("links a condition to another ('as long as it's sickened'), putting the anchor first", () => {
        const html =
            "<p><strong>Failure</strong> The target is slowed 1 as long as it's sickened, and it's sickened 1.</p>";
        assert.deepEqual(parse(html, "failure").conditions, [
            condition("sickened", 1),
            condition("slowed", 1, null, { linkedTo: "sickened" }),
        ]);
    });

    it("links a condition to one named before it ('while it's sickened, it's also slowed 1')", () => {
        const html =
            "<p><strong>Critical Failure</strong> The creature is sickened 2; while it's sickened, it's also slowed 1.</p>";
        assert.deepEqual(parse(html, "criticalFailure").conditions, [
            condition("sickened", 2),
            condition("slowed", 1, null, { linkedTo: "sickened" }),
        ]);
    });

    it("leaves out the caster's conditions and others' as the target sees them", () => {
        const html = [
            "<p><strong>Critical Success</strong> The target resists being banished and you are stunned 1.</p>",
            "<p><strong>Success</strong> You spend your first action with the confused condition.</p>",
            "<p><strong>Failure</strong> The target can't see you and is dazzled. Creatures other than you are concealed from the target.</p>",
        ].join("");
        assert.deepEqual(parse(html, "criticalSuccess").conditions, []);
        assert.deepEqual(parse(html, "success").conditions, []);
        assert.deepEqual(parse(html, "failure").conditions, [condition("dazzled", null)]);
    });

    it("follows 'it then takes the effects of a failure', but not a conditional one", () => {
        const html = [
            "<p><strong>Failure</strong> The target is slowed 1.</p>",
            "<p><strong>Critical Failure</strong> The target is dazzled for 1 round. It then takes the effects of a failure.</p>",
            "<p><strong>Success</strong> If it was flying, it takes the effects of critical failure instead.</p>",
        ].join("");
        assert.deepEqual(parse(html, "criticalFailure").conditions, [
            condition("dazzled", null, rounds(1)),
            condition("slowed", 1),
        ]);
        assert.deepEqual(parse(html, "success").conditions, []);
    });

    it("uses the spell's duration for a condition with no timer of its own, but not for self-ending ones", () => {
        const html = "<p><strong>Failure</strong> The target is dazzled and frightened 1.</p>";
        assert.deepEqual(parse(html, "failure", "1 minute").conditions, [
            condition("dazzled", null, minutes(1), { fromSpellDuration: true }),
            condition("frightened", 1),
        ]);
    });

    it("reads results stated in a spell's text when it has no degree-of-success entries", () => {
        const html =
            "<p>The target becomes sickened 1 if it fails a Fortitude save (or sickened 2 on a critical failure).</p>";
        assert.deepEqual(parse(html, "success").conditions, []);
        assert.deepEqual(parse(html, "failure").conditions, [condition("sickened", 1)]);
        assert.deepEqual(parse(html, "criticalFailure").conditions, [condition("sickened", 2)]);
    });

    it("reads a critical failure's own result in a spell's text, and not on a failure", () => {
        const html = [
            "<p>The target takes 2d4 void damage with a basic Fortitude save. On a critical failure, the target is also dazzled for 1 round.</p>",
            "<p>Each round, it must attempt a Reflex save. On a failure, it takes a –10-foot penalty to its Speeds, and on a critical failure, it's also slowed 1 for 1 round.</p>",
            "<p>The target is stunned 1 if it critically fails its save.</p>",
        ].join("");
        assert.deepEqual(parse(html, "failure").conditions, []);
        assert.deepEqual(parse(html, "criticalFailure").conditions, [
            condition("dazzled", null, rounds(1)),
            condition("slowed", 1, rounds(1)),
            condition("stunned", 1),
        ]);
    });

    it("reads 'must succeed at a save or…' and 'otherwise' as a failure, and '(or X on a critical failure)' instead", () => {
        const fall = "<p>Each creature must succeed at a Reflex save or fall prone.</p>";
        assert.deepEqual(parse(fall, "failure").conditions, [condition("prone", null)]);
        assert.deepEqual(parse(fall, "criticalFailure").conditions, [condition("prone", null)]);
        const pillar =
            "<p>On a successful save, the creature is pushed; otherwise, it's frozen and becomes slowed 1.</p>";
        assert.deepEqual(parse(pillar, "failure").conditions, [condition("slowed", 1)]);
        const rainbow =
            "<p>Creatures must succeed at a Fortitude save or become dazzled for 1 round (or blinded for 1 round on a critical failure).</p>";
        assert.deepEqual(parse(rainbow, "failure").conditions, [condition("dazzled", null, rounds(1))]);
        assert.deepEqual(parse(rainbow, "criticalFailure").conditions, [condition("blinded", null, rounds(1))]);
        const fog =
            "<p>A creature that fails its save is also slowed 1 for 1 minute (slowed 2 on a critical failure).</p>";
        assert.deepEqual(parse(fog, "criticalFailure", "1 minute").conditions, [condition("slowed", 2, minutes(1))]);
    });

    it("leaves out negated, ignored and heightened conditions", () => {
        const html = [
            "<p><strong>Failure</strong> The target is no longer frightened, and it's hidden. It is dazzled for 1 round.</p>",
            "<hr /><p><strong>Heightened (5th)</strong> The target is also stunned 1.</p>",
        ].join("");
        assert.deepEqual(parse(html, "failure").conditions, [condition("dazzled", null, rounds(1))]);
    });

    it("applies a spell effect linked after the last entry to the degrees that aren't unaffected", () => {
        const effect = "Compendium.pf2e.spell-effects.Item.aaaaaaaaaaaaaaaa";
        const html = [
            "<p><strong>Critical Success</strong> The target is unaffected.</p>",
            "<p><strong>Success</strong> The target takes a –1 penalty.</p>",
            "<p><strong>Failure</strong> The target takes a –2 penalty.</p>",
            `<p>@UUID[${effect}]{Spell Effect: Penalty}</p>`,
        ].join("");
        assert.deepEqual(parse(html, "criticalSuccess").effects, []);
        assert.deepEqual(parse(html, "success").effects, [{ effect, label: "Spell Effect: Penalty" }]);
        assert.deepEqual(parse(html, "failure").effects, [{ effect, label: "Spell Effect: Penalty" }]);
    });
});

describe("getGrantedConditions", () => {
    it("finds conditions an effect grants, by ID or by name", () => {
        const source = {
            system: {
                rules: [
                    { key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL" },
                    { key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.Dazzled" },
                    { key: "GrantItem", uuid: "Compendium.pf2e.equipment-srd.Item.aaaaaaaaaaaaaaaa" },
                    { key: "FlatModifier", selector: "ac", value: -1 },
                ],
            },
        };
        assert.deepEqual([...getGrantedConditions(source, CONDITIONS)].sort(), ["dazzled", "frightened"]);
    });
});

describe("preselectDegree", () => {
    it("answers an unanswered degree-of-success choice", () => {
        const source = {
            system: {
                rules: [
                    {
                        key: "ChoiceSet",
                        choices: [{ value: "success" }, { value: "failure" }, { value: "critical-failure" }],
                    },
                    { key: "ChoiceSet", choices: [{ value: "failure" }], selection: "already" },
                ],
            },
        };
        preselectDegree(source, "criticalFailure");
        assert.equal(source.system.rules[0].selection, "critical-failure");
        assert.equal(source.system.rules[1].selection, "already");
    });
});
