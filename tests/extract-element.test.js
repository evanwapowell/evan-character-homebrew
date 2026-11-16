/**
 * Extract Element (scripts/extract-element.js). Up to 1.26.18 (issue #60): a creature with a custom resistance kept all
 * its resistances against the kineticist's impulses (pf2e rejects a removal rule listing "custom" with other types), a
 * second resistance of one type stayed (a removal takes the first of each type); two saves for one use arriving
 * together both applied their damage, and a failure while applying left the use marked as resolved; and when the
 * kinetic aura ended, every unlinked token's actor in the world was built to look for the effects.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, checkMessage, itemCard, makeActor, makeScene } from "./harness/pf2e.mjs";

const USERS = [{ id: "gm", name: "Gamemaster", isGM: true }];
const WITH_PLAYER = [...USERS, { id: "player", name: "Player" }];
const EFFECT_UUID = "Compendium.evan-character-homebrew.evans-character-homebrew.Item.otpFtLUFZlVa0nhn";
const MODULE_ID = "evan-character-homebrew";

let world;
afterEach(() => world?.close());

async function drain() {
    for (let i = 0; i < 40; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/** pf2e's DamageRoll (found by its name), as far as the script uses it: a total, posted, and altered by a multiplier */
class DamageRoll {
    static rolled = [];
    constructor(formula) {
        this.formula = formula;
        this.total = 5;
    }
    async evaluate() {
        return this;
    }
    async toMessage() {
        DamageRoll.rolled.push(this.formula);
    }
    alter(multiplier) {
        const altered = new DamageRoll(this.formula);
        altered.total = this.total * multiplier;
        return altered;
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Extract Element (${version})`, () => {
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({ version, users: USERS });
            const gm = await world.connect("gm", { scripts: ["extract-element.js"] });
            tick(2_000);
            await world.flush();
            gm.run(() => {
                CONFIG.PF2E = {
                    damageTypes: { fire: "Fire", cold: "Cold", slashing: "Slashing" },
                    immunityTypes: { fire: "Fire", cold: "Cold", custom: "" },
                    resistanceTypes: { fire: "Fire", cold: "Cold", slashing: "Slashing", custom: "" },
                };
                CONFIG.Dice = { rolls: [DamageRoll] };
            });
            world.add({
                uuid: EFFECT_UUID,
                toObject: () => ({
                    name: "Effect: Extract Element",
                    type: "effect",
                    system: { slug: "effect-extract-element", rules: [] },
                    flags: {},
                    _stats: {},
                }),
            });
            const scene = makeScene(world);
            const kineticist = makeActor(world, { name: "Ignis" });
            kineticist.system.details.level.value = 5;
            const action = addItem(world, kineticist, {
                name: "Extract Element",
                type: "action",
                slug: "extract-element",
            });
            action.getOriginData = () => ({ actor: kineticist.uuid, uuid: action.uuid });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            goblin.attributes = { immunities: [], resistances: [] };
            const goblinToken = addToken(world, scene, goblin);
            return { gm, scene, kineticist, action, goblin, goblinToken };
        }

        it("bypasses every resistance but a custom one, and each entry of a type", async (t) => {
            const { gm, goblin } = await setup(t);
            goblin.attributes = {
                immunities: [{ type: "fire" }, { type: "custom" }],
                resistances: [{ type: "custom" }, { type: "fire" }, { type: "cold" }, { type: "fire" }],
            };
            const rules = gm.run(() => gm.scripts["extract-element.js"].getBypassRules(goblin));
            const removals = rules.filter((r) => r.mode === "remove").map((r) => [r.key, r.type]);
            assert.deepEqual(removals, [
                ["Resistance", ["fire", "cold"]],
                ["Resistance", ["fire"]],
                ["Immunity", ["fire"]],
            ]);
            const resistance = rules.find((r) => r.key === "Resistance" && r.mode !== "remove");
            assert.deepEqual(resistance.type, ["fire"], "the fire immunity becomes resistance to the impulse");
        });

        /** A use of the action, recorded on its card, and the request a save against it sends to the GM */
        async function use({ gm, kineticist, action, goblinToken }) {
            const card = await gm.run(() =>
                ChatMessage.create({
                    content: "<p>Extract Element</p>",
                    flags: {
                        [MODULE_ID]: {
                            extractElement: { kineticist: kineticist.uuid, target: goblinToken.uuid, element: "fire" },
                        },
                    },
                }),
            );
            const data = {
                kineticistUuid: kineticist.uuid,
                kineticistTokenUuid: null,
                itemUuid: action.uuid,
                targetTokenUuid: goblinToken.uuid,
                element: "fire",
                outcome: "failure",
                total: 12,
                cardId: card.id,
            };
            return { card, data };
        }

        it("applies the result once when two saves for one use arrive together", async (t) => {
            const setupData = await setup(t);
            const { gm, goblin } = setupData;
            const damage = [];
            goblin.applyDamage = async ({ damage: roll }) => void damage.push(roll.total);
            const { card, data } = await use(setupData);

            const resolve = (d) => gm.run(() => gm.scripts["extract-element.js"].resolveExtraction(d));
            await Promise.all([resolve(data), resolve({ ...data, outcome: "criticalFailure", total: 2 })]);
            await drain();

            assert.deepEqual(damage, [5], "the damage is dealt once");
            assert.equal(goblin.itemTypes.effect.length, 1, "one effect");
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, true);
        });

        it("leaves the use to be resolved again when applying the damage fails", async (t) => {
            const setupData = await setup(t);
            const { gm, goblin } = setupData;
            let fail = true;
            const damage = [];
            goblin.applyDamage = async ({ damage: roll }) => {
                if (fail) throw new Error("the server refused");
                damage.push(roll.total);
            };
            const { card, data } = await use(setupData);
            const resolve = (d) => gm.run(() => gm.scripts["extract-element.js"].resolveExtraction(d));

            await assert.rejects(resolve(data), /the server refused/);
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, undefined);
            fail = false;
            await resolve(data);
            await drain();
            assert.deepEqual(damage, [5]);
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, true);
        });

        it("ends the effects when the kinetic aura ends, without building other unlinked tokens' actors", async (t) => {
            const { gm, scene, kineticist, goblin } = await setup(t);
            const aura = addEffect(world, kineticist, { name: "Effect: Kinetic Aura", slug: "effect-kinetic-aura" });
            const extraction = {
                name: "Effect: Extract Element (Fire)",
                type: "effect",
                source: EFFECT_UUID,
                flags: { [MODULE_ID]: { extractElement: { kineticist: kineticist.uuid, element: "fire" } } },
            };
            const onGoblin = addEffect(world, goblin, { name: extraction.name, flags: extraction.flags });
            const kobold = makeActor(world, { name: "Kobold", type: "npc" });
            const holding = addToken(world, scene, kobold, { unlinked: true, deltaItems: [extraction] });
            const other = addToken(world, scene, kobold, { unlinked: true });
            const built = addToken(world, scene, kobold, { unlinked: true });
            addEffect(world, built.actor, { name: extraction.name, flags: extraction.flags });

            await gm.run(() => aura.delete());
            await drain();

            assert.equal(goblin.items.has(onGoblin.id), false);
            assert.equal(holding.actor.itemTypes.effect.length, 0, "the unlinked token's effect ends");
            assert.equal(built.actor.itemTypes.effect.length, 0, "the built token actor's effect ends");
            assert.equal(other.builds, 0, "an unlinked token without one isn't built");
        });
    });

    /**
     * A player's save handed to the GM (issue #64): the GM's session reads the outcome again from the save's message
     * (or PF2e Toolbelt's card), and refuses a save that isn't the player's, or a use that doesn't match.
     */
    describe(`Extract Element: the GM's check of a player's save (${version})`, () => {
        /** The GM's kineticist (fire), the player's Ezren as the target, and the action's card for the use */
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({ version, users: WITH_PLAYER });
            const gm = await world.connect("gm", { scripts: ["extract-element.js"] });
            const player = await world.connect("player", { scripts: ["extract-element.js"] });
            tick(2_000);
            await world.flush();
            gm.run(() => (CONFIG.Dice = { rolls: [DamageRoll] }));
            world.add({
                uuid: EFFECT_UUID,
                toObject: () => ({
                    name: "Effect: Extract Element",
                    type: "effect",
                    system: { slug: "effect-extract-element", rules: [] },
                    flags: {},
                    _stats: {},
                }),
            });
            const scene = makeScene(world);
            gm.viewScene(scene);
            player.viewScene(scene);
            const kineticist = makeActor(world, { name: "Ignis" });
            kineticist.flags.pf2e = { kineticist: { elements: ["fire"] } };
            const action = addItem(world, kineticist, {
                name: "Extract Element",
                type: "action",
                slug: "extract-element",
            });
            action.getOriginData = () => ({ actor: kineticist.uuid, uuid: action.uuid });
            const ezren = makeActor(world, { name: "Ezren", owners: ["player"] });
            ezren.attributes = { immunities: [], resistances: [] };
            const damage = [];
            ezren.applyDamage = async ({ damage: roll }) => void damage.push(roll.total);
            const ezrenToken = addToken(world, scene, ezren, { x: 1 });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            const goblinToken = addToken(world, scene, goblin, { x: 2 });
            const card = await useAction(gm, action, ezrenToken);
            return { gm, player, scene, kineticist, action, ezren, ezrenToken, goblin, goblinToken, card, damage };
        }

        /** The action's card, as pf2e posts it, with the use's record (`element` left out: none chosen yet) */
        function useAction(gm, action, targetToken, { element = "fire", flags = {} } = {}) {
            const card = itemCard(action);
            const record = { kineticist: action.actor.uuid, target: targetToken.uuid, ...(element ? { element } : {}) };
            card.flags[MODULE_ID] = { extractElement: record };
            Object.assign(card.flags, flags);
            return gm.run(() => ChatMessage.create(card));
        }

        /** A save message in chat, made by `session`'s user, without running the hooks (so nothing asks the GM) */
        function inChat(session, data) {
            const message = new session.globals.ChatMessage(data);
            message._id = `message${String(world.messages.size).padStart(9, "0")}`;
            message.author = session.user;
            world.messages.set(message._id, message);
            world.documents.set(message.uuid, message);
            return message;
        }

        /** A Fortitude save against the action by a creature, as pf2e posts it */
        function saveMessage({ action, scene }, token, { outcome = "success" } = {}) {
            const message = checkMessage({
                actor: token.actor,
                item: action,
                type: "saving-throw",
                statistic: "fortitude",
                outcome,
                die: 12,
            });
            message.speaker = { scene: scene.id, token: token.id, actor: token.actor.id, alias: token.name };
            return message;
        }

        /** What the player's client asks the GM for, with an outcome of its own */
        const request = ({ kineticist, action, card }, token, data = {}) => ({
            kineticistUuid: kineticist.uuid,
            kineticistTokenUuid: null,
            itemUuid: action.uuid,
            targetTokenUuid: token.uuid,
            element: "fire",
            outcome: "criticalFailure",
            total: 2,
            cardId: card.id,
            ...data,
        });

        async function ask(player, data) {
            const answer = player.run(() => player.scripts["settings.js"].askGM("extractElement", data));
            await drain();
            return answer;
        }

        it("applies a save the player rolls, through the hook", async (t) => {
            const setupData = await setup(t);
            const { player, ezrenToken, card, damage } = setupData;
            await player.run(() => ChatMessage.create(saveMessage(setupData, ezrenToken, { outcome: "failure" })));
            await drain();
            assert.deepEqual(damage, [5], "full damage, for the failure");
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, true);
        });

        it("applies the outcome of the save's message, not the one sent", async (t) => {
            const setupData = await setup(t);
            const { player, ezrenToken, damage } = setupData;
            const save = inChat(player, saveMessage(setupData, ezrenToken, { outcome: "success" }));
            const answer = await ask(player, request(setupData, ezrenToken, { saveMessageId: save.id }));
            assert.equal((await answer).ok, true);
            assert.deepEqual(damage, [2.5], "half damage, for the success");
        });

        it("refuses a save the player didn't roll, or by a creature they don't own", async (t) => {
            const setupData = await setup(t);
            const { gm, player, ezrenToken, goblinToken, damage } = setupData;
            t.mock.method(console, "warn", () => {});
            const gmsSave = inChat(gm, saveMessage(setupData, ezrenToken));
            const notTheirs = await ask(player, request(setupData, ezrenToken, { saveMessageId: gmsSave.id }));
            assert.deepEqual(await notTheirs, {
                ok: false,
                reason: "refused",
                error: "the save isn't theirs, or isn't in chat",
            });

            const goblinsSave = inChat(player, saveMessage(setupData, goblinToken));
            const card = await useAction(gm, setupData.action, goblinToken);
            const data = request({ ...setupData, card }, goblinToken, { saveMessageId: goblinsSave.id });
            assert.deepEqual(await ask(player, data), {
                ok: false,
                reason: "refused",
                error: "Player doesn't own the creature that saved",
            });
            assert.deepEqual(damage, []);
            assert.equal(goblinToken.actor.itemTypes.effect.length, 0);
        });

        it("refuses an element the kineticist doesn't have", async (t) => {
            const setupData = await setup(t);
            const { gm, player, action, ezrenToken, damage } = setupData;
            t.mock.method(console, "warn", () => {});
            const card = await useAction(gm, action, ezrenToken, { element: null });
            const save = inChat(player, saveMessage(setupData, ezrenToken));
            const data = request({ ...setupData, card }, ezrenToken, { saveMessageId: save.id, element: "water" });
            assert.deepEqual(await ask(player, data), {
                ok: false,
                reason: "refused",
                error: "Ignis can't extract it",
            });
            assert.deepEqual(damage, []);
        });

        it("refuses another kineticist's card", async (t) => {
            const setupData = await setup(t);
            const { gm, player, ezrenToken, damage } = setupData;
            t.mock.method(console, "warn", () => {});
            const terra = makeActor(world, { name: "Terra" });
            const theirs = addItem(world, terra, { name: "Extract Element", type: "action", slug: "extract-element" });
            const card = await useAction(gm, theirs, ezrenToken);
            const save = inChat(player, saveMessage(setupData, ezrenToken));
            const data = request(setupData, ezrenToken, { saveMessageId: save.id, cardId: card.id });
            assert.deepEqual(await ask(player, data), {
                ok: false,
                reason: "refused",
                error: "that isn't Ignis's card",
            });
            assert.deepEqual(damage, []);
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, undefined);
        });

        it("reads a PF2e Toolbelt save from the card, and refuses one the card doesn't have", async (t) => {
            const setupData = await setup(t);
            const { gm, player, action, ezrenToken, goblinToken, damage } = setupData;
            t.mock.method(console, "warn", () => {});
            const saves = { [ezrenToken.id]: { success: "failure", value: 12 } };
            const toolbelt = { "pf2e-toolbelt": { targetHelper: { saveVariants: { null: { saves } } } } };
            const card = await useAction(gm, action, ezrenToken, { flags: toolbelt });
            const answer = await ask(
                player,
                request({ ...setupData, card }, ezrenToken, { outcome: "criticalSuccess" }),
            );
            assert.equal((await answer).ok, true);
            assert.deepEqual(damage, [5], "full damage, for the card's failure");

            // Ezren's other use, against which the card records no save by him
            const empty = await useAction(gm, action, ezrenToken, {
                flags: { "pf2e-toolbelt": { targetHelper: { saveVariants: { null: { saves: {} } } } } },
            });
            assert.deepEqual(await ask(player, request({ ...setupData, card: empty }, ezrenToken)), {
                ok: false,
                reason: "refused",
                error: "the card has no save by Ezren",
            });
            assert.equal(goblinToken.actor.itemTypes.effect.length, 0);
            assert.deepEqual(damage, [5]);
        });
    });
}
