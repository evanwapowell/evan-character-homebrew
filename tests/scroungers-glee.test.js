/**
 * Scrounger's Glee's Dismiss (scripts/scroungers-glee.js), driven through the createChatMessage hook. In 1.26.8 the
 * ally's token was looked up as `getActiveTokens(true, true)[0]?.document`, but those are already token documents, so
 * a Strike posted with no speaker token ended the spell and healed nobody (issue #52).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, checkMessage, makeActor, makeScene } from "./harness/pf2e.mjs";

const SPELL_ID = "VNv96dJPi0WXKSFN";
const EFFECT_UUID = "Compendium.evan-character-homebrew.evans-character-homebrew.Item.AxUfnmwrn1XTPTNU";

/** Wait for the hook's promise chain (a dialog, a roll, a message) to settle */
async function settle(world, done) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Scrounger's Glee: Dismiss to heal (${version})`, () => {
        it("heals the ally when the Strike's message has no speaker token", async (t) => {
            const tick = useFakeTimers(t);
            const world = createWorld({ version, users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
            const gm = await world.connect("gm", { scripts: ["scroungers-glee.js"] });
            t.after(() => world.close());
            // A session waits to hear from the user's others before it acts
            tick(2_000);
            // The caster's user is asked, and says yes
            gm.run(() => (foundry.applications.api.DialogV2.confirm = async () => true));

            const witch = makeActor(world, { name: "Finch" });
            const fighter = makeActor(world, { name: "Ezren" });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            for (const actor of [witch, fighter]) {
                Object.assign(actor, { isOwner: true, testUserPermission: () => false });
                actor.isAllyOf = (other) => [witch, fighter].includes(other);
            }
            const healed = [];
            fighter.applyDamage = async (data) => void healed.push(data);

            const spell = addItem(world, witch, {
                name: "Scrounger's Glee",
                type: "spell",
                slug: "scroungers-glee",
                source: `Compendium.pf2e.spells-srd.Item.${SPELL_ID}`,
            });
            const effect = addEffect(world, goblin, {
                name: "Effect: Scrounger's Glee",
                slug: "effect-scroungers-glee",
                source: EFFECT_UUID,
                origin: { actor: witch, item: spell },
            });
            let deleted = false;
            Object.assign(effect, {
                origin: witch,
                level: 3,
                remainingDuration: { expired: false },
                canUserModify: () => true,
                delete: async () => {
                    deleted = true;
                    world.documents.delete(effect.uuid);
                    goblin.items.delete(effect.id);
                },
            });

            const fighterToken = addToken(world, makeScene(world), fighter);

            const strike = checkMessage({
                actor: fighter,
                type: "attack-roll",
                statistic: "longsword",
                domains: ["attack-roll", "strike-attack-roll"],
                options: ["action:strike"],
                die: 20,
                outcome: "criticalSuccess",
                target: goblin,
            });
            const message = await gm.run(() => ChatMessage.create(strike));
            assert.equal(message.token, null);

            await settle(world, () => healed.length > 0);
            assert.equal(deleted, true, "the spell ends");
            assert.equal(healed.length, 1, "the ally is healed");
            // Rank 3: 2d4, each die its middle on the stand-in
            assert.equal(healed[0].damage, -4);
            assert.equal(healed[0].token, fighterToken);
            assert.equal(healed[0].item, spell);
        });
    });
}
