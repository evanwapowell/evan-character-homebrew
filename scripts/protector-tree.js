/**
 * Timber Sentinel (wood kineticist) and Protector Tree. Timber Sentinel: "You conjure a tree within 30 feet, as a
 * protector tree spell of a rank equal to half your level rounded up. If you use this impulse again, any previous one
 * ends, and an ordinary tree remains." Protector Tree: "A Medium tree suddenly grows in an unoccupied square within
 * range. The tree has AC 10 and 10 Hit Points. Whenever an ally adjacent to the tree is hit by a Strike, the tree
 * interposes its branches and takes the damage first. Any additional damage beyond what it takes to reduce the tree to
 * 0 Hit Points is dealt to the original target. [...] Heightened (+1) The tree has an additional 10 Hit Points."
 *
 * pf2e only posts the card. Here, using the impulse (or casting the spell, which pf2e 8.5 marks) has its user place
 * the tree: the squares in range are highlighted, a click places it, and a right-click or Escape cancels (the card
 * keeps a Place Tree button). The active GM makes the tree, a hazard with AC 10 and 10 Hit Points per rank, owned by
 * the caster's players, and gives the caster Effect: Protector Tree, which lasts 1 minute. While it does, damage from
 * a Strike that hits an ally of the caster adjacent to the tree is applied to the tree first, from whichever button or
 * module applies it: the tree takes the damage, and the ally only what's left once the tree is at 0 Hit Points, with
 * its types, so the ally's resistances still apply. At 0 Hit Points the tree is destroyed and its token removed. When
 * the effect ends otherwise (its duration, or the impulse used again), the tree stays as an ordinary tree, as the
 * spell says when it's in soil; deleting its token removes it.
 */

import { isSpellCast } from "./lib/casting.js";
import { distanceBetween, spaceOf } from "./lib/geometry.js";
import {
    askGM,
    confirmActiveGM,
    createdHere,
    featureHooks,
    guardApi,
    isEnabled,
    onGMRequest,
    owns,
    refuse,
} from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const FEATURE = "protectorTree";
const hooks = featureHooks(FEATURE);
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** This module's Effect: Protector Tree, on the caster while the tree stands */
const EFFECT_UUID = `${PACK}.yHoBoom9axaemxWS`;
/** IDs of pf2e's Timber Sentinel impulse and Protector Tree spell, the same in every pf2e version */
const IMPULSE_ID = "aHlcMMNQ85VLK7QT";
const IMPULSE_SLUG = "timber-sentinel";
const SPELL_ID = "K9gI08enGtmih5X1";
const SPELL_SLUG = "protector-tree";
const TITLE = "Protector Tree";
const RANGE = 30;
const AC = 10;
const HP_PER_RANK = 10;
/** Foundry's own icon, for the tree's token */
const TREE_IMG = "icons/environment/wilderness/tree-oak.webp";
const FOLDER_NAME = "Protector Trees";
const HITS = ["success", "criticalSuccess"];
/** Degrees of success, by their index */
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | Protector Tree`, error);
const warn = (text) => ui.notifications.warn(`${TITLE}: ${text}`);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));
const slugOf = (item) => item?.slug ?? game.pf2e?.system?.sluggify?.(item?.name ?? "") ?? "";

function isImpulse(item) {
    return ["feat", "action"].includes(item?.type) && (endsWithId(item, IMPULSE_ID) || slugOf(item) === IMPULSE_SLUG);
}

function isSpell(item) {
    return item?.type === "spell" && (endsWithId(item, SPELL_ID) || slugOf(item) === SPELL_SLUG);
}

/** The impulse's or spell's card, as used, cast or posted, rather than a roll made from it */
function getCard(message) {
    if (!message || message.rolls.length > 0) return null;
    const type = message.flags.pf2e?.context?.type;
    const item = message.item;
    if (isImpulse(item) && !type) return { kind: "impulse", item };
    if (isSpell(item) && (!type || type === "spell-cast")) return { kind: "spell", item };
    return null;
}

/** The impulse conjures the tree as a spell of half the kineticist's level, rounded up; the spell, at its cast rank */
function getRank(kind, { actor, item = null, message = null }) {
    if (kind === "impulse") return Math.max(1, Math.ceil((actor?.level ?? 1) / 2));
    return Math.max(1, Number(message?.flags.pf2e?.origin?.castRank ?? item?.rank ?? 1) || 1);
}

function getSceneToken(actor, scene = canvas.scene) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === scene) ?? null;
}

/** A tree's record, on its actor */
const treeData = (actor) => actor?.flags?.[MODULE_ID]?.protectorTree ?? null;
/** The caster's effect's record of its tree */
const effectData = (item) => (item?.type === "effect" ? (item.flags?.[MODULE_ID]?.protectorTree ?? null) : null);

/** Every token of an actor, on any scene */
function tokensOf(actor) {
    return game.scenes.contents.flatMap((scene) => scene.tokens.filter((t) => t.actorId === actor.id));
}

/* Geometry, from the documents, so it works on scenes no one is viewing */

/** Whether a creature is adjacent to the tree (or in its square, which doesn't impede movement), counting elevation */
function isAdjacent(treeToken, token) {
    const scene = treeToken.parent;
    if (!scene || token.parent !== scene) return false;
    const tree = spaceOf(treeToken, scene);
    const other = spaceOf(token, scene);
    const vertical = Math.max(0, other.z0 - tree.z1, tree.z0 - other.z1);
    if (vertical > 0) return false;
    return distanceBetween(tree, other, scene) <= scene.grid.distance;
}

/* Placing the tree */

let placement = null;

/** The squares within range of the caster where the tree can grow: unoccupied, with line of effect to the caster */
function getSquares(casterToken) {
    const scene = casterToken.parent;
    const size = scene.grid.size;
    const caster = spaceOf(casterToken, scene);
    const reach = Math.ceil(RANGE / scene.grid.distance) + 1;
    const origin = canvas.grid.getTopLeftPoint(canvas.grid.getOffset({ x: caster.x0 + 1, y: caster.y0 + 1 }));
    const occupied = scene.tokens
        .filter((t) => !t.hidden || game.user.isGM)
        .map((t) => spaceOf(t, scene))
        .filter((s) => s.z0 <= caster.z0 + scene.grid.distance);
    const casterCenter = casterToken.object?.center ?? {
        x: (caster.x0 + caster.x1) / 2,
        y: (caster.y0 + caster.y1) / 2,
    };
    const collision = CONFIG.Canvas.polygonBackends?.move;
    const bounds = canvas.dimensions.sceneRect;
    const columns = Math.ceil((caster.x1 - caster.x0) / size);
    const rows = Math.ceil((caster.y1 - caster.y0) / size);

    const squares = [];
    for (let row = -reach; row < rows + reach; row++) {
        for (let column = -reach; column < columns + reach; column++) {
            const x0 = origin.x + column * size;
            const y0 = origin.y + row * size;
            const square = { x0, y0, x1: x0 + size, y1: y0 + size, z0: caster.z0, z1: caster.z0 };
            const center = { x: x0 + size / 2, y: y0 + size / 2 };
            if (!bounds.contains(center.x, center.y)) continue;
            if (distanceBetween(caster, square, scene) > RANGE) continue;
            if (
                occupied.some(
                    (s) => s.x0 < square.x1 - 1 && square.x0 < s.x1 - 1 && s.y0 < square.y1 - 1 && square.y0 < s.y1 - 1,
                )
            ) {
                continue;
            }
            const blocked = collision?.testCollision(casterCenter, center, { type: "move", mode: "any" });
            if (blocked) continue;
            squares.push({ x: x0, y: y0 });
        }
    }
    return squares;
}

/** The world point under the pointer */
function worldPoint(event) {
    if (typeof canvas.canvasCoordinatesFromClient === "function") {
        return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    }
    const rect = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse(
        new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top),
    );
}

/**
 * Have the user pick the tree's square: the squares in range are highlighted, the square under the pointer shows the
 * tree, a click picks it, and a right-click or Escape cancels. Resolves to the square's top-left corner, or null.
 */
function pickSquare(casterToken) {
    placement?.cancel();
    if (!canvas.ready || canvas.scene?.id !== casterToken.parent?.id) {
        warn(`view ${casterToken.name}'s scene to place the tree.`);
        return Promise.resolve(null);
    }
    if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) {
        warn("placing the tree needs a square grid.");
        return Promise.resolve(null);
    }

    const size = canvas.grid.size;
    const squares = getSquares(casterToken);
    if (squares.length === 0) {
        warn(`there's no unoccupied square within ${RANGE} feet of ${casterToken.name}.`);
        return Promise.resolve(null);
    }
    const valid = new Set(squares.map((s) => `${s.x},${s.y}`));

    const layer = new PIXI.Container();
    const range = new PIXI.Graphics();
    range.beginFill(0x4caf50, 0.15).lineStyle(1, 0x4caf50, 0.5);
    for (const s of squares) range.drawRect(s.x, s.y, size, size);
    range.endFill();
    const marker = new PIXI.Graphics();
    const tree = PIXI.Sprite.from(TREE_IMG);
    tree.width = tree.height = size;
    tree.alpha = 0.75;
    tree.visible = false;
    layer.addChild(range, marker, tree);
    (canvas.controls ?? canvas.interface ?? canvas.stage).addChild(layer);

    let hovered = null;
    const view = canvas.app.view;
    const squareAt = (event) => {
        const point = canvas.grid.getTopLeftPoint(canvas.grid.getOffset(worldPoint(event)));
        return { x: point.x, y: point.y, valid: valid.has(`${point.x},${point.y}`) };
    };
    const draw = (square) => {
        marker.clear();
        if (!square) return void (tree.visible = false);
        const color = square.valid ? 0x4caf50 : 0xe53935;
        marker.beginFill(color, 0.3).lineStyle(3, color, 0.9).drawRect(square.x, square.y, size, size).endFill();
        tree.position.set(square.x, square.y);
        tree.visible = square.valid;
    };

    return new Promise((resolve) => {
        const finish = (result) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("contextmenu", onContextMenu, true);
            window.removeEventListener("keydown", onKey, true);
            Hooks.off("canvasTearDown", teardown);
            layer.destroy({ children: true });
            if (placement?.cancel === cancel) placement = null;
            resolve(result);
        };
        const cancel = () => finish(null);
        const onMove = (event) => {
            if (event.target !== view) return;
            hovered = squareAt(event);
            draw(hovered);
        };
        const onDown = (event) => {
            if (event.target !== view) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.button === 2) return cancel();
            if (event.button !== 0) return;
            const square = squareAt(event);
            if (!square.valid) {
                return warn(`pick a highlighted square: unoccupied and within ${RANGE} feet of ${casterToken.name}.`);
            }
            finish({ x: square.x, y: square.y });
        };
        const onContextMenu = (event) => {
            if (event.target !== view) return;
            event.preventDefault();
            event.stopPropagation();
        };
        const onKey = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        const teardown = Hooks.once("canvasTearDown", cancel);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerdown", onDown, true);
        window.addEventListener("contextmenu", onContextMenu, true);
        window.addEventListener("keydown", onKey, true);
        placement = { cancel };
        ui.notifications.info(
            `${TITLE}: click a highlighted square within ${RANGE} feet to grow the tree. Right-click or Escape cancels.`,
        );
    });
}

/**
 * Place a tree for the impulse or spell: the user picks the square, and the active GM makes the tree. Resolves to
 * whether the tree was grown.
 */
async function placeTree({ kind, actor, token = null, item = null, rank, messageId = null }) {
    const casterToken = token ?? getSceneToken(actor);
    if (!actor || !casterToken) {
        warn(`${actor?.name ?? "The caster"} needs a token on the scene to place the tree.`);
        return false;
    }
    if (!game.user.isGM && !game.users.activeGM) {
        warn("a GM must be logged in to grow the tree.");
        return false;
    }
    const square = await pickSquare(casterToken);
    if (!square) return false;

    const data = {
        kind,
        rank,
        casterUuid: actor.uuid,
        casterTokenUuid: casterToken.uuid,
        itemUuid: item?.uuid ?? null,
        sceneId: casterToken.parent.id,
        x: square.x,
        y: square.y,
        // The tree grows at the caster's elevation, so it's next to creatures on a rooftop with them
        elevation: Number(casterToken.elevation) || 0,
        messageId,
    };
    // Players can't make actors or tokens, so the active GM does
    const answer = await askGM("protectorTreeCreate", data, { title: TITLE, task: "grow the tree" });
    return answer.ok;
}

async function getFolder() {
    const existing = game.folders.find((f) => f.type === "Actor" && f.flags?.[MODULE_ID]?.protectorTrees);
    if (existing) return existing;
    return Folder.create({ name: FOLDER_NAME, type: "Actor", flags: { [MODULE_ID]: { protectorTrees: true } } });
}

/** Cards whose tree this session is growing, so a second request for one card grows nothing */
const growing = new Set();

/** Grow the tree for a card, once. Run by a GM. */
async function createTree(data) {
    const { messageId } = data;
    if (!messageId) return growTree(data);
    if (growing.has(messageId) || game.messages.get(messageId)?.flags[MODULE_ID]?.protectorTree?.placed) {
        throw new Error("the tree for this card was already placed");
    }
    growing.add(messageId);
    try {
        return await growTree(data);
    } finally {
        growing.delete(messageId);
    }
}

/** Grow the tree and give the caster its effect. Run by a GM. */
async function growTree({ kind, rank, casterUuid, casterTokenUuid, itemUuid, sceneId, x, y, elevation, messageId }) {
    const caster = await fromUuid(casterUuid);
    const scene = game.scenes.get(sceneId);
    const casterToken = casterTokenUuid ? await fromUuid(casterTokenUuid) : null;
    if (!caster || !scene) throw new Error("the caster or the scene is gone");
    const effect = await fromUuid(EFFECT_UUID);
    if (!effect) throw new Error("the module's Effect: Protector Tree was not found");

    // "If you use this impulse again, any previous one ends, and an ordinary tree remains."
    if (kind === "impulse") {
        const previous = caster.itemTypes.effect.filter((e) => effectData(e)?.kind === "impulse").map((e) => e.id);
        if (previous.length > 0) await caster.deleteEmbeddedDocuments("Item", previous);
    }

    const { OWNER, LIMITED } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const ownership = { default: LIMITED };
    for (const user of game.users) {
        if (!user.isGM && caster.testUserPermission(user, "OWNER")) ownership[user.id] = OWNER;
    }
    const hp = HP_PER_RANK * rank;
    const effectId = foundry.utils.randomID();
    const effectUuid = `${caster.uuid}.Item.${effectId}`;
    const traits = ["plant", "wood"].filter((t) => t in (CONFIG.PF2E.hazardTraits ?? {}));
    const source = kind === "impulse" ? "Timber Sentinel" : "Protector Tree";

    const tree = await Actor.create({
        name: `${TITLE} (${caster.name})`,
        type: "hazard",
        img: TREE_IMG,
        folder: (await getFolder())?.id ?? null,
        ownership,
        system: {
            attributes: {
                hp: { value: hp, max: hp, temp: 0, details: "" },
                ac: { value: AC },
                hardness: 0,
                emitsSound: false,
            },
            traits: { value: traits, rarity: "common", size: { value: "med" } },
            details: {
                level: { value: 0 },
                isComplex: false,
                description:
                    `<p>A protector tree from ${esc(caster.name)}'s ${source} (rank ${rank}). Whenever an ally ` +
                    `adjacent to the tree is hit by a Strike, the tree interposes its branches and takes the damage ` +
                    `first. Any additional damage beyond what it takes to reduce the tree to 0 Hit Points is dealt ` +
                    `to the original target. The tree isn't large enough to impede movement through its square.</p>`,
            },
        },
        prototypeToken: {
            name: TITLE,
            actorLink: true,
            width: 1,
            height: 1,
            texture: { src: TREE_IMG },
            disposition: casterToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY,
            displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
            displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
            bar1: { attribute: "attributes.hp" },
        },
        flags: {
            [MODULE_ID]: { protectorTree: { caster: caster.uuid, effect: effectUuid, kind, rank, active: true } },
        },
    });
    if (!tree) throw new Error("the tree's actor wasn't created");

    // From a GM session on an earlier version, the request has no elevation: the caster's token's
    const z = Number(elevation ?? casterToken?.elevation) || 0;
    const tokenSource = (await tree.getTokenDocument({ x, y, elevation: z })).toObject();
    const [token] = await scene.createEmbeddedDocuments("Token", [tokenSource]);

    const effectSource = effect.toObject();
    effectSource._id = effectId;
    effectSource._stats = { ...effectSource._stats, compendiumSource: EFFECT_UUID };
    effectSource.system.level = { value: rank };
    effectSource.system.context = {
        origin: {
            actor: caster.uuid,
            token: casterToken?.uuid ?? null,
            item: itemUuid ?? null,
            spellcasting: null,
            rollOptions: [],
        },
        target: null,
        roll: null,
    };
    effectSource.flags = { ...effectSource.flags, [MODULE_ID]: { protectorTree: { tree: tree.uuid, kind } } };
    await caster.createEmbeddedDocuments("Item", [effectSource], { keepId: true });

    const message = messageId ? game.messages.get(messageId) : null;
    if (message && getCard(message)) {
        await message.update({ [`flags.${MODULE_ID}.protectorTree.placed`]: token?.uuid ?? true });
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster, token: casterToken }),
        content:
            `<p><strong>${TITLE}</strong> A protector tree grows for ${esc(caster.name)} (rank ${rank}): AC ${AC}, ` +
            `${hp} Hit Points, for 1 minute. It takes the damage from Strikes that hit ${esc(caster.name)}'s ` +
            `allies next to it.</p>`,
    });
    return { tree: tree.uuid, token: token?.uuid ?? null };
}

/* The tree's end */

/** The tree is reduced to 0 Hit Points: it's destroyed. Removing its token removes the rest. Run by a GM. */
async function destroyTree(tree) {
    const data = treeData(tree);
    const caster = data?.caster ? fromUuidSync(data.caster) : null;
    const tokens = tokensOf(tree);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster ?? undefined }),
        content: `<p><strong>${TITLE}</strong> ${esc(caster?.name ?? "The")}${caster ? "'s" : ""} protector tree is destroyed.</p>`,
    });
    for (const token of tokens) await token.delete();
    if (tokens.length === 0) await removeTree(tree);
}

/** The tree's token is gone: remove its actor, and the caster's effect if it's still running. Run by a GM. */
async function removeTree(tree) {
    const data = treeData(tree);
    const effect = data?.effect ? fromUuidSync(data.effect) : null;
    if (game.actors.has(tree.id)) await tree.delete();
    if (effect?.actor?.items.has(effect.id)) await effect.delete();
}

/**
 * The effect ended with the tree standing: "If the tree is in soil and survives to the end of the spell's duration,
 * it remains as an ordinary, non-magical tree". Run by a GM.
 */
async function endTree(tree) {
    const data = treeData(tree);
    if (!data?.active) return;
    await tree.update({ name: "Tree", [`flags.${MODULE_ID}.protectorTree.active`]: false });
    for (const token of tokensOf(tree)) await token.update({ name: "Tree" });
    const caster = data.caster ? fromUuidSync(data.caster) : null;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster ?? undefined }),
        content:
            `<p><strong>${TITLE}</strong> ${esc(caster?.name ?? "The caster")}'s protector tree is no longer ` +
            `magical. If it's in soil, it remains as an ordinary tree; otherwise, delete its token.</p>`,
    });
}

/* Damage: the tree takes the damage of Strikes that hit allies next to it */

/** The caster's effect for a tree, if it's still running */
function getActiveEffect(tree) {
    const data = treeData(tree);
    if (!data?.active || !data.effect) return null;
    const effect = fromUuidSync(data.effect);
    if (!effect || effect.isExpired || effect.remainingDuration?.expired) return null;
    return effect;
}

/**
 * Damage from a Strike that hit. A Strike's damage carries its action in the roll options pf2e applies it with (a
 * character's `action:strike`; anyone's `self:action:slug:strike`, given as `origin:action:slug:strike`), also when it
 * was rolled without an attack roll; an NPC attack's inline damage, or an area or auto-fire attack, doesn't. Its
 * outcome is known when the damage was rolled against a target.
 */
function isStrikeHit({ rollOptions = new Set(), outcome = null }) {
    if (outcome && !HITS.includes(outcome)) return false;
    const options = rollOptions instanceof Set ? rollOptions : new Set(rollOptions ?? []);
    return options.has("action:strike") || options.has("origin:action:slug:strike");
}

/** A component's total in a damage instance (pf2e's `DamageInstance#componentTotal`), 0 when it can't be read */
function componentTotal(instance, component) {
    try {
        return Number(instance.componentTotal?.(component)) || 0;
    } catch {
        return 0;
    }
}

/**
 * Splash damage only: the creatures next to the target of a Strike that missed. pf2e marks the roll, but a roll applied
 * at half or double damage is a new one without the mark (`DamageRoll#alter`), so it's also told from its instances.
 */
function isSplashOnly(roll) {
    if (roll.options?.splashOnly) return true;
    const instances = roll.instances ?? [];
    return (
        instances.length > 0 &&
        instances.every((i) => !i.persistent && i.total > 0 && componentTotal(i, "splash") >= i.total)
    );
}

/** The tree that interposes for this damage, if any */
function findTree(actor, params) {
    const { damage, token, final = false } = params ?? {};
    if (final || !token?.parent || !actor?.isOfType?.("creature")) return null;
    if (!damage || typeof damage !== "object" || !Array.isArray(damage.instances) || !(damage.total > 0)) return null;
    // Splash damage from a hit reaches creatures next to the target, which weren't hit by the Strike
    if (isSplashOnly(damage)) return null;
    if (treeData(actor) || !isStrikeHit(params)) return null;
    return adjacentTree(actor, token);
}

/** The active tree a creature is next to, of a caster it's an ally of: { tree, treeToken, caster }, or null */
function adjacentTree(actor, token) {
    for (const treeToken of token.parent.tokens) {
        // Trees are world actors, with linked tokens: other tokens' actors aren't read (or built)
        if (!treeToken.actorLink) continue;
        const tree = game.actors.get(treeToken.actorId);
        if (!treeData(tree)?.active || !(tree.hitPoints?.value > 0)) continue;
        const effect = getActiveEffect(tree);
        const caster = effect?.actor;
        if (!caster) continue;
        // An ally of the caster: not the caster themself
        if (actor.uuid === caster.uuid || !actor.isAllyOf(caster)) continue;
        if (isAdjacent(treeToken, token)) return { tree, treeToken, caster };
    }
    return null;
}

/**
 * What's left of a damage roll once the tree has taken `absorbed`, as a damage formula, from its instances: `{ type,
 * materials, persistent, expression, total, precision, splash, undoubled }`, where `precision` and `splash` are the
 * totals of those components and `undoubled` the total without a critical hit's doubling (pf2e's `componentTotal` and
 * `critImmuneTotal`). The tree takes the instances in order. What's left of each keeps its type and materials, and its
 * share of precision and splash damage and of the doubling, so the ally's immunities, resistances and weaknesses to
 * those still apply. Persistent damage comes along whole. Null when nothing is left.
 */
function remainderFormula(instances, absorbed) {
    let left = Math.max(0, absorbed);
    const parts = [];
    for (const instance of instances) {
        const flavor = [instance.type ?? "untyped", ...(instance.materials ?? [])].join(",");
        if (instance.persistent) {
            if (instance.expression) parts.push(`(${instance.expression})[persistent,${flavor}]`);
            continue;
        }
        const total = Math.trunc(Number(instance.total) || 0);
        const taken = Math.min(left, Math.max(0, total));
        left -= taken;
        const value = total - taken;
        if (value <= 0) continue;

        const share = (component) => Math.round((value * Math.max(0, Number(component) || 0)) / total);
        const precision = Math.min(value, share(instance.precision));
        const splash = Math.min(value - precision, share(instance.splash));
        const base = value - precision - splash;
        const undoubled = Number(instance.undoubled ?? total);
        const sum = (b, p, s) =>
            [b ? String(b) : null, p ? `${p}[precision]` : null, s ? `${s}[splash]` : null].filter(Boolean);

        let expression;
        if (undoubled < total) {
            // A critical hit's doubling: half of each component, doubled, and what's odd left undoubled
            const halves = [Math.floor(base / 2), Math.floor(precision / 2), Math.floor(splash / 2)];
            const odd = value - 2 * halves.reduce((a, b) => a + b, 0);
            const inner = sum(...halves);
            const doubled = inner.length === 0 ? null : `2 * ${inner.length > 1 ? `(${inner.join(" + ")})` : inner[0]}`;
            expression = [doubled, odd ? String(odd) : null].filter(Boolean).join(" + ");
        } else {
            expression = sum(base, precision, splash).join(" + ");
        }
        parts.push(/^\d+$/.test(expression) ? `${expression}[${flavor}]` : `(${expression})[${flavor}]`);
    }
    return parts.length > 0 ? `{${parts.join(",")}}` : null;
}

/** What's left of the damage once the tree has taken `absorbed`, as a damage roll (see `remainderFormula`) */
async function getRemainder(roll, absorbed, outcome = null) {
    const instances = roll.instances.map((instance) => {
        const total = Math.trunc(Number(instance.total) || 0);
        let undoubled = total;
        try {
            undoubled = Number(instance.critImmuneTotal ?? total);
        } catch {
            // Not evaluated: no doubling known
        }
        return {
            type: instance.type,
            materials: instance.materials ?? [],
            persistent: !!instance.persistent,
            expression: instance.head?.expression ?? null,
            total,
            precision: componentTotal(instance, "precision"),
            splash: componentTotal(instance, "splash"),
            undoubled: Number.isFinite(undoubled) ? undoubled : total,
        };
    });
    const formula = remainderFormula(instances, absorbed);
    if (!formula) return null;
    const DamageRoll = roll.constructor;
    // A roll applied at half or double damage is a new one without the original's options (`DamageRoll#alter`)
    const degree = roll.options?.degreeOfSuccess ?? OUTCOMES.indexOf(outcome);
    const options = { degreeOfSuccess: degree >= 0 ? degree : null };
    if (roll.options?.bypass) options.bypass = foundry.utils.deepClone(roll.options.bypass);
    const remainder = new DamageRoll(formula, {}, options);
    await remainder.evaluate();
    return remainder;
}

/**
 * Damage the tree: this user's own if they own it, or the active GM's. The ally's damage doesn't wait for the GM (it's
 * applied inside pf2e's `applyDamage`): when no GM session damages the tree, the user is told to do it by hand.
 */
async function damageTree(treeToken, amount, allyToken = null) {
    const tree = treeToken.actor;
    if (tree.isOwner) return tree.applyDamage({ damage: amount, token: treeToken });
    askGM("protectorTreeDamage", { tokenUuid: treeToken.uuid, amount, allyTokenUuid: allyToken?.uuid ?? null })
        .then((answer) => {
            if (answer.ok) return;
            const why = {
                absent: "no GM is logged in",
                unanswered: "no GM session answered",
                failed: `the GM's session couldn't (${answer.error})`,
            }[answer.reason];
            warn(`the tree didn't take its ${amount} damage (${why}): apply it to the tree by hand.`);
        })
        .catch(log);
}

/** The tree interposes its branches: it takes the damage, and the ally whatever's left */
async function interpose(actor, applyDamage, params, { tree, treeToken }) {
    const roll = params.damage;
    const total = Math.max(0, Math.trunc(roll.total));
    const hp = tree.hitPoints?.value ?? 0;
    const absorbed = Math.min(total, hp);
    const overflow = total - absorbed;
    const target = esc(params.token.name ?? actor.name);

    const content =
        overflow > 0
            ? `<p><strong>${TITLE}</strong> The tree interposes its branches for ${target} and takes the Strike's ` +
              `damage: ${absorbed} reduces it to 0 Hit Points, and ${target} takes the remaining ${overflow}.</p>`
            : `<p><strong>${TITLE}</strong> The tree interposes its branches for ${target} and takes the Strike's ` +
              `${total} damage.</p>`;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ token: treeToken }), content });
    await damageTree(treeToken, total, params.token);
    if (overflow <= 0) return actor;

    let remainder = null;
    try {
        remainder = await getRemainder(roll, absorbed, params.outcome ?? null);
    } catch (error) {
        log(error);
    }
    return applyDamage({ ...params, damage: remainder ?? overflow });
}

/** pf2e's `applyDamage`, with the tree taking the damage first when it interposes */
async function applyDamageWithTree(actor, applyDamage, params) {
    let found = null;
    try {
        found = isEnabled(FEATURE) ? findTree(actor, params) : null;
    } catch (error) {
        log(error);
    }
    if (!found) return applyDamage(params);
    if (!found.tree.isOwner && !game.users.activeGM) {
        warn("a GM must be logged in for the tree to take the damage, so it goes to the creature.");
        return applyDamage(params);
    }
    return interpose(actor, applyDamage, params, found);
}

/**
 * pf2e has no hook before damage is applied, so its `applyDamage` is wrapped: with libWrapper when it's active, or
 * directly otherwise. Every way of applying damage goes through it: pf2e's chat buttons, PF2e Toolbelt, and macros.
 */
function wrapApplyDamage() {
    const path = "CONFIG.Actor.documentClass.prototype.applyDamage";
    if (game.modules.get("lib-wrapper")?.active && globalThis.libWrapper) {
        globalThis.libWrapper.register(
            MODULE_ID,
            path,
            function (wrapped, params) {
                return applyDamageWithTree(this, wrapped, params);
            },
            "MIXED",
        );
        return;
    }
    const prototype = CONFIG.Actor.documentClass.prototype;
    const original = prototype.applyDamage;
    if (typeof original !== "function") return log(new Error("pf2e's applyDamage was not found"));
    prototype.applyDamage = function (params) {
        return applyDamageWithTree(this, (p) => original.call(this, p), params);
    };
}

/* The card's button, for placing the tree when it wasn't placed on using the impulse */

function renderCard(message, html) {
    const card = getCard(message);
    const content = html?.querySelector?.(".message-content") ?? html;
    if (!card || !content?.querySelector || !message.actor?.isOwner) return;
    content.querySelector("[data-ehb-protector-tree]")?.remove();
    const controls = document.createElement("div");
    controls.dataset.ehbProtectorTree = "";
    if (message.flags[MODULE_ID]?.protectorTree?.placed) {
        controls.innerHTML = `<p><em>The tree was placed.</em></p>`;
    } else {
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = `<i class="fa-solid fa-tree"></i> Place Tree`;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            button.disabled = true;
            // Once the tree is placed, the card is updated and rendered without the button. Until then (and if it
            // isn't placed) it stays disabled, so a second click doesn't grow a second tree.
            startFromCard(message)
                .catch((error) => void log(error))
                .then((placed) => {
                    if (!placed) button.disabled = false;
                });
        });
        controls.append(button);
    }
    content.append(controls);
}

/** Place the tree for a card. Resolves to whether it was grown. */
async function startFromCard(message) {
    const card = getCard(message);
    const actor = message.actor;
    if (!card || !actor) return false;
    const rank = getRank(card.kind, { actor, item: card.item, message });
    return placeTree({ kind: card.kind, actor, token: message.token, item: card.item, rank, messageId: message.id });
}

/* Hooks */

hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId)) return;
    const card = getCard(message);
    if (!card) return;
    // Using the impulse posts its card. A spell's card is posted when it's cast, but pf2e before 8.5 doesn't mark casts,
    // so there it's placed from the card's button.
    const cast = card.kind === "impulse" || isSpellCast(message);
    if (cast) startFromCard(message).catch(log);
});

hooks.on("renderChatMessageHTML", (message, html) => renderCard(message, html));

// The tree's end is handled even with the feature off, so trees don't linger
Hooks.on("updateActor", async (actor, changed) => {
    if (!treeData(actor) || foundry.utils.getProperty(changed, "system.attributes.hp.value") === undefined) return;
    if ((actor.hitPoints?.value ?? actor.system.attributes.hp.value) > 0 || !(await confirmActiveGM())) return;
    destroyTree(actor).catch(log);
});

Hooks.on("deleteToken", async (token) => {
    const tree = game.actors.get(token.actorId);
    if (!treeData(tree) || tokensOf(tree).length > 0 || !(await confirmActiveGM())) return;
    removeTree(tree).catch(log);
});

Hooks.on("deleteItem", async (item) => {
    const data = effectData(item);
    const tree = data?.tree ? fromUuidSync(data.tree) : null;
    if (tree && (await confirmActiveGM())) endTree(tree).catch(log);
});

Hooks.once("init", () => {
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        /**
         * For a macro: place a protector tree for the controlled token (or the given one), as Timber Sentinel when it
         * has the impulse, or as the spell at the given rank
         */
        protectorTree: guardApi(
            FEATURE,
            async ({ token = canvas.tokens.controlled[0]?.document ?? null, rank } = {}) => {
                const casterToken = token?.document ?? token;
                const actor = casterToken?.actor;
                if (!actor) return warn("select the caster's token.");
                const impulse = actor.items.find(isImpulse) ?? null;
                const spell = impulse ? null : (actor.itemTypes.spell.find(isSpell) ?? null);
                const kind = impulse ? "impulse" : "spell";
                const treeRank = rank ?? getRank(kind, { actor, item: spell });
                await placeTree({ kind, actor, token: casterToken, item: impulse ?? spell, rank: treeRank }).catch(log);
            },
        ),
    };
});

Hooks.once("setup", () => {
    try {
        wrapApplyDamage();
    } catch (error) {
        log(error);
    }
});

const fromUuidOrNull = (uuid) => (typeof uuid === "string" ? fromUuid(uuid).catch(() => null) : null);

/**
 * A player's request to grow a tree: for a caster they own, from the impulse's or spell's card (or the item, from the
 * macro), at the rank it allows, on a free square within 30 feet of the caster's token, at its elevation
 */
async function checkCreate(data, sender) {
    const caster = await fromUuidOrNull(data.casterUuid);
    if (!(caster instanceof Actor) || !owns(sender, caster)) refuse(`${sender.name} doesn't own the caster`);
    const casterToken = await fromUuidOrNull(data.casterTokenUuid);
    const scene = casterToken?.parent;
    if (casterToken?.actor?.uuid !== caster.uuid || scene?.id !== data.sceneId) refuse("that isn't the caster's token");
    const kind = data.kind;
    if (!["impulse", "spell"].includes(kind)) refuse("it's neither the impulse nor the spell");

    const message = data.messageId ? game.messages.get(data.messageId) : null;
    if (data.messageId) {
        const card = message ? getCard(message) : null;
        if (card?.kind !== kind || message.actor?.uuid !== caster.uuid) refuse(`the card isn't ${caster.name}'s`);
    }
    const item = await fromUuidOrNull(data.itemUuid);
    if (!message && (item?.actor?.uuid !== caster.uuid || !(kind === "impulse" ? isImpulse(item) : isSpell(item)))) {
        refuse(`${caster.name} doesn't have the ${kind}`);
    }
    // The impulse's rank is half the kineticist's level; the spell's, its cast rank, at most what they can cast
    const highest = getRank("impulse", { actor: caster });
    const rank =
        kind === "impulse" ? highest : message ? getRank("spell", { message, item: message.item }) : Number(data.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > highest) refuse(`rank ${data.rank} is out of reach`);

    const x = Number(data.x);
    const y = Number(data.y);
    const size = scene.grid.size;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x % size !== 0 || y % size !== 0) refuse("that isn't a square");
    const square = { x0: x, y0: y, x1: x + size, y1: y + size };
    if (distanceBetween(spaceOf(casterToken, scene), square, scene) > RANGE)
        refuse(`the square is beyond ${RANGE} feet`);
    const occupied = scene.tokens.some((t) => {
        if (t.hidden) return false;
        const s = spaceOf(t, scene);
        return s.x0 < square.x1 - 1 && square.x0 < s.x1 - 1 && s.y0 < square.y1 - 1 && square.y0 < s.y1 - 1;
    });
    if (occupied) refuse("the square is occupied");
    const elevation = Number(casterToken.elevation) || 0;
    const itemUuid = item?.uuid ?? message?.item?.uuid ?? null;
    return { ...data, kind, rank, itemUuid, sceneId: scene.id, x, y, elevation };
}

/** A player's request to damage a tree: it's the active tree next to their creature that the Strike hit */
async function checkDamage(data, sender) {
    const treeToken = await fromUuidOrNull(data.tokenUuid);
    const allyToken = await fromUuidOrNull(data.allyTokenUuid);
    const ally = allyToken?.actor;
    if (!ally || !owns(sender, ally)) refuse(`${sender.name} doesn't own the creature the tree protects`);
    const found = allyToken.parent ? adjacentTree(ally, allyToken) : null;
    if (!treeToken || found?.treeToken !== treeToken) refuse(`no active tree protects ${allyToken.name}`);
    return { tokenUuid: treeToken.uuid, amount: data.amount };
}

onGMRequest("protectorTreeCreate", (data) => createTree(data), { check: checkCreate });
onGMRequest(
    "protectorTreeDamage",
    async (data) => {
        const token = await fromUuid(data.tokenUuid);
        const amount = Math.trunc(Number(data.amount));
        if (!token?.actor || !treeData(token.actor)) throw new Error("the tree is gone");
        if (amount > 0) await token.actor.applyDamage({ damage: amount, token });
    },
    { check: checkDamage },
);

export { createTree, distanceBetween, getRemainder, isAdjacent, isSplashOnly, isStrikeHit, remainderFormula, spaceOf };
