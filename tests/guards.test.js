/**
 * The guards that tell pf2e's messages from the module's own, on messages made through the fake ChatMessage.create,
 * so they carry the session mark as every message does in Foundry. In 1.26.5 the three guards tested
 * `message.flags[MODULE_ID]`, which the mark always sets, and skipped every message.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { MODULE_ID, createWorld } from "./harness/foundry.mjs";
import { PF2E_IDS, actionCard, addItem, checkMessage, itemCard, makeActor, pf2eItemUuid } from "./harness/pf2e.mjs";

const SCRIPTS = ["sustain.js", "spirit-stitched-familiar.js", "recall-knowledge.js"];

for (const version of ["v13", "v14"]) {
    describe(`guards on pf2e's messages (${version})`, () => {
        let world, gm, player, character, familiar;
        const post = (data) => player.run(() => ChatMessage.create(data));

        before(async () => {
            world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                ],
            });
            gm = await world.connect("gm", { scripts: SCRIPTS });
            player = await world.connect("player", { scripts: SCRIPTS });
            character = makeActor(world, { name: "Finch", type: "character" });
            familiar = makeActor(world, { name: "Thimble", type: "familiar" });
        });
        after(() => world.close());

        it("every message carries the session mark, so the bare module flags are always set", async () => {
            const message = await post({ content: "<p>Hello</p>" });
            assert.ok(message.flags[MODULE_ID]?.session);
        });

        describe("Sustain (scripts/sustain.js, isSystemSustain)", () => {
            const isSystemSustain = (message) =>
                player.run(() => player.scripts["sustain.js"].isSystemSustain(message));

            it("recognises the Sustain action's card from the character's actions", async () => {
                const sustain = addItem(world, character, {
                    name: "Sustain",
                    type: "action",
                    slug: "sustain",
                    source: pf2eItemUuid("actionspf2e", PF2E_IDS.sustain),
                });
                assert.equal(isSystemSustain(await post(itemCard(sustain))), true);
            });

            it("recognises pf2e's Sustain action posted from the actions list", async () => {
                const card = actionCard({ title: "Sustain", traits: ["concentrate"] });
                assert.equal(isSystemSustain(await post(card)), true);
            });

            it("doesn't take the module's own Sustain repost for pf2e's", async () => {
                const repost = {
                    speaker: { actor: character.id, alias: character.name },
                    content: `<h4 class="action"><strong>Sustain</strong></h4><p>Finch Sustains <strong>Bless</strong>.</p>`,
                    flags: { [MODULE_ID]: { sustain: true } },
                };
                assert.equal(isSystemSustain(await post(repost)), false);
            });

            it("doesn't take another action's card for Sustain", async () => {
                assert.equal(isSystemSustain(await post(actionCard({ title: "Seek" }))), false);
            });

            it("through the hook: the session that posted pf2e's Sustain prompts for it, and only for pf2e's", async () => {
                const prompts = (session) =>
                    session.notifications.filter((n) => /no sustained effects/.test(n.message));
                const before = { gm: prompts(gm).length, player: prompts(player).length };
                const sustain = character.itemTypes.action.find((a) => a.slug === "sustain");
                await post(itemCard(sustain));
                // Finch has nothing sustained, so the prompt is a notification
                assert.equal(prompts(player).length, before.player + 1);
                assert.equal(prompts(gm).length, before.gm);
                await post({
                    speaker: { actor: character.id, alias: character.name },
                    content: `<h4 class="action"><strong>Sustain</strong></h4>`,
                    flags: { [MODULE_ID]: { sustain: true } },
                });
                assert.equal(prompts(player).length, before.player + 1);
            });
        });

        describe("Shed Spirit and Stitching Strike (scripts/spirit-stitched-familiar.js, getCardKind)", () => {
            const getCardKind = (message) =>
                player.run(() => player.scripts["spirit-stitched-familiar.js"].getCardKind(message));

            for (const [kind, name, slug] of [
                ["shedSpirit", "Shed Spirit", "shed-spirit"],
                ["stitchingStrike", "Stitching Strike", "stitching-strike"],
            ]) {
                it(`starts ${name} from the familiar's action card`, async () => {
                    const action = addItem(world, familiar, {
                        name,
                        type: "action",
                        slug,
                        source: pf2eItemUuid("familiar-abilities", PF2E_IDS[kind]),
                    });
                    assert.equal(getCardKind(await post(itemCard(action))), kind);
                });
            }

            it("doesn't start from the module's own card", async () => {
                const action = familiar.itemTypes.action.find((a) => a.slug === "shed-spirit");
                const card = itemCard(action);
                card.flags[MODULE_ID] = { familiarStrike: { kind: "shedSpirit", outcome: null } };
                assert.equal(getCardKind(await post(card)), null);
            });

            it("doesn't start from a save rolled from the card", async () => {
                const action = familiar.itemTypes.action.find((a) => a.slug === "stitching-strike");
                const save = checkMessage({ actor: familiar, item: action, type: "saving-throw", statistic: "reflex" });
                assert.equal(getCardKind(await post(save)), null);
            });
        });

        describe("Recall Knowledge and Exploit Vulnerability (scripts/recall-knowledge.js, getCheck)", () => {
            const getCheck = (message) => player.run(() => player.scripts["recall-knowledge.js"].getCheck(message));
            const recall = () =>
                checkMessage({
                    actor: character,
                    statistic: "arcana",
                    domains: ["arcana", "int-based", "skill-check", "all"],
                    options: ["action:recall-knowledge", "self:type:character"],
                });

            it("recognises a Recall Knowledge skill check", async () => {
                assert.deepEqual(getCheck(await post(recall())), { kind: "recall", slug: "arcana", macro: false });
            });

            it("recognises an Exploit Vulnerability check", async () => {
                const exploit = addItem(world, character, {
                    name: "Exploit Vulnerability",
                    type: "action",
                    slug: "exploit-vulnerability",
                    source: pf2eItemUuid("actionspf2e", PF2E_IDS.exploitVulnerability),
                });
                const check = checkMessage({
                    actor: character,
                    item: exploit,
                    statistic: "esoteric-lore",
                    domains: ["esoteric-lore", "lore-skill-check", "skill-check", "all"],
                    options: ["item:slug:exploit-vulnerability"],
                });
                assert.deepEqual(getCheck(await post(check)), {
                    kind: "exploit",
                    slug: "esoteric-lore",
                    macro: false,
                });
            });

            it("doesn't take the module's own messages for checks", async () => {
                const own = recall();
                own.flags[MODULE_ID] = { recallKnowledgeResult: { card: "card000000000000" } };
                assert.equal(getCheck(await post(own)), null);
            });

            it("doesn't take another skill check for Recall Knowledge", async () => {
                const check = checkMessage({ actor: character, statistic: "athletics", options: ["action:shove"] });
                assert.equal(getCheck(await post(check)), null);
            });
        });

        it("no hook threw", () => {
            for (const session of [gm, player]) assert.deepEqual(session.Hooks.errors, []);
        });
    });
}
