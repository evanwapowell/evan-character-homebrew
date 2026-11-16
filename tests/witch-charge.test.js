/**
 * Designate Witch's Charge (scripts/witch-charge.js), from the action's card through the GM's work. Up to 1.26.18
 * (issue #61): designating removed every Effect: Witch's Charge without an origin, so another witch's charge dragged
 * from the compendium was deleted; the card was posted before the effects were made, so it announced a designation
 * that failed; a targeted token whose actor was deleted threw; and every unlinked token's actor in the world was built
 * to look for charges.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, itemCard, makeActor, makeScene } from "./harness/pf2e.mjs";

const USERS = [
    { id: "gm", name: "Gamemaster", isGM: true },
    { id: "player", name: "Player" },
];
const CHARGE_EFFECT_UUID = "Compendium.pf2e.feat-effects.Item.ugeStF0Rj8phBPWL";
const CHARGE_FEAT = { name: "Witch's Charge", type: "feat", source: "Compendium.pf2e.feats-srd.Item.52QyoGaysrfBOy5H" };

let world;
afterEach(() => world?.close());

async function drain() {
    for (let i = 0; i < 40; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

const charges = (actor) => actor.itemTypes.effect.filter((e) => e.name === "Effect: Witch's Charge");
const warnings = (session) => session.notifications.filter((n) => n.type === "warn").map((n) => n.message);

for (const version of ["v13", "v14"]) {
    describe(`Designate Witch's Charge (${version})`, () => {
        /** The GM, and a player with a witch; pf2e's effect in its compendium */
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({ version, users: USERS });
            const gm = await world.connect("gm", { scripts: ["witch-charge.js"] });
            const player = await world.connect("player", { scripts: ["witch-charge.js"] });
            tick(2_000);
            await world.flush();
            world.add({
                uuid: CHARGE_EFFECT_UUID,
                toObject: () => ({
                    _id: "ugeStF0Rj8phBPWL",
                    name: "Effect: Witch's Charge",
                    type: "effect",
                    system: { slug: "effect-witchs-charge", rules: [] },
                    flags: {},
                    _stats: {},
                }),
            });
            const scene = makeScene(world);
            const witch = makeActor(world, { name: "Finch", owners: ["player"], items: [CHARGE_FEAT] });
            witch.system.abilities = { int: { mod: 4 } };
            const action = addItem(world, witch, {
                name: "Designate Witch's Charge",
                type: "action",
                slug: "designate-witchs-charge",
            });
            addToken(world, scene, witch);
            return { tick, gm, player, scene, witch, action };
        }

        /** The player targets these tokens and uses the action */
        async function designate({ player, action }, tokens) {
            world.users.get("player").targets = new Set(tokens.map((token) => ({ document: token })));
            await player.run(() => ChatMessage.create(itemCard(action)));
            await drain();
        }

        it("gives the target the charge, then removes the witch's earlier one, then posts the card", async (t) => {
            const setupData = await setup(t);
            const { gm, scene, witch } = setupData;
            const ally = makeActor(world, { name: "Ezren" });
            const fighter = makeActor(world, { name: "Valeros" });
            const allyToken = addToken(world, scene, ally);
            const earlier = addEffect(world, fighter, {
                name: "Effect: Witch's Charge",
                source: CHARGE_EFFECT_UUID,
                origin: { actor: witch },
            });
            // What was on the creatures when the card was posted
            const atCard = [];
            gm.Hooks.on("createChatMessage", (message) => {
                if (message.content.includes("designates")) {
                    atCard.push({ ally: charges(ally).length, fighter: charges(fighter).length });
                }
            });

            await designate(setupData, [allyToken]);

            const [charge] = charges(ally);
            assert.ok(charge, "the ally is the charge");
            assert.equal(charge.system.context.origin.actor, witch.uuid);
            assert.equal(charge.system.context.target.token, allyToken.uuid);
            assert.equal(fighter.items.has(earlier.id), false, "the earlier charge is removed");
            assert.deepEqual(atCard, [{ ally: 1, fighter: 0 }]);
            const card = world.messages.find((m) => m.content.includes("designates"));
            assert.match(card.content, /Finch designates Ezren as their charge\./);
        });

        it("leaves a charge without an origin when another creature has Witch's Charge, and tells the GM", async (t) => {
            const setupData = await setup(t);
            const { scene, player } = setupData;
            makeActor(world, { name: "Hag", type: "npc", items: [CHARGE_FEAT] });
            const ally = makeActor(world, { name: "Ezren" });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            const dragged = addEffect(world, goblin, { name: "Effect: Witch's Charge", source: CHARGE_EFFECT_UUID });

            await designate(setupData, [addToken(world, scene, ally)]);

            assert.equal(charges(ally).length, 1);
            assert.equal(goblin.items.has(dragged.id), true, "the hag's charge stays");
            const note = world.messages.find((m) => m.content.includes("without an origin"));
            assert.ok(note, "the GM is told");
            assert.deepEqual(note.whisper, ["gm"]);
            assert.match(note.content, /still on Goblin/);
            assert.deepEqual(warnings(player), []);
        });

        it("removes charges without an origin when the witch is the only one with the feat", async (t) => {
            const setupData = await setup(t);
            const { scene } = setupData;
            const ally = makeActor(world, { name: "Ezren" });
            const fighter = makeActor(world, { name: "Valeros" });
            const dragged = addEffect(world, fighter, { name: "Effect: Witch's Charge", source: CHARGE_EFFECT_UUID });
            // Unlinked tokens: one whose delta holds a dragged charge, one without
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            const holding = addToken(world, scene, goblin, {
                unlinked: true,
                deltaItems: [{ name: "Effect: Witch's Charge", type: "effect", source: CHARGE_EFFECT_UUID }],
            });
            const other = addToken(world, scene, goblin, { unlinked: true });

            await designate(setupData, [addToken(world, scene, ally)]);

            assert.equal(charges(ally).length, 1);
            assert.equal(fighter.items.has(dragged.id), false);
            assert.equal(charges(holding.actor).length, 0, "the unlinked token's charge is removed");
            assert.equal(other.builds, 0, "an unlinked token without a charge isn't built");
            assert.equal(
                world.messages.find((m) => m.content.includes("without an origin")),
                undefined,
            );
        });

        it("skips a targeted token whose creature was deleted", async (t) => {
            const setupData = await setup(t);
            const { scene, player } = setupData;
            const ally = makeActor(world, { name: "Ezren" });
            const allyToken = addToken(world, scene, ally);
            const orphan = { name: "Gone", uuid: `${scene.uuid}.Token.gone`, actor: null, parent: scene };

            await designate(setupData, [orphan, allyToken]);

            assert.equal(charges(ally).length, 1);
            assert.deepEqual(warnings(player), []);
        });

        it("posts no card when the charge can't be given, and warns the player", async (t) => {
            const setupData = await setup(t);
            const { scene, player, witch } = setupData;
            const ally = makeActor(world, { name: "Ezren" });
            ally.createEmbeddedDocuments = async () => {
                throw new Error("the server refused");
            };
            const fighter = makeActor(world, { name: "Valeros" });
            const earlier = addEffect(world, fighter, {
                name: "Effect: Witch's Charge",
                source: CHARGE_EFFECT_UUID,
                origin: { actor: witch },
            });

            await designate(setupData, [addToken(world, scene, ally)]);

            assert.equal(
                world.messages.find((m) => m.content.includes("designates")),
                undefined,
            );
            assert.equal(fighter.items.has(earlier.id), true, "the earlier charge stays");
            assert.equal(warnings(player).length, 1);
            assert.match(warnings(player)[0], /Ezren/);
        });

        /**
         * A designation the player's client sends, crafted by hand: the GM's session checks the witch is the player's
         * and the targets are charges the witch can have (#64)
         */
        async function ask({ player }, data) {
            let answer = null;
            player.run(() => player.scripts["settings.js"].askGM("designateCharge", data)).then((a) => (answer = a));
            await drain();
            return answer;
        }

        it("refuses more charges than the witch can have, or the witch as her own charge", async (t) => {
            const setupData = await setup(t);
            t.mock.method(console, "warn", () => {});
            const { scene, witch } = setupData;
            const ally = makeActor(world, { name: "Ezren" });
            const fighter = makeActor(world, { name: "Valeros" });
            const tokens = [addToken(world, scene, ally), addToken(world, scene, fighter)];
            // Without Witch's Communion, one charge
            const two = await ask(setupData, { witchUuid: witch.uuid, targetTokenUuids: tokens.map((t) => t.uuid) });
            assert.deepEqual(two, {
                ok: false,
                reason: "refused",
                error: "target exactly one creature to designate as your charge.",
            });
            const [witchToken] = witch.getActiveTokens(true, true);
            const self = await ask(setupData, { witchUuid: witch.uuid, targetTokenUuids: [witchToken.uuid] });
            assert.deepEqual(self, { ok: false, reason: "refused", error: "you can't be your own charge." });
            assert.deepEqual(
                [ally, fighter, witch].map((a) => charges(a).length),
                [0, 0, 0],
            );
        });

        it("refuses a witch the player doesn't own, and keeps her charge", async (t) => {
            const setupData = await setup(t);
            t.mock.method(console, "warn", () => {});
            const { scene } = setupData;
            const hag = makeActor(world, { name: "Hag", type: "npc", items: [CHARGE_FEAT] });
            const fighter = makeActor(world, { name: "Valeros" });
            const ally = makeActor(world, { name: "Ezren" });
            const earlier = addEffect(world, fighter, {
                name: "Effect: Witch's Charge",
                source: CHARGE_EFFECT_UUID,
                origin: { actor: hag },
            });
            const answer = await ask(setupData, {
                witchUuid: hag.uuid,
                targetTokenUuids: [addToken(world, scene, ally).uuid],
            });
            assert.deepEqual(answer, { ok: false, reason: "refused", error: "Player doesn't own the witch" });
            assert.equal(fighter.items.has(earlier.id), true);
            assert.equal(charges(ally).length, 0);
        });
    });
}
