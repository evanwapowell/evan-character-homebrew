/**
 * Work a player hands to the active GM (scripts/lib/gm.js), and Counteract's removal through it.
 *
 * Up to 1.26.10, a player's client emitted the request and carried on as if it was done whenever a GM was logged in,
 * though no GM session might act on it (one settling, or one that vanished): Counteract's card said an effect was
 * "counteracted and ended" when nothing was deleted, and a reroll skipped removing it (issue #46).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, makeActor } from "./harness/pf2e.mjs";

const USERS = [
    { id: "gm", name: "Gamemaster", isGM: true },
    { id: "player", name: "Player" },
];
const SOCKET = "module.evan-character-homebrew";
/** session.js's settling, and gm.js's wait for a GM session to take a request */
const SETTLE = 2_000;
const CONFIRM = 2_000;
const ACCEPT = 10_000;

let world;
afterEach(() => world?.close());

/** Let socket messages, and the promises they start, run */
async function drain() {
    for (let i = 0; i < 20; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/** The GM and a player, settled, with a goblin (the GM's) under an effect */
async function setup(t, { gm = true, scripts = ["counteract.js"] } = {}) {
    const tick = useFakeTimers(t);
    world = createWorld({ users: USERS });
    const sessions = {};
    if (gm) sessions.gm = await world.connect("gm", { scripts });
    sessions.player = await world.connect("player", { scripts });
    tick(SETTLE);
    await world.flush();
    const goblin = makeActor(world, { name: "Goblin", type: "npc" });
    const fear = addEffect(world, goblin, { name: "Effect: Fear", slug: "effect-fear" });
    return { tick, ...sessions, goblin, fear };
}

const askGM = (session, ...args) => session.run(() => session.scripts["settings.js"].askGM(...args));

/**
 * A counteract check the player rolled (a roll made outside the module: its flavor says Counteract), whose result
 * counteracts a rank 1 effect at rank 3 (total 25 against DC 15)
 */
const counteractRoll = (player, total = 25) =>
    player.run(() =>
        ChatMessage.create({
            flavor: "<strong>Counteract</strong>",
            rolls: [{ total, dice: [{ faces: 20, total: 15 }] }],
        }),
    );

/** What Counteract asks the GM for: to remove the effect the roll counteracted */
async function removal(player, effect, { total = 25 } = {}) {
    const roll = await counteractRoll(player, total);
    const request = {
        id: "request-1",
        rank: 3,
        targets: [{ label: "Fear", rank: 1, dc: 15, removable: true, items: [effect.uuid] }],
    };
    return { uuids: [effect.uuid], rollMessageId: roll.id, request };
}
const warnings = (session) => session.notifications.filter((n) => n.type === "warn").map((n) => n.message);

describe("requests to the active GM (scripts/lib/gm.js)", () => {
    it("is done once the GM's session answers, with what the handler returned", async (t) => {
        const { player, goblin, fear } = await setup(t);
        const pending = askGM(player, "counteractRemove", await removal(player, fear));
        await drain();
        assert.deepEqual(await pending, { ok: true, result: [fear.uuid] });
        assert.equal(goblin.items.has(fear.id), false);
        assert.deepEqual(warnings(player), []);
    });

    it("isn't done when no GM session answers, and says so", async (t) => {
        const { tick, gm, player, goblin, fear } = await setup(t);
        // The GM is logged in, but their only window is frozen
        gm.unreachable = true;
        let answer = null;
        const data = await removal(player, fear);
        askGM(player, "counteractRemove", data, { title: "Counteract", task: "end it" }).then((a) => (answer = a));
        await drain();
        tick(ACCEPT - 1);
        await drain();
        assert.equal(answer, null, "still waiting");
        tick(1);
        await drain();
        assert.deepEqual(answer, { ok: false, reason: "unanswered" });
        assert.equal(goblin.items.has(fear.id), true);
        assert.deepEqual(warnings(player), ["Counteract: no GM session answered the request to end it: try again."]);
    });

    it("isn't sent when no GM is logged in", async (t) => {
        const { player, fear } = await setup(t, { gm: false });
        const answer = await askGM(player, "counteractRemove", { uuids: [fear.uuid] }, { title: "Counteract" });
        assert.deepEqual(answer, { ok: false, reason: "absent" });
        assert.deepEqual(warnings(player), ["Counteract: a GM must be logged in to do it."]);
    });

    it("runs in the GM's own session when the GM asks", async (t) => {
        const { gm, goblin, fear } = await setup(t);
        const sent = [];
        gm.run(() => {
            const emit = game.socket.emit;
            game.socket.emit = (event, data) => (sent.push(data), emit(event, data));
        });
        const answer = await askGM(gm, "counteractRemove", { uuids: [fear.uuid] });
        assert.deepEqual(answer, { ok: true, result: [fear.uuid] });
        assert.equal(goblin.items.has(fear.id), false);
        assert.deepEqual(sent, [], "nothing went over the socket");
    });

    it("is answered by another of the GM's sessions when the chosen one has vanished", async (t) => {
        const { tick, gm, player, goblin, fear } = await setup(t);
        // A second window, opened later, so the first is the one chosen
        tick(1_000);
        const second = await world.connect("gm", { scripts: ["counteract.js"] });
        tick(SETTLE);
        await drain();
        gm.disconnect({ silently: true });

        let answer = null;
        const data = await removal(player, fear);
        askGM(player, "counteractRemove", data).then((a) => (answer = a));
        await drain();
        assert.equal(answer, null, "the second window first asks whether the first is there");
        tick(CONFIRM);
        await drain();
        assert.deepEqual(answer, { ok: true, result: [fear.uuid] });
        assert.equal(goblin.items.has(fear.id), false);
        assert.ok(second.connected);
    });

    it("reports a handler's error", async (t) => {
        const { gm, player } = await setup(t);
        for (const session of [gm, player]) {
            session.run(() =>
                session.scripts["settings.js"].onGMRequest("test", () => {
                    throw new Error("the tree is gone");
                }),
            );
        }
        const pending = askGM(player, "test", {}, { title: "Test", task: "grow it" });
        await drain();
        assert.deepEqual(await pending, { ok: false, reason: "failed", error: "the tree is gone" });
        assert.deepEqual(warnings(player), ["Test: the GM's session couldn't grow it (the tree is gone)."]);
    });

    it("still handles a request from an earlier version, with no request ID", async (t) => {
        const { player, goblin, fear } = await setup(t);
        const data = await removal(player, fear);
        player.run(() => game.socket.emit(SOCKET, { action: "counteractRemove", ...data }));
        await drain();
        assert.equal(goblin.items.has(fear.id), false);
    });

    it("gives the handler and the check the sender, as Foundry's server does", async (t) => {
        const { gm, player } = await setup(t);
        const seen = [];
        for (const session of [gm, player]) {
            session.run(() =>
                session.scripts["settings.js"].onGMRequest(
                    "test",
                    (data, sender) => void seen.push(["work", sender.id]),
                    {
                        check: (data, sender) => void seen.push(["check", sender.id]),
                    },
                ),
            );
        }
        const pending = askGM(player, "test", {});
        await drain();
        assert.deepEqual(await pending, { ok: true, result: null });
        assert.deepEqual(seen, [
            ["check", "player"],
            ["work", "player"],
        ]);
    });

    it("refuses a player's request its check refuses, says why and does nothing", async (t) => {
        const { gm, player, goblin, fear } = await setup(t);
        const logged = [];
        t.mock.method(console, "warn", (...args) => logged.push(args.join(" ")));
        // No roll at all, as a crafted request would be
        const pending = askGM(
            player,
            "counteractRemove",
            { uuids: [fear.uuid] },
            { title: "Counteract", task: "end it" },
        );
        await drain();
        assert.deepEqual(await pending, {
            ok: false,
            reason: "refused",
            error: "the counteract check isn't theirs, or isn't in chat",
        });
        assert.equal(goblin.items.has(fear.id), true);
        assert.deepEqual(warnings(player), [
            "Counteract: the GM's session wouldn't end it: the counteract check isn't theirs, or isn't in chat.",
        ]);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /GM request "counteractRemove" from Player refused/);
        assert.deepEqual(warnings(gm), []);
    });

    it("doesn't run a GM's own requests through the check", async (t) => {
        const { gm, goblin, fear } = await setup(t);
        const answer = await askGM(gm, "counteractRemove", { uuids: [fear.uuid] });
        assert.deepEqual(answer, { ok: true, result: [fear.uuid] });
        assert.equal(goblin.items.has(fear.id), false);
    });

    it("refuses a request whose sender is unknown", async (t) => {
        const { gm, player, goblin, fear } = await setup(t);
        t.mock.method(console, "warn", () => {});
        const data = await removal(player, fear);
        // A socket message without the sender's ID (Foundry's server always adds it)
        gm.run(() => {
            const [listener] = gm.socketHandlers.get(SOCKET);
            gm.socketHandlers.set(SOCKET, [(payload) => listener(payload, undefined)]);
        });
        player.run(() => game.socket.emit(SOCKET, { action: "counteractRemove", ...data, gmRequest: "id-1" }));
        await drain();
        assert.equal(goblin.items.has(fear.id), true);
    });
});

describe("Counteract's removal, checked by the GM's session (scripts/counteract.js)", () => {
    const ask = (player, data) => askGM(player, "counteractRemove", data);

    it("removes only what the roll counteracts", async (t) => {
        const { player, goblin, fear } = await setup(t);
        const haste = addEffect(world, goblin, { name: "Effect: Haste", slug: "effect-haste" });
        const data = await removal(player, fear);
        // Haste is rank 7: a critical success at rank 3 (25 against DC 15) reaches rank 6
        data.request.targets.push({ label: "Haste", rank: 7, dc: 15, removable: true, items: [haste.uuid] });
        data.uuids.push(haste.uuid);
        const pending = ask(player, data);
        await drain();
        assert.deepEqual(await pending, { ok: true, result: [fear.uuid] });
        assert.equal(goblin.items.has(fear.id), false);
        assert.equal(goblin.items.has(haste.id), true);
    });

    it("refuses what the roll doesn't counteract, or an item the request doesn't name", async (t) => {
        const { player, goblin, fear } = await setup(t);
        t.mock.method(console, "warn", () => {});
        // A critical failure (total 5 against DC 15) counteracts nothing
        const failed = ask(player, await removal(player, fear, { total: 5 }));
        await drain();
        assert.deepEqual(await failed, { ok: false, reason: "refused", error: "the check counteracts none of it" });

        const haste = addEffect(world, goblin, { name: "Effect: Haste", slug: "effect-haste" });
        const data = await removal(player, fear);
        data.uuids = [haste.uuid];
        const unnamed = ask(player, data);
        await drain();
        assert.equal((await unnamed).reason, "refused");
        assert.equal(goblin.items.has(fear.id), true);
        assert.equal(goblin.items.has(haste.id), true);
    });

    it("refuses a roll that isn't the player's, or isn't a counteract check", async (t) => {
        const { gm, player, goblin, fear } = await setup(t);
        t.mock.method(console, "warn", () => {});
        const data = await removal(player, fear);
        const gmsRoll = await counteractRoll(gm);
        const notTheirs = ask(player, { ...data, rollMessageId: gmsRoll.id });
        await drain();
        assert.equal((await notTheirs).reason, "refused");

        const chat = await player.run(() =>
            ChatMessage.create({ content: "hello", rolls: [{ total: 25, dice: [{ faces: 20, total: 15 }] }] }),
        );
        const notCounteract = ask(player, { ...data, rollMessageId: chat.id });
        await drain();
        assert.deepEqual(await notCounteract, {
            ok: false,
            reason: "refused",
            error: "the check wasn't rolled for this counteract",
        });
        assert.equal(goblin.items.has(fear.id), true);
    });
});

describe("Counteract through the active GM (scripts/counteract.js)", () => {
    /** A check that succeeds against DC 15 (total 25) for rank 3, against a rank 1 effect */
    const request = (fear) => ({
        id: "request-1",
        rank: 3,
        targets: [
            {
                label: "Fear",
                creature: "Goblin",
                kind: "spell",
                rank: 1,
                dc: 15,
                removable: true,
                items: [fear.uuid],
            },
        ],
    });
    const rollMessage = (player) => counteractRoll(player);
    const resolve = (session, ...args) => session.run(() => session.scripts["counteract.js"].resolve(...args));
    const card = () => world.messages.find((m) => m.flags["evan-character-homebrew"]?.counteract);

    it("says the effect was ended once the GM's session ended it", async (t) => {
        const { player, goblin, fear } = await setup(t);
        const pending = resolve(player, await rollMessage(player), request(fear));
        await drain();
        await pending;
        assert.equal(goblin.items.has(fear.id), false);
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, true);
        assert.match(card().content, /counteracted and ended/);
    });

    it("doesn't say it was ended when no GM session answered, and a reroll ends it", async (t) => {
        const { tick, gm, player, goblin, fear } = await setup(t);
        gm.unreachable = true;
        const first = resolve(player, await rollMessage(player), request(fear));
        await drain();
        tick(ACCEPT);
        await drain();
        await first;
        assert.equal(goblin.items.has(fear.id), true);
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, false);
        assert.match(card().content, /counteracted, but not ended/);

        // The GM's window is back, and the check is rerolled
        gm.unreachable = false;
        const reroll = resolve(player, await rollMessage(player), request(fear));
        await drain();
        await reroll;
        assert.equal(goblin.items.has(fear.id), false);
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, true);
        assert.match(card().content, /counteracted and ended/);
    });

    it("says it was ended on a reroll when a GM session ended it too late to answer", async (t) => {
        const { tick, gm, player, goblin, fear } = await setup(t);
        // The GM's window is slow: the request arrives after the player has stopped waiting, and is still done
        gm.latency = ACCEPT + 5_000;
        const first = resolve(player, await rollMessage(player), request(fear));
        await drain();
        tick(ACCEPT);
        await drain();
        await first;
        assert.match(card().content, /counteracted, but not ended/);
        tick(5_000);
        await drain();
        assert.equal(goblin.items.has(fear.id), false, "the GM's session removed it late");

        gm.latency = 0;
        const reroll = resolve(player, await rollMessage(player), request(fear));
        await drain();
        await reroll;
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, true);
        assert.match(card().content, /counteracted and ended/);
    });

    it("resolves a reroll after the roll before it, on one card", async (t) => {
        const { tick, gm, player, goblin, fear } = await setup(t);
        gm.unreachable = true;
        const first = resolve(player, await rollMessage(player), request(fear));
        // Rerolled while the first roll's request is still waiting
        const rerolled = await rollMessage(player);
        const reroll = resolve(player, rerolled, request(fear));
        await drain();
        // The first roll's request is lost; the GM's window is back before it's given up on
        gm.unreachable = false;
        tick(ACCEPT);
        await drain();
        await first;
        await drain();
        await reroll;
        const cards = world.messages.filter((m) => m.flags["evan-character-homebrew"]?.counteract);
        assert.equal(cards.length, 1);
        assert.equal(goblin.items.has(fear.id), false);
        assert.match(cards[0].content, /counteracted and ended/);
        assert.equal(cards[0].flags["evan-character-homebrew"].counteract.rollMessage, rerolled.id);
    });
});
