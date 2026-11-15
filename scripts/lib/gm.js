/**
 * Work only a GM can do: a player's client can't edit creatures, cards or effects the player doesn't own, so it asks
 * the active GM over the module socket, and the GM session chosen to act for the GM (`confirmActiveGM`) does it.
 *
 * A request carries an ID. The GM session that takes it answers at once that it has (`accepted`), and again once the
 * work is done (`done`, with whether it worked and what the handler returned). The asking session waits for both, so
 * work is recorded as done only once a GM session has done it: a GM can be connected while none of their sessions
 * acts (a new session settling, one that vanished still being waited for), and a request that nothing answers is
 * reported, not taken for done.
 *
 * The request is the feature's socket message as before (its action and data), with `gmRequest` added, so a GM
 * session on an earlier version still does the work during an update; it doesn't answer, so the asking session warns.
 */

import { confirmActiveGM } from "./session.js";

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const ANSWER = "gmAnswer";
/** How long to wait for a GM session to take the request: settling and taking over from a vanished session included */
const ACCEPT = 10_000;
/** How long to wait, once it's taken, for the work to be done */
const FINISH = 60_000;

/** The handlers, by socket action */
const handlers = new Map();
/** Requests this session is waiting on, by ID */
const pending = new Map();

const log = (error) => console.error(`${MODULE_ID} | GM request`, error);

/**
 * Handle a socket action for the active GM: the session that acts for them runs `handler(data)` and answers the
 * request, with what it returns (keep that small and serializable) or its error. Register at a script's top level.
 */
function onGMRequest(action, handler) {
    handlers.set(action, handler);
}

/** Run the handler here, as the asking session's own work: the answer a GM session would give */
async function runHere(action, data) {
    try {
        const result = await handlers.get(action)({ ...data, action });
        return { ok: true, result };
    } catch (error) {
        log(error);
        return { ok: false, reason: "failed", error: error?.message ?? String(error) };
    }
}

/**
 * Ask the active GM to do `action` with `data`, and wait until a GM session has done it. Resolves to
 * `{ ok: true, result }`, or `{ ok: false, reason }` with `reason` "absent" (no GM is logged in), "unanswered" (no
 * GM session took it, or it didn't finish, in time) or "failed" (the handler threw: `error` is its message).
 *
 * `here`: run the handler in this session instead, as a GM can edit everything (the default for a GM's sessions).
 * `title` and `task`: warn the user when it didn't work, as `warnGM` does.
 */
async function askGM(action, data = {}, { here = !!game.user?.isGM, title = null, task = null } = {}) {
    if (!handlers.has(action)) throw new Error(`No GM handler for "${action}"`);
    let answer;
    if (here) answer = await runHere(action, data);
    else if (!game.users.activeGM) answer = { ok: false, reason: "absent" };
    else answer = await send(action, data);
    if (!answer.ok && title) warnGM(answer, title, task);
    return answer;
}

/** Emit the request, and wait for its answers */
function send(action, data) {
    const id = foundry.utils.randomID();
    return new Promise((resolve) => {
        const request = {
            accepted: false,
            timer: null,
            wait(ms) {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.finish({ ok: false, reason: "unanswered" }), ms);
            },
            finish(answer) {
                clearTimeout(this.timer);
                pending.delete(id);
                resolve(answer);
            },
        };
        pending.set(id, request);
        request.wait(ACCEPT);
        game.socket.emit(SOCKET, { ...data, action, gmRequest: id });
    });
}

/** An answer to one of this session's requests */
function onAnswer({ gmRequest, state, ok, result, error }) {
    const request = pending.get(gmRequest);
    if (!request) return;
    if (state === "accepted") {
        request.accepted = true;
        request.wait(FINISH);
    } else if (state === "done") {
        request.finish(ok ? { ok: true, result: result ?? null } : { ok: false, reason: "failed", error });
    }
}

/** Tell the user why a request didn't work: `task` says what wasn't done ("apply the result") */
function warnGM(answer, title, task) {
    if (answer?.ok) return;
    task ||= "do it";
    const text = {
        absent: `a GM must be logged in to ${task}.`,
        unanswered: `no GM session answered the request to ${task}: try again.`,
        failed: `the GM's session couldn't ${task}${answer?.error ? ` (${answer.error})` : ""}.`,
    }[answer?.reason];
    ui.notifications.warn(`${title}: ${text ?? `couldn't ${task}.`}`);
}

/** What a handler returned, as the socket can send it (handlers that answer nothing may return anything) */
function serializable(result) {
    try {
        return result === undefined ? null : JSON.parse(JSON.stringify(result));
    } catch {
        return null;
    }
}

/** A request on the socket: the GM session that acts for the GM runs it and answers */
async function onRequest(data) {
    const handler = handlers.get(data.action);
    if (!handler || !(await confirmActiveGM())) return;
    const id = typeof data.gmRequest === "string" ? data.gmRequest : null;
    const reply = (answer) => id && game.socket.emit(SOCKET, { action: ANSWER, gmRequest: id, ...answer });
    reply({ state: "accepted" });
    const { gmRequest: _id, ...rest } = data;
    try {
        const result = await handler(rest);
        reply({ state: "done", ok: true, result: serializable(result) });
    } catch (error) {
        log(error);
        reply({ state: "done", ok: false, error: error?.message ?? String(error) });
    }
}

Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
        if (typeof data?.action !== "string") return;
        if (data.action === ANSWER) return onAnswer(data);
        if (handlers.has(data.action)) onRequest(data).catch(log);
    });
});

export { askGM, onGMRequest, warnGM };
