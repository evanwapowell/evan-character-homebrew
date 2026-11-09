/**
 * Timber Sentinel (wood kineticist) and Protector Tree. Timber Sentinel: "You conjure a tree within 30 feet, as a
 * protector tree spell of a rank equal to half your level rounded up. If you use this impulse again, any previous one
 * ends, and an ordinary tree remains." Protector Tree: "A Medium tree suddenly grows in an unoccupied square within
 * range. The tree has AC 10 and 10 Hit Points. Whenever an ally adjacent to the tree is hit by a Strike, the tree
 * interposes its branches and takes the damage first. Any additional damage beyond what it takes to reduce the tree to
 * 0 Hit Points is dealt to the original target. [...] Heightened (+1) The tree has an additional 10 Hit Points."
 *
 * pf2e only posts the card. Here, using the impulse (or casting the spell, which pf2e 8.x marks) has its user place
 * the tree: the squares in range are highlighted, a click places it, and a right-click or Escape cancels (the card
 * keeps a Place Tree button). The active GM makes the tree, a hazard with AC 10 and 10 Hit Points per rank, owned by
 * the caster's players, and gives the caster Effect: Protector Tree, which lasts 1 minute. While it does, damage from
 * a Strike that hits an ally of the caster adjacent to the tree is applied to the tree first, from whichever button or
 * module applies it: the tree takes the damage, and the ally only what's left once the tree is at 0 Hit Points, with
 * its types, so the ally's resistances still apply. At 0 Hit Points the tree is destroyed and its token removed. When
 * the effect ends otherwise (its duration, or the impulse used again), the tree stays as an ordinary tree, as the
 * spell says when it's in soil; deleting its token removes it.
 */

import { featureHooks, guardApi, isEnabled } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const FEATURE = "protectorTree";
const hooks = featureHooks(FEATURE);
const SOCKET = `module.${MODULE_ID}`;
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** This module's Effect: Protector Tree, on the caster while the tree stands */
const EFFECT_UUID = `${PACK}.yHoBoom9axaemxWS`;
/** IDs of pf2e's Timber Sentinel impulse and Protector Tree spell, the same in every pf2e version */
const IMPULSE_ID = "aHlcMMNQ85VLK7QT";
const IMPULSE_SLUG = "timber-sentinel";
const SPELL_ID = "K9gI08enGtmih5X1";
const SPELL_SLUG = "protector-tree";
/** pf2e 8.x adds this roll option to a spell's card when it's cast, rather than only posted to chat */
const CAST_OPTION = "origin:action:slug:cast-a-spell";
const TITLE = "Protector Tree";
const RANGE = 30;
const AC = 10;
const HP_PER_RANK = 10;
/** Foundry's own icon, for the tree's token */
const TREE_IMG = "icons/environment/wilderness/tree-oak.webp";
const FOLDER_NAME = "Protector Trees";
const HITS = ["success", "criticalSuccess"];

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

/** A token's space, in pixels, with its elevation and height in grid units (feet) */
function spaceOf(token, scene = token.parent) {
    const size = scene.grid.size;
    const distance = scene.grid.distance;
    const width = Math.max(token.width, 0.5);
    const height = Math.max(token.height, 0.5);
    return {
        x0: token.x,
        y0: token.y,
        x1: token.x + width * size,
        y1: token.y + height * size,
        z0: Number(token.elevation) || 0,
        z1: (Number(token.elevation) || 0) + Math.max(width, height) * distance,
    };
}

/**
 * The distance between two spaces as pf2e counts it on a square grid: the squares between them, every second diagonal
 * counting double, in feet. Spaces that touch are 5 feet apart.
 */
function distanceBetween(a, b, scene) {
    const size = scene.grid.size;
    const along = (a0, a1, b0, b1) => {
        if (a0 < b1 - 1 && b0 < a1 - 1) return 0;
        const gap = Math.max(0, b0 - a1, a0 - b1);
        return Math.round(gap / size) + 1;
    };
    const dx = along(a.x0, a.x1, b.x0, b.x1);
    const dy = along(a.y0, a.y1, b.y0, b.y1);
    const squares = Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
    return squares * scene.grid.distance;
}

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

/** Place a tree for the impulse or spell: the user picks the square, and the active GM makes the tree */
async function placeTree({ kind, actor, token = null, item = null, rank, messageId = null }) {
    const casterToken = token ?? getSceneToken(actor);
    if (!actor || !casterToken)
        return warn(`${actor?.name ?? "The caster"} needs a token on the scene to place the tree.`);
    if (!game.user.isGM && !game.users.activeGM) return warn("a GM must be logged in to grow the tree.");
    const square = await pickSquare(casterToken);
    if (!square) return;

    const data = {
        kind,
        rank,
        casterUuid: actor.uuid,
        casterTokenUuid: casterToken.uuid,
        itemUuid: item?.uuid ?? null,
        sceneId: casterToken.parent.id,
        x: square.x,
        y: square.y,
        messageId,
    };
    if (game.user.isGM) return createTree(data);
    // Players can't make actors or tokens, so the active GM does
    game.socket.emit(SOCKET, { action: "protectorTreeCreate", ...data });
}

async function getFolder() {
    const existing = game.folders.find((f) => f.type === "Actor" && f.flags?.[MODULE_ID]?.protectorTrees);
    if (existing) return existing;
    return Folder.create({ name: FOLDER_NAME, type: "Actor", flags: { [MODULE_ID]: { protectorTrees: true } } });
}

/** Grow the tree and give the caster its effect. Run by a GM. */
async function createTree({ kind, rank, casterUuid, casterTokenUuid, itemUuid, sceneId, x, y, messageId }) {
    const caster = await fromUuid(casterUuid);
    const scene = game.scenes.get(sceneId);
    const casterToken = casterTokenUuid ? await fromUuid(casterTokenUuid) : null;
    if (!caster || !scene) return;
    const effect = await fromUuid(EFFECT_UUID);
    if (!effect) return ui.notifications.error(`${TITLE}: the module's Effect: Protector Tree was not found.`);

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
    if (!tree) return;

    const tokenSource = (await tree.getTokenDocument({ x, y, elevation: 0 })).toObject();
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

/** Damage from a Strike that hit */
function isStrikeHit({ item = null, rollOptions = new Set(), outcome = null }) {
    if (outcome && !HITS.includes(outcome)) return false;
    const options = rollOptions instanceof Set ? rollOptions : new Set(rollOptions ?? []);
    return (
        !!item?.isOfType?.("weapon", "melee") ||
        options.has("action:strike") ||
        options.has("origin:action:slug:strike")
    );
}

/** The tree that interposes for this damage, if any */
function findTree(actor, params) {
    const { damage, token, final = false } = params ?? {};
    if (final || !token?.parent || !actor?.isOfType?.("creature")) return null;
    if (!damage || typeof damage !== "object" || !Array.isArray(damage.instances) || !(damage.total > 0)) return null;
    // Splash damage from a hit reaches creatures next to the target, which weren't hit by the Strike
    if (damage.options?.splashOnly) return null;
    if (treeData(actor) || !isStrikeHit(params)) return null;

    for (const treeToken of token.parent.tokens) {
        const tree = treeToken.actor;
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
 * What's left of the damage once the tree has taken `absorbed`, with its damage types and materials, so the ally's
 * resistances still apply. Persistent damage comes along with it.
 */
async function getRemainder(roll, absorbed) {
    let left = absorbed;
    const parts = [];
    for (const instance of roll.instances) {
        const flavor = [instance.type ?? "untyped", ...(instance.materials ?? [])].join(",");
        if (instance.persistent) {
            const expression = instance.head?.expression;
            if (expression) parts.push(`(${expression})[persistent,${flavor}]`);
            continue;
        }
        let value = Math.trunc(Number(instance.total) || 0);
        const taken = Math.min(left, Math.max(0, value));
        left -= taken;
        value -= taken;
        if (value > 0) parts.push(`${value}[${flavor}]`);
    }
    if (parts.length === 0) return null;
    const DamageRoll = roll.constructor;
    const options = { degreeOfSuccess: roll.options?.degreeOfSuccess ?? null };
    if (roll.options?.bypass) options.bypass = foundry.utils.deepClone(roll.options.bypass);
    const remainder = new DamageRoll(`{${parts.join(",")}}`, {}, options);
    await remainder.evaluate();
    return remainder;
}

/** Damage the tree: this user's own if they own it, or the active GM's */
async function damageTree(treeToken, amount) {
    const tree = treeToken.actor;
    if (tree.isOwner) return tree.applyDamage({ damage: amount, token: treeToken });
    if (!game.users.activeGM) return warn(`a GM must be logged in to apply ${amount} damage to the tree.`);
    game.socket.emit(SOCKET, { action: "protectorTreeDamage", tokenUuid: treeToken.uuid, amount });
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
    await damageTree(treeToken, total);
    if (overflow <= 0) return actor;

    let remainder = null;
    try {
        remainder = await getRemainder(roll, absorbed);
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
            startFromCard(message)
                .catch(log)
                .finally(() => (button.disabled = false));
        });
        controls.append(button);
    }
    content.append(controls);
}

async function startFromCard(message) {
    const card = getCard(message);
    const actor = message.actor;
    if (!card || !actor) return;
    const rank = getRank(card.kind, { actor, item: card.item, message });
    await placeTree({ kind: card.kind, actor, token: message.token, item: card.item, rank, messageId: message.id });
}

/* Hooks */

hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id) return;
    const card = getCard(message);
    if (!card) return;
    // Using the impulse posts its card. A spell's card is posted when it's cast, but pf2e 7.x doesn't mark casts, so
    // there it's placed from the card's button.
    const cast = card.kind === "impulse" || message.flags.pf2e?.origin?.rollOptions?.includes(CAST_OPTION);
    if (cast) startFromCard(message).catch(log);
});

hooks.on("renderChatMessageHTML", (message, html) => renderCard(message, html));

// The tree's end is handled even with the feature off, so trees don't linger
Hooks.on("updateActor", (actor, changed) => {
    if (game.user !== game.users.activeGM || !treeData(actor)) return;
    if (foundry.utils.getProperty(changed, "system.attributes.hp.value") === undefined) return;
    if ((actor.hitPoints?.value ?? actor.system.attributes.hp.value) <= 0) destroyTree(actor).catch(log);
});

Hooks.on("deleteToken", (token) => {
    if (game.user !== game.users.activeGM) return;
    const tree = game.actors.get(token.actorId);
    if (!treeData(tree) || tokensOf(tree).length > 0) return;
    removeTree(tree).catch(log);
});

Hooks.on("deleteItem", (item) => {
    if (game.user !== game.users.activeGM) return;
    const data = effectData(item);
    const tree = data?.tree ? fromUuidSync(data.tree) : null;
    if (tree) endTree(tree).catch(log);
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

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (game.user !== game.users.activeGM) return;
        if (data?.action === "protectorTreeCreate") await createTree(data).catch(log);
        if (data?.action === "protectorTreeDamage") {
            const token = await fromUuid(data.tokenUuid);
            const amount = Math.trunc(Number(data.amount));
            if (token?.actor && treeData(token.actor) && amount > 0) {
                await token.actor.applyDamage({ damage: amount, token }).catch(log);
            }
        }
    });
});

export { distanceBetween, getRemainder, isAdjacent, isStrikeHit, spaceOf };
