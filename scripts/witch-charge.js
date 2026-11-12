/**
 * Designate Witch's Charge: pf2e only provides Effect: Witch's Charge to drag onto a creature. Posting the module's
 * Designate Witch's Charge action applies that effect to the targeted creature, as the witch's, and removes the
 * witch's charge from anyone else. With Witch's Communion, the witch can target as many creatures as their
 * Intelligence modifier, which then become their charges.
 */

import { canAnimate, featureHooks, guardApi } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("witchCharge");
const SOCKET = `module.${MODULE_ID}`;
/** IDs of the action in this module's compendium, pf2e's feats, and pf2e's Effect: Witch's Charge */
const ACTION_ID = "f0BUHuiZLiODSsg3";
const COMMUNION_ID = "4IeAAmx2vZEHmRLX";
const SENESCHAL_DEDICATION_ID = "HIu1miRRGvGvHevN";
const CHARGE_EFFECT_UUID = "Compendium.pf2e.feat-effects.Item.ugeStF0Rj8phBPWL";

function isDesignateAction(message) {
    const item = message.item;
    if (item?.slug === "designate-witchs-charge") return true;
    const uuids = [item?.sourceId, item?.uuid, message.flags.pf2e?.origin?.uuid];
    return uuids.some((uuid) => String(uuid ?? "").endsWith(`.${ACTION_ID}`));
}

function isChargeEffect(effect) {
    return (
        [effect.sourceId, effect.uuid].some((uuid) => uuid === CHARGE_EFFECT_UUID) ||
        effect.name === "Effect: Witch's Charge"
    );
}

function hasFeat(actor, id, name) {
    return actor.itemTypes.feat.some(
        (f) => [f.sourceId, f.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`)) || f.name === name,
    );
}

/** How many charges the witch can designate: 1, or their Intelligence modifier with Witch's Communion */
function getMaxCharges(witch) {
    const hasCommunion = hasFeat(witch, COMMUNION_ID, "Witch's Communion");
    return hasCommunion ? Math.max(1, witch.system.abilities?.int?.mod ?? 1) : 1;
}

/** Every actor in the world: world actors, and those of unlinked tokens on any scene */
function* allActors() {
    yield* game.actors;
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (!token.actorLink && token.actor) yield token.actor;
        }
    }
}

/** JB2A (free) energy strands from the witch to a charge, by the longest distance each file covers */
const JB2A_LIBRARY = "modules/JB2A_DnD5e/Library";
const TETHERS = [
    [5, "Generic/Energy/EnergyStrand_Multiple02_Regular_BluePink_05ft_600x400.webm"],
    [15, "Generic/Energy/EnergyStrand_Multiple02_Regular_BluePink_15ft_1000x400.webm"],
    [30, "Generic/Energy/EnergyStrand_Multiple02_Regular_BluePink_30ft_1600x400.webm"],
    [60, "Generic/Energy/EnergyStrand_Multiple02_Regular_BluePink_60ft_2800x400.webm"],
    [90, "Generic/Energy/EnergyStrand_Multiple02_Regular_BluePink_90ft_4000x400.webm"],
];
const CHARGE_MARKER = "Generic/Marker/EnergyStrands02_01_Regular_BluePurple_400x400.webm";

/** A tether from the witch to each new charge, then a mark on the charge */
function playChargeAnimation(witch, targetTokens) {
    if (!canAnimate()) return;

    const sequence = new Sequence();
    let hasEffects = false;
    for (const targetToken of targetTokens) {
        const witchToken = witch.getActiveTokens(true, true).find((t) => t.parent === targetToken.parent);
        if (!witchToken?.object || !targetToken.object) continue;

        const distance = witchToken.object.distanceTo(targetToken.object);
        const tether = (TETHERS.find(([feet]) => distance <= feet) ?? TETHERS.at(-1))[1];
        sequence.effect().file(`${JB2A_LIBRARY}/${tether}`).atLocation(witchToken).stretchTo(targetToken);
        sequence
            .effect()
            .file(`${JB2A_LIBRARY}/${CHARGE_MARKER}`)
            .atLocation(targetToken)
            .scaleToObject(1.8)
            .delay(600)
            .fadeIn(200)
            .fadeOut(500);
        hasEffects = true;
    }
    if (hasEffects) sequence.play();
}

/**
 * A document ID made from the request, the same in every session. A request can reach two sessions (a user with
 * Foundry open in two windows or on two devices): both create the card and effects with the same IDs, so the server
 * keeps one of each rather than two.
 */
function idFor(...parts) {
    const text = parts.join("|");
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let seed = 0; id.length < 16; seed++) {
        // FNV-1a, a different stream for each seed, 4 characters from each
        let hash = (2166136261 ^ seed) >>> 0;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
        for (let k = 0; k < 4; k++, hash = Math.floor(hash / chars.length)) id += chars[hash % chars.length];
    }
    return id;
}

/** Create a document with a set ID, unless it exists (or another session created it first) */
async function createOnce(collection, create) {
    try {
        await create();
    } catch (error) {
        if (!collection()) console.error(`${MODULE_ID} | Witch's Charge:`, error);
    }
}

/** Requests this session is designating or has designated, so a request sent twice is handled once */
const handled = new Set();

/** Make the targets the witch's only charges. Run by a GM, who can edit every creature. */
async function designateCharges(witchUuid, targetTokenUuids, requestId = foundry.utils.randomID()) {
    const cardId = idFor("card", requestId);
    if (handled.has(requestId) || game.messages.has(cardId)) return;
    handled.add(requestId);

    const witch = await fromUuid(witchUuid);
    const targetTokens = (await Promise.all(targetTokenUuids.map((uuid) => fromUuid(uuid)))).filter((t) => t?.actor);
    if (!witch || targetTokens.length === 0) return;
    const effect = await fromUuid(CHARGE_EFFECT_UUID);
    if (!effect) return ui.notifications.error("Witch's Charge: pf2e's Effect: Witch's Charge was not found.");
    if (game.messages.has(cardId)) return;

    // The card first, so another session handling the same request sees it and stops
    const esc = Handlebars.escapeExpression;
    const names = targetTokens.map((t) => esc(t.name));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    const text = `${esc(witch.name)} designates ${list} as their ${names.length > 1 ? "charges" : "charge"}.`;
    await createOnce(
        () => game.messages.get(cardId),
        () =>
            ChatMessage.create(
                {
                    _id: cardId,
                    speaker: ChatMessage.getSpeaker({ actor: witch }),
                    content: `<p><strong>Witch's Charge</strong> ${text}</p>`,
                },
                { keepId: true },
            ),
    );

    // Remove the witch's charge from everyone, including effects dragged on without an origin, but not this request's
    const effectIds = new Set(targetTokens.map((t) => idFor("effect", requestId, t.uuid)));
    for (const actor of allActors()) {
        const ids = actor.itemTypes.effect
            .filter((e) => isChargeEffect(e) && [witch.uuid, undefined, null].includes(e.system.context?.origin?.actor))
            .filter((e) => !effectIds.has(e.id))
            .map((e) => e.id);
        if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    }

    for (const targetToken of targetTokens) {
        const actor = targetToken.actor;
        const id = idFor("effect", requestId, targetToken.uuid);
        if (actor.items.has(id)) continue;
        const source = effect.toObject();
        source._id = id;
        source._stats.compendiumSource = CHARGE_EFFECT_UUID;
        const witchToken = witch.getActiveTokens(true, true).find((t) => t.parent === targetToken.parent);
        source.system.context = {
            origin: { actor: witch.uuid, token: witchToken?.uuid ?? null, item: null, spellcasting: null },
            target: { actor: targetToken.actor.uuid, token: targetToken.uuid },
            roll: null,
        };
        await createOnce(
            () => actor.items.get(id),
            () => actor.createEmbeddedDocuments("Item", [source], { keepId: true }),
        );
    }
}

/**
 * Designate the user's targeted creatures as the witch's charges. `requestId` is the posted action's message ID, the
 * same in every window the user has open, so the GM designates once however many windows ask.
 */
function requestCharge(witch, requestId = foundry.utils.randomID()) {
    const targetTokens = [...game.user.targets].map((t) => t.document);
    const maxCharges = getMaxCharges(witch);
    if (targetTokens.length === 0 || targetTokens.length > maxCharges) {
        const count = maxCharges === 1 ? "exactly one creature" : `up to ${maxCharges} creatures (Witch's Communion)`;
        return ui.notifications.warn(`Witch's Charge: target ${count} to designate as your charge.`);
    }
    if (targetTokens.some((t) => t.actor === witch)) {
        return ui.notifications.warn("Witch's Charge: you can't be your own charge.");
    }
    // Seneschal Witch Dedication: "can't choose your familiar or another creature with the minion trait as a charge"
    const isSeneschal = hasFeat(witch, SENESCHAL_DEDICATION_ID, "Seneschal Witch Dedication");
    const isMinion = (actor) => actor.isOfType("familiar") || actor.traits?.has("minion");
    if (isSeneschal && targetTokens.some((t) => isMinion(t.actor))) {
        return ui.notifications.warn("Witch's Charge: a seneschal can't choose a familiar or minion as a charge.");
    }

    const targetTokenUuids = targetTokens.map((t) => t.uuid);
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn("Witch's Charge: a GM must be logged in.");
    }
    // Played here, where the tokens are on screen; Sequencer shows it to everyone
    playChargeAnimation(witch, targetTokens);
    if (game.user.isGM) return designateCharges(witch.uuid, targetTokenUuids, requestId);
    // Players can't edit other creatures, so the active GM applies and removes the effects
    game.socket.emit(SOCKET, { action: "designateCharge", witchUuid: witch.uuid, targetTokenUuids, requestId });
}

hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id || !isDesignateAction(message)) return;
    const witch = message.actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (witch) requestCharge(witch, message.id);
});

Hooks.once("init", () => {
    // For a macro: designate your targets as the charges of the selected token (or your character)
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        designateCharge: guardApi(
            "witchCharge",
            (witch = canvas.tokens?.controlled[0]?.actor ?? game.user.character) =>
                witch ? requestCharge(witch) : ui.notifications.warn("Select your witch's token."),
        ),
    };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "designateCharge" || game.user !== game.users.activeGM) return;
        await designateCharges(data.witchUuid, data.targetTokenUuids, data.requestId);
    });
});
