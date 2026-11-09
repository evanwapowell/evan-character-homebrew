/**
 * Spell effects for targets: an Apply button on the card of a spell without a save that links spell effects, like
 * Heroism or Stoke the Heart, so the caster doesn't have to drag each effect onto each creature. The caster checks
 * which creatures get each effect (their targets, or themselves for a spell on the caster or an aura), and the effects
 * are applied as if dragged from the card: at the rank it was cast, with the caster as their origin, so the Sustain
 * feature keeps sustained ones going. A save's effects are applied by the spell conditions' Apply button instead.
 *
 * Players can't edit creatures they don't own, so the active GM applies effects to those.
 */

import { defaultEffects, parseLinks } from "./lib/spell-effect-links.js";
import { featureHooks } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const TOOLBELT_ID = "pf2e-toolbelt";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("spellTargetEffects");

const log = (error) => console.error(`${MODULE_ID} | Spell effects for targets`, error);

function getSceneToken(actor) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === canvas.scene) ?? null;
}

/** The spell of a card from casting it (or Sustaining it), not of a roll made from it, when it has no save */
function getCastSpell(message) {
    const spell = message.item;
    if (spell?.type !== "spell" || !spell.actor || message.flags.pf2e?.context || message.isRoll) return null;
    return spell.system.defense?.save ? null : spell;
}

/** The effects the spell links, with whether each is applied by default at the rank it was cast */
function getLinkedEffects(spell) {
    const effects = parseLinks(spell.system.description.value).flatMap((link) => {
        let doc = null;
        try {
            doc = fromUuidSync(link.uuid, { relative: spell });
        } catch {
            return [];
        }
        if (doc?.type !== "effect") return [];
        return [{ ...link, uuid: doc.uuid ?? link.uuid, name: doc.name, img: doc.img }];
    });
    const defaults = new Set(defaultEffects(effects, spell.rank));
    // Effects linked in the text, like the cover Manifest Will's aura gives, are the spell's only when it has no others
    const listed = effects.some((e) => e.standalone) ? effects.filter((e) => e.standalone) : effects;
    return listed.map((effect) => ({ ...effect, selected: defaults.has(effect.uuid) }));
}

/** The creatures the spell was aimed at: PF2e Toolbelt's targets on the card, or the user's current targets */
function getTargetTokens(message) {
    const recorded = game.modules.get(TOOLBELT_ID)?.active ? message.flags[TOOLBELT_ID]?.targetHelper?.targets : null;
    const tokens =
        Array.isArray(recorded) && recorded.length > 0
            ? recorded.map((uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null))
            : [...game.user.targets].map((t) => t.document);
    return tokens.filter(
        (token, index, all) => token?.actor && all.findIndex((t) => t.actor === token.actor) === index,
    );
}

/** Whether a creature has an effect from the caster's casting of a spell */
function findExisting(actor, effectUuid, caster) {
    return actor.itemTypes.effect.filter(
        (e) =>
            (e._stats?.compendiumSource ?? e.flags.core?.sourceId) === effectUuid &&
            (e.system.context?.origin?.actor ?? actor.uuid) === caster.uuid,
    );
}

/** Whether the spell is on the caster alone: no targets and no area, like Darkvision or Shield */
function isSelfSpell(spell) {
    return !spell.system.target?.value?.trim() && !spell.system.area;
}

/** The creatures to offer, the caster last, each with which effects it gets by default */
function getCandidates(message, spell, effects) {
    const caster = spell.actor;
    const casterToken = message.token ?? getSceneToken(caster);
    const targets = getTargetTokens(message);
    const creatures = targets.map((token) => ({ actor: token.actor, token, target: true }));
    if (!creatures.some((c) => c.actor === caster))
        creatures.push({ actor: caster, token: casterToken, target: false });

    // A Sustain doesn't apply again what the spell already has on any creature, like an aura moved to a charge
    const sustain = !!message.flags[MODULE_ID]?.sustain;
    const sceneActors = new Set([caster, ...(canvas.scene?.tokens.map((t) => t.actor).filter((a) => a) ?? [])]);
    const anywhere = (effect) => [...sceneActors].some((a) => findExisting(a, effect.uuid, caster).length > 0);

    return creatures.map((creature) => ({
        ...creature,
        has: effects.map((effect) => findExisting(creature.actor, effect.uuid, caster).length > 0),
        checked: effects.map((effect) => {
            if (!effect.selected || (sustain && anywhere(effect))) return false;
            if (findExisting(creature.actor, effect.uuid, caster).length > 0) return false;
            const onCaster = /^Aura:/i.test(effect.name) || isSelfSpell(spell) || targets.length === 0;
            return onCaster ? creature.actor === caster : creature.target;
        }),
    }));
}

/** Let the caster check which creatures get each effect. Returns [{ effect, actors }], or null if cancelled. */
async function confirmEffects(spell, effects, creatures) {
    const esc = Handlebars.escapeExpression;
    const caster = spell.actor;
    const sections = effects.map((effect, e) => {
        const boxes = creatures.map((creature, c) => {
            const label = creature.actor === caster ? `${creature.actor.name} (caster)` : creature.actor.name;
            const has = creature.has[e] ? ` <em>(has it: replaces it)</em>` : "";
            const checked = creature.checked[e] ? "checked" : "";
            return [
                `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0 0.25em 1em">`,
                `<input type="checkbox" name="e${e}-c${c}" ${checked}> ${esc(label)}${has}`,
                `</label>`,
            ].join("");
        });
        const img = effect.img
            ? `<img src="${esc(effect.img)}" alt="" style="width: 24px; height: 24px; border: none">`
            : "";
        const heading = `<div style="display: flex; gap: 0.5em; align-items: center">${img}<strong>${esc(effect.name)}</strong></div>`;
        return [heading, ...boxes].join("");
    });
    const content = [
        ...sections,
        `<p style="font-size: var(--font-size-12)">Target creatures before clicking Apply to list them here.</p>`,
    ].join("<hr>");

    return foundry.applications.api.DialogV2.wait({
        window: { title: `${spell.name}: Apply Spell Effects` },
        content,
        buttons: [
            {
                action: "apply",
                label: "Apply",
                default: true,
                callback: (_event, button) => {
                    const form = button.form.elements;
                    return effects.map((effect, e) => ({
                        effect,
                        actors: creatures.filter((_c, c) => form[`e${e}-c${c}`]?.checked).map((c) => c.actor),
                    }));
                },
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
}

/** The effect as pf2e makes it when it's dragged from the spell's card onto the creature */
async function buildSource(effectUuid, { message, spell, target }) {
    const effect = await fromUuid(effectUuid);
    if (effect?.type !== "effect") return null;
    const caster = spell.actor;
    const casterToken = message.token ?? getSceneToken(caster);
    const source = effect.toObject();
    delete source._id;
    source._stats = { ...source._stats, compendiumSource: effectUuid };
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
            actor: caster.uuid,
            token: casterToken?.uuid ?? null,
            item: spell.uuid,
            spellcasting,
            rollOptions: message.flags.pf2e?.origin?.rollOptions ?? spell.getOriginData?.().rollOptions ?? [],
        },
        target: { actor: target.uuid, token: getSceneToken(target)?.uuid ?? null },
        roll: null,
    };
    // pf2e gives an effect without traits the spell's traits that effects can have
    if (!source.system.traits?.value?.length) {
        const traits = spell.system.traits.value.filter((t) => t in CONFIG.PF2E.effectTraits);
        source.system.traits = { ...source.system.traits, value: traits };
    }
    return source;
}

/** Replace the creature's copies of these effects from the caster with the new ones */
async function applyToActor(actor, sources, deleteIds) {
    const ids = deleteIds.filter((id) => actor.items.get(id)?.type === "effect");
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    const effects = sources.filter((s) => s?.type === "effect");
    if (effects.length > 0) await actor.createEmbeddedDocuments("Item", effects);
}

async function applyChoices(message, spell, choices) {
    const caster = spell.actor;
    const byActor = new Map();
    for (const { effect, actors } of choices) {
        for (const actor of actors) {
            const source = await buildSource(effect.uuid, { message, spell, target: actor });
            if (!source) continue;
            if (!byActor.has(actor)) byActor.set(actor, { sources: [], deleteIds: [], names: [] });
            const entry = byActor.get(actor);
            entry.sources.push(source);
            entry.deleteIds.push(...findExisting(actor, effect.uuid, caster).map((e) => e.id));
            entry.names.push(effect.name);
        }
    }
    if (byActor.size === 0) return;

    const needGm = [...byActor.keys()].some((actor) => !actor.isOwner);
    if (needGm && !game.users.activeGM) {
        ui.notifications.warn("A GM must be logged in to apply effects to creatures you don't own.");
    }
    const applied = [];
    for (const [actor, { sources, deleteIds, names }] of byActor) {
        if (actor.isOwner) {
            await applyToActor(actor, sources, deleteIds);
        } else if (game.users.activeGM) {
            // Players can't edit creatures they don't own, so the active GM applies them
            game.socket.emit(SOCKET, { action: "applySpellTargetEffects", actorUuid: actor.uuid, sources, deleteIds });
        } else {
            continue;
        }
        applied.push({ actor, names });
    }
    if (applied.length === 0) return;

    // One line per set of effects, listing the creatures that got it
    const esc = Handlebars.escapeExpression;
    const lines = new Map();
    for (const { actor, names } of applied) {
        const key = names.join(", ");
        lines.set(key, [...(lines.get(key) ?? []), actor.name]);
    }
    const content = [...lines]
        .map(
            ([names, actors]) =>
                `<p><strong>${esc(spell.name)}</strong>: ${esc(names)} on ${esc(actors.join(", "))}.</p>`,
        )
        .join("");
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster, token: message.token }), content });
}

async function onApply(message) {
    // The card's spell, read again in case the caster's sheet changed since it was rendered
    const spell = getCastSpell(message);
    if (!spell) return;
    const effects = getLinkedEffects(spell);
    if (effects.length === 0) return;
    const creatures = getCandidates(message, spell, effects);
    const choices = await confirmEffects(spell, effects, creatures);
    if (!Array.isArray(choices)) return;
    await applyChoices(message, spell, choices);
}

function addApplyButton(message, html) {
    const content = html?.querySelector(".message-content");
    const spell = content ? getCastSpell(message) : null;
    if (!spell?.actor.isOwner) return;
    const effects = getLinkedEffects(spell);
    if (effects.length === 0) return;

    const selected = effects.filter((e) => e.selected).map((e) => e.name);
    const button = document.createElement("button");
    button.type = "button";
    button.style.marginTop = "0.25em";
    button.textContent = selected.length > 0 ? `Apply: ${selected.join(", ")}` : "Apply Spell Effects";
    button.dataset.tooltip = "Apply the spell's effects to your targets, or to you";
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onApply(message).catch((error) => {
            log(error);
            ui.notifications.error(`Applying ${spell.name}'s effects failed: ${error.message}`);
        });
    });
    content.append(button);
}

hooks.on("renderChatMessageHTML", (message, html) => {
    try {
        addApplyButton(message, html);
    } catch (error) {
        log(error);
    }
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "applySpellTargetEffects" || game.user !== game.users.activeGM) return;
        const actor = await fromUuid(data.actorUuid);
        if (!(actor instanceof Actor)) return;
        await applyToActor(actor, data.sources ?? [], data.deleteIds ?? []).catch(log);
    });
});
