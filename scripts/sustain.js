/**
 * Sustain support. pf2e's Sustain action only posts its description, without saying what was sustained. This adds a
 * Sustain button beside the Cast button of sustained spells on actor sheets and a prompt listing the caster's
 * sustained effects, and posts the sustained spell's card again. The module's other scripts react through
 * `sustainHandlers` on the module, run in turn so their prompts don't overlap.
 *
 * Sustained durations: a sustained spell lasts until the end of the caster's next turn unless they Sustain it, which
 * extends it to the end of their following turn, up to its maximum duration. Each sustained effect records the round
 * it was last cast or Sustained, and at the end of the caster's turn, those not cast or Sustained that round end.
 *
 * At the start of a player's creature's turn, a whispered chat message lists its sustained spells with Sustain buttons.
 */

import { createdHere, featureHooks, guardApi, hasModuleData, isActiveGM } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("sustain");
/** ID of the pf2e Sustain action item, the same in every pf2e version */
const SUSTAIN_ID = "3f5DMFu8fPiqHpRg";
const SOCKET = `module.${MODULE_ID}`;

function sustainTitle() {
    return game.i18n.localize("PF2E.Actions.Sustain.Title");
}

/** The spell an effect came from, when it was applied from the spell's chat card */
function getOriginSpell(effect) {
    const uuid = effect.system.context?.origin?.item;
    const item = uuid ? fromUuidSync(uuid) : null;
    return item?.type === "spell" ? item : null;
}

/** The creature whose spell an effect is: the origin it was applied with, or the creature it's on */
function getCasterUuid(effect) {
    return effect.system.context?.origin?.actor ?? effect.actor?.uuid;
}

/** A caster's sustained effects on any creature in a scene */
function getSustainedEffects(caster, scene) {
    const actors = new Set([caster, ...(scene?.tokens.map((t) => t.actor).filter((a) => a) ?? [])]);
    return [...actors].flatMap((actor) =>
        actor.itemTypes.effect.filter((e) => e.system.duration.sustained && getCasterUuid(e) === caster.uuid),
    );
}

/** Record that effects were cast or Sustained this round */
async function recordSustained(effectUuids) {
    const combat = game.combat;
    if (!combat?.started) return;
    for (const uuid of effectUuids) {
        const effect = await fromUuid(uuid);
        await effect?.update({ [`flags.${MODULE_ID}.sustained`]: { combat: combat.id, round: combat.round } });
    }
}

/** The effects a Sustain keeps going: the chosen one, and the caster's sustained effects from the same spell */
function getEffectsToSustain(caster, { spell, effect }) {
    const effects = getSustainedEffects(caster, canvas.scene);
    const spellUuid = spell?.uuid ?? effect?.system.context?.origin?.item;
    const fromSpell = effects.filter((e) => spellUuid && e.system.context?.origin?.item === spellUuid);
    // Effects not applied from the spell's chat card are matched by name, like "Aura: Manifest Will (Arcane)"
    const byName = spell && fromSpell.length === 0 ? effects.filter((e) => e.name.includes(spell.name)) : [];
    return [...new Set([effect, ...fromSpell, ...byName].filter((e) => e))];
}

async function sustainEffects(caster, data) {
    const uuids = getEffectsToSustain(caster, data).map((e) => e.uuid);
    if (uuids.length === 0 || !game.combat?.started) return;
    if (game.user.isGM) return recordSustained(uuids);
    // Players can't edit effects on creatures they don't own, so the active GM records them
    game.socket.emit(SOCKET, { action: "recordSustained", effectUuids: uuids });
}

/** At the end of a caster's turn, end their sustained effects that weren't cast or Sustained that round */
async function endUnsustained(combat) {
    const previous = combat.previous;
    const caster = combat.combatants.get(previous?.combatantId ?? "")?.actor;
    if (!caster || previous.round === null) return;
    // Going back through the turn order doesn't end anything
    if (combat.round < previous.round || (combat.round === previous.round && combat.turn < previous.turn)) return;

    for (const effect of getSustainedEffects(caster, combat.scene ?? canvas.scene)) {
        const record = effect.flags[MODULE_ID]?.sustained;
        if (record?.combat !== combat.id) {
            // Cast before this encounter or before this was installed: count it as cast this round
            await effect.update({ [`flags.${MODULE_ID}.sustained`]: { combat: combat.id, round: previous.round } });
        } else if (record.round < previous.round) {
            const target = effect.actor;
            await effect.delete();
            const esc = Handlebars.escapeExpression;
            const on = target === caster ? "" : ` on ${esc(target.name)}`;
            const reason = `${esc(caster.name)} didn't Sustain it.`;
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: caster }),
                content: `<p><strong>${esc(effect.name)}</strong>${on} ends: ${reason}</p>`,
            });
        }
    }
}

/**
 * Post that a spell was sustained, then let automations react. When the spell is known, its card is posted again at
 * the rank it was cast, so damage, attacks, saves, and templates can be rolled from it. Nothing is spent.
 */
async function sustain(actor, { spell = null, effect = null, castRank = null } = {}) {
    spell ??= effect ? getOriginSpell(effect) : null;
    // An effect dragged from the spell's chat card has the spell's cast rank as its level
    castRank ??= spell && effect ? Math.max(spell.rank, effect.system.level?.value ?? 0) : (spell?.rank ?? null);
    const hex = !!(spell?.traits.has("hex") || effect?.system.traits?.value?.includes("hex"));
    const esc = Handlebars.escapeExpression;
    const glyph = `<span class="pf2-icon larger">1</span>`;
    const header = `<h4 class="action"><strong>${esc(sustainTitle())}</strong> ${glyph}</h4>`;
    // Marks the message as a Sustain rather than a cast
    const flags = { sustain: true };

    const card = spell?.actor ? await spell.toMessage(undefined, { create: false, data: { castRank } }) : null;
    if (card) {
        const source = card.toObject();
        source.flavor = `${header}${source.flavor ?? ""}`;
        source.flags[MODULE_ID] = flags;
        await ChatMessage.implementation.create(source);
    } else {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `${header}<p>${esc(actor.name)} Sustains <strong>${esc(effect?.name ?? "a spell")}</strong>.</p>`,
            flags: { [MODULE_ID]: flags },
        });
    }

    const data = { spell, effect, hex };
    await sustainEffects(actor, data);
    for (const handler of game.modules.get(MODULE_ID).sustainHandlers ?? []) {
        try {
            await handler(actor, data);
        } catch (error) {
            console.error(`${MODULE_ID} | Sustain`, error);
        }
    }
}

/**
 * A caster's sustained spells: their sustained effects on any creature in the scene, one entry per spell (Sustaining
 * one of a spell's effects Sustains them all), each with the creatures it's on
 */
function getSustainedSpells(caster, scene = canvas.scene) {
    const spells = new Map();
    for (const effect of getSustainedEffects(caster, scene)) {
        if (effect.remainingDuration.expired) continue;
        const key = effect.system.context?.origin?.item ?? effect.uuid;
        if (!spells.has(key)) spells.set(key, { effect, name: getOriginSpell(effect)?.name ?? effect.name, on: [] });
        const entry = spells.get(key);
        // Sustain the caster's own effect when there is one, so it's the one named
        if (effect.actor === caster && entry.effect.actor !== caster) entry.effect = effect;
        if (!entry.on.includes(effect.actor)) entry.on.push(effect.actor);
    }
    return [...spells.values()];
}

/** Choose which of a caster's sustained spells to Sustain, whether its effects are on the caster or other creatures */
async function promptSustain(actor, { skipIfSingle = false } = {}) {
    const spells = getSustainedSpells(actor);
    if (spells.length === 0) {
        ui.notifications.info(
            `${actor.name} has no sustained effects. Use the Sustain button beside the spell's Cast button instead.`,
        );
        return;
    }
    if (skipIfSingle && spells.length === 1) return sustain(actor, { effect: spells[0].effect });

    const esc = Handlebars.escapeExpression;
    const content = spells
        .map(({ name, on }, index) => {
            const others = on.filter((a) => a !== actor).map((a) => a.name);
            const where =
                others.length > 0
                    ? ` <em>(on ${esc([...(on.includes(actor) ? ["you"] : []), ...others].join(", "))})</em>`
                    : "";
            return [
                `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
                `<input type="radio" name="choice" value="${index}" ${index === 0 ? "checked" : ""}>`,
                `<span>${esc(name)}${where}</span>`,
                `</label>`,
            ].join("");
        })
        .join("");

    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: `${sustainTitle()}: ${actor.name}` },
        content,
        buttons: [
            {
                action: "sustain",
                label: sustainTitle(),
                default: true,
                callback: (_event, button) => button.form.elements.choice.value,
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
    if (typeof choice !== "string" || !/^\d+$/.test(choice)) return;
    return sustain(actor, { effect: spells[Number(choice)]?.effect });
}

const BUTTON_GAP = 4;

/** The width of a button styled like `reference` showing `label` */
function measureButton(reference, label) {
    const style = getComputedStyle(reference);
    const context = (measureButton.canvas ??= document.createElement("canvas")).getContext("2d");
    context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = style.textTransform === "uppercase" ? label.toUpperCase() : label;
    const edges = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"];
    const extra = edges.reduce((sum, property) => sum + (parseFloat(style[property]) || 0), 0);
    return Math.max(Math.ceil(context.measureText(text).width + extra), parseFloat(style.minWidth) || 0);
}

/** Add a Sustain button beside the Cast button of each sustained spell on a creature's sheet */
function addSheetSustainButtons(sheet, html) {
    const actor = sheet.actor;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!actor?.isOwner || !actor.spellcasting || !root) return;

    const lists = new Set();
    for (const row of root.querySelectorAll("ol.spell-list > li.spell[data-item-id][data-entry-id]")) {
        const castButton = row.querySelector('button.cast-spell[data-action="cast-spell"]');
        const { itemId, entryId, castRank } = row.dataset;
        const spell = actor.spellcasting.collections.get(entryId)?.get(itemId);
        if (!castButton || !spell?.system.duration?.sustained) continue;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "cast-spell blue ehb-sheet-sustain";
        button.textContent = sustainTitle();
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rank = Number(castRank) || spell.rank;
            sustain(actor, { spell, castRank: rank }).catch((error) => console.error(`${MODULE_ID} | Sustain`, error));
        });

        const wrapper = document.createElement("div");
        wrapper.style.cssText = `display: flex; gap: ${BUTTON_GAP}px; justify-self: end`;
        castButton.replaceWith(wrapper);
        wrapper.append(button, castButton);
        lists.add(row.parentElement);
    }

    // Each row is its own grid: widen the Cast column on every row of the list so the columns stay aligned
    for (const list of lists) {
        const castButtons = [...list.querySelectorAll(":scope > li button.cast-spell:not(.ehb-sheet-sustain)")];
        if (castButtons.length === 0) continue;
        const castWidth = Math.max(...castButtons.map((b) => measureButton(b, b.textContent.trim())));
        const width = castWidth + BUTTON_GAP + measureButton(castButtons[0], sustainTitle());
        for (const item of list.children) item.style.setProperty("--cast-spell-width", `${width}px`);
    }
}

/**
 * PF2e HUD's spell sidebar, when that module is active, lists spells with a play icon to cast them: add an hourglass
 * icon beside it for sustained spells. Its rows carry the same spell, entry, and cast rank data as the sheet's.
 */
function addHudSustainButtons(app, element) {
    if (!game.modules.get("pf2e-hud")?.active || !(element instanceof HTMLElement)) return;
    const actor = app.actor;
    if (!actor?.isOwner || !actor.spellcasting) return;

    for (const row of element.querySelectorAll(".item[data-item-id][data-entry-id]")) {
        const cast = row.querySelector('a.cast[data-action="cast-spell"]');
        const { itemId, entryId, castRank } = row.dataset;
        const spell = actor.spellcasting.collections.get(entryId)?.get(itemId);
        if (!cast || !spell?.system.duration?.sustained || row.querySelector("a.ehb-sustain")) continue;

        const button = document.createElement("a");
        button.className = "ehb-sustain";
        button.dataset.tooltip = sustainTitle();
        button.innerHTML = `<i class="fa-solid fa-hourglass-half"></i>`;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rank = Number(castRank) || spell.rank;
            sustain(actor, { spell, castRank: rank }).catch((error) => console.error(`${MODULE_ID} | Sustain`, error));
        });
        cast.before(button);
    }
}

/** Whether a chat message is pf2e's own Sustain action, which doesn't say what was sustained */
function isSystemSustain(message) {
    if (hasModuleData(message)) return false;
    const item = message.item;
    const uuids = [item?.sourceId, item?.uuid, message.flags.pf2e?.origin?.uuid];
    if (uuids.some((uuid) => String(uuid ?? "").endsWith(`.${SUSTAIN_ID}`))) return true;
    if (item) return false;

    const content = new DOMParser().parseFromString(message.content ?? "", "text/html");
    return content.querySelector("h4.action strong")?.textContent.trim() === sustainTitle();
}

/*
 * Turn-start reminder: when a player's creature starts its turn in an encounter with sustained spells going, a chat
 * message whispered to its owners lists them, each with a Sustain button.
 */

const REMINDER_ROWS = "ehb-sustain-reminder";

/** Whether the turn order moved forward, rather than back */
function movedForward(combat) {
    const previous = combat.previous;
    if (previous?.round === null || previous?.round === undefined) return true;
    return combat.round > previous.round || (combat.round === previous.round && combat.turn > previous.turn);
}

async function postReminder(combat) {
    const actor = combat.combatant?.actor;
    if (!actor?.hasPlayerOwner || !movedForward(combat)) return;
    const spells = getSustainedSpells(actor, combat.scene ?? canvas.scene);
    if (spells.length === 0) return;
    // Once per turn, even if the turn is set again
    const posted = game.messages.contents.slice(-50).some((m) => {
        const r = m.flags[MODULE_ID]?.sustainReminder;
        return r?.combat === combat.id && r.round === combat.round && r.actorUuid === actor.uuid;
    });
    if (posted) return;

    const esc = Handlebars.escapeExpression;
    const ends = game.settings.get(MODULE_ID, "sustainedDurations")
        ? `<p style="font-size: var(--font-size-12)"><em>Spells not Sustained this turn end at its end.</em></p>`
        : "";
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor, token: combat.combatant.token }),
        content: `<p><strong>${esc(actor.name)}</strong> can Sustain:</p><div class="${REMINDER_ROWS}"></div>${ends}`,
        whisper: game.users.filter((u) => actor.testUserPermission(u, "OWNER")).map((u) => u.id),
        flags: {
            [MODULE_ID]: {
                sustainReminder: {
                    actorUuid: actor.uuid,
                    combat: combat.id,
                    round: combat.round,
                    spells: spells.map(({ effect, name }) => ({ effectUuid: effect.uuid, name })),
                },
            },
        },
    });
}

/** Whether a sustained effect was Sustained (or cast) in the reminder's round or later */
function wasSustained(effect, reminder) {
    const record = effect.flags[MODULE_ID]?.sustained;
    return record?.combat === reminder.combat && record.round >= reminder.round;
}

/** The reminder's rows: each spell with where it is, what's left of it, and a Sustain button for its owners */
function renderReminder(message, html) {
    const reminder = message.flags[MODULE_ID]?.sustainReminder;
    const container = reminder ? html?.querySelector(`.${REMINDER_ROWS}`) : null;
    if (!container) return;
    const actor = fromUuidSync(reminder.actorUuid);
    const esc = Handlebars.escapeExpression;

    const rows = reminder.spells.map(({ effectUuid, name }) => {
        const effect = fromUuidSync(effectUuid);
        const row = document.createElement("div");
        row.style.cssText = "display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0";
        const label = document.createElement("span");
        label.style.flex = "1";
        let detail = "";
        if (effect && actor) {
            const on = getSustainedSpells(actor).find((s) => s.effect === effect || s.name === name)?.on ?? [];
            const others = on.filter((a) => a !== actor).map((a) => a.name);
            const where = others.length > 0 ? [...(on.includes(actor) ? ["you"] : []), ...others].join(", ") : "";
            const remaining = effect.remainingDuration?.remaining;
            const rounds = Number.isFinite(remaining) ? Math.max(1, Math.ceil(remaining / 6)) : null;
            const left = rounds ? `${rounds} ${rounds === 1 ? "round" : "rounds"} left` : "";
            detail = [where && `on ${esc(where)}`, left].filter((d) => d).join("; ");
        }
        label.innerHTML = `<strong>${esc(name)}</strong>${detail ? ` <em>(${detail})</em>` : ""}`;
        row.append(label);

        const status = (text) => {
            const note = document.createElement("em");
            note.textContent = text;
            return note;
        };
        if (!effect || effect.remainingDuration?.expired) {
            row.append(status("Ended"));
        } else if (wasSustained(effect, reminder)) {
            row.append(status("Sustained"));
        } else if (actor?.isOwner) {
            const button = document.createElement("button");
            button.type = "button";
            button.style.cssText = "flex: 0 0 auto; width: auto; line-height: 1.5";
            button.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ${esc(sustainTitle())}`;
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                button.disabled = true;
                try {
                    await sustain(actor, { effect });
                    button.replaceWith(status("Sustained"));
                } catch (error) {
                    button.disabled = false;
                    console.error(`${MODULE_ID} | Sustain`, error);
                }
            });
            row.append(button);
        }
        return row;
    });
    container.replaceChildren(...rows);
}

hooks.on("renderChatMessageHTML", (message, html) => {
    try {
        renderReminder(message, html);
    } catch (error) {
        console.error(`${MODULE_ID} | Sustain`, error);
    }
});

// When an effect is Sustained or ends, show it on the turn's reminder for everyone who sees it
function refreshReminders(item) {
    if (item.type !== "effect") return;
    for (const message of game.messages.contents.slice(-50)) {
        const spells = message.flags[MODULE_ID]?.sustainReminder?.spells;
        if (spells?.some((s) => s.effectUuid === item.uuid)) ui.chat?.updateMessage?.(message);
    }
}
hooks.on("updateItem", (item, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.sustained`)) refreshReminders(item);
});
hooks.on("deleteItem", (item) => refreshReminders(item));

// When pf2e's Sustain action is posted, ask what was sustained
hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId) || !isSystemSustain(message)) return;
    const actor = message.actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (!actor) return;
    promptSustain(actor, { skipIfSingle: true }).catch((error) => console.error(`${MODULE_ID} | Sustain`, error));
});

// pf2e's actor sheets use Foundry's original sheet framework in v13 and v14, whose render hooks pass jQuery
hooks.on("renderActorSheet", (sheet, html) => addSheetSustainButtons(sheet, html));
hooks.on("renderApplicationV2", (app, element) => addHudSustainButtons(app, element));

// A sustained effect cast during an encounter counts as cast that round
hooks.on("createItem", (item) => {
    const combat = game.combat;
    if (!isActiveGM() || !combat?.started || !game.settings.get(MODULE_ID, "sustainedDurations")) {
        return;
    }
    if (item.type !== "effect" || !item.system.duration.sustained || item.flags[MODULE_ID]?.sustained) return;
    item.update({ [`flags.${MODULE_ID}.sustained`]: { combat: combat.id, round: combat.round } });
});

// The end of a turn ends what wasn't Sustained, then the next creature's turn starts with its reminder
hooks.on("updateCombat", async (combat, changed) => {
    if (!isActiveGM() || !combat.started || !("turn" in changed || "round" in changed)) return;
    const log = (error) => console.error(`${MODULE_ID} | Sustain`, error);
    if (game.settings.get(MODULE_ID, "sustainedDurations")) await endUnsustained(combat).catch(log);
    if (game.settings.get(MODULE_ID, "sustainReminder")) await postReminder(combat).catch(log);
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "recordSustained" || !isActiveGM()) return;
        await recordSustained(data.effectUuids);
    });
});

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "sustainedDurations", {
        name: "Sustained spells end if not Sustained",
        hint:
            "During an encounter, a sustained spell's effects end at the end of the caster's turn unless the spell " +
            "was cast or Sustained that turn (with the module's Sustain button or the Sustain action).",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, "sustainReminder", {
        name: "Sustain reminder at the start of a turn",
        hint:
            "During an encounter, when a player's creature starts its turn with sustained spells going, a chat " +
            "message whispered to its owners lists them, with a Sustain button for each.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });

    // For a macro: Sustain one of the selected token's (or your character's) sustained effects
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        sustain: guardApi("sustain", (actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character) =>
            actor ? promptSustain(actor) : ui.notifications.warn("Select a token to Sustain for."),
        ),
    };
});

export { isSystemSustain };
