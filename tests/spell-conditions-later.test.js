/**
 * The spell conditions' Apply button (scripts/spell-conditions.js), driven through the renderChatMessageHTML hook on a
 * save rolled against a spell. What the spell's text gives later or only if something happens (Petrify's petrified,
 * once slowed takes every action) is offered in the dialog unchecked, and marked so on the button (issue #49).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, checkMessage, makeActor } from "./harness/pf2e.mjs";

// pf2e's conditions the spell's text names, with their compendium IDs
const CONDITIONS = [
    ["slowed", "Slowed", "xYTAsEpcJE1Ccni3"],
    ["petrified", "Petrified", "dTwPJuKgBQCMxixg"],
];

// Petrify's failure, from pf2e's packs/pf2e/spells (shortened)
const PETRIFY = [
    "<p>The target's body slowly turns into a stone statue. The target must attempt a Fortitude save.</p>",
    "<hr />",
    "<p><strong>Critical Success</strong> The target is unaffected.</p>",
    "<p><strong>Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1} for 1 round as stone begins to form on their body.</p>",
    "<p><strong>Failure</strong> The target is slowed 1 and must attempt a Fortitude save at the end of each of its turns; this ongoing save has the incapacitation trait. On a failed save, the slowed condition increases by 1 (or 2 on a critical failure) as stone growths creep across their body. A successful save reduces the slowed condition by 1. When a creature becomes fully unable to act due to the slowed condition from <em>petrify</em>, the spell then ends in a flash of gray light, leaving the target @UUID[Compendium.pf2e.conditionitems.Item.dTwPJuKgBQCMxixg] permanently as they become a statue.</p>",
    "<p><strong>Critical Failure</strong> As failure, but the target is initially @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 2}.</p>",
].join("\n");

/** Wait for the hook's promise chain (building the proposal, the dialog) to settle */
async function settle(world, done) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Spell conditions: the Apply button (${version})`, () => {
        it("offers a condition the text gives later unchecked, and the others checked", async (t) => {
            const tick = useFakeTimers(t);
            const world = createWorld({ version, users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
            const gm = await world.connect("gm", { scripts: ["spell-conditions.js"] });
            t.after(() => world.close());
            tick(2_000);

            let dialog = null;
            gm.run(() => {
                for (const [slug, name, id] of CONDITIONS) {
                    const uuid = `Compendium.pf2e.conditionitems.Item.${id}`;
                    game.pf2e.ConditionManager.conditions.set(slug, { slug, name, id, uuid });
                }
                // Cancel the dialog once its content is seen
                foundry.applications.api.DialogV2.wait = async (options) => {
                    dialog = options;
                    return null;
                };
            });

            const caster = makeActor(world, { name: "Seoni" });
            const target = makeActor(world, { name: "Ogre", type: "npc" });
            const spell = addItem(world, caster, {
                name: "Petrify",
                type: "spell",
                slug: "petrify",
                system: {
                    description: { value: PETRIFY },
                    defense: { save: { statistic: "fortitude", basic: false } },
                    duration: { value: "varies", sustained: false },
                },
            });
            const save = checkMessage({
                actor: target,
                item: spell,
                type: "saving-throw",
                statistic: "fortitude",
                domains: ["fortitude", "saving-throw"],
                outcome: "failure",
                dc: 25,
            });
            const message = await gm.run(() => ChatMessage.create(save));

            const html = gm.run(() => {
                const element = document.createElement("li");
                element.innerHTML = `<div class="message-content"></div>`;
                Hooks.callAll("renderChatMessageHTML", message, element);
                return element;
            });
            await settle(world, () => !!html.querySelector("button"));
            const button = html.querySelector("button");
            assert.ok(button, "the save gets an Apply button");
            assert.equal(button.textContent, "Apply: Slowed 1, Petrified (later, or only if)");

            gm.run(() => button.click());
            await settle(world, () => !!dialog);
            assert.ok(dialog, "the dialog opens");
            const form = gm.run(() => new DOMParser().parseFromString(`<form>${dialog.content}</form>`, "text/html"));
            const rows = [...form.querySelectorAll("label")].map((label) => ({
                name: label.textContent.trim(),
                checked: label.querySelector("input[type=checkbox]").checked,
            }));
            assert.deepEqual(rows, [
                { name: "Slowed", checked: true },
                { name: "Petrified", checked: false },
            ]);
            assert.match(dialog.content, /Petrified<\/label>.*\(later, or only if\)/);
        });
    });
}
