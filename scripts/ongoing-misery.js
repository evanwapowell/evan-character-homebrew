/**
 * Familiar of Ongoing Misery: "When you Cast or Sustain a hex, your familiar can curse a creature within 15 feet of it,
 * prolonging one negative condition of your choice affecting the creature by 1 round." Only conditions with a timed
 * duration qualify, which in pf2e means a condition granted by an effect with a timed duration: that effect is the one
 * extended. Each case can be extended only once.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
/** IDs of the pf2e compendium items, the same in every pf2e version */
const ABILITY_ID = "mu9OL8v4rmr9311e";
const RESENTMENT_ID = "9OwWgOP8ZWxTAqbg";
const RANGE = 15;
/** Conditions that benefit the creature that has them */
const POSITIVE_CONDITIONS = new Set([
    "concealed",
    "friendly",
    "helpful",
    "hidden",
    "indifferent",
    "invisible",
    "observed",
    "quickened",
    "undetected",
    "unnoticed",
]);
const ROUNDS_PER_UNIT = { rounds: 1, minutes: 10, hours: 600, days: 14400 };

function isFromSource(item, id) {
    return [item?.sourceId, item?.uuid].some((uuid) => typeof uuid === "string" && uuid.endsWith(`.${id}`));
}

/**
 * Whether the witch's familiar has the ability. pf2e grants it through the witch's patron (The Resentment), which
 * boxes it in hex descriptions instead of adding it to the familiar, but it can also be on the familiar's sheet.
 */
function hasOngoingMisery(witch, familiar) {
    const fromPatron = witch.items.some(
        (i) => isFromSource(i, RESENTMENT_ID) || JSON.stringify(i._source.system.rules ?? []).includes("OngoingMisery"),
    );
    return (
        fromPatron ||
        !!familiar?.items.some(
            (i) => isFromSource(i, ABILITY_ID) || i.name.toLowerCase() === "familiar of ongoing misery",
        )
    );
}

const warned = new Set();
function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    ui.notifications.warn(`Familiar of Ongoing Misery: ${message}`);
}

/** Whether a chat message is the card of a hex being cast */
function isHexCast(message) {
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

/** Timed effects granting a negative condition to creatures within 15 feet of the familiar */
function getEligibleEffects(familiarToken) {
    const options = [];
    for (const token of familiarToken.parent.tokens) {
        const actor = token.actor;
        if (!actor || token === familiarToken || token.hidden || !token.object || !familiarToken.object) continue;
        if (familiarToken.object.distanceTo(token.object) > RANGE) continue;
        // This is a curse effect
        if (actor.attributes?.immunities?.some?.((i) => i.type === "curse")) continue;

        for (const effect of actor.itemTypes.effect) {
            if (!ROUNDS_PER_UNIT[effect.system.duration.unit] || effect.remainingDuration.expired) continue;
            if (effect.flags[MODULE_ID]?.ongoingMisery) continue;

            const conditions = actor.conditions.contents.filter(
                (c) => c.flags.pf2e?.grantedBy?.id === effect.id && !POSITIVE_CONDITIONS.has(c.slug),
            );
            if (conditions.length === 0) continue;

            const rounds = Math.max(1, Math.ceil(effect.remainingDuration.remaining / 6));
            options.push({ token, effect, conditions, rounds });
        }
    }
    return options;
}

/** Add 1 round to an effect's duration and mark it as extended */
async function extendEffect(effect) {
    const { value, unit } = effect._source.system.duration;
    const perUnit = ROUNDS_PER_UNIT[unit];
    if (!perUnit || effect.flags[MODULE_ID]?.ongoingMisery) return;
    await effect.update({
        "system.duration.value": value * perUnit + 1,
        "system.duration.unit": "rounds",
        [`flags.${MODULE_ID}.ongoingMisery`]: true,
    });
}

/** Prompt the witch's user to curse a creature, extending the chosen condition */
async function promptOngoingMisery(actor) {
    const witch = actor?.isOfType?.("familiar") ? actor.master : actor;
    if (!witch?.isOfType?.("character")) return;
    const familiar = witch.familiar;
    if (!hasOngoingMisery(witch, familiar)) return;
    if (!familiar) return warnOnce(`${witch.name} has no familiar actor linked.`);

    // The 15-foot range is measured from the familiar
    const familiarToken = familiar.getActiveTokens(true, true).find((t) => t.parent === canvas.scene);
    if (!familiarToken) return warnOnce(`${familiar.name} has no token on this scene.`);
    const options = getEligibleEffects(familiarToken);
    if (options.length === 0) return;

    const esc = Handlebars.escapeExpression;
    const choices = options.map(({ token, effect, conditions, rounds }, index) => {
        const conditionNames = conditions.map((c) => c.name).join(", ");
        return [
            `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
            `<input type="radio" name="choice" value="${index}" ${index === 0 ? "checked" : ""}>`,
            `<span><strong>${esc(token.name)}</strong>: ${esc(conditionNames)} `,
            `<em>(${esc(effect.name)}, ${rounds} ${rounds === 1 ? "round" : "rounds"} left)</em></span>`,
            `</label>`,
        ].join("");
    });
    const content = [
        `<p>${esc(familiar.name)} can curse a creature within 15 feet, prolonging a negative condition by 1 round.</p>`,
        ...choices,
    ].join("");

    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Familiar of Ongoing Misery" },
        content,
        buttons: [
            {
                action: "curse",
                label: "Curse",
                default: true,
                callback: (_event, button) => button.form.elements.choice.value,
            },
            { action: "skip", label: "Skip" },
        ],
        rejectClose: false,
    });
    if (typeof choice !== "string" || !/^\d+$/.test(choice)) return;
    const { token, effect, conditions } = options[Number(choice)];

    if (effect.canUserModify(game.user, "update")) {
        await extendEffect(effect);
    } else if (game.users.activeGM) {
        game.socket.emit(SOCKET, { action: "ongoingMisery", effectUuid: effect.uuid });
    } else {
        ui.notifications.warn("Familiar of Ongoing Misery: a GM must be logged in to curse that creature.");
        return;
    }

    const conditionNames = esc(conditions.map((c) => c.name).join(", "));
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: familiarToken }),
        content: `<p><strong>Familiar of Ongoing Misery</strong> ${esc(familiar.name)} curses ${esc(token.name)}, prolonging ${conditionNames} by 1 round.</p>`,
    });
}

Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id || !isHexCast(message)) return;
    promptOngoingMisery(message.actor).catch((error) => console.error(`${MODULE_ID} | Ongoing Misery`, error));
});

// Sustaining through scripts/sustain.js, which knows whether the sustained spell is a hex
Hooks.on(`${MODULE_ID}.sustain`, (actor, { hex }) => {
    if (!hex) return;
    promptOngoingMisery(actor).catch((error) => console.error(`${MODULE_ID} | Ongoing Misery`, error));
});

Hooks.once("init", () => {
    // For a macro: pass the witch or their familiar
    const module = game.modules.get(MODULE_ID);
    module.api = { ...module.api, ongoingMisery: (actor) => promptOngoingMisery(actor) };
});

Hooks.once("ready", () => {
    // Players can't update effects on creatures they don't own, so the active GM extends those
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "ongoingMisery" || game.user !== game.users.activeGM) return;
        const effect = await fromUuid(data.effectUuid);
        if (effect) await extendEffect(effect);
    });
});
