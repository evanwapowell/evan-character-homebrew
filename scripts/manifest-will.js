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
