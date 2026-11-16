/**
 * Shed Spirit's and Stitching Strike's requests to the GM (scripts/spirit-stitched-familiar.js). Up to 1.26.20 (issue
 * #64), the GM's session applied whatever outcome a player's client sent for a card, and healed whichever token it
 * named, ally or not, at any distance.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addToken, checkMessage, makeActor, makeScene } from "./harness/pf2e.mjs";

let world;
afterEach(() => world?.close());

/** Let socket messages, and the promises they start, run */
async function drain() {
    for (let i = 0; i < 40; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Shed Spirit and Stitching Strike: the GM's check of a player's request (${version})`, () => {
        /**
         * The player's witch, Finch, and her familiar; their Ezren beside her; a goblin and a hobgoblin (the GM's);
         * Valeros, an ally far away; and a second player who owns none of them. Tokens' document positions are pixels
         * to the GM's measure: those a square apart are adjacent, Valeros's is 500 feet away.
         */
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                    { id: "other", name: "Other Player" },
                ],
            });
            const gm = await world.connect("gm", { scripts: ["spirit-stitched-familiar.js"] });
            const player = await world.connect("player", { scripts: ["spirit-stitched-familiar.js"] });
            const other = await world.connect("other", { scripts: ["spirit-stitched-familiar.js"] });
            tick(2_000);
            await world.flush();
            const scene = makeScene(world);
            const make = (name, type, x, owners = []) => {
                const actor = makeActor(world, { name, type, owners });
                actor.system.attributes = { hp: { value: 10, max: 20 } };
                actor.hitPoints = { value: 10, max: 20, temp: 0 };
                actor.healed = [];
                actor.applyDamage = async ({ damage }) => void actor.healed.push(-damage);
                return { actor, token: addToken(world, scene, actor, { x }) };
            };
            const finch = make("Finch", "character", 0, ["player"]);
            const wisp = make("Wisp", "familiar", 0, ["player"]);
            wisp.actor.master = finch.actor;
            const ezren = make("Ezren", "character", 1, ["player"]);
            const goblin = make("Goblin", "npc", 2);
            const hobgoblin = make("Hobgoblin", "npc", 3);
            const valeros = make("Valeros", "character", 10_000);
            return { gm, player, other, finch, wisp, ezren, goblin, hobgoblin, valeros };
        }

        /** The activity's card, as the familiar's user posts it once the damage is rolled */
        const postCard = (session, { finch, wisp }, target, record = {}) =>
            session.run(() =>
                ChatMessage.create({
                    content: "<p>Shed Spirit</p><div data-ehb-familiar-strike></div>",
                    flags: {
                        [MODULE_ID]: {
                            familiarStrike: {
                                kind: "shedSpirit",
                                witch: finch.actor.uuid,
                                familiar: wisp.actor.uuid,
                                familiarToken: wisp.token.uuid,
                                item: null,
                                target: target.token.uuid,
                                dc: 20,
                                damage: null,
                                outcome: null,
                                dealt: null,
                                immobilized: null,
                                healed: null,
                                ...record,
                            },
                        },
                    },
                }),
            );

        /** A Will save rolled from a card's button, by a creature */
        function willSave(card, { actor, token }, { outcome = "failure" } = {}) {
            const save = checkMessage({ actor, type: "saving-throw", statistic: "will", outcome, dc: 20 });
            save.speaker = { scene: token.parent.id, token: token.id, actor: actor.id, alias: actor.name };
            save.flags.pf2e.context.identifier = `familiar-strike:${card.id}`;
            return save;
        }

        /** A message in chat, made by `session`'s user, without running the hooks (so nothing asks the GM) */
        function inChat(session, data) {
            const message = new session.globals.ChatMessage(data);
            message._id = `message${String(world.messages.size).padStart(9, "0")}`;
            message.author = session.user;
            world.messages.set(message._id, message);
            world.documents.set(message.uuid, message);
            return message;
        }

        async function ask(session, action, data) {
            const answer = session.run(() => session.scripts["settings.js"].askGM(action, data));
            await drain();
            return answer;
        }

        const record = (card) => card.flags[MODULE_ID].familiarStrike;

        describe("the save", () => {
            it("records a save the player rolls from the card, through the hook", async (t) => {
                const setupData = await setup(t);
                const { player, ezren } = setupData;
                const card = await postCard(player, setupData, ezren);
                await player.run(() => ChatMessage.create(willSave(card, ezren)));
                await drain();
                assert.equal(record(card).outcome, "failure");
            });

            it("records the outcome of the save's message, not the one sent", async (t) => {
                const setupData = await setup(t);
                const { player, ezren } = setupData;
                const card = await postCard(player, setupData, ezren);
                const save = inChat(player, willSave(card, ezren, { outcome: "success" }));
                const data = { cardId: card.id, outcome: "criticalFailure", saveMessageId: save.id };
                assert.equal((await ask(player, "familiarStrikeSave", data)).ok, true);
                assert.equal(record(card).outcome, "success");
            });

            it("refuses another card's save, or one by a creature that isn't the card's target", async (t) => {
                const setupData = await setup(t);
                const { player, ezren, goblin } = setupData;
                t.mock.method(console, "warn", () => {});
                const card = await postCard(player, setupData, ezren);
                const other = await postCard(player, setupData, ezren);
                const save = inChat(player, willSave(other, ezren));
                const data = { cardId: card.id, outcome: "failure", saveMessageId: save.id };
                assert.deepEqual(await ask(player, "familiarStrikeSave", data), {
                    ok: false,
                    reason: "refused",
                    error: "the save wasn't rolled from that card",
                });

                // The card is for the goblin: Ezren's save doesn't answer it
                const forGoblin = await postCard(player, setupData, goblin);
                const ezrens = inChat(player, willSave(forGoblin, ezren));
                const notTarget = { cardId: forGoblin.id, outcome: "failure", saveMessageId: ezrens.id };
                assert.deepEqual(await ask(player, "familiarStrikeSave", notTarget), {
                    ok: false,
                    reason: "refused",
                    error: "the save isn't the target's",
                });
                assert.equal(record(card).outcome, null);
                assert.equal(record(forGoblin).outcome, null);
            });

            it("refuses a card that a user who owns neither the familiar nor the witch made", async (t) => {
                const setupData = await setup(t);
                const { player, other, ezren } = setupData;
                t.mock.method(console, "warn", () => {});
                const forged = await postCard(other, setupData, ezren);
                const save = inChat(player, willSave(forged, ezren));
                const data = { cardId: forged.id, outcome: "failure", saveMessageId: save.id };
                assert.deepEqual(await ask(player, "familiarStrikeSave", data), {
                    ok: false,
                    reason: "refused",
                    error: "the card isn't the familiar's",
                });
                assert.equal(record(forged).outcome, null);
            });
        });

        describe("Shed Spirit's healing", () => {
            /** A card whose damage was dealt to the goblin: 10, so the spirit restores 5 */
            const dealtCard = (setupData) =>
                postCard(setupData.player, setupData, setupData.goblin, { outcome: "failure", dealt: 10 });

            it("heals the ally within 30 feet of the enemy that the familiar's player picks", async (t) => {
                const setupData = await setup(t);
                const { player, ezren } = setupData;
                const card = await dealtCard(setupData);
                const answer = await ask(player, "shedSpiritHeal", {
                    cardId: card.id,
                    allyTokenUuid: ezren.token.uuid,
                });
                assert.equal((await answer).ok, true);
                assert.deepEqual(ezren.actor.healed, [5]);
                assert.equal(record(card).healed.ally, ezren.token.uuid);
            });

            it("refuses an enemy, or an ally beyond 30 feet", async (t) => {
                const setupData = await setup(t);
                const { player, hobgoblin, valeros } = setupData;
                t.mock.method(console, "warn", () => {});
                const card = await dealtCard(setupData);
                const enemy = { cardId: card.id, allyTokenUuid: hobgoblin.token.uuid };
                assert.deepEqual(await ask(player, "shedSpiritHeal", enemy), {
                    ok: false,
                    reason: "refused",
                    error: "Hobgoblin isn't the witch's ally",
                });
                const far = { cardId: card.id, allyTokenUuid: valeros.token.uuid };
                assert.deepEqual(await ask(player, "shedSpiritHeal", far), {
                    ok: false,
                    reason: "refused",
                    error: "Valeros isn't within 30 feet of Goblin",
                });
                assert.deepEqual(hobgoblin.actor.healed, []);
                assert.deepEqual(valeros.actor.healed, []);
                assert.equal(record(card).healed, null);
            });

            it("counts the damage the enemy takes as pf2e does: past 0 Hit Points too", async (t) => {
                const setupData = await setup(t);
                const { gm, player, goblin } = setupData;
                // 24 damage to a goblin with 6 Hit Points left: pf2e's applyDamage updates it with `damageTaken` 24
                goblin.actor.hitPoints.value = 6;
                goblin.actor.applyDamage = async () => {
                    gm.Hooks.callAll("preUpdateActor", goblin.actor, {}, { damageTaken: 24 });
                    goblin.actor.hitPoints.value = 0;
                };
                const damage = inChat(gm, { content: "<p>Shed Spirit damage</p>", rolls: [] });
                damage.rolls = [{ total: 24, alter: () => assert.fail("a failure deals full damage") }];
                const card = await postCard(player, setupData, goblin, { damage: damage.id });
                await gm.run(() => ChatMessage.create(willSave(card, goblin)));
                await drain();
                assert.equal(record(card).outcome, "failure");
                assert.equal(record(card).dealt, 24, "not just the 6 Hit Points it had");
            });

            it("refuses a player who owns neither the familiar nor the witch", async (t) => {
                const setupData = await setup(t);
                const { other, ezren } = setupData;
                t.mock.method(console, "warn", () => {});
                const card = await dealtCard(setupData);
                const data = { cardId: card.id, allyTokenUuid: ezren.token.uuid };
                assert.deepEqual(await ask(other, "shedSpiritHeal", data), {
                    ok: false,
                    reason: "refused",
                    error: "Other Player doesn't own Wisp",
                });
                assert.deepEqual(ezren.actor.healed, []);
            });
        });
    });
}
