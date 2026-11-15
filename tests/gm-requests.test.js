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
const warnings = (session) => session.notifications.filter((n) => n.type === "warn").map((n) => n.message);

describe("requests to the active GM (scripts/lib/gm.js)", () => {
    it("is done once the GM's session answers, with what the handler returned", async (t) => {
        const { player, goblin, fear } = await setup(t);
        const pending = askGM(player, "counteractRemove", { uuids: [fear.uuid] });
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
        askGM(player, "counteractRemove", { uuids: [fear.uuid] }, { title: "Counteract", task: "end it" }).then(
            (a) => (answer = a),
        );
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
        askGM(player, "counteractRemove", { uuids: [fear.uuid] }).then((a) => (answer = a));
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
        player.run(() => game.socket.emit(SOCKET, { action: "counteractRemove", uuids: [fear.uuid] }));
        await drain();
        assert.equal(goblin.items.has(fear.id), false);
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
    const rollMessage = (id) => ({ id, rolls: [{ total: 25, dice: [{ faces: 20, total: 15 }] }], flags: {} });
    const resolve = (session, ...args) => session.run(() => session.scripts["counteract.js"].resolve(...args));
    const card = () => world.messages.find((m) => m.flags["evan-character-homebrew"]?.counteract);

    it("says the effect was ended once the GM's session ended it", async (t) => {
        const { player, goblin, fear } = await setup(t);
        const pending = resolve(player, rollMessage("roll-1"), request(fear));
        await drain();
        await pending;
        assert.equal(goblin.items.has(fear.id), false);
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, true);
        assert.match(card().content, /counteracted and ended/);
    });

    it("doesn't say it was ended when no GM session answered, and a reroll ends it", async (t) => {
        const { tick, gm, player, goblin, fear } = await setup(t);
        gm.unreachable = true;
        const first = resolve(player, rollMessage("roll-1"), request(fear));
        await drain();
        tick(ACCEPT);
        await drain();
        await first;
        assert.equal(goblin.items.has(fear.id), true);
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, false);
        assert.match(card().content, /counteracted, but not ended/);

        // The GM's window is back, and the check is rerolled
        gm.unreachable = false;
        const reroll = resolve(player, rollMessage("roll-2"), request(fear));
        await drain();
        await reroll;
        assert.equal(goblin.items.has(fear.id), false);
        assert.equal(card().flags["evan-character-homebrew"].counteract.results[0].removed, true);
        assert.match(card().content, /counteracted and ended/);
    });
});
