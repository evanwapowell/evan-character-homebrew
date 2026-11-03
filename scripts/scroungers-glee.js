/**
 * Scrounger's Glee (Devourer of Decay witch hex cantrip): "The target becomes frightened 1 if it fails a Will save (or
 * frightened 2 on a critical failure). This condition can't be reduced below 1 while the spell is active and the target
 * can hear you. You can Dismiss the spell as a reaction when an ally critically succeeds at a Strike against the
 * target, restoring (rank/2)d4 Hit Points to that ally."
 *
 * pf2e has no automation for it. The spell conditions' Apply button (scripts/spell-conditions.js) reads the frightened
 * value from the spell's text; on a failed save this adds the module's Effect: Scrounger's Glee, which keeps the target
 * at frightened 1 while it isn't deafened and lasts as long as the spell is Sustained. When an ally critically succeeds
 * at a Strike against a creature with the effect, the caster's user is asked whether to Dismiss the spell to heal them.
 */

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const PACK = `Compendium.${MODULE_ID}.evans-character-homebrew.Item`;
/** This module's Effect: Scrounger's Glee */
const EFFECT_ID = "AxUfnmwrn1XTPTNU";
const EFFECT_UUID = `${PACK}.${EFFECT_ID}`;
/** ID of pf2e's Scrounger's Glee spell, the same in every pf2e version */
const SPELL_ID = "VNv96dJPi0WXKSFN";
const TITLE = "Scrounger's Glee";

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | Scrounger's Glee`, error);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));

function isGleeSpell(item) {
    return item?.type === "spell" && (item.slug === "scroungers-glee" || endsWithId(item, SPELL_ID));
}

function isGleeEffect(item) {
    return item?.type === "effect" && (item.slug === "effect-scroungers-glee" || endsWithId(item, EFFECT_ID));
}

/** The healing on a Dismiss: 1d4, and 1d4 more every 2 ranks */
function healingFormula(rank) {
    return `${Math.ceil(Math.max(1, rank) / 2)}d4`;
}

/** An attack roll message that's a critically successful Strike, rather than a spell attack */
function isStrikeCrit(context) {
    if (context?.type !== "attack-roll" || context.outcome !== "criticalSuccess") return false;
    const options = context.options ?? [];
    return (
        (context.domains ?? []).includes("strike-attack-roll") ||
        options.includes("action:strike") ||
        options.includes("self:action:slug:strike")
    );
}

/** The user who answers for the caster: a logged-in player who owns them, or the active GM */
function getResponder(caster) {
    const players = game.users.filter((u) => u.active && !u.isGM && caster.testUserPermission(u, "OWNER"));
    return players.find((u) => u.character === caster) ?? players[0] ?? game.users.activeGM;
}

const JB2A_HEAL = "modules/JB2A_DnD5e/Library/Generic/Healing/HealingAbility_01_Green_400x400.webm";

function playHealAnimation(token) {
    if (!(game.modules.get("sequencer")?.active && game.modules.get("JB2A_DnD5e")?.active) || !token?.object) return;
    new Sequence().effect().file(JB2A_HEAL).atLocation(token).scaleToObject(1.5).fadeIn(200).fadeOut(400).play();
}

/** Messages already answered, so a Strike isn't asked about twice */
const asked = new Set();

/** An ally's Strike critically succeeded against a creature: ask the caster of its Scrounger's Glee to Dismiss it */
async function onStrikeCrit(message, context) {
    const attacker = message.actor;
    const targetToken = context.target?.token ? fromUuidSync(context.target.token) : null;
    const target = targetToken?.actor ?? (context.target?.actor ? fromUuidSync(context.target.actor) : null);
    if (!attacker || !target || asked.has(message.id)) return;

    for (const effect of target.itemTypes.effect.filter((e) => isGleeEffect(e) && !e.remainingDuration.expired)) {
        const caster = effect.origin;
        if (!caster || attacker === caster || !attacker.isAllyOf(caster)) continue;
        if (getResponder(caster) !== game.user) continue;
        asked.add(message.id);
        await promptDismiss({ caster, effect, attacker, attackerToken: message.token, target });
        return;
    }
}

async function promptDismiss({ caster, effect, attacker, attackerToken, target }) {
    const formula = healingFormula(effect.level);
    const content = [
        `<p>${esc(attacker.name)} critically succeeded at a Strike against ${esc(target.name)}.</p>`,
        `<p>${esc(caster.name)} can Dismiss ${TITLE} as a reaction, restoring ${formula} Hit Points to `,
        `${esc(attacker.name)}.</p>`,
    ].join("");
    const dismiss = await foundry.applications.api.DialogV2.confirm({
        window: { title: `${TITLE}: ${caster.name}` },
        content,
        yes: { label: "Dismiss and Heal", default: true },
        no: { label: "Keep the Spell" },
        rejectClose: false,
    });
    if (dismiss !== true) return;
    // Checked again: the spell could have ended while the question was open
    if (!fromUuidSync(effect.uuid)) return ui.notifications.info(`${TITLE}: the spell has already ended.`);

    const roll = await new Roll(formula).evaluate();
    const allyToken = attackerToken ?? attacker.getActiveTokens(true, true)[0]?.document ?? null;
    await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        flavor: [
            `<p><strong>${TITLE}</strong> ${esc(caster.name)} Dismisses the spell as a reaction, restoring Hit Points `,
            `to ${esc(attacker.name)}.</p>`,
        ].join(""),
    });

    const data = { effectUuid: effect.uuid, allyTokenUuid: allyToken?.uuid ?? null, healing: roll.total };
    const canDoItAll = effect.canUserModify(game.user, "delete") && (!allyToken || attacker.isOwner);
    if (canDoItAll) return dismissSpell(data);
    if (!game.users.activeGM) {
        return ui.notifications.warn(`${TITLE}: a GM must be logged in to end the spell and apply the healing.`);
    }
    // Players can't edit creatures they don't own, so the active GM ends the spell and heals the ally
    game.socket.emit(SOCKET, { action: "scroungersGlee", ...data });
}

/** End the spell's effect and heal the ally */
async function dismissSpell({ effectUuid, allyTokenUuid, healing }) {
    const effect = await fromUuid(effectUuid);
    const spellUuid = effect?.system.context?.origin?.item ?? null;
    const spell = spellUuid ? fromUuidSync(spellUuid) : null;
    await effect?.delete();

    const allyToken = allyTokenUuid ? await fromUuid(allyTokenUuid) : null;
    if (!allyToken?.actor || !(healing > 0)) return;
    playHealAnimation(allyToken);
    // Negative damage is healing, with the ally's healing adjustments
    await allyToken.actor.applyDamage({ damage: -healing, token: allyToken, item: spell?.actor ? spell : null });
}

Hooks.on("createChatMessage", (message) => {
    // Every client sees the Strike, so only the caster's user is asked
    const context = message.flags.pf2e?.context;
    if (isStrikeCrit(context)) onStrikeCrit(message, context).catch(log);
});

Hooks.once("init", () => {
    const module = game.modules.get(MODULE_ID);
    // Read by scripts/spell-conditions.js: the effect goes with the frightened condition on a failed save
    module.spellEffects = [
        ...(module.spellEffects ?? []),
        (spell, outcome) =>
            isGleeSpell(spell) && ["failure", "criticalFailure"].includes(outcome) ? [EFFECT_UUID] : [],
    ];
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "scroungersGlee" || game.user !== game.users.activeGM) return;
        await dismissSpell(data).catch(log);
    });
});
