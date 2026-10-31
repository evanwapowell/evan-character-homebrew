/**
 * Manifest Will: "Any creature that begins its turn in the emanation is affected" for 1 round.
 * pf2e auras can only apply effects while a token is inside them, so this applies the patron's
 * tradition effect at the start of each turn instead, and removes it at the start of the next.
 */

const MODULE_ID = "evan-character-homebrew";
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
const AURA_SLUG = "manifest-will";
const EFFECTS = {
    arcane: `${PACK}.9xjkgwwxe5NIKr4t`,
    divine: `${PACK}.Ydg4REm5EQX3eua6`,
    occult: `${PACK}.zs66wcnBpWxSmvys`,
    primal: `${PACK}.DJJvRoc5yfNaraKe`,
};

/** The tradition chosen on an Aura: Manifest Will effect */
function getTradition(auraEffect) {
    const choiceSet = auraEffect._source.system.rules.find((r) => r.key === "ChoiceSet");
    return choiceSet?.selection ?? null;
}

/**
 * Whether a creature beginning its turn in the emanation is affected. The center is the creature emitting the aura:
 * the caster, or a seneschal's charge. The caster chooses whether the center is affected, so only when it helps.
 */
function isAffected(tradition, actor, { caster, center }) {
    switch (tradition) {
        case "arcane":
        case "primal":
            return actor !== center;
        case "divine":
            return ["living", "undead"].includes(actor.modeOfBeing);
        case "occult":
            return actor.isAllyOf(caster);
        default:
            return false;
    }
}

function getManifestWillEffects(actor) {
    return actor.itemTypes.effect.filter((e) => e.flags[MODULE_ID]?.manifestWill);
}

async function onTurnStart(combatant) {
    const { actor, token } = combatant;
    if (!actor?.isOfType("character", "npc", "familiar") || !token?.parent) return;

    // Effects gained at the start of the previous turn last 1 round: until the start of this one
    const expired = getManifestWillEffects(actor).map((e) => e.id);
    if (expired.length > 0) await actor.deleteEmbeddedDocuments("Item", expired);

    const toCreate = [];
    const traditionsApplied = new Set();
    for (const centerToken of token.parent.tokens) {
        const center = centerToken.actor;
        const aura = centerToken.auras?.get(AURA_SLUG);
        if (!(center?.auras?.has(AURA_SLUG) && aura?.containsToken(token))) continue;

        const auraEffect = center.itemTypes.effect.find((e) => e.slug === "aura-manifest-will");
        if (!auraEffect) continue;
        // The witch who cast the spell, even when the emanation is centered on their charge
        const caster = auraEffect.origin ?? center;

        const tradition = getTradition(auraEffect);
        if (!EFFECTS[tradition] || traditionsApplied.has(tradition)) continue;
        if (!isAffected(tradition, actor, { caster, center })) continue;

        const effect = await fromUuid(EFFECTS[tradition]);
        if (!effect) continue;

        const source = effect.toObject();
        // Spell rank: set when dragged from the chat card, otherwise the caster's cantrip rank
        source.system.level.value = Math.max(auraEffect.level, Math.ceil(caster.level / 2));
        source.system.context = {
            origin: { actor: caster.uuid, token: centerToken.uuid, item: null, spellcasting: null },
            target: null,
            roll: null,
        };
        source.flags[MODULE_ID] = { manifestWill: { origin: caster.uuid } };
        toCreate.push(source);
        traditionsApplied.add(tradition);
    }

    if (toCreate.length > 0) await actor.createEmbeddedDocuments("Item", toCreate);
}

/** One-shot JB2A (free) animations played when the aura is applied, matching the aura's looping texture */
const CAST_ANIMATIONS = {
    arcane: "Generic/Magic_Signs/AbjurationCircleComplete_02_Regular_Blue_800x800.webm",
    divine: "2nd_Level/Divine_Smite/DivineSmite_01_Regular_BlueYellow_Caster_400x400.webm",
    occult: "Generic/Magic_Signs/EnchantmentCircleComplete_02_Dark_Pink_800x800.webm",
    primal: "1st_Level/Entangle/Entangle02_02_Regular_Green_500x500.webm",
};

/** Play the cast animation at the emanation's center, sized to the 10-foot emanation */
function playCastAnimation(auraEffect) {
    if (!(game.modules.get("sequencer")?.active && game.modules.get("JB2A_DnD5e")?.active)) return;

    const file = CAST_ANIMATIONS[getTradition(auraEffect)];
    const token = auraEffect.actor?.getActiveTokens(true, true).find((t) => t.parent === canvas.scene);
    if (!(file && token)) return;

    new Sequence()
        .effect()
        .file(`modules/JB2A_DnD5e/Library/${file}`)
        .atLocation(token)
        .size(Math.max(token.width, token.height) + 4, { gridUnits: true })
        .belowTokens()
        .fadeIn(300)
        .fadeOut(500)
        .play();
}

// Cast or Sustain: the aura effect is applied to the caster or, for a seneschal, their charge
Hooks.on("createItem", (item, _options, userId) => {
    if (userId !== game.user.id || item.type !== "effect" || item.slug !== "aura-manifest-will") return;
    playCastAnimation(item);
});

/* Seneschal: "When you cast or Sustain manifest will, as long as your charge is within 30 feet, you can choose to
 * center the spell's emanation on your charge instead of yourself." */

const SOCKET = `module.${MODULE_ID}`;
/** ID of pf2e's Effect: Witch's Charge, the same in every pf2e version */
const CHARGE_EFFECT_ID = "ugeStF0Rj8phBPWL";
const CHARGE_RANGE = 30;

function getSceneToken(actor) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === canvas.scene) ?? null;
}

/** The caster's Aura: Manifest Will effect, on themselves or a creature it's centered on */
function findAuraEffect(caster) {
    const actors = new Set([caster, ...canvas.scene.tokens.map((t) => t.actor).filter((a) => a)]);
    for (const actor of actors) {
        const effect = actor.itemTypes.effect.find(
            (e) => e.slug === "aura-manifest-will" && (actor === caster || e.origin === caster),
        );
        if (effect) return effect;
    }
    return null;
}

/** Tokens of the caster's charges within 30 feet: creatures with Effect: Witch's Charge from the caster */
function getChargeTokens(caster, casterToken) {
    return canvas.scene.tokens.filter((token) => {
        const actor = token.actor;
        if (!actor || actor === caster || !token.object || !casterToken.object) return false;
        const isCharge = actor.itemTypes.effect.some((e) => {
            const fromCompendium = [e.sourceId, e.uuid].some((u) => String(u ?? "").endsWith(`.${CHARGE_EFFECT_ID}`));
            // Without an origin, the effect counts as its holder's own: assume it's from this caster
            return (fromCompendium || e.name === "Effect: Witch's Charge") && [caster, actor].includes(e.origin);
        });
        return isCharge && casterToken.object.distanceTo(token.object) <= CHARGE_RANGE;
    });
}

/** Re-create the aura effect on a new center, keeping its tradition, rank, caster, and start time */
async function moveAuraEffect(effectUuid, centerActorUuid) {
    const effect = await fromUuid(effectUuid);
    const center = await fromUuid(centerActorUuid);
    if (!effect || !center || effect.actor === center) return;

    const source = effect.toObject();
    delete source._id;
    const [created] = await center.createEmbeddedDocuments("Item", [source]);
    // pf2e sets a new start time on creation; keep counting the spell's duration from when it was cast
    await created?.update({ "system.start": effect._source.system.start });
    await effect.delete();
}

/** On Sustaining Manifest Will, offer to center it on the caster or a charge within 30 feet */
async function offerRecenter(caster, { spell, effect }) {
    if (![spell?.slug, effect?.slug].some((s) => s === "manifest-will" || s === "aura-manifest-will")) return;

    const auraEffect = findAuraEffect(caster);
    const casterToken = getSceneToken(caster);
    if (!auraEffect || !casterToken) return;
    const chargeTokens = getChargeTokens(caster, casterToken);
    if (chargeTokens.length === 0) return;

    const esc = Handlebars.escapeExpression;
    const centers = [casterToken, ...chargeTokens];
    const content = centers
        .map((token, index) => {
            const label = index === 0 ? `${token.name} (you)` : `${token.name} (charge)`;
            const current = token.actor === auraEffect.actor;
            return [
                `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
                `<input type="radio" name="choice" value="${index}" ${current ? "checked" : ""}>`,
                `<span>${esc(label)}${current ? " <em>(current)</em>" : ""}</span>`,
                `</label>`,
            ].join("");
        })
        .join("");

    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Center Manifest Will on" },
        content,
        buttons: [
            {
                action: "center",
                label: "Center",
                default: true,
                callback: (_event, button) => button.form.elements.choice.value,
            },
            { action: "keep", label: "Keep" },
        ],
        rejectClose: false,
    });
    if (typeof choice !== "string" || !/^\d+$/.test(choice)) return;
    const center = centers[Number(choice)].actor;
    if (center === auraEffect.actor) return;

    if (auraEffect.isOwner && center.isOwner) {
        await moveAuraEffect(auraEffect.uuid, center.uuid);
    } else if (game.users.activeGM) {
        game.socket.emit(SOCKET, { action: "moveManifestWill", effectUuid: auraEffect.uuid, centerUuid: center.uuid });
    } else {
        ui.notifications.warn("Manifest Will: a GM must be logged in to center it on that creature.");
    }
}

Hooks.once("init", () => {
    // Run when the caster Sustains a spell through scripts/sustain.js, before other Sustain follow-ups
    const module = game.modules.get(MODULE_ID);
    module.sustainHandlers = [...(module.sustainHandlers ?? []), offerRecenter];
});

Hooks.once("ready", () => {
    // Players can't edit creatures they don't own, so the active GM moves the aura for them
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "moveManifestWill" || game.user !== game.users.activeGM) return;
        await moveAuraEffect(data.effectUuid, data.centerUuid);
    });
});

Hooks.on("updateCombat", (combat, changed) => {
    if (game.user !== game.users.activeGM) return;
    if (!("turn" in changed || "round" in changed) || !combat.started || !combat.combatant) return;
    onTurnStart(combat.combatant).catch((error) => console.error(`${MODULE_ID} | Manifest Will`, error));
});

Hooks.on("deleteCombat", async (combat) => {
    if (game.user !== game.users.activeGM) return;
    for (const actor of new Set(combat.combatants.map((c) => c.actor).filter((a) => a))) {
        const ids = getManifestWillEffects(actor).map((e) => e.id);
        if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    }
});
