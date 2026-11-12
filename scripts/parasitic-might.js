/**
 * Familiar of Parasitic Might (Devourer of Decay witch patron): "When you Cast or Sustain a hex, your familiar can draw
 * on the waning strength of another to sustain itself. One creature within 15 feet of your familiar with less than half
 * of its maximum Hit Points becomes sickened 1 unless it succeeds at a Fortitude saving throw against your spell DC."
 * pf2e only boxes this in hex descriptions. Here, casting or Sustaining a hex asks the witch's user which creature the
 * familiar drains, then posts a card with a button for the creature to roll its Fortitude save; a failure makes it
 * sickened 1. A Fortitude save rolled from the box pf2e adds to the hex's card is handled too.
 */

import { canAnimate, createdHere, featureHooks, guardApi, isActiveGM, isEnabled } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("parasiticMight");
const SOCKET = `module.${MODULE_ID}`;
/** IDs of the pf2e compendium items, the same in every pf2e version */
const ABILITY_ID = "J5Wyh1EPmk848ivR";
const DEVOURER_OF_DECAY_ID = "T9wA833bzZVlB3Lo";
const RANGE = 15;
/** Saves rolled from this module's card carry this identifier, followed by the card's ID */
const SAVE_IDENTIFIER = "parasitic-might:";
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const FAILED = new Set(["failure", "criticalFailure"]);
const TITLE = "Familiar of Parasitic Might";

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | Parasitic Might`, error);
const outcomeLabel = (outcome) => game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));

/**
 * Whether the witch's familiar has the ability. pf2e grants it through the witch's patron (Devourer of Decay), which
 * boxes it in hex descriptions instead of adding it to the familiar, but it can also be on the familiar's sheet.
 */
function hasParasiticMight(witch, familiar = witch?.familiar) {
    if (!witch?.items) return false;
    const fromPatron = witch.items.some(
        (i) =>
            endsWithId(i, DEVOURER_OF_DECAY_ID) ||
            JSON.stringify(i._source.system.rules ?? []).includes("ParasiticMight"),
    );
    return (
        fromPatron ||
        !!familiar?.items.some(
            (i) => endsWithId(i, ABILITY_ID) || i.name.toLowerCase() === "familiar of parasitic might",
        )
    );
}

const warned = new Set();
function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    ui.notifications.warn(`${TITLE}: ${message}`);
}

/** Whether a chat message is the card of a hex being cast */
function isHexCast(message) {
    // Sustaining reposts the spell's card: the Sustain handler below covers it
    if (message.flags[MODULE_ID]?.sustain) return false;
    const flags = message.flags.pf2e ?? {};
    const item = message.item;
    // Attack and damage rolls from the spell also carry it: only the cast card has no other roll context
    const contextType = flags.context?.type;
    return (
        item?.type === "spell" &&
        item.traits.has("hex") &&
        !!flags.casting &&
        (!contextType || contextType === "spell-cast")
    );
}

/** The witch's spell DC: the hex's, or that of another hex they have */
function getSpellDC(witch, spell) {
    const statistic =
        spell?.spellcasting?.statistic ??
        witch.itemTypes.spell.find((s) => s.traits.has("hex") && s.spellcasting?.statistic)?.spellcasting.statistic;
    return statistic?.dc.value ?? null;
}

function getSceneToken(actor, scene = canvas.scene) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === scene) ?? null;
}

function getSickened(actor) {
    return actor.itemTypes.condition.find((c) => c.slug === "sickened" && c.active) ?? null;
}

/** Creatures within 15 feet of the familiar with less than half their maximum Hit Points, enemies first */
function getCandidates(witch, familiarToken) {
    const candidates = [];
    for (const token of familiarToken.parent.tokens) {
        const actor = token.actor;
        if (!actor?.isOfType?.("creature") || token === familiarToken || actor === familiarToken.actor) continue;
        if (token.hidden || !token.object || !familiarToken.object || actor.isDead || token.combatant?.defeated) {
            continue;
        }
        if (familiarToken.object.distanceTo(token.object) > RANGE) continue;
        const hp = actor.hitPoints ?? actor.attributes?.hp;
        if (!hp?.max || !(hp.value < hp.max / 2)) continue;
        candidates.push({
            token,
            enemy: actor.isEnemyOf(witch),
            immune: actor.isImmuneTo("sickened"),
            sickened: getSickened(actor)?.value ?? 0,
        });
    }
    // Those it would affect first: enemies, then creatures that aren't already sickened or immune
    const rank = (c) => (c.enemy ? 0 : 2) + (c.immune || c.sickened ? 1 : 0);
    return candidates.sort((a, b) => rank(a) - rank(b));
}

/** JB2A (free) animations: a strand from the creature to the familiar, by the longest distance each file covers */
const JB2A_LIBRARY = "modules/JB2A_DnD5e/Library";
const DRAIN_STRANDS = [
    [5, "Generic/Energy/EnergyStrand_01_Regular_Purple_05ft_600x400.webm"],
    [15, "Generic/Energy/EnergyStrand_01_Regular_Purple_15ft_1000x400.webm"],
    [30, "Generic/Energy/EnergyStrand_01_Regular_Purple_30ft_1600x400.webm"],
];
const DRAIN_IN = "Generic/Energy/EnergyStrandIN01_01_Regular_Green_600x600.webm";

/** The familiar draws a strand of the creature's strength into itself */
function playDrainAnimation(familiarToken, targetToken) {
    if (!canAnimate()) return;
    if (!familiarToken.object || !targetToken.object) return;

    const distance = familiarToken.object.distanceTo(targetToken.object);
    const strand = (DRAIN_STRANDS.find(([feet]) => distance <= feet) ?? DRAIN_STRANDS.at(-1))[1];
    new Sequence()
        .effect()
        .file(`${JB2A_LIBRARY}/${strand}`)
        .atLocation(targetToken)
        .stretchTo(familiarToken)
        .effect()
        .file(`${JB2A_LIBRARY}/${DRAIN_IN}`)
        .atLocation(familiarToken)
        .scaleToObject(1.5)
        .delay(400)
        .fadeIn(200)
        .fadeOut(400)
        .play();
}

/** Prompt the witch's user to choose a creature for the familiar to drain, then post the save card */
async function promptParasiticMight(actor, { spell = null } = {}) {
    const witch = actor?.isOfType?.("familiar") ? actor.master : actor;
    if (!witch?.isOfType?.("character")) return;
    const familiar = witch.familiar;
    if (!hasParasiticMight(witch, familiar)) return;
    if (!familiar) return warnOnce(`${witch.name} has no familiar actor linked.`);

    // The 15-foot range is measured from the familiar
    const familiarToken = getSceneToken(familiar);
    if (!familiarToken) return warnOnce(`${familiar.name} has no token on this scene.`);
    const candidates = getCandidates(witch, familiarToken);
    if (candidates.length === 0) return;
    const dc = getSpellDC(witch, spell);
    if (!dc) return warnOnce(`${witch.name} has no hex to take a spell DC from.`);

    const defaultIndex = Math.max(
        0,
        candidates.findIndex((c) => !c.immune && !c.sickened),
    );
    const choices = candidates.map(({ token, immune, sickened }, index) => {
        const notes = [immune ? "immune to sickened" : null, sickened ? `already sickened ${sickened}` : null]
            .filter((n) => n)
            .join(", ");
        return [
            `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
            `<input type="radio" name="choice" value="${index}" ${index === defaultIndex ? "checked" : ""}>`,
            `<span><strong>${esc(token.name)}</strong>${notes ? ` <em>(${esc(notes)})</em>` : ""}</span>`,
            `</label>`,
        ].join("");
    });
    const content = [
        `<p>${esc(familiar.name)} can draw on the waning strength of a creature within 15 feet with less than half its `,
        `Hit Points: it becomes sickened 1 unless it succeeds at a Fortitude save (DC ${dc}).</p>`,
        ...choices,
    ].join("");

    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: TITLE },
        content,
        buttons: [
            {
                action: "drain",
                label: "Drain",
                default: true,
                callback: (_event, button) => button.form.elements.choice.value,
            },
            { action: "skip", label: "Skip" },
        ],
        rejectClose: false,
    });
    if (typeof choice !== "string" || !/^\d+$/.test(choice)) return;
    const { token, immune } = candidates[Number(choice)];
    await postCard({ witch, familiar, familiarToken, targetToken: token, dc, immune });
}

async function postCard({ witch, familiar, familiarToken, targetToken, dc, immune }) {
    const speaker = ChatMessage.getSpeaker({ actor: familiar, token: familiarToken });
    const drains = `${esc(familiar.name)} draws on ${esc(targetToken.name)}'s waning strength`;
    playDrainAnimation(familiarToken, targetToken);
    if (immune) {
        return ChatMessage.create({
            speaker,
            content: `<p><strong>${TITLE}</strong> ${drains}, but it's immune to sickened.</p>`,
        });
    }
    await ChatMessage.create({
        speaker,
        content: [
            `<p><strong>${TITLE}</strong> ${drains}: it becomes sickened 1 unless it succeeds at a Fortitude save `,
            `(DC ${dc}).</p><div data-ehb-parasitic-might></div>`,
        ].join(""),
        flags: {
            [MODULE_ID]: {
                parasiticMight: { witch: witch.uuid, target: targetToken.uuid, dc, outcome: null, applied: false },
            },
        },
    });
}

/** Roll the creature's Fortitude save from the card, for everyone to see */
async function rollSave(card) {
    const record = card.flags[MODULE_ID]?.parasiticMight;
    const targetToken = record?.target ? fromUuidSync(record.target) : null;
    const target = targetToken?.actor;
    const witch = record?.witch ? fromUuidSync(record.witch) : null;
    if (!target) return ui.notifications.warn(`${TITLE}: the creature is gone.`);
    if (!target.isOwner) return ui.notifications.warn(`${TITLE}: you can't roll ${target.name}'s save.`);
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn(`${TITLE}: a GM must be logged in to apply the result.`);
    }
    await target.saves?.fortitude?.roll({
        dc: { value: record.dc },
        origin: witch,
        token: targetToken,
        identifier: `${SAVE_IDENTIFIER}${card.id}`,
        // Shown to everyone, whatever the roller's default roll mode: pf2e 7.x reads rollMode, 8.x messageMode
        rollMode: "publicroll",
        messageMode: "public",
    });
}

/** Make a creature sickened 1, unless it's immune or already sickened. Returns what happened. */
async function applySickened(target) {
    if (target.isImmuneTo("sickened")) return "immune";
    const existing = getSickened(target);
    if (existing) return `already-${existing.value}`;
    await target.increaseCondition("sickened", { value: 1 });
    return "applied";
}

/** Apply a save rolled from the card, or a reroll of it. Run by a GM, who can edit the card and every creature. */
async function resolveSave({ cardId, outcome }) {
    const card = game.messages.get(cardId);
    const record = card?.flags[MODULE_ID]?.parasiticMight;
    const target = record?.target ? fromUuidSync(record.target)?.actor : null;
    if (!record || !target || !OUTCOMES.includes(outcome) || record.outcome === outcome) return;

    let applied = record.applied;
    let result = null;
    if (FAILED.has(outcome) && !applied) {
        result = await applySickened(target);
        applied = result === "applied";
    } else if (!FAILED.has(outcome) && applied) {
        // Rerolled into a success: take back the sickened 1 it was given, if it's still that
        const sickened = target.itemTypes.condition.find((c) => c.slug === "sickened" && !c.isLocked);
        if (sickened?.value === 1) await sickened.delete();
        applied = false;
    }
    await card.update({
        [`flags.${MODULE_ID}.parasiticMight.outcome`]: outcome,
        [`flags.${MODULE_ID}.parasiticMight.applied`]: applied,
        ...(result ? { [`flags.${MODULE_ID}.parasiticMight.result`]: result } : {}),
    });
}

/**
 * A Fortitude save rolled from the box pf2e adds to the hex's card, against the witch's spell DC: there's no card to
 * record it on, so the user who rolled it, who owns the creature, makes it sickened 1 on a failure
 */
async function onInlineSave(message) {
    const target = message.actor;
    const result = await applySickened(target);
    const name = esc(target.name);
    const text =
        {
            applied: `${name} is sickened 1.`,
            immune: `${name} is immune to sickened.`,
        }[result] ?? `${name} is already sickened.`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: target }),
        content: `<p><strong>${TITLE}</strong> ${text}</p>`,
    });
}

/** Whether a save message is one rolled from the Parasitic Might box on a hex's card */
function isInlineSave(message, context) {
    const spell = message.item;
    if (spell?.type !== "spell" || !spell.traits.has("hex") || !message.actor) return false;
    if (!(context.domains ?? []).includes("fortitude")) return false;
    // A hex with a Fortitude save of its own can't be told apart from it
    if (spell.system.defense?.save?.statistic === "fortitude") return false;
    const witch = (context.origin?.actor && fromUuidSync(context.origin.actor)) || spell.actor;
    return hasParasiticMight(witch);
}

hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId)) return;
    if (isHexCast(message)) {
        return void promptParasiticMight(message.actor, { spell: message.item }).catch(log);
    }

    const context = message.flags.pf2e?.context;
    if (context?.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) return;
    const identifier = typeof context.identifier === "string" ? context.identifier : "";
    if (identifier.startsWith(SAVE_IDENTIFIER)) {
        const data = { cardId: identifier.slice(SAVE_IDENTIFIER.length), outcome: context.outcome };
        if (game.user.isGM) return void resolveSave(data).catch(log);
        // Players can't edit the witch's card, or creatures they don't own, so the active GM applies the result
        return void game.socket.emit(SOCKET, { action: "parasiticMight", ...data });
    }
    if (FAILED.has(context.outcome) && isInlineSave(message, context)) onInlineSave(message).catch(log);
});

/** The card's control: a Fortitude Save button for whoever can roll the creature's save, or where it stands */
function renderCard(message, html) {
    const record = message.flags[MODULE_ID]?.parasiticMight;
    const content = html?.querySelector?.(".message-content") ?? html;
    const controls = content?.querySelector?.("[data-ehb-parasitic-might]");
    if (!record?.target || !controls) return;

    const target = fromUuidSync(record.target)?.actor;
    const name = esc(target?.name ?? "the creature");
    const note = (text) => {
        const p = document.createElement("p");
        p.innerHTML = `<em>${text}</em>`;
        return p;
    };

    if (record.outcome) {
        const label = esc(outcomeLabel(record.outcome));
        const result = !FAILED.has(record.outcome)
            ? `${name} isn't sickened.`
            : record.applied
              ? `${name} is sickened 1.`
              : record.result === "immune"
                ? `${name} is immune to sickened.`
                : `${name} was already sickened.`;
        return controls.replaceChildren(note(`Fortitude save: ${label}. ${result}`));
    }
    if (!target?.isOwner) return controls.replaceChildren(note(`Waiting for ${name}'s Fortitude save.`));

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fa-solid fa-dice-d20"></i> Fortitude Save DC ${record.dc}: ${name}`;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        rollSave(message)
            .catch(log)
            .finally(() => (button.disabled = false));
    });
    controls.replaceChildren(button);
}

hooks.on("renderChatMessageHTML", (message, html) => renderCard(message, html));

Hooks.once("init", () => {
    const module = game.modules.get(MODULE_ID);
    // Sustaining through scripts/sustain.js, which knows whether the sustained spell is a hex
    module.sustainHandlers = [
        ...(module.sustainHandlers ?? []),
        (actor, { hex, spell }) =>
            hex && isEnabled("parasiticMight") ? promptParasiticMight(actor, { spell }) : undefined,
    ];
    // For a macro: pass the witch or their familiar
    module.api = {
        ...module.api,
        parasiticMight: guardApi("parasiticMight", (actor) => promptParasiticMight(actor)),
    };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "parasiticMight" || !isActiveGM()) return;
        await resolveSave(data).catch(log);
    });
});
