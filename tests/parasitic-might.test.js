/**
 * Familiar of Parasitic Might's save (scripts/parasitic-might.js), as the GM applies it. Up to 1.26.18 (issue #60), two
 * failed saves for one card arriving together both read the card before either recorded its result, so the creature
 * was made sickened twice (sickened 2). Up to 1.26.20 (issue #64), the GM's session applied whatever outcome a
 * player's client sent, for any card.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, checkMessage, makeActor, makeScene } from "./harness/pf2e.mjs";

const MODULE_ID = "evan-character-homebrew";

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

    describe(`Familiar of Parasitic Might: the GM's check of a player's save (${version})`, () => {
        /**
         * The player's witch, Finch, and their Ezren (below half his Hit Points, so drawn on), a GM's witch and a goblin,
         * and a card from Finch's familiar for Ezren
         */
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                ],
            });
            const gm = await world.connect("gm", { scripts: ["parasitic-might.js"] });
            const player = await world.connect("player", { scripts: ["parasitic-might.js"] });
            tick(2_000);
            await world.flush();
            const scene = makeScene(world);
            const finch = makeActor(world, { name: "Finch", owners: ["player"] });
            const hag = makeActor(world, { name: "Hag", type: "npc" });
            const ezren = makeActor(world, { name: "Ezren", owners: ["player"] });
            const ezrenToken = addToken(world, scene, ezren, { x: 1 });
            const goblinToken = addToken(world, scene, makeActor(world, { name: "Goblin", type: "npc" }), { x: 2 });
            ezren.isImmuneTo = () => false;
            ezren.increaseCondition = async (slug, { value }) => {
                const condition = addItem(world, ezren, { name: "Sickened", type: "condition", slug });
                Object.assign(condition, { value, active: true, isLocked: false });
            };
            const card = await postCard(player, finch, ezrenToken);
            return { gm, player, finch, hag, ezren, ezrenToken, goblinToken, card };
        }

        /** The familiar's card, as the witch's user posts it */
        const postCard = (session, witch, targetToken) =>
            session.run(() =>
                ChatMessage.create({
                    content: "<p>Parasitic Might</p><div data-ehb-parasitic-might></div>",
                    flags: {
                        [MODULE_ID]: {
                            parasiticMight: {
                                witch: witch.uuid,
                                target: targetToken.uuid,
                                dc: 20,
                                outcome: null,
                                applied: false,
                            },
                        },
                    },
                }),
            );

        /** A Fortitude save rolled from a card's button, by a creature */
        function fortitudeSave(card, actor, { outcome = "failure" } = {}) {
            const save = checkMessage({ actor, type: "saving-throw", statistic: "fortitude", outcome, dc: 20 });
            save.flags.pf2e.context.identifier = `parasitic-might:${card.id}`;
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

        async function ask(player, data) {
            const answer = player.run(() => player.scripts["settings.js"].askGM("parasiticMight", data));
            await drain();
            return answer;
        }

        const sickened = (actor) => actor.itemTypes.condition.filter((c) => c.slug === "sickened");

        it("applies a save the player rolls from the card, through the hook", async (t) => {
            const { player, ezren, card } = await setup(t);
            await player.run(() => ChatMessage.create(fortitudeSave(card, ezren)));
            await drain();
            assert.equal(card.flags[MODULE_ID].parasiticMight.outcome, "failure");
            assert.equal(sickened(ezren).length, 1);
        });

        it("applies the outcome of the save's message, not the one sent", async (t) => {
            const { player, ezren, card } = await setup(t);
            const save = inChat(player, fortitudeSave(card, ezren, { outcome: "success" }));
            const answer = await ask(player, { cardId: card.id, outcome: "criticalFailure", saveMessageId: save.id });
            assert.equal((await answer).ok, true);
            assert.equal(card.flags[MODULE_ID].parasiticMight.outcome, "success");
            assert.equal(sickened(ezren).length, 0);
        });

        it("refuses a save rolled from another card", async (t) => {
            const { player, finch, ezren, ezrenToken, card } = await setup(t);
            t.mock.method(console, "warn", () => {});
            const other = await postCard(player, finch, ezrenToken);
            const save = inChat(player, fortitudeSave(other, ezren));
            const answer = await ask(player, { cardId: card.id, outcome: "failure", saveMessageId: save.id });
            assert.deepEqual(await answer, {
                ok: false,
                reason: "refused",
                error: "the save wasn't rolled from that card",
            });
            assert.equal(card.flags[MODULE_ID].parasiticMight.outcome, null);
        });

        it("refuses a card whose maker doesn't own its witch, or a save by a creature that isn't the card's", async (t) => {
            const { player, finch, hag, ezren, ezrenToken, goblinToken } = await setup(t);
            t.mock.method(console, "warn", () => {});
            // A card the player posted for the GM's witch
            const forged = await postCard(player, hag, ezrenToken);
            const save = inChat(player, fortitudeSave(forged, ezren));
            const fromForged = await ask(player, { cardId: forged.id, outcome: "failure", saveMessageId: save.id });
            assert.deepEqual(await fromForged, {
                ok: false,
                reason: "refused",
                error: "that isn't a Familiar of Parasitic Might card",
            });

            // Finch's card is for the goblin: Ezren's save doesn't answer it
            const forGoblin = await postCard(player, finch, goblinToken);
            const ezrensSave = inChat(player, fortitudeSave(forGoblin, ezren));
            const notTheirs = await ask(player, {
                cardId: forGoblin.id,
                outcome: "failure",
                saveMessageId: ezrensSave.id,
            });
            assert.deepEqual(await notTheirs, {
                ok: false,
                reason: "refused",
                error: "the save isn't the card's creature's",
            });
            assert.equal(sickened(ezren).length, 0);
        });
    });
}
