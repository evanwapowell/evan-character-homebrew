/**
 * Familiar of Parasitic Might's save (scripts/parasitic-might.js), as the GM applies it. Up to 1.26.18 (issue #60), two
 * failed saves for one card arriving together both read the card before either recorded its result, so the creature
 * was made sickened twice (sickened 2).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, makeActor, makeScene } from "./harness/pf2e.mjs";

const MODULE_ID = "evan-character-homebrew";

let world;
afterEach(() => world?.close());

for (const version of ["v13", "v14"]) {
    describe(`Familiar of Parasitic Might: the save's result (${version})`, () => {
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({ version, users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
            const gm = await world.connect("gm", { scripts: ["parasitic-might.js"] });
            tick(2_000);
            await world.flush();
            const witch = makeActor(world, { name: "Finch" });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            const goblinToken = addToken(world, makeScene(world), goblin);
            // pf2e's ActorPF2e#increaseCondition, raising sickened by the value
            goblin.isImmuneTo = () => false;
            goblin.increaseCondition = async (slug, { value }) => {
                await new Promise((resolve) => setImmediate(resolve));
                const existing = goblin.itemTypes.condition.find((c) => c.slug === slug);
                if (existing) return void (existing.value += value);
                const condition = addItem(world, goblin, { name: "Sickened", type: "condition", slug });
                Object.assign(condition, { value, active: true, isLocked: false });
            };
            const record = { witch: witch.uuid, target: goblinToken.uuid, dc: 20, outcome: null, applied: false };
            const card = await gm.run(() =>
                ChatMessage.create({
                    content: "<p>Parasitic Might</p>",
                    flags: { [MODULE_ID]: { parasiticMight: record } },
                }),
            );
            const resolve = (outcome) =>
                gm.run(() => gm.scripts["parasitic-might.js"].resolveSave({ cardId: card.id, outcome }));
            return { goblin, card, resolve };
        }

        it("makes the creature sickened 1 once when two failures arrive together", async (t) => {
            const { goblin, card, resolve } = await setup(t);
            await Promise.all([resolve("failure"), resolve("criticalFailure")]);
            const sickened = goblin.itemTypes.condition.filter((c) => c.slug === "sickened");
            assert.deepEqual(
                sickened.map((c) => c.value),
                [1],
            );
            assert.equal(card.flags[MODULE_ID].parasiticMight.outcome, "criticalFailure");
            assert.equal(card.flags[MODULE_ID].parasiticMight.applied, true);
        });

        it("takes the sickened back when a reroll arriving with the failure succeeds", async (t) => {
            const { goblin, card, resolve } = await setup(t);
            const sickened = () => goblin.itemTypes.condition.filter((c) => c.slug === "sickened");
            await Promise.all([resolve("failure"), resolve("success")]);
            assert.equal(card.flags[MODULE_ID].parasiticMight.outcome, "success");
            assert.equal(card.flags[MODULE_ID].parasiticMight.applied, false);
            assert.equal(sickened().length, 0);
        });
    });
}
