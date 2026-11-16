/**
 * Sepulchral Mask's turn-start card (scripts/sepulchral-mask.js). Up to 1.26.19 (issue #62):
 *
 * - the GM had no Roll Damage button while a player who owns the caster was logged in, so a player away from the
 *   table held the card up;
 * - a save rolled from a turn card the GM had deleted was taken for a save against the caster's spell card, and its
 *   result written there;
 * - the Will Save button showed an NPC caster's spell DC to players, whatever pf2e's "Show DCs" setting.
 *
 * And up to 1.26.20 (issue #64), the GM's session applied whatever outcome and damage roll a player's client sent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, checkMessage, makeActor, makeScene, spellCard } from "./harness/pf2e.mjs";

async function settle(world, done = () => false) {
    for (let i = 0; i < 100 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

/** Finch (the player's) and a hobgoblin, each with Sepulchral Mask, and Ezren (the player's too) and a goblin */
async function setup(t, version) {
    const tick = useFakeTimers(t);
    const world = createWorld({
        version,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
        ],
    });
    const gm = await world.connect("gm", { scripts: ["sepulchral-mask.js"] });
    const player = await world.connect("player", { scripts: ["sepulchral-mask.js"] });
    t.after(() => world.close());
    tick(2_000);

    const scene = makeScene(world);
    gm.viewScene(scene);
    player.viewScene(scene);
    await world.flush();
    const make = (name, type, x, owners = []) => {
        const actor = makeActor(world, { name, type, owners });
        actor.hasPlayerOwner = owners.length > 0;
        return { actor, token: addToken(world, scene, actor, { x, y: 0 }) };
    };
    const finch = make("Finch", "character", 0, ["player"]);
    const ezren = make("Ezren", "character", 1, ["player"]);
    const goblin = make("Goblin", "npc", 2);
    const hobgoblin = make("Hobgoblin", "npc", 3);
    for (const { actor } of [finch, hobgoblin]) {
        const spell = addItem(world, actor, { name: "Sepulchral Mask", type: "spell", slug: "sepulchral-mask" });
        spell.rank = 1;
    }
    const spellOf = ({ actor }) => actor.itemTypes.spell[0];

    /** The card the GM posts as the creature starts its turn in the caster's emanation */
    const turnCard = (caster, target) =>
        gm.run(() =>
            ChatMessage.create({
                content: "<p>Sepulchral Mask</p><div data-ehb-sepulchral-mask></div>",
                flags: {
                    [MODULE_ID]: {
                        sepulchralMask: {
                            turn: "turn",
                            caster: caster.actor.uuid,
                            casterToken: caster.token.uuid,
                            spell: spellOf(caster).uuid,
                            rank: 1,
                            dc: 20,
                            target: target.token.uuid,
                            outcome: null,
                            damage: null,
                            damageApplied: null,
                        },
                    },
                },
            }),
        );

    /** The card as a session renders it: its buttons and notes */
    const render = (card, session) => {
        const html = session.run(() => document.createElement("li"));
        html.innerHTML = `<div class="message-content">${card.content}</div>`;
        session.Hooks.callAll("renderChatMessageHTML", card, html);
        return [...html.querySelectorAll("[data-ehb-sepulchral-mask] > *")].map((e) => e.textContent.trim());
    };
    return { world, gm, player, finch, ezren, goblin, hobgoblin, spellOf, turnCard, render };
}

for (const version of ["v13", "v14"]) {
    describe(`Sepulchral Mask: the turn-start card (${version})`, () => {
        it("the GM can roll the damage for a player who's logged in, and the player can too", async (t) => {
            const { world, gm, player, finch, goblin, turnCard, render } = await setup(t, version);
            const card = await turnCard(finch, goblin);
            assert.deepEqual(render(card, gm), ["Roll Damage for Player: Goblin", "Will Save DC 20: Goblin"]);
            assert.deepEqual(render(card, player), ["Roll Damage: Goblin", "Waiting for Goblin's Will save."]);

            player.disconnect();
            await world.flush();
            assert.deepEqual(render(card, gm), ["Roll Damage: Goblin", "Will Save DC 20: Goblin"]);
        });

        it("only the first damage roll to reach the GM is used", async (t) => {
            const { world, gm, finch, goblin, turnCard } = await setup(t, version);
            const card = await turnCard(finch, goblin);
            const first = await gm.run(() => ChatMessage.create({ content: "<p>2</p>" }));
            const second = await gm.run(() => ChatMessage.create({ content: "<p>3</p>" }));
            const { resolveDamage } = gm.scripts["sepulchral-mask.js"];
            const answers = [];
            for (const roll of [first, second]) {
                answers.push(await gm.run(() => resolveDamage({ cardId: card.id, damageMessageId: roll.id })));
                await settle(world);
            }
            assert.deepEqual(answers, [{ recorded: true }, { recorded: false }]);
            assert.equal(card.flags[MODULE_ID].sepulchralMask.damage, first.id);
        });

        it("hides an NPC caster's DC from players unless pf2e shows DCs", async (t) => {
            const { gm, player, finch, ezren, hobgoblin, turnCard, render } = await setup(t, version);
            const npcCard = await turnCard(hobgoblin, ezren);
            assert.deepEqual(render(npcCard, player), ["Waiting for Hobgoblin's damage roll.", "Will Save: Ezren"]);
            assert.deepEqual(render(npcCard, gm).at(-1), "Will Save DC 20: Ezren");
            player.run(() => (game.pf2e.settings = { metagame: { dcs: true } }));
            assert.deepEqual(render(npcCard, player).at(-1), "Will Save DC 20: Ezren");

            // A player's caster's DC is the players' to know
            player.run(() => (game.pf2e.settings = { metagame: { dcs: false } }));
            const playerCard = await turnCard(finch, ezren);
            assert.deepEqual(render(playerCard, player).at(-1), "Will Save DC 20: Ezren");
        });

        it("a save rolled from a deleted turn card is applied nowhere", async (t) => {
            const { world, gm, player, ezren, hobgoblin, spellOf, turnCard } = await setup(t, version);
            const spell = spellOf(hobgoblin);
            const spellMessage = await gm.run(() =>
                ChatMessage.create(spellCard(world, spell, { actualCast: false, entryId: null })),
            );
            const card = await turnCard(hobgoblin, ezren);
            await gm.run(() => card.delete());
            await settle(world);

            const save = checkMessage({
                actor: ezren.actor,
                item: spell,
                type: "saving-throw",
                statistic: "will",
                outcome: "failure",
                dc: 20,
            });
            Object.assign(save.flags.pf2e.context, {
                identifier: `sepulchral-mask:${card.id}`,
                origin: { actor: hobgoblin.actor.uuid, token: null, item: spell.uuid },
            });
            await player.run(() => ChatMessage.create(save));
            await settle(world);

            assert.equal(spellMessage.flags[MODULE_ID]?.sepulchralMask, undefined, "the spell's card is untouched");
            assert.equal(ezren.actor.itemTypes.effect.length, 0);
            assert.ok(player.notifications.some((n) => n.type === "warn" && /turn card was deleted/.test(n.message)));
        });
    });

    describe(`Sepulchral Mask: the GM's check of a player's save and damage (${version})`, () => {
        /** A Will save by the player's Ezren against the hobgoblin's mask, rolled from a turn card */
        function willSave({ ezren, hobgoblin, spellOf }, card, { outcome = "failure" } = {}) {
            const spell = spellOf(hobgoblin);
            const save = checkMessage({
                actor: ezren.actor,
                item: spell,
                type: "saving-throw",
                statistic: "will",
                outcome,
                dc: 20,
            });
            save.speaker = {
                scene: ezren.token.parent.id,
                token: ezren.token.id,
                actor: ezren.actor.id,
                alias: "Ezren",
            };
            Object.assign(save.flags.pf2e.context, {
                identifier: `sepulchral-mask:${card.id}`,
                origin: { actor: hobgoblin.actor.uuid, token: null, item: spell.uuid },
            });
            return save;
        }

        /** A message in chat, made by `session`'s user, without running the hooks (so nothing asks the GM) */
        function inChat(world, session, data) {
            const message = new session.globals.ChatMessage(data);
            message._id = `message${String(world.messages.size).padStart(9, "0")}`;
            message.author = session.user;
            world.messages.set(message._id, message);
            world.documents.set(message.uuid, message);
            return message;
        }

        /** What the player's client asks the GM for, with an outcome of its own */
        const saveRequest = ({ ezren, hobgoblin, spellOf }, card, data = {}) => ({
            casterUuid: hobgoblin.actor.uuid,
            spellUuid: spellOf(hobgoblin).uuid,
            rank: 1,
            targetTokenUuid: ezren.token.uuid,
            outcome: "criticalSuccess",
            total: 30,
            cardId: card.id,
            fromTurnCard: true,
            ...data,
        });

        async function ask(world, player, action, data) {
            const answer = player.run(() => player.scripts["settings.js"].askGM(action, data));
            await settle(world);
            return answer;
        }

        it("records the outcome of a save the player rolls, through the hook", async (t) => {
            const setupData = await setup(t, version);
            const { world, player, ezren, hobgoblin, turnCard } = setupData;
            const card = await turnCard(hobgoblin, ezren);
            await player.run(() => ChatMessage.create(willSave(setupData, card)));
            await settle(world);
            assert.equal(card.flags[MODULE_ID].sepulchralMask.outcome, "failure");
        });

        it("records the outcome of the save's message, not the one sent", async (t) => {
            const setupData = await setup(t, version);
            const { world, player, ezren, hobgoblin, turnCard } = setupData;
            const card = await turnCard(hobgoblin, ezren);
            const save = inChat(world, player, willSave(setupData, card));
            const answer = await ask(
                world,
                player,
                "sepulchralMask",
                saveRequest(setupData, card, { saveMessageId: save.id }),
            );
            assert.equal((await answer).ok, true);
            assert.equal(card.flags[MODULE_ID].sepulchralMask.outcome, "failure");
        });

        it("refuses a save the player didn't roll, or one from a turn card a GM didn't make", async (t) => {
            const setupData = await setup(t, version);
            const { world, gm, player, ezren, hobgoblin, turnCard } = setupData;
            t.mock.method(console, "warn", () => {});
            const card = await turnCard(hobgoblin, ezren);
            const gmsSave = inChat(world, gm, willSave(setupData, card));
            const notTheirs = await ask(
                world,
                player,
                "sepulchralMask",
                saveRequest(setupData, card, { saveMessageId: gmsSave.id }),
            );
            assert.deepEqual(await notTheirs, {
                ok: false,
                reason: "refused",
                error: "the save isn't theirs, or isn't in chat",
            });
            assert.equal(card.flags[MODULE_ID].sepulchralMask.outcome, null);

            // A "turn card" the player posted
            const forged = await player.run(() =>
                ChatMessage.create({
                    content: "<p>Sepulchral Mask</p>",
                    flags: { [MODULE_ID]: { sepulchralMask: { ...card.flags[MODULE_ID].sepulchralMask } } },
                }),
            );
            const save = inChat(world, player, willSave(setupData, forged));
            const fromForged = await ask(
                world,
                player,
                "sepulchralMask",
                saveRequest(setupData, forged, { saveMessageId: save.id }),
            );
            assert.deepEqual(await fromForged, { ok: false, reason: "refused", error: "the save's turn card is gone" });
            assert.equal(forged.flags[MODULE_ID].sepulchralMask.outcome, null);
            assert.equal(ezren.actor.itemTypes.effect.length, 0);
        });

        it("records the player's damage roll for their caster's card, and refuses others", async (t) => {
            const { world, player, finch, ezren, goblin, hobgoblin, turnCard } = await setup(t, version);
            t.mock.method(console, "warn", () => {});
            const rolled = (card) =>
                inChat(world, player, {
                    content: "<p>3</p>",
                    flags: { [MODULE_ID]: { sepulchralMaskDamage: { card: card.id } } },
                });

            // The hobgoblin is the GM's: its damage isn't the player's to roll
            const npcCard = await turnCard(hobgoblin, ezren);
            const npcDamage = rolled(npcCard);
            assert.deepEqual(
                await ask(world, player, "sepulchralMaskDamage", { cardId: npcCard.id, damageMessageId: npcDamage.id }),
                { ok: false, reason: "refused", error: "Player doesn't own the caster" },
            );
            assert.equal(npcCard.flags[MODULE_ID].sepulchralMask.damage, null);

            // Finch's card, with a roll made for another card
            const card = await turnCard(finch, goblin);
            const other = await turnCard(finch, ezren);
            const otherDamage = rolled(other);
            assert.deepEqual(
                await ask(world, player, "sepulchralMaskDamage", { cardId: card.id, damageMessageId: otherDamage.id }),
                { ok: false, reason: "refused", error: "the damage wasn't rolled for that card" },
            );
            assert.equal(card.flags[MODULE_ID].sepulchralMask.damage, null);

            const damage = rolled(card);
            assert.deepEqual(
                await ask(world, player, "sepulchralMaskDamage", { cardId: card.id, damageMessageId: damage.id }),
                { ok: true, result: { recorded: true } },
            );
            assert.equal(card.flags[MODULE_ID].sepulchralMask.damage, damage.id);
        });
    });
}
