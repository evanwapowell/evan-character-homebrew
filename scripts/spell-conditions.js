/**
 * Spell conditions: when a creature rolls a save against a spell, read the spell's text for that degree of success
 * and offer to apply what it says: linked spell effects, and conditions with their values and timers. A condition
 * that lasts as long as another ("Slowed 1 as long as it's sickened") is granted by that condition, so pf2e shows it
 * as linked and removes it along with it, as it does for dying and unconscious.
 *
 * What's applied from a message is recorded on it (the creatures it was applied to), so its button says so and the
 * dialog checks nothing for them when it's used again.
 */

import { getGrantedConditions, OUTCOMES, parseSpellOutcome, preselectDegree } from "./lib/spell-condition-parser.js";
import { nameMarkup } from "./lib/names.js";
import { outcomeLabel, toolbeltSave } from "./lib/saves.js";
import { buildSpellEffectSource } from "./lib/spell-effect-source.js";
import { toolbeltActive, toolbeltTargets } from "./lib/toolbelt.js";
import { MODULE_ID, esc, getSceneToken, logger, spellDC } from "./lib/util.js";
import { askGM, onGMRequest, owns, refuse } from "./settings.js";

const log = logger("Spell conditions");
const UNIT_LABELS = {
    rounds: ["round", "rounds"],
    minutes: ["minute", "minutes"],
    hours: ["hour", "hours"],
    days: ["day", "days"],
};

function getConditions() {
    const conditions = new Map();
    for (const condition of game.pf2e.ConditionManager.conditions.values()) {
        conditions.set(condition.slug, {
            slug: condition.slug,
            name: condition.name,
            id: condition.id,
            uuid: condition.uuid,
            // Conditions with a value, like drained or frightened
            valued: !!condition.system?.value?.isValued,
        });
    }
    return [...conditions.values()];
}

function getLabels() {
    const english = {
        criticalSuccess: "Critical Success",
        success: "Success",
        failure: "Failure",
        criticalFailure: "Critical Failure",
    };
    return Object.fromEntries(OUTCOMES.map((o) => [o, [...new Set([english[o], outcomeLabel(o)])]]));
}

/** A timer that ends at the creature's own next turn: "until its next turn begins", "until the end of its next turn" */
const isOwnTurnTimer = (duration) =>
    duration?.value === 1 && duration.unit === "rounds" && duration.relativeTo === "target";

function describeDuration(duration) {
    if (duration?.dice) return `${duration.dice} ${duration.unit}`;
    if (!duration?.value) return null;
    if (duration.value === 1 && duration.unit === "rounds" && duration.expiry === "turn-end") {
        if (duration.relativeTo === "caster") return "until the end of the caster's next turn";
        return duration.thisTurn ? "until the end of its turn" : "until the end of its next turn";
    }
    if (isOwnTurnTimer(duration)) return "until the start of its next turn";
    const [one, many] = UNIT_LABELS[duration.unit] ?? [duration.unit, duration.unit];
    return `${duration.value} ${duration.value === 1 ? one : many}`;
}

/**
 * The rounds pf2e counts for a timer that ends at the creature's own next turn. pf2e ends an effect at its origin's
 * turn (the start, or once the turn has passed to a lower initiative) only when its rounds are up, and its time moves
 * on with the round, not the turn (calculateRemainingDuration in src/module/item/abstract-effect/helpers.ts, the same
 * in pf2e 7.x and 8.x). So 1 round ends at the creature's turn in the next round, which is its next turn only when it
 * has had this round's. When its turn is still to come this round, the timer is 0 rounds, as pf2e's own effects that
 * last "until the end of your turn" are: it ends at that turn. On the creature's own turn, its next turn is the next
 * round's, unless the timer is for the turn it's taking (`thisTurn`: "for that turn").
 */
function ownTurnRounds(duration, actor) {
    const combat = game.combat;
    // pf2e reads the turn the timer counts from as the creature's in the encounter being viewed (ActorPF2e#combatant)
    const combatant = combat?.started ? combat.combatants.find((c) => c.actor?.uuid === actor.uuid) : null;
    // Where time also passes with each turn, 0 rounds would be up at the next turn, whoever's it is. pf2e compares
    // initiatives, and with none rolled it takes the current turn's for the creature's.
    if (typeof combatant?.initiative !== "number" || CONFIG.time.turnTime) return 1;
    const turn = combat.turns.indexOf(combatant);
    const now = combat.turns.indexOf(combat.combatant);
    if (now === -1 || turn < now) return 1;
    if (turn === now) return duration.thisTurn ? 0 : 1;
    // On the turn of a combatant with no creature, pf2e takes an effect whose rounds are up for expired
    return combat.turns.slice(now, turn).every((c) => c.actor) ? 0 : 1;
}

/**
 * The spell of a save against a spell cast from a scroll or wand. pf2e makes such a spell from the consumable when
 * it's cast, with an ID that isn't on the actor, so the save's message (whose origin is that spell) can't find it
 * (ChatMessagePF2e#item in src/module/chat-message/document.ts). The cast's card has the spell (`flags.pf2e.casting.
 * embeddedSpell`): the latest card whose origin is the save's.
 */
function findEmbeddedSpell(message) {
    const origin = message.flags.pf2e?.origin;
    if (origin?.type !== "spell" || typeof origin.uuid !== "string") return null;
    const messages = game.messages.contents;
    for (let i = messages.length - 1; i >= 0; i--) {
        const card = messages[i];
        if (card === message || !card.flags.pf2e?.casting?.embeddedSpell) continue;
        if (card.flags.pf2e.origin?.uuid !== origin.uuid) continue;
        const spell = card.item;
        if (spell?.type === "spell") return spell;
    }
    return null;
}

/** The save message's spell, outcome, and the creature that rolled it, if it's a save against a spell */
function getSave(message) {
    const context = message.flags.pf2e?.context;
    if (context?.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) return null;
    const spell = message.item ?? findEmbeddedSpell(message);
    const target = message.actor;
    if (spell?.type !== "spell" || !target) return null;
    // Another save rolled from the spell's card, like the Fortitude save a witch's patron adds to hexes, isn't this one
    const statistic = spell.system.defense?.save?.statistic;
    const domains = context.domains ?? [];
    if (statistic && domains.length > 0 && !domains.includes(statistic)) return null;
    const dc = Number(context.dc?.value) || null;
    const roll = message.rolls?.at(-1);
    return {
        spell,
        target,
        outcome: context.outcome,
        casterUuid: context.origin?.actor ?? spell.actor?.uuid,
        dc,
        rollOptions: message.flags.pf2e?.origin?.rollOptions ?? null,
        // As pf2e's drag from the message has it: 0 a critical failure to 3 a critical success
        roll: roll
            ? { total: roll.total, degreeOfSuccess: roll.degreeOfSuccess ?? 3 - OUTCOMES.indexOf(context.outcome) }
            : null,
    };
}

/** Effect UUIDs that the module's other scripts register for a spell's degree of success, on `spellEffects` */
function getExtraEffects(spell, outcome) {
    return (game.modules.get(MODULE_ID).spellEffects ?? []).flatMap((getEffects) => {
        try {
            return getEffects(spell, outcome) ?? [];
        } catch (error) {
            console.error(`${MODULE_ID} | Spell conditions`, error);
            return [];
        }
    });
}

/** What the spell's text says happens to the creature, without conditions its linked spell effects already grant */
async function buildProposal({ spell, outcome }) {
    const conditions = getConditions();
    const parsed = parseSpellOutcome(spell.system.description.value, outcome, {
        conditions,
        labels: getLabels(),
        spellDuration: spell.system.duration?.value,
        save: spell.system.defense?.save?.statistic,
    });

    const effects = [];
    const granted = new Set();
    for (const link of parsed.effects) {
        const effect = await fromUuid(link.effect);
        if (!effect) continue;
        effects.push({ uuid: effect.uuid, name: effect.name });
        for (const slug of getGrantedConditions(effect.toObject(), conditions)) granted.add(slug);
    }
    // Effects the module's other scripts add for the spell, which go with the conditions its text describes
    for (const uuid of getExtraEffects(spell, outcome)) {
        const effect = effects.some((e) => e.uuid === uuid) ? null : await fromUuid(uuid);
        if (effect) effects.push({ uuid: effect.uuid, name: effect.name });
    }

    const known = new Map(conditions.map((c) => [c.slug, c]));
    const proposed = parsed.conditions
        .filter((c) => !granted.has(c.slug))
        .map((c) => ({ ...c, name: known.get(c.slug)?.name ?? c.slug, valued: !!known.get(c.slug)?.valued }));
    return { effects, conditions: proposed };
}

/** Roll timers like "for 1d4 rounds", when the user goes to apply them, so they can be checked first */
async function rollDurations(proposal) {
    const conditions = [];
    for (const condition of proposal.conditions) {
        const duration = condition.duration?.dice ? { ...condition.duration } : condition.duration;
        if (duration?.dice) {
            const roll = await new Roll(duration.dice).evaluate();
            duration.value = roll.total;
            duration.rolled = `${duration.dice} = ${roll.total}`;
            delete duration.dice;
        }
        conditions.push({ ...condition, duration });
    }
    return { effects: proposal.effects, conditions };
}

/** "Frightened 2, Slowed 1 (for 1 minute)"; with `proposed`, what's offered unchecked is marked as such */
function summarize({ effects, conditions }, { proposed = false } = {}) {
    const names = new Map(conditions.map((c) => [c.slug, c.name]));
    return [
        ...effects.map((e) => e.name),
        ...conditions.map((c) => {
            const label = `${c.name}${c.value ? ` ${c.value}` : ""}`;
            const timing = c.linkedTo ? `while ${names.get(c.linkedTo) ?? c.linkedTo}` : describeDuration(c.duration);
            const notes = [timing, proposed && c.later ? "later, or only if" : null].filter(Boolean);
            return notes.length ? `${label} (${notes.join("; ")})` : label;
        }),
    ].join(", ");
}

/**
 * Let the user check and adjust proposals before applying them: one section per creature, each with the spell
 * effects and conditions it would get. Returns the confirmed proposals, or null if cancelled.
 */
async function confirmProposals(entries) {
    const row = (content) =>
        `<div style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">${content}</div>`;
    const unitOptions = (selected) =>
        Object.entries(UNIT_LABELS)
            .map(
                ([unit, [, many]]) => `<option value="${unit}" ${unit === selected ? "selected" : ""}>${many}</option>`,
            )
            .join("");

    const sections = entries.map(({ save, proposal, applied }, t) => {
        const names = new Map(proposal.conditions.map((c) => [c.slug, c.name]));
        // Once applied to the creature from this message, nothing is checked for it
        const check = (on) => (on && !applied ? "checked" : "");
        const effectRows = proposal.effects.map((effect, index) =>
            row(
                `<label><input type="checkbox" name="t${t}-effect-${index}" ${check(true)}> ${esc(effect.name)}</label>`,
            ),
        );
        const conditionRows = proposal.conditions.map((condition, index) => {
            const field = `t${t}-${index}`;
            // A condition with a value the text doesn't give as a number ("drained [[/r 1d4]]") asks for it
            const value =
                condition.value || condition.valued
                    ? `<input type="number" name="value-${field}" value="${condition.value ?? ""}" min="1"` +
                      ` placeholder="?" style="width: 3.5em">` +
                      (condition.value ? "" : ` <em>(value: not a number in the text)</em>`)
                    : "";
            let timing;
            if (condition.linkedTo) {
                timing = `<em>while ${esc(names.get(condition.linkedTo) ?? condition.linkedTo)}</em>`;
            } else if (condition.duration?.expiry === "turn-end" && condition.duration.value === 1) {
                timing = `<em>${esc(describeDuration(condition.duration))}</em>`;
            } else {
                // 1 round counted on the creature's own turns, which is what's applied unless it's changed
                const ownTurn = isOwnTurnTimer(condition.duration) ? describeDuration(condition.duration) : "";
                const note = condition.duration?.rolled ?? (condition.fromSpellDuration ? "spell's duration" : ownTurn);
                timing = [
                    `for <input type="number" name="duration-${field}" value="${condition.duration?.value ?? ""}"`,
                    ` min="1" placeholder="no timer" style="width: 5.5em">`,
                    `<select name="unit-${field}">${unitOptions(condition.duration?.unit ?? "rounds")}</select>`,
                    note ? ` <em>(${esc(note)})</em>` : "",
                ].join("");
            }
            // What the text gives later, or only if something happens, is offered but not checked
            const checkbox = `<input type="checkbox" name="condition-${field}" ${check(!condition.later)}>`;
            const later = condition.later ? ` <em>(later, or only if)</em>` : "";
            return row(`<label>${checkbox} ${esc(condition.name)}</label>${value} ${timing}${later}`);
        });
        const heading = `${esc(save.target.name)}</strong>'s save against ${esc(save.spell.name)}`;
        const again = applied ? ` <em>Already applied from this message: check what to apply again.</em>` : "";
        return [
            `<p><strong>${heading}: ${esc(outcomeLabel(save.outcome))}.${again}</p>`,
            ...effectRows,
            ...conditionRows,
        ].join("");
    });

    const content = [
        ...sections,
        `<p style="font-size: var(--font-size-12)">Leave the timer empty for no timer.</p>`,
    ].join("<hr>");

    return foundry.applications.api.DialogV2.wait({
        window: { title: `${entries[0].save.spell.name}: Apply Conditions` },
        content,
        buttons: [
            {
                action: "apply",
                label: "Apply",
                default: true,
                callback: (_event, button) => {
                    const form = button.form.elements;
                    return entries.map(({ save, proposal }, t) => {
                        const effects = proposal.effects.filter((_e, i) => form[`t${t}-effect-${i}`]?.checked);
                        const conditions = proposal.conditions.flatMap((condition, i) => {
                            const field = `t${t}-${i}`;
                            if (!form[`condition-${field}`]?.checked) return [];
                            const valueInput = form[`value-${field}`];
                            const value = valueInput ? Number(valueInput.value) || condition.value || null : null;
                            const durationInput = form[`duration-${field}`];
                            if (!durationInput) return [{ ...condition, value }];
                            const amount = Number(durationInput.value);
                            const duration = amount
                                ? {
                                      ...(condition.duration ?? { expiry: "turn-start", relativeTo: "caster" }),
                                      value: amount,
                                      unit: form[`unit-${field}`].value,
                                  }
                                : null;
                            return [{ ...condition, value, duration }];
                        });
                        return { save, effects, conditions };
                    });
                },
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
}

/** The creatures (actor UUIDs) the message's spell conditions were applied to */
function getApplied(message) {
    const applied = message.flags[MODULE_ID]?.spellConditions?.applied;
    return Array.isArray(applied) ? applied : [];
}

/** Record on the message whom it was applied to: by this user when they can update it, otherwise by the GM */
async function markApplied(message, actorUuids) {
    const applied = [...new Set([...getApplied(message), ...actorUuids])];
    if (applied.length === getApplied(message).length) return;
    if (message.canUserModify(game.user, "update")) {
        await message.update({ [`flags.${MODULE_ID}.spellConditions.applied`]: applied });
        return;
    }
    const answer = await askGM("spellConditionsApplied", { messageId: message.id, actorUuids });
    if (!answer.ok) log(new Error(`the message wasn't marked as applied (${answer.reason})`));
}

/** Roll timers, let the user check the proposals, then apply them */
async function confirmAndApply(message, entries) {
    const before = getApplied(message);
    const rolled = [];
    for (const { save, proposal } of entries) {
        const applied = before.includes(save.target.uuid);
        rolled.push({ save, proposal: await rollDurations(proposal), applied });
    }
    const confirmed = await confirmProposals(rolled);
    if (!Array.isArray(confirmed)) return;
    const chosen = confirmed.filter(({ effects, conditions }) => effects.length || conditions.length);
    // Someone else applied them while the dialog was open
    const meanwhile = chosen.filter(({ save }) => !before.includes(save.target.uuid) && isAppliedTo(message, save));
    if (meanwhile.length > 0) {
        const names = meanwhile.map(({ save }) => save.target.name).join(", ");
        const again = await foundry.applications.api.DialogV2.confirm({
            window: { title: `${entries[0].save.spell.name}: Apply Conditions` },
            content: `<p>This was applied to ${esc(names)} while the dialog was open. Apply it again?</p>`,
            rejectClose: false,
        });
        if (!again) return;
    }
    const done = [];
    for (const { save, effects, conditions } of chosen) {
        await applyProposal(save, { effects, conditions });
        done.push(save.target.uuid);
    }
    if (done.length > 0) await markApplied(message, done);
}

function isAppliedTo(message, save) {
    return getApplied(message).includes(save.target.uuid);
}

function createApplyButton(message, label, entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.marginTop = "0.25em";
    const applied = entries.every(({ save }) => isAppliedTo(message, save));
    button.textContent = applied ? label.replace(/^Apply\b/, "Applied") : label;
    if (applied) button.dataset.tooltip = "Already applied from this message: apply again";
    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        // One dialog at a time, so a double-click doesn't apply twice
        if (button.disabled) return;
        button.disabled = true;
        try {
            await confirmAndApply(message, entries);
        } catch (error) {
            log(error);
            ui.notifications.error(`Applying ${entries[0].save.spell.name}'s conditions failed: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });
    return button;
}

/** Apply spell effects, timed conditions (as effects with that duration), plain conditions, and linked conditions */
async function applyProposal(save, { effects, conditions }) {
    const { spell, target, outcome } = save;
    const caster = save.casterUuid ? await fromUuid(save.casterUuid) : null;
    const casterToken = getSceneToken(caster);
    const targetToken = getSceneToken(target);
    const conditionUuids = new Map(getConditions().map((c) => [c.slug, c.uuid]));
    const context = (relativeTo) => ({
        origin:
            relativeTo === "target" || !caster
                ? { actor: target.uuid, token: targetToken?.uuid ?? null, item: null, spellcasting: null }
                : { actor: caster.uuid, token: casterToken?.uuid ?? null, item: spell.uuid, spellcasting: null },
        target: { actor: target.uuid, token: targetToken?.uuid ?? null },
        roll: null,
    });
    // A condition with a value needs one: one the text doesn't give as a number is asked for, and left out without it
    const unvalued = conditions.filter((c) => c.valued && !c.value);
    const applicable = conditions.filter((c) => !unvalued.includes(c) && !target.isImmuneTo?.(c.slug));
    // The spell, its caster, rank and DC, for Counteract, which ends what a spell did at its rank and against its DC
    const spellSource = {
        caster: caster?.uuid ?? null,
        spell: spell.uuid,
        name: spell.name,
        rank: spell.rank,
        dc: save.dc ?? spellDC(spell),
    };

    // Spell effects, as pf2e makes them when they're dragged from the save's message
    const toCreate = [];
    for (const { uuid } of effects) {
        const source = await buildSpellEffectSource(uuid, {
            spell,
            target,
            caster: caster ?? spell.actor,
            casterToken,
            rollOptions: save.rollOptions ?? null,
            roll: save.roll ?? null,
        });
        if (!source) continue;
        source.flags = { ...source.flags, [MODULE_ID]: { ...source.flags?.[MODULE_ID], spellSource } };
        preselectDegree(source, outcome);
        toCreate.push(source);
    }

    // Conditions with the same timer share one effect, named for the spell, that removes them when it expires
    const groups = new Map();
    for (const condition of applicable.filter((c) => c.duration?.value && !c.linkedTo)) {
        const { value, unit, expiry, relativeTo, thisTurn } = condition.duration;
        const key = [value, unit, expiry, relativeTo, !!thisTurn].join("|");
        if (!groups.has(key)) groups.set(key, { duration: condition.duration, conditions: [] });
        groups.get(key).conditions.push(condition);
    }
    for (const { duration, conditions: grouped } of groups.values()) {
        const timing = groups.size > 1 ? `, ${describeDuration(duration)}` : "";
        toCreate.push({
            type: "effect",
            name: `${spell.name} (${outcomeLabel(outcome)}${timing})`,
            img: spell.img,
            system: {
                description: { value: `<p>From @UUID[${spell.uuid}]{${spell.name}}.</p>` },
                level: { value: spell.rank },
                duration: {
                    value: isOwnTurnTimer(duration) ? ownTurnRounds(duration, target) : duration.value,
                    unit: duration.unit,
                    expiry: duration.expiry ?? "turn-start",
                    // Lasting for a sustained spell's duration, it ends when the spell isn't Sustained
                    sustained: !!spell.system.duration?.sustained && grouped.some((c) => c.fromSpellDuration),
                },
                tokenIcon: { show: true },
                rules: grouped.map((c) => ({
                    key: "GrantItem",
                    uuid: conditionUuids.get(c.slug),
                    ...(c.value
                        ? { alterations: [{ mode: "override", property: "badge-value", value: c.value }] }
                        : {}),
                })),
                context: context(duration.relativeTo),
            },
            flags: { [MODULE_ID]: { spellConditions: true, spellSource } },
        });
    }
    if (toCreate.length > 0) await target.createEmbeddedDocuments("Item", toCreate);

    // Conditions with no timer: raise an existing one to the new value rather than adding a second. pf2e's
    // increaseCondition, given a value, adds a condition of its own beside one granted by an effect (locked), and with
    // none, raises whichever is active (src/module/actor/base.ts, the same in pf2e 7.x and 8.x).
    const unchanged = [];
    for (const condition of applicable.filter((c) => !c.duration?.value && !c.linkedTo)) {
        const existing = target.itemTypes.condition.find((c) => c.slug === condition.slug && !c.isLocked);
        let applied = null;
        if (!existing) {
            applied = await target.increaseCondition(condition.slug, condition.value ? { value: condition.value } : {});
        } else if (condition.value && (existing.value ?? 0) < condition.value) {
            await game.pf2e.ConditionManager.updateConditionValue(existing.id, target, condition.value);
            applied = target.items.get(existing.id) ?? null;
        }
        if (applied?.update) await applied.update({ [`flags.${MODULE_ID}.spellSource`]: spellSource });
        else if (!applied) unchanged.push(condition);
    }

    // Linked conditions are granted by the condition they depend on, like dying grants unconscious
    const skipped = conditions.filter((c) => !applicable.includes(c));
    for (const condition of applicable.filter((c) => c.linkedTo)) {
        const anchor = target.itemTypes.condition.find((c) => c.slug === condition.linkedTo && c.active);
        if (!anchor) {
            skipped.push(condition);
            continue;
        }
        const rule = {
            key: "GrantItem",
            inMemoryOnly: true,
            uuid: conditionUuids.get(condition.slug),
            ...(condition.value
                ? { alterations: [{ mode: "override", property: "badge-value", value: condition.value }] }
                : {}),
        };
        await anchor.update({ "system.rules": [...anchor._source.system.rules, rule] });
    }

    const appliedConditions = conditions.filter((c) => !skipped.includes(c) && !unchanged.includes(c));
    const summary = summarize({ effects, conditions: appliedConditions });
    const label = (c) => (unvalued.includes(c) ? `${c.name} (no value given)` : c.name);
    const notApplied = skipped.length ? ` Not applied: ${esc(skipped.map(label).join(", "))}.` : "";
    const had = unchanged.length ? ` Already had: ${esc(summarize({ effects: [], conditions: unchanged }))}.` : "";
    // The token's name, which players see only when its nameplate shows to them
    const applied = `${nameMarkup(targetToken ?? target)}: ${esc(summary || "nothing")}.${notApplied}${had}`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: target, token: targetToken }),
        content: `<p><strong>${esc(spell.name)}</strong> ${applied}</p>`,
    });
}

/** Add an "Apply" button to a save rolled against a spell, for users who can edit the creature that rolled it */
async function addApplyButton(message, html) {
    const save = getSave(message);
    const content = html?.querySelector(".message-content");
    if (!save || !save.target.isOwner || !content) return;

    const proposal = await buildProposal(save);
    if (proposal.effects.length === 0 && proposal.conditions.length === 0) return;
    const label = `Apply: ${summarize(proposal, { proposed: true })}`;
    content.append(createApplyButton(message, label, [{ save, proposal }]));
}

/*
 * PF2e Toolbelt's Target Helper, when that module is active, rolls saves without creating save messages and keeps
 * each target's result on the spell's card instead. Its card gets one button covering every target the user can edit.
 */

/** Saves recorded by Target Helper on a spell's card, read when needed so rerolls are included */
function getToolbeltSaves(message) {
    const spell = message.item;
    if (spell?.type !== "spell") return [];
    const tokens = (toolbeltTargets(message, { splash: true }) ?? []).filter(
        (token, index, all) => token.actor && all.indexOf(token) === index,
    );
    const saves = [];
    for (const token of tokens) {
        const result = toolbeltSave(message, token);
        if (!result || !token.actor.isOwner) continue;
        const rollOptions = message.flags.pf2e?.origin?.rollOptions ?? null;
        saves.push({
            spell,
            target: token.actor,
            outcome: result.outcome,
            casterUuid: message.actor?.uuid,
            rollOptions,
        });
    }
    return saves;
}

async function addToolbeltApplyButton(message, html) {
    if (!toolbeltActive()) return;
    const content = html?.querySelector(".message-content");
    const saves = getToolbeltSaves(message);
    if (!content || saves.length === 0) return;

    const entries = [];
    for (const save of saves) {
        const proposal = await buildProposal(save);
        if (proposal.effects.length || proposal.conditions.length) entries.push({ save, proposal });
    }
    if (entries.length === 0) return;
    const label =
        entries.length === 1 ? `Apply to ${entries[0].save.target.name}` : `Apply to ${entries.length} targets`;
    content.append(createApplyButton(message, `${label}: conditions from saves`, entries));
}

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "spellConditions", {
        name: "Spell conditions from saves",
        hint:
            "Add a button to saves rolled against a spell that applies the conditions and spell effects its text " +
            "describes for that result, with their timers, after you check them.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });

    const render = (message, html) => {
        if (!game.settings.get(MODULE_ID, "spellConditions")) return;
        addApplyButton(message, html).catch(log);
        addToolbeltApplyButton(message, html).catch(log);
    };
    Hooks.on("renderChatMessageHTML", render);
});

/** A player's record of whom they applied it to: only the creatures they own that saved against the spell */
function checkApplied({ messageId, actorUuids }, sender) {
    const message = game.messages.get(messageId);
    if (!message) refuse("the message is gone");
    const saves = getSave(message) ? [getSave(message)] : getToolbeltSaves(message);
    const owned = new Set(saves.filter((save) => owns(sender, save.target)).map((save) => save.target.uuid));
    const uuids = (Array.isArray(actorUuids) ? actorUuids : []).filter((uuid) => owned.has(uuid));
    if (uuids.length === 0) refuse(`none of those creatures saved against the spell and are ${sender.name}'s`);
    return { messageId, actorUuids: uuids };
}

/** A player who can't update the message (it's someone else's) has the GM record whom it was applied to */
onGMRequest(
    "spellConditionsApplied",
    async ({ messageId, actorUuids }) => {
        const message = game.messages.get(messageId);
        if (!message) throw new Error("the message is gone");
        const saves = getSave(message) ? [getSave(message)] : getToolbeltSaves(message);
        if (saves.length === 0) throw new Error("the message isn't a save against a spell");
        const uuids = (Array.isArray(actorUuids) ? actorUuids : []).filter((uuid) => typeof uuid === "string");
        const applied = [...new Set([...getApplied(message), ...uuids])];
        await message.update({ [`flags.${MODULE_ID}.spellConditions.applied`]: applied });
    },
    { check: checkApplied },
);
