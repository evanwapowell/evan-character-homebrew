/**
 * Builders for pf2e-shaped documents and chat messages, for the Foundry stand-in in ./foundry.mjs. The shapes are
 * pf2e's, from foundryvtt/pf2e's source on v13-dev (pf2e 7.x) and v14-dev (pf2e 8.x), which agree on everything here;
 * each builder names the file it follows.
 */

let next = 0;
const makeId = (prefix) => `${prefix}${String(++next).padStart(16 - prefix.length, "0")}`;

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
 * messages and fromUuid find it.
 */
export function makeActor(world, { id = makeId("actor"), name = "Creature", type = "character", items = [] } = {}) {
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
        getActiveTokens: () => [],
        getSelfRollOptions: (prefix = "self") => [`${prefix}:type:${type}`],
    };
    world.add(actor);
    for (const item of items) addItem(world, actor, item);
    return actor;
}

/**
 * An item on an actor (src/module/item/base/document.ts): `slug` is `system.slug`, and `sourceId` the compendium
 * item it was copied from (`_stats.compendiumSource`).
 */
export function addItem(world, actor, { id = makeId("item"), name, type, slug = null, source = null, system = {} }) {
    const item = {
        documentName: "Item",
        id,
        _id: id,
        uuid: `${actor.uuid}.Item.${id}`,
        name,
        type,
        actor,
        parent: actor,
        flags: {},
        _stats: { compendiumSource: source, duplicateSource: null },
        system: { slug, ...system },
        get slug() {
            return this.system.slug;
        },
        get sourceId() {
            return this._stats.duplicateSource ?? this._stats.compendiumSource;
        },
        isOfType(...types) {
            return types.includes(type);
        },
        getRollOptions: (prefix = "item") => [`${prefix}:type:${type}`, ...(slug ? [`${prefix}:slug:${slug}`] : [])],
    };
    actor.items.set(id, item);
    world.add(item);
    return item;
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
 * `sustained`) and its context, where it came from.
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
    } = {},
) {
    return addItem(world, actor, {
        name,
        type: "effect",
        slug,
        source,
        system: {
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
}
