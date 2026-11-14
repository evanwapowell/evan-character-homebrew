/**
 * A user can be connected more than once (a second window, a popped-out window or another device), and each of their
 * sessions runs the module's hooks, so without care, work is done once per session: two chat cards, two effects, two
 * prompts.
 *
 * What a user creates: `createChatMessage` and `createItem` run in every session with the creating user's ID. The
 * session that creates a message or item marks it (in `preCreate`, which runs only there), and `createdHere` checks the
 * mark, in place of `userId === game.user.id`.
 *
 * Work given to a user rather than started in a session (requests the active GM handles, turn-start effects and
 * reminders, a prompt for whoever answers for a creature): one of the user's sessions does it. A user's sessions tell
 * each other over the module socket that they're open and whether they're shown; the one chosen is a shown one if there
 * is one (a hidden or sleeping window may not run at all), then the one open longest. `isActiveGM` replaces
 * `game.user === game.users.activeGM`, and `isPrimarySession` says whether this is the user's chosen session.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const ACTION = "session";
/** How often a session says it's still there; a background window's timers can run as rarely as once a minute */
const HEARTBEAT = 20_000;
/** A session not heard from in this long is gone */
const EXPIRY = 150_000;
/** How long a new session waits to hear from the others before it may do the work */
const SETTLE = 2_000;
/** How long a session that's shown again waits for the others to answer before it forgets those that didn't */
const PROBE = 3_000;

const self = { id: Math.random().toString(36).slice(2), started: Date.now() };
/** The same user's other sessions, by ID: when they opened, whether they're shown, and when they were last heard */
const peers = new Map();
let settled = false;

/** The creation option that names the session that created a message or item */
const OPTION = `${MODULE_ID}.session`;

/**
 * Whether this session created the message or item: in a `createChatMessage` or `createItem` hook, use it in place of
 * `userId === game.user.id`. A creation without the mark (made before this module loaded) counts for every session of
 * the user who made it.
 */
function createdHere(document, options, userId) {
    if (userId !== game.user?.id) return false;
    const session = options?.[OPTION] ?? document?.flags?.[MODULE_ID]?.session;
    return !session || session === self.id;
}

/**
 * Whether this module put data of its own on a chat message: a card it posted, or a message it marked. Every message
 * carries the session mark, so it doesn't count: test this, or a named key, never `message.flags[MODULE_ID]` itself.
 */
function hasModuleData(message) {
    return Object.keys(message?.flags?.[MODULE_ID] ?? {}).some((key) => key !== "session");
}

Hooks.on("preCreateChatMessage", (message, _data, options) => {
    options[OPTION] = self.id;
    message.updateSource({ [`flags.${MODULE_ID}.session`]: self.id });
});
Hooks.on("preCreateItem", (_item, _data, options) => {
    options[OPTION] = self.id;
});

const isShown = () => globalThis.document?.visibilityState !== "hidden";

function announce(kind) {
    if (!game.user) return;
    const { id, started } = self;
    game.socket.emit(SOCKET, { action: ACTION, kind, userId: game.user.id, id, started, shown: isShown() });
}

/**
 * Whether this session is the one of this user's sessions that acts for them, for work given to a user rather than
 * started in a session (a prompt for whoever answers for a creature)
 */
function isPrimarySession() {
    if (!settled && peers.size === 0) return false;
    const now = Date.now();
    for (const [id, peer] of peers) if (now - peer.seen > EXPIRY) peers.delete(id);
    const sessions = [{ ...self, shown: isShown() }, ...[...peers].map(([id, peer]) => ({ id, ...peer }))];
    sessions.sort((a, b) => b.shown - a.shown || a.started - b.started || (a.id < b.id ? -1 : 1));
    return sessions[0].id === self.id;
}

/**
 * Whether this session does the active GM's work: this user is the active GM, and of their sessions, this is the one
 * chosen. Use it in place of `game.user === game.users.activeGM`.
 */
function isActiveGM() {
    if (!game.user || game.user !== game.users.activeGM) return false;
    return isPrimarySession();
}

/** Ask the other sessions to answer, and forget those that don't (closed without saying so, or asleep) */
function probe() {
    const sent = Date.now();
    announce("hello");
    setTimeout(() => {
        for (const [id, peer] of peers) if (peer.seen < sent) peers.delete(id);
    }, PROBE);
}

Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
        if (data?.action !== ACTION || data.userId !== game.user.id || data.id === self.id) return;
        if (data.kind === "bye") return void peers.delete(data.id);
        peers.set(data.id, { started: data.started, shown: !!data.shown, seen: Date.now() });
        if (data.kind === "hello") announce("here");
    });
    probe();
    setTimeout(() => (settled = true), SETTLE);
    setInterval(() => announce("beat"), HEARTBEAT);
    document.addEventListener("visibilitychange", () => (isShown() ? probe() : announce("beat")));
    window.addEventListener("pagehide", () => announce("bye"));
});

export { createdHere, hasModuleData, isActiveGM, isPrimarySession };
