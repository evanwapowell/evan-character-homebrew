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
 *
 * The GM's session does what a player can't, so it doesn't take a request's data on trust: a request from a player
 * (Foundry gives the socket's listeners the sender's user ID) goes through the action's `check` first, which reads
 * again from the documents what it can (the save's outcome from its message, the range from the tokens), checks the
 * player owns the creature acting, and refuses (`refuse`) a request that doesn't match its feature. A GM's requests
 * aren't checked: a GM can do all of it.
 */

import { confirmActiveGM } from "./session.js";

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const ANSWER = "gmAnswer";
/** How long to wait for a GM session to take the request: settling and taking over from a vanished session included */
const ACCEPT = 10_000;
/** How long to wait, once it's taken, for the work to be done */
const FINISH = 60_000;

/** The handlers, by socket action: { handler, check } */
const handlers = new Map();
/** Requests this session is waiting on, by ID */
const pending = new Map();

const log = (error) => console.error(`${MODULE_ID} | GM request`, error);

/** A request the GM's session won't do: it doesn't match its feature, or the player can't ask for it */
class RequestRefused extends Error {}

/** Refuse a request, from an action's `check`: `reason` says why ("they don't own Ezren") */
function refuse(reason) {
    throw new RequestRefused(reason);
}

/** Whether a user owns a creature (or other document): a GM owns everything */
function owns(user, document) {
    if (!user || !document) return false;
    return !!user.isGM || !!document.testUserPermission?.(user, "OWNER");
}

/** Whether a user made a chat message (rolled the check on it): a GM can act for anyone */
function isAuthor(message, user) {
    if (!user || !message) return false;
    return !!user.isGM || message.author?.id === user.id;
}

/**
 * Handle a socket action for the active GM: the session that acts for them runs `handler(data, sender)` and answers
 * the request, with what it returns (keep that small and serializable) or its error. Register at a script's top level.
 *
 * `check(data, sender)`, for a request from a player: resolves to the data the handler gets (read again from the
 * documents where it can), or calls `refuse(reason)`. Every action a player's client asks for has one.
 */
function onGMRequest(action, handler, { check = null } = {}) {
    handlers.set(action, { handler, check });
}

/** Check a request, then do it: the answer to send back */
async function handle(action, data, sender) {
    const { handler, check } = handlers.get(action);
    try {
        if (!sender) refuse("the request's sender is unknown");
        let work = data;
        if (!sender.isGM && check) work = (await check({ ...data, action }, sender)) ?? data;
        const result = await handler({ ...work, action }, sender);
        return { ok: true, result };
    } catch (error) {
        const text = error?.message ?? String(error);
        if (error instanceof RequestRefused) {
            console.warn(
                `${MODULE_ID} | GM request "${action}" from ${sender?.name ?? "an unknown user"} refused: ${text}`,
            );
            return { ok: false, reason: "refused", error: text };
        }
        log(error);
        return { ok: false, reason: "failed", error: text };
    }
}

/** Run the handler here, as the asking session's own work: the answer a GM session would give */
function runHere(action, data) {
    return handle(action, data, game.user);
}

/**
 * Ask the active GM to do `action` with `data`, and wait until a GM session has done it. Resolves to
 * `{ ok: true, result }`, or `{ ok: false, reason }` with `reason` "absent" (no GM is logged in), "unanswered" (no
 * GM session took it, or it didn't finish, in time), "refused" (it doesn't match its feature: `error` says why) or
 * "failed" (the handler threw: `error` is its message).
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
function onAnswer({ gmRequest, state, ok, result, error, refused }) {
    const request = pending.get(gmRequest);
    if (!request) return;
    if (state === "accepted") {
        request.accepted = true;
        request.wait(FINISH);
    } else if (state === "done") {
        request.finish(
            ok ? { ok: true, result: result ?? null } : { ok: false, reason: refused ? "refused" : "failed", error },
        );
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
        refused: `the GM's session wouldn't ${task}${answer?.error ? `: ${answer.error}` : ""}.`,
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

/**
 * A request on the socket: the GM session that acts for the GM checks it and runs it, and answers. `userId` is the
 * sender's, which Foundry's server adds to every socket message (pf2e's own socket reads it the same way).
 */
async function onRequest(data, userId) {
    if (!handlers.has(data.action) || !(await confirmActiveGM())) return;
    const id = typeof data.gmRequest === "string" ? data.gmRequest : null;
    const reply = (answer) => id && game.socket.emit(SOCKET, { action: ANSWER, gmRequest: id, ...answer });
    reply({ state: "accepted" });
    const { gmRequest: _id, action, ...rest } = data;
    const sender = typeof userId === "string" ? (game.users.get(userId) ?? null) : null;
    const answer = await handle(action, rest, sender);
    if (answer.ok) reply({ state: "done", ok: true, result: serializable(answer.result) });
    else reply({ state: "done", ok: false, error: answer.error, refused: answer.reason === "refused" });
}

Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data, userId) => {
        if (typeof data?.action !== "string") return;
        if (data.action === ANSWER) return onAnswer(data);
        if (handlers.has(data.action)) onRequest(data, userId).catch(log);
    });
});

export { askGM, isAuthor, onGMRequest, owns, refuse, warnGM };
