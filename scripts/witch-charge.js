/**
 * Designate Witch's Charge: pf2e only provides Effect: Witch's Charge to drag onto a creature. Posting the module's
 * Designate Witch's Charge action applies that effect to the targeted creature, as the witch's, and removes the
 * witch's charge from anyone else. With Witch's Communion, the witch can target as many creatures as their
 * Intelligence modifier, which then become their charges.
 */

import { findItems } from "./lib/items.js";
import { askGM, canAnimate, createdHere, featureHooks, guardApi, onGMRequest, owns, refuse } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("witchCharge");
/** IDs of the action in this module's compendium, pf2e's feats, and pf2e's Effect: Witch's Charge */
const ACTION_ID = "f0BUHuiZLiODSsg3";
const CHARGE_FEAT_ID = "52QyoGaysrfBOy5H";
const COMMUNION_ID = "4IeAAmx2vZEHmRLX";
const SENESCHAL_DEDICATION_ID = "HIu1miRRGvGvHevN";
const CHARGE_EFFECT_UUID = "Compendium.pf2e.feat-effects.Item.ugeStF0Rj8phBPWL";

function isDesignateAction(message) {
    const item = message.item;
    if (item?.slug === "designate-witchs-charge") return true;
    const uuids = [item?.sourceId, item?.uuid, message.flags.pf2e?.origin?.uuid];
    return uuids.some((uuid) => String(uuid ?? "").endsWith(`.${ACTION_ID}`));
}

/** Effect: Witch's Charge, as an item or an item's source (see lib/items.js) */
function isChargeEffect(effect) {
    return effect._stats?.compendiumSource === CHARGE_EFFECT_UUID || effect.name === "Effect: Witch's Charge";
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
 * Make the targets the witch's only charges: give each Effect: Witch's Charge with the witch as its origin, then remove
 * the witch's earlier charges, then post the card. Run by the active GM, who can edit every creature, in one session.
 *
 * An effect dragged onto a creature from the compendium has no origin, so whose charge it is isn't known: it's removed
 * when this witch is the only creature in the world with the Witch's Charge feat, and otherwise left, and the card says
 * so.
 */
async function designateCharges(witchUuid, targetTokenUuids) {
    const witch = await fromUuid(witchUuid);
    const targetTokens = (await Promise.all(targetTokenUuids.map((uuid) => fromUuid(uuid)))).filter((t) => t?.actor);
    if (!witch) throw new Error("the witch is gone");
    if (targetTokens.length === 0) throw new Error("the targets are gone");
    const effect = await fromUuid(CHARGE_EFFECT_UUID);
    if (!effect) throw new Error("pf2e's Effect: Witch's Charge was not found");

    const designated = [];
    const failed = [];
    const created = new Set();
    for (const targetToken of targetTokens) {
        const source = effect.toObject();
        delete source._id;
        source._stats = { ...source._stats, compendiumSource: CHARGE_EFFECT_UUID };
        const witchToken = witch.getActiveTokens(true, true).find((t) => t.parent === targetToken.parent);
        source.system.context = {
            origin: { actor: witch.uuid, token: witchToken?.uuid ?? null, item: null, spellcasting: null },
            target: { actor: targetToken.actor.uuid, token: targetToken.uuid },
            roll: null,
        };
        try {
            const [item] = (await targetToken.actor.createEmbeddedDocuments("Item", [source])) ?? [];
            if (!item) throw new Error("it wasn't created");
            created.add(item.uuid);
            designated.push(targetToken);
        } catch (error) {
            console.error(`${MODULE_ID} | Witch's Charge:`, error);
            failed.push(targetToken);
        }
    }

    const esc = Handlebars.escapeExpression;
    const listOf = (tokens) => {
        const names = tokens.map((t) => esc(t.name));
        return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
    };
    if (designated.length === 0) throw new Error(`no charge could be given to ${listOf(failed)}`);

    // The witch's earlier charges, and those without an origin when no other creature could have given them
    const otherWitch = game.actors.some((a) => a.uuid !== witch.uuid && hasFeat(a, CHARGE_FEAT_ID, "Witch's Charge"));
    const left = [];
    const isOldCharge = (e) => {
        if (e.type !== "effect" || !isChargeEffect(e)) return false;
        const origin = e.system?.context?.origin?.actor;
        if (origin) return origin === witch.uuid;
        return !otherWitch;
    };
    for (const { actor, items } of findItems(isOldCharge)) {
        const ids = items.filter((e) => !created.has(e.uuid)).map((e) => e.id);
        if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    }
    if (otherWitch) {
        const isOriginless = (e) => e.type === "effect" && isChargeEffect(e) && !e.system?.context?.origin?.actor;
        for (const { actor } of findItems(isOriginless)) left.push({ name: actor.name });
    }

    const text = `${esc(witch.name)} designates ${listOf(designated)} as their ${designated.length > 1 ? "charges" : "charge"}.`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: witch }),
        content: `<p><strong>Witch's Charge</strong> ${text}</p>`,
    });
    // To the GM only: it names creatures with another witch's charge, which may be the party's enemies
    if (left.length > 0) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: witch }),
            whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
            content:
                `<p><strong>Witch's Charge</strong> Effect: Witch's Charge without an origin is still on ` +
                `${listOf(left)}: another creature has the Witch's Charge feat, so it may be theirs. If it was ` +
                `${esc(witch.name)}'s, remove it.</p>`,
        });
    }
    if (failed.length > 0) throw new Error(`no charge could be given to ${listOf(failed)}`);
    return { designated: designated.map((t) => t.uuid) };
}

/** Why the witch can't designate these creatures as their charges, or null when they can */
function chargeProblem(witch, targetTokens) {
    const maxCharges = getMaxCharges(witch);
    if (targetTokens.length === 0 || targetTokens.length > maxCharges) {
        const count = maxCharges === 1 ? "exactly one creature" : `up to ${maxCharges} creatures (Witch's Communion)`;
        return `target ${count} to designate as your charge.`;
    }
    if (targetTokens.some((t) => t.actor === witch)) return "you can't be your own charge.";
    // Seneschal Witch Dedication: "can't choose your familiar or another creature with the minion trait as a charge"
    const isSeneschal = hasFeat(witch, SENESCHAL_DEDICATION_ID, "Seneschal Witch Dedication");
    const isMinion = (actor) => actor.isOfType("familiar") || actor.traits?.has("minion");
    if (isSeneschal && targetTokens.some((t) => isMinion(t.actor))) {
        return "a seneschal can't choose a familiar or minion as a charge.";
    }
    return null;
}

/** Designate the user's targeted creatures as the witch's charges */
function requestCharge(witch, requestId = foundry.utils.randomID()) {
    const targetTokens = [...game.user.targets].map((t) => t.document).filter((t) => t?.actor);
    const problem = chargeProblem(witch, targetTokens);
    if (problem) return ui.notifications.warn(`Witch's Charge: ${problem}`);

    const targetTokenUuids = targetTokens.map((t) => t.uuid);
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn("Witch's Charge: a GM must be logged in.");
    }
    // Played here, where the tokens are on screen; Sequencer shows it to everyone
    playChargeAnimation(witch, targetTokens);
    // Players can't edit other creatures, so the active GM applies and removes the effects. (`requestId` is for a GM
    // session on a version before 1.26.19, which used it to designate once.)
    const data = { witchUuid: witch.uuid, targetTokenUuids, requestId };
    return askGM("designateCharge", data, { title: "Witch's Charge", task: "designate the charge" });
}

hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId) || !isDesignateAction(message)) return;
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

/** A player's designation: of a witch they own, within the charges the witch can have */
function checkDesignation({ witchUuid, targetTokenUuids }, sender) {
    const witch = typeof witchUuid === "string" ? fromUuidSync(witchUuid) : null;
    if (!(witch instanceof Actor) || !owns(sender, witch)) refuse(`${sender.name} doesn't own the witch`);
    const uuids = Array.isArray(targetTokenUuids) ? targetTokenUuids : [];
    const targetTokens = uuids.map((uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null));
    if (targetTokens.some((t) => !t?.actor)) refuse("a creature is gone");
    const problem = chargeProblem(witch, targetTokens);
    if (problem) refuse(problem);
    return { witchUuid: witch.uuid, targetTokenUuids: targetTokens.map((t) => t.uuid) };
}

onGMRequest("designateCharge", (data) => designateCharges(data.witchUuid, data.targetTokenUuids), {
    check: checkDesignation,
});

export { designateCharges, requestCharge };
