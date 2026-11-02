/**
 * Spell conditions: when a creature rolls a save against a spell, read the spell's text for that degree of success
 * and offer to apply what it says: linked spell effects, and conditions with their values and timers. A condition
 * that lasts as long as another ("Slowed 1 as long as it's sickened") is granted by that condition, so pf2e shows it
 * as linked and removes it along with it, as it does for dying and unconscious.
 */

import { getGrantedConditions, OUTCOMES, parseSpellOutcome, preselectDegree } from "./lib/spell-condition-parser.js";

const MODULE_ID = "evan-character-homebrew";
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
        });
    }
    return [...conditions.values()];
}

function getOutcomeLabel(outcome) {
    return game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
}

function getLabels() {
    const english = {
        criticalSuccess: "Critical Success",
        success: "Success",
        failure: "Failure",
        criticalFailure: "Critical Failure",
    };
    return Object.fromEntries(OUTCOMES.map((o) => [o, [...new Set([english[o], getOutcomeLabel(o)])]]));
}

function describeDuration(duration) {
    if (duration?.dice) return `${duration.dice} ${duration.unit}`;
    if (!duration?.value) return null;
    if (duration.value === 1 && duration.unit === "rounds" && duration.expiry === "turn-end") {
        return duration.relativeTo === "caster"
            ? "until the end of the caster's next turn"
            : "until the end of its next turn";
    }
    const [one, many] = UNIT_LABELS[duration.unit] ?? [duration.unit, duration.unit];
    return `${duration.value} ${duration.value === 1 ? one : many}`;
}

/** The save message's spell, outcome, and the creature that rolled it, if it's a save against a spell */
function getSave(message) {
    const context = message.flags.pf2e?.context;
    if (context?.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) return null;
    const spell = message.item;
    const target = message.actor;
    if (spell?.type !== "spell" || !target) return null;
    return { spell, target, outcome: context.outcome, casterUuid: context.origin?.actor ?? spell.actor?.uuid };
}

/** What the spell's text says happens to the creature, without conditions its linked spell effects already grant */
async function buildProposal({ spell, outcome }) {
    const conditions = getConditions();
    const parsed = parseSpellOutcome(spell.system.description.value, outcome, {
        conditions,
        labels: getLabels(),
        spellDuration: spell.system.duration?.value,
    });

    const effects = [];
    const granted = new Set();
    for (const link of parsed.effects) {
        const effect = await fromUuid(link.effect);
        if (!effect) continue;
        effects.push({ uuid: effect.uuid, name: effect.name });
        for (const slug of getGrantedConditions(effect.toObject(), conditions)) granted.add(slug);
    }

    const names = new Map(conditions.map((c) => [c.slug, c.name]));
    const proposed = parsed.conditions
        .filter((c) => !granted.has(c.slug))
        .map((c) => ({ ...c, name: names.get(c.slug) ?? c.slug }));
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

function summarize({ effects, conditions }) {
    const names = new Map(conditions.map((c) => [c.slug, c.name]));
    return [
        ...effects.map((e) => e.name),
        ...conditions.map((c) => {
            const label = `${c.name}${c.value ? ` ${c.value}` : ""}`;
            const timing = c.linkedTo ? `while ${names.get(c.linkedTo) ?? c.linkedTo}` : describeDuration(c.duration);
            return timing ? `${label} (${timing})` : label;
        }),
    ].join(", ");
}

/** Let the user check and adjust the proposal before applying it */
async function confirmProposal(save, proposal) {
    const esc = Handlebars.escapeExpression;
    const names = new Map(proposal.conditions.map((c) => [c.slug, c.name]));
    const row = (content) =>
        `<div style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">${content}</div>`;
    const unitOptions = (selected) =>
        Object.entries(UNIT_LABELS)
            .map(
                ([unit, [, many]]) => `<option value="${unit}" ${unit === selected ? "selected" : ""}>${many}</option>`,
            )
            .join("");

    const effectRows = proposal.effects.map((effect, index) =>
        row(`<label><input type="checkbox" name="effect-${index}" checked> ${esc(effect.name)}</label>`),
    );
    const conditionRows = proposal.conditions.map((condition, index) => {
        const value = condition.value
            ? `<input type="number" name="value-${index}" value="${condition.value}" min="1" style="width: 3.5em">`
            : "";
        let timing;
        if (condition.linkedTo) {
            timing = `<em>while ${esc(names.get(condition.linkedTo) ?? condition.linkedTo)}</em>`;
        } else if (condition.duration?.expiry === "turn-end" && condition.duration.value === 1) {
            timing = `<em>${esc(describeDuration(condition.duration))}</em>`;
        } else {
            const note = condition.duration?.rolled ?? (condition.fromSpellDuration ? "spell's duration" : "");
            timing = [
                `for <input type="number" name="duration-${index}" value="${condition.duration?.value ?? ""}"`,
                ` min="1" placeholder="no timer" style="width: 5.5em">`,
                `<select name="unit-${index}">${unitOptions(condition.duration?.unit ?? "rounds")}</select>`,
                note ? ` <em>(${esc(note)})</em>` : "",
            ].join("");
        }
        const checkbox = `<input type="checkbox" name="condition-${index}" checked>`;
        return row(`<label>${checkbox} ${esc(condition.name)}</label>${value} ${timing}`);
    });

    const outcomeLabel = getOutcomeLabel(save.outcome);
    const content = [
        `<p>${esc(save.target.name)}'s save against ${esc(save.spell.name)}: ${esc(outcomeLabel)}.</p>`,
        ...effectRows,
        ...conditionRows,
        `<p style="font-size: var(--font-size-12)">Leave the timer empty for no timer.</p>`,
    ].join("");

    return foundry.applications.api.DialogV2.wait({
        window: { title: `${save.spell.name}: Apply Conditions` },
        content,
        buttons: [
            {
                action: "apply",
                label: "Apply",
                default: true,
                callback: (_event, button) => {
                    const form = button.form.elements;
                    const effects = proposal.effects.filter((_e, i) => form[`effect-${i}`]?.checked);
                    const conditions = proposal.conditions.flatMap((condition, i) => {
                        if (!form[`condition-${i}`]?.checked) return [];
                        const value = form[`value-${i}`] ? Number(form[`value-${i}`].value) || condition.value : null;
                        const durationInput = form[`duration-${i}`];
                        if (!durationInput) return [{ ...condition, value }];
                        const amount = Number(durationInput.value);
                        const duration = amount
                            ? {
                                  ...(condition.duration ?? { expiry: "turn-start", relativeTo: "caster" }),
                                  value: amount,
                              }
                            : null;
                        if (duration) duration.unit = form[`unit-${i}`].value;
                        return [{ ...condition, value, duration }];
                    });
                    return { effects, conditions };
                },
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
}

/** Apply spell effects, timed conditions (as effects with that duration), plain conditions, and linked conditions */
async function applyProposal(save, { effects, conditions }) {
    const { spell, target, outcome } = save;
    const caster = save.casterUuid ? await fromUuid(save.casterUuid) : null;
    const casterToken = caster?.getActiveTokens(true, true).find((t) => t.parent === canvas.scene) ?? null;
    const targetToken = target.getActiveTokens(true, true).find((t) => t.parent === canvas.scene) ?? null;
    const conditionUuids = new Map(getConditions().map((c) => [c.slug, c.uuid]));
    const context = (relativeTo) => ({
        origin:
            relativeTo === "target" || !caster
                ? { actor: target.uuid, token: targetToken?.uuid ?? null, item: null, spellcasting: null }
                : { actor: caster.uuid, token: casterToken?.uuid ?? null, item: spell.uuid, spellcasting: null },
        target: { actor: target.uuid, token: targetToken?.uuid ?? null },
        roll: null,
    });
    const applicable = conditions.filter((c) => !target.isImmuneTo?.(c.slug));

    const toCreate = [];
    for (const { uuid } of effects) {
        const effect = await fromUuid(uuid);
        if (!effect) continue;
        const source = effect.toObject();
        source._stats = { ...source._stats, compendiumSource: uuid };
        source.system.level = { value: spell.rank };
        source.system.context = context("caster");
        preselectDegree(source, outcome);
        toCreate.push(source);
    }

    // Conditions with the same timer share one effect, named for the spell, that removes them when it expires
    const groups = new Map();
    for (const condition of applicable.filter((c) => c.duration?.value && !c.linkedTo)) {
        const { value, unit, expiry, relativeTo } = condition.duration;
        const key = [value, unit, expiry, relativeTo].join("|");
        if (!groups.has(key)) groups.set(key, { duration: condition.duration, conditions: [] });
        groups.get(key).conditions.push(condition);
    }
    for (const { duration, conditions: grouped } of groups.values()) {
        const timing = groups.size > 1 ? `, ${describeDuration(duration)}` : "";
        toCreate.push({
            type: "effect",
            name: `${spell.name} (${getOutcomeLabel(outcome)}${timing})`,
            img: spell.img,
            system: {
                description: { value: `<p>From @UUID[${spell.uuid}]{${spell.name}}.</p>` },
                level: { value: spell.rank },
                duration: {
                    value: duration.value,
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
            flags: { [MODULE_ID]: { spellConditions: true } },
        });
    }
    if (toCreate.length > 0) await target.createEmbeddedDocuments("Item", toCreate);

    // Conditions with no timer: raise an existing one to the new value rather than adding a second
    for (const condition of applicable.filter((c) => !c.duration?.value && !c.linkedTo)) {
        const existing = target.itemTypes.condition.find((c) => c.slug === condition.slug && !c.isLocked);
        if (!existing) {
            await target.increaseCondition(condition.slug, condition.value ? { value: condition.value } : {});
        } else if (condition.value && (existing.value ?? 0) < condition.value) {
            await game.pf2e.ConditionManager.updateConditionValue(existing.id, target, condition.value);
        }
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

    const esc = Handlebars.escapeExpression;
    const appliedConditions = conditions.filter((c) => !skipped.includes(c));
    const summary = summarize({ effects, conditions: appliedConditions });
    const notApplied = skipped.length ? ` Not applied: ${esc(skipped.map((c) => c.name).join(", "))}.` : "";
    const applied = `${esc(target.name)}: ${esc(summary || "nothing")}.${notApplied}`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: target }),
        content: `<p><strong>${esc(spell.name)}</strong> ${applied}</p>`,
    });
}

/** Add an "Apply" button to a save rolled against a spell, for users who can edit the creature that rolled it */
async function addApplyButton(message, html) {
    if (!game.settings.get(MODULE_ID, "spellConditions")) return;
    const save = getSave(message);
    const content = html?.querySelector(".message-content");
    if (!save || !save.target.isOwner || !content) return;

    const proposal = await buildProposal(save);
    if (proposal.effects.length === 0 && proposal.conditions.length === 0) return;

    const button = document.createElement("button");
    button.type = "button";
    button.style.marginTop = "0.25em";
    button.textContent = `Apply: ${summarize(proposal)}`;
    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            const confirmed = await confirmProposal(save, await rollDurations(proposal));
            if (confirmed?.effects) await applyProposal(save, confirmed);
        } catch (error) {
            console.error(`${MODULE_ID} | Spell conditions`, error);
            ui.notifications.error(`Applying ${save.spell.name}'s conditions failed: ${error.message}`);
        }
    });
    content.append(button);
}

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "spellConditions", {
        name: "Spell conditions from saves",
        hint:
            "Add a button to saves rolled against a spell that applies the conditions and spell effects its text " +
            "describes for that result, with their timers, after you check them.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    const render = (message, html) => {
        addApplyButton(message, html).catch((error) => console.error(`${MODULE_ID} | Spell conditions`, error));
    };
    if (game.release.generation >= 13) {
        Hooks.on("renderChatMessageHTML", render);
    } else {
        Hooks.on("renderChatMessage", (message, $html) => render(message, $html[0]));
    }
});
