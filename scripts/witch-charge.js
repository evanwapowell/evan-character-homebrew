/**
 * Designate Witch's Charge: pf2e only provides Effect: Witch's Charge to drag onto a creature. Posting the module's
 * Designate Witch's Charge action applies that effect to the targeted creature, as the witch's, and removes the
 * witch's charge from anyone else. With Witch's Communion, the witch can target as many creatures as their
 * Intelligence modifier, which then become their charges.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
/** IDs of the action in this module's compendium, pf2e's Witch's Communion feat, and pf2e's Effect: Witch's Charge */
const ACTION_ID = "f0BUHuiZLiODSsg3";
const COMMUNION_ID = "4IeAAmx2vZEHmRLX";
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

/** How many charges the witch can designate: 1, or their Intelligence modifier with Witch's Communion */
function getMaxCharges(witch) {
    const hasCommunion = witch.itemTypes.feat.some(
        (f) =>
            [f.sourceId, f.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${COMMUNION_ID}`)) ||
            f.name === "Witch's Communion",
    );
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
    if (!(game.modules.get("sequencer")?.active && game.modules.get("JB2A_DnD5e")?.active)) return;

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

/** Make the targets the witch's only charges. Run by a GM, who can edit every creature. */
async function designateCharges(witchUuid, targetTokenUuids) {
    const witch = await fromUuid(witchUuid);
    const targetTokens = (await Promise.all(targetTokenUuids.map((uuid) => fromUuid(uuid)))).filter((t) => t?.actor);
    if (!witch || targetTokens.length === 0) return;

    // Remove the witch's charge from everyone, including effects dragged on without an origin
    for (const actor of allActors()) {
        const ids = actor.itemTypes.effect
            .filter((e) => isChargeEffect(e) && [witch.uuid, undefined, null].includes(e.system.context?.origin?.actor))
            .map((e) => e.id);
        if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    }

    const effect = await fromUuid(CHARGE_EFFECT_UUID);
    if (!effect) return ui.notifications.error("Witch's Charge: pf2e's Effect: Witch's Charge was not found.");
    for (const targetToken of targetTokens) {
        const source = effect.toObject();
        source._stats.compendiumSource = CHARGE_EFFECT_UUID;
        const witchToken = witch.getActiveTokens(true, true).find((t) => t.parent === targetToken.parent);
        source.system.context = {
            origin: { actor: witch.uuid, token: witchToken?.uuid ?? null, item: null, spellcasting: null },
            target: { actor: targetToken.actor.uuid, token: targetToken.uuid },
            roll: null,
        };
        await targetToken.actor.createEmbeddedDocuments("Item", [source]);
    }

    const esc = Handlebars.escapeExpression;
    const names = targetTokens.map((t) => esc(t.name));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    const text = `${esc(witch.name)} designates ${list} as their ${names.length > 1 ? "charges" : "charge"}.`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: witch }),
        content: `<p><strong>Witch's Charge</strong> ${text}</p>`,
    });
}

/** Designate the user's targeted creatures as the witch's charges */
function requestCharge(witch) {
    const targetTokens = [...game.user.targets].map((t) => t.document);
    const maxCharges = getMaxCharges(witch);
    if (targetTokens.length === 0 || targetTokens.length > maxCharges) {
        const count = maxCharges === 1 ? "exactly one creature" : `up to ${maxCharges} creatures (Witch's Communion)`;
        return ui.notifications.warn(`Witch's Charge: target ${count} to designate as your charge.`);
    }
    if (targetTokens.some((t) => t.actor === witch)) {
        return ui.notifications.warn("Witch's Charge: you can't be your own charge.");
    }

    const targetTokenUuids = targetTokens.map((t) => t.uuid);
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn("Witch's Charge: a GM must be logged in.");
    }
    // Played here, where the tokens are on screen; Sequencer shows it to everyone
    playChargeAnimation(witch, targetTokens);
    if (game.user.isGM) return designateCharges(witch.uuid, targetTokenUuids);
    // Players can't edit other creatures, so the active GM applies and removes the effects
    game.socket.emit(SOCKET, { action: "designateCharge", witchUuid: witch.uuid, targetTokenUuids });
}

Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id || !isDesignateAction(message)) return;
    const witch = message.actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (witch) requestCharge(witch);
});

Hooks.once("init", () => {
    // For a macro: designate your targets as the charges of the selected token (or your character)
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
        await designateCharges(data.witchUuid, data.targetTokenUuids);
    });
});
