/**
 * Sepulchral Mask (psychopomp sorcerer): "You manifest a supernatural funerary mask, granting you a +1 status bonus to
 * Will saving throws against emotion effects for 1 minute. [...] Each enemy in the area when you Cast the Spell or that
 * starts its turn in the area takes 1d4 mental damage and must attempt a Will save." pf2e's spell effect only gives
 * the bonus. This module's Aura: Sepulchral Mask adds the emanation, applied on casting (pf2e 8.5) or when the spell's
 * effect is dragged from its card. At the start of each enemy's turn in the emanation, a card is posted with buttons for
 * the caster to roll the damage and for the creature to roll its Will save. Once both are rolled, the result is applied:
 * the damage for the degree of success, and on a failure the –1 status penalty to Will saves against emotion effects
 * (Effect: Sepulchral Mask). Failed saves against the spell's own card get the penalty too; their damage is rolled once
 * from the card for every creature in the area, as usual.
 */

import { isSpellCast } from "./lib/casting.js";
import {
    BASIC_SAVE_MULTIPLIERS,
    OUTCOMES,
    effectRoll,
    outcomeLabel,
    reportedSaveMessage,
    reportedToolbeltSave,
    rollPublicSave,
} from "./lib/saves.js";
import { cardButton, cardNote } from "./lib/ui.js";
import { MODULE_ID, effectContext, endsWithId, esc, getSceneToken, logger } from "./lib/util.js";
import { askGM, canAnimate, createdHere, featureHooks, isAuthor, onGMRequest, owns, refuse } from "./settings.js";

/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("sepulchralMask");
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** This module's Aura: Sepulchral Mask, for the caster, and Effect: Sepulchral Mask, the penalty on a failed save */
const AURA_UUID = `${PACK}.JZzkqIbry9lR8y0P`;
const PENALTY_UUID = `${PACK}.GOsDZYg9DXFPhzwg`;
/** IDs of pf2e's Sepulchral Mask spell and Spell Effect: Sepulchral Mask, the same in every pf2e version */
const SPELL_ID = "3mINzPzup2m9qzFU";
const SYSTEM_EFFECT_ID = "TER4qOsYPTszhhDG";
const AURA_SLUG = "sepulchral-mask";
/** Saves rolled from this module's turn-start card carry this identifier, followed by the card's ID */
const SAVE_IDENTIFIER = "sepulchral-mask:";
/** "Visual" and "mental": a creature immune to either is unaffected. Blinded creatures are immune to visual effects. */
const IMMUNITIES = ["mental", "visual", "emotion"];
/** Each result of the Will save: the damage (a basic save's) and the penalty */
const RESULTS = {
    criticalSuccess: { text: "is unaffected" },
    success: { text: "takes half damage" },
    failure: { text: "takes full damage", penalty: { value: 1, unit: "rounds", text: "1 round" } },
    criticalFailure: { text: "takes double damage", penalty: { value: 1, unit: "minutes", text: "1 minute" } },
};
const SECONDS = { rounds: 6, minutes: 60 };

const log = logger("Sepulchral Mask");

function isMaskSpell(item) {
    if (item?.type !== "spell") return false;
    return item.slug === "sepulchral-mask" || endsWithId(item, SPELL_ID);
}

/** pf2e's own Spell Effect: Sepulchral Mask, which this module's aura replaces */
function isSystemEffect(item) {
    if (item?.type !== "effect") return false;
    return item.slug === "spell-effect-sepulchral-mask" || endsWithId(item, SYSTEM_EFFECT_ID);
}

function isAuraEffect(item) {
    return item?.type === "effect" && item.slug === "aura-sepulchral-mask";
}

/** The spell's card, as cast or posted, rather than a save or damage rolled from it */
function isMaskCard(message) {
    const type = message.flags.pf2e?.context?.type;
    if (message.flags[MODULE_ID]?.sepulchralMask || message.rolls.length > 0) return false;
    return isMaskSpell(message.item) && (!type || type === "spell-cast");
}

/** The caster's Sepulchral Mask, heightened to the rank it was cast at */
function getSpell(caster, { spellUuid = null, rank = null } = {}) {
    const fromUuid = spellUuid ? fromUuidSync(spellUuid) : null;
    const spell = isMaskSpell(fromUuid) ? fromUuid : caster?.itemTypes.spell.find(isMaskSpell);
    if (!spell) return null;
    const castRank = Math.max(rank ?? 0, spell.rank);
    return (castRank !== spell.rank && spell.loadVariant({ castRank })) || spell;
}

function getSpellDC(spell) {
    const statistic = spell.spellcasting?.statistic;
    return statistic?.withRollOptions?.({ item: spell }).dc.value ?? statistic?.dc.value ?? null;
}

/** The immunity that keeps a creature from being affected, if it has one */
function getImmunity(actor) {
    return actor.attributes?.immunities?.find((i) => IMMUNITIES.includes(i.type)) ?? null;
}

/* The aura: applied on casting, or when the spell's effect is dragged from its card */

/** Give the caster Aura: Sepulchral Mask at the rank it was cast at */
async function applyAura(caster, { rank, spellUuid = null, tokenUuid = null }) {
    const aura = await fromUuid(AURA_UUID);
    if (!aura) return ui.notifications.error("Sepulchral Mask: the module's Aura: Sepulchral Mask was not found.");
    const source = aura.toObject();
    source._stats = { ...source._stats, compendiumSource: AURA_UUID };
    source.system.level = { value: Math.max(1, rank ?? 1) };
    source.system.context = effectContext({ origin: caster, token: tokenUuid, item: spellUuid });
    await caster.createEmbeddedDocuments("Item", [source]);
}

/** One mask at a time: a new aura replaces the creature's earlier one, and pf2e's spell effect */
async function removeOtherMasks(aura) {
    const actor = aura.actor;
    const ids = actor.itemTypes.effect
        .filter((e) => e.id !== aura.id && (isAuraEffect(e) || isSystemEffect(e)))
        .map((e) => e.id);
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
}

const JB2A_LIBRARY = "modules/JB2A_DnD5e/Library";
const CAST_ANIMATION = "Generic/Magic_Signs/NecromancyCircleComplete_02_Dark_Green_800x800.webm";
const TURN_ANIMATION = "Cantrip/Toll_The_Dead/TollTheDeadSkullSmoke_01_Regular_Green_400x400.webm";

/** Play the cast animation at the caster, sized to the emanation */
function playCastAnimation(aura) {
    const token = getSceneToken(aura.actor);
    if (!canAnimate() || !token) return;
    const radius = aura.actor.auras?.get(AURA_SLUG)?.radius ?? 5;
    new Sequence()
        .effect()
        .file(`${JB2A_LIBRARY}/${CAST_ANIMATION}`)
        .atLocation(token)
        .size(Math.max(token.width, token.height) + (2 * radius) / 5, { gridUnits: true })
        .belowTokens()
        .fadeIn(300)
        .fadeOut(500)
        .play();
}

/** The mask confronts a creature with its regrets: a skull over it, as its turn starts */
function playTurnAnimation(token) {
    if (!canAnimate() || !token?.object) return;
    new Sequence()
        .effect()
        .file(`${JB2A_LIBRARY}/${TURN_ANIMATION}`)
        .atLocation(token)
        .scaleToObject(1.5)
        .fadeIn(200)
        .fadeOut(400)
        .play();
}

/* Start of turn: "Each enemy [...] that starts its turn in the area takes 1d4 mental damage and must attempt a Will
 * save." The active GM posts a card for each one, with a button to roll the save. */

async function onTurnStart(combat, { combatant = combat.combatant, round = combat.round } = {}) {
    const { actor, token } = combatant ?? {};
    if (!actor?.isOfType("creature") || !token?.parent || combatant.defeated) return;

    for (const centerToken of token.parent.tokens) {
        const wearer = centerToken.actor;
        const aura = centerToken.auras?.get(AURA_SLUG);
        if (!(wearer?.auras?.has(AURA_SLUG) && aura?.containsToken(token))) continue;
        const auraEffect = wearer.itemTypes.effect.find((e) => isAuraEffect(e) && !e.remainingDuration.expired);
        if (!auraEffect) continue;
        const caster = auraEffect.origin ?? wearer;
        if (actor === caster || actor === wearer || !actor.isEnemyOf(caster)) continue;

        // Going back and forth in the turn order doesn't post the card again
        const turn = [combat.id, round, combatant.id, auraEffect.uuid].join(".");
        const posted = game.messages.contents.slice(-50).some((m) => m.flags[MODULE_ID]?.sepulchralMask?.turn === turn);
        if (posted) continue;

        await postTurnCard({ caster, centerToken, auraEffect, target: actor, targetToken: token, turn });
    }
}

async function postTurnCard({ caster, centerToken, auraEffect, target, targetToken, turn }) {
    const speaker = ChatMessage.getSpeaker({ actor: caster, token: centerToken });
    const start = `<strong>Sepulchral Mask</strong> ${esc(target.name)} starts its turn in ${esc(caster.name)}'s emanation`;

    const immunity = getImmunity(target);
    if (immunity) {
        const label = game.i18n.localize(CONFIG.PF2E.immunityTypes?.[immunity.type] ?? immunity.type);
        return ChatMessage.create({
            speaker,
            content: `<p>${start}, but it's immune to ${esc(label.toLowerCase())} effects and is unaffected.</p>`,
            flags: { [MODULE_ID]: { sepulchralMask: { turn } } },
        });
    }

    const spellUuid = auraEffect.system.context?.origin?.item ?? null;
    const spell = getSpell(caster, { spellUuid, rank: auraEffect.level });
    const dc = spell ? getSpellDC(spell) : null;
    if (!spell || !dc) {
        return ChatMessage.create({
            speaker,
            whisper: ChatMessage.getWhisperRecipients("GM"),
            content: `<p>${start}, but ${esc(caster.name)} has no Sepulchral Mask spell to roll its save and damage from.</p>`,
            flags: { [MODULE_ID]: { sepulchralMask: { turn } } },
        });
    }

    const formula = spell.system.damage?.[Object.keys(spell.system.damage)[0]]?.formula;
    const dice = Math.floor((spell.rank - 1) / 2) * 2 + 1;
    const damage = formula === "1d4" ? `${dice}d4 mental damage` : "mental damage";
    await ChatMessage.create({
        speaker,
        content: [
            `<p>${start}: it takes ${damage} (rank ${spell.rank}) and must attempt a Will save.</p>`,
            `<div data-ehb-sepulchral-mask></div>`,
        ].join(""),
        flags: {
            [MODULE_ID]: {
                sepulchralMask: {
                    turn,
                    caster: caster.uuid,
                    casterToken: centerToken.uuid,
                    spell: spell.uuid,
                    rank: spell.rank,
                    dc,
                    target: targetToken.uuid,
                    outcome: null,
                    damage: null,
                    damageApplied: null,
                },
            },
        },
    });
    playTurnAnimation(targetToken);
}

/** Roll the creature's Will save from the turn-start card, against the caster's spell, for everyone to see */
async function rollTurnSave(card) {
    const record = card.flags[MODULE_ID]?.sepulchralMask;
    const targetToken = record?.target ? fromUuidSync(record.target) : null;
    const target = targetToken?.actor;
    const caster = record?.caster ? fromUuidSync(record.caster) : null;
    if (!target || !caster) return ui.notifications.warn("Sepulchral Mask: the creature or caster is gone.");
    if (!target.isOwner) return ui.notifications.warn(`Sepulchral Mask: you can't roll ${target.name}'s save.`);
    const spell = getSpell(caster, { spellUuid: record.spell, rank: record.rank });
    if (!spell) return ui.notifications.warn(`Sepulchral Mask: ${caster.name} no longer has the spell.`);

    await rollPublicSave(target, "will", {
        dc: record.dc,
        item: spell,
        origin: caster,
        token: targetToken,
        identifier: `${SAVE_IDENTIFIER}${card.id}`,
    });
}

/** The logged-in players who own the caster, who roll its damage, though the GM can roll it for them */
function activePlayerOwners(actor) {
    return game.users.contents.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/** pf2e's "Show DCs to players" setting */
function showDCs() {
    return !!game.pf2e?.settings?.metagame?.dcs;
}

/**
 * Roll the spell's damage from the turn-start card: the caster's roll, with pf2e's damage dialog when the user's
 * settings show it (Shift flips that, as on pf2e's own buttons). It's applied once the creature's save is rolled.
 */
async function rollTurnDamage(card, event) {
    const record = card.flags[MODULE_ID]?.sepulchralMask;
    const caster = record?.caster ? fromUuidSync(record.caster) : null;
    const target = record?.target ? fromUuidSync(record.target)?.actor : null;
    if (!caster || !target) return ui.notifications.warn("Sepulchral Mask: the creature or caster is gone.");
    if (!caster.isOwner) return ui.notifications.warn(`Sepulchral Mask: you can't roll ${caster.name}'s damage.`);
    if (record.damage) return ui.notifications.info("Sepulchral Mask: the damage was already rolled.");
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn("Sepulchral Mask: a GM must be logged in to apply the damage.");
    }
    const spell = getSpell(caster, { spellUuid: record.spell, rank: record.rank });
    if (!spell) return ui.notifications.warn(`Sepulchral Mask: ${caster.name} no longer has the spell.`);

    const showDialog = !!game.user.settings?.showDamageDialogs;
    const spellDamage = await spell.getDamage({ skipDialog: event?.shiftKey ? showDialog : !showDialog });
    if (!spellDamage) return;
    const { template, context } = spellDamage;
    const roll = await template.damage.roll.evaluate();
    const casterToken = record.casterToken ? fromUuidSync(record.casterToken) : null;
    const message = await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: caster, token: casterToken }),
        flavor: `<strong>Sepulchral Mask</strong> damage to ${esc(target.name)}, applied for its Will save`,
        flags: {
            // Applied with the save's result, so the card has no buttons to apply it again
            pf2e: { suppressDamageButtons: true, origin: spell.getOriginData() },
            [MODULE_ID]: { sepulchralMaskDamage: { card: card.id, options: [...(context.options ?? [])] } },
        },
    });
    if (!message) return;

    const data = { cardId: card.id, damageMessageId: message.id };
    // Players can't edit the card or the creature, so the active GM records the roll and applies it
    const answer = await askGM("sepulchralMaskDamage", data, { title: "Sepulchral Mask", task: "apply the damage" });
    // The caster's player and the GM can both roll it: the first roll to reach the GM is the one used
    if (answer.ok && answer.result?.recorded === false) {
        ui.notifications.info("Sepulchral Mask: the damage was already rolled, so this roll isn't applied.");
    }
}

/** Record the damage rolled for a turn-start card, and apply it if the save is in. Run by a GM. */
async function resolveDamage({ cardId, damageMessageId }) {
    const card = game.messages.get(cardId);
    const record = card?.flags[MODULE_ID]?.sepulchralMask;
    if (!record || record.damage || !game.messages.get(damageMessageId)) return { recorded: false };
    await card.update({ [`flags.${MODULE_ID}.sepulchralMask.damage`]: damageMessageId });
    await applyTurnDamage(card);
    return { recorded: true };
}

/** Cards whose damage is being applied, so a save and a damage roll arriving together don't both apply it */
const applying = new Set();

/** Once a turn-start card has both its damage and its save, apply the damage for the save's result. Run by a GM. */
async function applyTurnDamage(card) {
    const record = card.flags[MODULE_ID]?.sepulchralMask;
    if (!record?.outcome || !record.damage || record.damageApplied || applying.has(card.id)) return;
    applying.add(card.id);
    try {
        await card.update({ [`flags.${MODULE_ID}.sepulchralMask.damageApplied`]: record.outcome });
        if (record.outcome === "criticalSuccess") return;

        const caster = fromUuidSync(record.caster);
        const targetToken = fromUuidSync(record.target);
        const damageMessage = game.messages.get(record.damage);
        const roll = damageMessage?.rolls[0];
        if (!caster || !targetToken?.actor || !roll) {
            return ChatMessage.create({
                whisper: ChatMessage.getWhisperRecipients("GM"),
                content: `<p><strong>Sepulchral Mask</strong> The damage roll or creature is gone: apply the damage by hand.</p>`,
            });
        }
        const spell = getSpell(caster, { spellUuid: record.spell, rank: record.rank });
        const options = damageMessage.flags[MODULE_ID]?.sepulchralMaskDamage?.options ?? [];
        await applyRoll({
            caster,
            spell,
            target: targetToken.actor,
            targetToken,
            outcome: record.outcome,
            roll,
            options,
        });
    } finally {
        applying.delete(card.id);
    }
}

/* Save results, from the turn-start card or the spell's own card */

/** Apply a rolled damage to the creature for its degree of success, as pf2e's damage buttons do */
async function applyRoll({ caster, spell, target, targetToken, outcome, roll, options }) {
    const multiplier = BASIC_SAVE_MULTIPLIERS[outcome];
    // The caster's roll options, and a copy of the creature that has them
    const messageOptions = [...options];
    const originOptions = messageOptions
        .filter((o) => o.startsWith("self:"))
        .map((o) => o.replace(/^self\b/, "origin"));
    if (target.alliance && caster.alliance) {
        messageOptions.push(`origin:${target.alliance === caster.alliance ? "ally" : "enemy"}`);
    }
    const clone = target.getContextualClone?.(originOptions) ?? target;
    const rollOptions = new Set([
        ...messageOptions.filter((o) => !/^(?:self|target)(?::|$)/.test(o)),
        ...originOptions,
        ...clone.getSelfRollOptions(),
    ]);
    await clone.applyDamage({
        damage: multiplier === 1 ? roll : roll.alter(multiplier, 0),
        token: targetToken,
        item: spell,
        rollOptions,
    });
}

/**
 * Apply or replace the creature's penalty from this save. `key` is the card the save was rolled from, so a reroll
 * replaces its earlier result. Status penalties don't stack, so a longer one the creature already has is kept.
 * "For 1 round" counts from the turn it happened on: the caster's when they Cast the Spell, the creature's own at
 * the start of its turn. pf2e ends the effect at the start of its origin's turn, so that's who it's from.
 */
async function applyPenalty({ target, targetToken, anchor, spell, outcome, total, key }) {
    const penalty = RESULTS[outcome].penalty;
    const existing = target.itemTypes.effect.filter((e) => e.flags[MODULE_ID]?.sepulchralMask?.penalty);
    const replaced = existing.filter((e) => e.flags[MODULE_ID].sepulchralMask.key === key);
    const others = existing.filter((e) => !replaced.includes(e));
    const toDelete = replaced.map((e) => e.id);

    let applied = false;
    const seconds = penalty ? penalty.value * SECONDS[penalty.unit] : 0;
    if (penalty && !others.some((e) => e.remainingDuration.remaining > seconds)) {
        const effect = await fromUuid(PENALTY_UUID);
        if (!effect) {
            ui.notifications.error("Sepulchral Mask: the module's Effect: Sepulchral Mask was not found.");
        } else {
            toDelete.push(...others.map((e) => e.id));
            const source = effect.toObject();
            source._stats = { ...source._stats, compendiumSource: PENALTY_UUID };
            source.system.level = { value: spell.rank };
            source.system.duration = {
                value: penalty.value,
                unit: penalty.unit,
                expiry: "turn-start",
                sustained: false,
            };
            const anchorToken = anchor === target ? targetToken : getSceneToken(anchor, targetToken.parent);
            source.system.context = effectContext({
                origin: anchor,
                token: anchorToken,
                item: spell,
                target: { actor: target, token: targetToken },
                roll: effectRoll(total, outcome),
            });
            source.flags = { ...source.flags, [MODULE_ID]: { sepulchralMask: { penalty: true, key } } };
            applied = source;
        }
    }

    if (toDelete.length > 0) await target.deleteEmbeddedDocuments("Item", toDelete);
    if (applied) await target.createEmbeddedDocuments("Item", [applied]);
    return { applied: !!applied, kept: !!penalty && !applied };
}

/** Apply a save's result. Run by a GM, who can edit every creature and message. */
async function resolveSave(data) {
    const { outcome, total, cardId, fromTurnCard } = data;
    const caster = await fromUuid(data.casterUuid);
    const targetToken = await fromUuid(data.targetTokenUuid);
    const target = targetToken?.actor;
    if (!caster || !target || !RESULTS[outcome]) return;
    const card = cardId ? game.messages.get(cardId) : null;
    // The turn-start card was deleted: the save answers nothing (the spell's own card isn't what it was rolled for)
    if (fromTurnCard && !card) return;
    const record = card?.flags[MODULE_ID]?.sepulchralMask;
    const spell = getSpell(caster, { spellUuid: record?.spell ?? data.spellUuid, rank: record?.rank ?? data.rank });
    if (!spell) return;
    const speaker = ChatMessage.getSpeaker({ actor: caster, token: getSceneToken(caster, targetToken.parent) });
    const name = esc(target.name);
    const label = esc(outcomeLabel(outcome));

    // The turn-start card's damage is applied once; a reroll after that only changes the penalty
    const previous = fromTurnCard ? (record?.outcome ?? null) : null;
    if (previous === outcome) return;
    // A critical success dealt no damage, so a reroll from it can still have the caster's roll applied
    const damagedFor = fromTurnCard && record?.damageApplied !== "criticalSuccess" ? record?.damageApplied : null;
    if (fromTurnCard && card) {
        await card.update({
            [`flags.${MODULE_ID}.sepulchralMask.outcome`]: outcome,
            ...(damagedFor ? {} : { [`flags.${MODULE_ID}.sepulchralMask.damageApplied`]: null }),
        });
    }

    const anchor = fromTurnCard ? target : caster;
    const key = cardId ?? `cast.${caster.uuid}`;
    const { applied, kept } = await applyPenalty({ target, targetToken, anchor, spell, outcome, total, key });
    const post = (text, options = {}) =>
        ChatMessage.create({ speaker, content: `<p><strong>Sepulchral Mask</strong> ${text}</p>`, ...options });

    if (damagedFor) {
        const whisper = ChatMessage.getWhisperRecipients("GM");
        const was = esc(outcomeLabel(damagedFor));
        return post(
            `${name}'s save was rerolled (${label}), so its penalty was updated, but the damage was applied for ` +
                `${was}. Adjust the damage by hand.`,
            { whisper },
        );
    }

    // From the turn-start card, the caster's damage is applied once it's rolled too. Against the spell's own card,
    // it's rolled from the card for every creature in the area, as usual.
    if (fromTurnCard && outcome === "criticalSuccess") return post(`${name} critically succeeds and is unaffected.`);
    if (fromTurnCard && card) await applyTurnDamage(card);

    if (applied) {
        const { text } = RESULTS[outcome].penalty;
        await post(`${name} (${label}) takes a –1 status penalty to Will saves against emotion effects for ${text}.`);
    } else if (kept) {
        await post(`${name} (${label}) already has a longer penalty to Will saves against emotion effects.`);
    }
}

/** A save rolled by this user against Sepulchral Mask: have the active GM apply its result */
async function onSave({
    card = null,
    caster,
    spell,
    targetToken,
    outcome,
    total,
    fromTurnCard = false,
    message = null,
}) {
    if (!caster || !targetToken?.actor || !RESULTS[outcome]) return;
    // Rolled from a turn-start card that's since been deleted (the GM's call): it answers nothing
    if (fromTurnCard && !card) {
        return ui.notifications.warn("Sepulchral Mask: the save's turn card was deleted, so its result isn't applied.");
    }
    // A save against the spell's card answers the caster's latest one, unless PF2e Toolbelt says which
    card ??= game.messages.contents.findLast((m) => isMaskCard(m) && m.actor?.uuid === caster.uuid) ?? null;
    const data = {
        casterUuid: caster.uuid,
        spellUuid: spell?.uuid ?? null,
        rank: spell?.rank ?? null,
        targetTokenUuid: targetToken.uuid,
        outcome,
        total,
        cardId: card?.id ?? null,
        fromTurnCard,
        // Where the GM reads the save again: its message, or (PF2e Toolbelt) the card
        saveMessageId: message?.id ?? null,
    };
    // Players can't edit creatures they don't own, so the active GM applies the result
    await askGM("sepulchralMask", data, { title: "Sepulchral Mask", task: "apply the result" });
}

/** A save message rolled against Sepulchral Mask */
function getSave(message) {
    const context = message.flags.pf2e?.context;
    if (context?.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) return null;
    const spell = message.item;
    if (!isMaskSpell(spell)) return null;
    const caster = (context.origin?.actor && fromUuidSync(context.origin.actor)) || spell.actor;
    const targetToken = message.token ?? getSceneToken(message.actor);
    const identifier = typeof context.identifier === "string" ? context.identifier : "";
    const cardId = identifier.startsWith(SAVE_IDENTIFIER) ? identifier.slice(SAVE_IDENTIFIER.length) : null;
    const card = cardId ? (game.messages.get(cardId) ?? null) : null;
    const save = { caster, spell, targetToken, outcome: context.outcome, total: message.rolls[0]?.total, message };
    return cardId ? { ...save, card, fromTurnCard: true } : save;
}

hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId)) return;

    // pf2e 8.5 marks a spell that was cast, rather than posted to chat: put the mask on the caster
    if (isMaskCard(message) && message.actor && isSpellCast(message)) {
        const rank = message.flags.pf2e.origin?.castRank ?? message.item.rank;
        const cast = { rank, spellUuid: message.item.uuid, tokenUuid: message.token?.uuid ?? null };
        return void applyAura(message.actor, cast).catch(log);
    }

    const save = getSave(message);
    if (save) onSave(save).catch(log);
});

// PF2e Toolbelt's Target Helper, when that module is active, rolls saves without save messages and calls this hook
// for each one instead, with the spell's card and the target's token
hooks.on("pf2e-toolbelt.rollSave", ({ message, target, data }) => {
    if (!message || !isMaskCard(message) || !target) return;
    const save = { card: message, caster: message.actor, spell: message.item, targetToken: target };
    onSave({ ...save, outcome: data?.success, total: data?.value }).catch(log);
});

/** A button for the turn-start card, or a note of where it stands */
function cardControl(html, { label, icon, onClick } = {}) {
    return onClick ? cardButton({ icon, label, onClick, log }) : cardNote(html);
}

/**
 * The turn-start card's controls, from where it stands: a Roll Damage button for whoever owns the caster (the GM's says
 * whom it's rolled for while a player who owns the caster is logged in) and a Will Save button for whoever can roll the
 * creature's save. Others see what it's waiting on. Players see the DC of a player's caster, or when pf2e shows DCs.
 */
function renderTurnCard(message, html) {
    const record = message.flags[MODULE_ID]?.sepulchralMask;
    const content = html?.querySelector?.(".message-content") ?? html;
    if (!record?.target || !content?.querySelector) return;
    // Cards from 1.16.0 have their save button in their content
    content.querySelector("button[data-ehb-sepulchral-mask-save]")?.remove();
    let controls = content.querySelector("[data-ehb-sepulchral-mask]");
    if (!controls) {
        controls = document.createElement("div");
        controls.dataset.ehbSepulchralMask = "";
        content.append(controls);
    }

    const caster = fromUuidSync(record.caster);
    const target = fromUuidSync(record.target)?.actor;
    const casterName = esc(caster?.name ?? "the caster");
    const targetName = esc(target?.name ?? "the creature");
    const outcome = record.outcome ? esc(outcomeLabel(record.outcome)) : null;
    const items = [];

    if (record.damageApplied && record.damageApplied !== "criticalSuccess") {
        const multiplier = BASIC_SAVE_MULTIPLIERS[record.damageApplied];
        const amount = { 0.5: "Half", 1: "Full", 2: "Double" }[multiplier];
        items.push(cardControl(`${amount} damage applied (${esc(outcomeLabel(record.damageApplied))}).`));
    } else if (record.outcome === "criticalSuccess") {
        // Unaffected: no damage to roll
    } else if (record.damage) {
        items.push(cardControl(`Damage rolled: it's applied once ${targetName}'s Will save is rolled.`));
    } else if (caster?.isOwner) {
        // The GM can roll it for a player who's logged in but away; the first roll is the one used
        const players = game.user.isGM ? activePlayerOwners(caster) : [];
        const forWhom = players.length > 0 ? ` for ${esc(players.map((u) => u.name).join(" or "))}` : "";
        const label = `Roll Damage${forWhom}: ${targetName}`;
        items.push(cardControl(null, { label, icon: "fa-dice", onClick: (event) => rollTurnDamage(message, event) }));
    } else {
        items.push(cardControl(`Waiting for ${casterName}'s damage roll.`));
    }

    if (outcome) {
        items.push(cardControl(`Will save: ${outcome}.`));
    } else if (target?.isOwner) {
        const dcShown = game.user.isGM || showDCs() || !!caster?.hasPlayerOwner;
        const label = `Will Save${dcShown ? ` DC ${record.dc}` : ""}: ${targetName}`;
        items.push(cardControl(null, { label, icon: "fa-dice-d20", onClick: () => rollTurnSave(message) }));
    } else {
        items.push(cardControl(`Waiting for ${targetName}'s Will save.`));
    }
    controls.replaceChildren(...items);
}

hooks.on("renderChatMessageHTML", (message, html) => renderTurnCard(message, html));

hooks.on("createItem", (item, options, userId) => {
    if (!createdHere(item, options, userId) || !item.actor) return;
    // pf2e's spell effect, dragged from the spell's card: make it the aura, at the rank and with the origin it has
    if (isSystemEffect(item)) {
        const origin = item.system.context?.origin;
        const cast = { rank: item.level, spellUuid: origin?.item ?? null, tokenUuid: origin?.token ?? null };
        return void applyAura(item.actor, cast).catch(log);
    }
    if (isAuraEffect(item)) {
        playCastAnimation(item);
        removeOtherMasks(item).catch(log);
    }
});

hooks.onTurnStart(({ combat, combatant, round }) => onTurnStart(combat, { combatant, round }));

/** A turn-start card, made by the GM's session */
function turnCard(cardId) {
    const card = typeof cardId === "string" ? game.messages.get(cardId) : null;
    const record = card?.flags[MODULE_ID]?.sepulchralMask;
    return record && card.author?.isGM ? { card, record } : null;
}

/**
 * A player's save against the mask: the outcome is read from their save's message (or PF2e Toolbelt's card), against
 * that caster, from the turn-start card it names
 */
async function checkSave(data, sender) {
    const targetToken = typeof data.targetTokenUuid === "string" ? await fromUuid(data.targetTokenUuid) : null;
    if (!targetToken?.actor) refuse("the creature is gone");
    let save;
    if (data.saveMessageId) {
        const message = reportedSaveMessage(data.saveMessageId, sender);
        save = getSave(message);
        if (!save) refuse("that isn't a save against Sepulchral Mask");
        if (message.actor.uuid !== targetToken.actor.uuid) refuse(`the save isn't ${targetToken.name}'s`);
    } else {
        const card = game.messages.get(data.cardId);
        if (!card || !isMaskCard(card)) refuse("that isn't a Sepulchral Mask card");
        save = { caster: card.actor, spell: card.item, card, ...reportedToolbeltSave(card, targetToken, sender) };
    }
    if (!save.caster || save.caster.uuid !== data.casterUuid) refuse("the save isn't against that caster");
    const fromTurnCard = !!save.fromTurnCard;
    let cardId = save.card?.id ?? null;
    if (fromTurnCard) {
        if (!save.card || !turnCard(cardId)) refuse("the save's turn card is gone");
    } else if (data.cardId) {
        // The caster's latest card, which the player's client found
        const card = game.messages.get(data.cardId);
        if (!card || !isMaskCard(card) || card.actor?.uuid !== save.caster.uuid) refuse("that isn't the caster's card");
        cardId = card.id;
    }
    const spell = save.spell ?? null;
    return {
        ...data,
        cardId,
        fromTurnCard,
        outcome: save.outcome,
        total: save.total,
        spellUuid: spell?.uuid ?? null,
        rank: spell?.rank ?? null,
    };
}

/** A player's damage roll for a turn-start card: rolled by them, for a caster they own, from that card */
function checkDamage({ cardId, damageMessageId }, sender) {
    const turn = turnCard(cardId);
    if (!turn) refuse("that isn't a Sepulchral Mask turn card");
    const caster = turn.record.caster ? fromUuidSync(turn.record.caster) : null;
    if (!caster || !owns(sender, caster)) refuse(`${sender.name} doesn't own the caster`);
    const message = typeof damageMessageId === "string" ? game.messages.get(damageMessageId) : null;
    const rolled = message?.flags[MODULE_ID]?.sepulchralMaskDamage;
    if (!message || !isAuthor(message, sender) || rolled?.card !== cardId)
        refuse("the damage wasn't rolled for that card");
    return { cardId, damageMessageId };
}

onGMRequest("sepulchralMask", (data) => resolveSave(data), { check: checkSave });
onGMRequest("sepulchralMaskDamage", (data) => resolveDamage(data), { check: checkDamage });
export { resolveDamage };
