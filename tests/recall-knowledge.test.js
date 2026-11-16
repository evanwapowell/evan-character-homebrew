/**
 * Recall Knowledge (scripts/recall-knowledge.js) driven end to end: a player's check, the question they're asked, the
 * GM's card, its review and the whisper it sends, on the stand-in (issues #55, #56 and #57):
 *
 * - a card sent again replaces what it recorded, rather than adding a second attempt and every fact again;
 * - pf2e's reroll (which deletes the roll's message and posts a new one with `isReroll`) updates the card of the roll
 *   it replaces, and the player isn't asked again;
 * - an answer the GM writes on a failure, where the draft has none, is sent;
 * - a check rolled before another about the same creature was sent is graded, when it's reviewed, as the later
 *   attempt it is;
 * - Basic Action Macros' roll is read without rolling each skill (a roll, even one not posted, would spend effects
 *   that last for one roll), and a Lore isn't the default reading;
 * - a critical failure tells a name as a success does (the true one when there's no false one, the one the character
 *   already knows when there is), and which facts are false stays on the GM's card, out of the world setting every
 *   client can read;
 * - the macro entry points are turned off with the feature.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorld, MODULE_ID, useFakeTimers } from "./harness/foundry.mjs";
import { addSkills, addToken, checkMessage, d20Roll, makeActor, makeScene } from "./harness/pf2e.mjs";

const RECORDS = "recallKnowledgeRecords";

async function settle(world, done = () => false) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

/**
 * The GM and Ezren's player, connected. Ezren has Religion +0 (with +2 to Recall Knowledge from an effect, the way
 * Instructive Strike's is predicated) and Warfare Lore +7; a level 1 zombie (pf2e's identification DCs for a common
 * level 1 creature, by src/module/recall-knowledge.ts) is on a scene.
 */
async function setup(t, version, { names = [] } = {}) {
    const tick = useFakeTimers(t);
    const world = createWorld({
        version,
        users: [
            { id: "gm", name: "Gamemaster", isGM: true },
            { id: "player", name: "Player" },
            { id: "other", name: "Other Player" },
        ],
    });
    const scripts = ["recall-knowledge.js"];
    const gm = await world.connect("gm", { scripts });
    const player = await world.connect("player", { scripts });
    t.after(() => world.close());
    tick(2_000);
    await settle(world);

    const scene = makeScene(world);
    const ezren = makeActor(world, { name: "Ezren", owners: ["player"] });
    addSkills(ezren, [
        {
            slug: "religion",
            label: "Religion",
            modifiers: [{ slug: "instructive-strike", modifier: 2, predicate: ["action:recall-knowledge"] }],
        },
        { slug: "warfare-lore", label: "Warfare Lore", lore: true, modifiers: [{ slug: "int", modifier: 7 }] },
    ]);
    const zombie = makeActor(world, { name: "Zombie Shambler", type: "npc" });
    zombie.system.traits = { value: ["undead", "mindless"], rarity: "common" };
    Object.assign(zombie, {
        identificationDCs: {
            skills: ["religion"],
            standard: { dc: 15, start: "normal", progression: [15, 17, 20, 25] },
            lore: [
                { dc: 13, start: "easy", progression: [13, 15, 17, 20, 25] },
                { dc: 10, start: "very-easy", progression: [10, 13, 15, 17, 20, 25] },
            ],
        },
        attributes: {
            weaknesses: [{ type: "vitality", applicationLabel: "Vitality", label: "Vitality 5", value: 5 }],
            resistances: [],
            immunities: [],
        },
    });
    const token = addToken(world, scene, zombie);

    const dialogs = [];
    /** What a test does in a dialog ("question" or "review") before its first button; it can return another */
    const edits = new Map();
    for (const session of [gm, player]) {
        session.run(() => {
            // pf2e's bestiaries, for false names
            game.packs = [
                {
                    documentName: "Actor",
                    metadata: { packageType: "system" },
                    getIndex: async () => names,
                },
            ];
            CONFIG.PF2E.weaknessTypes = { vitality: "Vitality", fire: "Fire", void: "Void" };
            foundry.applications.api.DialogV2.wait = async ({ content, buttons, render }) => {
                const form = document.createElement("form");
                form.innerHTML = content;
                const kind = form.querySelector('input[type="radio"][name="question"]') ? "question" : "review";
                dialogs.push({ session, kind, form });
                render?.(null, { element: form });
                const action = edits.get(kind)?.(form) ?? buttons[0].action;
                const button = buttons.find((b) => b.action === action);
                return button.callback ? button.callback(null, { form }) : action;
            };
            foundry.applications.api.DialogV2.confirm = async () => true;
        });
    }

    const cards = () => world.messages.filter((m) => m.flags[MODULE_ID]?.recallKnowledge);
    const cardFor = (message) => cards().find((c) => c.flags[MODULE_ID].recallKnowledge.message === message.id);
    const records = () => gm.run(() => game.settings.get(MODULE_ID, RECORDS))[zombie.uuid];
    const questions = () => dialogs.filter((d) => d.kind === "question").length;

    /** A Recall Knowledge check by Ezren about the zombie, posted by the player: pf2e's action or Basic Action Macros' */
    async function roll({ die = 10, modifier = 7, statistic = "religion", macro = false, reroll = false } = {}) {
        let data;
        if (macro) {
            // The macro's message (Recall_Knowledge.js): whispered and blind, a bare d20, and no statistic
            data = {
                speaker: { actor: ezren.id, alias: ezren.name },
                content: "<strong>Recall Knowledge</strong>",
                whisper: ["gm"],
                blind: true,
                rolls: [d20Roll(die)],
                flags: {
                    pf2e: {
                        context: {
                            options: ["action:recall-knowledge", "check:type:skill", "secret"],
                            origin: { token: null, actor: ezren.uuid },
                            rollMode: "blindroll",
                            traits: ["concentrate", "secret"],
                            type: "skill-check",
                        },
                    },
                },
            };
        } else {
            data = checkMessage({
                actor: ezren,
                statistic,
                die,
                modifier,
                domains: [statistic, "int-based", "skill-check", "all"],
                options: ["action:recall-knowledge", `action:recall-knowledge:${statistic}`, "secret"],
                target: zombie,
            });
            data.flags.pf2e.context.isReroll = reroll;
        }
        data.flags.pf2e.context.target = { actor: zombie.uuid, token: token.uuid };
        const before = questions();
        const message = await player.run(() => ChatMessage.create(data));
        await settle(world, () => !!cardFor(message) && (reroll || questions() > before));
        await settle(world);
        tick(1_000);
        return message;
    }

    /** pf2e's reroll of a check (Check.rerollFromMessage): the message is deleted, then the new one posted */
    async function rerollOf(message, { die, modifier = 7 }) {
        await player.run(() => message.delete());
        return roll({ die, modifier, reroll: true });
    }

    /** The card rendered for the GM: its lines and button */
    function render(card) {
        const html = gm.run(() => document.createElement("li"));
        html.innerHTML = `<div class="message-content"></div>`;
        gm.Hooks.callAll("renderChatMessageHTML", card, html);
        return { text: html.textContent, button: html.querySelector("button") };
    }

    /** The GM reviews the card (doing `edit` in the form) and sends it: the whisper sent */
    async function send(card, edit = null) {
        edits.set("review", edit);
        const before = world.messages.size;
        const { button } = render(card);
        gm.run(() => button.click());
        await settle(world, () => world.messages.size > before);
        await settle(world);
        edits.delete("review");
        return world.messages.size > before ? world.messages.contents.at(-1) : null;
    }

    return {
        world,
        gm,
        player,
        scripts,
        ezren,
        zombie,
        token,
        dialogs,
        cards,
        cardFor,
        records,
        questions,
        roll,
        rerollOf,
        render,
        send,
    };
}

for (const version of ["v13", "v14"]) {
    describe(`Recall Knowledge (${version})`, () => {
        it("sending a card again replaces what it recorded (#55)", async (t) => {
            const s = await setup(t, version);
            const message = await s.roll({ die: 10 }); // 17 vs DC 15: success
            const card = s.cardFor(message);
            const whisper = await s.send(card);
            assert.match(whisper.content, /Name: <strong>Zombie Shambler<\/strong>/);
            assert.match(whisper.content, /It&#x27;s weak to vitality\./);
            assert.equal(s.records().attempts.length, 1);
            const facts = s.records().facts.length;
            assert.equal(facts, 2, "the name and the answer");

            await s.send(card);
            assert.equal(s.records().attempts.length, 1, "still one attempt");
            assert.equal(s.records().facts.length, facts, "and the same facts");

            // The next check is the second attempt, at the second DC
            const next = s.cardFor(await s.roll({ die: 10 }));
            assert.equal(next.flags[MODULE_ID].recallKnowledge.attempt, 1);
            assert.equal(next.flags[MODULE_ID].recallKnowledge.checks[0].dc, 17);
        });

        it("a reroll updates the card of the roll it replaces, without asking again (#55)", async (t) => {
            const s = await setup(t, version);
            const first = await s.roll({ die: 3 }); // 10 vs 15: failure
            const card = s.cardFor(first);
            assert.equal(s.questions(), 1);
            assert.equal(card.flags[MODULE_ID].recallKnowledge.checks[0].degree, 1);

            const second = await s.rerollOf(first, { die: 15 }); // 22 vs 15: success
            assert.equal(s.cards().length, 1, "no second card");
            assert.equal(s.questions(), 1, "the player isn't asked again");
            const record = card.flags[MODULE_ID].recallKnowledge;
            assert.equal(record.message, second.id);
            assert.equal(record.die, 15);
            assert.equal(record.checks[record.chosen].degree, 2);
            assert.equal(record.question, "weaknesses", "the question asked for the first roll stands");
            assert.match(s.render(card).text, /Rerolled: this is the new roll/);
            const whisper = await s.send(card);
            assert.match(whisper.content, /It&#x27;s weak to vitality\./);
        });

        it("a reroll after the card was sent marks it, and sending again replaces the attempt (#55)", async (t) => {
            const s = await setup(t, version);
            const first = await s.roll({ die: 3 }); // failure
            const card = s.cardFor(first);
            await s.send(card);
            assert.deepEqual(
                s.records().attempts.map((a) => a.degree),
                ["failure"],
            );
            await s.rerollOf(first, { die: 15 });
            assert.equal(s.cards().length, 1);
            assert.match(s.render(card).text, /Sent before the reroll: Recall Knowledge: Failure/);
            await s.send(card);
            assert.deepEqual(
                s.records().attempts.map((a) => a.degree),
                ["success"],
            );
            assert.doesNotMatch(s.render(card).text, /Rerolled/);
        });

        it("sends an answer the GM writes on a failure (#55)", async (t) => {
            const s = await setup(t, version);
            const card = s.cardFor(await s.roll({ die: 3 })); // failure
            const whisper = await s.send(card, (form) => {
                const answer = form.querySelector('[name="answer0"]');
                answer.value = "It shuns the light of the sun.";
                answer.dispatchEvent(new answer.ownerDocument.defaultView.Event("input"));
            });
            assert.match(whisper.content, /It shuns the light of the sun\./);
            assert.doesNotMatch(whisper.content, /doesn't recall anything useful/);
        });

        it("grades a check rolled before another was sent as the later attempt it is (#55)", async (t) => {
            const s = await setup(t, version);
            const first = s.cardFor(await s.roll({ die: 10 })); // 17: success on the first attempt
            const second = s.cardFor(await s.roll({ die: 8 })); // 15: success on the first attempt, not the second
            assert.equal(second.flags[MODULE_ID].recallKnowledge.attempt, 0);
            assert.match(s.render(second).text, /15 vs DC 15 \(1st attempt\): Success/);

            await s.send(first);
            const whisper = await s.send(second);
            const record = second.flags[MODULE_ID].recallKnowledge;
            assert.equal(record.attempt, 1);
            assert.equal(record.checks[0].dc, 17);
            assert.equal(record.checks[0].degree, 1, "15 vs DC 17: failure");
            assert.match(whisper.content, /doesn't recall anything useful/);
            const review = s.dialogs.filter((d) => d.kind === "review").at(-1);
            assert.match(review.form.textContent, /It's now the 2nd attempt/);
        });

        it("notes an earlier check about the creature that hasn't been sent (#55)", async (t) => {
            const s = await setup(t, version);
            await s.roll({ die: 10 });
            const second = s.cardFor(await s.roll({ die: 10 }));
            await s.send(second);
            const review = s.dialogs.filter((d) => d.kind === "review").at(-1);
            assert.match(review.form.textContent, /Ezren rolled an earlier check about this creature/);
        });

        it("reads Basic Action Macros' roll without rolling, and doesn't default to a Lore (#57)", async (t) => {
            const s = await setup(t, version);
            const card = s.cardFor(await s.roll({ macro: true, die: 12 }));
            assert.deepEqual(s.ezren.skillRolls, [], "no skill was rolled");
            const record = card.flags[MODULE_ID].recallKnowledge;
            const religion = record.checks.find((row) => row.slug === "religion");
            assert.equal(religion.total, 14, "the d20 and Religion's +2 for Recall Knowledge");
            assert.equal(religion.degree, 1);
            const lore = record.checks.find((row) => row.slug === "warfare-lore" && row.kind === "unspecific");
            assert.equal(lore.total, 19);
            assert.equal(lore.degree, 2, "19 vs DC 13: a success, if Warfare Lore applies");
            assert.equal(record.checks[record.chosen].slug, "religion", "the skill that identifies it, not the Lore");
            assert.match(s.render(card).text, /Religion 14 vs DC 15/);
            await s.send(card, (form) => {
                assert.match(form.textContent, /Warfare Lore \(if this Lore applies\) 19/);
            });
        });

        it("on a critical failure with no false name, tells the true name; what's false stays on the card (#56)", async (t) => {
            const s = await setup(t, version);
            const card = s.cardFor(await s.roll({ die: 1, modifier: 0 })); // critical failure
            const whisper = await s.send(card);
            assert.match(whisper.content, /Name: <strong>Zombie Shambler<\/strong>/, "a name, as on a success");
            assert.doesNotMatch(whisper.content, /It&#x27;s weak to vitality\./);

            const { facts } = s.records();
            assert.deepEqual(
                facts.map((f) => f.kind),
                ["name", "answer"],
            );
            assert.ok(
                facts.every((f) => !("false" in f)),
                "the world setting doesn't say what's false",
            );
            assert.deepEqual(card.flags[MODULE_ID].recallKnowledge.told, [
                { kind: "name", false: false },
                { kind: "answer", false: true },
            ]);
            const next = s.cardFor(await s.roll({ die: 10 }));
            assert.match(s.render(next).text, /Known already: Zombie Shambler \| \(false\) It's weak to /);
        });

        it("on a critical failure, keeps the name already known rather than a false one (#56)", async (t) => {
            const names = [
                {
                    type: "npc",
                    name: "Skeleton Guard",
                    system: { details: { level: { value: 1 } }, traits: { value: ["undead"], rarity: "common" } },
                },
            ];
            const s = await setup(t, version, { names });
            const read = (form) => {
                named = form.querySelector('[name="name"]').value;
                return "cancel";
            };
            let named = null;
            const fumble = s.cardFor(await s.roll({ die: 1, modifier: 0 }));
            await s.send(fumble, read);
            assert.equal(named, "Skeleton Guard", "a false name, with none known");

            await s.send(s.cardFor(await s.roll({ die: 10 }))); // a success: its true name
            await s.send(fumble, read);
            assert.equal(named, "Zombie Shambler", "the name known now, not a false one that contradicts it");
        });

        it("turns the macro entry points off with the feature", async (t) => {
            const s = await setup(t, version);
            await s.gm.run(() => game.settings.set(MODULE_ID, "enabledRecallKnowledge", false));
            const api = s.gm.run(() => game.modules.get(MODULE_ID).api.recallKnowledge);
            await s.gm.run(() => api.forget(s.token));
            await s.gm.run(() => api.known(s.token));
            assert.deepEqual(
                s.gm.notifications.map((n) => n.type),
                ["warn", "warn"],
            );
        });

        it("no hook threw", async (t) => {
            const s = await setup(t, version);
            await s.roll({ die: 10 });
            for (const session of [s.gm, s.player]) assert.deepEqual(session.Hooks.errors, []);
        });
    });

    /**
     * Requests about a check, sent by a player: only the check's roller can start its card and ask its question, about
     * the creature it was rolled against (#64). Until 1.26.20 any player could set the question on a pending card.
     */
    describe(`Recall Knowledge: requests checked by the GM (${version})`, () => {
        async function ask(s, session, action, data) {
            let answer = null;
            session.run(() => session.scripts["settings.js"].askGM(action, data)).then((a) => (answer = a));
            await settle(s.world, () => answer !== null);
            return answer;
        }

        it("another player can't ask the question on a check they didn't roll, or start its card", async (t) => {
            const s = await setup(t, version);
            t.mock.method(console, "warn", () => {});
            const message = await s.roll({ die: 10 });
            const card = s.cardFor(message);
            const before = structuredClone(card.flags[MODULE_ID].recallKnowledge);
            const other = await s.world.connect("other", { scripts: s.scripts });

            const question = await ask(s, other, "recallKnowledgeQuestion", {
                messageId: message.id,
                tokenUuid: s.token.uuid,
                question: "other",
                other: "What's the GM's password?",
            });
            assert.deepEqual(question, {
                ok: false,
                reason: "refused",
                error: "the check isn't theirs, or isn't in chat",
            });
            const start = await ask(s, other, "recallKnowledgeStart", {
                messageId: message.id,
                tokenUuid: s.token.uuid,
                kind: "recall",
            });
            assert.equal(start.reason, "refused");
            await settle(s.world);
            assert.equal(card.flags[MODULE_ID].recallKnowledge.question, before.question);
            assert.equal(card.flags[MODULE_ID].recallKnowledge.other, before.other);
            assert.equal(s.cards().length, 1);
        });

        it("the roller can't start a card about a creature the check wasn't against", async (t) => {
            const s = await setup(t, version);
            t.mock.method(console, "warn", () => {});
            const message = await s.roll({ die: 10 });
            const ogre = makeActor(s.world, { name: "Ogre", type: "npc" });
            const ogreToken = addToken(s.world, s.token.parent, ogre, { x: 3 });
            const answer = await ask(s, s.player, "recallKnowledgeStart", {
                messageId: message.id,
                tokenUuid: ogreToken.uuid,
                kind: "recall",
            });
            assert.deepEqual(answer, { ok: false, reason: "refused", error: "the check wasn't against that creature" });
            assert.equal(s.cards().length, 1);
        });

        it("the roller's own question is set on the card", async (t) => {
            const s = await setup(t, version);
            const message = await s.roll({ die: 10 });
            const answer = await ask(s, s.player, "recallKnowledgeQuestion", {
                messageId: message.id,
                tokenUuid: s.token.uuid,
                question: "other",
                other: "Does it sleep?",
            });
            assert.equal(answer.ok, true);
            await settle(s.world);
            const record = s.cardFor(message).flags[MODULE_ID].recallKnowledge;
            assert.equal(record.question, "other");
            assert.equal(record.other, "Does it sleep?");
        });
    });
}
