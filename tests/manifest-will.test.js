/**
 * Manifest Will's concealment flat check, re-centering and Finch aura (scripts/manifest-will.js), driven through the
 * hooks and the GM request (#50). Until 1.26.15, a reroll rolled a second flat check, a private roll's flat check was
 * public on Foundry v14 (it passed only `rollMode`), names went into it unescaped, an aura with no origin moved onto a
 * charge made the charge its caster, and a Finch aura made by a session not viewing its scene had no visible edge.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, checkMessage, makeActor, makeScene } from "./harness/pf2e.mjs";

const FOLDER = new URL("../src/packs/evans-character-homebrew/Manifest_Will_xDgO7JjjiPCycU1D/", import.meta.url);
const AURA = JSON.parse(fs.readFileSync(new URL("Aura__Manifest_Will_pTHgvPpA9r18ZHO2.json", FOLDER), "utf8"));
const FLAT_CHECK = /Manifest Will: Flat Check DC 5/;

/** Wait for the work of a hook or a request (the sessions' confirmations, then documents through the server) */
async function settle(world, tick) {
    for (let i = 0; i < 50; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
        tick?.(100);
    }
}

/** The aura's rules, with a tradition chosen (or none yet) */
const auraRules = (selection) =>
    AURA.system.rules.map((rule) => (rule.key === "ChoiceSet" ? { ...rule, selection } : rule));

/**
 * The witch (the player's), in her primal Manifest Will dragged from the compendium (so with no origin), a goblin
 * 25 feet away and Ezren, her charge, beside her, on a scene both sessions view
 */
async function setup(t, version, { modules = {} } = {}) {
    const tick = useFakeTimers(t);
    const world = createWorld({
        version,
        modules,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
        ],
    });
    const gm = await world.connect("gm", { scripts: ["manifest-will.js"] });
    const player = await world.connect("player", { scripts: ["manifest-will.js"] });
    t.after(() => world.close());
    // A session waits to hear from the user's others before it acts
    tick(2_000);
    const scene = makeScene(world);
    gm.viewScene(scene);
    player.viewScene(scene);
    await world.flush();

    const witch = makeActor(world, { name: "Finch <Lost>", type: "character", owners: ["player"] });
    const goblin = makeActor(world, { name: "Goblin", type: "npc" });
    const ezren = makeActor(world, { name: "Ezren", type: "character" });
    const tokens = {
        witch: addToken(world, scene, witch, { x: 0 }),
        goblin: addToken(world, scene, goblin, { x: 5 }),
        ezren: addToken(world, scene, ezren, { x: 1 }),
    };
    const aura = addEffect(world, witch, {
        name: AURA.name,
        slug: AURA.system.slug,
        duration: AURA.system.duration,
        rules: auraRules("primal"),
    });
    const flatChecks = () => world.messages.filter((m) => FLAT_CHECK.test(m.flavor));
    return { world, tick, gm, player, scene, witch, goblin, ezren, tokens, aura, flatChecks };
}

/** The goblin's Strike against the witch, as pf2e posts it: its context names both tokens */
function strike({ goblin, tokens }, { isReroll = false, whisper = [], blind = false } = {}) {
    const message = checkMessage({ actor: goblin, type: "attack-roll", statistic: "strike", outcome: "success" });
    message.speaker = { scene: tokens.goblin.parent.id, token: tokens.goblin.id, actor: goblin.id, alias: "Goblin" };
    Object.assign(message.flags.pf2e.context, {
        origin: { actor: goblin.uuid, token: tokens.goblin.uuid },
        target: { actor: tokens.witch.actor.uuid, token: tokens.witch.uuid },
        isReroll,
    });
    return { ...message, whisper, blind };
}

for (const version of ["v13", "v14"]) {
    describe(`Manifest Will's concealment flat check (${version})`, () => {
        it("a Strike from beyond the emanation rolls one, and its reroll doesn't roll another", async (t) => {
            const setupData = await setup(t, version);
            const { world, gm, flatChecks } = setupData;
            await gm.run(() => ChatMessage.create(strike(setupData)));
            await settle(world);
            assert.equal(flatChecks().length, 1);
            // pf2e's reroll deletes the check's message and posts one with the same context, marked as a reroll
            await gm.run(() => ChatMessage.create(strike(setupData, { isReroll: true })));
            await settle(world);
            assert.equal(flatChecks().length, 1);
        });

        it("is as private as the roll that prompted it, and public when that was", async (t) => {
            const setupData = await setup(t, version);
            const { world, gm, flatChecks } = setupData;
            await gm.run(() => ChatMessage.create(strike(setupData, { blind: true, whisper: ["gm"] })));
            await settle(world);
            const [blind] = flatChecks();
            assert.equal(blind.blind, true);
            assert.deepEqual(blind.whisper, ["gm"]);

            await gm.run(() => ChatMessage.create(strike(setupData, { whisper: ["gm"] })));
            await settle(world);
            const whispered = flatChecks()[1];
            assert.equal(whispered.blind, false);
            assert.deepEqual(whispered.whisper, ["gm"]);

            await gm.run(() => ChatMessage.create(strike(setupData)));
            await settle(world);
            const open = flatChecks()[2];
            assert.equal(open.blind, false);
            assert.deepEqual(open.whisper, []);
        });

        it("escapes the names in its result", async (t) => {
            const setupData = await setup(t, version);
            const { world, gm, goblin, tokens, flatChecks } = setupData;
            // The flat check fails (a 1), so its result names the creatures
            gm.globals.Roll = class extends gm.globals.Roll {
                async evaluate() {
                    this.total = 1;
                    return this;
                }
            };
            await gm.run(() => ChatMessage.create(strike(setupData)));
            await settle(world);
            assert.match(flatChecks()[0].flavor, /the attack against Finch &lt;Lost&gt; fails/);

            // A targeted spell the witch saves against, from the goblin
            const spell = Object.assign(addItem(world, goblin, { name: "<Daze>", type: "spell", slug: "daze" }), {
                traits: new Set(["cantrip"]),
            });
            const save = checkMessage({ actor: setupData.witch, item: spell, type: "saving-throw", statistic: "will" });
            save.speaker = { scene: tokens.witch.parent.id, token: tokens.witch.id, actor: setupData.witch.id };
            save.flags.pf2e.context.origin = { actor: goblin.uuid, token: tokens.goblin.uuid };
            await gm.run(() => ChatMessage.create(save));
            await settle(world);
            assert.match(flatChecks()[1].flavor, /&lt;Daze&gt; doesn't affect Finch &lt;Lost&gt;/);
        });
    });

    describe(`Manifest Will re-centered on a charge (${version}, moveAuraEffect)`, () => {
        it("an aura with no origin keeps the witch as its caster on the charge", async (t) => {
            const { world, tick, player, witch, ezren, tokens, aura } = await setup(t, version);
            const { askGM } = player.scripts["settings.js"];
            const request = player.run(() =>
                askGM("moveManifestWill", { effectUuid: aura.uuid, centerUuid: ezren.uuid }),
            );
            await settle(world, tick);
            assert.equal((await request).ok, true);

            assert.equal(witch.itemTypes.effect.length, 0, "the aura left the witch");
            const [moved] = ezren.itemTypes.effect;
            assert.equal(moved?.slug, "aura-manifest-will");
            assert.equal(moved.origin, witch, "the witch is its caster, not the charge");
            assert.deepEqual(moved.system.context, {
                origin: { actor: witch.uuid, token: tokens.witch.uuid, item: null, spellcasting: null },
                target: null,
                roll: null,
            });
        });

        it("an aura with an origin keeps it as it was", async (t) => {
            const { world, tick, player, witch, ezren, aura } = await setup(t, version);
            aura.system.context = {
                origin: { actor: witch.uuid, token: null, item: "Item.spell", spellcasting: null, rollOptions: [] },
                target: { actor: witch.uuid, token: null },
                roll: null,
            };
            const context = structuredClone(aura.system.context);
            const { askGM } = player.scripts["settings.js"];
            const request = player.run(() =>
                askGM("moveManifestWill", { effectUuid: aura.uuid, centerUuid: ezren.uuid }),
            );
            await settle(world, tick);
            assert.equal((await request).ok, true);
            assert.deepEqual(ezren.itemTypes.effect[0]?.system.context, context);
        });
    });

    describe(`the Finch version's aura (${version}, preCreateItem)`, () => {
        const loopOf = (effect) =>
            effect.system.rules.find((r) => r.key === "Aura" && r.predicate?.includes("manifest-will:primal"))
                ?.appearance;
        const cast = (session, actor) =>
            session.run(() =>
                actor.createEmbeddedDocuments("Item", [
                    { name: AURA.name, type: "effect", system: { ...AURA.system, rules: auraRules(null) } },
                ]),
            );

        it("made by a session viewing the caster: Sequencer plays the loop, so the aura has no texture or border", async (t) => {
            const { world, gm, ezren } = await setup(t, version, { modules: { sequencer: { active: true } } });
            const [effect] = await cast(gm, ezren);
            await settle(world);
            assert.deepEqual(loopOf(effect), { ...appearanceOf(), border: null, texture: null });
        });

        it("made by a session not viewing the caster's scene: the loop is the aura's texture, so its edge shows", async (t) => {
            const { world, gm, ezren } = await setup(t, version, { modules: { sequencer: { active: true } } });
            gm.viewScene(makeScene(world, { name: "Elsewhere" }));
            const [effect] = await cast(gm, ezren);
            await settle(world);
            const appearance = loopOf(effect);
            assert.equal(appearance.border, null);
            assert.equal(appearance.texture?.src, "modules/evan-character-homebrew/animations/finch/primal-loop.webm");
        });
    });
}

/** The primal Aura rule's appearance in the compendium */
function appearanceOf() {
    const rule = AURA.system.rules.find((r) => r.key === "Aura" && r.predicate?.includes("manifest-will:primal"));
    return structuredClone(rule.appearance ?? {});
}
