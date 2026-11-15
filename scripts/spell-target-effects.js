/**
 * Spell effects for targets: an Apply button on the card of a spell without a save that links spell effects, like
 * Heroism or Stoke the Heart, so the caster doesn't have to drag each effect onto each creature. The caster checks
 * which creatures get each effect (their targets, or themselves for a spell on the caster or an aura), and the effects
 * are applied as if dragged from the card: at the rank it was cast, with the caster as their origin, so the Sustain
 * feature keeps sustained ones going. A save's effects are applied by the spell conditions' Apply button instead.
 *
 * Players can't edit creatures they don't own, so the active GM applies effects to those. pf2e asks the user creating
 * an effect to make its choices (Resist Energy's damage type), so the caster makes them before the effects are handed
 * to the GM. Once applied, the card is marked: its button says so, and nothing is checked when it's used again.
 */

import { defaultEffects, parseHeightened, parseLinks } from "./lib/spell-effect-links.js";
import { buildSpellEffectSource, getSceneToken, isAuraEffect } from "./lib/spell-effect-source.js";
import { askGM, featureHooks, onGMRequest, warnGM } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
const TOOLBELT_ID = "pf2e-toolbelt";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("spellTargetEffects");

const log = (error) => console.error(`${MODULE_ID} | Spell effects for targets`, error);

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
        return [{ ...link, uuid: doc.uuid ?? link.uuid, name: doc.name, img: doc.img, aura: isAuraEffect(doc) }];
    });
    const heightened = parseHeightened(spell.system.description.value);
    const defaults = new Set(defaultEffects(effects, spell.rank, { heightened }));
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

/**
 * The caster's allies in the spell's emanation, like Courageous Anthem's: their tokens on the caster's scene within its
 * radius (pf2e's token distance), by pf2e's alliances. Null when the spell's area isn't an emanation, or it can't be
 * measured (the caster has no token on the scene being viewed).
 */
function getEmanationTokens(spell, casterToken) {
    const area = spell.system.area;
    const radius = Number(area?.value);
    if (area?.type !== "emanation" || !radius || !casterToken?.object) return null;
    const caster = spell.actor;
    const scene = casterToken.parent;
    const tokens = [];
    for (const token of scene?.tokens ?? []) {
        const actor = token.actor;
        if (!actor || !token.object || tokens.some((t) => t.actor === actor)) continue;
        if (token === casterToken || actor === caster) continue;
        if (!actor.isAllyOf?.(caster)) continue;
        if (casterToken.object.distanceTo(token.object) <= radius) tokens.push(token);
    }
    return tokens;
}

/**
 * The creatures to offer, the caster last, each with which effects it gets by default: an aura or a spell on the
 * caster alone goes on the caster; an emanation's effect on the caster and their allies in it; any other on the
 * targets, or the caster when there are none. Once the card's effects were applied, nothing is checked.
 */
function getCandidates(message, spell, effects) {
    const caster = spell.actor;
    const casterToken = message.token ?? getSceneToken(caster);
    const targets = getTargetTokens(message);
    const creatures = targets.map((token) => ({ actor: token.actor, token, target: true, inArea: false }));
    const emanation = getEmanationTokens(spell, casterToken);
    for (const token of emanation ?? []) {
        const existing = creatures.find((c) => c.actor === token.actor);
        if (existing) existing.inArea = true;
        else creatures.push({ actor: token.actor, token, target: false, inArea: true });
    }
    if (!creatures.some((c) => c.actor === caster))
        creatures.push({ actor: caster, token: casterToken, target: false, inArea: true });
    else creatures.find((c) => c.actor === caster).inArea = true;
    const applied = isApplied(message);

    // A Sustain doesn't apply again what the spell already has on any creature, like an aura moved to a charge
    const sustain = !!message.flags[MODULE_ID]?.sustain;
    const sceneActors = new Set([caster, ...(canvas.scene?.tokens.map((t) => t.actor).filter((a) => a) ?? [])]);
    const anywhere = (effect) => [...sceneActors].some((a) => findExisting(a, effect.uuid, caster).length > 0);

    return creatures.map((creature) => ({
        ...creature,
        has: effects.map((effect) => findExisting(creature.actor, effect.uuid, caster).length > 0),
        checked: effects.map((effect) => {
            if (applied || !effect.selected || (sustain && anywhere(effect))) return false;
            if (findExisting(creature.actor, effect.uuid, caster).length > 0) return false;
            if (effect.aura || isSelfSpell(spell)) return creature.actor === caster;
            if (emanation) return creature.inArea;
            return targets.length === 0 ? creature.actor === caster : creature.target;
        }),
    }));
}

/** Let the caster check which creatures get each effect. Returns [{ effect, actors }], or null if cancelled. */
async function confirmEffects(spell, effects, creatures, { applied = false } = {}) {
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
    const note = applied
        ? `<p><em>These effects were already applied from this card. Check what to apply again.</em></p>`
        : "";
    const content = [
        note + sections[0],
        ...sections.slice(1),
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

/** Whether a predicate has a statement pf2e fills in from the item, like "{item|flags.pf2e.rulesSelections.x}" */
function isInjected(value) {
    if (typeof value === "string") return value.includes("{");
    if (Array.isArray(value)) return value.some(isInjected);
    return !!value && typeof value === "object" && Object.values(value).some(isInjected);
}

/**
 * Make the choices pf2e would ask for when the effect is created (ChoiceSet rules with a list of choices, like Resist
 * Energy's damage type), on this client, before the effect is handed to the GM: pf2e asks whoever creates it, and takes
 * a selection already on the rule without asking (ChoiceSetRuleElement#preCreate in
 * src/module/rules/rule-element/choice-set/rule-element.ts, the same in pf2e 7.x and 8.x). Choices drawn from items or
 * settings are left for pf2e to ask. Returns false when the user cancels.
 */
async function makeChoices(source, actor) {
    const esc = Handlebars.escapeExpression;
    const options = new Set(actor.getRollOptions?.() ?? []);
    const passes = (predicate) => {
        if (!Array.isArray(predicate) || predicate.length === 0) return true;
        // A predicate drawn from the item ("{item|…}") is pf2e's to resolve
        if (isInjected(predicate)) return true;
        const Predicate = game.pf2e?.Predicate;
        return Predicate ? new Predicate(foundry.utils.deepClone(predicate)).test(options) : true;
    };
    for (const rule of source.system.rules ?? []) {
        if (rule?.key !== "ChoiceSet" || !Array.isArray(rule.choices) || rule.selection != null) continue;
        if (Array.isArray(rule.predicate) && rule.predicate.length > 0) continue;
        const choices = rule.choices.filter((c) => c && "value" in c && passes(c.predicate));
        if (choices.length === 0) continue;
        if (choices.length === 1) {
            rule.selection = choices[0].value;
            continue;
        }
        const prompt = rule.prompt ? game.i18n.localize(rule.prompt) : "Choose one:";
        const rows = choices.map(
            (choice, i) =>
                `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">` +
                `<input type="radio" name="choice" value="${i}" ${i === 0 ? "checked" : ""}>` +
                `${esc(game.i18n.localize(String(choice.label ?? choice.value)))}</label>`,
        );
        const picked = await foundry.applications.api.DialogV2.wait({
            window: { title: `${source.name}: ${actor.name}` },
            content: `<p>${esc(prompt)}</p>${rows.join("")}`,
            buttons: [
                {
                    action: "ok",
                    label: "Choose",
                    default: true,
                    callback: (_event, button) => Number(button.form.elements.choice.value),
                },
                { action: "cancel", label: "Cancel" },
            ],
            rejectClose: false,
        });
        if (typeof picked !== "number" || !choices[picked]) return false;
        rule.selection = foundry.utils.deepClone(choices[picked].value);
    }
    return true;
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
    const casterToken = message.token ?? getSceneToken(caster);
    const rollOptions = message.flags.pf2e?.origin?.rollOptions ?? null;
    const byActor = new Map();
    for (const { effect, actors } of choices) {
        for (const actor of actors) {
            const source = await buildSpellEffectSource(effect.uuid, {
                spell,
                target: actor,
                casterToken,
                rollOptions,
            });
            if (!source) continue;
            // The GM's client creates it on a creature this user doesn't own, so the choices are made here
            if (!actor.isOwner && !(await makeChoices(source, actor))) continue;
            if (!byActor.has(actor)) byActor.set(actor, { sources: [], deleteIds: [], names: [] });
            const entry = byActor.get(actor);
            entry.sources.push(source);
            entry.deleteIds.push(...findExisting(actor, effect.uuid, caster).map((e) => e.id));
            entry.names.push(effect.name);
        }
    }
    if (byActor.size === 0) return false;

    const applied = [];
    const asked = [];
    for (const [actor, { sources, deleteIds, names }] of byActor) {
        if (actor.isOwner) {
            await applyToActor(actor, sources, deleteIds);
            applied.push({ actor, names });
            continue;
        }
        // Players can't edit creatures they don't own, so the active GM applies them: all asked at once
        const data = { actorUuid: actor.uuid, sources, deleteIds };
        asked.push(askGM("applySpellTargetEffects", data).then((answer) => ({ actor, names, answer })));
    }
    const answers = await Promise.all(asked);
    applied.push(...answers.filter((a) => a.answer.ok));
    const failed = answers.find((a) => !a.answer.ok);
    if (failed) {
        const names = answers.filter((a) => !a.answer.ok).map((a) => a.actor.name);
        warnGM(failed.answer, spell.name, `apply its effects to ${names.join(", ")}`);
    }
    if (applied.length === 0) return false;

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
    return true;
}

/** Whether the card's effects were applied */
function isApplied(message) {
    return !!message.flags[MODULE_ID]?.spellTargetEffects?.applied;
}

/** Mark the card as applied: by this user when they can update it (its author, or a GM), otherwise by the GM */
async function markApplied(message) {
    if (isApplied(message)) return;
    if (message.canUserModify(game.user, "update")) {
        await message.update({ [`flags.${MODULE_ID}.spellTargetEffects.applied`]: true });
        return;
    }
    const answer = await askGM("spellTargetEffectsApplied", { messageId: message.id });
    if (!answer.ok) log(new Error(`the card wasn't marked as applied (${answer.reason})`));
}

async function onApply(message) {
    // The card's spell, read again in case the caster's sheet changed since it was rendered
    const spell = getCastSpell(message);
    if (!spell) return;
    const effects = getLinkedEffects(spell);
    if (effects.length === 0) return;
    // Auras by their rules, which a compendium's index doesn't have
    for (const effect of effects) effect.aura = isAuraEffect(await fromUuid(effect.uuid)) || effect.aura;
    const wasApplied = isApplied(message);
    const creatures = getCandidates(message, spell, effects);
    const choices = await confirmEffects(spell, effects, creatures, { applied: wasApplied });
    if (!Array.isArray(choices)) return;
    // Someone else applied them while the dialog was open
    if (!wasApplied && isApplied(message)) {
        const again = await foundry.applications.api.DialogV2.confirm({
            window: { title: `${spell.name}: Apply Spell Effects` },
            content: "<p>These effects were applied from this card while the dialog was open. Apply them again?</p>",
            rejectClose: false,
        });
        if (!again) return;
    }
    if (await applyChoices(message, spell, choices)) await markApplied(message);
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
    const applied = isApplied(message);
    const label = selected.length > 0 ? `: ${selected.join(", ")}` : " Spell Effects";
    button.textContent = `${applied ? "Applied" : "Apply"}${label}`;
    button.dataset.tooltip = applied
        ? "Already applied from this card: apply the spell's effects again"
        : "Apply the spell's effects to your targets, or to you";
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        // One dialog at a time, so a double-click doesn't apply twice
        if (button.disabled) return;
        button.disabled = true;
        onApply(message)
            .catch((error) => {
                log(error);
                ui.notifications.error(`Applying ${spell.name}'s effects failed: ${error.message}`);
            })
            .finally(() => (button.disabled = false));
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

onGMRequest("spellTargetEffectsApplied", async ({ messageId }) => {
    const message = game.messages.get(messageId);
    if (!message) throw new Error("the card is gone");
    if (!getCastSpell(message)) throw new Error("the card isn't a spell's");
    await message.update({ [`flags.${MODULE_ID}.spellTargetEffects.applied`]: true });
});

onGMRequest("applySpellTargetEffects", async (data) => {
    const actor = await fromUuid(data.actorUuid);
    if (!(actor instanceof Actor)) throw new Error("the creature is gone");
    await applyToActor(actor, data.sources ?? [], data.deleteIds ?? []);
});
