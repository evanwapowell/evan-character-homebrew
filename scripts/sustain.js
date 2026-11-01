/**
 * Sustain support. pf2e's Sustain action only posts its description, without saying what was sustained. This adds a
 * Sustain button beside the Cast button of sustained spells on actor sheets and a prompt listing the caster's
 * sustained effects, and posts the sustained spell's card again. The module's other scripts react through
 * `sustainHandlers` on the module, run in turn so their prompts don't overlap.
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
    for (const handler of game.modules.get(MODULE_ID).sustainHandlers ?? []) {
        try {
            await handler(actor, data);
        } catch (error) {
            console.error(`${MODULE_ID} | Sustain`, error);
        }
    }
}

/** Choose which of an actor's sustained effects to Sustain */
async function promptSustain(actor, { skipIfSingle = false } = {}) {
    const effects = actor.itemTypes.effect.filter((e) => e.system.duration.sustained && !e.remainingDuration.expired);
    if (effects.length === 0) {
        ui.notifications.info(
            `${actor.name} has no sustained effects. Use the Sustain button beside the spell's Cast button instead.`,
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
        button.className = "cast-spell blue";
        button.textContent = sustainTitle();
        button.dataset.tooltip = "Post this spell's card again without spending anything";
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
        const castButtons = [...list.querySelectorAll(":scope > li button.cast-spell:not([data-tooltip])")];
        if (castButtons.length === 0) continue;
        const castWidth = Math.max(...castButtons.map((b) => measureButton(b, b.textContent.trim())));
        const width = castWidth + BUTTON_GAP + measureButton(castButtons[0], sustainTitle());
        for (const item of list.children) item.style.setProperty("--cast-spell-width", `${width}px`);
    }
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

// pf2e's actor sheets use Foundry's original sheet framework in every version from v12 to v14
Hooks.on("renderActorSheet", (sheet, html) => addSheetSustainButtons(sheet, html));

Hooks.once("init", () => {
    // For a macro: Sustain one of the selected token's (or your character's) sustained effects
    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        sustain: (actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character) =>
            actor ? promptSustain(actor) : ui.notifications.warn("Select a token to Sustain for."),
    };
});
