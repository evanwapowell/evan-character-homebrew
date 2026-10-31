/**
 * Sustain support. pf2e's Sustain action only posts its description, without saying what was sustained. This adds a
 * Sustain button to the chat cards of sustained spells and a prompt listing the caster's sustained effects, and posts
 * which spell was sustained. The module's other scripts react through `sustainHandlers` on the module, run in turn so
 * their prompts don't overlap; other modules can use the `evan-character-homebrew.sustain` hook.
 */

const MODULE_ID = "evan-character-homebrew";
/** ID of the pf2e Sustain action item, the same in every pf2e version */
const SUSTAIN_ID = "3f5DMFu8fPiqHpRg";

function sustainTitle() {
    return game.i18n.localize("PF2E.Actions.Sustain.Title");
}

/** The spell an effect came from, when it was applied from the spell's chat card */
function getOriginSpell(effect) {
    const uuid = effect.system.context?.origin?.item;
    const item = uuid ? fromUuidSync(uuid) : null;
    return item?.type === "spell" ? item : null;
}

/** Post that a spell was sustained, then let automations react */
async function sustain(actor, { spell = null, effect = null } = {}) {
    spell ??= effect ? getOriginSpell(effect) : null;
    const hex = !!(spell?.traits.has("hex") || effect?.system.traits?.value?.includes("hex"));
    const esc = Handlebars.escapeExpression;

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: [
            `<h4 class="action"><strong>${esc(sustainTitle())}</strong> <span class="pf2-icon larger">1</span></h4>`,
            `<p>${esc(actor.name)} Sustains <strong>${esc(spell?.name ?? effect?.name ?? "a spell")}</strong>.</p>`,
        ].join(""),
        flags: { [MODULE_ID]: { sustain: { spell: spell?.uuid ?? null, effect: effect?.uuid ?? null, hex } } },
    });

    const data = { spell, effect, hex };
    for (const handler of game.modules.get(MODULE_ID).sustainHandlers ?? []) {
        try {
            await handler(actor, data);
        } catch (error) {
            console.error(`${MODULE_ID} | Sustain`, error);
        }
    }
    Hooks.callAll(`${MODULE_ID}.sustain`, actor, data);
}

/** Choose which of an actor's sustained effects to Sustain */
async function promptSustain(actor, { skipIfSingle = false } = {}) {
    const effects = actor.itemTypes.effect.filter((e) => e.system.duration.sustained && !e.remainingDuration.expired);
    if (effects.length === 0) {
        ui.notifications.info(
            `${actor.name} has no sustained effects. Use the Sustain button on the spell's chat card instead.`,
        );
        return;
    }
    if (skipIfSingle && effects.length === 1) return sustain(actor, { effect: effects[0] });

    const esc = Handlebars.escapeExpression;
    const content = effects
        .map((effect, index) =>
            [
                `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
                `<input type="radio" name="choice" value="${index}" ${index === 0 ? "checked" : ""}>`,
                `<span>${esc(effect.name)}</span>`,
                `</label>`,
            ].join(""),
        )
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
    return sustain(actor, { effect: effects[Number(choice)] });
}

/** Add a Sustain button to the chat card of a sustained spell, for the caster's owners */
function addSustainButton(message, html) {
    const spell = message.item;
    const flags = message.flags.pf2e ?? {};
    const contextType = flags.context?.type;
    if (spell?.type !== "spell" || !spell.system.duration?.sustained || !flags.casting) return;
    if (contextType && contextType !== "spell-cast") return;

    const actor = message.actor;
    const buttons = html?.querySelector("section.card-buttons");
    if (!actor?.isOwner || !buttons) return;

    const wrapper = document.createElement("div");
    wrapper.className = "spell-button";
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `${Handlebars.escapeExpression(sustainTitle())} <span class="action-glyph">1</span>`;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        sustain(actor, { spell }).catch((error) => console.error(`${MODULE_ID} | Sustain`, error));
    });
    wrapper.append(button);
    buttons.append(wrapper);
}

/** Whether a chat message is pf2e's own Sustain action, which doesn't say what was sustained */
function isSystemSustain(message) {
    if (message.flags[MODULE_ID]) return false;
    const item = message.item;
    const uuids = [item?.sourceId, item?.uuid, message.flags.pf2e?.origin?.uuid];
    if (uuids.some((uuid) => String(uuid ?? "").endsWith(`.${SUSTAIN_ID}`))) return true;
    if (item) return false;

    const content = new DOMParser().parseFromString(message.content ?? "", "text/html");
    return content.querySelector("h4.action strong")?.textContent.trim() === sustainTitle();
}

// When pf2e's Sustain action is posted, ask what was sustained
Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id || !isSystemSustain(message)) return;
    const actor = message.actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (!actor) return;
    promptSustain(actor, { skipIfSingle: true }).catch((error) => console.error(`${MODULE_ID} | Sustain`, error));
});

Hooks.once("init", () => {
    if (game.release.generation >= 13) {
        Hooks.on("renderChatMessageHTML", (message, html) => addSustainButton(message, html));
    } else {
        Hooks.on("renderChatMessage", (message, $html) => addSustainButton(message, $html[0]));
    }

    // For a macro: Sustain one of the selected token's (or your character's) sustained effects
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        sustain: (actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character) =>
            actor ? promptSustain(actor) : ui.notifications.warn("Select a token to Sustain for."),
    };
});
