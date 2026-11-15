/**
 * Builders for pf2e-shaped documents and chat messages, for the Foundry stand-in in ./foundry.mjs. The shapes are
 * pf2e's, from foundryvtt/pf2e's source on v13-dev (pf2e 7.x) and v14-dev (pf2e 8.x), which agree on everything here;
 * each builder names the file it follows.
 */

import { Collection } from "./foundry.mjs";

let next = 0;
const makeId = (prefix) => `${prefix}${String(++next).padStart(16 - prefix.length, "0")}`;

/** A change made through the server comes back later, not in the same tick */
const serverTrip = () => new Promise((resolve) => setImmediate(resolve));

/** pf2e's compendium IDs, the same in every version */
export const PF2E_IDS = {
    sustain: "3f5DMFu8fPiqHpRg",
    shedSpirit: "uruoG0PuuA0CqEG7",
    stitchingStrike: "PTEiTXsObvtke43x",
    exploitVulnerability: "fodJ3zuwQsYnBbtk",
};
export const pf2eItemUuid = (pack, id) => `Compendium.pf2e.${pack}.Item.${id}`;

/**
 * An actor (src/module/actor/base.ts): `itemTypes` by type, `isOfType`, and no tokens on a scene. Added to the world so
 * messages and fromUuid find it. `isOwner` is true for a GM and the users in `owners` (as the session running sees it),
 * unless a test sets it. `auras` are those of its effects' Aura rules (src/module/rules/rule-element/aura.ts), a rule
 * counting when its predicate's roll options are the ones its effect's ChoiceSet rules chose.
 */
export function makeActor(
    world,
    { id = makeId("actor"), name = "Creature", type = "character", items = [], owners = [] } = {},
) {
    let isOwner = null;
    const actor = {
        documentName: "Actor",
        id,
        _id: id,
        uuid: `Actor.${id}`,
        name,
        type,
        flags: {},
        system: { details: { level: { value: 1 } } },
        items: new Map(),
        get itemTypes() {
            const types = {};
            for (const item of this.items.values()) (types[item.type] ??= []).push(item);
            return new Proxy(types, { get: (target, key) => target[key] ?? [] });
        },
        isOfType(...types) {
            return types.includes(type) || (types.includes("creature") && type !== "hazard" && type !== "loot");
        },
        /** Its tokens on scenes, as the TokenDocuments `getActiveTokens(true, true)` returns */
        getActiveTokens: () =>
            [...world.documents.values()].filter((d) => d.documentName === "Token" && d.actor === actor),
        getSelfRollOptions: (prefix = "self") => [`${prefix}:type:${type}`],
        get level() {
            return this.system.details.level.value;
        },
        /** Its combatant in the encounter being viewed (ActorPF2e#combatant) */
        get combatant() {
            return game.combat?.combatants.find((c) => c.actor?.uuid === this.uuid) ?? null;
        },
        get auras() {
            const auras = new Map();
            for (const item of this.items.values()) {
                const rules = item.system.rules ?? [];
                const chosen = rules
                    .filter((rule) => rule.key === "ChoiceSet" && rule.rollOption && rule.selection)
                    .map((rule) => `${rule.rollOption}:${rule.selection}`);
                for (const rule of rules) {
                    if (rule.key !== "Aura" || !(rule.predicate ?? []).every((option) => chosen.includes(option)))
                        continue;
                    auras.set(rule.slug ?? item.slug, { slug: rule.slug ?? item.slug, radius: rule.radius });
                }
            }
            return auras;
        },
        get isOwner() {
            return isOwner ?? (!!game.user?.isGM || owners.includes(game.user?.id));
        },
        set isOwner(value) {
            isOwner = value;
        },
        /** Foundry's: preCreateItem in the creating session, then the items, then createItem in every session */
        async createEmbeddedDocuments(_type, sources) {
            const session = game;
            const userId = game.user.id;
            const pending = [];
            for (const data of sources) {
                const source = structuredClone(data);
                const options = {};
                const draft = {
                    ...source,
                    slug: source.system?.slug ?? null,
                    _source: source,
                    updateSource: (changes) => foundry.utils.mergeObject(source, changes),
                };
                if (Hooks.call("preCreateItem", draft, source, options, userId) === false) continue;
                // EffectPF2e#_preCreate (src/module/item/effect/document.ts): when it started, and at whose initiative
                if (source.type === "effect") {
                    const originUuid = source.system?.context?.origin?.actor;
                    const origin = !originUuid || originUuid === this.uuid ? this : world.fromUuidSync(originUuid);
                    const initiative = origin?.combatant?.initiative ?? game.combat?.combatant?.initiative ?? null;
                    source.system = { ...source.system, start: { value: game.time.worldTime, initiative } };
                }
                pending.push({ source, options });
            }
            await serverTrip();
            const created = pending.map(({ source, options }) => {
                const item = addItem(world, this, {
                    name: source.name,
                    type: source.type,
                    slug: source.system?.slug ?? null,
                    source: source._stats?.compendiumSource ?? null,
                    system: source.system ?? {},
                    flags: source.flags ?? {},
                });
                world.callAll("createItem", (s) => [
                    item,
                    s.game === session ? options : structuredClone(options),
                    userId,
                ]);
                return item;
            });
            return created;
        },
        /** Foundry's: delete the items, then deleteItem in every session */
        async deleteEmbeddedDocuments(_type, ids) {
            const deleted = ids.map((itemId) => this.items.get(itemId)).filter((item) => item);
            for (const item of deleted) {
                this.items.delete(item.id);
                world.documents.delete(item.uuid);
            }
            const userId = game.user.id;
            for (const item of deleted) world.callAll("deleteItem", () => [item, {}, userId]);
            return deleted;
        },
    };
    world.add(actor);
    for (const item of items) addItem(world, actor, item);
    return actor;
}

/** A scene, with its tokens */
export function makeScene(world, { id = makeId("scene"), name = "Scene" } = {}) {
    return world.add({ documentName: "Scene", id, _id: id, uuid: `Scene.${id}`, name, tokens: [] });
}

/**
 * A token of an actor on a scene (a TokenDocument), with its placeable as `object`: its center and `distanceTo` (pf2e's
 * TokenPF2e#distanceTo, in feet, here 5 feet a square on a grid with no diagonals rule). Its `auras` are its actor's,
 * each with `containsToken` (TokenAura in src/module/scene/token-document/aura/index.ts, here by distance alone). `x`
 * and `y` are in squares, and can be set to move it.
 */
export function addToken(world, scene, actor, { id = makeId("token"), x = 0, y = 0, hidden = false } = {}) {
    const token = {
        documentName: "Token",
        id,
        _id: id,
        uuid: `${scene.uuid}.Token.${id}`,
        name: actor.name,
        parent: scene,
        actor,
        hidden,
        x,
        y,
        get auras() {
            const auras = new Map();
            for (const [slug, data] of actor.auras ?? []) {
                const containsToken = (other) =>
                    !token.hidden &&
                    !other.hidden &&
                    (other === token || token.object.distanceTo(other.object) <= data.radius);
                auras.set(slug, { ...data, token, containsToken });
            }
            return auras;
        },
    };
    token.object = {
        document: token,
        get center() {
            return { x: token.x * 100 + 50, y: token.y * 100 + 50 };
        },
        distanceTo: (other) => 5 * Math.max(Math.abs(other.document.x - token.x), Math.abs(other.document.y - token.y)),
    };
    scene.tokens.push(token);
    return world.add(token);
}

/**
 * An item on an actor (src/module/item/base/document.ts): `slug` is `system.slug`, and `sourceId` the compendium
 * item it was copied from (`_stats.compendiumSource`). `update` and `delete` come back from the server a tick later,
 * with updateItem and deleteItem in every session.
 */
export function addItem(
    world,
    actor,
    { id = makeId("item"), name, type, slug = null, source = null, system = {}, flags = {} },
) {
    const item = {
        documentName: "Item",
        id,
        _id: id,
        uuid: `${actor.uuid}.Item.${id}`,
        name,
        type,
        actor,
        parent: actor,
        flags: structuredClone(flags),
        _stats: { compendiumSource: source, duplicateSource: null },
        system: { slug, ...structuredClone(system) },
        get _source() {
            return { name: this.name, type, system: this.system, flags: this.flags };
        },
        get slug() {
            return this.system.slug;
        },
        toObject() {
            return structuredClone({ _id: id, name: this.name, type, system: this.system, flags: this.flags });
        },
        async update(changes) {
            const userId = game.user.id;
            await serverTrip();
            foundry.utils.mergeObject(this, changes);
            world.callAll("updateItem", () => [this, foundry.utils.expandObject(changes), {}, userId]);
            return this;
        },
        async delete() {
            const userId = game.user.id;
            await serverTrip();
            if (!actor.items.delete(id)) return this;
            world.documents.delete(this.uuid);
            world.callAll("deleteItem", () => [this, {}, userId]);
            return this;
        },
        get sourceId() {
            return this._stats.duplicateSource ?? this._stats.compendiumSource;
        },
        isOfType(...types) {
            return types.includes(type);
        },
        getRollOptions: (prefix = "item") => [`${prefix}:type:${type}`, ...(slug ? [`${prefix}:slug:${slug}`] : [])],
    };
    if (type === "effect") {
        // Each can be set by a test
        const derived = {
            level: () => item.system.level?.value ?? 1,
            origin: () => {
                const uuid = item.system.context?.origin?.actor;
                return !uuid || uuid === actor.uuid ? actor : world.fromUuidSync(uuid);
            },
            remainingDuration: () => remainingDuration(item),
            isExpired: () => item.remainingDuration.expired,
        };
        for (const [key, get] of Object.entries(derived)) {
            const set = (value) => Object.defineProperty(item, key, { value, writable: true, configurable: true });
            Object.defineProperty(item, key, { get, set, configurable: true, enumerable: true });
        }
    }
    actor.items.set(id, item);
    world.add(item);
    return item;
}

const DURATION_UNITS = { rounds: 6, minutes: 60, hours: 3600, days: 86400 };

/**
 * Whether an effect has expired, and the seconds it has left: calculateRemainingDuration in
 * src/module/item/abstract-effect/helpers.ts, the same on v13-dev and v14-dev. An effect with no `start` (one that
 * wasn't created on its actor) never expires. Once its time is up, in an encounter, it expires at the start of its
 * origin's turn, or once the turn is at a lower initiative than the one it started at.
 */
function remainingDuration(effect) {
    const duration = effect.system.duration ?? { value: -1, unit: "unlimited", expiry: null };
    const start = effect.system.start;
    if (duration.unit === "encounter") {
        const expired = !!effect.system.expired;
        return { expired, remaining: expired ? 0 : Infinity };
    }
    if (duration.unit === "unlimited" || !start) return { expired: false, remaining: Infinity };

    const combatant = game.combat?.combatant ?? null;
    const expiry = duration.expiry || "turn-start";
    const seconds = duration.value * (DURATION_UNITS[duration.unit] ?? 0);
    // Outside encounters, an effect until the end of the turn or round doesn't expire at once
    const addend =
        !combatant && seconds === 0 && duration.unit === "rounds" && ["turn-end", "round-end"].includes(expiry) ? 1 : 0;
    const remaining = start.value + seconds + addend - game.time.worldTime;
    const result = { remaining, expired: remaining <= 0 };

    if (remaining === 0 && combatant?.actor) {
        const startInitiative = start.initiative ?? 0;
        const currentInitiative = combatant.initiative ?? 0;
        const bearer = effect.actor;
        // A familiar isn't in the encounter: its master stands in for it
        const fightyActor = bearer?.isOfType("familiar") ? (bearer.master ?? bearer) : bearer;
        const atTurnStart = () =>
            startInitiative === currentInitiative && combatant.actor === (effect.origin ?? fightyActor);
        result.expired =
            expiry === "turn-start"
                ? atTurnStart()
                : expiry === "turn-end"
                  ? currentInitiative < startInitiative
                  : expiry === "round-end"
                    ? game.time.worldTime > start.value
                    : false;
    }
    return result;
}

/** ItemPF2e#getOriginData (src/module/item/base/document.ts) */
export function originData(item) {
    return {
        actor: item.actor?.uuid,
        uuid: item.uuid,
        type: item.type,
        rollOptions: [item.actor?.getSelfRollOptions("origin"), item.getRollOptions("origin:item")].flat(),
    };
}

/**
 * The card ItemPF2e#toMessage posts for an action, feat or spell (src/module/item/base/document.ts): the actor as
 * speaker, the item's card as content, and the item as origin. No rolls.
 */
export function itemCard(item) {
    return {
        speaker: { actor: item.actor.id, alias: item.actor.name },
        content: `<div class="pf2e chat-card item-card"><header class="card-header"><h3>${item.name}</h3></header></div>`,
        flags: { pf2e: { origin: originData(item) } },
    };
}

/**
 * The card pf2e's actions post from the actions list (BaseActionVariant#toMessage in src/module/actor/actions/base.ts,
 * with static/templates/actors/actions/base/chat-message-content.hbs): no item and no origin, only the title in
 * `h4.action strong`.
 */
export function actionCard({ title, glyph = "1", traits = [], description = "" }) {
    const tags = traits.map((t) => `<span class="tag" data-slug="${t}">${t}</span>`).join("");
    return {
        content:
            `<h4 class="action"><strong>${title}</strong><span class="pf2-icon larger">${glyph}</span></h4><hr>` +
            `<div class="tags" data-tooltip-class="pf2e">${tags}</div>${description}`,
    };
}

/** A d20 roll as a check message carries it: a total, and the d20 among its dice */
export function d20Roll(die, modifier = 0) {
    return {
        total: die + modifier,
        formula: `1d20 + ${modifier}`,
        dice: [{ faces: 20, total: die, results: [{ result: die, active: true }] }],
        options: {},
    };
}

/**
 * A check's message (Check.roll in src/module/system/check/check.ts): flags.pf2e.context (type, domains, options,
 * outcome, dc, origin and target), modifierName (the statistic's slug), and the item as origin when it was rolled
 * from one.
 */
export function checkMessage({
    actor,
    item = null,
    type = "skill-check",
    statistic,
    domains = [],
    options = [],
    die = 10,
    modifier = 0,
    dc = null,
    outcome = null,
    target = null,
}) {
    return {
        speaker: { actor: actor.id, alias: actor.name },
        flavor: `<h4 class="action"><strong>${statistic}</strong></h4>`,
        rolls: [d20Roll(die, modifier)],
        flags: {
            pf2e: {
                context: {
                    type,
                    identifier: null,
                    actor: actor.id,
                    token: null,
                    domains,
                    options: [...options].sort(),
                    origin: null,
                    target: target ? { actor: target.uuid, token: null } : null,
                    dc: dc ? { value: dc } : null,
                    outcome,
                    unadjustedOutcome: outcome,
                    rollMode: "publicroll",
                    traits: [],
                    notes: [],
                    isReroll: false,
                },
                modifierName: statistic,
                modifiers: [],
                origin: item ? originData(item) : null,
            },
        },
    };
}

/**
 * An effect (src/module/item/effect/data.ts and src/module/item/abstract-effect/data.ts): its duration (with
 * `sustained`), its level, its rules and its context, where it came from. `origin` is the actor it came from, its own
 * when it has none (AbstractEffectPF2e#origin in src/module/item/abstract-effect/document.ts). Put on its actor without
 * being created there, it has no start, so it never expires; one made with `createEmbeddedDocuments` starts at the
 * world's time and expires as pf2e's do (`remainingDuration`, `isExpired`). Expired effects stay on their actor, as
 * with pf2e's "remove expired effects" off.
 */
export function addEffect(
    world,
    actor,
    {
        name = "Spell Effect",
        slug = null,
        source = null,
        duration = { value: 1, unit: "minutes", expiry: "turn-start", sustained: false },
        origin = null,
        level = 1,
        rules = [],
        flags = {},
    } = {},
) {
    const effect = addItem(world, actor, {
        name,
        type: "effect",
        slug,
        source,
        flags,
        system: {
            level: { value: level },
            rules,
            duration,
            context: origin
                ? {
                      origin: {
                          actor: origin.actor?.uuid ?? null,
                          token: null,
                          item: origin.item?.uuid ?? null,
                          spellcasting: null,
                          rollOptions: [],
                      },
                      target: { actor: actor.uuid, token: null },
                      roll: null,
                  }
                : null,
        },
    });
    return effect;
}

/**
 * An encounter: Foundry's Combat with pf2e's turn records. The turns are the combatants by initiative; `previous` and
 * `current` are the round, turn and combatant before and after the last change of turn, as Foundry keeps them
 * (CombatHistoryData in types/foundry/client/documents/combat.d.mts). Start it, then move through it as the tracker's
 * buttons do: each is an update of the round and turn that comes back from the server a tick later, with updateCombat
 * in every session. The world's time moves by 6 seconds with each round, and not with a turn (`CONFIG.time`).
 *
 * A change to the combatants (one removed, or its initiative set) sets the turns up again at the same index, then
 * commits the index that keeps the current combatant's turn (Combat#_manageTurnEvents's `adjustedTurn`; pf2e's
 * EncounterPF2e#setMultipleInitiatives in src/module/encounter/document.ts does the same): between the two, the
 * combatant at the old index is the current one, and that's what `previous` then holds.
 *
 * After an update whose round or turn index is higher than before, pf2e ends the previous combatant's turn and starts
 * the current one's, each unless its record is already that round's, and records the round on the combatant
 * (`flags.pf2e.roundOfLastTurnEnd` and `roundOfLastTurn`, CombatantPF2e in src/module/encounter/combatant.ts). The
 * conditions are EncounterPF2e#_onUpdate's on v13-dev, for both versions: on v14-dev Foundry calls #_onEndTurn and
 * #_onStartTurn, on conditions of its own that aren't modelled. The records are written after updateCombat has run, as
 * the real ones are.
 *
 * `combatants`: `{ actor, token, initiative }`, the token on the encounter's scene (`initiative: null`: none rolled, so
 * it acts last; no actor: a combatant whose creature is gone). It becomes every connected
 * session's `game.combat`.
 */
export function makeCombat(world, { id = makeId("combat"), scene = null, combatants = [] } = {}) {
    const state = () => {
        const combatant = combat.combatant;
        return {
            round: combat.round,
            turn: combat.turn,
            combatantId: combatant?.id ?? null,
            tokenId: combatant?.tokenId ?? null,
        };
    };

    /** pf2e's turn events, once the update is in */
    async function turnEvents(changed) {
        if (!combat.started) return;
        const { previous } = combat;
        const isNextRound =
            typeof changed.round === "number" && (previous.round === null || changed.round > previous.round);
        const isNextTurn = typeof changed.turn === "number" && (previous.turn === null || changed.turn > previous.turn);
        if (!(isNextRound || isNextTurn)) return;
        const before = combat.combatants.get(previous.combatantId ?? "");
        if (before?.actor && typeof previous.round === "number" && previous.round > 0) {
            if (before.flags.pf2e.roundOfLastTurnEnd !== previous.round) {
                await serverTrip();
                before.flags.pf2e.roundOfLastTurnEnd = previous.round;
            }
        }
        const now = combat.combatant;
        if (now?.actor && now.roundOfLastTurn !== combat.round) {
            const round = combat.round;
            await serverTrip();
            now.flags.pf2e.roundOfLastTurn = round;
        }
    }

    async function update(changes) {
        const userId = game.user.id;
        const changed = Object.fromEntries(Object.entries(changes).filter(([key, value]) => combat[key] !== value));
        if (Object.keys(changed).length === 0) return combat;
        await serverTrip();
        const prior = { ...combat.current };
        // The world's time moves with the encounter, back as well as on (Combat#getTimeDelta, by CONFIG.time)
        world.time +=
            ((changed.round ?? combat.round) - combat.round) * CONFIG.time.roundTime +
            ((changed.turn ?? combat.turn ?? 0) - (combat.turn ?? 0)) * CONFIG.time.turnTime;
        Object.assign(combat, changed);
        combat.current = state();
        if (["round", "turn", "combatantId"].some((key) => prior[key] !== combat.current[key])) combat.previous = prior;
        world.callAll("updateCombat", () => [combat, structuredClone(changed), {}, userId]);
        await turnEvents(changed);
        return combat;
    }

    /**
     * The turns were set up again: `current` is the combatant now at the turn's index (the last one, past the end),
     * then the index that keeps `kept`'s turn is committed
     */
    async function keepTurn(kept) {
        if (combat.turn === null) return;
        const turns = combat.turns;
        const turn = Math.min(combat.turn, Math.max(turns.length - 1, 0));
        const at = turns[turn] ?? null;
        combat.current = { round: combat.round, turn, combatantId: at?.id ?? null, tokenId: at?.tokenId ?? null };
        const index = turns.indexOf(kept);
        if (index >= 0) await update({ turn: index });
    }

    const combat = {
        documentName: "Combat",
        id,
        _id: id,
        uuid: `Combat.${id}`,
        scene,
        round: 0,
        turn: null,
        flags: {},
        combatants: new Collection(),
        get started() {
            return this.round > 0;
        },
        get turns() {
            // Combat#_sortCombatants: by initiative, a combatant with none rolled after the others
            const initiative = (c) => (typeof c.initiative === "number" ? c.initiative : -Infinity);
            return this.combatants.contents.sort(
                (a, b) =>
                    (initiative(b) === initiative(a) ? 0 : initiative(b) - initiative(a)) || (a.id < b.id ? -1 : 1),
            );
        },
        get combatant() {
            return this.turn === null ? null : (this.turns[this.turn] ?? null);
        },
        startCombat: () => update({ round: 1, turn: 0 }),
        nextRound: () => update({ round: combat.round + 1, turn: 0 }),
        nextTurn: () =>
            combat.turn + 1 >= combat.turns.length ? combat.nextRound() : update({ turn: combat.turn + 1 }),
        previousRound: () =>
            update({ round: Math.max(combat.round - 1, 0), turn: Math.max(combat.turns.length - 1, 0) }),
        previousTurn: () => (combat.turn <= 0 ? combat.previousRound() : update({ turn: combat.turn - 1 })),
        /** Remove a combatant: deleteCombatant in every session, then the current combatant keeps its turn */
        async removeCombatant(combatant) {
            const userId = game.user.id;
            const current = combat.combatant;
            await serverTrip();
            combat.combatants.delete(combatant.id);
            world.callAll("deleteCombatant", () => [combatant, {}, userId]);
            await keepTurn(current);
        },
        /** pf2e's setInitiative, as the tracker does when a combatant is dragged to a new place in the order */
        async setInitiative(combatant, value) {
            const userId = game.user.id;
            const current = combat.combatant;
            await serverTrip();
            combatant.initiative = value;
            world.callAll("updateCombatant", () => [combatant, { initiative: value }, {}, userId]);
            await keepTurn(current);
        },
        /** End the encounter: deleteCombat in every session */
        async delete() {
            const userId = game.user.id;
            await serverTrip();
            for (const session of world.sessions) session.game.combat = null;
            world.callAll("deleteCombat", () => [combat, {}, userId]);
        },
    };

    for (const { actor = null, token = null, initiative = 0 } of combatants) {
        const combatantId = makeId("combatant");
        combat.combatants.set(combatantId, {
            documentName: "Combatant",
            id: combatantId,
            _id: combatantId,
            uuid: `${combat.uuid}.Combatant.${combatantId}`,
            parent: combat,
            actorId: actor?.id ?? null,
            tokenId: token?.id ?? null,
            sceneId: token?.parent.id ?? null,
            initiative,
            defeated: false,
            flags: { pf2e: { roundOfLastTurn: null } },
            token,
            get actor() {
                return this.token?.actor ?? actor;
            },
            get roundOfLastTurn() {
                return this.flags.pf2e.roundOfLastTurn;
            },
            async update(changes) {
                const userId = game.user.id;
                await serverTrip();
                if (!combat.combatants.has(combatantId)) throw new Error(`Combatant ${combatantId} does not exist`);
                foundry.utils.mergeObject(this, changes);
                world.callAll("updateCombatant", () => [this, foundry.utils.expandObject(changes), {}, userId]);
                return this;
            },
        });
    }
    combat.current = state();
    combat.previous = combat.current;
    for (const session of world.sessions) session.game.combat = combat;
    return world.add(combat);
}
