/**
 * A minimal stand-in for Foundry, to load the real scripts in Node and fire real hooks at them. Small on purpose: it
 * fakes what the scripts touch when they load and in the hooks the tests fire, and grows as tests need more.
 *
 * A world holds users and documents; each connection of a user is a session, with its own globals (`game`, `Hooks`,
 * `document`, …) and its own copy of the scripts, as a browser window has. Two sessions of one user are two copies of
 * scripts/lib/session.js that talk over the fake module socket.
 *
 *     const world = createWorld({ users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
 *     const gm = await world.connect("gm", { scripts: ["sustain.js"] });
 *     const message = await gm.run(() => ChatMessage.create(data));
 *     const { isSystemSustain } = gm.scripts["sustain.js"];
 *
 * Code a session runs (its scripts' top level, its hooks, socket handlers, timers and `session.run`) sees that
 * session's globals, through AsyncLocalStorage, so `await` inside a hook keeps them.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

export const MODULE_ID = "evan-character-homebrew";
const SCRIPTS = new URL("../../scripts/", import.meta.url);

// Each session imports its own copy of the scripts: "?session=2" on a script is passed on to the files it imports
register(
    "data:text/javascript," +
        encodeURIComponent(`
            export async function resolve(specifier, context, next) {
                const result = await next(specifier, context);
                const query = context.parentURL?.match(/\\?session=\\d+$/)?.[0];
                if (!query || !specifier.startsWith(".") || !result.url.startsWith("file:")) return result;
                return { ...result, url: result.url.replace(/\\?.*$/, "") + query };
            }
        `),
    pathToFileURL("./"),
);

/* Sessions as globals */

const context = new AsyncLocalStorage();
/** The session whose scripts are loading: a module's evaluation doesn't carry the async context of its import */
let loading = null;
const currentSession = () => context.getStore() ?? loading;

const GLOBALS = [
    "game",
    "Hooks",
    "ui",
    "foundry",
    "Handlebars",
    "CONFIG",
    "canvas",
    "ChatMessage",
    "fromUuid",
    "fromUuidSync",
    "document",
    "window",
    "DOMParser",
];
for (const name of GLOBALS) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
            const session = currentSession();
            if (!session) throw new Error(`${name} was used outside a session: use session.run()`);
            return session.globals[name];
        },
    });
}

/**
 * Timers carry the session that set them, and don't keep Node running (a session's heartbeat would otherwise never
 * end). Call `wrapTimers()` again after `mock.timers.enable()`, which replaces them, as `useFakeTimers` does.
 */
export function wrapTimers() {
    for (const [set, clear] of [
        ["setTimeout", "clearTimeout"],
        ["setInterval", "clearInterval"],
    ]) {
        const underlying = globalThis[set];
        if (underlying.wrapped) continue;
        const wrapper = (fn, delay, ...args) => {
            const session = currentSession();
            const handle = underlying(() => (session ? session.run(() => fn(...args)) : fn(...args)), delay);
            handle?.unref?.();
            session?.timers.add({ handle, clear: globalThis[clear] });
            return handle;
        };
        wrapper.wrapped = true;
        globalThis[set] = wrapper;
    }
}
wrapTimers();

/** Fake timers (`node:test`'s mock.timers) that still carry the session: returns `tick(ms)` */
export function useFakeTimers(t, now = Date.now()) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now });
    wrapTimers();
    return (ms) => t.mock.timers.tick(ms);
}

/* Foundry's pieces */

class FakeHooks {
    #events = new Map();
    #session;
    errors = [];

    constructor(session) {
        this.#session = session;
    }

    on(name, fn, { once = false } = {}) {
        if (!this.#events.has(name)) this.#events.set(name, []);
        this.#events.get(name).push({ fn, once });
        return fn;
    }

    once(name, fn) {
        return this.on(name, fn, { once: true });
    }

    off(name, fn) {
        this.#events.set(
            name,
            (this.#events.get(name) ?? []).filter((h) => h.fn !== fn),
        );
    }

    /** As Foundry's: handlers run in order, an error is logged rather than thrown, and `false` stops `call` */
    #run(name, args, stoppable) {
        for (const handler of [...(this.#events.get(name) ?? [])]) {
            if (handler.once) this.off(name, handler.fn);
            let result;
            try {
                result = this.#session.run(() => handler.fn(...args));
            } catch (error) {
                this.errors.push(error);
                console.error(`Error in the ${name} hook`, error);
            }
            if (stoppable && result === false) return false;
        }
        return true;
    }

    call(name, ...args) {
        return this.#run(name, args, true);
    }

    callAll(name, ...args) {
        return this.#run(name, args, false);
    }
}

/** A world setting is shared by every session; a client setting is each session's own */
class FakeSettings {
    settings = new Map();
    menus = new Map();
    #session;

    constructor(session) {
        this.#session = session;
    }

    #store(key) {
        const config = this.settings.get(key);
        if (!config) throw new Error(`"${key}" is not a registered game setting`);
        return config.scope === "client" ? this.#session.clientSettings : this.#session.world.settings;
    }

    register(namespace, key, config) {
        this.settings.set(`${namespace}.${key}`, { ...config, namespace, key });
    }

    registerMenu(namespace, key, config) {
        this.menus.set(`${namespace}.${key}`, config);
    }

    get(namespace, key) {
        const id = `${namespace}.${key}`;
        const store = this.#store(id);
        return store.has(id) ? structuredClone(store.get(id)) : structuredClone(this.settings.get(id).default);
    }

    async set(namespace, key, value) {
        const id = `${namespace}.${key}`;
        this.#store(id).set(id, structuredClone(value));
        return value;
    }
}

const escapeHtml = (text) =>
    String(text ?? "").replace(
        /[&<>"'`=]/g,
        (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "`": "&#x60;", "=": "&#x3D;" })[c],
    );

function getProperty(object, key) {
    return key.split(".").reduce((value, part) => value?.[part], object);
}

function setProperty(object, key, value) {
    const parts = key.split(".");
    const last = parts.pop();
    let target = object;
    for (const part of parts) target = target[part] ??= {};
    target[last] = value;
}

/** "a.b": 1 → { a: { b: 1 } } */
function expandObject(object) {
    const expanded = {};
    for (const [key, value] of Object.entries(object)) setProperty(expanded, key, value);
    return expanded;
}

function mergeObject(target, source) {
    for (const [key, value] of Object.entries(expandObject(source))) {
        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            target[key] &&
            typeof target[key] === "object"
        )
            mergeObject(target[key], value);
        else target[key] = value;
    }
    return target;
}

const FOUNDRY_UTILS = {
    deepClone: (value) => structuredClone(value),
    duplicate: (value) => structuredClone(value),
    getProperty,
    setProperty,
    expandObject,
    mergeObject,
    randomID: () => Math.random().toString(36).slice(2, 18).padEnd(16, "0"),
};

const randomId = FOUNDRY_UTILS.randomID;

/** English strings the scripts read, from pf2e's lang/en.json (the same in both versions) */
const STRINGS = {
    "PF2E.Actions.Sustain.Title": "Sustain",
    "PF2E.Check.Result.Degree.Check.criticalSuccess": "Critical Success",
    "PF2E.Check.Result.Degree.Check.success": "Success",
    "PF2E.Check.Result.Degree.Check.failure": "Failure",
    "PF2E.Check.Result.Degree.Check.criticalFailure": "Critical Failure",
};

/**
 * A chat message, as pf2e's ChatMessagePF2e reads it (src/module/chat-message/document.ts, the same in v13-dev and
 * v14-dev): `item` from the origin flag (not a compendium's), `actor` from the speaker.
 */
class FakeChatMessage {
    constructor(data = {}, world) {
        Object.defineProperty(this, "world", { value: world });
        const source = structuredClone(data);
        this._id = source._id ?? null;
        this.content = source.content ?? "";
        this.flavor = source.flavor ?? "";
        this.speaker = source.speaker ?? {};
        this.flags = source.flags ?? {};
        this.whisper = source.whisper ?? [];
        this.blind = !!source.blind;
        this.rolls = (data.rolls ?? []).map((roll) => roll);
        this.author = null;
    }

    get id() {
        return this._id;
    }

    get uuid() {
        return `ChatMessage.${this._id}`;
    }

    get isRoll() {
        return this.rolls.length > 0;
    }

    get actor() {
        return this.world.actors.get(this.speaker?.actor) ?? null;
    }

    get item() {
        const flags = this.flags.pf2e ?? {};
        if (flags.context?.type === "self-effect") return this.actor?.items.get(flags.context.item) ?? null;
        const uuid = flags.origin?.uuid;
        return uuid && !uuid.startsWith("Compendium.") ? (this.world.fromUuidSync(uuid) ?? null) : null;
    }

    updateSource(changes) {
        const { flags, ...rest } = expandObject(changes);
        if (flags) mergeObject(this.flags, flags);
        Object.assign(this, rest);
    }

    getFlag(scope, key) {
        return getProperty(this.flags[scope] ?? {}, key);
    }

    async update(changes, options = {}) {
        const session = currentSession();
        this.updateSource(changes);
        this.world.callAll("updateChatMessage", () => [this, changes, structuredClone(options), session.user.id]);
        return this;
    }

    async setFlag(scope, key, value) {
        return this.update({ [`flags.${scope}.${key}`]: value });
    }

    async delete() {
        this.world.messages.delete(this._id);
        this.world.callAll("deleteChatMessage", () => [this, {}, currentSession().user.id]);
        return this;
    }
}

/* The world, and its sessions */

/** Foundry's Collection: a Map with the array methods the scripts use */
class Collection extends Map {
    get contents() {
        return [...this.values()];
    }

    find(fn) {
        return this.contents.find(fn);
    }

    filter(fn) {
        return this.contents.filter(fn);
    }

    some(fn) {
        return this.contents.some(fn);
    }

    map(fn) {
        return this.contents.map(fn);
    }

    getName(name) {
        return this.find((document) => document.name === name);
    }
}

class UserCollection extends Collection {
    /** Foundry's: the connected GM with the lowest ID */
    get activeGM() {
        return this.filter((u) => u.isGM && u.active).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null;
    }
}

class Session {
    static count = 0;
    timers = new Set();
    clientSettings = new Map();
    notifications = [];
    scripts = {};
    visibility = "visible";
    connected = false;

    constructor(world, user) {
        this.world = world;
        this.user = user;
        this.number = ++Session.count;
        this.dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/game" });
        Object.defineProperty(this.dom.window.document, "visibilityState", {
            configurable: true,
            get: () => this.visibility,
        });
        this.socketHandlers = new Map();
        this.globals = this.#makeGlobals();
    }

    #makeGlobals() {
        const world = this.world;
        const session = this;
        const hooks = new FakeHooks(this);
        const notify = (type) => (message) => void session.notifications.push({ type, message });
        const ChatMessage = class extends FakeChatMessage {
            constructor(data) {
                super(data, world);
            }
            static create(data, options) {
                return world.createMessage(session, data, options);
            }
            static get implementation() {
                return ChatMessage;
            }
            static getSpeaker({ actor } = {}) {
                return actor ? { actor: actor.id, alias: actor.name } : { alias: session.user.name };
            }
            static getWhisperRecipients(name) {
                const users = [...world.users.values()];
                return name === "GM" ? users.filter((u) => u.isGM) : users.filter((u) => u.name === name);
            }
        };
        const game = {
            user: this.user,
            users: world.users,
            settings: new FakeSettings(this),
            modules: new Map(
                [[MODULE_ID, { id: MODULE_ID, active: true }], ...Object.entries(world.modules)].map(([id, data]) => [
                    id,
                    { id, ...structuredClone(data) },
                ]),
            ),
            socket: {
                on: (event, fn) => {
                    if (!session.socketHandlers.has(event)) session.socketHandlers.set(event, []);
                    session.socketHandlers.get(event).push(fn);
                },
                emit: (event, data) => world.emit(session, event, data),
            },
            messages: world.messages,
            actors: world.actors,
            i18n: {
                lang: "en",
                localize: (key) => STRINGS[key] ?? key,
                format: (key, data = {}) =>
                    (STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => data[name] ?? match),
                has: (key) => key in STRINGS,
            },
            release: { generation: world.foundryGeneration },
            system: { id: "pf2e", version: world.systemVersion },
            combat: null,
            pf2e: { ConditionManager: { conditions: new Map() }, actions: {} },
            ready: false,
        };
        return {
            game,
            Hooks: hooks,
            ui: { notifications: { info: notify("info"), warn: notify("warn"), error: notify("error") } },
            foundry: {
                utils: FOUNDRY_UTILS,
                applications: { api: { ApplicationV2: class {}, DialogV2: class {} } },
            },
            Handlebars: { escapeExpression: escapeHtml },
            CONFIG: { PF2E: {}, ChatMessage: { documentClass: ChatMessage } },
            canvas: { ready: false, scene: null, tokens: { controlled: [], placeables: [] } },
            ChatMessage,
            fromUuid: async (uuid) => world.fromUuidSync(uuid),
            fromUuidSync: (uuid) => world.fromUuidSync(uuid),
            document: this.dom.window.document,
            window: this.dom.window,
            DOMParser: this.dom.window.DOMParser,
        };
    }

    get game() {
        return this.globals.game;
    }

    get Hooks() {
        return this.globals.Hooks;
    }

    /** Run code as this session: Foundry's globals are this session's */
    run(fn) {
        return context.run(this, fn);
    }

    /** Load scripts (names in scripts/, like "sustain.js"), then run init, setup and ready */
    async load(names) {
        for (const name of names) {
            const url = new URL(`${name}?session=${this.number}`, SCRIPTS);
            loading = this;
            try {
                this.scripts[name] = await this.run(() => import(url.href));
            } finally {
                loading = null;
            }
        }
        this.connected = true;
        for (const hook of ["init", "i18nInit", "setup"]) this.Hooks.callAll(hook);
        this.game.ready = true;
        this.Hooks.callAll("ready");
    }

    /** Show or hide the window, as switching tabs or minimizing does */
    setShown(shown) {
        this.visibility = shown ? "visible" : "hidden";
        this.run(() => this.dom.window.document.dispatchEvent(new this.dom.window.Event("visibilitychange")));
    }

    /** Close the window: pagehide (which says goodbye), then nothing more runs. `silently`: it crashed or slept. */
    disconnect({ silently = false } = {}) {
        if (!silently) {
            this.run(() => this.dom.window.dispatchEvent(new this.dom.window.Event("pagehide")));
        }
        this.connected = false;
        for (const { handle, clear } of this.timers) clear(handle);
        this.timers.clear();
        this.dom.window.close();
    }
}

class World {
    actors = new Collection();
    documents = new Map();
    messages = new Collection();
    settings = new Map();
    sessions = [];
    #pending = 0;

    constructor({ users = [], modules = {}, version = "v14" } = {}) {
        this.version = version;
        this.foundryGeneration = version === "v13" ? 13 : 14;
        this.systemVersion = version === "v13" ? "7.7.0" : "8.0.0";
        this.modules = modules;
        const world = this;
        const list = users.map((data) => ({
            id: data.id,
            name: data.name ?? data.id,
            isGM: !!data.isGM,
            character: null,
            targets: new Set(),
            get active() {
                return world.sessions.some((s) => s.connected && s.user.id === data.id);
            },
        }));
        this.users = new UserCollection(list.map((user) => [user.id, user]));
    }

    /** Connect a user: a new session, with the scripts loaded and init, setup and ready run */
    async connect(userId, { scripts = [], shown = true } = {}) {
        const user = this.users.get(userId);
        if (!user) throw new Error(`No user ${userId}`);
        const session = new Session(this, user);
        session.visibility = shown ? "visible" : "hidden";
        this.sessions.push(session);
        await session.load(["settings.js", ...scripts.filter((s) => s !== "settings.js")]);
        await this.flush();
        return session;
    }

    /** Close every session */
    close() {
        for (const session of this.sessions) if (session.connected) session.disconnect();
    }

    connected() {
        return this.sessions.filter((s) => s.connected);
    }

    /** Add a document (an actor, an item, a token) so fromUuid finds it */
    add(document) {
        this.documents.set(document.uuid, document);
        if (document.documentName === "Actor") this.actors.set(document.id, document);
        return document;
    }

    fromUuidSync(uuid) {
        return this.documents.get(uuid) ?? null;
    }

    /** Run a hook in every connected session, the given one first; `args(session)` gives each its arguments */
    callAll(name, args, first = null) {
        const sessions = this.connected().sort((a, b) => (b === first) - (a === first));
        for (const session of sessions) session.Hooks.callAll(name, ...args(session));
    }

    /**
     * Foundry's ChatMessage.create, from a session: preCreateChatMessage there (which can change the message or
     * cancel it), then createChatMessage in every session, this one first, each with its own copy of the options
     */
    async createMessage(session, data, options = {}) {
        const message = new session.globals.ChatMessage(data);
        options = { ...options };
        const userId = session.user.id;
        if (session.Hooks.call("preCreateChatMessage", message, data, options, userId) === false) return undefined;
        message._id = randomId();
        message.author = session.user;
        this.messages.set(message._id, message);
        this.documents.set(message.uuid, message);
        this.callAll(
            "createChatMessage",
            (s) => [message, s === session ? options : structuredClone(options), userId],
            session,
        );
        return message;
    }

    /** The module socket: what one session emits reaches every other connected session, not itself */
    emit(from, event, data) {
        const payload = structuredClone(data);
        for (const session of this.connected()) {
            if (session === from) continue;
            for (const handler of session.socketHandlers.get(event) ?? []) {
                this.#pending += 1;
                queueMicrotask(() => {
                    this.#pending -= 1;
                    if (session.connected) session.run(() => handler(payload));
                });
            }
        }
    }

    /** Wait until every socket message sent so far, and those its handlers send, has arrived */
    async flush() {
        for (let i = 0; i < 1000 && this.#pending > 0; i++) await Promise.resolve();
        for (let i = 0; i < 5; i++) await Promise.resolve();
    }
}

export function createWorld(options) {
    return new World(options);
}
