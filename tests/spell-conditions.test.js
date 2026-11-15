/**
 * The timers of the spell conditions' Apply button (scripts/spell-conditions.js), driven from a save's message through
 * the button and its dialog, in an encounter. In 1.26.12 "until its next turn begins" and "until the end of its next
 * turn" were always effects of 1 round from the target's turn. pf2e ends such an effect at the target's turn in the next
 * round (calculateRemainingDuration, which the stand-in's effects follow), so a target that hadn't acted yet this round
 * kept the condition through a turn too many (issue #48).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, checkMessage, makeActor, makeCombat, makeScene } from "./harness/pf2e.mjs";

const condition = (id) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]`;
const CONDITIONS = {
    blinded: "XgEqL1kFApUbl5Z2",
    fleeing: "sDPxOjQ9kx2RZE8D",
    frightened: "TBSHQspnbcqxsmjL",
    slowed: "xYTAsEpcJE1Ccni3",
};

// The spells' descriptions in pf2e's source (packs/pf2e/spells), with conditions linked by ID, as pf2e's build has them
const SPELLS = {
    blindness: {
        name: "Blindness",
        rank: 3,
        save: "fortitude",
        description: [
            "<p>You blind the target. The effect is determined by the target's Fortitude save. The target then becomes temporarily immune for 1 minute.</p>",
            "<hr />",
            "<p><strong>Critical Success</strong> The target is unaffected.</p>",
            `<p><strong>Success</strong> The target is ${condition(CONDITIONS.blinded)} until its next turn begins.</p>`,
            "<p><strong>Failure</strong> The target is Blinded for 1 minute.</p>",
            "<p><strong>Critical Failure</strong> The target is Blinded permanently.</p>",
        ].join("\n"),
    },
    phantasmalKiller: {
        name: "Phantasmal Killer",
        rank: 4,
        save: "will",
        description: [
            "<p>You create a phantasmal image of the most fearsome creature imaginable to the target. The effect of the killer is based on the outcome of the target's Will save.</p><hr /><p><strong>Critical Success</strong> The target is unaffected.</p>",
            `<p><strong>Success</strong> The target takes @Damage[4d6[mental]] damage and is ${condition(CONDITIONS.frightened)}{Frightened 1}.</p>`,
            `<p><strong>Failure</strong> The target takes @Damage[(max(8,@item.rank*2))d6[mental]] damage and is ${condition(CONDITIONS.frightened)}{Frightened 2}.</p>`,
            `<p><strong>Critical Failure</strong> The target is so afraid it might die. It must attempt a @Check[fortitude|traits:incapacitation] save; if the target fails, it dies. On a successful Fortitude save, the target takes @Damage[(max(12,@item.rank*3))d6[mental]] damage, is ${condition(CONDITIONS.fleeing)} until the end of its next turn, and is ${condition(CONDITIONS.frightened)}{Frightened 4}. This effect has the incapacitation trait.</p>`,
        ].join("\n"),
    },
    waveOfDespair: {
        name: "Wave of Despair",
        rank: 5,
        save: "will",
        duration: "1 or more rounds",
        description: [
            "<p>You inflict despair on creatures in the area. The effects for each creature are determined by its Will save.</p>",
            "<hr />",
            "<p><strong>Critical Success</strong> The creature is unaffected.</p>",
            `<p><strong>Success</strong> For 1 round, the creature can't use reactions and must attempt another save at the start of its turn; on a failure, it is ${condition(CONDITIONS.slowed)}{Slowed 1} for that turn as it sobs uncontrollably.</p>`,
            "<p><strong>Failure</strong> As success, but the duration is 1 minute.</p>",
            "<p><strong>Critical Failure</strong> As failure, and the creature is automatically slowed 1 for 1 minute.</p>",
        ].join("\n"),
    },
};

/** Until the start of the target's next turn, until its end, and for the turn it's taking or its next */
const TIMERS = {
    "until its next turn begins": { spell: "blindness", outcome: "success", expiry: "turn-start" },
    "until the end of its next turn": { spell: "phantasmalKiller", outcome: "criticalFailure", expiry: "turn-end" },
    "for that turn": { spell: "waveOfDespair", outcome: "success", expiry: "turn-end" },
};

async function settle(world, done) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

/**
 * A witch, a goblin and a fighter on a scene the GM views, in an encounter at the initiatives given (`order`, from the
 * first to act; none: no encounter), begun and moved on to `turn`'s turn
 */
async function setup(t, version, { order = null, turn = null } = {}) {
    const tick = useFakeTimers(t);
    const world = createWorld({ version, users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
    const gm = await world.connect("gm", { scripts: ["spell-conditions.js"] });
    t.after(() => world.close());
    tick(2_000);

    const scene = makeScene(world);
    gm.viewScene(scene);
    const actors = {
        witch: makeActor(world, { name: "Finch" }),
        goblin: makeActor(world, { name: "Goblin", type: "npc" }),
        fighter: makeActor(world, { name: "Ezren" }),
    };
    const tokens = Object.fromEntries(
        Object.entries(actors).map(([key, actor], x) => [key, addToken(world, scene, actor, { x })]),
    );
    // Conditions with no timer of their own (Phantasmal Killer's frightened) go on as conditions
    actors.goblin.increaseCondition = async () => null;

    const dialogs = [];
    /** What a test changes in the dialog before Apply */
    let edit = null;
    gm.run(() => {
        for (const [slug, id] of Object.entries(CONDITIONS)) {
            const name = slug[0].toUpperCase() + slug.slice(1);
            const uuid = `Compendium.pf2e.conditionitems.Item.${id}`;
            game.pf2e.ConditionManager.conditions.set(slug, { slug, name, id, uuid });
        }
        // The dialog, as shown, with Apply pressed
        foundry.applications.api.DialogV2.wait = async ({ content, buttons }) => {
            const form = document.createElement("form");
            form.innerHTML = content;
            dialogs.push(form);
            edit?.(form);
            return buttons.find((b) => b.action === "apply").callback(null, { form });
        };
    });

    let combat = null;
    if (order) {
        const combatants = order.map(([key, initiative]) => ({ actor: actors[key], token: tokens[key], initiative }));
        combat = gm.run(() => makeCombat(world, { scene, combatants }));
        if (turn) {
            await gm.run(() => combat.startCombat());
            while (combat.combatant.actor !== actors[turn]) await gm.run(() => combat.nextTurn());
        }
    }

    /**
     * The goblin's save against the spell, with that result: the Apply button on its message, pressed, and Apply in
     * its dialog, once `change(form)` has made its changes
     */
    async function apply(timer, change = null) {
        edit = change;
        const { spell: key, outcome } = TIMERS[timer];
        const data = SPELLS[key];
        const spell = addItem(world, actors.witch, {
            name: data.name,
            type: "spell",
            system: {
                description: { value: data.description },
                duration: { value: data.duration ?? "", sustained: false },
                defense: { save: { statistic: data.save, basic: false } },
            },
        });
        Object.assign(spell, { rank: data.rank, img: "spell.webp" });
        const save = checkMessage({
            actor: actors.goblin,
            item: spell,
            type: "saving-throw",
            statistic: data.save,
            domains: ["saving-throw", data.save, "all"],
            outcome,
            dc: 25,
        });
        const message = await gm.run(() => ChatMessage.create(save));
        const html = gm.run(() => document.createElement("li"));
        html.innerHTML = `<div class="message-content"></div>`;
        gm.Hooks.callAll("renderChatMessageHTML", message, html);
        await settle(world, () => html.querySelector("button"));
        const button = html.querySelector("button");
        assert.ok(button, "the save's message gets an Apply button");

        const before = actors.goblin.itemTypes.effect.length;
        gm.run(() => button.click());
        await settle(world, () => actors.goblin.itemTypes.effect.length > before);
        const effect = actors.goblin.itemTypes.effect.at(-1);
        assert.ok(effect, "the condition's effect is on the goblin");
        return { effect, button, dialog: dialogs.at(-1) };
    }

    /** Whether the effect has expired, as the GM's session sees it now */
    const expired = (effect) => gm.run(() => effect.remainingDuration.expired);
    /** Next Turn until it's that creature's turn */
    async function until(key) {
        do await gm.run(() => combat.nextTurn());
        while (combat.combatant.actor !== actors[key]);
    }

    return { world, gm, scene, actors, combat, apply, expired, until };
}

for (const version of ["v13", "v14"]) {
    describe(`Spell conditions: timers that end at the target's turn (${version})`, () => {
        describe("the target's turn is still to come this round", () => {
            const order = [
                ["witch", 20],
                ["goblin", 10],
                ["fighter", 5],
            ];

            it("until its next turn begins: ends at the start of its turn this round", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("until its next turn begins");
                assert.equal(effect.system.duration.value, 0);
                assert.equal(effect.system.duration.expiry, "turn-start");
                assert.equal(expired(effect), false, "it lasts through the witch's turn");
                await until("goblin");
                assert.equal(combat.round, 1);
                assert.equal(expired(effect), true, "it ends when the goblin's turn begins");
            });

            it("until the end of its next turn: lasts through its turn this round, and no longer", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("until the end of its next turn");
                assert.equal(effect.system.duration.value, 0);
                assert.equal(effect.system.duration.expiry, "turn-end");
                assert.equal(expired(effect), false);
                await until("goblin");
                assert.equal(expired(effect), false, "it lasts through the goblin's turn");
                await until("fighter");
                assert.equal(combat.round, 1);
                assert.equal(expired(effect), true, "it ends once the goblin's turn is over");
            });

            it("until the end of its next turn, the target the last to act: ends with the round", async (t) => {
                const last = [
                    ["fighter", 30],
                    ["witch", 20],
                    ["goblin", 10],
                ];
                const { apply, expired, until, combat } = await setup(t, version, { order: last, turn: "witch" });
                const { effect } = await apply("until the end of its next turn");
                assert.equal(effect.system.duration.value, 0);
                await until("goblin");
                assert.equal(expired(effect), false);
                await until("fighter");
                assert.equal(combat.round, 2);
                assert.equal(expired(effect), true);
            });

            it("for that turn: lasts through its turn this round", async (t) => {
                const { apply, expired, until } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("for that turn");
                assert.equal(effect.system.duration.value, 0);
                await until("goblin");
                assert.equal(expired(effect), false);
                await until("fighter");
                assert.equal(expired(effect), true);
            });

            it("at the same initiative as the caster, acting after: still ends at its own turn", async (t) => {
                const tied = [
                    ["witch", 20],
                    ["goblin", 20],
                    ["fighter", 5],
                ];
                const { apply, expired, until, combat, actors } = await setup(t, version, {
                    order: tied,
                    turn: "witch",
                });
                assert.equal(combat.turns[1].actor, actors.goblin);
                const { effect } = await apply("until its next turn begins");
                assert.equal(effect.system.duration.value, 0);
                assert.equal(expired(effect), false, "the witch's turn, at the same initiative, isn't the goblin's");
                await until("goblin");
                assert.equal(expired(effect), true);
            });
        });

        describe("the target already acted this round", () => {
            const order = [
                ["goblin", 20],
                ["witch", 10],
                ["fighter", 5],
            ];

            it("until its next turn begins: ends at the start of its turn next round", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("until its next turn begins");
                assert.equal(effect.system.duration.value, 1);
                assert.equal(effect.system.duration.unit, "rounds");
                await until("fighter");
                assert.equal(expired(effect), false, "it lasts through the rest of the round");
                await until("goblin");
                assert.equal(combat.round, 2);
                assert.equal(expired(effect), true, "it ends when the goblin's turn begins");
            });

            it("until the end of its next turn: lasts through its turn next round, and no longer", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("until the end of its next turn");
                assert.equal(effect.system.duration.value, 1);
                await until("goblin");
                assert.equal(combat.round, 2);
                assert.equal(expired(effect), false, "it lasts through the goblin's turn");
                await until("witch");
                assert.equal(combat.round, 2);
                assert.equal(expired(effect), true, "it ends once the goblin's turn is over");
            });

            it("for that turn: its next turn is next round's", async (t) => {
                const { apply, expired, until } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("for that turn");
                assert.equal(effect.system.duration.value, 1);
                await until("goblin");
                assert.equal(expired(effect), false);
                await until("witch");
                assert.equal(expired(effect), true);
            });
        });

        describe("the save is rolled on the target's own turn", () => {
            const order = [
                ["witch", 20],
                ["goblin", 10],
                ["fighter", 5],
            ];

            it("until its next turn begins: the turn it's taking isn't its next", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "goblin" });
                const { effect } = await apply("until its next turn begins");
                assert.equal(effect.system.duration.value, 1);
                assert.equal(expired(effect), false);
                await until("witch");
                assert.equal(expired(effect), false);
                await until("goblin");
                assert.equal(combat.round, 2);
                assert.equal(expired(effect), true);
            });

            it("until the end of its next turn: lasts through its turn next round", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "goblin" });
                const { effect } = await apply("until the end of its next turn");
                assert.equal(effect.system.duration.value, 1);
                await until("fighter");
                assert.equal(expired(effect), false, "this turn's end isn't its next turn's");
                await until("goblin");
                assert.equal(combat.round, 2);
                assert.equal(expired(effect), false);
                await until("fighter");
                assert.equal(expired(effect), true);
            });

            it("for that turn: ends with the turn it's taking", async (t) => {
                const { apply, expired, until, combat } = await setup(t, version, { order, turn: "goblin" });
                const { effect } = await apply("for that turn");
                assert.equal(effect.system.duration.value, 0);
                assert.equal(expired(effect), false, "it lasts through the goblin's turn");
                await until("fighter");
                assert.equal(combat.round, 1);
                assert.equal(expired(effect), true);
            });
        });

        describe("the target has no turn to count from", () => {
            for (const timer of Object.keys(TIMERS)) {
                it(`${timer}, outside an encounter: 1 round`, async (t) => {
                    const { apply, expired } = await setup(t, version);
                    const { effect } = await apply(timer);
                    assert.equal(effect.system.duration.value, 1);
                    assert.equal(effect.system.duration.expiry, TIMERS[timer].expiry);
                    assert.equal(expired(effect), false);
                });
            }

            it("the target isn't in the encounter: 1 round", async (t) => {
                const order = [
                    ["witch", 20],
                    ["fighter", 5],
                ];
                const { apply } = await setup(t, version, { order, turn: "witch" });
                assert.equal((await apply("until its next turn begins")).effect.system.duration.value, 1);
                assert.equal((await apply("until the end of its next turn")).effect.system.duration.value, 1);
            });

            it("the encounter hasn't begun: 1 round", async (t) => {
                const order = [
                    ["witch", 20],
                    ["goblin", 10],
                ];
                const { apply } = await setup(t, version, { order });
                assert.equal((await apply("until its next turn begins")).effect.system.duration.value, 1);
            });

            it("no initiative rolled for the target, which acts last: 1 round", async (t) => {
                // pf2e would count the timer from the witch's initiative, and end it at the fighter's turn
                const order = [
                    ["witch", 20],
                    ["fighter", 12],
                    ["goblin", null],
                ];
                const { apply, expired, until, combat, actors } = await setup(t, version, { order, turn: "witch" });
                assert.equal(combat.turns.at(-1).actor, actors.goblin);
                const { effect } = await apply("until the end of its next turn");
                assert.equal(effect.system.duration.value, 1);
                await until("goblin");
                assert.equal(expired(effect), false, "it lasts through the goblin's turn");
            });

            it("a combatant with no creature acts before the target: 1 round", async (t) => {
                // On that combatant's turn, pf2e takes an effect whose rounds are up for expired
                const order = [
                    ["witch", 20],
                    ["nobody", 15],
                    ["goblin", 10],
                ];
                const { apply, expired, combat, gm } = await setup(t, version, { order, turn: "witch" });
                const { effect } = await apply("until its next turn begins");
                assert.equal(effect.system.duration.value, 1);
                await gm.run(() => combat.nextTurn());
                assert.equal(combat.combatant.actor, null);
                assert.equal(expired(effect), false, "it lasts through the turn of the combatant with no creature");
            });

            it("a world where time passes with each turn: 1 round, which 0 rounds wouldn't outlast", async (t) => {
                const order = [
                    ["witch", 20],
                    ["fighter", 15],
                    ["goblin", 10],
                ];
                const { apply, gm } = await setup(t, version, { order, turn: "witch" });
                gm.run(() => (CONFIG.time.turnTime = 2));
                assert.equal((await apply("until the end of its next turn")).effect.system.duration.value, 1);
            });
        });

        it("the timer counts from the target's turn, and is shown as written", async (t) => {
            const order = [
                ["witch", 20],
                ["goblin", 10],
            ];
            const { apply, actors, world } = await setup(t, version, { order, turn: "witch" });
            const { effect, button, dialog } = await apply("until its next turn begins");
            assert.equal(button.textContent, "Apply: Blinded (until the start of its next turn)");
            assert.equal(dialog.querySelector("input[type=number]").value, "1", "the timer can still be changed");
            assert.match(dialog.textContent, /\(until the start of its next turn\)/);
            assert.equal(effect.system.context.origin.actor, actors.goblin.uuid);
            assert.equal(effect.system.start.initiative, 10);
            assert.deepEqual(effect.system.rules, [
                { key: "GrantItem", uuid: `Compendium.pf2e.conditionitems.Item.${CONDITIONS.blinded}` },
            ]);
            const summary = world.messages.contents.at(-1);
            assert.match(summary.content, /Goblin: Blinded \(until the start of its next turn\)\./);
        });

        it("a timer changed in the dialog is the rounds it says, from the target's turn", async (t) => {
            const order = [
                ["witch", 20],
                ["goblin", 10],
            ];
            const { apply, expired, until, combat, world } = await setup(t, version, { order, turn: "witch" });
            const { effect } = await apply("until its next turn begins", (form) => {
                form.querySelector("input[type=number]").value = "2";
            });
            assert.equal(effect.system.duration.value, 2);
            assert.equal(effect.system.duration.unit, "rounds");
            assert.match(world.messages.contents.at(-1).content, /Goblin: Blinded \(2 rounds\)\./);
            await until("goblin");
            await until("goblin");
            assert.equal(combat.round, 2);
            assert.equal(expired(effect), false);
            await until("goblin");
            assert.equal(expired(effect), true);
        });

        it("until the end of its next turn is shown as written, not as a timer to change", async (t) => {
            const { apply } = await setup(t, version);
            const { button, dialog } = await apply("until the end of its next turn");
            assert.equal(button.textContent, "Apply: Fleeing (until the end of its next turn), Frightened 4");
            assert.match(dialog.textContent, /Fleeing\s+until the end of its next turn/);
            assert.equal(dialog.querySelectorAll("[name^=duration-]").length, 1, "only frightened has a timer to set");
        });

        it("a timer counted on the caster's turns is as it was: for 1 minute", async (t) => {
            const order = [
                ["witch", 20],
                ["goblin", 10],
            ];
            const { apply, actors } = await setup(t, version, { order, turn: "witch" });
            TIMERS.minute = { spell: "blindness", outcome: "failure", expiry: "turn-start" };
            t.after(() => delete TIMERS.minute);
            const { effect, dialog } = await apply("minute");
            assert.deepEqual(
                { ...effect.system.duration },
                { value: 1, unit: "minutes", expiry: "turn-start", sustained: false },
            );
            assert.equal(dialog.querySelector("input[type=number]").value, "1");
            assert.equal(effect.system.context.origin.actor, actors.witch.uuid);
            assert.equal(effect.system.start.initiative, 20);
        });
    });
}
