/**
 * The Apply button on the card of a spell without a save (scripts/spell-target-effects.js), driven from the card
 * through the button and its dialog (issue #53): an aura effect that isn't named "Aura:" (pf2e's Bless, by its Aura
 * rule) goes on the caster, an emanation's effect (Courageous Anthem) on the caster and the allies in it rather than
 * the user's targets, and an effect's choices (Resist Energy's damage type) are made by the caster before the GM
 * creates it on a creature the caster's player doesn't own. Once applied, the card is marked, and using it again
 * checks nothing (issue #54).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, MODULE_ID, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, makeActor, makeScene, spellCard } from "./harness/pf2e.mjs";

const effectUuid = (id) => `Compendium.pf2e.spell-effects.Item.${id}`;
const EFFECTS = {
    bless: { id: "Gqy7K6FnbLtwGpud", name: "Spell Effect: Bless", rules: [{ key: "Aura", radius: 15, effects: [] }] },
    anthem: { id: "beReeFroAx24hj83", name: "Spell Effect: Courageous Anthem", rules: [] },
    resist: {
        id: "fpGDAz2v5PG0zUSl",
        name: "Spell Effect: Resist Energy",
        rules: [
            {
                key: "ChoiceSet",
                flag: "resistEnergy",
                prompt: "Choose a damage type",
                choices: [
                    { label: "Acid", value: "acid" },
                    { label: "Fire", value: "fire" },
                    { label: "Sonic", value: "sonic", predicate: ["self:type:npc"] },
                ],
            },
            { key: "Resistance", type: "{item|flags.pf2e.rulesSelections.resistEnergy}", value: 5 },
        ],
    },
};

// The spells as pf2e's packs have them (packs/pf2e/spells), with their effects linked by ID
const SPELLS = {
    bless: {
        name: "Bless",
        rank: 1,
        area: { type: "emanation", value: 15 },
        target: "you and allies in the area",
        effect: "bless",
    },
    anthem: {
        name: "Courageous Anthem",
        rank: 1,
        area: { type: "emanation", value: 60 },
        target: "",
        effect: "anthem",
    },
    resist: { name: "Resist Energy", rank: 2, area: null, target: "1 creature", effect: "resist" },
};

async function settle(world, done = () => false) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

/**
 * The GM and Kyra's player, both connected; Ezren is another player's, and Valeros too, far away; a goblin beside
 * Kyra. The player's dialogs are answered by `answers` (by the dialog's title), which see the form.
 */
async function setup(t, version) {
    const tick = useFakeTimers(t);
    const world = createWorld({
        version,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
            { id: "other", name: "Other Player" },
        ],
    });
    const scripts = ["spell-target-effects.js"];
    const gm = await world.connect("gm", { scripts });
    const player = await world.connect("player", { scripts });
    t.after(() => world.close());
    tick(2_000);
    await settle(world);

    const scene = makeScene(world);
    gm.viewScene(scene);
    player.viewScene(scene);
    const actors = {
        kyra: makeActor(world, { name: "Kyra", owners: ["player"] }),
        ezren: makeActor(world, { name: "Ezren", owners: ["other"] }),
        valeros: makeActor(world, { name: "Valeros", owners: ["other"] }),
        goblin: makeActor(world, { name: "Goblin", type: "npc" }),
    };
    const tokens = {
        kyra: addToken(world, scene, actors.kyra, { x: 0 }),
        goblin: addToken(world, scene, actors.goblin, { x: 1 }),
        ezren: addToken(world, scene, actors.ezren, { x: 2 }),
        valeros: addToken(world, scene, actors.valeros, { x: 30 }),
    };
    for (const effect of Object.values(EFFECTS)) {
        const uuid = effectUuid(effect.id);
        const system = { rules: structuredClone(effect.rules), level: { value: 1 }, traits: { value: [] } };
        world.add({
            documentName: "Item",
            uuid,
            type: "effect",
            name: effect.name,
            img: "effect.webp",
            system,
            toObject: () => structuredClone({ _id: effect.id, name: effect.name, type: "effect", system }),
        });
    }

    const dialogs = [];
    const answers = {};
    for (const session of [gm, player]) {
        session.run(() => {
            foundry.applications.api.DialogV2.wait = async ({ window, content, buttons }) => {
                const form = document.createElement("form");
                form.innerHTML = content;
                dialogs.push({ session, title: window.title, form });
                const answer = Object.entries(answers).find(([title]) => window.title.includes(title))?.[1];
                const action = answer?.(form) ?? buttons[0].action;
                return buttons.find((b) => b.action === action)?.callback?.(null, { form }) ?? null;
            };
        });
    }

    /** The spell's card, posted by `by`, rendered for the player with its Apply button */
    async function cast(key, { by = player, targets = [] } = {}) {
        const data = SPELLS[key];
        const effect = EFFECTS[data.effect];
        const spell = addItem(world, actors.kyra, {
            name: data.name,
            type: "spell",
            system: {
                description: { value: `<p>${data.name}.</p><p>@UUID[${effectUuid(effect.id)}]</p>` },
                area: data.area,
                target: { value: data.target },
                traits: { value: ["concentrate", "manipulate"] },
                defense: null,
            },
        });
        spell.rank = data.rank;
        world.users.get("player").targets = new Set(targets.map((k) => tokens[k].object));
        const message = await by.run(() => ChatMessage.create(spellCard(world, spell, { castRank: data.rank })));
        return { spell, message, render: () => render(message) };
    }

    function render(message) {
        const html = player.run(() => document.createElement("li"));
        html.innerHTML = `<div class="message-content"></div>`;
        player.Hooks.callAll("renderChatMessageHTML", message, html);
        return html.querySelector("button");
    }

    /** Click Apply and wait for what it does */
    async function apply(button, done = () => false) {
        const count = dialogs.length;
        player.run(() => button.click());
        await settle(world, () => dialogs.length > count && done());
        await settle(world);
    }

    /** Which creatures' boxes were checked in the last Apply dialog */
    function checked() {
        const { form } = dialogs.findLast((d) => d.title.endsWith("Apply Spell Effects"));
        return [...form.querySelectorAll("label")]
            .filter((label) => label.querySelector("input[type=checkbox]")?.checked)
            .map((label) => label.textContent.trim().split(" ")[0]);
    }

    return { world, gm, player, actors, tokens, dialogs, answers, cast, apply, checked };
}

const effectsOn = (actor, name) => actor.itemTypes.effect.filter((e) => e.name === name);

for (const version of ["v13", "v14"]) {
    describe(`Spell effects for targets: who gets them (${version})`, () => {
        it("an aura without 'Aura:' in its name (Bless) goes on the caster, not the targets", async (t) => {
            const { actors, cast, apply, checked } = await setup(t, version);
            const { render } = await cast("bless", { targets: ["goblin"] });
            await apply(render(), () => effectsOn(actors.kyra, EFFECTS.bless.name).length > 0);
            assert.deepEqual(checked(), ["Kyra"]);
            assert.equal(effectsOn(actors.kyra, EFFECTS.bless.name).length, 1);
            assert.equal(effectsOn(actors.goblin, EFFECTS.bless.name).length, 0, "the targeted enemy gets no aura");
        });

        it("an emanation's effect (Courageous Anthem) goes on the caster and the allies in it", async (t) => {
            const { actors, cast, apply, checked, dialogs } = await setup(t, version);
            const { render } = await cast("anthem", { targets: ["goblin"] });
            await apply(render(), () => effectsOn(actors.ezren, EFFECTS.anthem.name).length > 0);
            const { form } = dialogs.at(-1);
            const listed = [...form.querySelectorAll("label")].map((l) => l.textContent.trim().split(" ")[0]);
            assert.deepEqual(listed, ["Goblin", "Ezren", "Kyra"], "the target is offered; the far ally isn't");
            assert.deepEqual(checked(), ["Ezren", "Kyra"]);
            assert.equal(effectsOn(actors.goblin, EFFECTS.anthem.name).length, 0);
            assert.equal(effectsOn(actors.valeros, EFFECTS.anthem.name).length, 0);
            assert.equal(effectsOn(actors.kyra, EFFECTS.anthem.name).length, 1);

            // Ezren isn't the player's, so the GM made it, as pf2e makes a dragged effect
            const [effect] = effectsOn(actors.ezren, EFFECTS.anthem.name);
            assert.equal(effect.system.context.origin.actor, actors.kyra.uuid);
            assert.equal(effect.system.level.value, 1);
        });

        it("a spell with targets and no area (Resist Energy) goes on the targets", async (t) => {
            const { actors, cast, apply, checked, answers } = await setup(t, version);
            answers["Resist Energy: Ezren"] = () => "ok";
            const { render } = await cast("resist", { targets: ["ezren"] });
            await apply(render(), () => effectsOn(actors.ezren, EFFECTS.resist.name).length > 0);
            assert.deepEqual(checked(), ["Ezren"]);
        });
    });

    describe(`Spell effects for targets: choices on a creature the caster doesn't own (${version})`, () => {
        it("the caster picks Resist Energy's damage type, and the GM creates it with that choice", async (t) => {
            const { actors, cast, apply, dialogs, answers, player } = await setup(t, version);
            answers["Spell Effect: Resist Energy: Ezren"] = (form) => {
                form.querySelector("input[value='1']").checked = true;
                form.querySelector("input[value='0']").checked = false;
                return "ok";
            };
            const { render } = await cast("resist", { targets: ["ezren"] });
            await apply(render(), () => effectsOn(actors.ezren, EFFECTS.resist.name).length > 0);

            const choice = dialogs.find((d) => d.title === "Spell Effect: Resist Energy: Ezren");
            assert.ok(choice, "the choice is asked");
            assert.equal(choice.session, player, "on the caster's player's screen");
            const options = [...choice.form.querySelectorAll("label")].map((l) => l.textContent.trim());
            assert.deepEqual(options, ["Acid", "Fire"], "a choice whose predicate Ezren doesn't meet isn't offered");

            const [effect] = effectsOn(actors.ezren, EFFECTS.resist.name);
            assert.equal(effect.system.rules[0].selection, "fire", "pf2e takes the selection without asking");
        });

        it("a choice whose predicate the creature meets is offered", async (t) => {
            const { actors, cast, apply, dialogs, answers } = await setup(t, version);
            answers["Spell Effect: Resist Energy: Goblin"] = () => "ok";
            const { render } = await cast("resist", { targets: ["goblin"] });
            await apply(render(), () => effectsOn(actors.goblin, EFFECTS.resist.name).length > 0);
            const choice = dialogs.find((d) => d.title === "Spell Effect: Resist Energy: Goblin");
            const options = [...choice.form.querySelectorAll("label")].map((l) => l.textContent.trim());
            assert.deepEqual(options, ["Acid", "Fire", "Sonic"]);
            assert.equal(effectsOn(actors.goblin, EFFECTS.resist.name)[0].system.rules[0].selection, "acid");
        });

        it("cancelling the choice leaves that creature's effect out", async (t) => {
            const { actors, cast, apply, answers, world } = await setup(t, version);
            answers["Spell Effect: Resist Energy: Ezren"] = () => "cancel";
            const { render } = await cast("resist", { targets: ["ezren"] });
            await apply(render());
            await settle(world);
            assert.equal(effectsOn(actors.ezren, EFFECTS.resist.name).length, 0);
        });

        it("on the caster's own creature, pf2e asks as it creates the effect: no choice is made first", async (t) => {
            const { actors, cast, apply, dialogs } = await setup(t, version);
            const { render } = await cast("resist", { targets: ["kyra"] });
            await apply(render(), () => effectsOn(actors.kyra, EFFECTS.resist.name).length > 0);
            assert.equal(dialogs.filter((d) => d.title.startsWith("Spell Effect:")).length, 0);
            assert.equal(effectsOn(actors.kyra, EFFECTS.resist.name)[0].system.rules[0].selection, undefined);
        });
    });

    describe(`Spell effects for targets: applying once (${version})`, () => {
        it("marks the card; its button then says Applied and checks nothing", async (t) => {
            const { actors, cast, apply, checked } = await setup(t, version);
            const { message, render } = await cast("anthem");
            await apply(render(), () => effectsOn(actors.kyra, EFFECTS.anthem.name).length > 0);
            assert.equal(message.flags[MODULE_ID].spellTargetEffects?.applied, true);

            const button = render();
            assert.match(button.textContent, /^Applied: /);
            await apply(button);
            assert.deepEqual(checked(), [], "nothing is checked the second time");
            assert.equal(effectsOn(actors.kyra, EFFECTS.anthem.name).length, 1);
        });

        it("a card the player can't update (the GM's) is marked by the GM", async (t) => {
            const { actors, cast, apply, gm } = await setup(t, version);
            const { message, render } = await cast("anthem", { by: gm });
            await apply(render(), () => !!message.flags[MODULE_ID].spellTargetEffects?.applied);
            assert.equal(effectsOn(actors.kyra, EFFECTS.anthem.name).length, 1);
            assert.equal(message.flags[MODULE_ID].spellTargetEffects?.applied, true);
        });

        it("a second click while the dialog is open does nothing", async (t) => {
            const { actors, cast, dialogs, player, world } = await setup(t, version);
            const { render } = await cast("anthem");
            let release;
            player.run(() => {
                const wait = foundry.applications.api.DialogV2.wait;
                foundry.applications.api.DialogV2.wait = (options) =>
                    new Promise((resolve) => (release = () => resolve(wait(options))));
            });
            const button = render();
            player.run(() => button.click());
            player.run(() => button.click());
            await settle(world, () => !!release);
            assert.equal(button.disabled, true);
            player.run(() => release());
            // The button is enabled again once the card's update comes back from the server
            await settle(world, () => effectsOn(actors.kyra, EFFECTS.anthem.name).length > 0 && !button.disabled);
            assert.equal(dialogs.length, 1);
            assert.equal(effectsOn(actors.kyra, EFFECTS.anthem.name).length, 1);
            assert.equal(button.disabled, false);
        });
    });
}
