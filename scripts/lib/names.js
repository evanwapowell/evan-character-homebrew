/**
 * A creature's name as players may see it. pf2e hides an NPC's name from players when its token's nameplate isn't shown
 * to them, with "Token name visibility" (Settings → Metagame) on: TokenDocumentPF2e#playersCanSeeName (shown always or
 * on hover to anyone, or a party member) in src/module/scene/token-document/document.ts, read by CheckPF2e's result
 * flavor (src/module/system/check/check.ts) and the sender of chat messages (src/scripts/ui/user-visibility.ts), the
 * same on v13-dev and v14-dev.
 *
 * Text built for players uses `nameForPlayers` (the token's name, or a stand-in). A message everyone can read, which
 * the GM would rather see the name in, uses `nameMarkup` (or `forPlayers` for any text): the name, replaced with the
 * stand-in when a player's session renders it, as pf2e does for damage taken
 * (src/module/chat-message/listeners/damage-taken.ts).
 */

/** What's said in place of a name players can't see */
const UNSEEN = "the creature";
const ATTRIBUTE = "data-ehb-for-players";

const esc = (text) => Handlebars.escapeExpression(String(text ?? ""));

/** The token of an actor or token: an unlinked token's own, or a linked actor's on the scene being viewed */
function tokenOf(doc) {
    if (!doc) return null;
    if (doc.documentName === "Token") return doc;
    if (doc.token) return doc.token;
    return doc.getActiveTokens?.(true, true)?.[0] ?? null;
}

function actorOf(doc) {
    return doc?.documentName === "Token" ? (doc.actor ?? null) : (doc ?? null);
}

/**
 * Whether players can see a creature's name (an actor or a token): pf2e's setting off, or the token's (or, with none
 * on the scene, the prototype token's) nameplate shown to anyone, always or on hover, or a party member
 */
function playersCanSeeName(doc) {
    if (!doc || !game.pf2e?.settings?.tokens?.nameVisibility) return true;
    const token = tokenOf(doc);
    if (typeof token?.playersCanSeeName === "boolean") return token.playersCanSeeName;
    const actor = actorOf(doc) ?? token?.actor ?? null;
    if (actor?.alliance === "party") return true;
    const mode = token?.displayName ?? actor?.prototypeToken?.displayName;
    const { ALWAYS, HOVER } = CONST.TOKEN_DISPLAY_MODES;
    return mode === ALWAYS || mode === HOVER;
}

/** The name players know a creature by: its token's (which may be renamed), or the actor's */
function shownName(doc) {
    const token = tokenOf(doc);
    const actor = actorOf(doc);
    return token?.name ?? actor?.prototypeToken?.name ?? actor?.name ?? "";
}

/** A creature's name for text only players read: its token's name when they can see it, otherwise a stand-in */
function nameForPlayers(doc, { unseen = UNSEEN } = {}) {
    return playersCanSeeName(doc) ? shownName(doc) : unseen;
}

/** A creature's name for the user reading it now: a GM always sees it */
function nameForUser(doc, options) {
    return game.user?.isGM ? shownName(doc) : nameForPlayers(doc, options);
}

/** Text, escaped, that a player's session replaces with `replacement` when it renders the message (`visible`: not) */
function forPlayers(text, replacement, visible = false) {
    return visible ? esc(text) : `<span ${ATTRIBUTE}="${esc(replacement)}">${esc(text)}</span>`;
}

/**
 * A creature's name, escaped, in a message everyone can read: its token's name, which a player's session replaces with
 * a stand-in when they can't see it
 */
function nameMarkup(doc, { unseen = UNSEEN } = {}) {
    return forPlayers(shownName(doc), unseen, playersCanSeeName(doc));
}

/** In a player's session, what `forPlayers` marked is replaced with what players see */
function hideFromPlayers(html) {
    if (game.user?.isGM) return;
    for (const element of html?.querySelectorAll?.(`[${ATTRIBUTE}]`) ?? []) {
        element.textContent = element.getAttribute(ATTRIBUTE);
        element.removeAttribute(ATTRIBUTE);
    }
}

Hooks.on("renderChatMessageHTML", (_message, html) => hideFromPlayers(html));

export { UNSEEN, forPlayers, hideFromPlayers, nameForPlayers, nameForUser, nameMarkup, playersCanSeeName, shownName };
