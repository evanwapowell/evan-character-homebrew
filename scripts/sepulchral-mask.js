/**
 * Sepulchral Mask (psychopomp sorcerer): "You manifest a supernatural funerary mask, granting you a +1 status bonus to
 * Will saving throws against emotion effects for 1 minute. [...] Each enemy in the area when you Cast the Spell or that
 * starts its turn in the area takes 1d4 mental damage and must attempt a Will save." pf2e's spell effect only gives
 * the bonus. This module's Aura: Sepulchral Mask adds the emanation, applied on casting (pf2e 8.x) or when the spell's
 * effect is dragged from its card. At the start of each enemy's turn in the emanation, a card is posted for its Will
 * save, and the save's result is applied: the damage, and on a failure the –1 status penalty to Will saves against
 * emotion effects (Effect: Sepulchral Mask). Failed saves against the spell's own card get the penalty too; their
 * damage is rolled once from the card for every creature in the area, as usual.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** This module's Aura: Sepulchral Mask, for the caster, and Effect: Sepulchral Mask, the penalty on a failed save */
const AURA_UUID = `${PACK}.JZzkqIbry9lR8y0P`;
const PENALTY_UUID = `${PACK}.GOsDZYg9DXFPhzwg`;
/** IDs of pf2e's Sepulchral Mask spell and Spell Effect: Sepulchral Mask, the same in every pf2e version */
const SPELL_ID = "3mINzPzup2m9qzFU";
const SYSTEM_EFFECT_ID = "TER4qOsYPTszhhDG";
const AURA_SLUG = "sepulchral-mask";
/** pf2e 8.x adds this roll option to a spell's card when it's cast, rather than only posted to chat */
const CAST_OPTION = "origin:action:slug:cast-a-spell";
/** Saves rolled from this module's turn-start card carry this identifier, followed by the card's ID */
const SAVE_IDENTIFIER = "sepulchral-mask:";
/** "Visual" and "mental": a creature immune to either is unaffected. Blinded creatures are immune to visual effects. */
const IMMUNITIES = ["mental", "visual", "emotion"];
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const RESULTS = {
    criticalSuccess: { multiplier: 0, text: "is unaffected" },
    success: { multiplier: 0.5, text: "takes half damage" },
    failure: { multiplier: 1, text: "takes full damage", penalty: { value: 1, unit: "rounds", text: "1 round" } },
    criticalFailure: {
        multiplier: 2,
        text: "takes double damage",
        penalty: { value: 1, unit: "minutes", text: "1 minute" },
    },
};
const SECONDS = { rounds: 6, minutes: 60 };

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | Sepulchral Mask`, error);
const outcomeLabel = (outcome) => game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));

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

function getSceneToken(actor, scene = canvas.scene) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === scene) ?? null;
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
    source.system.context = {
        origin: { actor: caster.uuid, token: tokenUuid, item: spellUuid, spellcasting: null, rollOptions: [] },
        target: null,
        roll: null,
    };
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

function canAnimate() {
    return !!(game.modules.get("sequencer")?.active && game.modules.get("JB2A_DnD5e")?.active);
}

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

async function onTurnStart(combat) {
    const combatant = combat.combatant;
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
        const turn = [combat.id, combat.round, combatant.id, auraEffect.uuid].join(".");
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
            `<button type="button" data-ehb-sepulchral-mask-save>`,
            `<i class="fa-solid fa-dice-d20"></i> Will Save DC ${dc}: ${esc(target.name)}</button>`,
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
                },
            },
        },
    });
    playTurnAnimation(targetToken);
}

/** Roll the creature's Will save from the turn-start card, against the caster's spell */
async function rollTurnSave(card) {
    const record = card.flags[MODULE_ID]?.sepulchralMask;
    const targetToken = record?.target ? fromUuidSync(record.target) : null;
    const target = targetToken?.actor;
    const caster = record?.caster ? fromUuidSync(record.caster) : null;
    if (!target || !caster) return ui.notifications.warn("Sepulchral Mask: the creature or caster is gone.");
    if (!target.isOwner) return ui.notifications.warn(`Sepulchral Mask: you can't roll ${target.name}'s save.`);
    const spell = getSpell(caster, { spellUuid: record.spell, rank: record.rank });
    if (!spell) return ui.notifications.warn(`Sepulchral Mask: ${caster.name} no longer has the spell.`);

    await target.saves?.will?.roll({
        dc: { value: record.dc },
        item: spell,
        origin: caster,
        token: targetToken,
        identifier: `${SAVE_IDENTIFIER}${card.id}`,
    });
}

/* Save results, from the turn-start card or the spell's own card */

/** Roll the spell's damage, post it, and apply it to the creature for its degree of success */
async function applyDamage({ caster, speaker, spell, target, targetToken, outcome }) {
    const { multiplier, text } = RESULTS[outcome];
    const spellDamage = await spell.getDamage({ skipDialog: true });
    if (!spellDamage) return false;
    const { template, context } = spellDamage;
    const roll = await template.damage.roll.evaluate();
    await roll.toMessage({
        speaker,
        flavor: `<strong>Sepulchral Mask</strong> damage to ${esc(target.name)} (${esc(outcomeLabel(outcome))}: ${text.replace(/^takes /, "")}, applied)`,
        // Applied below, so the card has no buttons to apply it again
        flags: { pf2e: { suppressDamageButtons: true, origin: spell.getOriginData() } },
    });

    // As pf2e's damage buttons do: the caster's roll options, and a copy of the creature that has them
    const messageOptions = [...(context.options ?? [])];
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
    return true;
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
            source.system.context = {
                origin: {
                    actor: anchor.uuid,
                    token: anchorToken?.uuid ?? null,
                    item: spell.uuid,
                    spellcasting: null,
                    rollOptions: [],
                },
                target: { actor: target.uuid, token: targetToken.uuid },
                roll: Number.isFinite(total) ? { total, degreeOfSuccess: OUTCOMES.indexOf(outcome) } : null,
            };
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
    const record = card?.flags[MODULE_ID]?.sepulchralMask;
    const spell = getSpell(caster, { spellUuid: record?.spell ?? data.spellUuid, rank: record?.rank ?? data.rank });
    if (!spell) return;
    const speaker = ChatMessage.getSpeaker({ actor: caster, token: getSceneToken(caster, targetToken.parent) });
    const name = esc(target.name);
    const label = esc(outcomeLabel(outcome));

    // The turn-start card's damage is applied once; a reroll only changes the penalty
    const previous = fromTurnCard ? (record?.outcome ?? null) : null;
    if (previous === outcome) return;
    if (fromTurnCard && card) await card.update({ [`flags.${MODULE_ID}.sepulchralMask.outcome`]: outcome });

    const anchor = fromTurnCard ? target : caster;
    const key = cardId ?? `cast.${caster.uuid}`;
    const { applied, kept } = await applyPenalty({ target, targetToken, anchor, spell, outcome, total, key });
    const post = (text, options = {}) =>
        ChatMessage.create({ speaker, content: `<p><strong>Sepulchral Mask</strong> ${text}</p>`, ...options });

    if (previous) {
        const whisper = ChatMessage.getWhisperRecipients("GM");
        const was = esc(outcomeLabel(previous));
        return post(
            `${name}'s save was rerolled (${label}), so its penalty was updated, but the damage was applied for ` +
                `${was}. Adjust the damage by hand.`,
            { whisper },
        );
    }

    // From the turn-start card, the damage is applied here. Against the spell's own card, it's rolled from the card
    // for every creature in the area, as usual.
    if (fromTurnCard && outcome === "criticalSuccess") return post(`${name} critically succeeds and is unaffected.`);
    if (fromTurnCard) await applyDamage({ caster, speaker, spell, target, targetToken, outcome });

    if (applied) {
        const { text } = RESULTS[outcome].penalty;
        await post(`${name} (${label}) takes a –1 status penalty to Will saves against emotion effects for ${text}.`);
    } else if (kept) {
        await post(`${name} (${label}) already has a longer penalty to Will saves against emotion effects.`);
    }
}

/** A save rolled by this user against Sepulchral Mask: have the active GM apply its result */
async function onSave({ card = null, caster, spell, targetToken, outcome, total, fromTurnCard = false }) {
    if (!caster || !targetToken?.actor || !RESULTS[outcome]) return;
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
    };
    if (game.user.isGM) return resolveSave(data);
    if (!game.users.activeGM)
        return ui.notifications.warn("Sepulchral Mask: a GM must be logged in to apply the result.");
    // Players can't edit creatures they don't own, so the active GM applies the result
    game.socket.emit(SOCKET, { action: "sepulchralMask", ...data });
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
    const save = { caster, spell, targetToken, outcome: context.outcome, total: message.rolls[0]?.total };
    return cardId ? { ...save, card, fromTurnCard: true } : save;
}

Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id) return;

    // pf2e 8.x marks a spell that was cast, rather than posted to chat: put the mask on the caster
    const origin = message.flags.pf2e?.origin;
    if (isMaskCard(message) && message.actor && origin?.rollOptions?.includes(CAST_OPTION)) {
        const rank = origin.castRank ?? message.item.rank;
        const options = { rank, spellUuid: message.item.uuid, tokenUuid: message.token?.uuid ?? null };
        return void applyAura(message.actor, options).catch(log);
    }

    const save = getSave(message);
    if (save) onSave(save).catch(log);
});

// PF2e Toolbelt's Target Helper, when that module is active, rolls saves without save messages and calls this hook
// for each one instead, with the spell's card and the target's token
Hooks.on("pf2e-toolbelt.rollSave", ({ message, target, data }) => {
    if (!message || !isMaskCard(message) || !target) return;
    const save = { card: message, caster: message.actor, spell: message.item, targetToken: target };
    onSave({ ...save, outcome: data?.success, total: data?.value }).catch(log);
});

// The turn-start card's save button, for users who can roll the creature's save; others see who it's waiting on
Hooks.on("renderChatMessageHTML", (message, html) => {
    const record = message.flags[MODULE_ID]?.sepulchralMask;
    const button = html?.querySelector?.("button[data-ehb-sepulchral-mask-save]");
    if (!record?.target || !button) return;

    const target = fromUuidSync(record.target)?.actor;
    if (record.outcome) {
        const result = document.createElement("p");
        result.innerHTML = `<em>Will save: ${esc(outcomeLabel(record.outcome))} (applied)</em>`;
        return void button.replaceWith(result);
    }
    if (!target?.isOwner) {
        const waiting = document.createElement("p");
        waiting.innerHTML = `<em>Waiting for ${esc(target?.name ?? "the creature")}'s Will save.</em>`;
        return void button.replaceWith(waiting);
    }
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        rollTurnSave(message).catch(log);
    });
});

Hooks.on("createItem", (item, _options, userId) => {
    if (userId !== game.user.id || !item.actor) return;
    // pf2e's spell effect, dragged from the spell's card: make it the aura, at the rank and with the origin it has
    if (isSystemEffect(item)) {
        const origin = item.system.context?.origin;
        const options = { rank: item.level, spellUuid: origin?.item ?? null, tokenUuid: origin?.token ?? null };
        return void applyAura(item.actor, options).catch(log);
    }
    if (isAuraEffect(item)) {
        playCastAnimation(item);
        removeOtherMasks(item).catch(log);
    }
});

Hooks.on("updateCombat", (combat, changed) => {
    if (game.user !== game.users.activeGM) return;
    if (!("turn" in changed || "round" in changed) || !combat.started || !combat.combatant) return;
    // Going back through the turn order doesn't start a turn
    const previous = combat.previous;
    if (previous?.round !== null && previous?.round !== undefined) {
        if (combat.round < previous.round || (combat.round === previous.round && combat.turn < previous.turn)) return;
    }
    onTurnStart(combat).catch(log);
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "sepulchralMask" || game.user !== game.users.activeGM) return;
        await resolveSave(data).catch(log);
    });
});
