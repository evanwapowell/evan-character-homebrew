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

/**
 * A player's Dismiss, which the active GM does (the target is the GM's): the GM's session checks the request against
 * the documents (#64). Until 1.26.20 it deleted whatever document the request named and healed any amount.
 */
for (const version of ["v13", "v14"]) {
    describe(`Scrounger's Glee: a player's Dismiss, checked by the GM (${version})`, () => {
        /** The GM and the witch's player, the goblin (the GM's) under the witch's Glee, and Ezren's critical Strike */
        async function setup(t) {
            const tick = useFakeTimers(t);
            const world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                ],
            });
            const gm = await world.connect("gm", { scripts: ["scroungers-glee.js"] });
            const player = await world.connect("player", { scripts: ["scroungers-glee.js"] });
            t.after(() => world.close());
            tick(2_000);
            // The player declines when their own client asks (the requests below are sent by hand)
            player.run(() => (foundry.applications.api.DialogV2.confirm = async () => false));

            const witch = makeActor(world, { name: "Finch", owners: ["player"] });
            const fighter = makeActor(world, { name: "Ezren", owners: ["player"] });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
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
                level: 3,
            });
            effect.canUserModify = (user) => !!user.isGM;
            const scene = makeScene(world);
            const fighterToken = addToken(world, scene, fighter, { x: 1 });
            const goblinToken = addToken(world, scene, goblin, { x: 2 });
            const strike = await gm.run(() =>
                ChatMessage.create(
                    checkMessage({
                        actor: fighter,
                        type: "attack-roll",
                        statistic: "longsword",
                        domains: ["attack-roll", "strike-attack-roll"],
                        options: ["action:strike"],
                        die: 20,
                        outcome: "criticalSuccess",
                        target: goblin,
                    }),
                ),
            );
            await settle(world, () => false);
            const valid = {
                effectUuid: effect.uuid,
                allyTokenUuid: fighterToken.uuid,
                healing: 4,
                strikeMessageId: strike.id,
            };
            const ask = async (data) => {
                const pending = player.run(() => player.scripts["settings.js"].askGM("scroungersGlee", data));
                let answer = null;
                pending.then((a) => (answer = a));
                await settle(world, () => answer !== null);
                return answer;
            };
            return { world, gm, player, witch, fighter, goblin, effect, fighterToken, goblinToken, healed, valid, ask };
        }

        it("ends the spell and heals the ally, for a Dismiss the player's client asks for", async (t) => {
            const { player, goblin, effect, healed, valid, ask } = await setup(t);
            assert.deepEqual(await ask(valid), { ok: true, result: null });
            assert.equal(goblin.items.has(effect.id), false);
            assert.equal(healed.length, 1);
            assert.equal(healed[0].damage, -4);
            assert.deepEqual(
                player.notifications.filter((n) => n.type === "warn"),
                [],
            );
        });

        it("deletes nothing but a Scrounger's Glee effect", async (t) => {
            const { world, goblin, effect, healed, valid, ask } = await setup(t);
            t.mock.method(console, "warn", () => {});
            const asActor = await ask({ ...valid, effectUuid: goblin.uuid });
            assert.deepEqual(asActor, { ok: false, reason: "refused", error: "that isn't a Scrounger's Glee effect" });
            const fear = addEffect(world, goblin, { name: "Effect: Fear", slug: "effect-fear" });
            assert.equal((await ask({ ...valid, effectUuid: fear.uuid })).reason, "refused");
            assert.ok(world.fromUuidSync(goblin.uuid), "the goblin is still there");
            assert.equal(goblin.items.has(fear.id), true);
            assert.equal(goblin.items.has(effect.id), true);
            assert.equal(healed.length, 0);
        });

        it("refuses healing the spell's dice can't roll", async (t) => {
            const { goblin, effect, healed, valid, ask } = await setup(t);
            t.mock.method(console, "warn", () => {});
            // Rank 3: 2d4, so 2 to 8
            const answer = await ask({ ...valid, healing: 500 });
            assert.deepEqual(answer, { ok: false, reason: "refused", error: "500 isn't a roll of 2d4" });
            assert.equal((await ask({ ...valid, healing: 1 })).reason, "refused");
            assert.equal(goblin.items.has(effect.id), true);
            assert.equal(healed.length, 0);
        });

        it("heals only the ally whose Strike it was", async (t) => {
            const { goblin, effect, goblinToken, healed, valid, ask } = await setup(t);
            t.mock.method(console, "warn", () => {});
            const answer = await ask({ ...valid, allyTokenUuid: goblinToken.uuid });
            assert.deepEqual(answer, { ok: false, reason: "refused", error: "the token healed isn't the ally's" });
            assert.equal(goblin.items.has(effect.id), true);
            assert.equal(healed.length, 0);
        });

        it("refuses a Dismiss with no critical Strike against the creature", async (t) => {
            const { gm, goblin, fighter, effect, healed, valid, ask } = await setup(t);
            t.mock.method(console, "warn", () => {});
            const { strikeMessageId: _strike, ...without } = valid;
            assert.deepEqual(await ask(without), {
                ok: false,
                reason: "refused",
                error: "no critical Strike against Goblin",
            });
            assert.equal((await ask({ ...valid, strikeMessageId: "nothing" })).reason, "refused");
            // A hit that isn't a critical success
            const hit = await gm.run(() =>
                ChatMessage.create(
                    checkMessage({
                        actor: fighter,
                        type: "attack-roll",
                        statistic: "longsword",
                        domains: ["attack-roll", "strike-attack-roll"],
                        options: ["action:strike"],
                        outcome: "success",
                        target: goblin,
                    }),
                ),
            );
            assert.equal((await ask({ ...valid, strikeMessageId: hit.id })).reason, "refused");
            assert.equal(goblin.items.has(effect.id), true);
            assert.equal(healed.length, 0);
        });

        it("refuses a player who doesn't own the spell's caster", async (t) => {
            const { witch, goblin, effect, healed, valid, ask } = await setup(t);
            t.mock.method(console, "warn", () => {});
            witch.testUserPermission = (user) => !!user.isGM;
            assert.deepEqual(await ask(valid), {
                ok: false,
                reason: "refused",
                error: "Player doesn't own its caster",
            });
            assert.equal(goblin.items.has(effect.id), true);
            assert.equal(healed.length, 0);
        });
    });
}
