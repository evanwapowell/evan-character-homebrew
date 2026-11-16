/**
 * The spell conditions' Apply button (scripts/spell-conditions.js) used more than once, on a spell from a scroll, with
 * a condition whose value the text gives as a roll, and with a spell effect, driven from a save's message through the
 * button and its dialog (issue #54):
 *
 * - once applied, the message records whom to, its button says so and using it again checks nothing; a second click
 *   while the dialog is open does nothing;
 * - a save against a spell cast from a scroll or wand gets the button: pf2e's save message can't find such a spell,
 *   which the cast's card carries;
 * - a valued condition without a number ("drained [[/r 1d4]]") asks for the value, and isn't applied without one,
 *   rather than raising whatever drained the creature has;
 * - a spell effect is made as pf2e makes one dragged from the save's message (spellcasting, roll options, the roll,
 *   the spell's traits).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, MODULE_ID, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, checkMessage, embeddedSpellCard, makeActor, makeScene } from "./harness/pf2e.mjs";

const conditionLink = (id, label = null) =>
    `@UUID[Compendium.pf2e.conditionitems.Item.${id}]${label ? `{${label}}` : ""}`;
const CONDITIONS = {
    blinded: { id: "XgEqL1kFApUbl5Z2", valued: false },
    drained: { id: "4D2KBtexWXa6oUMR", valued: true },
};
const EFFECT = { id: "spelleffectdoom0", name: "Spell Effect: Doom" };

// The spells' descriptions in pf2e's source (packs/pf2e/spells), with conditions linked by ID, as pf2e's build has them
const SPELLS = {
    blindness: {
        name: "Blindness",
        rank: 3,
        save: "fortitude",
        description: [
            "<p>You blind the target.</p>",
            "<hr />",
            "<p><strong>Critical Success</strong> The target is unaffected.</p>",
            `<p><strong>Success</strong> The target is ${conditionLink(CONDITIONS.blinded.id)} until its next turn begins.</p>`,
            "<p><strong>Failure</strong> The target is Blinded for 1 minute.</p>",
            "<p><strong>Critical Failure</strong> The target is Blinded permanently.</p>",
        ].join("\n"),
    },
    wails: {
        name: "Wails of the Damned",
        rank: 9,
        save: "fortitude",
        description: [
            "<p>You howl a lament of damned souls. Each living enemy in the area takes 8d10 void damage and must attempt a Fortitude save.</p>",
            "<hr />",
            "<p><strong>Critical Success</strong> The creature is unaffected.</p>",
            "<p><strong>Success</strong> The creature takes full damage.</p>",
            `<p><strong>Failure</strong> The creature takes full damage and is ${conditionLink(CONDITIONS.drained.id)} [[/r 1d4]].</p>`,
            `<p><strong>Critical Failure</strong> The creature takes double damage and is ${conditionLink(CONDITIONS.drained.id, "Drained 4")}.</p>`,
        ].join("\n"),
    },
    // A made-up spell whose failure links a spell effect
    doom: {
        name: "Doomsay",
        rank: 2,
        save: "will",
        traits: ["concentrate", "manipulate", "mental", "occult"],
        description: [
            "<p>You speak of the target's doom.</p>",
            "<hr />",
            "<p><strong>Success</strong> The target is unaffected.</p>",
            `<p><strong>Failure</strong> The target gains @UUID[Compendium.pf2e.spell-effects.Item.${EFFECT.id}]{${EFFECT.name}}.</p>`,
        ].join("\n"),
    },
};

async function settle(world, done = () => false) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

/** The GM and Ezren's player, connected; a witch (the GM's), a goblin, and Ezren on a scene they view */
async function setup(t, version) {
    const tick = useFakeTimers(t);
    const world = createWorld({
        version,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
        ],
    });
    const scripts = ["spell-conditions.js"];
    const gm = await world.connect("gm", { scripts });
    const player = await world.connect("player", { scripts });
    t.after(() => world.close());
    tick(2_000);
    await settle(world);

    const scene = makeScene(world);
    const actors = {
        witch: makeActor(world, { name: "Finch", type: "npc" }),
        goblin: makeActor(world, { name: "Goblin", type: "npc" }),
        ezren: makeActor(world, { name: "Ezren", owners: ["player"] }),
    };
    Object.values(actors).forEach((actor, x) => addToken(world, scene, actor, { x }));

    // Conditions with no timer of their own go on through pf2e's increaseCondition: recorded here
    const increased = [];
    for (const actor of Object.values(actors)) {
        actor.increaseCondition = async (slug, options) => {
            increased.push({ actor, slug, options });
            return null;
        };
    }

    const effectSystem = { rules: [], level: { value: 1 }, traits: { value: [] }, duration: { value: 1 } };
    world.add({
        documentName: "Item",
        uuid: `Compendium.pf2e.spell-effects.Item.${EFFECT.id}`,
        type: "effect",
        name: EFFECT.name,
        system: effectSystem,
        toObject: () => structuredClone({ _id: EFFECT.id, name: EFFECT.name, type: "effect", system: effectSystem }),
    });

    const dialogs = [];
    /** What a test does in the dialog before Apply (by the session it's in) */
    const edits = new Map();
    for (const session of [gm, player]) {
        session.viewScene(scene);
        session.run(() => {
            CONFIG.PF2E.effectTraits = { mental: "Mental", occult: "Occult", fear: "Fear" };
            for (const [slug, { id, valued }] of Object.entries(CONDITIONS)) {
                const name = slug[0].toUpperCase() + slug.slice(1);
                const uuid = `Compendium.pf2e.conditionitems.Item.${id}`;
                const system = { value: { isValued: valued, value: valued ? 1 : null } };
                game.pf2e.ConditionManager.conditions.set(slug, { slug, name, id, uuid, system });
            }
            foundry.applications.api.DialogV2.wait = async ({ content, buttons }) => {
                const form = document.createElement("form");
                form.innerHTML = content;
                dialogs.push({ session, form });
                edits.get(session)?.(form);
                return buttons.find((b) => b.action === "apply").callback(null, { form });
            };
        });
    }

    function makeSpell(key) {
        const data = SPELLS[key];
        return {
            name: data.name,
            type: "spell",
            system: {
                description: { value: data.description },
                duration: { value: "", sustained: false },
                defense: { save: { statistic: data.save, basic: false } },
                traits: { value: data.traits ?? [] },
            },
        };
    }

    /** The spell, on the witch, as pf2e's spell is, with an occult spellcasting entry */
    function addSpell(key) {
        const spell = addItem(world, actors.witch, makeSpell(key));
        Object.assign(spell, {
            rank: SPELLS[key].rank,
            img: "spell.webp",
            attribute: "cha",
            spellcasting: { tradition: "occult", statistic: { attributeModifier: { value: 4 }, dc: { value: 27 } } },
        });
        return spell;
    }

    /** A save against the spell by the creature, posted by `by`, with that outcome */
    async function rollSave(spell, key, { actor = actors.goblin, outcome = "failure", by = gm } = {}) {
        const statistic = SPELLS[key].save;
        const data = checkMessage({
            actor,
            item: spell,
            type: "saving-throw",
            statistic,
            domains: ["saving-throw", statistic, "all"],
            outcome,
            dc: 27,
        });
        return by.run(() => ChatMessage.create(data));
    }

    /** The message rendered in a session, with its Apply button (or null once rendering is done) */
    async function render(message, session = gm) {
        const html = session.run(() => document.createElement("li"));
        html.innerHTML = `<div class="message-content"></div>`;
        session.Hooks.callAll("renderChatMessageHTML", message, html);
        await settle(world, () => html.querySelector("button"));
        return html.querySelector("button");
    }

    /** Click the button and wait for the chat line that reports what was applied */
    async function apply(button, session = gm) {
        const before = world.messages.size;
        session.run(() => button.click());
        await settle(world, () => world.messages.size > before);
        await settle(world);
        return world.messages.contents.at(-1);
    }

    return { world, gm, player, actors, dialogs, edits, increased, addSpell, makeSpell, rollSave, render, apply };
}

const checkedBoxes = (form) => [...form.querySelectorAll("input[type=checkbox]")].filter((box) => box.checked);

for (const version of ["v13", "v14"]) {
    describe(`Spell conditions: applying once (${version})`, () => {
        it("records whom it was applied to; the button then says Applied and checks nothing", async (t) => {
            const { actors, addSpell, rollSave, render, apply, dialogs } = await setup(t, version);
            const spell = addSpell("blindness");
            const save = await rollSave(spell, "blindness");
            await apply(await render(save));
            assert.equal(actors.goblin.itemTypes.effect.length, 1);
            assert.deepEqual(save.flags[MODULE_ID].spellConditions.applied, [actors.goblin.uuid]);

            const button = await render(save);
            assert.match(button.textContent, /^Applied: Blinded/);
            await apply(button);
            assert.equal(checkedBoxes(dialogs.at(-1).form).length, 0, "nothing is checked the second time");
            assert.match(dialogs.at(-1).form.innerHTML, /Already applied/);
            assert.equal(actors.goblin.itemTypes.effect.length, 1, "nothing is applied again");
        });

        it("a player who can't update the message (the GM's) has the GM record it", async (t) => {
            const { world, actors, player, addSpell, rollSave, render, apply } = await setup(t, version);
            const spell = addSpell("blindness");
            const save = await rollSave(spell, "blindness", { actor: actors.ezren });
            await apply(await render(save, player), player);
            await settle(world, () => !!save.flags[MODULE_ID].spellConditions);
            assert.equal(actors.ezren.itemTypes.effect.length, 1);
            assert.deepEqual(save.flags[MODULE_ID].spellConditions.applied, [actors.ezren.uuid]);
        });

        it("a second click while the dialog is open does nothing", async (t) => {
            const { world, actors, gm, addSpell, rollSave, render, dialogs } = await setup(t, version);
            const spell = addSpell("blindness");
            const button = await render(await rollSave(spell, "blindness"));
            let release;
            gm.run(() => {
                const wait = foundry.applications.api.DialogV2.wait;
                foundry.applications.api.DialogV2.wait = (options) =>
                    new Promise((resolve) => (release = () => resolve(wait(options))));
            });
            gm.run(() => button.click());
            await settle(world, () => !!release);
            assert.equal(button.disabled, true);
            gm.run(() => button.click());
            gm.run(() => release());
            await settle(world, () => actors.goblin.itemTypes.effect.length > 0);
            await settle(world);
            assert.equal(dialogs.length, 1);
            assert.equal(actors.goblin.itemTypes.effect.length, 1);
            assert.equal(button.disabled, false);
        });
    });

    describe(`Spell conditions: a spell cast from a scroll (${version})`, () => {
        it("the save's message gets the button, with the spell from the cast's card", async (t) => {
            const { world, actors, gm, makeSpell, rollSave, render, apply } = await setup(t, version);
            const { spell, card } = embeddedSpellCard(world, actors.witch, { ...makeSpell("blindness"), rank: 3 });
            await gm.run(() => ChatMessage.create(card));
            const save = await rollSave(spell, "blindness");
            assert.equal(save.item, null, "pf2e's save message can't find the scroll's spell");
            const button = await render(save);
            assert.ok(button, "the save gets an Apply button");
            await apply(button);
            const [effect] = actors.goblin.itemTypes.effect;
            assert.equal(effect?.name, "Blindness (Failure)");
            assert.equal(effect.system.level.value, 3);
        });
    });

    describe(`Spell conditions: a value the text gives as a roll (${version})`, () => {
        it("asks for drained's value, and applies what's entered", async (t) => {
            const { actors, addSpell, rollSave, render, apply, edits, gm, dialogs, increased } = await setup(
                t,
                version,
            );
            const spell = addSpell("wails");
            edits.set(gm, (form) => (form.querySelector("input[name^=value-]").value = "3"));
            await apply(await render(await rollSave(spell, "wails")));
            const input = dialogs.at(-1).form.querySelector("input[name^=value-]");
            assert.ok(input, "a value field is offered");
            assert.equal(input.value, "3");
            assert.deepEqual(
                increased.map(({ actor, slug, options }) => [actor, slug, options]),
                [[actors.goblin, "drained", { value: 3 }]],
            );
        });

        it("leaves drained out without a value, rather than raising the drained the creature has", async (t) => {
            const { actors, addSpell, rollSave, render, apply, increased } = await setup(t, version);
            const spell = addSpell("wails");
            const report = await apply(await render(await rollSave(spell, "wails")));
            assert.deepEqual(increased, [], "pf2e would add 1 to any drained, a locked one included");
            assert.match(report.content, /Not applied: Drained \(no value given\)/);
            assert.equal(actors.goblin.itemTypes.condition.length, 0);
        });

        it("a critical failure's Drained 4 needs nothing entered", async (t) => {
            const { actors, addSpell, rollSave, render, apply, increased } = await setup(t, version);
            const spell = addSpell("wails");
            const report = await apply(await render(await rollSave(spell, "wails", { outcome: "criticalFailure" })));
            assert.deepEqual(
                increased.map(({ actor, slug, options }) => [actor, slug, options]),
                [[actors.goblin, "drained", { value: 4 }]],
            );
            assert.match(report.content, /Already had: Drained 4/, "the stand-in's increaseCondition changed nothing");
        });
    });

    describe(`Spell conditions: a spell effect from a save (${version})`, () => {
        it("is made as pf2e makes one dragged from the save's message", async (t) => {
            const { actors, addSpell, rollSave, render, apply } = await setup(t, version);
            const spell = addSpell("doom");
            const save = await rollSave(spell, "doom");
            await apply(await render(save));
            const [effect] = actors.goblin.itemTypes.effect;
            assert.equal(effect?.name, EFFECT.name);
            assert.equal(effect.system.level.value, 2);
            assert.deepEqual(effect.system.traits.value, ["mental", "occult"], "the spell's traits effects can have");
            const { origin, target, roll } = effect.system.context;
            assert.equal(origin.actor, actors.witch.uuid);
            assert.equal(origin.item, spell.uuid);
            assert.deepEqual(origin.spellcasting, { attribute: { type: "cha", mod: 4 }, tradition: "occult" });
            assert.deepEqual(origin.rollOptions, save.flags.pf2e.origin.rollOptions);
            assert.equal(target.actor, actors.goblin.uuid);
            assert.deepEqual(roll, { total: 10, degreeOfSuccess: 1 });
            assert.equal(effect.flags[MODULE_ID].spellSource.spell, spell.uuid);
            assert.equal(effect.flags[MODULE_ID].spellSource.rank, 2);
        });
    });

    /**
     * A player's record of whom they applied the conditions to, which the GM writes on a message they can't update:
     * the GM's session keeps only the creatures that saved against the spell and are the player's (#64)
     */
    describe(`Spell conditions: the record, checked by the GM (${version})`, () => {
        async function ask(world, player, data) {
            let answer = null;
            player
                .run(() => player.scripts["settings.js"].askGM("spellConditionsApplied", data))
                .then((a) => (answer = a));
            await settle(world, () => answer !== null);
            return answer;
        }

        it("records only the player's creature that saved", async (t) => {
            const { world, actors, player, addSpell, rollSave } = await setup(t, version);
            const save = await rollSave(addSpell("blindness"), "blindness", { actor: actors.ezren });
            const answer = await ask(world, player, {
                messageId: save.id,
                actorUuids: [actors.ezren.uuid, actors.goblin.uuid],
            });
            assert.equal(answer.ok, true);
            await settle(world, () => !!save.flags[MODULE_ID].spellConditions);
            assert.deepEqual(save.flags[MODULE_ID].spellConditions.applied, [actors.ezren.uuid]);
        });

        it("refuses creatures that didn't save, or aren't the player's", async (t) => {
            const { world, actors, player, addSpell, rollSave } = await setup(t, version);
            t.mock.method(console, "warn", () => {});
            const spell = addSpell("blindness");
            const ezrens = await rollSave(spell, "blindness", { actor: actors.ezren });
            const notSaved = await ask(world, player, { messageId: ezrens.id, actorUuids: [actors.goblin.uuid] });
            assert.equal(notSaved.reason, "refused");
            const goblins = await rollSave(spell, "blindness");
            const notTheirs = await ask(world, player, { messageId: goblins.id, actorUuids: [actors.goblin.uuid] });
            assert.deepEqual(notTheirs, {
                ok: false,
                reason: "refused",
                error: "none of those creatures saved against the spell and are Player's",
            });
            await settle(world);
            assert.equal(ezrens.flags[MODULE_ID].spellConditions, undefined);
            assert.equal(goblins.flags[MODULE_ID].spellConditions, undefined);
        });
    });
}
