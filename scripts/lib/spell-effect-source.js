/**
 * A spell's effect, made as pf2e makes it when the effect is dragged from the spell's card onto a creature: the drag
 * carries the spell's origin data (src/scripts/system/dragstart-handler.ts), and the drop sets the effect's level to
 * the rank it was cast at, its origin to the caster with the spell and its spellcasting, its target, and gives an
 * effect without traits the spell's traits that effects can have (ActorSheetPF2e's drop in
 * src/module/actor/sheet/base.ts; the same in pf2e 7.x and 8.x). Used by the Apply buttons of spell-target-effects.js
 * and spell-conditions.js, so effects from either are the same as a dragged one and the Sustain feature tracks them.
 */

import { getSceneToken } from "./util.js";

/** Whether an effect is an aura the caster emits, by its Aura rule or its name ("Aura: Manifest Will") */
export function isAuraEffect(effect) {
    if (/^Aura:/i.test(effect?.name ?? "")) return true;
    const rules = effect?.system?.rules ?? effect?._source?.system?.rules ?? [];
    return Array.isArray(rules) && rules.some((rule) => rule?.key === "Aura");
}

/**
 * The effect's source for the target. `effect` is the effect (a document) or its UUID; `caster` is the spell's actor
 * unless given; `casterToken` the caster's token (its token on the viewed scene unless given); `rollOptions` the
 * origin's roll options, as the card or save message carries them (the spell's own otherwise); `roll` the roll of the
 * message it's dragged from (`{ total, degreeOfSuccess }`), like a save's.
 */
export async function buildSpellEffectSource(
    effect,
    { spell, target, caster = spell.actor, casterToken = undefined, rollOptions = null, roll = null },
) {
    const uuid = typeof effect === "string" ? effect : effect?.uuid;
    const doc = typeof effect === "string" ? await fromUuid(effect) : effect;
    if (doc?.type !== "effect") return null;
    const token = casterToken === undefined ? getSceneToken(caster) : casterToken;
    const source = doc.toObject();
    delete source._id;
    source._stats = { ...source._stats, compendiumSource: uuid };
    source.system.level = { ...source.system.level, value: spell.rank };
    const spellcasting = spell.spellcasting
        ? {
              attribute: {
                  type: spell.attribute,
                  mod: spell.spellcasting.statistic?.attributeModifier?.value ?? 0,
              },
              tradition: spell.spellcasting.tradition,
          }
        : null;
    source.system.context = {
        origin: {
            actor: caster?.uuid ?? null,
            token: token?.uuid ?? null,
            item: spell.uuid,
            spellcasting,
            rollOptions: rollOptions ?? spell.getOriginData?.().rollOptions ?? [],
        },
        target: { actor: target.uuid, token: getSceneToken(target)?.uuid ?? null },
        roll,
    };
    // pf2e gives an effect without traits the spell's traits that effects can have
    if (!source.system.traits?.value?.length) {
        const traits = (spell.system.traits?.value ?? []).filter((t) => t in (CONFIG.PF2E?.effectTraits ?? {}));
        source.system.traits = { ...source.system.traits, value: traits };
    }
    return source;
}
