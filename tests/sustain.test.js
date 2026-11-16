/**
 * Sustain (scripts/sustain.js): which effects one Sustain keeps going. Up to 1.26.19 (issue #63), a caster's sustained
 * effects were grouped by spell, so a spell cast twice was one entry and one Sustain kept both castings going, and
 * pf2e's copies of a sustained aura's effect on the creatures in it were each an entry of their own, not Sustained with
 * the aura. The "didn't Sustain it" line was also public for an NPC's spells.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, makeActor, makeCombat, makeScene } from "./harness/pf2e.mjs";

async function settle(world, done = () => false) {
    for (let i = 0; i < 100 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

const SUSTAINED = { value: 1, unit: "minutes", expiry: "turn-start", sustained: true };

/** A witch (the player's), a fighter and two goblins, in that order in an encounter on a scene everyone views */
async function setup(t, version) {
    const tick = useFakeTimers(t);
    const world = createWorld({
        version,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
        ],
    });
    const scripts = ["lib/turns.js", "sustain.js"];
    const gm = await world.connect("gm", { scripts });
    const player = await world.connect("player", { scripts });
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
    const witch = make("Finch", "character", 0, ["player"]);
    const fighter = make("Ezren", "character", 1);
    const goblin = make("Goblin", "npc", 5);
    const boss = make("Hobgoblin", "npc", 6);

    /** A sustained spell the creature knows; its card is pf2e's, so the Sustain posts a line of its own */
    const learn = (caster, name) => {
        const spell = addItem(world, caster.actor, { name, type: "spell" });
        Object.assign(spell, { rank: 1, traits: new Set(), toMessage: async () => null });
        return spell;
    };

    const combat = makeCombat(world, {
        scene,
        combatants: [
            { ...witch, initiative: 20 },
            { ...fighter, initiative: 15 },
            { ...goblin, initiative: 10 },
            { ...boss, initiative: 5 },
        ],
    });

    /** The spell cast on a creature now: its effect made there, as pf2e makes one dragged from the card */
    const cast = async (caster, spell, on, { name = `Spell Effect: ${spell.name}`, rules = [], flags = {} } = {}) => {
        const [effect] = await gm.run(() =>
            on.actor.createEmbeddedDocuments("Item", [
                {
                    name,
                    type: "effect",
                    flags,
                    system: {
                        level: { value: 1 },
                        rules,
                        duration: SUSTAINED,
                        context: {
                            origin: { actor: caster.actor.uuid, token: null, item: spell?.uuid ?? null },
                            target: { actor: on.actor.uuid, token: null },
                            roll: null,
                        },
                    },
                },
            ]),
        );
        await settle(world);
        return effect;
    };

    const act = async (step) => {
        await gm.run(() => combat[step]());
        await settle(world);
    };
    /** Next Turn until it's the creature's turn in the round */
    const turnOf = async ({ actor }, round) => {
        for (let i = 0; i < 20 && !(combat.round === round && combat.combatant.actor === actor); i++) {
            await act("nextTurn");
        }
        assert.equal(combat.combatant.actor, actor);
    };
    const exists = (effect) => effect.actor.items.has(effect.id);
    /** The player Sustains the casting an effect is from */
    const sustain = async (effect) => {
        await player.run(() => player.scripts["sustain.js"].sustain(witch.actor, { effect }));
        await settle(world);
    };
    return { world, gm, player, combat, witch, fighter, goblin, boss, learn, cast, act, turnOf, exists, sustain };
}

for (const version of ["v13", "v14"]) {
    describe(`Sustain: one casting at a time (${version})`, () => {
        it("a spell cast twice is two entries, and Sustaining one lets the other end", async (t) => {
            const { world, player, witch, goblin, boss, learn, cast, act, turnOf, exists, sustain } = await setup(
                t,
                version,
            );
            const spell = learn(witch, "Phantom Pain");
            await act("startCombat");
            const first = await cast(witch, spell, goblin);
            // Round 2: she Sustains it and casts it again
            await turnOf(witch, 2);
            await sustain(first);
            const second = await cast(witch, spell, boss);

            // Round 3: two castings
            await turnOf(witch, 3);
            const spells = player.run(() => player.scripts["sustain.js"].getSustainedSpells(witch.actor));
            assert.equal(spells.length, 2);
            assert.deepEqual(
                spells.map((s) => s.effects.map((e) => e.actor.name)),
                [["Goblin"], ["Hobgoblin"]],
            );

            // The player Sustains the first casting only
            await sustain(first);
            await act("nextTurn");
            assert.ok(exists(first), "the Sustained casting goes on");
            assert.ok(!exists(second), "the other casting ends");
            assert.ok(world.messages.some((m) => /Phantom Pain<\/strong> on Hobgoblin ends/.test(m.content)));
        });

        it("the spell's Sustain button asks which casting when both are going, and Sustains the only one", async (t) => {
            const { world, player, witch, goblin, boss, learn, cast, act, turnOf } = await setup(t, version);
            const spell = learn(witch, "Phantom Pain");
            await act("startCombat");
            await cast(witch, spell, goblin);
            const dialogs = [];
            player.run(() => {
                foundry.applications.api.DialogV2.wait = async ({ content }) => {
                    const form = document.createElement("form");
                    form.innerHTML = content;
                    dialogs.push(form);
                    return null;
                };
            });
            const sustainSpell = () =>
                player.run(() => player.scripts["sustain.js"].sustainSpell(witch.actor, spell, 1));

            await sustainSpell();
            await settle(world);
            assert.equal(dialogs.length, 0, "one casting: Sustained without asking");
            assert.ok(world.messages.some((m) => /Finch Sustains/.test(m.content)));

            await turnOf(witch, 2);
            await cast(witch, spell, boss);
            await sustainSpell();
            assert.equal(dialogs.length, 1);
            const labels = [...dialogs[0].querySelectorAll("label")].map((l) => l.textContent);
            assert.deepEqual(labels, [
                "Phantom Pain (on Goblin; 9 rounds left)",
                "Phantom Pain (on Hobgoblin; 10 rounds left)",
            ]);
        });

        it("pf2e's copies of a sustained aura's effect are Sustained with the aura", async (t) => {
            const { player, witch, fighter, learn, cast, act, turnOf, exists, sustain } = await setup(t, version);
            const spell = learn(witch, "Protective Wards");
            await act("startCombat");
            const aura = await cast(witch, spell, witch, {
                name: "Aura: Protective Wards",
                rules: [{ key: "Aura", slug: "protective-wards", radius: 10 }],
            });
            // pf2e copies the aura's effect onto the fighter, without the spell, as the fighter's turn starts in it
            await turnOf(fighter, 1);
            const copy = await cast(witch, null, fighter, {
                name: "Spell Effect: Protective Wards",
                flags: { pf2e: { aura: { slug: "protective-wards", origin: witch.actor.uuid, removeOnExit: true } } },
            });

            await turnOf(witch, 2);
            const spells = player.run(() => player.scripts["sustain.js"].getSustainedSpells(witch.actor));
            assert.equal(spells.length, 1, "one entry for the aura");
            assert.deepEqual(
                spells[0].on.map((a) => a.name),
                ["Finch", "Ezren"],
            );
            await sustain(copy);
            await act("nextTurn");
            assert.ok(exists(aura) && exists(copy), "both go on");
        });

        it("an NPC's spell that wasn't Sustained ends with a line whispered to the GM", async (t) => {
            const { world, witch, goblin, learn, cast, act, turnOf } = await setup(t, version);
            const spell = learn(goblin, "Phantom Pain");
            const witchSpell = learn(witch, "Haunting Hymn");
            await act("startCombat");
            await cast(witch, witchSpell, witch);
            await turnOf(goblin, 1);
            await cast(goblin, spell, witch);
            await turnOf(witch, 3);
            await act("nextTurn");
            await turnOf(goblin, 3);
            await act("nextTurn");

            const npcLine = world.messages.find((m) => /Phantom Pain<\/strong> on Finch ends/.test(m.content));
            assert.ok(npcLine);
            assert.deepEqual([...npcLine.whisper], ["gm"]);
            const playerLine = world.messages.find((m) => /Haunting Hymn<\/strong> ends/.test(m.content));
            assert.ok(playerLine);
            assert.deepEqual([...playerLine.whisper], [], "a player's spell ending is public");
        });
    });

    /**
     * The record of a player's Sustain, which the GM writes on effects on creatures the player doesn't own: only
     * sustained effects of a caster the player owns are recorded (#64)
     */
    describe(`Sustain: the record, checked by the GM (${version})`, () => {
        async function ask(world, player, effects) {
            let answer = null;
            const data = { effectUuids: effects.map((e) => e.uuid) };
            player.run(() => player.scripts["settings.js"].askGM("recordSustained", data)).then((a) => (answer = a));
            await settle(world, () => answer !== null);
            return answer;
        }
        const recorded = (effect) => effect.flags["evan-character-homebrew"]?.sustained ?? null;
        /** Forget the record made when the effect was cast this round, so only the request's shows */
        const forget = (...effects) => effects.forEach((e) => delete e.flags["evan-character-homebrew"]?.sustained);

        it("records the player's caster's sustained effects, and nothing else", async (t) => {
            const { world, player, witch, fighter, goblin, boss, learn, cast, act } = await setup(t, version);
            await act("startCombat");
            const mine = await cast(witch, learn(witch, "Phantom Pain"), goblin);
            const bosses = await cast(boss, learn(boss, "Fear"), fighter);
            const plain = await cast(witch, learn(witch, "Daze"), goblin);
            plain.system.duration = { ...plain.system.duration, sustained: false };
            forget(mine, bosses, plain);

            const answer = await ask(world, player, [mine, bosses, plain]);
            assert.equal(answer.ok, true);
            await settle(world, () => !!recorded(mine));
            assert.ok(recorded(mine));
            assert.equal(recorded(bosses), null, "another caster's isn't recorded");
            assert.equal(recorded(plain), null, "an effect that isn't sustained isn't recorded");
        });

        it("refuses a Sustain of nothing the player's caster sustains", async (t) => {
            const { world, player, fighter, boss, learn, cast, act } = await setup(t, version);
            t.mock.method(console, "warn", () => {});
            await act("startCombat");
            const bosses = await cast(boss, learn(boss, "Fear"), fighter);
            forget(bosses);
            assert.deepEqual(await ask(world, player, [bosses]), {
                ok: false,
                reason: "refused",
                error: "none of those are sustained spells of Player's",
            });
            await settle(world);
            assert.equal(recorded(bosses), null);
        });
    });
}
