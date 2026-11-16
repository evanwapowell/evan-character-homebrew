/**
 * What players aren't meant to see (issue #65), and Counteract's ability auras and blind rolls (issue #69), on the
 * stand-in:
 *
 * - Counteract's dialog showed an NPC's level (its rank and DC as "the creature itself", an effect's "level N"), listed
 *   effects pf2e keeps unidentified (with their caster, rank and what they end), and named creatures whose nameplates
 *   players can't see; its result card did too;
 * - Counteract's roll put names into pf2e's card as HTML;
 * - an aura from a feat or an NPC's ability was "counteracted" by deleting the recipient's copy of its effect, which
 *   pf2e gives back at its next aura check;
 * - a blind counteract roll's result card was shown to the player who rolled it, and what it counteracted vanished.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, makeActor, makeScene } from "./harness/pf2e.mjs";

const USERS = [
    { id: "gm", name: "Gamemaster", isGM: true },
    { id: "player", name: "Player" },
];
const SCRIPTS = ["counteract.js", "lib/names.js"];
/** Foundry's TOKEN_DISPLAY_MODES: the nameplate shown always, or to no one */
const ALWAYS = 50;
const NONE = 0;

let world;
afterEach(() => world?.close());

async function drain() {
    for (let i = 0; i < 30; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/** The GM and a player, with Ezren (the player's) and a level 5 goblin (the GM's, its nameplate hidden) on a scene */
async function setup(t, version) {
    const tick = useFakeTimers(t);
    world = createWorld({ users: USERS, version });
    const gm = await world.connect("gm", { scripts: SCRIPTS });
    const player = await world.connect("player", { scripts: SCRIPTS });
    tick(2_000);
    await world.flush();
    const scene = makeScene(world);
    const ezren = makeActor(world, { name: "Ezren", owners: ["player"] });
    const goblin = makeActor(world, { name: "Goblin Warchanter", type: "npc", displayName: NONE });
    goblin.system.details.level.value = 5;
    const goblinToken = addToken(world, scene, goblin, { x: 2 });
    addToken(world, scene, ezren);
    for (const session of [gm, player]) session.viewScene(scene);
    return { tick, gm, player, ezren, goblin, goblinToken };
}

const counteract = (session) => session.scripts["counteract.js"];
const candidates = (session, actor, options) => session.run(() => counteract(session).getCandidates(actor, options));

/** A message rendered in a session, as Foundry renders it: its content, then the renderChatMessageHTML hook */
function render(session, message) {
    const html = session.run(() => document.createElement("li"));
    html.innerHTML = `<div class="message-content">${message.content}</div>`;
    session.Hooks.callAll("renderChatMessageHTML", message, html);
    return html;
}

/** A counteract roll the player made outside the module (its flavor says Counteract): `total` 25 succeeds at DC 15 */
const counteractRoll = (session, { total = 25, blind = false } = {}) =>
    session.run(() =>
        ChatMessage.create({
            flavor: "<strong>Counteract</strong>",
            rolls: [{ total, dice: [{ faces: 20, total: 15 }] }],
            ...(blind ? { whisper: ["gm"], blind: true } : {}),
        }),
    );

const cards = () => world.messages.filter((m) => m.flags[MODULE_ID]?.counteract);

for (const version of ["v13", "v14"]) {
    describe(`Counteract: what players see (${version})`, () => {
        it("keeps an NPC's level from players: its own rank and DC, and an effect's level", async (t) => {
            const { gm, player, goblin, ezren } = await setup(t, version);
            addEffect(world, goblin, { name: "Effect: War Chant", level: 5 });
            const playerRows = candidates(player, goblin, { counteractor: ezren });
            const itself = playerRows.find((r) => r.kind === "creature");
            assert.equal(itself.rankSecret, true);
            assert.equal(itself.dcSecret, true);
            const chant = playerRows.find((r) => r.label === "Effect: War Chant");
            assert.equal(chant.rankSecret, true);
            assert.equal(chant.dcSecret, true);
            assert.doesNotMatch(chant.detail, /level/);
            // The GM sees the level
            assert.match(candidates(gm, goblin).find((r) => r.label === "Effect: War Chant").detail, /level 5/);

            // With pf2e showing DCs, the level is no secret
            world.pf2eSettings.metagame.dcs = true;
            const shown = candidates(player, goblin, { counteractor: ezren }).find((r) => r.kind === "creature");
            assert.equal(shown.rankSecret, false);
            assert.equal(shown.dcSecret, false);
        });

        it("doesn't keep the level of an effect on the player's own character", async (t) => {
            const { player, ezren } = await setup(t, version);
            addEffect(world, ezren, { name: "Effect: Rage", level: 3 });
            const rage = candidates(player, ezren).find((r) => r.label === "Effect: Rage");
            assert.equal(rage.rankSecret, false);
            assert.match(rage.detail, /level 3/);
        });

        it("leaves unidentified effects out for players; the GM's card doesn't name one to them", async (t) => {
            const { gm, player, goblin, ezren } = await setup(t, version);
            const hidden = addEffect(world, goblin, { name: "Effect: False Life", level: 2, unidentified: true });
            const labels = candidates(player, goblin, { counteractor: ezren }).map((r) => r.label);
            assert.ok(!labels.includes("Effect: False Life"), "players don't see it");
            const row = candidates(gm, goblin).find((r) => r.label === "Effect: False Life");
            assert.equal(row.unidentified, true);
            assert.match(row.detail, /unidentified/);

            // The GM counteracts it: players see an unidentified effect ended
            const [target] = gm.run(() => counteract(gm).readForm({ "pick-0": { checked: true } }, [row]).targets);
            const request = { id: "request-1", rank: 3, targets: [target] };
            await gm.run(async () => counteract(gm).resolve(await counteractRoll(gm), request));
            await drain();
            assert.equal(goblin.items.has(hidden.id), false);
            const [card] = cards();
            assert.match(render(gm, card).textContent, /Effect: False Life/);
            const seen = render(player, card).textContent;
            assert.match(seen, /Unidentified effect on Goblin Warchanter/);
            assert.doesNotMatch(seen, /False Life|rank 1|DC/);
        });

        it("doesn't name a creature whose nameplate players can't see", async (t) => {
            const { gm, player, goblin, goblinToken, ezren } = await setup(t, version);
            world.pf2eSettings.tokens.nameVisibility = true;
            const itself = candidates(player, goblin, { counteractor: ezren }).find((r) => r.kind === "creature");
            assert.equal(itself.label, "the creature itself");
            const row = candidates(gm, goblin).find((r) => r.kind === "creature");
            assert.equal(row.label, "Goblin Warchanter itself");

            const [target] = gm.run(() => counteract(gm).readForm({ "pick-0": { checked: true } }, [row]).targets);
            await gm.run(async () =>
                counteract(gm).resolve(await counteractRoll(gm), { id: "request-1", rank: 4, targets: [target] }),
            );
            await drain();
            const [card] = cards();
            assert.match(render(gm, card).textContent, /Goblin Warchanter itself/);
            const seen = render(player, card).textContent;
            assert.match(seen, /the creature itself/);
            assert.doesNotMatch(seen, /Goblin|rank 3/);

            // Its nameplate shown, the token's name
            Object.assign(goblinToken, { displayName: ALWAYS, name: "Masked Goblin" });
            const named = candidates(player, goblin, { counteractor: ezren }).find((r) => r.kind === "creature");
            assert.equal(named.label, "Masked Goblin itself");
        });

        it("escapes names in pf2e's card", async (t) => {
            const { player, ezren } = await setup(t, version);
            let args = null;
            const source = {
                name: "<b>Dispel</b>",
                statistic: { check: { roll: async (a) => void (args = a) } },
                traits: [],
            };
            const request = {
                id: "request-1",
                rank: 3,
                targets: [{ label: "<img src=x>", kind: "other", rank: 2, dc: 18, dcSecret: false }],
            };
            await player.run(() => counteract(player).rollCheck({ request, source, actor: ezren }));
            assert.doesNotMatch(args.label, /<b>/);
            assert.match(args.label, /&lt;b&gt;Dispel&lt;\/b&gt;/);
            assert.equal(args.dc.label, "&lt;img src&#x3D;x&gt; DC");
        });
    });

    describe(`Counteract: auras from abilities, and blind rolls (${version})`, () => {
        it("reports an aura from an ability rather than deleting its effect, which pf2e would give back", async (t) => {
            const { player, goblin, ezren } = await setup(t, version);
            addItem(world, goblin, {
                name: "Frightful Presence",
                type: "action",
                system: { rules: [{ key: "Aura", slug: "frightful-presence", radius: 30 }] },
            });
            const copy = addEffect(world, ezren, {
                name: "Effect: Frightful Presence",
                flags: { pf2e: { aura: { slug: "frightful-presence", origin: goblin.uuid } } },
            });
            const row = candidates(player, ezren).find((r) => r.kind === "abilityAura");
            assert.ok(row, "listed as an ability's aura");
            assert.equal(row.removable, false);
            assert.deepEqual(row.items, []);
            assert.equal(row.rankSecret, true, "its rank is the goblin's level's");

            const [target] = player.run(
                () => counteract(player).readForm({ "pick-0": { checked: true } }, [row]).targets,
            );
            const pending = player.run(async () =>
                counteract(player).resolve(await counteractRoll(player), { id: "r", rank: 4, targets: [target] }),
            );
            await drain();
            await pending;
            assert.equal(ezren.items.has(copy.id), true, "the copy stays");
            assert.match(cards()[0].content, /its aura comes from an ability, so what that ends is the GM's call/);
        });

        it("still ends an aura from a spell's effect at its source", async (t) => {
            const { player, goblin, ezren } = await setup(t, version);
            const aura = addEffect(world, goblin, {
                name: "Aura: Bane",
                rules: [{ key: "Aura", slug: "bane", radius: 10 }],
            });
            addEffect(world, ezren, {
                name: "Effect: Bane",
                flags: { pf2e: { aura: { slug: "bane", origin: goblin.uuid } } },
            });
            const row = candidates(player, ezren).find((r) => r.kind === "aura");
            assert.deepEqual(row.items, [aura.uuid]);
            assert.equal(row.removable, true);
        });

        it("sends a player's blind roll to the GM, whose card alone has the result, and ends it from there", async (t) => {
            const { gm, player, goblin } = await setup(t, version);
            const fear = addEffect(world, goblin, { name: "Effect: Fear", slug: "effect-fear" });
            const request = {
                id: "request-1",
                rank: 3,
                targets: [
                    {
                        label: "Fear",
                        creature: "Goblin Warchanter",
                        kind: "spell",
                        rank: 1,
                        dc: 15,
                        removable: true,
                        items: [fear.uuid],
                    },
                ],
            };
            const roll = await counteractRoll(player, { blind: true });
            const pending = player.run(() => counteract(player).resolve(roll, request));
            await drain();
            await pending;
            const [card] = cards();
            assert.deepEqual(card.whisper, ["gm"], "whispered to the GM alone");
            assert.equal(card.author.id, "gm", "posted by the GM's session");
            assert.equal(goblin.items.has(fear.id), true, "not ended until the GM says");
            assert.match(card.content, /Rolled blind/);
            assert.match(card.content, /end it with the button below/);
            assert.ok(player.notifications.some((n) => /went to the GM/.test(n.message)));

            // The player can't have their session end it
            t.mock.method(console, "warn", () => {});
            const removal = player.run(() =>
                player.scripts["settings.js"].askGM("counteractRemove", {
                    uuids: [fear.uuid],
                    rollMessageId: roll.id,
                    request,
                }),
            );
            await drain();
            assert.equal((await removal).reason, "refused");
            assert.equal(goblin.items.has(fear.id), true);

            // The GM's button
            const button = render(gm, card).querySelector("button");
            assert.match(button.textContent, /End what's counteracted/);
            assert.equal(render(player, card).querySelector("button"), null);
            await gm.run(() => counteract(gm).endHeld(card));
            await drain();
            assert.equal(goblin.items.has(fear.id), false);
            assert.match(card.content, /counteracted and ended/);
            assert.equal(render(gm, card).querySelector("button"), null);
        });
    });

    describe(`Names players can't see (scripts/lib/names.js, ${version})`, () => {
        it("marks a hidden name in a message, replaced for players only", async (t) => {
            const { gm, player, goblin, goblinToken } = await setup(t, version);
            const names = (session) => session.scripts["lib/names.js"];
            assert.equal(
                gm.run(() => names(gm).nameMarkup(goblinToken)),
                "Goblin Warchanter",
                "pf2e's setting is off",
            );
            world.pf2eSettings.tokens.nameVisibility = true;
            const content = gm.run(() => `<p>${names(gm).nameMarkup(goblin)} ends.</p>`);
            const message = { content, flags: {} };
            assert.equal(render(gm, message).textContent, "Goblin Warchanter ends.");
            assert.equal(render(player, message).textContent, "the creature ends.");
            assert.equal(
                player.run(() => names(player).nameForPlayers(goblin)),
                "the creature",
            );
            assert.equal(
                player.run(() => names(player).nameForUser(goblin)),
                "the creature",
            );
            assert.equal(
                gm.run(() => names(gm).nameForUser(goblin)),
                "Goblin Warchanter",
            );
            // A party member's name is always shown
            const ally = makeActor(world, { name: "Amiri", owners: ["player"] });
            assert.equal(
                player.run(() => names(player).nameForPlayers(ally)),
                "Amiri",
            );
        });
    });
}
