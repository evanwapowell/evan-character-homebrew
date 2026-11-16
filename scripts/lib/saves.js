/**
 * Saves: their degrees of success, rolling one from a module's card, and the saves a player's client reports to the
 * GM's session, read again where they were rolled: pf2e's save message, or PF2e Toolbelt's card. Target Helper rolls
 * saves without save messages and keeps each target's result on the card it was rolled from
 * (`flags.pf2e-toolbelt.targetHelper.saveVariants.<variant>.saves.<token ID>`: `success`, the degree of success, and
 * `value`, the total).
 *
 * Rolled from a module's card, a save carries an identifier (the feature's prefix and the card's ID), which the
 * feature reads from the save's message to find its card.
 */

import { isAuthor, owns, refuse } from "./gm.js";
import { TOOLBELT_ID } from "./toolbelt.js";

/** Degrees of success, by their index (pf2e's `degreeOfSuccess`: 0 is a critical failure) */
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
/** A basic save's damage, by its result */
const BASIC_SAVE_MULTIPLIERS = { criticalSuccess: 0, success: 0.5, failure: 1, criticalFailure: 2 };

/** pf2e's name for a degree of success ("Critical Failure") */
const outcomeLabel = (outcome) => game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);

/** An effect's `system.context.roll` for the save it came from: `{ total, degreeOfSuccess }`, or null without a total */
function effectRoll(total, outcome) {
    return Number.isFinite(total) ? { total, degreeOfSuccess: OUTCOMES.indexOf(outcome) } : null;
}

/**
 * Roll a creature's save (`fortitude`, `reflex` or `will`) from a card, for everyone to see, against `dc`, with
 * `identifier` for the feature to find its card by, and the `item` and `origin` it's against when given
 */
function rollPublicSave(target, save, { dc, token = null, origin = null, item = undefined, identifier }) {
    return target.saves?.[save]?.roll({
        dc: { value: dc },
        ...(item === undefined ? {} : { item }),
        origin,
        token,
        identifier,
        // Shown to everyone, whatever the roller's default roll mode: pf2e 7.x reads rollMode, 8.x messageMode
        rollMode: "publicroll",
        messageMode: "public",
    });
}

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

export {
    BASIC_SAVE_MULTIPLIERS,
    OUTCOMES,
    effectRoll,
    outcomeLabel,
    reportedSaveMessage,
    reportedToolbeltSave,
    rollPublicSave,
    toolbeltSave,
};
