/**
 * scripts/lib/session.js with one user connected twice: two copies of the script, each in its own fake session,
 * talking over the fake module socket, with fake timers for its heartbeat, settling and expiry.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";

const USERS = [
    { id: "gm", name: "Gamemaster", isGM: true },
    { id: "player", name: "Player" },
];
/** session.js's timings */
const SETTLE = 2_000;
const HEARTBEAT = 20_000;
const EXPIRY = 150_000;

let world;
afterEach(() => world?.close());

/** The session helpers as a session sees them */
const helpers = (session) => {
    const api = session.scripts["settings.js"];
    return {
        isPrimarySession: () => session.run(() => api.isPrimarySession()),
        isActiveGM: () => session.run(() => api.isActiveGM()),
        createdHere: (...args) => session.run(() => api.createdHere(...args)),
    };
};

/** The GM in two windows, the first opened a second before the other, and a player; all settled */
async function connectAll(t) {
    const tick = useFakeTimers(t);
    world = createWorld({ users: USERS });
    const first = await world.connect("gm");
    tick(1_000);
    const second = await world.connect("gm");
    const player = await world.connect("player");
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
