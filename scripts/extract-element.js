/**
 * Extract Element (kineticist): "Target a creature within 30 feet that has a trait matching one of your kinetic
 * elements or is made of one of your kinetic elements. The target takes damage and becomes susceptible to your
 * impulses, depending on its Fortitude save against your class DC." pf2e only posts the action's card. Using the
 * action checks the target and the element being extracted; when the target's save is rolled from the card, its
 * result is applied as written: the damage, and on a success or worse Effect: Extract Element on the target, which
 * lasts 5 minutes or until the kineticist's kinetic aura ends. Each element has its own animation.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** IDs of pf2e's Extract Element action and Effect: Kinetic Aura, the same in every pf2e version */
const ACTION_ID = "low5ORd87QeA9Oug";
const KINETIC_AURA_ID = "pLurcSPQb2gjAzoP";
/** This module's Effect: Extract Element */
const EFFECT_UUID = `${PACK}.otpFtLUFZlVa0nhn`;
const RANGE = 30;
const ELEMENTS = { air: "Air", earth: "Earth", fire: "Fire", metal: "Metal", water: "Water", wood: "Wood" };
/** Degrees of success, by their index */
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DAMAGE = {
    criticalSuccess: { multiplier: 0, text: "unaffected" },
    success: { multiplier: 0.5, text: "half damage" },
    failure: { multiplier: 1, text: "full damage" },
    criticalFailure: { multiplier: 2, text: "double damage" },
};
/** Damage from the kineticist's impulses, at the time it's applied or a check against them is rolled */
const FROM_IMPULSE = [
    "origin:signature:{item|origin.signature}",
    { or: ["origin:action:trait:impulse", "item:trait:impulse"] },
];

const esc = (text) => Handlebars.escapeExpression(text);
const warn = (text) => ui.notifications.warn(`Extract Element: ${text}`);

function isExtractElement(item) {
    if (item?.slug === "extract-element") return true;
    return [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${ACTION_ID}`));
}

/** Whether a chat message is the action's card, rather than a save or damage rolled from it */
function isCard(message) {
    return isExtractElement(message.item) && !message.flags.pf2e?.context && message.rolls.length === 0;
}

/** The kineticist's kinetic elements, from their kinetic gate */
function getElements(kineticist) {
    const flag = kineticist.flags.pf2e?.kineticist?.elements;
    const fromFlag = Array.isArray(flag) ? flag.map((e) => (typeof e === "string" ? e : e?.value)) : [];
    const options = kineticist.rollOptions?.all ?? {};
    return Object.keys(ELEMENTS).filter((e) => fromFlag.includes(e) || options[`kinetic-gate:${e}`]);
}

/** "You can use an impulse only if your kinetic aura is active" */
function hasKineticAura(kineticist) {
    return !!kineticist.rollOptions?.all?.["self:effect:kinetic-aura"];
}

function getSceneToken(actor, scene) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === scene) ?? null;
}

/** The target's Effect: Extract Element from this kineticist: matter already in their aura */
function findExtraction(target, kineticist) {
    return (
        target.itemTypes.effect.find((e) => {
            if (e.flags[MODULE_ID]?.extractElement)
                return e.flags[MODULE_ID].extractElement.kineticist === kineticist.uuid;
            return [e.sourceId, e.uuid].includes(EFFECT_UUID) && e.origin === kineticist;
        }) ?? null
    );
}

/** Ask which element to extract, among those given. Resolves to the element, or null if cancelled. */
async function chooseElement(elements, prompt) {
    const choices = elements.map((element, index) =>
        [
            `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
            `<input type="radio" name="element" value="${element}" ${index === 0 ? "checked" : ""}>`,
            `<span>${ELEMENTS[element]}</span>`,
            `</label>`,
        ].join(""),
    );
    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Extract Element" },
        content: [`<p>${prompt}</p>`, ...choices].join(""),
        buttons: [
            {
                action: "extract",
                label: "Extract",
                default: true,
                callback: (_event, button) => button.form.elements.element.value,
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
    return elements.includes(choice) ? choice : null;
}

/**
 * The element extracted from the target: the kinetic element its traits match, asking when several do. When none
 * does, it can still be "made of one of your kinetic elements", which only the user can say.
 */
async function pickElement(kineticist, target) {
    const elements = getElements(kineticist);
    if (elements.length === 0) {
        warn(`${kineticist.name} has no kinetic elements (from a kinetic gate).`);
        return null;
    }
    const matching = elements.filter((e) => target.traits?.has(e));
    if (matching.length === 1) return matching[0];
    const name = `<strong>${esc(target.name)}</strong>`;
    if (matching.length > 1) {
        return chooseElement(matching, `${name} has traits matching several of your kinetic elements. Extract which?`);
    }
    return chooseElement(
        elements,
        `${name} has no trait matching your kinetic elements. If it's made of one of them, choose which to extract.`,
    );
}

/** On using the action: check its target, choose the element, and note them on the card for the save */
async function onUse(message) {
    const kineticist = message.actor;
    if (!kineticist) return;
    if (!hasKineticAura(kineticist)) return warn("your kinetic aura must be active to use an impulse.");

    const targets = [...game.user.targets];
    if (targets.length !== 1) return warn("target the one creature to extract from.");
    const targetToken = targets[0].document;
    const target = targetToken.actor;
    if (!target || target === kineticist) return warn("target another creature.");

    const kineticistToken = message.token ?? getSceneToken(kineticist, targetToken.parent);
    if (kineticistToken?.object && targetToken.object) {
        if (kineticistToken.object.distanceTo(targetToken.object) > RANGE) {
            return warn(`${target.name} is more than 30 feet away.`);
        }
    }
    if (findExtraction(target, kineticist)) {
        return warn(`matter you extracted from ${target.name} is already in your kinetic aura.`);
    }

    const element = await pickElement(kineticist, target);
    if (!element) return;
    await message.update({
        [`flags.${MODULE_ID}.extractElement`]: { kineticist: kineticist.uuid, target: targetToken.uuid, element },
    });
}

/** JB2A (free) animations: the matter bursts from the target, streams to the kineticist, and joins their aura */
const JB2A_LIBRARY = "modules/JB2A_DnD5e/Library";
const ANIMATIONS = {
    air: {
        burst: "Generic/Smoke/SmokePuffRing01_01_Regular_White_400x400.webm",
        stream: [[30, "2nd_Level/Gust_Of_Wind/GustOfWind_01_White_VeryFast_1200x200.webm"]],
        aura: "7th_Level/Whirlwind/Whirlwind_01_BlueGrey_01_400x400.webm",
    },
    earth: {
        burst: "Generic/Impact/GroundCrackImpact_01_Regular_Orange_600x600.webm",
        stream: [
            [5, "Generic/Weapon_Attacks/Ranged/BoulderToss02_01_Regular_Brown_05ft_600x400.webm"],
            [15, "Generic/Weapon_Attacks/Ranged/BoulderToss02_01_Regular_Brown_15ft_1000x400.webm"],
            [30, "Generic/Weapon_Attacks/Ranged/BoulderToss02_01_Regular_Brown_30ft_1600x400.webm"],
        ],
        aura: "Generic/Cast/CastEarth01_01_Regular_BrownGreen_600x600.webm",
    },
    fire: {
        burst: "Generic/Impact/ImpactFire01_01_Regular_Orange_600x600.webm",
        stream: [
            [5, "Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_05ft_600x400.webm"],
            [15, "Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_15ft_1000x400.webm"],
            [30, "Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm"],
        ],
        aura: "Generic/Cast/CastFire01_01_Regular_Orange_600x600.webm",
    },
    metal: {
        burst: "Generic/Explosion/ShrapnelBomb01_01_Regular_Black_800x800.webm",
        stream: [
            [15, "Generic/Weapon_Attacks/Ranged/Dagger01_01_Regular_White_15ft_1000x400.webm"],
            [30, "Generic/Weapon_Attacks/Ranged/Dagger01_01_Regular_White_30ft_1600x400.webm"],
        ],
        aura: "2nd_Level/Cloud_Of_Daggers/CloudOfDaggers_01_Light_Yellow_400x400.webm",
    },
    water: {
        burst: "Generic/Liquid/LiquidSplash01_Regular_Blue_400x400.webm",
        stream: [
            [5, "Generic/RangedSpell/03/RangedInstant03_01_Regular_BlueGreen_05ft_600x400.webm"],
            [15, "Generic/RangedSpell/03/RangedInstant03_01_Regular_BlueGreen_15ft_1000x400.webm"],
            [30, "Generic/RangedSpell/03/RangedInstant03_01_Regular_BlueGreen_30ft_1600x400.webm"],
        ],
        aura: "Generic/Cast/CastWater02_01_Regular_Blue_400x400.webm",
    },
    wood: {
        burst: "Generic/Nature/GroupVineNature01_01_Regular_Green_300x300.webm",
        stream: [
            [5, "Generic/Nature/SwirlingLeaves01_01_Regular_GreenOrange_05ft_600x400.webm"],
            [15, "Generic/Nature/SwirlingLeaves01_01_Regular_GreenOrange_15ft_1000x400.webm"],
            [30, "Generic/Nature/SwirlingLeaves01_01_Regular_GreenOrange_30ft_1600x400.webm"],
        ],
        aura: "Generic/Nature/SwirlingLeavesComplete01_01_Regular_Green_400x400.webm",
    },
};

function playExtractAnimation(element, targetToken, kineticistToken) {
    if (!(game.modules.get("sequencer")?.active && game.modules.get("JB2A_DnD5e")?.active)) return;
    const animation = ANIMATIONS[element];
    if (!animation || !targetToken?.object || !kineticistToken?.object) return;
    if (targetToken.parent !== kineticistToken.parent) return;

    const distance = kineticistToken.object.distanceTo(targetToken.object);
    const stream = (animation.stream.find(([feet]) => distance <= feet) ?? animation.stream.at(-1))[1];
    new Sequence()
        .effect()
        .file(`${JB2A_LIBRARY}/${animation.burst}`)
        .atLocation(targetToken)
        .scaleToObject(1.5)
        .fadeOut(300)
        .effect()
        .file(`${JB2A_LIBRARY}/${stream}`)
        .atLocation(targetToken)
        .stretchTo(kineticistToken)
        .delay(400)
        .effect()
        .file(`${JB2A_LIBRARY}/${animation.aura}`)
        .atLocation(kineticistToken)
        .scaleToObject(2)
        .delay(1100)
        .duration(2000)
        .fadeIn(200)
        .fadeOut(600)
        .play();
}

/**
 * Immunities and resistances the kineticist's impulses get past, for as long as the effect lasts: "Your impulses
 * bypass any immunity the creature has to their elemental trait or traits. If the target normally has a resistance
 * that would apply to damage from one of your impulses, ignore that resistance; if it normally would be immune to
 * that damage type, it instead has resistance equal to its level to damage from the impulse." pf2e applies damage,
 * and rolls checks against the creature, with a copy of it that has the attacker's roll options, so these rules only
 * take effect against the kineticist's impulses. Removals run after the creature's own rules have added theirs.
 */
function getBypassRules(target) {
    const { damageTypes, immunityTypes, resistanceTypes } = CONFIG.PF2E;
    const types = (iwrs) => [...new Set((iwrs ?? []).map((i) => i.type))];
    const immunities = types(target.attributes?.immunities).filter(
        (t) => t in immunityTypes && (t in damageTypes || t in ELEMENTS),
    );
    const toResistance = immunities.filter((t) => t in damageTypes && t in resistanceTypes);
    const resistances = types(target.attributes?.resistances).filter((t) => t in resistanceTypes);

    const label = "Extract Element";
    const rules = [];
    if (resistances.length > 0) {
        rules.push({
            key: "Resistance",
            mode: "remove",
            type: resistances,
            value: 0,
            predicate: FROM_IMPULSE,
            priority: 150,
        });
    }
    if (immunities.length > 0) {
        rules.push({ key: "Immunity", mode: "remove", type: immunities, predicate: FROM_IMPULSE, priority: 150 });
    }
    if (toResistance.length > 0) {
        rules.push({
            key: "Resistance",
            type: toResistance,
            value: "@actor.level",
            predicate: FROM_IMPULSE,
            priority: 160,
            label,
        });
    }
    return rules;
}

/** Roll Extract Element's damage, post it, and apply it to the target for its degree of success */
async function applyDamage({ kineticist, kineticistToken, item, target, targetToken, outcome }) {
    const { multiplier, text } = DAMAGE[outcome];
    const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
    if (!DamageRoll) throw new Error("pf2e's DamageRoll wasn't found");

    // "@Damage[(ceil(@actor.level/2))d4[untyped]]": damage with no damage type
    const dice = Math.max(1, Math.ceil(kineticist.level / 2));
    const roll = await new DamageRoll(`${dice}d4[untyped]`).evaluate();
    const outcomeLabel = game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
    await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: kineticist, token: kineticistToken }),
        flavor: `<strong>Extract Element</strong> damage to ${esc(target.name)} (${esc(outcomeLabel)}: ${text}, applied)`,
        // Applied below, so the card has no buttons to apply it again
        flags: { pf2e: { suppressDamageButtons: true, ...(item ? { origin: item.getOriginData() } : {}) } },
    });

    const damage = multiplier === 1 ? roll : roll.alter(multiplier, 0);
    const rollOptions = new Set([...kineticist.getSelfRollOptions("origin"), ...(item?.getRollOptions("item") ?? [])]);
    await target.applyDamage({ damage, token: targetToken, item, rollOptions });
}

/** Apply the save's result to the target. Run by a GM, who can edit every creature and message. */
async function resolveExtraction(data) {
    const { element, outcome, total, cardId } = data;
    const kineticist = await fromUuid(data.kineticistUuid);
    const targetToken = await fromUuid(data.targetTokenUuid);
    const target = targetToken?.actor;
    if (!kineticist || !target || !ELEMENTS[element] || !DAMAGE[outcome]) return;
    const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
    const kineticistToken = (data.kineticistTokenUuid && (await fromUuid(data.kineticistTokenUuid))) || null;
    const speaker = ChatMessage.getSpeaker({ actor: kineticist, token: kineticistToken });

    // Each use is resolved once, so a repeated or rerolled save doesn't deal its damage again
    const card = cardId ? game.messages.get(cardId) : null;
    const record = card?.flags[MODULE_ID]?.extractElement;
    if (record?.resolved) return;
    if (findExtraction(target, kineticist)) {
        return ChatMessage.create({
            speaker,
            whisper: ChatMessage.getWhisperRecipients("GM"),
            content: `<p><strong>Extract Element</strong> Matter extracted from ${esc(target.name)} is already in ${esc(kineticist.name)}'s kinetic aura, so it can't be targeted again. Nothing was applied.</p>`,
        });
    }
    if (card) {
        const resolved = { kineticist: kineticist.uuid, target: targetToken.uuid, element, resolved: true };
        await card.update({ [`flags.${MODULE_ID}.extractElement`]: resolved });
    }

    if (outcome === "criticalSuccess") {
        return ChatMessage.create({
            speaker,
            content: `<p><strong>Extract Element</strong> ${esc(target.name)} critically succeeds and is unaffected.</p>`,
        });
    }

    await applyDamage({ kineticist, kineticistToken, item, target, targetToken, outcome });

    const effect = await fromUuid(EFFECT_UUID);
    if (!effect) return ui.notifications.error("Extract Element: the module's Effect: Extract Element was not found.");
    const source = effect.toObject();
    source._stats = { ...source._stats, compendiumSource: EFFECT_UUID };
    source.name = `${source.name} (${ELEMENTS[element]})`;
    source.system.level = { value: kineticist.level };
    source.system.rules = [...source.system.rules, ...getBypassRules(target)];
    source.system.context = {
        origin: {
            actor: kineticist.uuid,
            token: kineticistToken?.uuid ?? null,
            item: item?.uuid ?? null,
            spellcasting: null,
            rollOptions: [],
        },
        target: { actor: target.uuid, token: targetToken.uuid },
        roll: Number.isFinite(total) ? { total, degreeOfSuccess: OUTCOMES.indexOf(outcome) } : null,
    };
    source.flags = { ...source.flags, [MODULE_ID]: { extractElement: { kineticist: kineticist.uuid, element } } };
    await target.createEmbeddedDocuments("Item", [source]);

    const { text } = DAMAGE[outcome];
    await ChatMessage.create({
        speaker,
        content: [
            `<p><strong>Extract Element</strong> ${esc(target.name)} takes ${text}, and ${esc(kineticist.name)} adds`,
            ` some of its ${ELEMENTS[element].toLowerCase()} matter to their kinetic aura: their impulses bypass its`,
            ` immunities and resistances, and it takes a –1 circumstance penalty to its saves and AC against them,`,
            ` for 5 minutes or until their kinetic aura ends.</p>`,
        ].join(""),
    });
}

/**
 * A save against Extract Element was rolled by this user: find the use it answers, play the animation, and have the
 * active GM apply the result. `card` is the action's card when known (PF2e Toolbelt), otherwise the latest one.
 */
async function onSave({ card, kineticist, item, targetToken, outcome, total }) {
    const target = targetToken?.actor;
    if (!kineticist || !target || !DAMAGE[outcome]) return;

    card ??= game.messages.contents.findLast((m) => isCard(m) && m.actor?.uuid === kineticist.uuid) ?? null;
    const record = card?.flags[MODULE_ID]?.extractElement;
    if (record && record.target !== targetToken.uuid) {
        return warn(`${target.name} isn't the target of ${kineticist.name}'s Extract Element.`);
    }
    if (record?.resolved) {
        return ui.notifications.info(
            `Extract Element: the result against ${target.name} was already applied. Adjust a reroll by hand.`,
        );
    }
    if (findExtraction(target, kineticist)) {
        return warn(`matter extracted from ${target.name} is already in ${kineticist.name}'s kinetic aura.`);
    }
    const element = record?.element ?? (await pickElement(kineticist, target));
    if (!element) return;
    if (!game.user.isGM && !game.users.activeGM) return warn("a GM must be logged in to apply the result.");

    const kineticistToken = getSceneToken(kineticist, targetToken.parent);
    // Played here, where the tokens are on screen; Sequencer shows it to everyone
    if (outcome !== "criticalSuccess") playExtractAnimation(element, targetToken, kineticistToken);

    const data = {
        kineticistUuid: kineticist.uuid,
        kineticistTokenUuid: kineticistToken?.uuid ?? null,
        itemUuid: item?.uuid ?? null,
        targetTokenUuid: targetToken.uuid,
        element,
        outcome,
        total,
        cardId: card?.id ?? null,
    };
    if (game.user.isGM) return resolveExtraction(data);
    // Players can't edit creatures they don't own, so the active GM applies the result
    game.socket.emit(SOCKET, { action: "extractElement", ...data });
}

/** A save message rolled against Extract Element, from the card's Fortitude check */
function getSave(message) {
    const context = message.flags.pf2e?.context;
    if (context?.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) return null;
    const item = message.item;
    if (!isExtractElement(item)) return null;
    const kineticist = (context.origin?.actor && fromUuidSync(context.origin.actor)) || item.actor;
    const targetToken = message.token ?? getSceneToken(message.actor, canvas.scene);
    return { kineticist, item, targetToken, outcome: context.outcome, total: message.rolls[0]?.total };
}

const log = (error) => console.error(`${MODULE_ID} | Extract Element`, error);

Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id) return;
    if (isCard(message)) return void onUse(message).catch(log);
    const save = getSave(message);
    if (save) onSave(save).catch(log);
});

// PF2e Toolbelt's Target Helper, when that module is active, rolls saves without save messages and calls this hook
// for each one instead, with the action's card and the target's token
Hooks.on("pf2e-toolbelt.rollSave", ({ message, target, data }) => {
    if (!message || !isCard(message) || !target) return;
    const save = { card: message, kineticist: message.actor, item: message.item, targetToken: target };
    onSave({ ...save, outcome: data?.success, total: data?.value }).catch(log);
});

function isKineticAuraEffect(item) {
    if (item.type !== "effect") return false;
    if (String(item.sourceId ?? "").endsWith(`.${KINETIC_AURA_ID}`)) return true;
    return item.slug === "effect-kinetic-aura" || item.name === "Effect: Kinetic Aura";
}

// "These effects last for 5 minutes or until your kinetic aura ends"
Hooks.on("deleteItem", async (item) => {
    const kineticist = item.actor;
    if (game.user !== game.users.activeGM || !kineticist || !isKineticAuraEffect(item)) return;
    if (kineticist.items.some((i) => i.id !== item.id && isKineticAuraEffect(i))) return;

    const actors = new Set(game.actors);
    for (const scene of game.scenes) {
        for (const token of scene.tokens) if (!token.actorLink && token.actor) actors.add(token.actor);
    }
    for (const actor of actors) {
        const ids = actor.itemTypes.effect
            .filter((e) => e.flags[MODULE_ID]?.extractElement?.kineticist === kineticist.uuid)
            .map((e) => e.id);
        if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids).catch(log);
    }
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "extractElement" || game.user !== game.users.activeGM) return;
        await resolveExtraction(data).catch(log);
    });
});
