/**
 * Rallying Charge (Marshal): "You Stride up to your Speed and make a melee Strike. If your Strike hits and damages an
 * enemy, each ally within 60 feet who saw you hit gains temporary Hit Points equal to your Charisma modifier. These
 * temporary Hit Points last until the start of your next turn."
 *
 * pf2e has Effect: Rallying Charge (Marshal), which grants its origin's Charisma modifier as temporary Hit Points, but
 * nothing hands it out, and dragged from the feat's card it has no origin. Here, once the marshal has used Rallying
 * Charge (posted it to chat from their sheet), their next Strike is the charge's: if it's a melee Strike that hits and
 * its damage is rolled against an enemy (or with no target), each ally within 60 feet of the marshal gets the effect,
 * with the marshal as its origin, so it grants their Charisma modifier and ends at the start of their next turn. An
 * ally sees the hit unless it's blinded or unconscious, or a wall that blocks sight is in the way. A ranged Strike, a
 * miss, or the end of the marshal's turn spends the charge with no effect.
 */

import { canAnimate, createdHere, featureHooks, guardApi, isActiveGM } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("rallyingCharge");
const SOCKET = `module.${MODULE_ID}`;
/** IDs of pf2e's Rallying Charge (Marshal) and Effect: Rallying Charge (Marshal), the same in every pf2e version */
const FEAT_ID = "df4cBV3qZn3qNUmP";
const FEAT_SLUG = "rallying-charge-marshal";
const EFFECT_ID = "wjNNHgX6ceKLbn8Q";
const EFFECT_UUID = `Compendium.pf2e.feat-effects.Item.${EFFECT_ID}`;
const EFFECT_SLUG = "effect-rallying-charge-marshal";
const TITLE = "Rallying Charge";
/** Allies this many feet from the marshal see the hit */
const RANGE = 60;
const HITS = ["success", "criticalSuccess"];
/** How far back in chat a charge's card is looked for, and how long one lasts out of combat */
const LOOKBACK = 50;
const OUT_OF_COMBAT_MS = 5 * 60 * 1000;

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | Rallying Charge`, error);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));
const slugOf = (item) => item?.slug ?? game.pf2e.system.sluggify(item?.name ?? "");
const hasAny = (list, values) => values.some((value) => (list ?? []).includes(value));

function isChargeFeat(item) {
    return ["feat", "action"].includes(item?.type) && (endsWithId(item, FEAT_ID) || slugOf(item) === FEAT_SLUG);
}

function isChargeEffect(item) {
    return item?.type === "effect" && (endsWithId(item, EFFECT_ID) || slugOf(item) === EFFECT_SLUG);
}

/** The feat's card, posted when the marshal uses it, rather than a roll */
function isChargeCard(message) {
    return message.rolls.length === 0 && !message.flags.pf2e?.context && isChargeFeat(message.item);
}

/** A Strike's attack roll, melee or ranged */
function isStrikeAttack(context) {
    if (context?.type !== "attack-roll") return false;
    return (
        (context.domains ?? []).includes("strike-attack-roll") ||
        hasAny(context.options, ["action:strike", "self:action:slug:strike"])
    );
}

function isMeleeStrikeAttack(context) {
    return (
        isStrikeAttack(context) &&
        ((context.domains ?? []).includes("melee-strike-attack-roll") || (context.options ?? []).includes("melee"))
    );
}

/** A Strike's damage roll, melee or ranged, for a hit or a critical hit */
function isStrikeDamage(context) {
    if (context?.type !== "damage-roll" || context.sourceType !== "attack" || !HITS.includes(context.outcome)) {
        return false;
    }
    return (
        hasAny(context.domains, ["strike-damage", "melee-strike-damage", "ranged-strike-damage"]) ||
        hasAny(context.options, ["action:strike", "self:action:slug:strike"])
    );
}

function isMeleeStrikeDamage(context) {
    return (
        isStrikeDamage(context) &&
        ((context.domains ?? []).includes("melee-strike-damage") || (context.options ?? []).includes("melee"))
    );
}

/** Whether a message was made by this creature: the same token, or the same actor when there's no token */
function bySpeaker(message, speaker) {
    if (message.speaker.actor !== speaker.actor) return false;
    return !speaker.token || !message.speaker.token || message.speaker.token === speaker.token;
}

/** The combat turn a card was posted in, recorded when it's created */
function getTurn() {
    const combat = game.combat;
    return combat?.started ? { combat: combat.id, round: combat.round, turn: combat.turn } : null;
}

/** Cards already spent on a hit, in case this client couldn't flag them */
const spent = new Set();

/** Whether the charge's card is still good: not spent, and posted in this combat turn (or recently, out of combat) */
function isActive(card, damageMessage) {
    const data = card.flags[MODULE_ID]?.rallyingCharge ?? {};
    if (data.spent || spent.has(card.id)) return false;
    const turn = getTurn();
    if (data.turn || turn) {
        return !!data.turn && !!turn && ["combat", "round", "turn"].every((key) => data.turn[key] === turn[key]);
    }
    return (damageMessage.timestamp ?? Date.now()) - (card.timestamp ?? 0) < OUT_OF_COMBAT_MS;
}

/**
 * The card of the Rallying Charge that a Strike's damage roll belongs to, if any. Going back through the marshal's own
 * messages, the charge's card has to come before any other Strike: a Strike between them is the charge's, and must be
 * a melee Strike that didn't miss (with no target there's no outcome, and rolling damage means it hit).
 */
function findCharge(damageMessage) {
    const messages = game.messages.contents;
    let index = messages.findIndex((m) => m.id === damageMessage.id);
    if (index < 0) index = messages.length;
    let strike = null;
    for (let i = index - 1; i >= Math.max(0, index - LOOKBACK); i--) {
        const message = messages[i];
        if (!bySpeaker(message, damageMessage.speaker)) continue;
        if (isChargeCard(message)) return isActive(message, damageMessage) ? message : null;
        const context = message.flags.pf2e?.context;
        // Another Strike's damage came first, so this one isn't the charge's
        if (isStrikeDamage(context)) return null;
        if (isStrikeAttack(context)) {
            if (strike || !isMeleeStrikeAttack(context)) return null;
            if (context.outcome && !HITS.includes(context.outcome)) return null;
            strike = message;
        }
    }
    return null;
}

/** Allies of the marshal within 60 feet who can see them: on the viewed scene, so their tokens can be measured */
function getRecipients(marshalToken) {
    const marshal = marshalToken.actor;
    const origin = marshalToken.object;
    if (!marshal || !origin) return [];
    const recipients = new Map();
    for (const token of marshalToken.parent.tokens) {
        const actor = token.actor;
        if (!actor || !token.object || token === marshalToken || token.hidden) continue;
        if (!actor.isOfType?.("character", "npc", "familiar") || actor === marshal || !actor.isAllyOf(marshal))
            continue;
        if (recipients.has(actor.uuid) || actor.isDead || actor.hasCondition("blinded", "unconscious")) continue;
        if (origin.distanceTo(token.object) > RANGE) continue;
        const sight = CONFIG.Canvas.polygonBackends?.sight;
        const blocked = sight?.testCollision(token.object.center, origin.center, { type: "sight", mode: "any" });
        if (!blocked) recipients.set(actor.uuid, token);
    }
    return [...recipients.values()];
}

const JB2A_RALLY = "modules/JB2A_DnD5e/Library/1st_Level/Bless/Bless_01_Regular_Yellow_Intro_400x400.webm";

function playRallyAnimation(tokens) {
    if (!canAnimate()) return;
    const sequence = new Sequence();
    for (const token of tokens.filter((t) => t?.object)) {
        sequence.effect().file(JB2A_RALLY).atLocation(token).scaleToObject(1.6).fadeIn(200).fadeOut(400);
    }
    sequence.play();
}

/**
 * The charge hit: post who gains the temporary Hit Points, and give them the effect, or have the active GM do it for
 * allies this user doesn't own
 */
async function rally({ marshalToken, feat = null, target = null, card = null }) {
    const marshal = marshalToken.actor;
    if (card) {
        spent.add(card.id);
        if (card.canUserModify(game.user, "update")) {
            await card.update({ [`flags.${MODULE_ID}.rallyingCharge.spent`]: true });
        }
    }
    if (canvas.scene?.id !== marshalToken.parent.id) {
        return ui.notifications.warn(`${TITLE}: view ${marshal.name}'s scene to find the allies who saw the hit.`);
    }

    const recipients = getRecipients(marshalToken);
    const charisma = Number(marshal.abilities?.cha?.mod ?? marshal.system.abilities?.cha?.mod ?? 0);
    const hit = target
        ? `${esc(marshal.name)}'s charge hits ${esc(target.name)}`
        : `${esc(marshal.name)}'s charge hits`;
    const names = recipients.map((t) => esc(t.name)).join(", ");
    const content =
        charisma <= 0
            ? `<p><strong>${TITLE}</strong> ${hit}, but their Charisma modifier grants no temporary Hit Points.</p>`
            : recipients.length === 0
              ? `<p><strong>${TITLE}</strong> ${hit}, but no allies within ${RANGE} feet saw it.</p>`
              : [
                    `<p><strong>${TITLE}</strong> ${hit}. Each ally within ${RANGE} feet who saw it gains ${charisma}`,
                    ` temporary Hit Points until the start of ${esc(marshal.name)}'s next turn: ${names}.</p>`,
                ].join("");
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: marshal, token: marshalToken }), content });
    if (charisma <= 0 || recipients.length === 0) return;

    const data = {
        marshalUuid: marshal.uuid,
        marshalTokenUuid: marshalToken.uuid,
        featUuid: feat?.uuid ?? null,
        recipients: recipients.map((t) => t.uuid),
    };
    playRallyAnimation(recipients);
    if (recipients.every((t) => t.actor.isOwner)) return applyEffects(data);
    if (game.users.activeGM) return game.socket.emit(SOCKET, { action: "rallyingCharge", ...data });

    const owned = recipients.filter((t) => t.actor.isOwner);
    const others = recipients.filter((t) => !t.actor.isOwner);
    ui.notifications.warn(
        `${TITLE}: a GM must be logged in to give the temporary Hit Points to ${others.map((t) => t.name).join(", ")}.`,
    );
    if (owned.length > 0) await applyEffects({ ...data, recipients: owned.map((t) => t.uuid) });
}

/** Give each ally the effect, with the marshal as its origin: it grants their Charisma modifier and lasts their turn */
async function applyEffects({ marshalUuid, marshalTokenUuid, featUuid, recipients }) {
    const marshal = fromUuidSync(marshalUuid);
    const effect = await fromUuid(EFFECT_UUID);
    if (!marshal || !effect) {
        return ui.notifications.error(`${TITLE}: pf2e's Effect: Rallying Charge (Marshal) was not found.`);
    }
    const source = effect.toObject();
    source._stats = { ...source._stats, compendiumSource: EFFECT_UUID };
    source.system.context = {
        origin: {
            actor: marshal.uuid,
            token: marshalTokenUuid ?? null,
            item: featUuid ?? null,
            spellcasting: null,
            rollOptions: [],
        },
        target: null,
        roll: null,
    };

    for (const uuid of recipients) {
        const actor = fromUuidSync(uuid)?.actor;
        if (!actor) continue;
        // A new charge from the same marshal replaces the last one's, refreshing its temporary Hit Points
        const old = actor.itemTypes.effect
            .filter((e) => isChargeEffect(e) && e.system.context?.origin?.actor === marshal.uuid)
            .map((e) => e.id);
        if (old.length > 0) await actor.deleteEmbeddedDocuments("Item", old);
        await actor.createEmbeddedDocuments("Item", [foundry.utils.deepClone(source)]);
    }
}

function getMarshalToken(message) {
    const actor = message.actor;
    return message.token ?? actor?.getActiveTokens(true, true).find((t) => t.parent === canvas.scene) ?? null;
}

async function onStrikeDamage(message) {
    const card = findCharge(message);
    if (!card) return;
    const marshalToken = getMarshalToken(message);
    const marshal = marshalToken?.actor;
    if (!marshal) return;
    // The Strike has to damage an enemy, not an ally
    const target = message.target?.actor ?? null;
    if (target && (target === marshal || target.isAllyOf(marshal))) return;
    await rally({ marshalToken, feat: card.item, target, card });
}

hooks.on("preCreateChatMessage", (message) => {
    // Remember the combat turn the charge was used in: it's spent at the end of the marshal's turn
    if (!isChargeCard(message)) return;
    message.updateSource({ [`flags.${MODULE_ID}.rallyingCharge`]: { turn: getTurn(), spent: false } });
});

hooks.on("createChatMessage", (message, options, userId) => {
    // Every client sees the damage roll, so only the session that rolled it acts
    if (!createdHere(message, options, userId) || !isMeleeStrikeDamage(message.flags.pf2e?.context)) return;
    onStrikeDamage(message).catch(log);
});

Hooks.once("init", () => {
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        /** For a macro: rally the allies of the controlled marshal (or the given token), as if their charge hit */
        rallyingCharge: guardApi(
            "rallyingCharge",
            async ({ token = canvas.tokens.controlled[0]?.document ?? null } = {}) => {
                const marshalToken = token?.document ?? token;
                if (!marshalToken?.actor) return ui.notifications.warn(`${TITLE}: select the marshal's token.`);
                const feat = marshalToken.actor.items.find(isChargeFeat) ?? null;
                await rally({ marshalToken, feat }).catch(log);
            },
        ),
    };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "rallyingCharge" || !isActiveGM()) return;
        await applyEffects(data).catch(log);
    });
});
