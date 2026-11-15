/**
 * A spell cast or only sent to chat (scripts/lib/casting.js), and what the hex familiars do on each (#51). pf2e posts
 * the same card for both, and marks a cast from 8.5.0. Until 1.26.15, Familiar of Ongoing Misery and Familiar of
 * Parasitic Might took a hex sent to chat for one cast; prolonging an effect measured in minutes also lost its expiry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_ID, createWorld } from "./harness/foundry.mjs";
import { addItem, addToken, checkMessage, makeActor, makeScene, spellCard } from "./harness/pf2e.mjs";

const SCRIPTS = ["lib/casting.js", "ongoing-misery.js", "parasitic-might.js"];

/** Wait for a hook's work, through the server */
async function settle(world) {
    for (let i = 0; i < 20; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * A witch whose familiar has both abilities, a hex and another spell, on a pf2e version, with the player's session
 * connected. The familiar has no token, so each feature, once it reads a card as a cast, warns that it has none.
 */
async function setup(systemVersion) {
    const version = systemVersion.startsWith("7.") ? "v13" : "v14";
    const world = createWorld({
        version,
        systemVersion,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
        ],
    });
    await world.connect("gm", { scripts: SCRIPTS });
    const player = await world.connect("player", { scripts: SCRIPTS });
    const witch = makeActor(world, { name: "Finch", type: "character", owners: ["player"] });
    const familiar = makeActor(world, { name: "Thimble", type: "familiar", owners: ["player"] });
    Object.assign(witch, { familiar });
    Object.assign(familiar, { master: witch });
    for (const name of ["Familiar of Ongoing Misery", "Familiar of Parasitic Might"]) {
        addItem(world, familiar, { name, type: "action" });
    }
    const spell = (name, slug, traits) =>
        Object.assign(addItem(world, witch, { name, type: "spell", slug }), { traits: new Set(traits), rank: 1 });
    const hex = spell("Evil Eye", "evil-eye", ["hex", "curse", "cantrip"]);
    const other = spell("Daze", "daze", ["cantrip", "mental"]);
    const post = async (data) => {
        const message = await player.run(() => ChatMessage.create(data));
        await settle(world);
        return message;
    };
    const prompted = () =>
        player.notifications.filter((n) => /Thimble has no token on this scene/.test(n.message)).map((n) => n.message);
    return { world, player, witch, hex, other, post, prompted };
}

const FEATURES = ["Familiar of Ongoing Misery", "Familiar of Parasitic Might"];
const both = FEATURES.map((title) => `${title}: Thimble has no token on this scene.`);

describe("a spell cast or sent to chat (scripts/lib/casting.js, isSpellCast)", () => {
    for (const [systemVersion, marks] of [
        ["7.7.0", false],
        ["8.4.1", false],
        ["8.5.0", true],
        ["8.7.0", true],
    ]) {
        it(`pf2e ${systemVersion} ${marks ? "marks casts" : "can't tell a cast"}`, async () => {
            const { world, player, hex, post } = await setup(systemVersion);
            const { castsAreMarked, isSpellCast } = player.scripts["lib/casting.js"];
            const cast = await post(spellCard(world, hex, { actualCast: true }));
            const shown = await post(spellCard(world, hex, { actualCast: false }));
            player.run(() => {
                assert.equal(castsAreMarked(), marks);
                // Protector Tree and Sepulchral Mask: only a marked card, otherwise their button or drag
                assert.equal(isSpellCast(cast), marks);
                assert.equal(isSpellCast(shown), false);
                assert.equal(isSpellCast(cast, { unmarked: true }), true);
                // The hexes: where pf2e can't tell, any card from a spellcasting entry
                assert.equal(isSpellCast(shown, { unmarked: true }), !marks);
            });
            world.close();
        });
    }

    it("a roll from the spell isn't its card, and an item that isn't a spell isn't cast", async () => {
        const { world, player, witch, hex, post } = await setup("7.7.0");
        const { isSpellCast } = player.scripts["lib/casting.js"];
        const attack = checkMessage({ actor: witch, item: hex, type: "spell-attack-roll", statistic: "spell-attack" });
        const feat = addItem(world, witch, { name: "Cackle", type: "feat", slug: "cackle" });
        const featCard = spellCard(world, feat);
        const messages = [await post(attack), await post(featCard)];
        player.run(() => {
            for (const message of messages) assert.equal(isSpellCast(message, { unmarked: true }), false);
        });
        world.close();
    });
});

describe("hexes cast or sent to chat, through the hook (ongoing-misery.js and parasitic-might.js, isHexCast)", () => {
    it("pf2e 8.5 and later: a hex sent to chat prompts neither familiar, and casting it prompts both", async () => {
        const { world, hex, post, prompted } = await setup("8.7.0");
        await post(spellCard(world, hex, { actualCast: false }));
        assert.deepEqual(prompted(), []);
        await post(spellCard(world, hex, { actualCast: true }));
        assert.deepEqual(prompted(), both);
        world.close();
    });

    for (const systemVersion of ["7.7.0", "8.4.1"]) {
        it(`pf2e ${systemVersion}, which can't tell them apart: a hex sent to chat prompts both`, async () => {
            const { world, hex, post, prompted } = await setup(systemVersion);
            await post(spellCard(world, hex, { actualCast: false }));
            assert.deepEqual(prompted(), both);
            world.close();
        });
    }

    it("a spell that isn't a hex, a hex's save context and the Sustain repost prompt neither", async () => {
        const { world, witch, hex, other, post, prompted } = await setup("8.7.0");
        await post(spellCard(world, other, { actualCast: true }));
        await post(checkMessage({ actor: witch, item: hex, type: "saving-throw", statistic: "will" }));
        const repost = spellCard(world, hex, { actualCast: true });
        repost.flags[MODULE_ID] = { sustain: true };
        await post(repost);
        assert.deepEqual(prompted(), []);
        world.close();
    });
});

describe("Familiar of Ongoing Misery prolongs an effect (ongoing-misery.js, extendEffect)", () => {
    for (const expiry of ["turn-end", "turn-start", "round-end"]) {
        it(`1 minute, ending at ${expiry}: 11 rounds, still ending at ${expiry}`, async () => {
            const world = createWorld({ users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
            const gm = await world.connect("gm", { scripts: ["ongoing-misery.js"] });
            const scene = makeScene(world);
            gm.viewScene(scene);
            const witch = makeActor(world, { name: "Finch", type: "character" });
            const familiar = makeActor(world, { name: "Thimble", type: "familiar" });
            Object.assign(witch, { familiar });
            Object.assign(familiar, { master: witch });
            addItem(world, familiar, { name: "Familiar of Ongoing Misery", type: "action" });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            addToken(world, scene, familiar, { x: 0 });
            addToken(world, scene, goblin, { x: 2 });

            const [slow] = await gm.run(() =>
                goblin.createEmbeddedDocuments("Item", [
                    {
                        name: "Spell Effect: Slow",
                        type: "effect",
                        system: { slug: "slow", duration: { value: 1, unit: "minutes", expiry, sustained: false } },
                    },
                ]),
            );
            slow.canUserModify = () => true;
            const slowed = { slug: "slowed", name: "Slowed", flags: { pf2e: { grantedBy: { id: slow.id } } } };
            Object.assign(goblin, { conditions: { contents: [slowed] }, attributes: { immunities: [] } });

            gm.run(() => (foundry.applications.api.DialogV2.wait = async () => "0"));
            await gm.run(() => game.modules.get(MODULE_ID).api.ongoingMisery(witch));
            await settle(world);

            assert.deepEqual(slow.system.duration, { value: 11, unit: "rounds", expiry, sustained: false });
            assert.equal(slow.flags[MODULE_ID]?.ongoingMisery, true);
            assert.ok(
                world.messages.some((m) => /Thimble curses Goblin, prolonging Slowed by 1 round/.test(m.content)),
            );
            world.close();
        });
    }
});
