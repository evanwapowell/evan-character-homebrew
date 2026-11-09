/**
 * Spirit Familiar and Stitched Familiar (witch feats, level 8). Each gives the familiar a two-action activity, once per
 * 10 minutes:
 *
 * - Shed Spirit: "Your familiar's spirit exits its body, leaving its empty shell behind, before flying at an enemy
 *   within 20 feet and dealing 6d6 spirit damage, with a basic Will save against your spell DC. If the familiar dealt
 *   damage, it then flies to an ally within 30 feet of the enemy, restoring Hit Points equal to half the damage dealt.
 *   Your familiar then re-forms in its original square."
 * - Stitching Strike: "Your familiar unravels into magical fibers that encompass an enemy within 30 feet and deal 6d6
 *   slashing damage, with a basic Reflex save against your spell DC. On a failure, the target is also immobilized for
 *   1 round or until it Escapes against your spell DC. Your familiar then re-forms in its original square."
 *
 * Both deal 2d6 more at 9th level and every 2 levels thereafter. pf2e only posts the action's card, whose save link has
 * no DC. Here, using the action (from the familiar, or the witch if it's on their sheet) has its user pick the enemy,
 * rolls the damage, and posts a card with a button for the enemy to roll its save against the witch's spell DC. The
 * active GM applies the result: the damage for the degree of success; for Stitching Strike, on a failure or critical
 * failure, Effect: Stitching Strike (immobilized, 1 round), which a successful Escape against the DC ends; for Shed
 * Spirit, once damage was dealt, a button for the familiar's user to choose the ally it heals. JB2A (free) animations
 * play each step.
 */

import { canAnimate, guardApi, isEnabled } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** This module's Effect: Stitching Strike (immobilized for 1 round, or until an Escape) */
const IMMOBILIZED_EFFECT_UUID = `${PACK}.4vnb6uF59O5c4qNh`;
/** Saves rolled from this module's card carry this identifier, followed by the card's ID */
const SAVE_IDENTIFIER = "familiar-strike:";
/** How far the spirit flies from the enemy to the ally it heals */
const HEAL_RANGE = 30;
const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const FAILED = new Set(["failure", "criticalFailure"]);
const DAMAGE = {
    criticalSuccess: { multiplier: 0, text: "is unaffected" },
    success: { multiplier: 0.5, text: "takes half damage" },
    failure: { multiplier: 1, text: "takes full damage" },
    criticalFailure: { multiplier: 2, text: "takes double damage" },
};

/** The two activities. The IDs are pf2e's, the same in every pf2e version. */
const KINDS = {
    shedSpirit: {
        feature: "shedSpirit",
        title: "Shed Spirit",
        actionId: "uruoG0PuuA0CqEG7",
        slug: "shed-spirit",
        range: 20,
        save: "will",
        damageType: "spirit",
    },
    stitchingStrike: {
        feature: "stitchingStrike",
        title: "Stitching Strike",
        actionId: "PTEiTXsObvtke43x",
        slug: "stitching-strike",
        range: 30,
        save: "reflex",
        damageType: "slashing",
    },
};
const SAVE_LABELS = { will: "Will", reflex: "Reflex" };

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | Spirit and Stitched Familiar`, error);
const outcomeLabel = (outcome) => game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));

/** Which activity an item is, if either */
function getKind(item) {
    if (item?.type !== "action") return null;
    return (
        Object.keys(KINDS).find((kind) => item.slug === KINDS[kind].slug || endsWithId(item, KINDS[kind].actionId)) ??
        null
    );
}

/** Whether a chat message is the activity's card, rather than a save or damage rolled from it */
function getCardKind(message) {
    if (message.flags.pf2e?.context || message.rolls.length > 0 || message.flags[MODULE_ID]) return null;
    return getKind(message.item);
}

/** "6d6 [...] At 9th level, and every 2 levels thereafter, the attack deals an additional 2d6 damage." */
function getDice(level) {
    return 6 + Math.max(0, Math.ceil((level - 8) / 2) * 2);
}

/** The witch's spell DC: their spellcasting class feature's, or the best one pf2e found */
function getSpellDC(witch) {
    const entries = witch.spellcasting?.spellcastingFeatures ?? [];
    const dcs = entries.map((e) => e.statistic?.dc?.value).filter((dc) => Number.isFinite(dc));
    if (dcs.length > 0) return Math.max(...dcs);
    return witch.system.attributes.spellDC?.value ?? null;
}

function getSceneToken(actor, scene = canvas.scene) {
    return actor?.getActiveTokens(true, true).find((t) => t.parent === scene) ?? null;
}

/** The witch and their familiar, from either of them */
function getPair(actor) {
    if (actor?.isOfType?.("familiar")) return { witch: actor.master ?? null, familiar: actor };
    if (actor?.isOfType?.("character")) return { witch: actor, familiar: actor.familiar ?? null };
    return { witch: null, familiar: null };
}

function isAvailable(token) {
    const actor = token.actor;
    return (
        !!actor?.isOfType?.("creature") &&
        !token.hidden &&
        !!token.object &&
        !actor.isDead &&
        !token.combatant?.defeated
    );
}

/** Ask which creature, among those given. Resolves to its index, or null if cancelled. */
async function chooseToken({ title, prompt, entries, defaultIndex = 0, confirm }) {
    const choices = entries.map(({ token, note }, index) =>
        [
            `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
            `<input type="radio" name="choice" value="${index}" ${index === defaultIndex ? "checked" : ""}>`,
            `<span><strong>${esc(token.name)}</strong>${note ? ` <em>(${esc(note)})</em>` : ""}</span>`,
            `</label>`,
        ].join(""),
    );
    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title },
        content: [`<p>${prompt}</p>`, ...choices].join(""),
        buttons: [
            {
                action: "choose",
                label: confirm,
                default: true,
                callback: (_event, button) => button.form.elements.choice.value,
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
    return typeof choice === "string" && /^\d+$/.test(choice) ? Number(choice) : null;
}

/**
 * The enemy the familiar flies at: the user's one target, if it's in range, otherwise one they choose among the
 * creatures in range, enemies first
 */
async function pickEnemy(kind, witch, familiarToken) {
    const { title, range } = KINDS[kind];
    const inRange = (token) => familiarToken.object.distanceTo(token.object) <= range;
    const targets = [...game.user.targets].map((t) => t.document).filter((t) => t.parent === familiarToken.parent);
    if (targets.length === 1 && targets[0] !== familiarToken && isAvailable(targets[0]) && inRange(targets[0])) {
        return targets[0];
    }

    const tokens = familiarToken.parent.tokens.filter(
        (t) => t !== familiarToken && t.actor !== witch && isAvailable(t) && inRange(t),
    );
    const entries = tokens
        .map((token) => ({ token, enemy: !!token.actor.isEnemyOf?.(witch) }))
        .sort((a, b) => Number(b.enemy) - Number(a.enemy))
        .map(({ token, enemy }) => ({ token, note: enemy ? null : "not an enemy" }));
    if (entries.length === 0) {
        ui.notifications.warn(`${title}: there's no creature within ${range} feet of ${familiarToken.name}.`);
        return null;
    }
    const index = await chooseToken({
        title,
        prompt: `Which enemy within ${range} feet does ${esc(familiarToken.name)} fly at?`,
        entries,
        confirm: title,
    });
    return index === null ? null : entries[index].token;
}

/* JB2A (free) animations, by the longest distance each file covers */

const JB2A_LIBRARY = "modules/JB2A_DnD5e/Library";
const SPIRIT_FLIGHT = [
    [15, "Generic/RangedSpell/03/RangedProjectile03_01_Regular_BlueGreen_15ft_1000x400.webm"],
    [30, "Generic/RangedSpell/03/RangedProjectile03_01_Regular_BlueGreen_30ft_1600x400.webm"],
    [60, "Generic/RangedSpell/03/RangedProjectile03_01_Regular_BlueGreen_60ft_2800x400.webm"],
    [90, "Generic/RangedSpell/03/RangedProjectile03_01_Regular_BlueGreen_90ft_4000x400.webm"],
];
const SPIRIT_LEAVES = "Generic/Smoke/SmokePuffRing01_01_Regular_White_400x400.webm";
const SPIRIT_HITS = "Generic/Impact/Impact_11_Regular_Blue_400x400.webm";
const SPIRIT_HEALS = "Generic/Healing/HealingAbility_03_Regular_BlueGreen_600x600.webm";
const SPIRIT_REFORMS = "Generic/Particles/ParticlesInward01_01_Regular_GreenYellow_400x400.webm";
const FIBERS = [
    [5, "Generic/Energy/EnergyStrand_Multiple01_Regular_Purple_05ft_600x400.webm"],
    [15, "Generic/Energy/EnergyStrand_Multiple01_Regular_Purple_15ft_1000x400.webm"],
    [30, "Generic/Energy/EnergyStrand_Multiple01_Regular_Purple_30ft_1600x400.webm"],
    [60, "Generic/Energy/EnergyStrand_Multiple01_Regular_Purple_60ft_2800x400.webm"],
];
const FIBERS_UNRAVEL = "Generic/Particles/ParticleBurstCircle01_01_Regular_BluePurple_600x600.webm";
const FIBERS_ENCOMPASS = "Generic/Energy/ShieldEldritchWebAbove01_01_Dark_Purple_400x400.webm";
const FIBERS_REFORM = "Generic/Energy/EnergyStrandIN01_01_Regular_Green_600x600.webm";
const FIBERS_BIND = "2nd_Level/Web/Opacities/Web_01_White_01_75OPA_400x400.webm";

function byDistance(files, from, to) {
    const distance = from.object.distanceTo(to.object);
    return `${JB2A_LIBRARY}/${(files.find(([feet]) => distance <= feet) ?? files.at(-1))[1]}`;
}

function canPlay(...tokens) {
    return canAnimate() && tokens.every((t) => t?.object && t.parent === tokens[0].parent);
}

/** The familiar sets out: its spirit leaves its shell and flies at the enemy, or it unravels and encompasses it */
function playStrike(kind, familiarToken, targetToken) {
    if (!canPlay(familiarToken, targetToken)) return;
    const file = (name) => `${JB2A_LIBRARY}/${name}`;
    if (kind === "shedSpirit") {
        return new Sequence()
            .effect()
            .file(file(SPIRIT_LEAVES))
            .atLocation(familiarToken)
            .scaleToObject(1.5)
            .opacity(0.8)
            .effect()
            .file(byDistance(SPIRIT_FLIGHT, familiarToken, targetToken))
            .atLocation(familiarToken)
            .stretchTo(targetToken)
            .delay(300)
            .effect()
            .file(file(SPIRIT_HITS))
            .atLocation(targetToken)
            .scaleToObject(1.5)
            .delay(1000)
            .play();
    }
    // Stitching Strike re-forms right away: it has nothing left to do
    return new Sequence()
        .effect()
        .file(file(FIBERS_UNRAVEL))
        .atLocation(familiarToken)
        .scaleToObject(1.5)
        .effect()
        .file(byDistance(FIBERS, familiarToken, targetToken))
        .atLocation(familiarToken)
        .stretchTo(targetToken)
        .delay(200)
        .effect()
        .file(file(FIBERS_ENCOMPASS))
        .atLocation(targetToken)
        .scaleToObject(1.6)
        .delay(800)
        .fadeIn(200)
        .fadeOut(500)
        .effect()
        .file(byDistance(FIBERS, targetToken, familiarToken))
        .atLocation(targetToken)
        .stretchTo(familiarToken)
        .delay(2200)
        .effect()
        .file(file(FIBERS_REFORM))
        .atLocation(familiarToken)
        .scaleToObject(1.5)
        .delay(2700)
        .fadeOut(400)
        .play();
}

/** The spirit flies on to the ally and heals it, then back to re-form in the familiar's shell */
function playHeal(familiarToken, targetToken, allyToken) {
    if (!canPlay(familiarToken, targetToken, allyToken)) return;
    new Sequence()
        .effect()
        .file(byDistance(SPIRIT_FLIGHT, targetToken, allyToken))
        .atLocation(targetToken)
        .stretchTo(allyToken)
        .effect()
        .file(`${JB2A_LIBRARY}/${SPIRIT_HEALS}`)
        .atLocation(allyToken)
        .scaleToObject(1.5)
        .delay(700)
        .fadeOut(400)
        .effect()
        .file(byDistance(SPIRIT_FLIGHT, allyToken, familiarToken))
        .atLocation(allyToken)
        .stretchTo(familiarToken)
        .delay(1600)
        .effect()
        .file(`${JB2A_LIBRARY}/${SPIRIT_REFORMS}`)
        .atLocation(familiarToken)
        .scaleToObject(1.5)
        .delay(2300)
        .play();
}

/** The spirit returns from the enemy without healing anyone */
function playReturn(familiarToken, targetToken) {
    if (!canPlay(familiarToken, targetToken)) return;
    new Sequence()
        .effect()
        .file(byDistance(SPIRIT_FLIGHT, targetToken, familiarToken))
        .atLocation(targetToken)
        .stretchTo(familiarToken)
        .effect()
        .file(`${JB2A_LIBRARY}/${SPIRIT_REFORMS}`)
        .atLocation(familiarToken)
        .scaleToObject(1.5)
        .delay(700)
        .play();
}

/** Fibers stay wrapped around the immobilized creature until the effect ends */
function playBound(effect, targetToken) {
    if (!canPlay(targetToken)) return;
    new Sequence()
        .effect()
        .file(`${JB2A_LIBRARY}/${FIBERS_BIND}`)
        .attachTo(targetToken)
        .scaleToObject(1.3)
        .fadeIn(400)
        .fadeOut(400)
        .persist()
        .tieToDocuments(effect)
        .name(`${MODULE_ID}.stitching-strike.${effect.id}`)
        .play();
}

/* Using the activity */

/**
 * Use the activity: pick the enemy, roll the damage and post the card with the save button. `actor` is the familiar,
 * or the witch; `item` is the action used, if any.
 */
async function useStrike(kind, actor, { item = null } = {}) {
    const { title, save, damageType } = KINDS[kind];
    const { witch, familiar } = getPair(actor);
    if (!familiar) return ui.notifications.warn(`${title}: ${actor?.name ?? "the actor"} has no familiar.`);
    if (!witch) return ui.notifications.warn(`${title}: ${familiar.name} has no master to take a spell DC from.`);
    const familiarToken = getSceneToken(familiar);
    if (!familiarToken?.object) return ui.notifications.warn(`${title}: ${familiar.name} has no token on this scene.`);
    const dc = getSpellDC(witch);
    if (!dc) return ui.notifications.warn(`${title}: ${witch.name} has no spell DC.`);

    const targetToken = await pickEnemy(kind, witch, familiarToken);
    if (!targetToken) return;
    if (targetToken.actor && !targetToken.actor.isEnemyOf?.(witch)) {
        ui.notifications.info(`${title}: ${targetToken.name} isn't an enemy of ${witch.name}.`);
    }

    const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
    if (!DamageRoll) throw new Error("pf2e's DamageRoll wasn't found");
    const dice = getDice(familiar.level ?? witch.level);
    const roll = await new DamageRoll(`(${dice}d6)[${damageType}]`).evaluate();
    const speaker = ChatMessage.getSpeaker({ actor: familiar, token: familiarToken });
    const damageMessage = await roll.toMessage({
        speaker,
        flavor: `<strong>${title}</strong> damage to ${esc(targetToken.name)}, applied for its ${SAVE_LABELS[save]} save`,
        // Applied with the save's result, so the card has no buttons to apply it again
        flags: { pf2e: { suppressDamageButtons: true, ...(item ? { origin: item.getOriginData() } : {}) } },
    });
    if (!damageMessage) return;

    const what =
        kind === "shedSpirit"
            ? `${esc(familiar.name)}'s spirit exits its body and flies at ${esc(targetToken.name)}`
            : `${esc(familiar.name)} unravels into magical fibers that encompass ${esc(targetToken.name)}`;
    const failure =
        kind === "stitchingStrike"
            ? " On a failure, it's also immobilized for 1 round or until it Escapes against the same DC."
            : " If it takes damage, the spirit flies on to heal an ally within 30 feet of it.";
    await ChatMessage.create({
        speaker,
        content: [
            `<p><strong>${title}</strong> ${what}: ${dice}d6 ${damageType} damage, basic ${SAVE_LABELS[save]} save `,
            `(DC ${dc}).${failure}</p><div data-ehb-familiar-strike></div>`,
        ].join(""),
        flags: {
            [MODULE_ID]: {
                familiarStrike: {
                    kind,
                    witch: witch.uuid,
                    familiar: familiar.uuid,
                    familiarToken: familiarToken.uuid,
                    item: item?.uuid ?? null,
                    target: targetToken.uuid,
                    dc,
                    damage: damageMessage.id,
                    outcome: null,
                    dealt: null,
                    immobilized: null,
                    healed: null,
                },
            },
        },
    });
    playStrike(kind, familiarToken, targetToken);
}

/** Roll the enemy's save from the card, against the witch's spell DC, for everyone to see */
async function rollSave(card) {
    const record = card.flags[MODULE_ID]?.familiarStrike;
    const { title, save } = KINDS[record?.kind] ?? {};
    const targetToken = record?.target ? fromUuidSync(record.target) : null;
    const target = targetToken?.actor;
    if (!title || !target) return ui.notifications.warn(`${title ?? "Familiar"}: the creature is gone.`);
    if (!target.isOwner) return ui.notifications.warn(`${title}: you can't roll ${target.name}'s save.`);
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn(`${title}: a GM must be logged in to apply the result.`);
    }
    const witch = record.witch ? fromUuidSync(record.witch) : null;
    await target.saves?.[save]?.roll({
        dc: { value: record.dc },
        origin: witch,
        token: targetToken,
        identifier: `${SAVE_IDENTIFIER}${card.id}`,
        // Shown to everyone, whatever the roller's default roll mode: pf2e 7.x reads rollMode, 8.x messageMode
        rollMode: "publicroll",
        messageMode: "public",
    });
}

/* Applying the save's result. Run by a GM, who can edit the card and every creature. */

/** Cards being resolved, so a save arriving twice doesn't apply the damage twice */
const resolving = new Set();

function totalHP(actor) {
    const hp = actor?.hitPoints ?? actor?.attributes?.hp;
    return (hp?.value ?? 0) + (hp?.temp ?? 0);
}

async function resolveSave({ cardId, outcome }) {
    const card = game.messages.get(cardId);
    const record = card?.flags[MODULE_ID]?.familiarStrike;
    const config = KINDS[record?.kind];
    if (!config || record.outcome || !OUTCOMES.includes(outcome) || resolving.has(cardId)) return;
    resolving.add(cardId);
    try {
        await card.update({ [`flags.${MODULE_ID}.familiarStrike.outcome`]: outcome });
        const witch = fromUuidSync(record.witch);
        const familiar = fromUuidSync(record.familiar);
        const familiarToken = fromUuidSync(record.familiarToken);
        const targetToken = fromUuidSync(record.target);
        const target = targetToken?.actor;
        const roll = game.messages.get(record.damage)?.rolls[0];
        if (!witch || !familiar || !target || !roll) {
            return ChatMessage.create({
                whisper: ChatMessage.getWhisperRecipients("GM"),
                content: `<p><strong>${config.title}</strong> The damage roll or a creature is gone: apply the result by hand.</p>`,
            });
        }

        let dealt = 0;
        const { multiplier } = DAMAGE[outcome];
        if (multiplier > 0) {
            const item = record.item ? fromUuidSync(record.item) : null;
            const rollOptions = new Set([
                ...familiar.getSelfRollOptions("origin"),
                ...(item?.getRollOptions?.("item") ?? []),
            ]);
            const before = totalHP(target);
            await target.applyDamage({
                damage: multiplier === 1 ? roll : roll.alter(multiplier, 0),
                token: targetToken,
                item,
                rollOptions,
            });
            dealt = Math.max(0, before - totalHP(targetToken.actor));
        }

        const updates = { [`flags.${MODULE_ID}.familiarStrike.dealt`]: dealt };
        if (record.kind === "stitchingStrike" && FAILED.has(outcome)) {
            updates[`flags.${MODULE_ID}.familiarStrike.immobilized`] = await immobilize({
                witch,
                familiar,
                targetToken,
                dc: record.dc,
                cardId,
            });
        }
        if (record.kind === "shedSpirit" && dealt === 0) {
            // Nothing to heal with: the spirit goes back to its shell
            updates[`flags.${MODULE_ID}.familiarStrike.healed`] = { ally: null, amount: 0 };
            playReturn(familiarToken, targetToken);
        }
        await card.update(updates);
    } finally {
        resolving.delete(cardId);
    }
}

/** Stitching Strike's failure: immobilized for 1 round or until it Escapes. Returns what happened. */
async function immobilize({ witch, familiar, targetToken, dc, cardId }) {
    const target = targetToken.actor;
    if (target.isImmuneTo?.("immobilized")) return "immune";
    const effect = await fromUuid(IMMOBILIZED_EFFECT_UUID);
    if (!effect) {
        ui.notifications.error("Stitching Strike: the module's Effect: Stitching Strike was not found.");
        return "missing";
    }

    // A new Stitching Strike replaces the creature's earlier one, with its own round
    const earlier = target.itemTypes.effect.filter((e) => e.flags[MODULE_ID]?.stitchingStrike).map((e) => e.id);
    if (earlier.length > 0) await target.deleteEmbeddedDocuments("Item", earlier);

    const source = effect.toObject();
    source._stats = { ...source._stats, compendiumSource: IMMOBILIZED_EFFECT_UUID };
    source.name = `${source.name} (DC ${dc})`;
    source.system.level = { value: familiar.level ?? witch.level };
    source.system.description.value += `<p><strong>Escape</strong> DC ${dc}: [[/act escape dc=${dc}]]{Escape}</p>`;
    // "For 1 round" counts from the witch's turn, when the familiar acted: pf2e ends it at the start of their next
    source.system.context = {
        origin: { actor: witch.uuid, token: null, item: null, spellcasting: null, rollOptions: [] },
        target: { actor: target.uuid, token: targetToken.uuid },
        roll: null,
    };
    source.flags = { ...source.flags, [MODULE_ID]: { stitchingStrike: { witch: witch.uuid, dc, card: cardId } } };
    const [created] = await target.createEmbeddedDocuments("Item", [source]);
    if (created) playBound(created, targetToken);

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: target, token: targetToken }),
        content: [
            `<p><strong>Stitching Strike</strong> ${esc(targetToken.name)} is immobilized for 1 round or until it `,
            `[[/act escape dc=${dc}]]{Escapes} (DC ${dc}).</p>`,
        ].join(""),
    });
    return "applied";
}

/* Shed Spirit's healing: "it then flies to an ally within 30 feet of the enemy" */

/** The witch's allies within 30 feet of the enemy, most hurt first */
function getAllies(witch, familiar, targetToken) {
    const allies = [];
    for (const token of targetToken.parent.tokens) {
        const actor = token.actor;
        if (token === targetToken || actor === familiar || !isAvailable(token)) continue;
        if (!(actor === witch || actor.isAllyOf?.(witch))) continue;
        if (targetToken.object.distanceTo(token.object) > HEAL_RANGE) continue;
        const hp = actor.hitPoints ?? actor.attributes?.hp;
        if (!hp?.max) continue;
        allies.push({ token, missing: hp.max - hp.value, note: `${hp.value}/${hp.max} HP` });
    }
    return allies.sort((a, b) => b.missing - a.missing);
}

/** Ask the familiar's user which ally the spirit heals, and have the GM heal it */
async function chooseAlly(card) {
    const record = card.flags[MODULE_ID]?.familiarStrike;
    const witch = record?.witch ? fromUuidSync(record.witch) : null;
    const familiar = record?.familiar ? fromUuidSync(record.familiar) : null;
    const targetToken = record?.target ? fromUuidSync(record.target) : null;
    if (!witch || !familiar || !targetToken?.object) {
        return ui.notifications.warn("Shed Spirit: the enemy or familiar is gone. Restore the Hit Points by hand.");
    }
    if (!game.user.isGM && !game.users.activeGM) {
        return ui.notifications.warn("Shed Spirit: a GM must be logged in to restore the Hit Points.");
    }
    const amount = Math.floor(record.dealt / 2);
    const allies = getAllies(witch, familiar, targetToken);
    let allyToken = null;
    if (allies.length === 0) {
        ui.notifications.info(`Shed Spirit: no ally is within 30 feet of ${targetToken.name}.`);
    } else {
        const index = await chooseToken({
            title: "Shed Spirit",
            prompt: [
                `${esc(familiar.name)}'s spirit flies to an ally within 30 feet of ${esc(targetToken.name)}, `,
                `restoring ${amount} Hit Points (half the ${record.dealt} damage dealt).`,
            ].join(""),
            entries: allies,
            confirm: "Restore Hit Points",
        });
        if (index === null) return;
        allyToken = allies[index].token;
    }
    const data = { cardId: card.id, allyTokenUuid: allyToken?.uuid ?? null };
    if (game.user.isGM) return resolveHeal(data);
    // Players can't edit creatures they don't own, so the active GM restores the Hit Points
    game.socket.emit(SOCKET, { action: "shedSpiritHeal", ...data });
}

/** Restore the ally's Hit Points, or send the spirit back if there's no ally. Run by a GM. */
async function resolveHeal({ cardId, allyTokenUuid }) {
    const card = game.messages.get(cardId);
    const record = card?.flags[MODULE_ID]?.familiarStrike;
    if (record?.kind !== "shedSpirit" || !record.dealt || record.healed || resolving.has(cardId)) return;
    resolving.add(cardId);
    try {
        const familiarToken = fromUuidSync(record.familiarToken);
        const targetToken = fromUuidSync(record.target);
        const allyToken = allyTokenUuid ? fromUuidSync(allyTokenUuid) : null;
        const amount = Math.floor(record.dealt / 2);
        if (!allyToken?.actor) {
            await card.update({ [`flags.${MODULE_ID}.familiarStrike.healed`]: { ally: null, amount: 0 } });
            return playReturn(familiarToken, targetToken);
        }
        await card.update({
            [`flags.${MODULE_ID}.familiarStrike.healed`]: { ally: allyToken.uuid, name: allyToken.name, amount },
        });
        playHeal(familiarToken, targetToken, allyToken);
        // A negative amount is healing, as pf2e's own healing buttons apply it
        if (amount > 0) await allyToken.actor.applyDamage({ damage: -amount, token: allyToken });
    } finally {
        resolving.delete(cardId);
    }
}

/* Escaping Stitching Strike: "until it Escapes against your spell DC" */

/** The degree of success of a check against a DC, from its total and die, when pf2e didn't work it out */
function degreeOf(total, die, dc) {
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (die === 20) degree = Math.min(3, degree + 1);
    else if (die === 1) degree = Math.max(0, degree - 1);
    return degree;
}

/** An Escape check by a creature bound by Stitching Strike: a success against its DC ends the effect */
async function onEscape(message, context) {
    const actor = message.actor;
    if (!actor?.isOwner) return;
    const roll = message.rolls[0];
    if (!roll) return;
    const die = roll.dice?.[0]?.total ?? null;
    const escaped = actor.itemTypes.effect.filter((effect) => {
        const dc = effect.flags[MODULE_ID]?.stitchingStrike?.dc;
        if (!Number.isFinite(dc)) return false;
        const checkDC = context.dc?.value;
        // An Escape against another DC (a grab, for one) is from something else
        if (Number.isFinite(checkDC) && checkDC !== dc) return false;
        const degree =
            Number.isFinite(checkDC) && OUTCOMES.includes(context.outcome)
                ? OUTCOMES.indexOf(context.outcome)
                : degreeOf(roll.total, die, dc);
        return degree >= 2;
    });
    if (escaped.length === 0) return;
    await actor.deleteEmbeddedDocuments(
        "Item",
        escaped.map((e) => e.id),
    );
    await ChatMessage.create({
        speaker: message.speaker,
        content: `<p><strong>Stitching Strike</strong> ${esc(message.token?.name ?? actor.name)} Escapes the fibers and is no longer immobilized.</p>`,
    });
}

const isEscape = (context) =>
    (context.options ?? []).some((o) => o === "action:escape" || o.startsWith("action:escape:"));

Hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id) return;
    const kind = getCardKind(message);
    if (kind) {
        if (isEnabled(KINDS[kind].feature)) useStrike(kind, message.actor, { item: message.item }).catch(log);
        return;
    }

    const context = message.flags.pf2e?.context;
    if (!context) return;
    if (isEscape(context) && isEnabled("stitchingStrike")) return void onEscape(message, context).catch(log);
    if (context.type !== "saving-throw" || !OUTCOMES.includes(context.outcome)) return;
    const identifier = typeof context.identifier === "string" ? context.identifier : "";
    if (!identifier.startsWith(SAVE_IDENTIFIER)) return;

    const cardId = identifier.slice(SAVE_IDENTIFIER.length);
    const record = game.messages.get(cardId)?.flags[MODULE_ID]?.familiarStrike;
    if (!record) return;
    if (record.outcome) {
        return ui.notifications.info(
            `${KINDS[record.kind]?.title}: the result was already applied. Adjust a reroll by hand.`,
        );
    }
    const data = { cardId, outcome: context.outcome };
    if (game.user.isGM) return void resolveSave(data).catch(log);
    // Players can't edit the familiar's card, or creatures they don't own, so the active GM applies the result
    game.socket.emit(SOCKET, { action: "familiarStrikeSave", ...data });
});

/** The card's controls: the save button, then the result, then (Shed Spirit) the healing button */
function renderCard(message, html) {
    const record = message.flags[MODULE_ID]?.familiarStrike;
    const content = html?.querySelector?.(".message-content") ?? html;
    const controls = content?.querySelector?.("[data-ehb-familiar-strike]");
    const config = KINDS[record?.kind];
    if (!config || !controls) return;

    const target = fromUuidSync(record.target)?.actor;
    const name = esc(fromUuidSync(record.target)?.name ?? target?.name ?? "the creature");
    const note = (text) => {
        const p = document.createElement("p");
        p.innerHTML = `<em>${text}</em>`;
        return p;
    };
    const button = (icon, text, onClick) => {
        const element = document.createElement("button");
        element.type = "button";
        element.innerHTML = `<i class="fa-solid ${icon}"></i> ${text}`;
        element.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            element.disabled = true;
            onClick()
                .catch(log)
                .finally(() => (element.disabled = false));
        });
        return element;
    };
    const saveLabel = SAVE_LABELS[config.save];

    if (!record.outcome) {
        if (!target?.isOwner) return controls.replaceChildren(note(`Waiting for ${name}'s ${saveLabel} save.`));
        return controls.replaceChildren(
            button("fa-dice-d20", `${saveLabel} Save DC ${record.dc}: ${name}`, () => rollSave(message)),
        );
    }

    const parts = [`${saveLabel} save: ${esc(outcomeLabel(record.outcome))}. ${name} ${DAMAGE[record.outcome].text}`];
    if (Number.isFinite(record.dealt) && DAMAGE[record.outcome].multiplier > 0) {
        parts[0] += ` (${record.dealt} damage dealt)`;
    }
    parts[0] += ".";
    if (record.immobilized === "applied") parts.push(`It's immobilized until it Escapes (DC ${record.dc}).`);
    else if (record.immobilized === "immune") parts.push("It's immune to immobilized.");
    const children = [];

    if (record.kind === "shedSpirit" && record.dealt > 0) {
        const amount = Math.floor(record.dealt / 2);
        if (record.healed?.ally) {
            parts.push(`The spirit restores ${record.healed.amount} Hit Points to ${esc(record.healed.name)}.`);
        } else if (record.healed) {
            parts.push("The spirit returns without healing anyone.");
        } else {
            const familiar = fromUuidSync(record.familiar);
            if (familiar?.isOwner) {
                children.push(button("fa-heart", `Restore ${amount} Hit Points to an ally`, () => chooseAlly(message)));
            } else {
                parts.push(`Waiting for the spirit to restore ${amount} Hit Points to an ally.`);
            }
        }
    }
    controls.replaceChildren(note(parts.join(" ")), ...children);
}

Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.flags[MODULE_ID]?.familiarStrike) renderCard(message, html);
});

Hooks.once("init", () => {
    const module = game.modules.get(MODULE_ID);
    // For a macro: pass the familiar, or the witch
    module.api = {
        ...module.api,
        shedSpirit: guardApi("shedSpirit", (actor) => useStrike("shedSpirit", actor)),
        stitchingStrike: guardApi("stitchingStrike", (actor) => useStrike("stitchingStrike", actor)),
    };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (game.user !== game.users.activeGM) return;
        if (data?.action === "familiarStrikeSave") await resolveSave(data).catch(log);
        else if (data?.action === "shedSpiritHeal") await resolveHeal(data).catch(log);
    });
});

export { degreeOf, getDice, getKind };
