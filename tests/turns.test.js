/**
 * The turns of an encounter (scripts/lib/turns.js), and Manifest Will's and Sustain's turn work on them, driven through
 * an encounter's updates. In 1.26.11 each script read the combat update itself (issue #47):
 *
 * - Manifest Will's turn start ran before Sustain had ended an aura that wasn't Sustained, so the next creature was
 *   still affected by it;
 * - it ran on any change of turn, so Previous Turn and then Next Turn removed a creature's effect and decided it again
 *   from where the creature stood by then, and so did the turn's index shifting when a combatant was removed;
 * - a creature removed from the encounter kept its effect;
 * - Sustain took the creature that got the current index for the one whose turn had ended when the order changed, and
 *   ended its spells before its turn.
 *
 * pf2e's own end-of-turn record can't decide whether a turn ended: pf2e 7.x writes it when the round goes back (the
 * stand-in's encounter does as pf2e 7.x does), so the cases that go back a round are here too.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addToken, makeActor, makeCombat, makeScene } from "./harness/pf2e.mjs";

const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
const FOLDER = new URL("../src/packs/evans-character-homebrew/Manifest_Will_xDgO7JjjiPCycU1D/", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, FOLDER), "utf8"));
const AURA = read("Aura__Manifest_Will_pTHgvPpA9r18ZHO2.json");
const PRIMAL = read("Effect__Manifest_Will__Primal__DJJvRoc5yfNaraKe.json");

/** Wait for the turn's work (the session's confirmation, then effects and messages through the server) */
async function settle(world, done = () => false) {
    for (let i = 0; i < 100 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

const manifestWill = (actor) => actor.itemTypes.effect.filter((e) => e.flags[MODULE_ID]?.manifestWill);
const aurasOf = (actor) => actor.itemTypes.effect.filter((e) => e.slug === "aura-manifest-will");

/**
 * A witch, a fighter beside her and a goblin far away, in that order in an encounter on a scene the GM views, with the
 * module's Effect: Manifest Will (Primal) in its compendium
 */
async function setup(t, version, { windows = 1 } = {}) {
    const tick = useFakeTimers(t);
    const world = createWorld({ version, users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
    const scripts = ["lib/turns.js", "manifest-will.js", "sustain.js", "sepulchral-mask.js"];
    const gm = await world.connect("gm", { scripts });
    const others = [];
    for (let i = 1; i < windows; i++) others.push(await world.connect("gm", { scripts }));
    t.after(() => world.close());
    // A session waits to hear from the user's others before it acts
    tick(2_000);

    const scene = makeScene(world);
    gm.viewScene(scene);
    for (const other of others) other.viewScene(scene);
    await world.flush();
    const party = [];
    const make = (name, type, x) => {
        const actor = makeActor(world, { name, type });
        Object.assign(actor, {
            modeOfBeing: "living",
            hasPlayerOwner: type === "character",
            testUserPermission: () => false,
            isAllyOf: (other) => party.includes(actor) && party.includes(other),
            isEnemyOf: (other) => party.includes(actor) !== party.includes(other),
        });
        if (type === "character") party.push(actor);
        return { actor, token: addToken(world, scene, actor, { x, y: 0 }) };
    };
    const witch = make("Finch", "character", 0);
    const fighter = make("Ezren", "character", 1);
    const goblin = make("Goblin", "npc", 10);
    world.add({ uuid: `${PACK}.${PRIMAL._id}`, toObject: () => structuredClone(PRIMAL) });

    const combat = makeCombat(world, {
        scene,
        combatants: [
            { ...witch, initiative: 20 },
            { ...fighter, initiative: 10 },
            { ...goblin, initiative: 5 },
        ],
    });
    const [witchTurn, fighterTurn, goblinTurn] = combat.turns;
    const combatants = { witch: witchTurn, fighter: fighterTurn, goblin: goblinTurn };

    /** The turns' work, as it's done: registered last, so each entry follows the scripts' own work */
    const log = [];
    const turns = gm.scripts["lib/turns.js"];
    const entry = (what) => (turn) => void log.push(`${what} ${turn.combatant.actor.name}, round ${turn.round}`);
    gm.run(() => {
        turns.onTurnEnd(entry("end"));
        turns.onTurnStart(entry("start"));
    });

    /** The witch's Aura: Manifest Will (primal), cast or last Sustained in a round */
    const castAura = (round) =>
        addEffect(world, witch.actor, {
            name: AURA.name,
            slug: AURA.system.slug,
            duration: AURA.system.duration,
            rules: AURA.system.rules.map((rule) =>
                rule.key === "ChoiceSet" ? { ...rule, selection: "primal" } : rule,
            ),
            flags: { [MODULE_ID]: { sustained: { combat: combat.id, round } } },
        });

    /** As the GM does in the tracker, then the turn's work */
    const act = async (step, ...args) => {
        await gm.run(() => combat[step](...args));
        await settle(world);
    };
    return { world, gm, turns, combat, combatants, witch, fighter, goblin, log, castAura, act };
}

for (const version of ["v13", "v14"]) {
    describe(`Turns of an encounter (${version})`, () => {
        it("each turn ends once and starts once as the turn order moves forward", async (t) => {
            const { log, act } = await setup(t, version);
            await act("startCombat");
            await act("nextTurn");
            await act("nextTurn");
            await act("nextTurn");
            assert.deepEqual(log, [
                "start Finch, round 1",
                "end Finch, round 1",
                "start Ezren, round 1",
                "end Ezren, round 1",
                "start Goblin, round 1",
                "end Goblin, round 1",
                "start Finch, round 2",
            ]);
        });

        it("Previous Turn and then Next Turn ends and starts nothing", async (t) => {
            const { log, act } = await setup(t, version);
            await act("startCombat");
            await act("nextTurn");
            log.length = 0;
            await act("previousTurn");
            await act("nextTurn");
            assert.deepEqual(log, []);
            await act("nextTurn");
            assert.deepEqual(log, ["end Ezren, round 1", "start Goblin, round 1"]);
        });

        it("a round gone back to and played again doesn't end or start the turns it already had", async (t) => {
            const { log, act } = await setup(t, version);
            await act("startCombat");
            for (let i = 0; i < 4; i++) await act("nextTurn");
            // Round 2, the fighter's turn: back to the goblin's in round 1, and forward again
            log.length = 0;
            await act("previousTurn");
            await act("previousTurn");
            await act("nextTurn");
            await act("nextTurn");
            assert.deepEqual(log, []);
            // The fighter's turn, started before going back, still ends
            await act("nextTurn");
            assert.deepEqual(log, ["end Ezren, round 2", "start Goblin, round 2"]);
        });

        it("Next Turn into a new round, undone with Previous Turn: the new round's first turn still ends", async (t) => {
            const { combat, log, act } = await setup(t, version);
            await act("startCombat");
            await act("nextTurn");
            await act("nextTurn");
            // The goblin's turn; one Next Turn too many, undone
            await act("nextTurn");
            await act("previousTurn");
            assert.equal(combat.round, 1);
            log.length = 0;
            await act("nextTurn");
            assert.deepEqual(log, []);
            await act("nextTurn");
            assert.deepEqual(log, ["end Finch, round 2", "start Ezren, round 2"]);
        });

        it("the order changing around the creature whose turn it is ends and starts nothing", async (t) => {
            const { combat, combatants, log, act } = await setup(t, version);
            await act("startCombat");
            await act("nextTurn");
            log.length = 0;
            // The fighter's turn, second in the order: the goblin moves ahead of it, then the witch leaves
            await act("setInitiative", combatants.goblin, 15);
            assert.equal(combat.combatant, combatants.fighter);
            assert.equal(combat.turn, 2);
            await act("removeCombatant", combatants.witch);
            assert.equal(combat.combatant, combatants.fighter);
            assert.equal(combat.turn, 1);
            assert.deepEqual(log, []);
        });

        it("a creature that delayed doesn't start its turn again, and the turn before it still ends", async (t) => {
            const { combatants, log, act } = await setup(t, version);
            await act("startCombat");
            await act("nextTurn");
            // The fighter Delays: its turn ends, and it comes back in after the goblin
            await act("nextTurn");
            await act("setInitiative", combatants.fighter, 1);
            log.length = 0;
            await act("nextTurn");
            assert.deepEqual(log, ["end Goblin, round 1"]);
        });

        it("a creature moved down the order in its turn: the turns gone back to and played end as they come", async (t) => {
            const { combat, combatants, log, act } = await setup(t, version);
            await act("startCombat");
            for (let i = 0; i < 3; i++) await act("nextTurn");
            // Round 2, the witch's turn: she is dragged below the goblin, and the GM goes back to the fighter
            await act("setInitiative", combatants.witch, 1);
            await act("previousTurn");
            await act("previousTurn");
            assert.equal(combat.combatant, combatants.fighter);
            log.length = 0;
            await act("nextTurn");
            await act("nextTurn");
            assert.equal(combat.combatant, combatants.witch);
            assert.deepEqual(log, ["start Goblin, round 2", "end Goblin, round 2"]);
        });

        it("a turn change waits for the work of the one before it", async (t) => {
            const { gm, turns, combat, log } = await setup(t, version);
            let slow = 0;
            gm.run(() =>
                turns.onTurnStart(async () => {
                    slow += 1;
                    for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
                    log.push("slow work done");
                }),
            );
            await gm.run(() => combat.startCombat());
            await gm.run(() => combat.nextTurn());
            await gm.run(() => combat.nextTurn());
            await settle(gm.world, () => slow === 3 && log.at(-1) === "slow work done");
            assert.deepEqual(log, [
                "start Finch, round 1",
                "slow work done",
                "end Finch, round 1",
                "start Ezren, round 1",
                "slow work done",
                "end Ezren, round 1",
                "start Goblin, round 1",
                "slow work done",
            ]);
        });

        it("an encounter under way before the module recorded its turns: the current turn still ends", async (t) => {
            const { combat, log, act } = await setup(t, version);
            await act("startCombat");
            await act("nextTurn");
            // As it was before the update: pf2e's records only
            for (const combatant of combat.turns) delete combatant.flags[MODULE_ID];
            log.length = 0;
            await act("nextTurn");
            assert.deepEqual(log, ["end Ezren, round 1", "start Goblin, round 1"]);
        });
    });

    describe(`Manifest Will and Sustain at a change of turn (${version})`, () => {
        it("an aura that wasn't Sustained ends before the next creature starts its turn in it", async (t) => {
            const { world, combat, witch, fighter, castAura, act } = await setup(t, version);
            await act("startCombat");
            castAura(combat.round);
            await act("nextTurn");
            assert.equal(manifestWill(fighter.actor).length, 1, "in round 1 the fighter starts its turn in the aura");
            assert.equal(manifestWill(fighter.actor)[0].system.context.origin.actor, witch.actor.uuid);

            await act("nextTurn");
            // Round 2: the witch doesn't Sustain, and her turn ends
            await act("nextTurn");
            await act("nextTurn");
            assert.equal(combat.combatant.actor, fighter.actor);
            assert.equal(aurasOf(witch.actor).length, 0, "the aura ended");
            assert.ok(
                world.messages.some((m) =>
                    /Aura: Manifest Will<\/strong> ends: Finch didn't Sustain it/.test(m.content),
                ),
            );
            assert.equal(manifestWill(fighter.actor).length, 0, "the fighter isn't affected by an aura that ended");
        });

        it("a round entered by mistake and gone back from: an aura that isn't Sustained still ends", async (t) => {
            const { combat, witch, fighter, castAura, act } = await setup(t, version);
            await act("startCombat");
            castAura(combat.round);
            await act("nextTurn");
            await act("nextTurn");
            // The goblin's turn; one Next Turn too many, undone
            await act("nextTurn");
            await act("previousTurn");
            await act("nextTurn");
            assert.equal(aurasOf(witch.actor).length, 1, "round 2, the witch's turn: the aura is still there");
            // She doesn't Sustain
            await act("nextTurn");
            assert.equal(combat.combatant.actor, fighter.actor);
            assert.equal(aurasOf(witch.actor).length, 0);
            assert.equal(manifestWill(fighter.actor).length, 0);
        });

        it("with the GM connected twice, a turn's work is done once, in order", async (t) => {
            const { world, combat, witch, fighter, castAura, act } = await setup(t, version, { windows: 2 });
            await act("startCombat");
            castAura(combat.round);
            await act("nextTurn");
            assert.equal(manifestWill(fighter.actor).length, 1);

            for (let i = 0; i < 3; i++) await act("nextTurn");
            assert.equal(combat.combatant.actor, fighter.actor);
            assert.equal(aurasOf(witch.actor).length, 0);
            assert.equal(world.messages.filter((m) => /didn't Sustain it/.test(m.content)).length, 1);
            assert.equal(manifestWill(fighter.actor).length, 0);
        });

        it("Previous Turn and then Next Turn leaves a creature's effect as it was", async (t) => {
            const { gm, combat, fighter, castAura, act } = await setup(t, version);
            await gm.run(() => game.settings.set(MODULE_ID, "sustainedDurations", false));
            await act("startCombat");
            castAura(combat.round);
            await act("nextTurn");
            const [effect] = manifestWill(fighter.actor);
            assert.ok(effect, "the fighter starts its turn in the aura");

            // It leaves the emanation: the effect lasts until its next turn
            fighter.token.x = 10;
            await act("previousTurn");
            await act("nextTurn");
            assert.deepEqual(manifestWill(fighter.actor), [effect]);
        });

        it("a combatant removed earlier in the order leaves the current creature's effect as it was", async (t) => {
            const { gm, combat, combatants, fighter, castAura, act } = await setup(t, version);
            await gm.run(() => game.settings.set(MODULE_ID, "sustainedDurations", false));
            await act("startCombat");
            castAura(combat.round);
            await act("nextTurn");
            const [effect] = manifestWill(fighter.actor);
            assert.ok(effect);

            await act("removeCombatant", combatants.witch);
            assert.equal(combat.combatant, combatants.fighter);
            assert.deepEqual(manifestWill(fighter.actor), [effect]);
        });

        it("a creature removed from the encounter loses its effect", async (t) => {
            const { combat, combatants, fighter, castAura, act } = await setup(t, version);
            await act("startCombat");
            castAura(combat.round);
            await act("nextTurn");
            assert.equal(manifestWill(fighter.actor).length, 1);

            await act("nextTurn");
            await act("removeCombatant", combatants.fighter);
            assert.equal(manifestWill(fighter.actor).length, 0);
        });

        it("a creature moved to act before the current one keeps a spell it hasn't had its turn to Sustain", async (t) => {
            const { world, combat, combatants, goblin, act } = await setup(t, version);
            await act("startCombat");
            const spell = addEffect(world, goblin.actor, {
                name: "Spell Effect: Bane",
                duration: { value: 1, unit: "minutes", expiry: "turn-start", sustained: true },
                flags: { [MODULE_ID]: { sustained: { combat: combat.id, round: 1 } } },
            });
            for (let i = 0; i < 3; i++) await act("nextTurn");
            // Round 2, the witch's turn: the goblin, last Sustained in round 1, is moved ahead of her
            await act("setInitiative", combatants.goblin, 25);
            assert.equal(combat.combatant, combatants.witch);
            assert.ok(goblin.actor.items.has(spell.id), "the goblin's spell hasn't ended");
            assert.equal(world.messages.size, 0);

            // It ends at the end of the goblin's own turn, when it hasn't Sustained it
            for (let i = 0; i < 3; i++) await act("nextTurn");
            assert.equal(combat.combatant, combatants.witch);
            assert.equal(combat.round, 3);
            assert.ok(!goblin.actor.items.has(spell.id));
        });
    });
}
