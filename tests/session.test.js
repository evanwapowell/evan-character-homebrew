/**
 * scripts/lib/session.js with one user connected twice: two copies of the script, each in its own fake session,
 * talking over the fake module socket, with fake timers for its heartbeat, settling and expiry.
 *
 * Up to 1.26.9, a chosen session that vanished without saying goodbye was deferred to for 150 seconds, a GM's only
 * session dropped work in its first 2 seconds, a session shown again forgot a slow peer, and turn-start work went to a
 * session that wasn't viewing the combat's scene (issue #45).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, makeActor, makeScene } from "./harness/pf2e.mjs";

const USERS = [
    { id: "gm", name: "Gamemaster", isGM: true },
    { id: "player", name: "Player" },
];
/** session.js's timings */
const SETTLE = 2_000;
const HEARTBEAT = 20_000;
const EXPIRY = 150_000;
const CONFIRM = 2_000;
const SOCKET = "module.evan-character-homebrew";

let world;
afterEach(() => world?.close());

/** The session helpers as a session sees them */
const helpers = (session) => {
    const api = session.scripts["settings.js"];
    return {
        isPrimarySession: () => session.run(() => api.isPrimarySession()),
        isActiveGM: (options) => session.run(() => api.isActiveGM(options)),
        confirmActiveGM: (options) => session.run(() => api.confirmActiveGM(options)),
        confirmPrimarySession: (options) => session.run(() => api.confirmPrimarySession(options)),
        createdHere: (...args) => session.run(() => api.createdHere(...args)),
    };
};

/** The GM in two windows, the first opened a second before the other, and a player; all settled */
async function connectAll(t, { scripts = [] } = {}) {
    const tick = useFakeTimers(t);
    world = createWorld({ users: USERS });
    const first = await world.connect("gm", { scripts });
    tick(1_000);
    const second = await world.connect("gm", { scripts });
    const player = await world.connect("player", { scripts });
    tick(SETTLE);
    await world.flush();
    return { tick, first, second, player };
}

describe("sessions of one user (scripts/lib/session.js)", () => {
    it("a new session doesn't act until it has heard from the others", async (t) => {
        useFakeTimers(t);
        world = createWorld({ users: USERS });
        const only = await world.connect("gm");
        assert.equal(helpers(only).isPrimarySession(), false);
        t.mock.timers.tick(SETTLE);
        assert.equal(helpers(only).isPrimarySession(), true);
    });

    it("only one of a user's sessions is the primary one: the one open longest", async (t) => {
        const { first, second, player } = await connectAll(t);
        assert.equal(helpers(first).isPrimarySession(), true);
        assert.equal(helpers(second).isPrimarySession(), false);
        assert.equal(helpers(first).isActiveGM(), true);
        assert.equal(helpers(second).isActiveGM(), false);
        // Another user's session answers for that user, and isn't the GM
        assert.equal(helpers(player).isPrimarySession(), true);
        assert.equal(helpers(player).isActiveGM(), false);
    });

    it("a shown session is chosen over a hidden one", async (t) => {
        const { first, second } = await connectAll(t);
        first.setShown(false);
        await world.flush();
        assert.equal(helpers(first).isPrimarySession(), false);
        assert.equal(helpers(second).isPrimarySession(), true);

        first.setShown(true);
        await world.flush();
        assert.equal(helpers(first).isPrimarySession(), true);
        assert.equal(helpers(second).isPrimarySession(), false);
    });

    it("a session that says goodbye hands over to the next", async (t) => {
        const { first, second } = await connectAll(t);
        first.disconnect();
        await world.flush();
        assert.equal(helpers(second).isPrimarySession(), true);
        assert.equal(helpers(second).isActiveGM(), true);
    });

    it("a session that goes quiet without saying goodbye is forgotten after it expires", async (t) => {
        const { tick, first, second } = await connectAll(t);
        first.disconnect({ silently: true });
        assert.equal(helpers(second).isPrimarySession(), false);
        for (let elapsed = 0; elapsed <= EXPIRY; elapsed += HEARTBEAT) {
            tick(HEARTBEAT);
            await world.flush();
        }
        assert.equal(helpers(second).isPrimarySession(), true);
    });

    it("heartbeats keep sessions known to each other", async (t) => {
        const { tick, first, second } = await connectAll(t);
        for (let elapsed = 0; elapsed <= EXPIRY * 2; elapsed += HEARTBEAT) {
            tick(HEARTBEAT);
            await world.flush();
        }
        assert.equal(helpers(first).isPrimarySession(), true);
        assert.equal(helpers(second).isPrimarySession(), false);
    });

    it("createdHere is true only in the session that created the message", async (t) => {
        const { first, second, player } = await connectAll(t);
        const seen = new Map();
        for (const session of [first, second, player]) {
            session.Hooks.on("createChatMessage", (message, options, userId) => {
                seen.set(session, helpers(session).createdHere(message, options, userId));
            });
        }
        const message = await second.run(() => ChatMessage.create({ content: "<p>Hello</p>" }));
        assert.equal(seen.get(first), false);
        assert.equal(seen.get(second), true);
        assert.equal(seen.get(player), false);

        // Without the creation options (a client that doesn't receive them), the message's own mark decides
        const userId = message.author.id;
        assert.equal(helpers(first).createdHere(message, {}, userId), false);
        assert.equal(helpers(second).createdHere(message, {}, userId), true);
    });
});

/** A promise's state without waiting for it: "pending", or what it resolved to */
async function peek(promise) {
    const pending = Symbol("pending");
    const result = await Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve(pending)))]);
    return result === pending ? "pending" : result;
}

/** A creature with an effect, whose deletions are counted: what a counteractRemove request reaches */
function counteractTarget() {
    const actor = makeActor(world, { name: "Goblin" });
    const effect = addItem(world, actor, { name: "Effect: Bless", type: "effect" });
    const deletions = [];
    actor.deleteEmbeddedDocuments = async (_type, ids) => {
        deletions.push(...ids);
        ids.forEach((id) => actor.items.delete(id));
    };
    return { effect, deletions };
}

/** A player asks the GM to remove an effect (counteract.js's request), as a player's client does */
const requestRemoval = (player, effect) =>
    player.run(() => game.socket.emit(SOCKET, { action: "counteractRemove", uuids: [effect.uuid] }));

describe("confirming who does the work (scripts/lib/session.js)", () => {
    it("a GM's only session doesn't drop work given in its first seconds: it waits, then does it", async (t) => {
        const tick = useFakeTimers(t);
        world = createWorld({ users: USERS });
        const gm = await world.connect("gm", { scripts: ["counteract.js"] });
        const player = await world.connect("player");
        const confirmed = helpers(gm).confirmActiveGM();
        const { effect, deletions } = counteractTarget();
        requestRemoval(player, effect);
        await world.flush();
        assert.equal(await peek(confirmed), "pending");
        assert.deepEqual(deletions, []);

        tick(SETTLE);
        assert.equal(await confirmed, true);
        await world.flush();
        assert.deepEqual(deletions, [effect.id]);
    });

    it("a player's session and a GM's that isn't the active GM's never do the GM's work", async (t) => {
        const { player } = await connectAll(t);
        assert.equal(await helpers(player).confirmActiveGM(), false);
        assert.equal(await helpers(player).confirmPrimarySession(), true);
    });

    it("with both sessions there, the chosen one acts at once and the other is told so by it", async (t) => {
        const { tick, first, second, player } = await connectAll(t, { scripts: ["counteract.js"] });
        tick(HEARTBEAT * 2);
        await world.flush();
        assert.equal(await helpers(first).confirmActiveGM(), true);
        const asked = helpers(second).confirmActiveGM();
        await world.flush();
        // The first session answered: no waiting out the time limit
        assert.equal(await peek(asked), false);

        const { effect, deletions } = counteractTarget();
        requestRemoval(player, effect);
        for (let i = 0; i < 3; i++) await world.flush();
        assert.deepEqual(deletions, [effect.id]);
        tick(CONFIRM);
        await world.flush();
        assert.deepEqual(deletions, [effect.id]);
    });

    it("after the chosen session says goodbye, the other acts at once", async (t) => {
        const { first, second } = await connectAll(t);
        first.disconnect();
        await world.flush();
        assert.equal(await peek(helpers(second).confirmActiveGM()), true);
    });

    it("when the chosen session vanishes without a word, the other takes over its work within seconds", async (t) => {
        const { tick, first, second, player } = await connectAll(t, { scripts: ["counteract.js"] });
        first.disconnect({ silently: true });
        const { effect, deletions } = counteractTarget();
        requestRemoval(player, effect);
        await world.flush();
        assert.deepEqual(deletions, []);

        tick(CONFIRM);
        for (let i = 0; i < 3; i++) await world.flush();
        assert.deepEqual(deletions, [effect.id]);
        // It's the chosen session from now on, without asking again
        assert.equal(helpers(second).isActiveGM(), true);
        assert.equal(await peek(helpers(second).confirmActiveGM()), true);
    });

    it("a chosen session that answers slowly, within the time limit, keeps the work: it's done once", async (t) => {
        const { tick, first, second, player } = await connectAll(t, { scripts: ["counteract.js"] });
        first.latency = 500;
        tick(HEARTBEAT * 2);
        await world.flush();
        const { effect, deletions } = counteractTarget();
        requestRemoval(player, effect);
        const asked = helpers(second).confirmActiveGM();
        for (let elapsed = 0; elapsed < CONFIRM * 2; elapsed += 250) {
            tick(250);
            await world.flush();
        }
        assert.equal(await asked, false);
        assert.deepEqual(deletions, [effect.id]);
        assert.equal(helpers(second).isActiveGM(), false);
    });

    it("a session shown again doesn't forget a peer that is slow to answer", async (t) => {
        const { tick, first, second } = await connectAll(t);
        first.latency = 4_000;
        second.setShown(false);
        second.setShown(true);
        for (let elapsed = 0; elapsed < 10_000; elapsed += 500) {
            tick(500);
            await world.flush();
        }
        assert.equal(helpers(first).isPrimarySession(), true);
        assert.equal(helpers(second).isPrimarySession(), false);
    });

    it("work on a scene goes to a session viewing that scene, and other work to the usual one", async (t) => {
        const { first, second } = await connectAll(t);
        const battlefield = makeScene(world, { name: "Battlefield" });
        const town = makeScene(world, { name: "Town" });
        first.viewScene(town);
        second.viewScene(battlefield);
        await world.flush();

        assert.equal(await helpers(first).confirmActiveGM({ scene: battlefield }), false);
        assert.equal(await helpers(second).confirmActiveGM({ scene: battlefield }), true);
        assert.equal(await helpers(first).confirmActiveGM({ scene: town.id }), true);
        assert.equal(await helpers(first).confirmActiveGM(), true);
        assert.equal(await helpers(second).confirmActiveGM(), false);
        // No session viewing the scene: the usual one
        const cellar = makeScene(world, { name: "Cellar" });
        assert.equal(await helpers(first).confirmActiveGM({ scene: cellar }), true);

        // Changing scenes is announced
        first.viewScene(battlefield);
        await world.flush();
        assert.equal(await helpers(first).confirmActiveGM({ scene: battlefield }), true);
        assert.equal(await helpers(second).confirmActiveGM({ scene: battlefield }), false);
    });

    it("the session viewing the scene vanishes: the other takes over its scene's work", async (t) => {
        const { tick, first, second } = await connectAll(t);
        const battlefield = makeScene(world, { name: "Battlefield" });
        second.viewScene(battlefield);
        await world.flush();
        second.disconnect({ silently: true });
        // Even right after its last word
        const asked = helpers(first).confirmActiveGM({ scene: battlefield });
        await world.flush();
        assert.equal(await peek(asked), "pending");
        tick(CONFIRM);
        assert.equal(await asked, true);
    });
});
