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
 * each other over the module socket that they're open, whether they're shown and which scene they're viewing; the one
 * chosen is, for work on a scene, one viewing that scene, then a shown one (a hidden or sleeping window may not run at
 * all), then the one open longest.
 *
 * The work arrives in every session of the user (a hook, or a request on the module socket), and each asks
 * `confirmActiveGM` or `confirmPrimarySession`, which wait until the session has heard from the others. The chosen
 * session acts at once. Any other session asks the chosen one whether it's still there, and takes over when it doesn't
 * answer within `CONFIRM` (it closed without saying so, crashed, or sleeps), so the work isn't lost while the others
 * wait for it to expire.
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
/** How long a session given work waits for the chosen session to answer before it takes over */
const CONFIRM = 2_000;

const self = { id: Math.random().toString(36).slice(2), started: Date.now() };
/**
 * The same user's other sessions, by ID: when they opened, whether they're shown, their scene, and when they were last
 * heard (`seen`, the time, and `heard`, the count of messages by then)
 */
const peers = new Map();
/** Checks waiting for a session to answer, run on every message from one */
const listeners = new Set();
let settled = false;
let settle;
const settling = new Promise((resolve) => (settle = resolve));
/** Messages heard from the others so far: what's heard after a question is an answer to it */
let heard = 0;
/** When this session last asked the others to answer: the time, and the messages heard by then */
let pinged = { time: -Infinity, heard: 0 };

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

/** The scene this session's canvas shows, if any */
function viewedScene() {
    const canvas = globalThis.canvas;
    return (canvas?.ready && canvas.scene?.id) || null;
}

const sceneId = (scene) => (typeof scene === "string" ? scene : (scene?.id ?? null));

function announce(kind) {
    if (!game.user) return;
    const { id, started } = self;
    const data = { action: ACTION, kind, userId: game.user.id, id, started, shown: isShown(), scene: viewedScene() };
    game.socket.emit(SOCKET, data);
}

/** The user's sessions in the order they're chosen: for work on `scene`, those viewing it first */
function ranked(scene) {
    const now = Date.now();
    for (const [id, peer] of peers) if (now - peer.seen > EXPIRY) peers.delete(id);
    const sessions = [
        { ...self, shown: isShown(), scene: viewedScene() },
        ...[...peers].map(([id, peer]) => ({ ...peer, id })),
    ];
    const onScene = (session) => !!scene && session.scene === scene;
    return sessions.sort(
        (a, b) =>
            onScene(b) - onScene(a) ||
            b.shown - a.shown ||
            a.started - b.started ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** The sessions chosen ahead of this one */
function ahead(scene) {
    const sessions = ranked(scene);
    return sessions.slice(
        0,
        sessions.findIndex((session) => session.id === self.id),
    );
}

/**
 * Whether this session is the one of this user's sessions that acts for them, as far as it knows now. For work, use
 * `confirmPrimarySession`, which waits for a new session to hear from the others and checks the chosen one is there.
 * `scene`: the work needs a session viewing that scene (a Scene or its ID), when one is open.
 */
function isPrimarySession({ scene } = {}) {
    if (!settled && peers.size === 0) return false;
    return ahead(sceneId(scene)).length === 0;
}

/**
 * Whether this session does the active GM's work, as far as it knows now: this user is the active GM, and of their
 * sessions, this is the one chosen. For work, use `confirmActiveGM`.
 */
function isActiveGM(options) {
    if (!game.user || game.user !== game.users.activeGM) return false;
    return isPrimarySession(options);
}

/** Ask the user's other sessions to answer, unless this session just did: answers to that question count */
function ping() {
    const now = Date.now();
    if (now - pinged.time >= CONFIRM) {
        pinged = { time: now, heard };
        announce("hello");
    }
    return pinged;
}

/**
 * Whether this session does the work given to its user: once it has heard from the others, it acts if it's the chosen
 * one. Otherwise it asks the chosen session whether it's there, and if it doesn't answer in time, forgets it and those
 * ahead of this one that didn't answer either, and acts if it's chosen now. Call it in every session the work reaches,
 * once the work is known to be this feature's (it can wait seconds).
 */
async function confirmPrimarySession({ scene } = {}) {
    await settling;
    const id = sceneId(scene);
    const first = ahead(id)[0];
    if (!first) return true;

    const sent = ping();
    const answered = await new Promise((resolve) => {
        const check = () => {
            const top = ahead(id)[0];
            if (!top || top.heard > sent.heard) done(true);
        };
        const done = (result) => {
            listeners.delete(check);
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => done(false), Math.max(0, sent.time + CONFIRM - Date.now()));
        listeners.add(check);
        check();
    });
    if (!answered) {
        for (const session of ahead(id)) if (session.heard <= sent.heard) peers.delete(session.id);
    }
    return ahead(id).length === 0;
}

/**
 * Whether this session does the active GM's work: this user is the active GM, and `confirmPrimarySession` says this is
 * the session that acts. Use it in place of `game.user === game.users.activeGM`, after checking that the hook or socket
 * request is this feature's. `scene`: the work needs a session viewing that scene (turn-start auras).
 */
async function confirmActiveGM(options) {
    if (!game.user || game.user !== game.users.activeGM) return false;
    const confirmed = await confirmPrimarySession(options);
    return confirmed && game.user === game.users.activeGM;
}

Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
        if (data?.action !== ACTION || data.userId !== game.user.id || data.id === self.id) return;
        if (data.kind === "bye") peers.delete(data.id);
        else {
            const scene = typeof data.scene === "string" ? data.scene : null;
            const { started, shown } = data;
            peers.set(data.id, { started, shown: !!shown, scene, seen: Date.now(), heard: ++heard });
            if (data.kind === "hello") announce("here");
        }
        for (const check of [...listeners]) check();
    });
    announce("hello");
    setTimeout(() => {
        settled = true;
        settle();
    }, SETTLE);
    setInterval(() => announce("beat"), HEARTBEAT);
    document.addEventListener("visibilitychange", () => announce(isShown() ? "hello" : "beat"));
    window.addEventListener("pagehide", () => announce("bye"));
    Hooks.on("canvasReady", () => announce("beat"));
});

export { confirmActiveGM, confirmPrimarySession, createdHere, hasModuleData, isActiveGM, isPrimarySession };
