/**
 * Counteract: picks what to counteract, works out its counteract rank and DC, rolls the check against it, and ends what
 * was counteracted, so nobody has to look up the rules at the table.
 *
 * - A spell card's Counteract button (pf2e shows it on spells that counteract, like Dispel Magic or Clear Mind) asks
 *   which effects on the caster's targets to counteract, rather than only rolling the check.
 * - A counteract roll made some other way (an item's [[/r 1d20+25 #Counteract]], a counteract @Check, pf2e's own roll)
 *   gets a button on its card to resolve it the same way, against that roll.
 * - A macro, game.modules.get("evan-character-homebrew").api.counteract(), counteracts with the selected creature's
 *   spellcasting, a skill or a set modifier, for anything else that says to attempt a counteract check.
 *
 * What can be counteracted on a creature: a spell's effects (grouped by spell, at the rank it was cast and against its
 * caster's spell DC), an aura's effects (at their source, the aura's effect on its caster), other effects (half their
 * level rounded up, against the DC for their level), afflictions (their DC), conditions not granted by an effect, and
 * the creature itself (like a summoned creature). The rank and DC of what can't be worked out are filled in by hand.
 *
 * Players can't edit creatures they don't own, so the active GM removes what's counteracted on those.
 */

import {
    OUTCOMES,
    counteracts,
    degreeOfSuccess,
    describeReach,
    levelDC,
    maxCounteractedRank,
    rankFromLevel,
    rankFromText,
    spellRankDC,
} from "./lib/counteract-rules.js";
import { featureHooks, guardApi } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const TOOLBELT_ID = "pf2e-toolbelt";
/** This script's hooks do nothing while it's turned off in the module's settings */
const hooks = featureHooks("counteract");
/** Counteract checks rolled by this module carry this identifier, followed by the request's ID */
const IDENTIFIER = "ehb-counteract:";
/** Item types a counteract can end */
const REMOVABLE_TYPES = ["effect", "condition", "affliction"];
/** Traits that mark an effect as magic, which is what's usually counteracted */
const MAGIC_TRAITS = ["magical", "arcane", "divine", "occult", "primal"];

const esc = (text) => Handlebars.escapeExpression(String(text ?? ""));
const log = (error) => console.error(`${MODULE_ID} | Counteract`, error);
const outcomeLabel = (outcome) => game.i18n.localize(`PF2E.Check.Result.Degree.Check.${outcome}`);
const signed = (value) => (value < 0 ? `${value}` : `+${value}`);
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Requests whose check is being rolled, by ID, until its message arrives */
const pending = new Map();

function resolveSync(uuid) {
    if (typeof uuid !== "string" || !uuid) return null;
    try {
        return fromUuidSync(uuid);
    } catch {
        return null;
    }
}

/** An actor from an actor's or token's UUID */
function actorOf(doc) {
    if (!doc) return null;
    return doc instanceof Actor ? doc : (doc.actor ?? null);
}

function isPwol() {
    return !!game.pf2e?.settings?.variants?.pwol?.enabled;
}

/** pf2e's "Show DCs to players" setting */
function showDCs() {
    return !!game.pf2e?.settings?.metagame?.dcs;
}

function spellDC(spell) {
    if (!spell?.actor) return null;
    const statistic = spell.spellcasting?.statistic;
    return statistic?.withRollOptions?.({ item: spell })?.dc.value ?? statistic?.dc?.value ?? null;
}

/* What can be counteracted */

/**
 * Where an effect, condition or affliction came from, and its counteract rank and DC. The spell conditions' Apply
 * button records the spell on what it applies; pf2e records the caster and spell on effects dragged from a spell's card.
 * `dcFrom` says where the DC came from: "caster" (their spell DC), "statBlock" (an affliction's), "rank" or "level"
 * (the DC for the spell's rank or the effect's level, when nothing better is known), or null (unknown).
 */
function describeSource(item) {
    const record = item.flags?.[MODULE_ID]?.spellSource ?? null;
    const origin = item.system?.context?.origin ?? null;
    const caster = actorOf(resolveSync(record?.caster ?? origin?.actor));
    const found = resolveSync(record?.spell ?? origin?.item);
    const spell = found?.type === "spell" ? found : null;
    const fromSpell = !!record || !!spell || !!item.fromSpell;
    const level = Number(item.system?.level?.value);
    const pwol = isPwol();

    if (fromSpell) {
        // A spell's counteract rank is the rank it was cast at, which pf2e gives its effects as their level
        const rank = Number(record?.rank) || (level > 0 ? level : null) || spell?.rank || 1;
        const casterDC = Number(record?.dc) || spellDC(spell) || caster?.getStatistic?.("spell-dc")?.dc?.value || null;
        const dc = casterDC ?? spellRankDC(rank, { pwol });
        return {
            caster,
            spell,
            spellName: spell?.name ?? record?.name ?? null,
            fromSpell,
            rank,
            dc,
            dcFrom: casterDC ? "caster" : "rank",
        };
    }
    if (!Number.isFinite(level))
        return { caster, spell: null, spellName: null, fromSpell, rank: null, dc: null, dcFrom: null };
    const statBlockDC = item.type === "affliction" ? Number(item.system.save?.value) || null : null;
    const dc = statBlockDC ?? levelDC(level, { pwol });
    return {
        caster,
        spell: null,
        spellName: null,
        fromSpell,
        rank: rankFromLevel(level),
        dc,
        dcFrom: statBlockDC ? "statBlock" : "level",
    };
}

/** An aura's effect is counteracted at its source: the effect with the aura, on the creature emitting it */
function findAuraSource(effect) {
    const aura = effect.flags?.pf2e?.aura;
    const emitter = actorOf(resolveSync(aura?.origin));
    if (!emitter || !aura?.slug) return null;
    return emitter.itemTypes.effect.find((e) => e.rules?.some((r) => r.key === "Aura" && r.slug === aura.slug)) ?? null;
}

/** The conditions an item grants on its creature, which end with it */
function grantedConditions(actor, item) {
    return actor.itemTypes.condition.filter(
        (c) => c.flags?.pf2e?.grantedBy?.id === item.id || c.system?.references?.parent?.id === item.id,
    );
}

function conditionName(condition) {
    const value = condition.value ?? condition.system?.value?.value;
    return typeof value === "number" && !condition.name.endsWith(` ${value}`)
        ? `${condition.name} ${value}`
        : condition.name;
}

/**
 * Whether a DC is kept from players: a caster's spell DC or a stat block's, unless pf2e shows DCs or the caster is a
 * player's. DCs worked out by rank or level aren't secret.
 */
function isDCSecret(info) {
    return !showDCs() && !info.caster?.hasPlayerOwner && ["caster", "statBlock"].includes(info.dcFrom);
}

/**
 * The things on a creature that can be counteracted, each with what ending it removes. `main` ones are listed first:
 * spells, auras, afflictions, conditions and other magic; the rest are tucked away.
 */
function getCandidates(actor, { counteractor = null } = {}) {
    const rows = [];
    const byKey = new Map();
    const isGM = game.user.isGM;
    // What one casting of a spell did to a creature, its effects and conditions, is one entry
    const spellKey = (holder, info, item) =>
        info.fromSpell && (info.spell || info.caster)
            ? `spell:${holder.uuid}:${info.caster?.uuid ?? ""}:${info.spell?.uuid ?? info.spellName ?? item.slug}`
            : null;

    for (const effect of actor.itemTypes.effect) {
        // An aura is counteracted at its source, so its effects on each creature in it are one entry
        const source = effect.fromAura ? findAuraSource(effect) : effect.isAura ? effect : null;
        const item = source ?? effect;
        const info = describeSource(item);
        const holder = item.actor ?? actor;
        const key = source ? `aura:${source.uuid}` : (spellKey(holder, info, item) ?? `item:${item.uuid}`);
        const known = byKey.get(key);
        if (known) {
            if (!known.items.includes(item.uuid)) known.items.push(item.uuid);
            known.rank = Math.max(known.rank ?? 0, info.rank ?? 0) || known.rank;
            known.grants.push(...grantedConditions(holder, item).map(conditionName));
            continue;
        }

        const identified = item.isIdentified !== false || isGM;
        const name = identified ? (info.spellName ?? item.name) : "Unidentified effect";
        const from = info.caster && info.caster !== holder ? ` from ${info.caster.name}` : "";
        const detail = source
            ? `aura on ${holder.name}${from}`
            : info.fromSpell
              ? `spell${from}`
              : Number.isFinite(Number(item.system?.level?.value))
                ? `level ${item.system.level.value}${from}`
                : from.trim();
        const traits = item.system?.traits?.value ?? [];
        const row = {
            key,
            kind: source ? "aura" : info.fromSpell ? "spell" : "effect",
            label: name,
            detail,
            img: item.img,
            creature: actor,
            items: [item.uuid],
            grants: grantedConditions(holder, item).map(conditionName),
            removable: true,
            rank: info.rank,
            dc: info.dc,
            dcFrom: info.dcFrom,
            dcSecret: isDCSecret(info),
            main:
                !!source ||
                info.fromSpell ||
                traits.some((t) => MAGIC_TRAITS.includes(t)) ||
                (!!info.caster && info.caster !== actor),
        };
        byKey.set(key, row);
        rows.push(row);
    }

    for (const affliction of actor.itemTypes.affliction ?? []) {
        const info = describeSource(affliction);
        rows.push({
            key: `item:${affliction.uuid}`,
            kind: "affliction",
            label: affliction.name,
            detail: `affliction, level ${affliction.system?.level?.value ?? "?"}`,
            img: affliction.img,
            creature: actor,
            items: [affliction.uuid],
            grants: grantedConditions(actor, affliction).map(conditionName),
            removable: true,
            rank: info.rank,
            dc: info.dc,
            dcFrom: info.dcFrom,
            dcSecret: isDCSecret(info),
            main: true,
        });
    }

    // Conditions that aren't granted by something else: one granted by an effect ends with it
    for (const condition of actor.itemTypes.condition) {
        const parentId = condition.flags?.pf2e?.grantedBy?.id ?? condition.system?.references?.parent?.id;
        if (parentId && actor.items.has(parentId)) continue;
        const info = describeSource(condition);
        const record = condition.flags?.[MODULE_ID]?.spellSource;
        // A condition from a spell whose effects are listed, like Fear's frightened with its fleeing timer, goes with them
        const known = byKey.get(spellKey(actor, info, condition));
        if (known) {
            known.items.push(condition.uuid);
            known.grants.push(conditionName(condition));
            continue;
        }
        rows.push({
            key: `item:${condition.uuid}`,
            kind: "condition",
            label: conditionName(condition),
            detail: record?.name ? `condition, from ${record.name}` : "condition",
            img: condition.img,
            creature: actor,
            items: [condition.uuid],
            grants: [],
            removable: true,
            rank: info.rank,
            dc: info.dc,
            dcFrom: info.dcFrom,
            dcSecret: isDCSecret(info),
            main: true,
        });
    }

    // The creature itself, like a summoned creature: reported, not removed
    if (actor !== counteractor && actor.isOfType?.("creature")) {
        const level = actor.level ?? 0;
        rows.push({
            key: `creature:${actor.uuid}`,
            kind: "creature",
            label: `${actor.name} itself`,
            detail: "a summoned or magical creature: by its level unless you change them",
            img: actor.img,
            creature: actor,
            items: [],
            grants: [],
            removable: false,
            rank: rankFromLevel(level),
            dc: levelDC(level, { pwol: isPwol() }),
            dcFrom: "level",
            dcSecret: false,
            main: false,
        });
    }
    return rows;
}

/** The creatures the counteract is aimed at: PF2e Toolbelt's targets on the card, the user's targets, or the counteractor */
function getTargetActors(message, counteractor) {
    const recorded =
        message && game.modules.get(TOOLBELT_ID)?.active ? message.flags?.[TOOLBELT_ID]?.targetHelper?.targets : null;
    const tokens =
        Array.isArray(recorded) && recorded.length > 0
            ? recorded.map(resolveSync)
            : [...(game.user.targets ?? [])].map((t) => t.document);
    const actors = tokens.map((t) => t?.actor).filter((a, i, all) => a && all.indexOf(a) === i);
    return actors.length > 0 ? actors : [counteractor].filter((a) => a);
}

/* The counteracting creature's options, for the macro */

/** What a creature can counteract with: its counteracting spells, its spellcasting, its skills, or a set modifier */
function getSourceOptions(actor) {
    const options = [];
    const spells = actor.itemTypes?.spell?.filter((s) => s.system?.counteraction) ?? [];
    for (const spell of spells) {
        const statistic = safe(() => spell.spellcasting?.counteraction);
        if (!statistic) continue;
        options.push({
            id: `spell:${spell.id}`,
            name: spell.name,
            label: `${spell.name} (rank ${spell.rank}, ${signed(statistic.mod)})`,
            statistic,
            traits: [...(spell.system.traits?.value ?? []), spell.spellcasting?.tradition].filter((t) => t),
            rank: spell.rank,
        });
    }
    for (const entry of actor.spellcasting?.contents ?? []) {
        const statistic = safe(() => entry.counteraction);
        if (!statistic) continue;
        options.push({
            id: `entry:${entry.id}`,
            name: entry.name,
            label: `${entry.name} (${signed(statistic.mod)})`,
            statistic,
            traits: [entry.tradition].filter((t) => t),
            rank: null,
        });
    }
    const skills = [actor.perception, ...Object.values(actor.skills ?? {})].filter((s) => s?.check);
    for (const skill of skills) {
        options.push({
            id: `skill:${skill.slug}`,
            name: skill.label,
            label: `${skill.label} (${signed(skill.mod)})`,
            statistic: skill,
            traits: [],
            rank: null,
        });
    }
    options.push({ id: "fixed", name: "Counteract", label: "A set modifier", fixed: true, rank: null });
    return options;
}

function safe(fn) {
    try {
        return fn() ?? null;
    } catch {
        return null;
    }
}

/* The dialog */

function numberField(name, value, placeholder, width = "4em") {
    const v = Number.isFinite(value) ? value : "";
    return `<input type="number" name="${name}" value="${v}" placeholder="${placeholder}" style="width: ${width}">`;
}

/** A candidate's line: a checkbox, what it is, and its rank and DC (fields where they're unknown, or for the GM) */
function rowHtml(row, index, checked) {
    const editable = game.user.isGM;
    const rank =
        editable || row.rank === null
            ? `rank ${numberField(`rank-${index}`, row.rank, "?")}`
            : `rank ${row.rank}<input type="hidden" name="rank-${index}" value="${row.rank}">`;
    const dc =
        editable || row.dc === null
            ? `DC ${numberField(`dc-${index}`, row.dc, "auto")}`
            : row.dcSecret
              ? "DC hidden"
              : `DC ${row.dc}`;
    const estimated = row.dc !== null && ["rank", "level"].includes(row.dcFrom) && row.kind !== "creature";
    const grants = row.grants.length > 0 ? `; ends ${row.grants.join(", ")}` : "";
    const note = [row.detail, estimated ? `DC by its ${row.dcFrom}` : ""].filter((t) => t).join(", ");
    const img = row.img ? `<img src="${esc(row.img)}" alt="" style="width: 20px; height: 20px; border: none">` : "";
    return [
        `<label style="display: flex; gap: 0.4em; align-items: center; margin: 0.2em 0">`,
        `<input type="checkbox" name="pick-${index}" ${checked ? "checked" : ""}>${img}`,
        `<span style="flex: 1">${esc(row.label)} <span style="opacity: 0.75; font-size: var(--font-size-12)">`,
        `(${esc(note + grants)})</span></span>`,
        `<span style="white-space: nowrap">${rank} ${dc}</span>`,
        `</label>`,
    ].join("");
}

/**
 * Ask what to counteract (and, from the macro, with what). Returns the request, or null if cancelled.
 * `sources` are the macro's options; a spell card or a roll has none, its source being fixed.
 */
async function pickTargets({ title, counteractor, creatures, rank, sources = null, rolled = null }) {
    // An aura's effects on several creatures are listed once, under the first
    const rows = creatures
        .flatMap((actor) => getCandidates(actor, { counteractor }))
        .filter((row, i, all) => all.findIndex((r) => r.key === row.key) === i);
    // The only thing on the targets is checked to start with; not the counteractor's own, listed for want of targets
    const preselect = rows.filter((r) => r.main && r.kind !== "creature" && r.creature !== counteractor);

    const sections = creatures.map((actor) => {
        const own = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.creature === actor);
        const main = own.filter(({ row }) => row.main);
        const rest = own.filter(({ row }) => !row.main);
        const line = ({ row, i }) => rowHtml(row, i, preselect.length === 1 && preselect[0] === row);
        const itself = rest.some(({ row }) => row.kind === "creature");
        const summary = itself
            ? rest.length > 1
                ? `Other effects, and ${esc(actor.name)} itself`
                : `${esc(actor.name)} itself`
            : "Other effects";
        const more =
            rest.length > 0
                ? `<details><summary>${summary} (${rest.length})</summary>${rest.map(line).join("")}</details>`
                : "";
        const empty = main.length === 0 ? `<p style="opacity: 0.75">Nothing magical on ${esc(actor.name)}.</p>` : "";
        return `<fieldset><legend>${esc(actor.name)}</legend>${main.map(line).join("")}${empty}${more}</fieldset>`;
    });

    const sourceField = sources
        ? [
              `<div class="form-group"><label>Counteract with</label><div class="form-fields">`,
              `<select name="source">${sources.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")}</select>`,
              `</div></div>`,
              `<div class="form-group"><label>Set modifier</label><div class="form-fields">${numberField("modifier", null, "+0", "6em")}</div>`,
              `<p class="hint">Only for "A set modifier", like an item's counteract modifier.</p></div>`,
          ].join("")
        : "";
    const rankHint = sources
        ? "Leave it blank for the spell's rank, or else half your level rounded up."
        : rolled
          ? `Checked against the roll of ${rolled.total}.`
          : "The spell's rank as cast.";
    const content = [
        sourceField,
        `<div class="form-group"><label>Your counteract rank</label>`,
        `<div class="form-fields">${numberField("rank", rank, "auto", "6em")}</div>`,
        `<p class="hint">${esc(rankHint)}</p></div>`,
        ...sections,
        `<fieldset><legend>Something else</legend>`,
        `<label style="display: flex; gap: 0.4em; align-items: center">`,
        `<input type="checkbox" name="pick-other">`,
        `<input type="text" name="other-name" placeholder="A spell being cast, an area, an item..." style="flex: 1">`,
        `<span style="white-space: nowrap">rank ${numberField("rank-other", null, "?")} DC ${numberField("dc-other", null, "auto")}</span>`,
        `</label></fieldset>`,
        `<p class="hint">Target creatures before counteracting to list them here. A spell's counteract rank is the rank `,
        `it was cast at; anything else's is half its level rounded up. Leave a DC blank to use the DC for its rank.</p>`,
    ].join("");

    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title, icon: "fa-solid fa-ban" },
        position: { width: 560 },
        content,
        buttons: [
            {
                action: "go",
                label: rolled ? "Counteract" : "Roll",
                icon: rolled ? "fa-solid fa-ban" : "fa-solid fa-dice-d20",
                default: true,
                callback: (_event, button) => readForm(button.form.elements, rows),
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
    if (!choice || typeof choice !== "object") return null;

    const source = sources ? (sources.find((s) => s.id === choice.sourceId) ?? sources[0]) : null;
    const targets = choice.targets;
    const missing = targets.filter((t) => !Number.isFinite(t.rank));
    if (missing.length > 0) {
        ui.notifications.warn(`Counteract: fill in the rank of ${missing.map((t) => t.label).join(", ")}.`);
        return null;
    }
    // A DC left blank is the DC for the target's rank (GM Core's DCs by spell rank)
    for (const target of targets) {
        if (Number.isFinite(target.dc)) continue;
        target.dc = spellRankDC(target.rank, { pwol: isPwol() });
        target.dcByRank = true;
        target.dcSecret = false;
    }
    if (targets.length === 0) {
        ui.notifications.warn("Counteract: check what to counteract.");
        return null;
    }
    const level = counteractor?.level ?? 0;
    const ownRank = Number.isFinite(choice.rank) ? choice.rank : (source?.rank ?? rank ?? rankFromLevel(level));
    return { source, modifier: choice.modifier, request: { id: foundry.utils.randomID(), rank: ownRank, targets } };
}

function readForm(form, rows) {
    const number = (name) => {
        const raw = form[name]?.value;
        return raw === undefined || raw === "" ? NaN : Number(raw);
    };
    const targets = [];
    rows.forEach((row, i) => {
        if (!form[`pick-${i}`]?.checked) return;
        const rank = form[`rank-${i}`] ? number(`rank-${i}`) : row.rank;
        const dc = form[`dc-${i}`] ? number(`dc-${i}`) : row.dc;
        targets.push({
            label: row.label,
            kind: row.kind,
            creature: row.creature.name,
            creatureUuid: row.creature.uuid,
            items: row.items,
            removable: row.removable,
            rank,
            dc,
            dcSecret: row.dcSecret,
        });
    });
    if (form["pick-other"]?.checked) {
        targets.push({
            label: form["other-name"]?.value?.trim() || "Something else",
            kind: "other",
            creature: null,
            creatureUuid: null,
            items: [],
            removable: false,
            rank: number("rank-other"),
            dc: number("dc-other"),
            dcSecret: false,
        });
    }
    return { sourceId: form.source?.value ?? null, rank: number("rank"), modifier: number("modifier"), targets };
}

/* Rolling */

/** pf2e's notes for a counteract check, with what each degree of success reaches at this rank */
function rollNotes(rank) {
    return OUTCOMES.map((outcome) => ({
        selector: "counteract-check",
        title: `PF2E.Check.Result.Degree.Check.${outcome}`,
        text: `${capitalize(describeReach(outcome, rank))}.`,
        outcome: [outcome],
    }));
}

/**
 * Roll the counteract check: with a statistic (spellcasting's counteract statistic, or a skill), through pf2e, so its
 * bonuses to counteract checks apply; or a d20 with a set modifier. Against one target, it's rolled against its DC.
 */
async function rollCheck({ request, source, modifier, actor, token = null, event = null }) {
    const single = request.targets.length === 1 ? request.targets[0] : null;
    // Named on the result card: the spell, or the statistic rolled
    if (!source?.fixed) request.sourceName = source?.name ?? null;
    pending.set(request.id, request);
    try {
        if (source?.statistic) {
            const name = game.i18n.localize("PF2E.Check.Specific.Counteract");
            const dc = single ? { value: single.dc, label: `${single.label} DC`, visible: !single.dcSecret } : null;
            const args = {
                label: `${name}: ${source.name}`,
                identifier: `${IDENTIFIER}${request.id}`,
                extraRollNotes: rollNotes(request.rank),
                traits: [...new Set(source.traits ?? [])],
                dc,
                token,
            };
            // Shift-click and the like skip pf2e's roll dialog, as on pf2e's own button
            if (event instanceof Event) args.event = event;
            const roll = await source.statistic.check.roll(args);
            if (!roll) pending.delete(request.id);
            return;
        }
        const bonus = Number.isFinite(modifier) ? modifier : 0;
        const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor, token }),
            flavor: `<strong>Counteract</strong> (counteract rank ${request.rank}, ${signed(bonus)})`,
            flags: { [MODULE_ID]: { counteractRoll: request.id } },
        });
    } catch (error) {
        pending.delete(request.id);
        throw error;
    }
}

/** The request ID a counteract roll from this module carries */
function requestIdOf(message) {
    const identifier = message.flags?.pf2e?.context?.identifier;
    if (typeof identifier === "string" && identifier.startsWith(IDENTIFIER)) return identifier.slice(IDENTIFIER.length);
    return message.flags?.[MODULE_ID]?.counteractRoll ?? null;
}

function findCard(requestId) {
    return game.messages.contents.findLast((m) => m.flags?.[MODULE_ID]?.counteract?.request?.id === requestId) ?? null;
}

/** The roll's total and its d20's result (null when there's no d20, like with Assurance) */
function readRoll(message) {
    const roll = message.rolls?.[0];
    if (!roll || !Number.isFinite(roll.total)) return null;
    const die = roll.dice?.find((d) => d.faces === 20);
    const natural = die && Number.isFinite(die.total) ? die.total : null;
    return { total: roll.total, natural };
}

/* Resolving */

/** Each target's degree of success: pf2e's, with its adjustments, when the check was rolled against that DC */
function getOutcomes(request, message, rolled) {
    const context = message.flags?.pf2e?.context;
    return request.targets.map((target) => {
        const own = request.targets.length === 1 && context?.dc?.value === target.dc ? context.outcome : null;
        return OUTCOMES.includes(own) ? own : degreeOfSuccess({ ...rolled, dc: target.dc });
    });
}

/** Delete counteracted effects, conditions and afflictions: directly where the user can, or through the active GM */
async function removeItems(uuids) {
    const byActor = new Map();
    for (const uuid of uuids) {
        const item = resolveSync(uuid);
        if (!item?.actor || !REMOVABLE_TYPES.includes(item.type)) continue;
        if (!byActor.has(item.actor)) byActor.set(item.actor, []);
        byActor.get(item.actor).push(item);
    }
    const done = new Set();
    const forGM = [];
    for (const [actor, items] of byActor) {
        if (actor.isOwner) {
            const ids = items.map((i) => i.id).filter((id) => actor.items.has(id));
            if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
            items.forEach((i) => done.add(i.uuid));
        } else {
            forGM.push(...items.map((i) => i.uuid));
        }
    }
    if (forGM.length > 0) {
        if (game.users.activeGM) {
            // Players can't edit creatures they don't own, so the active GM removes them
            game.socket.emit(SOCKET, { action: "counteractRemove", uuids: forGM });
            forGM.forEach((uuid) => done.add(uuid));
        } else {
            ui.notifications.warn("Counteract: a GM must be logged in to end effects on creatures you don't own.");
        }
    }
    return done;
}

/** One target's line on the result card */
function resultLine(target, result, rank) {
    const where = target.creature ? ` on ${esc(target.creature)}` : "";
    const byRank = target.dcByRank ? " for its rank" : "";
    const dc = Number.isFinite(target.dc)
        ? `<span ${target.dcSecret ? "data-ehb-counteract-secret" : ""}>, DC ${target.dc}${byRank}</span>`
        : "";
    const head = `<strong>${esc(target.label)}</strong>${where} (rank ${target.rank}${dc})`;
    const outcome = outcomeLabel(result.outcome);
    let text;
    if (result.success && result.removed) {
        text = `counteracted and ended.`;
    } else if (result.success && target.removable) {
        text = `counteracted: end it by hand (a GM must be logged in to end it on a creature you don't own).`;
    } else if (result.success) {
        text = target.kind === "creature" ? `counteracted: dismiss it.` : `counteracted: end it by hand.`;
    } else if (result.outcome === "criticalFailure") {
        text = `not counteracted.`;
    } else {
        const max = maxCounteractedRank(result.outcome, rank);
        text = `not counteracted: this result reaches rank ${max} or lower.`;
    }
    const undo = result.restore ? ` The earlier roll ended it: restore it by hand if this roll stands.` : "";
    return `<li>${head}: ${esc(outcome)}, ${text}${undo}</li>`;
}

function cardContent({ request, results, rolled, sourceName }) {
    const natural = rolled.natural === 20 || rolled.natural === 1 ? ` (natural ${rolled.natural})` : "";
    return [
        `<p><strong>Counteract</strong>${sourceName ? `: ${esc(sourceName)}` : ""}, counteract rank ${request.rank}, `,
        `check ${rolled.total}${natural}.</p>`,
        `<ul>${request.targets.map((t, i) => resultLine(t, results[i], request.rank)).join("")}</ul>`,
    ].join("");
}

/**
 * Work out what the roll counteracts, end it, and post (or, after a reroll, update) the result card. A reroll ends
 * what the new result counteracts; what the earlier one ended stays ended, with a note to restore it by hand.
 */
async function resolve(message, request, { sourceName = null } = {}) {
    const rolled = readRoll(message);
    if (!rolled) return;
    const outcomes = getOutcomes(request, message, rolled);
    const card = findCard(request.id);
    const previous = card?.flags[MODULE_ID].counteract.results ?? [];

    const results = request.targets.map((target, i) => {
        const outcome = outcomes[i];
        const success = counteracts(outcome, request.rank, target.rank);
        const removed = !!previous[i]?.removed;
        return { outcome, success, removed, restore: removed && !success };
    });
    const toRemove = request.targets.flatMap((t, i) =>
        results[i].success && !results[i].removed && t.removable ? t.items : [],
    );
    if (toRemove.length > 0) {
        const done = await removeItems(toRemove);
        request.targets.forEach((t, i) => {
            if (results[i].success && t.removable && t.items.some((uuid) => done.has(uuid))) results[i].removed = true;
        });
    }

    const name = sourceName ?? request.sourceName ?? card?.flags[MODULE_ID].counteract.sourceName ?? null;
    const content = cardContent({ request, results, rolled, sourceName: name });
    const flag = { request, results, sourceName: name, rollMessage: message.id };
    if (card) return card.update({ content, [`flags.${MODULE_ID}.counteract`]: flag });
    const whisper =
        message.whisper?.length > 0
            ? [...new Set([...message.whisper, ...game.users.filter((u) => u.isGM).map((u) => u.id)])]
            : [];
    await ChatMessage.create({
        speaker: message.speaker,
        content,
        whisper,
        flags: { [MODULE_ID]: { counteract: flag } },
    });
}

/* Entry points */

/** The spell card's Counteract button: pick what to counteract on the targets, then roll */
async function counteractWithSpell(message, spell, event) {
    const statistic = safe(() => spell.spellcasting?.counteraction);
    // Without a spellcasting statistic (a creature that isn't a character or NPC), pf2e's plain roll
    if (!statistic || !spell.actor?.isOfType?.("character", "npc")) return spell.rollCounteract?.(event);
    const traits = [...(spell.system.traits?.value ?? []), spell.spellcasting?.tradition].filter((t) => t);
    const source = { name: spell.name, statistic, traits };
    const counteractor = spell.actor;
    const picked = await pickTargets({
        title: `${spell.name}: Counteract`,
        counteractor,
        creatures: getTargetActors(message, counteractor),
        rank: spell.rank,
    });
    if (!picked) return;
    const token = message.token ?? counteractor.getActiveTokens(true, true)[0]?.document ?? null;
    await rollCheck({ request: picked.request, source, actor: counteractor, token, event });
}

/** The macro: the selected creature counteracts with a spell, its spellcasting, a skill or a set modifier */
async function counteractManually({ actor = null } = {}) {
    actor ??= canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
    if (!actor) return ui.notifications.warn("Counteract: select the token of the creature that's counteracting.");
    if (!actor.isOwner) return ui.notifications.warn(`Counteract: you can't roll ${actor.name}'s checks.`);
    const sources = getSourceOptions(actor);
    const picked = await pickTargets({
        title: `${actor.name}: Counteract`,
        counteractor: actor,
        creatures: getTargetActors(null, actor),
        rank: null,
        sources,
    });
    if (!picked) return;
    const { source, modifier, request } = picked;
    if (!Number.isFinite(request.rank)) request.rank = source.rank ?? rankFromLevel(actor.level ?? 0);
    const token = canvas.tokens?.controlled.find((t) => t.actor === actor)?.document ?? null;
    await rollCheck({ request, source, modifier, actor, token });
}

/**
 * A counteract roll made outside this module: an item's inline roll, a counteract @Check, or pf2e's own roll. The
 * counteract rank defaults to the spell's rank, a rank stated in the item's text, or half the item's (or else the
 * creature's) level rounded up.
 */
function isOtherCounteractRoll(message) {
    if (!message.rolls?.length || requestIdOf(message) || message.isDamageRoll) return false;
    const context = message.flags?.pf2e?.context;
    if (["saving-throw", "attack-roll", "initiative", "flat-check", "damage-roll"].includes(context?.type))
        return false;
    if (message.flags?.pf2e?.modifierName === "counteract" || context?.domains?.includes("counteract-check"))
        return true;
    if (!message.rolls[0].dice?.some((d) => d.faces === 20)) return false;
    return /counteract/i.test(message.flavor ?? "") || /counteract/i.test(context?.title ?? "");
}

function defaultRank(message) {
    const item = message.item;
    if (item?.type === "spell") return item.rank;
    const stated = rankFromText(item?.system?.description?.value);
    if (stated) return stated;
    const level = item?.system?.level?.value ?? message.actor?.level;
    return Number.isFinite(Number(level)) ? rankFromLevel(Number(level)) : null;
}

async function resolveOtherRoll(message) {
    const rolled = readRoll(message);
    if (!rolled) return;
    const counteractor = message.actor ?? null;
    const picked = await pickTargets({
        title: "Counteract",
        counteractor,
        creatures: getTargetActors(null, counteractor),
        rank: defaultRank(message),
        rolled,
    });
    if (!picked) return;
    const { request } = picked;
    if (!Number.isFinite(request.rank)) return ui.notifications.warn("Counteract: fill in your counteract rank.");
    await resolve(message, request, { sourceName: message.item?.name ?? null });
}

/* Chat cards */

function makeButton(label, icon, tooltip, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fa-solid ${icon}"></i> ${esc(label)}`;
    button.dataset.tooltip = tooltip;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        onClick(event)
            .catch((error) => {
                log(error);
                ui.notifications.error(`Counteract failed: ${error.message}`);
            })
            .finally(() => (button.disabled = false));
    });
    return button;
}

/**
 * Take over the Counteract button pf2e puts on spells that counteract. This hook runs before pf2e attaches its
 * listeners, so with its `data-action` gone pf2e doesn't; the capture listener covers it if that ever changes.
 */
function takeOverSpellButton(message, html) {
    const button = html?.querySelector?.('button[data-action="spell-counteract"]');
    if (!button) return;
    const item = message.item;
    const spell = item?.type === "spell" ? item : item?.type === "consumable" ? item.embeddedSpell : null;
    if (!spell?.actor) return;
    if (!spell.actor.isOwner) return void (button.closest(".spell-button") ?? button).remove();
    delete button.dataset.action;
    button.dataset.ehbCounteract = "";
    button.dataset.tooltip = "Pick what to counteract on your targets, roll, and end what's counteracted";
    button.addEventListener(
        "click",
        (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (button.disabled) return;
            button.disabled = true;
            counteractWithSpell(message, spell, event)
                .catch((error) => {
                    log(error);
                    ui.notifications.error(`Counteract failed: ${error.message}`);
                })
                .finally(() => (button.disabled = false));
        },
        { capture: true },
    );
}

function addResolveButton(message, html) {
    if (!(message.isAuthor || game.user.isGM) || !isOtherCounteractRoll(message)) return;
    const content = html?.querySelector?.(".message-content");
    if (!content) return;
    const resolved = game.messages.contents.some((m) => m.flags?.[MODULE_ID]?.counteract?.rollMessage === message.id);
    if (resolved) return;
    const tooltip = "Pick what this roll counteracts on your targets, and end what's counteracted";
    content.append(makeButton("Counteract: pick targets", "fa-ban", tooltip, () => resolveOtherRoll(message)));
}

hooks.on("renderChatMessageHTML", (message, html) => {
    try {
        takeOverSpellButton(message, html);
        addResolveButton(message, html);
    } catch (error) {
        log(error);
    }
});

// The caster's spell DC on a result card is hidden from players, unless pf2e shows DCs
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (game.user.isGM || !message.flags?.[MODULE_ID]?.counteract) return;
    html?.querySelectorAll?.("[data-ehb-counteract-secret]").forEach((element) => element.remove());
});

// The counteract check this user rolled (or rerolled): resolve it
hooks.on("createChatMessage", (message, _options, userId) => {
    if (userId !== game.user.id) return;
    const id = requestIdOf(message);
    if (!id) return;
    const request = pending.get(id) ?? findCard(id)?.flags[MODULE_ID].counteract.request ?? null;
    pending.delete(id);
    if (!request) return;
    resolve(message, request).catch((error) => {
        log(error);
        ui.notifications.error(`Counteract failed: ${error.message}`);
    });
});

Hooks.once("init", () => {
    const module = game.modules.get(MODULE_ID);
    // For a macro: counteract with the selected creature, or the creature passed as { actor }
    module.api = { ...module.api, counteract: guardApi("counteract", (options) => counteractManually(options)) };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (data?.action !== "counteractRemove" || game.user !== game.users.activeGM) return;
        const byActor = new Map();
        for (const uuid of data.uuids ?? []) {
            const item = await fromUuid(uuid).catch(() => null);
            if (!item?.actor || !REMOVABLE_TYPES.includes(item.type)) continue;
            if (!byActor.has(item.actor)) byActor.set(item.actor, []);
            byActor.get(item.actor).push(item.id);
        }
        for (const [actor, ids] of byActor) await actor.deleteEmbeddedDocuments("Item", ids).catch(log);
    });
});

export { describeSource, getCandidates, getOutcomes, isOtherCounteractRoll, readForm };
