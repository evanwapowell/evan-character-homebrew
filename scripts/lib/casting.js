/**
 * Telling a spell that was cast from one only sent to chat. Both post the same card (SpellPF2e#toMessage, which sets
 * `flags.pf2e.casting` whenever the spell has a spellcasting statistic), but from pf2e 8.5.0 a cast's card also carries
 * this roll option in `flags.pf2e.origin.rollOptions` (`actualCast` in src/module/item/spell/document.ts on v14-dev,
 * passed by every spellcasting entry's cast). pf2e 7.x and 8.0 to 8.4 can't tell the two apart.
 */

export const CAST_OPTION = "origin:action:slug:cast-a-spell";
/** The first pf2e version that marks casts */
const MARKED_SINCE = "8.5.0";

/** Whether this version of pf2e marks the cards of spells that were cast */
export function castsAreMarked() {
    return !foundry.utils.isNewerVersion(MARKED_SINCE, game.system.version);
}

/**
 * Whether a chat message is a spell's card from casting it, rather than one of its rolls or its card sent to chat. A
 * marked card always is, and where pf2e marks casts, an unmarked one isn't. Where it doesn't, `unmarked` decides: true
 * counts any card from a spellcasting entry (sending it to chat included), false none (the caller offers another way).
 */
export function isSpellCast(message, { unmarked = false } = {}) {
    const flags = message?.flags?.pf2e ?? {};
    if (message?.item?.type !== "spell" || message.rolls?.length > 0) return false;
    // Attack and damage rolls from the spell carry it too: only its card has no other roll context
    const contextType = flags.context?.type;
    if (contextType && contextType !== "spell-cast") return false;
    if (flags.origin?.rollOptions?.includes(CAST_OPTION)) return true;
    return !castsAreMarked() && unmarked && !!flags.casting;
}
