/**
 * The module's settings menu: each feature can be turned off, and its settings changed, in one place (Configure
 * Settings → Evan's Character Homebrew → Features). The other scripts import this file: they check `isEnabled` (or
 * register their hooks with `featureHooks`, which does) and play animations only when `canAnimate` says so.
 *
 * Each feature's on/off switch is a world setting, on by default. A feature's own settings are registered by its
 * script, as before, and listed here by key; they're shown only in this menu.
 */

const MODULE_ID = "evan-character-homebrew";

/**
 * The features, in the menu's order. `key` is the switch's setting when a script already had one; `settings` are the
 * feature's own settings; `requires` is a feature it works through.
 */
const FEATURES = [
    {
        id: "sustain",
        group: "General",
        label: "Sustain",
        hint:
            "Sustain buttons on actor sheets and PF2e HUD's spell sidebar, and a prompt when pf2e's Sustain action " +
            "is used: the spell's card is posted again. Familiar of Ongoing Misery, Familiar of Parasitic Might and " +
            "Manifest Will's re-centering react to Sustains made this way.",
        settings: ["sustainedDurations"],
    },
    {
        id: "spellConditions",
        key: "spellConditions",
        group: "General",
        label: "Spell conditions from saves",
        hint:
            "An Apply button on saves rolled against a spell, which applies the conditions and spell effects its " +
            "text describes for that result, with their timers, after you check them.",
    },
    {
        id: "recallKnowledge",
        group: "General",
        label: "Recall Knowledge",
        hint:
            "Recall Knowledge about creatures, from pf2e's action or Basic Action Macros: the player picks a " +
            "question, and the GM reviews and sends what's learned for the degree of success.",
        settings: ["recallKnowledgeShared", "recallKnowledgeFalseNames", "recallKnowledgeBestiary"],
    },
    {
        id: "manifestWill",
        group: "Spells",
        label: "Manifest Will",
        hint: "The aura's turn-start effects for each tradition, the concealment flat checks, and re-centering.",
        settings: ["manifestWillDivineAlliesOnly"],
    },
    {
        id: "sepulchralMask",
        group: "Spells",
        label: "Sepulchral Mask",
        hint: "The emanation: damage and a Will save for each enemy that starts its turn in it.",
    },
    {
        id: "ongoingMisery",
        group: "Witch",
        label: "Familiar of Ongoing Misery",
        hint: "Prolong a condition on a creature near the familiar when a hex is Cast or Sustained.",
        settings: ["ongoingMiseryOncePerCase"],
        requires: "sustain",
    },
    {
        id: "parasiticMight",
        group: "Witch",
        label: "Familiar of Parasitic Might",
        hint: "Drain a creature below half its Hit Points near the familiar when a hex is Cast or Sustained.",
        requires: "sustain",
    },
    {
        id: "witchCharge",
        group: "Witch",
        label: "Designate Witch's Charge",
        hint: "Make your targets your charges, with pf2e's Effect: Witch's Charge.",
    },
    {
        id: "scroungersGlee",
        group: "Witch",
        label: "Scrounger's Glee",
        hint:
            "Keeps the target frightened while it can hear you, and asks to Dismiss the spell to heal an ally who " +
            "critically hits it. The effect is applied with spell conditions' Apply button.",
        requires: "spellConditions",
    },
    {
        id: "exploitVulnerability",
        group: "Thaumaturge",
        label: "Exploit Vulnerability",
        hint:
            "Reads the Esoteric Lore check: the creature's weaknesses for the degree of success, off-guard on a " +
            "critical failure, and with Diverse Lore, Recall Knowledge's information. The GM reviews it like " +
            "Recall Knowledge.",
    },
    {
        id: "extractElement",
        group: "Kineticist",
        label: "Extract Element",
        hint: "The save's result: damage, and Effect: Extract Element with the impulse bypasses.",
    },
    {
        id: "rallyingCharge",
        group: "Marshal",
        label: "Rallying Charge",
        hint: "Temporary Hit Points for allies who see the marshal's charge hit.",
    },
];

/** Settings for the whole module, shown above the features */
const GENERAL_SETTINGS = ["animations"];

const switchKey = (feature) => feature.key ?? `enabled${feature.id[0].toUpperCase()}${feature.id.slice(1)}`;
const byId = new Map(FEATURES.map((f) => [f.id, f]));
const esc = (text) => Handlebars.escapeExpression(text);

/** Whether a feature is on. A feature this file doesn't know about, or a switch not registered yet, counts as on. */
function isEnabled(id) {
    const feature = byId.get(id);
    if (!feature) return true;
    try {
        return game.settings.get(MODULE_ID, switchKey(feature)) !== false;
    } catch {
        return true;
    }
}

/** `Hooks.on` for a feature: the hook does nothing while the feature is off */
function featureHooks(id) {
    return {
        on: (name, fn) => Hooks.on(name, (...args) => (isEnabled(id) ? fn(...args) : undefined)),
    };
}

/** A macro entry point that says so when its feature is off, rather than doing nothing */
function guardApi(id, fn) {
    return (...args) => {
        if (isEnabled(id)) return fn(...args);
        ui.notifications.warn(`${byId.get(id)?.label ?? id} is turned off in the module's settings.`);
    };
}

/** Whether to play animations: Sequencer and JB2A are active, and they're on in the settings */
function canAnimate() {
    if (!(game.modules.get("sequencer")?.active && game.modules.get("JB2A_DnD5e")?.active)) return false;
    try {
        return game.settings.get(MODULE_ID, "animations") !== false;
    } catch {
        return true;
    }
}

/* The menu */

function settingConfig(key) {
    return game.settings.settings.get(`${MODULE_ID}.${key}`) ?? null;
}

/** A setting's field, by its type: a checkbox, a choice, a number or text */
function settingField(key) {
    const config = settingConfig(key);
    if (!config) return "";
    const value = game.settings.get(MODULE_ID, key);
    const name = esc(key);
    let input;
    if (config.choices) {
        const options = Object.entries(config.choices)
            .map(([v, label]) => {
                const selected = String(v) === String(value) ? "selected" : "";
                return `<option value="${esc(v)}" ${selected}>${esc(game.i18n.localize(label))}</option>`;
            })
            .join("");
        input = `<select name="${name}">${options}</select>`;
    } else if (config.type === Boolean) {
        input = `<input type="checkbox" name="${name}" ${value ? "checked" : ""}>`;
    } else if (config.type === Number) {
        input = `<input type="number" name="${name}" value="${esc(value)}">`;
    } else {
        input = `<input type="text" name="${name}" value="${esc(value)}">`;
    }
    return [
        `<div class="form-group">`,
        `<label>${esc(game.i18n.localize(config.name))}</label>`,
        `<div class="form-fields">${input}</div>`,
        config.hint ? `<p class="hint">${esc(game.i18n.localize(config.hint))}</p>` : "",
        `</div>`,
    ].join("");
}

function featureBlock(feature) {
    const key = switchKey(feature);
    const on = isEnabled(feature.id);
    const requires = feature.requires ? byId.get(feature.requires) : null;
    const needs = requires ? ` Works through ${esc(requires.label)}, which must be on too.` : "";
    const own = (feature.settings ?? [])
        .filter((k) => settingConfig(k))
        .map(settingField)
        .join("");
    return [
        `<div class="ehb-feature" data-feature="${esc(feature.id)}">`,
        `<div class="form-group">`,
        `<label><strong>${esc(feature.label)}</strong></label>`,
        `<div class="form-fields"><input type="checkbox" name="${esc(key)}" data-switch ${on ? "checked" : ""}></div>`,
        `<p class="hint">${esc(feature.hint)}${needs}</p>`,
        `</div>`,
        own ? `<div class="ehb-feature-settings" style="margin-left: 1.5em">${own}</div>` : "",
        `</div>`,
    ].join("");
}

function menuContent() {
    const groups = [...new Set(FEATURES.map((f) => f.group))];
    const general = GENERAL_SETTINGS.filter((k) => settingConfig(k))
        .map(settingField)
        .join("");
    return [
        `<p class="hint">Turn off a feature you don't use at your table: it stops reacting to rolls and messages, ` +
            `and its buttons and prompts go away. Changes apply right away.</p>`,
        general ? `<fieldset><legend>Module</legend>${general}</fieldset>` : "",
        ...groups.map(
            (group) =>
                `<fieldset><legend>${esc(group)}</legend>${FEATURES.filter((f) => f.group === group)
                    .map(featureBlock)
                    .join("")}</fieldset>`,
        ),
        `<footer class="form-footer"><button type="submit"><i class="fa-solid fa-floppy-disk"></i> Save</button>`,
        `</footer>`,
    ].join("");
}

/** Every setting the menu shows, with how to read it from the form */
function menuKeys() {
    return [...GENERAL_SETTINGS, ...FEATURES.flatMap((f) => [switchKey(f), ...(f.settings ?? [])])].filter((key) =>
        settingConfig(key),
    );
}

async function saveMenu(form) {
    for (const key of menuKeys()) {
        const element = form.querySelector(`[name="${key}"]`);
        if (!element) continue;
        const config = settingConfig(key);
        let value;
        if (config.type === Boolean) value = element.checked;
        else if (config.type === Number) value = Number(element.value);
        else value = element.value;
        if (config.type === Number && !Number.isFinite(value)) continue;
        if (value !== game.settings.get(MODULE_ID, key)) await game.settings.set(MODULE_ID, key, value);
    }
}

/** A feature's own settings can't be changed while it's off */
function wireMenu(root) {
    for (const block of root.querySelectorAll(".ehb-feature")) {
        const toggle = block.querySelector("[data-switch]");
        const update = () => {
            for (const input of block.querySelectorAll(".ehb-feature-settings input, .ehb-feature-settings select")) {
                input.disabled = !toggle.checked;
            }
        };
        toggle?.addEventListener("change", update);
        update();
    }
}

function defineMenu() {
    const { ApplicationV2 } = foundry.applications.api;
    return class FeatureSettings extends ApplicationV2 {
        static DEFAULT_OPTIONS = {
            id: "evan-character-homebrew-features",
            tag: "form",
            classes: ["evan-character-homebrew-features"],
            window: { title: "Evan's Character Homebrew: Features", icon: "fa-solid fa-sliders", resizable: true },
            position: { width: 600, height: 720 },
            form: {
                handler: async function (_event, form) {
                    await saveMenu(form);
                },
                closeOnSubmit: true,
            },
        };

        async _renderHTML() {
            return menuContent();
        }

        _replaceHTML(result, content) {
            content.innerHTML = result;
            content.style.overflowY = "auto";
        }

        _onRender(context, options) {
            super._onRender?.(context, options);
            wireMenu(this.element);
        }
    };
}

Hooks.once("init", () => {
    for (const feature of FEATURES) {
        if (feature.key) continue;
        game.settings.register(MODULE_ID, switchKey(feature), {
            name: feature.label,
            hint: feature.hint,
            scope: "world",
            config: false,
            type: Boolean,
            default: true,
        });
    }
    game.settings.register(MODULE_ID, "animations", {
        name: "Animations",
        hint: "Play the features' animations, with Sequencer and JB2A (free) when they're active.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.registerMenu(MODULE_ID, "features", {
        name: "Features",
        label: "Configure Features",
        hint: "Turn each of the module's features on or off, and change their settings.",
        icon: "fa-solid fa-sliders",
        type: defineMenu(),
        restricted: true,
    });
});

export { FEATURES, canAnimate, featureHooks, guardApi, isEnabled, menuContent, saveMenu, switchKey, wireMenu };
