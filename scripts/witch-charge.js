/**
 * Designate Witch's Charge: pf2e only provides Effect: Witch's Charge to drag onto a creature. Posting the module's
 * Designate Witch's Charge action applies that effect to the targeted creature, as the witch's, and removes the
 * witch's charge from anyone else.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
/** IDs of the action in this module's compendium and of pf2e's Effect: Witch's Charge */
const ACTION_ID = "f0BUHuiZLiODSsg3";
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

/** Every actor in the world: world actors, and those of unlinked tokens on any scene */
function* allActors() {
    yield* game.actors;
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (!token.actorLink && token.actor) yield token.actor;
        }
    }
}

/** Make the target the witch's only charge. Run by a GM, who can edit every creature. */
async function designateCharge(witchUuid, targetTokenUuid) {
    const witch = await fromUuid(witchUuid);
    const targetToken = await fromUuid(targetTokenUuid);
    const target = targetToken?.actor;
    if (!witch || !target) return;

    // Remove the witch's charge from everyone, including effects dragged on without an origin
    for (const actor of allActors()) {
        const ids = actor.itemTypes.effect
            .filter((e) => isChargeEffect(e) && [witch.uuid, undefined, null].includes(e.system.context?.origin?.actor))
            .map((e) => e.id);
        if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    }

    const effect = await fromUuid(CHARGE_EFFECT_UUID);
    if (!effect) return ui.notifications.error("Witch's Charge: pf2e's Effect: Witch's Charge was not found.");
    const source = effect.toObject();
    source._stats.compendiumSource = CHARGE_EFFECT_UUID;
    const witchToken = witch.getActiveTokens(true, true).find((t) => t.parent === targetToken.parent);
    source.system.context = {
        origin: { actor: witch.uuid, token: witchToken?.uuid ?? null, item: null, spellcasting: null },
        target: { actor: target.uuid, token: targetToken.uuid },
        roll: null,
    };
    await target.createEmbeddedDocuments("Item", [source]);

    const esc = Handlebars.escapeExpression;
    const text = `${esc(witch.name)} designates ${esc(targetToken.name)} as their charge.`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: witch }),
        content: `<p><strong>Witch's Charge</strong> ${text}</p>`,
    });
}

/** Designate the user's one targeted creature as the witch's charge */
function requestCharge(witch) {
    const targets = [...game.user.targets];
    if (targets.length !== 1) {
        return ui.notifications.warn("Witch's Charge: target exactly one creature to designate as your charge.");
    }
    const targetToken = targets[0].document;
    if (targetToken.actor === witch) return ui.notifications.warn("Witch's Charge: you can't be your own charge.");

    if (game.user.isGM) return designateCharge(witch.uuid, targetToken.uuid);
    if (!game.users.activeGM) return ui.notifications.warn("Witch's Charge: a GM must be logged in.");
    // Players can't edit other creatures, so the active GM applies and removes the effects
    game.socket.emit(SOCKET, { action: "designateCharge", witchUuid: witch.uuid, targetTokenUuid: targetToken.uuid });
}

Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id || !isDesignateAction(message)) return;
    const witch = message.actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (witch) requestCharge(witch);
});

Hooks.once("init", () => {
    // For a macro: designate your target as the charge of the selected token (or your character)
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        designateCharge: (witch = canvas.tokens?.controlled[0]?.actor ?? game.user.character) =>
            witch ? requestCharge(witch) : ui.notifications.warn("Select your witch's token."),
    };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "designateCharge" || game.user !== game.users.activeGM) return;
        await designateCharge(data.witchUuid, data.targetTokenUuid);
    });
});
