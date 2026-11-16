/**
 * Saves a player's client reports to the GM's session, read again where they were rolled: pf2e's save message, or PF2e
 * Toolbelt's card. Target Helper rolls saves without save messages and keeps each target's result on the card it was
 * rolled from (`flags.pf2e-toolbelt.targetHelper.saveVariants.<variant>.saves.<token ID>`: `success`, the degree of
 * success, and `value`, the total).
 */

import { isAuthor, owns, refuse } from "./gm.js";

const TOOLBELT_ID = "pf2e-toolbelt";
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** A token's save on a card, as Target Helper recorded it (its latest, when it was rerolled): { outcome, total } */
function toolbeltSave(card, token) {
    const variants = card?.flags?.[TOOLBELT_ID]?.targetHelper?.saveVariants;
    if (!variants || typeof variants !== "object" || !token?.id) return null;
    const save = Object.values(variants)
        .map((variant) => variant?.saves?.[token.id])
        .findLast((s) => OUTCOMES.includes(s?.success));
    if (!save) return null;
    const total = Number(save.value);
    return { outcome: save.success, total: Number.isFinite(total) ? total : null };
}

/**
 * The save message a player says they rolled: theirs, for a creature they own, a saving throw with a degree of
 * success. Refuses otherwise.
 */
function reportedSaveMessage(messageId, sender) {
    const message = typeof messageId === "string" ? game.messages.get(messageId) : null;
    const context = message?.flags.pf2e?.context;
    if (!message || !isAuthor(message, sender)) refuse("the save isn't theirs, or isn't in chat");
    if (context?.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) refuse("that isn't a save");
    if (!message.actor || !owns(sender, message.actor)) refuse(`${sender.name} doesn't own the creature that saved`);
    return message;
}

/** A save a player says Target Helper rolled on a card, for a creature they own: { outcome, total }. Refuses otherwise. */
function reportedToolbeltSave(card, token, sender) {
    if (!token?.actor || !owns(sender, token.actor)) refuse(`${sender.name} doesn't own the creature that saved`);
    const save = toolbeltSave(card, token);
    if (!save) refuse(`the card has no save by ${token.name}`);
    return save;
}

export { reportedSaveMessage, reportedToolbeltSave, toolbeltSave };
