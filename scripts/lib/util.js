/**
 * Small helpers every script uses: escaping text for chat, logging a feature's errors, telling an item by its pf2e ID,
 * a creature's token on a scene, a JB2A file by distance, a spell's DC, an effect's origin, pf2e's damage roll, and a
 * creature's items grouped.
 */

const MODULE_ID = "evan-character-homebrew";

/** Text made safe for HTML (Handlebars' escaping, which pf2e and Foundry use) */
const esc = (text) => Handlebars.escapeExpression(text);

/** A feature's error logger, for `.catch`: `const log = logger("Protector Tree")` */
const logger = (label) => (error) => console.error(`${MODULE_ID} | ${label}`, error);

/**
 * Whether an item is the compendium item with this ID (the same in every pf2e version): from its compendium source
 * (`sourceId`), or, for the compendium's own item, its UUID
 */
function endsWithId(item, id) {
    return [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));
}

/** The actor's token on a scene (the one being viewed unless given) */
function getSceneToken(actor, scene = canvas.scene) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === scene) ?? null;
}

/**
 * The entry for a distance in a table of `[feet, value]` rows, sorted by the longest distance each covers: the first
 * that covers it, or the last (JB2A's files by length)
 */
function byDistance(table, distance) {
    return (table.find(([feet]) => distance <= feet) ?? table.at(-1))[1];
}

/** A spell's DC, with the roll options of the spell itself, from its spellcasting */
function spellDC(spell) {
    if (!spell?.actor) return null;
    const statistic = spell.spellcasting?.statistic;
    return statistic?.withRollOptions?.({ item: spell })?.dc.value ?? statistic?.dc?.value ?? null;
}

/** A document from its UUID, or null for one that's gone or a UUID that isn't one */
function resolveSync(uuid) {
    if (typeof uuid !== "string" || !uuid) return null;
    try {
        return fromUuidSync(uuid);
    } catch {
        return null;
    }
}

const uuidOf = (document) => (typeof document === "string" ? document || null : (document?.uuid ?? null));

/**
 * An effect's `system.context`, as pf2e fills it for an effect with an origin: the creature it's from (`origin`, with
 * its `token` and `item`, as documents or UUIDs), its `target` (`{ actor, token }`) if it has one, and the roll it came
 * from (`{ total, degreeOfSuccess }`, see `effectRoll`). An effect's origin decides when pf2e ends it ("until the start
 * of your next turn").
 */
function effectContext({ origin, token = null, item = null, target = null, roll = null }) {
    return {
        origin: {
            actor: uuidOf(origin),
            token: uuidOf(token),
            item: uuidOf(item),
            spellcasting: null,
            rollOptions: [],
        },
        target: target ? { actor: uuidOf(target.actor), token: uuidOf(target.token) } : null,
        roll,
    };
}

/** pf2e's DamageRoll class */
function damageRollClass() {
    const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
    if (!DamageRoll) throw new Error("pf2e's DamageRoll wasn't found");
    return DamageRoll;
}

/** Items grouped by the creature holding them: a Map of actor → items. Items not on a creature are left out. */
function groupByActor(items) {
    const byActor = new Map();
    for (const item of items) {
        if (!item?.actor) continue;
        if (!byActor.has(item.actor)) byActor.set(item.actor, []);
        byActor.get(item.actor).push(item);
    }
    return byActor;
}

export {
    MODULE_ID,
    byDistance,
    damageRollClass,
    effectContext,
    endsWithId,
    esc,
    getSceneToken,
    groupByActor,
    logger,
    resolveSync,
    spellDC,
};
