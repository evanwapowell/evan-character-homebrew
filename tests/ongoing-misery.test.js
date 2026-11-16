/**
 * Familiar of Ongoing Misery's request to the GM (scripts/ongoing-misery.js), from a player's session. Until 1.26.20
 * (issue #64), the GM prolonged any effect the request named, on any creature, and posted the request's announcement as
 * it came, HTML and all.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, makeActor, makeScene } from "./harness/pf2e.mjs";

/** Let the request, the GM's work and the updates coming back from the server run */
async function settle(world) {
    for (let i = 0; i < 30; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Familiar of Ongoing Misery: a player's request, checked by the GM (${version})`, () => {
        /**
         * Finch (the player's witch) and Thimble, her familiar with the ability; a goblin 10 feet from Thimble and an
         * orc far away, each slowed by a spell's effect
         */
        async function setup(t) {
            const tick = useFakeTimers(t);
            const world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                ],
            });
            const gm = await world.connect("gm", { scripts: ["ongoing-misery.js"] });
            const player = await world.connect("player", { scripts: ["ongoing-misery.js"] });
            t.after(() => world.close());
            tick(2_000);
            await world.flush();
            t.mock.method(console, "warn", () => {});

            const scene = makeScene(world);
            const witch = makeActor(world, { name: "Finch", type: "character", owners: ["player"] });
            const familiar = makeActor(world, { name: "Thimble", type: "familiar", owners: ["player"] });
            Object.assign(witch, { familiar });
            Object.assign(familiar, { master: witch });
            addItem(world, familiar, { name: "Familiar of Ongoing Misery", type: "action" });
            const familiarToken = addToken(world, scene, familiar, { x: 0 });

            /** A creature with a spell's effect granting `granted` conditions */
            const victim = async (name, x, granted = [{ slug: "slowed", name: "Slowed" }]) => {
                const actor = makeActor(world, { name, type: "npc" });
                addToken(world, scene, actor, { x });
                const [effect] = await gm.run(() =>
                    actor.createEmbeddedDocuments("Item", [
                        {
                            name: "Spell Effect: Slow",
                            type: "effect",
                            system: {
                                slug: "slow",
                                duration: { value: 1, unit: "minutes", expiry: "turn-start", sustained: false },
                            },
                        },
                    ]),
                );
                const conditions = granted.map((c) => ({ ...c, flags: { pf2e: { grantedBy: { id: effect.id } } } }));
                Object.assign(actor, { conditions: { contents: conditions }, attributes: { immunities: [] } });
                return { actor, effect };
            };
            const ask = async (data) => {
                const answer = player.run(() => player.scripts["settings.js"].askGM("ongoingMisery", data));
                await settle(world);
                return answer;
            };
            const announcements = () => world.messages.filter((m) => /Familiar of Ongoing Misery/.test(m.content));
            return { world, gm, scene, witch, familiar, familiarToken, victim, ask, announcements };
        }

        it("prolongs the condition, announced in the GM's words, not the request's", async (t) => {
            const { familiarToken, victim, ask, announcements } = await setup(t);
            const goblin = await victim("Goblin", 2);
            const answer = await ask({
                effectUuid: goblin.effect.uuid,
                familiarTokenUuid: familiarToken.uuid,
                announcement: `<img src="x" onerror="alert(1)">`,
            });
            assert.equal(answer.ok, true);
            assert.equal(goblin.effect.system.duration.value, 11);
            assert.equal(goblin.effect.flags[MODULE_ID]?.ongoingMisery, true);
            const [message] = announcements();
            assert.match(message.content, /Thimble curses Goblin, prolonging Slowed by 1 round/);
            assert.doesNotMatch(message.content, /onerror/);
        });

        it("refuses a creature beyond 15 feet of the familiar, or an effect with no negative condition", async (t) => {
            const { familiarToken, victim, ask, announcements } = await setup(t);
            const orc = await victim("Orc", 10_000);
            const far = await ask({ effectUuid: orc.effect.uuid, familiarTokenUuid: familiarToken.uuid });
            assert.deepEqual(far, { ok: false, reason: "refused", error: "Orc isn't within 15 feet of Thimble" });
            assert.equal(orc.effect.system.duration.value, 1);

            const hasted = await victim("Kobold", 1, [{ slug: "quickened", name: "Quickened" }]);
            const positive = await ask({ effectUuid: hasted.effect.uuid, familiarTokenUuid: familiarToken.uuid });
            assert.deepEqual(positive, {
                ok: false,
                reason: "refused",
                error: "Spell Effect: Slow doesn't give a negative condition that can be prolonged",
            });
            assert.equal(hasted.effect.system.duration.value, 1);
            assert.deepEqual(announcements(), []);
        });

        it("refuses a familiar the player doesn't own, or one without the ability", async (t) => {
            const { world, scene, victim, ask, announcements } = await setup(t);
            const goblin = await victim("Goblin", 2);

            // The GM's witch and familiar, with the ability
            const hag = makeActor(world, { name: "Hag", type: "npc" });
            const crow = makeActor(world, { name: "Crow", type: "familiar" });
            Object.assign(hag, { familiar: crow });
            Object.assign(crow, { master: hag });
            addItem(world, crow, { name: "Familiar of Ongoing Misery", type: "action" });
            const crowToken = addToken(world, scene, crow, { x: 1 });
            const notTheirs = await ask({ effectUuid: goblin.effect.uuid, familiarTokenUuid: crowToken.uuid });
            assert.deepEqual(notTheirs, { ok: false, reason: "refused", error: "Player doesn't own Crow" });

            // The player's other familiar, without it
            const witch = makeActor(world, { name: "Ember", type: "character", owners: ["player"] });
            const cat = makeActor(world, { name: "Cat", type: "familiar", owners: ["player"] });
            Object.assign(witch, { familiar: cat });
            Object.assign(cat, { master: witch });
            const catToken = addToken(world, scene, cat, { x: 1 });
            const without = await ask({ effectUuid: goblin.effect.uuid, familiarTokenUuid: catToken.uuid });
            assert.deepEqual(without, {
                ok: false,
                reason: "refused",
                error: "that isn't a familiar of ongoing misery",
            });

            assert.equal(goblin.effect.system.duration.value, 1);
            assert.deepEqual(announcements(), []);
        });
    });
}
