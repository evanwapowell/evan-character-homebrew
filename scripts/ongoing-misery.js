/**
 * Familiar of Ongoing Misery: "When you Cast or Sustain a hex, your familiar can curse a creature within 15 feet of it,
 * prolonging one negative condition of your choice affecting the creature by 1 round." Only conditions with a timed
 * duration qualify, which in pf2e means a condition granted by an effect with a timed duration: that effect is the one
 * extended. The errata's "only once to a given case of a condition" is a world setting, off by default.
 */

import { isSpellCast } from "./lib/casting.js";
import { playCurse } from "./lib/finch.js";
import { tokenDistance } from "./lib/geometry.js";
import { chooseOne } from "./lib/ui.js";
import { MODULE_ID, byDistance, endsWithId, esc, getSceneToken } from "./lib/util.js";
import {
    askGM,
    canAnimate,
    canAnimateFinch,
    createdHere,
    featureHooks,
    guardApi,
    isEnabled,
    onGMRequest,
    owns,
    refuse,
} from "./settings.js";

/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("ongoingMisery");
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

/** Whether each case of a condition can be prolonged only once (the errata), rather than on every hex */
function isOncePerCase() {
    return game.settings.get(MODULE_ID, "ongoingMiseryOncePerCase");
}

/**
 * Whether the witch's familiar has the ability. pf2e grants it through the witch's patron (The Resentment), which
 * boxes it in hex descriptions instead of adding it to the familiar, but it can also be on the familiar's sheet.
 */
function hasOngoingMisery(witch, familiar) {
    const fromPatron = witch.items.some(
        (i) => endsWithId(i, RESENTMENT_ID) || JSON.stringify(i._source.system.rules ?? []).includes("OngoingMisery"),
    );
    return (
        fromPatron ||
        !!familiar?.items.some(
            (i) => endsWithId(i, ABILITY_ID) || i.name.toLowerCase() === "familiar of ongoing misery",
        )
    );
}

const warned = new Set();
function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    ui.notifications.warn(`Familiar of Ongoing Misery: ${message}`);
}

/**
 * Whether a chat message is the card of a hex being cast. pf2e 8.5 marks a cast; before it, a hex's card sent to chat
 * can't be told from one cast, so both count.
 */
function isHexCast(message) {
    // Sustaining reposts the spell's card: the Sustain handler below covers it
    if (message.flags[MODULE_ID]?.sustain) return false;
    return isSpellCast(message, { unmarked: true }) && message.item.traits.has("hex");
}

/** Timed effects granting a negative condition to creatures within 15 feet of the familiar */
function getEligibleEffects(familiarToken) {
    const options = [];
    for (const token of familiarToken.parent.tokens) {
        const actor = token.actor;
        if (!actor || token === familiarToken || token.hidden || !token.object || !familiarToken.object) continue;
        if (familiarToken.object.distanceTo(token.object) > RANGE) continue;
        // This is a curse effect
        if (isImmuneToCurses(actor)) continue;

        for (const effect of actor.itemTypes.effect) {
            const conditions = prolongable(actor, effect);
            if (conditions.length === 0) continue;
            const rounds = Math.max(1, Math.ceil(effect.remainingDuration.remaining / 6));
            options.push({ token, effect, conditions, rounds });
        }
    }
    return options;
}

function isImmuneToCurses(actor) {
    return !!actor.attributes?.immunities?.some?.((i) => i.type === "curse");
}

/** The negative conditions a timed effect grants, which prolonging it prolongs (none when it can't be prolonged) */
function prolongable(actor, effect) {
    if (!ROUNDS_PER_UNIT[effect.system.duration.unit] || effect.remainingDuration.expired) return [];
    if (isOncePerCase() && effect.flags[MODULE_ID]?.ongoingMisery) return [];
    return actor.conditions.contents.filter(
        (c) => c.flags.pf2e?.grantedBy?.id === effect.id && !POSITIVE_CONDITIONS.has(c.slug),
    );
}

function announce(familiar, token, conditions) {
    const names = esc(conditions.map((c) => c.name).join(", "));
    return `${esc(familiar.name)} curses ${esc(token.name)}, prolonging ${names} by 1 round.`;
}

/** Add 1 round to an effect's duration, mark it as extended, and announce it from the familiar */
async function extendEffect(effect, { familiarTokenUuid, announcement }) {
    const { value, unit, expiry } = effect._source.system.duration;
    const perUnit = ROUNDS_PER_UNIT[unit];
    if (!perUnit || (isOncePerCase() && effect.flags[MODULE_ID]?.ongoingMisery)) return;
    await effect.update({
        "system.duration.value": value * perUnit + 1,
        "system.duration.unit": "rounds",
        // pf2e sets an expiry left out of a duration update to the start of the turn (EffectPF2e#_preUpdate)
        "system.duration.expiry": expiry,
        [`flags.${MODULE_ID}.ongoingMisery`]: true,
    });
    // Posted by whoever extended it, so it only appears once the extension is applied
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: fromUuidSync(familiarTokenUuid) }),
        content: `<p><strong>Familiar of Ongoing Misery</strong> ${announcement}</p>`,
    });
}

/** JB2A (free) animations: a purple bolt from the familiar, by the longest distance each file covers, then a curse */
const JB2A_LIBRARY = "modules/JB2A_DnD5e/Library";
const CURSE_BOLTS = [
    [5, "Cantrip/Eldritch_Blast/EldritchBlast_01_Regular_Purple_05ft_600x400.webm"],
    [15, "Cantrip/Eldritch_Blast/EldritchBlast_01_Regular_Purple_15ft_1000x400.webm"],
    [30, "Cantrip/Eldritch_Blast/EldritchBlast_01_Regular_Purple_30ft_1600x400.webm"],
];
const CURSE_MARKS = 24;

/** The familiar hurls a curse at the creature, which lands as a curse sigil on it */
function playCurseAnimation(familiarToken, targetToken) {
    if (!familiarToken.object || !targetToken.object) return;
    const distance = familiarToken.object.distanceTo(targetToken.object);
    // The Finch version: a wisp drifts from the familiar, and a marionette's bar draws a sigil up out of the creature
    if (canAnimateFinch()) {
        playCurse(new Sequence(), { familiarToken: familiarToken.object, targetToken: targetToken.object, distance });
        return;
    }
    if (!canAnimate()) return;

    const bolt = byDistance(CURSE_BOLTS, distance);
    const mark = String(Math.floor(Math.random() * CURSE_MARKS) + 1).padStart(3, "0");
    new Sequence()
        .effect()
        .file(`${JB2A_LIBRARY}/${bolt}`)
        .atLocation(familiarToken)
        .stretchTo(targetToken)
        .effect()
        .file(`${JB2A_LIBRARY}/Generic/Conditions/Curse01/ConditionCurse01_${mark}_Red_600x600.webm`)
        .atLocation(targetToken)
        .scaleToObject(1.6)
        .delay(500)
        .fadeIn(200)
        .fadeOut(500)
        .play();
}

/** Prompt the witch's user to curse a creature, extending the chosen condition */
async function promptOngoingMisery(actor) {
    const witch = actor?.isOfType?.("familiar") ? actor.master : actor;
    if (!witch?.isOfType?.("character")) return;
    const familiar = witch.familiar;
    if (!hasOngoingMisery(witch, familiar)) return;
    if (!familiar) return warnOnce(`${witch.name} has no familiar actor linked.`);

    // The 15-foot range is measured from the familiar
    const familiarToken = getSceneToken(familiar);
    if (!familiarToken) return warnOnce(`${familiar.name} has no token on this scene.`);
    const options = getEligibleEffects(familiarToken);
    if (options.length === 0) return;

    const choices = options.map(({ token, effect, conditions, rounds }) => {
        const conditionNames = conditions.map((c) => c.name).join(", ");
        return [
            `<strong>${esc(token.name)}</strong>: ${esc(conditionNames)} `,
            `<em>(${esc(effect.name)}, ${rounds} ${rounds === 1 ? "round" : "rounds"} left)</em>`,
        ].join("");
    });
    const choice = await chooseOne({
        title: "Familiar of Ongoing Misery",
        intro: `<p>${esc(familiar.name)} can curse a creature within 15 feet, prolonging a negative condition by 1 round.</p>`,
        choices,
        confirm: "Curse",
        cancel: "Skip",
    });
    if (choice === null) return;
    const { token, effect, conditions } = options[choice];
    const announcement = announce(familiar, token, conditions);
    const extension = { familiarTokenUuid: familiarToken.uuid, announcement };

    const canExtend = effect.canUserModify(game.user, "update");
    if (!canExtend && !game.users.activeGM) {
        return ui.notifications.warn("Familiar of Ongoing Misery: a GM must be logged in to curse that creature.");
    }
    // Played here, where the tokens are on screen; Sequencer shows it to everyone
    playCurseAnimation(familiarToken, token);
    if (canExtend) return extendEffect(effect, extension);
    // Players can't update effects on creatures they don't own, so the active GM extends those
    const data = { effectUuid: effect.uuid, ...extension };
    // Not waited for: the Sustain's other prompts (Parasitic Might's) needn't wait on the GM
    void askGM("ongoingMisery", data, { title: "Familiar of Ongoing Misery", task: "curse that creature" });
}

hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId) || !isHexCast(message)) return;
    promptOngoingMisery(message.actor).catch((error) => console.error(`${MODULE_ID} | Ongoing Misery`, error));
});

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "ongoingMiseryOncePerCase", {
        name: "Familiar of Ongoing Misery: once per condition",
        hint:
            "Errata: each case of a condition can be prolonged only once. " +
            "When off, it can be prolonged again on every Cast or Sustain of a hex.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
    });

    const module = game.modules.get(MODULE_ID);
    // Sustaining through scripts/sustain.js, which knows whether the sustained spell is a hex
    module.sustainHandlers = [
        ...(module.sustainHandlers ?? []),
        (actor, { hex }) => (hex && isEnabled("ongoingMisery") ? promptOngoingMisery(actor) : undefined),
    ];
    // For a macro: pass the witch or their familiar
    module.api = { ...module.api, ongoingMisery: guardApi("ongoingMisery", (actor) => promptOngoingMisery(actor)) };
});

/**
 * A player's request to prolong a condition: the familiar (with the ability) is theirs or their witch's, and the effect
 * grants a negative condition with a timed duration to a creature within 15 feet of it. The announcement is written
 * here, from the names.
 */
async function checkExtend(data, sender) {
    const read = (uuid) => (typeof uuid === "string" ? fromUuid(uuid).catch(() => null) : null);
    const familiarToken = await read(data.familiarTokenUuid);
    const familiar = familiarToken?.actor;
    const witch = familiar?.isOfType?.("familiar") ? familiar.master : null;
    if (!witch || !hasOngoingMisery(witch, familiar)) refuse("that isn't a familiar of ongoing misery");
    if (!owns(sender, familiar) && !owns(sender, witch)) refuse(`${sender.name} doesn't own ${familiar.name}`);
    const effect = await read(data.effectUuid);
    const actor = effect?.type === "effect" ? effect.actor : null;
    if (!actor) throw new Error("the condition has ended");
    const token = familiarToken.parent.tokens.find(
        (t) => t.actor === actor && !t.hidden && tokenDistance(familiarToken, t) <= RANGE,
    );
    if (!token) refuse(`${actor.name} isn't within ${RANGE} feet of ${familiar.name}`);
    if (isImmuneToCurses(actor)) refuse(`${actor.name} is immune to curses`);
    const conditions = prolongable(actor, effect);
    if (conditions.length === 0) refuse(`${effect.name} doesn't give a negative condition that can be prolonged`);
    return {
        effectUuid: effect.uuid,
        familiarTokenUuid: familiarToken.uuid,
        announcement: announce(familiar, token, conditions),
    };
}

onGMRequest(
    "ongoingMisery",
    async (data) => {
        const effect = await fromUuid(data.effectUuid);
        if (!effect) throw new Error("the condition has ended");
        await extendEffect(effect, data);
    },
    { check: checkExtend },
);
