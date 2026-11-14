/**
 * Recall Knowledge about creatures, and the thaumaturge's Exploit Vulnerability.
 *
 * Recall Knowledge is a secret check: the GM sees the result, the player doesn't. When a player rolls it against a
 * creature (from pf2e's action, or from Basic Action Macros, whose Recall Knowledge macro rolls one d20 for every skill
 * and Lore), they're asked what they want to know. The GM gets a card with the degree of success, worked out from the
 * creature's identification DCs (higher for each later attempt), and what the character learns:
 *
 * - Success: the creature's name and the answer to their question. Critical success: its lore entry (the public notes)
 *   too.
 * - Critical failure: a false name, when another creature of its type and level can be found, and a lie in answer to
 *   the question. Dubious Knowledge (which Esoteric Lore grants) turns a failure into the true answer and a lie.
 *
 * The GM reviews it, can change the check, result or text, and sends it: a whisper to the party (or, with the world
 * setting off, only the character who rolled), worded the same whether it's true or not. What was learned is recorded
 * per creature, shared by every token of that creature, and with PF2E Bestiary Tracking active it's revealed in the
 * Bestiary (lies are added as fake entries).
 *
 * Exploit Vulnerability: its Esoteric Lore check against the creature's level DC tells the thaumaturge its highest
 * weakness, or on a critical success all its weaknesses, resistances and immunities. With Diverse Lore, the same
 * result against the Recall Knowledge DC can give Recall Knowledge's information too.
 */

import {
    DEGREES,
    QUESTIONS,
    capitalize,
    degreeOfSuccess,
    draft,
    exploitResult,
    ordinal,
} from "./lib/recall-knowledge-facts.js";
import { createdHere, hasModuleData, isActiveGM, isEnabled } from "./settings.js";

const MODULE_ID = "evan-character-homebrew";
const SOCKET = `module.${MODULE_ID}`;
const TITLE = "Recall Knowledge";
const EXPLOIT_TITLE = "Exploit Vulnerability";
/** ID of pf2e's Exploit Vulnerability action, the same in every pf2e version */
const EXPLOIT_ID = "fodJ3zuwQsYnBbtk";
/** This module's Effect: Exploit Vulnerability (Critical Failure): off-guard until the start of the thaumaturge's turn */
const OFF_GUARD_ID = "1rKbOmjn488MljOU";
const OFF_GUARD_UUID = `Compendium.${MODULE_ID}.evans-character-homebrew.Item.${OFF_GUARD_ID}`;
const RK_OPTION = "action:recall-knowledge";
const SHARED_SETTING = "recallKnowledgeShared";
const RECORDS_SETTING = "recallKnowledgeRecords";
const FALSE_NAMES_SETTING = "recallKnowledgeFalseNames";
const BESTIARY_SETTING = "recallKnowledgeBestiary";
const BESTIARY_ID = "pf2e-bestiary-tracking";
const ESOTERIC_LORE = "esoteric-lore";
/** pf2e's DC adjustments, by step */
const DC_STEPS = {
    "incredibly-easy": -10,
    "very-easy": -5,
    easy: -2,
    normal: 0,
    hard: 2,
    "very-hard": 5,
    "incredibly-hard": 10,
};
/** The DCs a skill can be checked against: pf2e's identification DCs for the creature */
const DC_KINDS = {
    standard: "standard DC",
    unspecific: "unspecific Lore",
    specific: "specific Lore",
};
/** Damage types a lie can claim a creature is weak to, resists or is immune to */
const LIE_TYPES = [
    "fire",
    "cold",
    "electricity",
    "acid",
    "sonic",
    "vitality",
    "void",
    "spirit",
    "mental",
    "poison",
    "force",
    "holy",
    "unholy",
    "silver",
    "cold-iron",
];

const esc = (text) => Handlebars.escapeExpression(text);
const log = (error) => console.error(`${MODULE_ID} | ${TITLE}`, error);
const localize = (key) => (key ? game.i18n.localize(key) : "");
const degreeLabel = (degree) => localize(`PF2E.Check.Result.Degree.Check.${DEGREES[degree]}`);
const endsWithId = (item, id) => [item?.sourceId, item?.uuid].some((uuid) => String(uuid ?? "").endsWith(`.${id}`));
const hasFeat = (actor, slug) => !!actor?.itemTypes?.feat?.some((f) => f.slug === slug);

/* What's rolled */

function isExploitItem(item) {
    return item?.type === "action" && (item.slug === "exploit-vulnerability" || endsWithId(item, EXPLOIT_ID));
}

/** The d20's result in a roll */
function dieOf(roll) {
    const die = roll?.dice?.find((d) => d.faces === 20);
    return die?.total ?? roll?.total ?? null;
}

/**
 * A Recall Knowledge or Exploit Vulnerability check in a new message: { kind, slug, macro }. `macro` is Basic Action
 * Macros' Recall Knowledge, which rolls a bare d20 for every skill at once, so it has no statistic.
 */
function getCheck(message) {
    const flags = message.flags.pf2e ?? {};
    const context = flags.context;
    if (context?.type !== "skill-check" || hasModuleData(message) || !message.rolls[0]) return null;
    const options = context.options ?? [];

    if (isExploitItem(message.item) || options.includes("item:slug:exploit-vulnerability")) {
        return { kind: "exploit", slug: flags.modifierName ?? ESOTERIC_LORE, macro: false };
    }
    if (!options.includes(RK_OPTION)) return null;
    const fromOption = options.find((o) => o.startsWith(`${RK_OPTION}:`))?.slice(RK_OPTION.length + 1) ?? null;
    const slug = flags.modifierName ?? fromOption;
    return { kind: "recall", slug, macro: !slug };
}

function getRoller(message) {
    const origin = message.flags.pf2e?.context?.origin?.actor;
    return (origin && fromUuidSync(origin)) || message.actor || null;
}

/** The creatures checked against: the message's target, or the roller's targets when it has none */
function getTargets(message) {
    const target = message.flags.pf2e?.context?.target?.token;
    const fromMessage = target ? fromUuidSync(target) : null;
    const tokens = fromMessage ? [fromMessage] : [...game.user.targets].map((t) => t.document);
    return tokens.filter((t) => t?.actor?.isOfType?.("npc"));
}

/* Records of what's been learned: a world setting, by creature, shared by every token and copy of it */

function creatureKey(tokenDoc) {
    const base = tokenDoc.baseActor ?? tokenDoc.actor;
    return base?._stats?.compendiumSource ?? base?.uuid ?? tokenDoc.actor?.uuid;
}

const isShared = () => game.settings.get(MODULE_ID, SHARED_SETTING);

function getRecord(key) {
    const records = game.settings.get(MODULE_ID, RECORDS_SETTING) ?? {};
    return records[key] ?? { name: null, attempts: [], facts: [] };
}

/** The record's entries this character knows about: all of them when knowledge is shared by the party */
function inScope(entries, actorUuid) {
    return isShared() ? entries : entries.filter((e) => e.actor === actorUuid);
}

async function addToRecord(key, name, { attempt = null, facts = [] }) {
    const records = foundry.utils.deepClone(game.settings.get(MODULE_ID, RECORDS_SETTING) ?? {});
    const record = records[key] ?? { name, attempts: [], facts: [] };
    record.name = name;
    if (attempt) record.attempts.push(attempt);
    record.facts.push(...facts);
    records[key] = record;
    await game.settings.set(MODULE_ID, RECORDS_SETTING, records);
}

/* The creature, as the answers need it */

function buildProfile(actor) {
    const attributes = actor.attributes ?? {};
    const iwr = (list) =>
        (list ?? []).map((i) => ({
            type: i.type,
            label: i.applicationLabel ?? i.typeLabel ?? i.type,
            fullLabel: i.label ?? i.applicationLabel ?? i.type,
            value: i.value ?? null,
        }));
    const saves = Object.fromEntries(
        ["fortitude", "reflex", "will"].map((slug) => {
            const save = actor.saves?.[slug];
            return [slug, { label: save?.label ?? capitalize(slug), mod: save?.mod ?? 0 }];
        }),
    );

    const damageLabel = (type) => localize(CONFIG.PF2E.damageTypes?.[type]) || type;
    const strikes = (actor.system.actions ?? [])
        .filter((s) => s.item)
        .map((s) => ({
            id: s.item.id,
            name: s.label ?? s.item.name,
            slug: s.item.slug,
            kind: "strike",
            modifier: s.totalModifier ?? 0,
            damageTypes: [
                ...new Set(Object.values(s.item.system.damageRolls ?? {}).map((d) => damageLabel(d.damageType))),
            ],
        }));
    const actions = actor.itemTypes.action.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        kind: "action",
        category: a.system.category ?? null,
        actionType: a.system.actionType?.value ?? null,
        cost: a.system.actions?.value ?? 0,
        traits: [...(a.system.traits?.value ?? [])],
        description: a.system.description?.value ?? "",
    }));

    const spellcasting = actor.itemTypes.spellcastingEntry
        .filter((e) => !["items", "ritual"].includes(e.system.prepared?.value))
        .map((e) => {
            const tradition = e.system.tradition?.value ?? null;
            const category = e.system.prepared?.value ?? null;
            return {
                id: e.id,
                tradition,
                traditionLabel: localize(CONFIG.PF2E.magicTraditions?.[tradition]) || tradition || "",
                categoryLabel: localize(CONFIG.PF2E.preparationType?.[category]) || category || "",
            };
        })
        .filter((e) => e.tradition);

    const senses = [...(actor.perception?.senses ?? [])].map((s) => ({ type: s.type, label: s.label ?? s.type }));
    const speeds = Object.entries(actor.system.movement?.speeds ?? {})
        .filter(([type, speed]) => speed && type !== "travel")
        .map(([type, speed]) => ({
            type,
            label: localize(`PF2E.Actor.Speed.Type.${capitalize(type)}`) || type,
            value: speed.value ?? speed.total ?? 0,
        }));

    const weaknessLabels = CONFIG.PF2E.weaknessTypes ?? {};
    return {
        name: actor.name,
        level: actor.level,
        traits: [...(actor.system.traits?.value ?? [])],
        publicNotes: actor.system.details?.publicNotes ?? "",
        weaknesses: iwr(attributes.weaknesses),
        resistances: iwr(attributes.resistances),
        immunities: iwr(attributes.immunities),
        saves,
        abilities: [...actions, ...strikes],
        spellcasting,
        senses,
        speeds,
        lieTypes: LIE_TYPES.filter((t) => t in weaknessLabels).map((t) => ({
            type: t,
            label: localize(weaknessLabels[t]) || t,
        })),
        traditions: Object.entries(CONFIG.PF2E.magicTraditions ?? {}).map(([value, label]) => ({
            value,
            label: localize(label),
        })),
    };
}

/** Other creatures' names for false names: pf2e's bestiaries, loaded once */
let nameCandidates = null;

async function getNameCandidates() {
    if (nameCandidates) return nameCandidates;
    const packs = game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "system");
    const fields = ["system.details.level.value", "system.traits.value", "system.traits.rarity"];
    const indexes = await Promise.all(packs.map((p) => p.getIndex({ fields }).catch(() => [])));
    nameCandidates = indexes
        .flatMap((index) => [...index])
        .filter((e) => e.type === "npc")
        .map((e) => ({
            name: e.name,
            level: e.system?.details?.level?.value ?? 0,
            traits: e.system?.traits?.value ?? [],
            rarity: e.system?.traits?.rarity ?? "common",
        }));
    return nameCandidates;
}

/* The checks: which skills apply, against which DCs */

/** pf2e's identification DC for this attempt: each later attempt is harder */
const dcFor = (dcs, attempt) => dcs.progression[Math.min(attempt, dcs.progression.length - 1)] ?? dcs.dc;

/** The creature's DC for its level, without its rarity: Exploit Vulnerability's "standard DC for its level" */
function levelDC(target) {
    const { standard } = target.identificationDCs;
    return standard.dc - (DC_STEPS[standard.start] ?? 0);
}

/** pf2e's degree of success adjustments that apply to a check (Unmistakable Lore, for example) */
function getAdjustments(actor, domains, options, total, die, dc) {
    const rollOptions = new Set([
        ...options,
        `check:total:${total}`,
        `check:total:natural:${die}`,
        `check:roll:total:natural:${die}`,
        `check:total:delta:${total - dc}`,
    ]);
    const record = {};
    for (const domain of domains) {
        for (const adjustment of actor.synthetics?.degreeOfSuccessAdjustments?.[domain] ?? []) {
            if (adjustment.predicate && !adjustment.predicate.test(rollOptions)) continue;
            for (const outcome of ["all", ...DEGREES]) {
                if (adjustment.adjustments?.[outcome]) record[outcome] = { ...adjustment.adjustments[outcome] };
            }
        }
    }
    return record;
}

/**
 * A skill's modifier for Recall Knowledge against the creature, with the conditional bonuses that apply, as Basic
 * Action Macros works it out: a roll that isn't posted. Its domains and roll options are for degree adjustments.
 */
async function silentCheck(actor, statistic, target) {
    let context = null;
    const roll = await statistic.roll({
        createMessage: false,
        skipDialog: true,
        extraRollOptions: [RK_OPTION, `${RK_OPTION}:${statistic.slug}`, ...target.getSelfRollOptions("target")],
        callback: (_roll, _outcome, message) => {
            context = message?.flags?.pf2e?.context ?? null;
        },
    });
    return {
        modifier: roll?.options?.totalModifier ?? statistic.check?.mod ?? statistic.mod ?? 0,
        domains: context?.domains ?? [],
        options: context?.options ?? [],
    };
}

/**
 * Every way the roll could be read: each skill that applies, against each DC that fits it. Basic Action Macros' roll
 * is read for every Recall Knowledge skill and Lore the character has; pf2e's for the skill that was rolled.
 */
async function getRecallChecks({ actor, target, message, check, attempt }) {
    const roll = message.rolls[0];
    const die = dieOf(roll);
    const dcs = target.identificationDCs;
    const kinds = {
        standard: dcFor(dcs.standard, attempt),
        unspecific: dcFor(dcs.lore[0], attempt),
        specific: dcFor(dcs.lore[1], attempt),
    };
    const primary = new Set(dcs.skills);
    // Unified Theory: Arcana for anything Nature, Occultism or Religion identifies
    const unified = hasFeat(actor, "unified-theory") && ["nature", "occultism", "religion"].some((s) => primary.has(s));
    if (unified) primary.add("arcana");

    const kindsFor = (statistic) => {
        if (statistic.slug === ESOTERIC_LORE) return ["standard", "unspecific"];
        if (statistic.lore) return ["unspecific", "specific"];
        return ["standard"];
    };

    const statistics = check.macro
        ? [
              ...[...primary].map((s) => actor.skills?.[s]).filter(Boolean),
              ...Object.values(actor.skills ?? {}).filter((s) => s.lore),
          ]
        : [actor.skills?.[check.slug] ?? actor.getStatistic?.(check.slug)].filter(Boolean);

    const context = message.flags.pf2e?.context ?? {};
    const rows = [];
    for (const statistic of statistics) {
        let total = roll.total;
        let domains = context.domains ?? [];
        let options = context.options ?? [];
        if (check.macro) {
            const silent = await silentCheck(actor, statistic, target);
            total = die + silent.modifier;
            ({ domains, options } = silent);
        }
        const unusual = !statistic.lore && !primary.has(statistic.slug);
        kindsFor(statistic).forEach((kind, index) => {
            const dc = kinds[kind];
            const adjustments = getAdjustments(actor, domains, options, total, die, dc);
            const { degree, adjustment } = degreeOfSuccess({ total, die, dc, adjustments });
            // The first DC that fits is the one the card starts with: specific Lore, or a Lore DC for Esoteric Lore,
            // is the GM's call
            const preferred = index === 0;
            rows.push({
                slug: statistic.slug,
                label: statistic.label,
                total,
                die,
                kind,
                dc,
                degree,
                adjustment,
                unusual,
                preferred,
            });
        });
    }
    return rows;
}

/**
 * The check the card starts with: the best result among each skill's usual DC (unspecific for a Lore, standard for
 * Esoteric Lore). The GM can pick another in the review.
 */
function defaultCheck(rows) {
    let best = -1;
    rows.forEach((row, index) => {
        if (!row.preferred) return;
        const current = rows[best];
        if (!current || row.degree > current.degree || (row.degree === current.degree && row.total > current.total)) {
            best = index;
        }
    });
    return Math.max(best, 0);
}

function describeCheck(row, attempt) {
    const kind = row.kind === "standard" ? "" : `, ${DC_KINDS[row.kind]}`;
    const unusual = row.unusual ? " (not a usual skill for this creature)" : "";
    const adjusted = row.adjustment ? ` (${row.adjustment})` : "";
    return (
        `${row.label}${unusual} ${row.total} vs DC ${row.dc} (${ordinal(attempt + 1)} attempt${kind}): ` +
        `${degreeLabel(row.degree)}${adjusted}`
    );
}

/* The roller's side: what do they want to know? */

/** Ask the roller's player what they want to know about the creature: { question, other }, or null */
async function askQuestion(actor, tokenDoc, { exploit = false } = {}) {
    const name = esc(tokenDoc.name);
    const choices = QUESTIONS.map(
        (q, i) =>
            `<label style="display: block"><input type="radio" name="question" value="${q.id}" ${
                i === 0 ? "checked" : ""
            }> ${esc(q.label)}</label>`,
    ).join("");
    const intro = exploit
        ? `<p>Diverse Lore: if ${esc(actor.name)}'s check is good enough to Recall Knowledge about ${name}, what do they want to know?</p>`
        : `<p>What does ${esc(actor.name)} want to know about ${name}?</p>`;
    const content = [
        intro,
        choices,
        `<input type="text" name="other" placeholder="Your question, for Something else" style="margin-top: 0.5em">`,
    ].join("");

    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `${TITLE}: ${tokenDoc.name}` },
        content,
        buttons: [
            {
                action: "ask",
                label: "Ask",
                default: true,
                callback: (_event, button) => {
                    const form = button.form.elements;
                    const other = form.other.value.trim();
                    const question = other ? "other" : form.question.value;
                    return { question, other };
                },
            },
            { action: "skip", label: "Don't Ask" },
        ],
        rejectClose: false,
    });
    return result && typeof result === "object" ? result : null;
}

/** Send to the active GM, or handle it here when this user is the active GM */
function toGM(data) {
    if (isActiveGM()) return Promise.resolve(onGMEvent(data)).catch(log);
    if (!game.users.activeGM) {
        ui.notifications.warn(`${TITLE}: a GM must be logged in to answer.`);
        return null;
    }
    game.socket.emit(SOCKET, data);
}

/** A check this user rolled: tell the GM, then ask what the player wants to know */
async function onRolled(message, check) {
    const actor = getRoller(message);
    if (!actor?.isOfType?.("creature")) return;
    const targets = getTargets(message);
    if (targets.length === 0) return;
    if (!game.users.activeGM) return ui.notifications.warn(`${TITLE}: a GM must be logged in to answer.`);

    for (const tokenDoc of targets) {
        const data = { messageId: message.id, tokenUuid: tokenDoc.uuid, kind: check.kind };
        toGM({ action: "recallKnowledgeStart", ...data });
    }

    for (const tokenDoc of targets) {
        if (check.kind === "exploit") {
            // Diverse Lore: a check good enough for Exploit Vulnerability may be enough to Recall Knowledge too
            const roll = message.rolls[0];
            if (!hasFeat(actor, "diverse-lore") || roll.total < levelDC(tokenDoc.actor)) continue;
        }
        const asked = await askQuestion(actor, tokenDoc, { exploit: check.kind === "exploit" });
        if (!asked) continue;
        const data = { messageId: message.id, tokenUuid: tokenDoc.uuid, ...asked };
        toGM({ action: "recallKnowledgeQuestion", ...data });
    }
}

/* The GM's side: the card */

/** Cards being made, by roll message and creature, so a question that arrives first waits for its card */
const cards = new Map();

function cardKey(messageId, tokenUuid) {
    return `${messageId}|${tokenUuid}`;
}

function findCard(messageId, tokenUuid) {
    return game.messages.contents.findLast((m) => {
        const record = m.flags[MODULE_ID]?.recallKnowledge;
        return record?.message === messageId && record.token === tokenUuid;
    });
}

async function createCard({ messageId, tokenUuid, kind }) {
    const message = game.messages.get(messageId);
    const tokenDoc = await fromUuid(tokenUuid);
    const target = tokenDoc?.actor;
    const actor = message ? getRoller(message) : null;
    if (!message || !target?.isOfType("npc") || !actor) return null;
    const existing = findCard(messageId, tokenUuid);
    if (existing) return existing;

    const check = getCheck(message);
    const key = creatureKey(tokenDoc);
    const record = getRecord(key);
    const attempt = inScope(record.attempts, actor.uuid).filter((a) => a.kind === "recall").length;
    const roll = message.rolls[0];
    const die = dieOf(roll);

    const data = {
        kind,
        message: messageId,
        token: tokenUuid,
        actor: actor.uuid,
        actorName: actor.name,
        key,
        attempt,
        die,
        question: null,
        other: "",
        status: "pending",
        sent: null,
    };

    if (kind === "exploit") {
        const context = message.flags.pf2e?.context ?? {};
        const dc = levelDC(target);
        const adjustments = getAdjustments(actor, context.domains ?? [], context.options ?? [], roll.total, die, dc);
        const { degree, adjustment } = degreeOfSuccess({ total: roll.total, die, dc, adjustments });
        data.exploit = { total: roll.total, dc, degree, adjustment };
        // Diverse Lore: the same result against the Recall Knowledge DC
        if (hasFeat(actor, "diverse-lore")) {
            const recallDC = dcFor(target.identificationDCs.standard, attempt);
            const result = degreeOfSuccess({ total: roll.total, die, dc: recallDC });
            data.checks = [
                {
                    slug: check?.slug ?? ESOTERIC_LORE,
                    label: actor.skills?.[ESOTERIC_LORE]?.label ?? "Esoteric Lore",
                    total: roll.total,
                    die,
                    kind: "standard",
                    dc: recallDC,
                    degree: result.degree,
                    adjustment: null,
                    unusual: false,
                    preferred: true,
                },
            ];
            data.chosen = 0;
        }
    } else {
        data.checks = await getRecallChecks({ actor, target, message, check, attempt });
        if (data.checks.length === 0) return null;
        data.chosen = defaultCheck(data.checks);
    }

    const title = kind === "exploit" ? EXPLOIT_TITLE : TITLE;
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper: ChatMessage.getWhisperRecipients("GM"),
        content: [
            `<p><strong>${title}</strong> ${esc(actor.name)} about ${esc(tokenDoc.name)}</p>`,
            `<div data-ehb-recall-knowledge></div>`,
        ].join(""),
        flags: { [MODULE_ID]: { recallKnowledge: data } },
    });
}

async function onStart(data) {
    const key = cardKey(data.messageId, data.tokenUuid);
    if (cards.has(key)) return cards.get(key);
    const promise = createCard(data).catch((error) => {
        log(error);
        return null;
    });
    cards.set(key, promise);
    return promise;
}

async function onQuestion({ messageId, tokenUuid, question, other }) {
    const card = (await cards.get(cardKey(messageId, tokenUuid))) ?? findCard(messageId, tokenUuid);
    if (!card || !QUESTIONS.some((q) => q.id === question)) return;
    await card.update({
        [`flags.${MODULE_ID}.recallKnowledge.question`]: question,
        [`flags.${MODULE_ID}.recallKnowledge.other`]: String(other ?? "").slice(0, 500),
    });
}

function onGMEvent(data) {
    if (data?.action === "recallKnowledgeStart") return onStart(data);
    if (data?.action === "recallKnowledgeQuestion") return onQuestion(data);
}

/* The GM's review */

function questionLabel(question, other) {
    if (question === "other") return other ? `"${other}"` : "Something else";
    return QUESTIONS.find((q) => q.id === question)?.label ?? "";
}

function options(list, selected) {
    return list
        .map(({ value, label }) => {
            const isSelected = String(value) === String(selected) ? "selected" : "";
            return `<option value="${esc(value)}" ${isSelected}>${esc(label)}</option>`;
        })
        .join("");
}

/** The review dialog's form, filled in by `wire` (in `review`) from the draft for the chosen result and question */
function reviewContent(record, { target, recall }) {
    const parts = [];
    if (record.kind === "exploit") {
        const { total, dc, degree } = record.exploit;
        parts.push(
            `<p>Esoteric Lore ${total} vs DC ${dc} (standard DC for level ${target.level})</p>`,
            `<div class="form-group"><label>${EXPLOIT_TITLE}</label><select name="exploitDegree">${options(
                DEGREES.map((_d, i) => ({ value: i, label: degreeLabel(i) })),
                degree,
            )}</select></div>`,
            `<div class="form-group stacked"><textarea name="exploitText" rows="3"></textarea></div>`,
            `<div class="form-group" data-ehb-off-guard><label><input type="checkbox" name="offGuard"> `,
            `Apply off-guard until the start of ${esc(record.actorName ?? "their")}'s next turn</label></div>`,
        );
    }
    if (recall) {
        const checks = record.checks.map((row, i) => ({ value: i, label: describeCheck(row, record.attempt) }));
        const degrees = DEGREES.map((_d, i) => ({ value: i, label: degreeLabel(i) }));
        const exploitDegrees = [{ value: -1, label: "Nothing" }, ...degrees.slice(2)];
        const questions = QUESTIONS.map((q) => ({ value: q.id, label: q.label }));
        if (record.kind === "exploit") parts.push(`<hr><p><strong>Diverse Lore</strong>: Recall Knowledge</p>`);
        parts.push(
            `<div class="form-group"><label>Check</label><select name="check">${options(checks, record.chosen)}</select></div>`,
            `<div class="form-group"><label>Result</label><select name="degree">${options(
                record.kind === "exploit" ? exploitDegrees : degrees,
                "",
            )}</select></div>`,
            `<div class="form-group"><label>Question</label><select name="question">${options(
                questions,
                record.question ?? "weaknesses",
            )}</select></div>`,
            `<div class="form-group"><label>Their question</label><input type="text" name="other" value="${esc(
                record.other ?? "",
            )}"></div>`,
            `<div class="form-group"><label><input type="checkbox" name="includeName"> Name</label>`,
            `<input type="text" name="name"></div>`,
            `<div class="form-group"><label><input type="checkbox" name="includeLore"> Lore entry (public notes)</label></div>`,
            `<div class="form-group stacked"><label><input type="checkbox" name="include0"> Answer</label>`,
            `<textarea name="answer0" rows="3"></textarea></div>`,
            `<div class="form-group stacked" data-ehb-second><label><input type="checkbox" name="include1"> `,
            `Second answer (Dubious Knowledge)</label><textarea name="answer1" rows="3"></textarea></div>`,
            `<p class="hint" data-ehb-truth></p>`,
        );
    }
    return parts.join("");
}

/**
 * Review a card's result and send it. The draft for each result and question is made once, so switching back and
 * forth keeps the same lies.
 */
async function review(card) {
    const record = card.flags[MODULE_ID]?.recallKnowledge;
    const tokenDoc = record?.token ? await fromUuid(record.token) : null;
    const target = tokenDoc?.actor;
    const actor = record?.actor ? await fromUuid(record.actor) : null;
    if (!target || !actor) return ui.notifications.warn(`${TITLE}: the creature or character is gone.`);

    const profile = buildProfile(target);
    // False names for critical failures come from pf2e's bestiaries, unless they're turned off
    const names = game.settings.get(MODULE_ID, FALSE_NAMES_SETTING) ? await getNameCandidates().catch(() => []) : [];
    const dubious = hasFeat(actor, "dubious-knowledge");
    const recall = record.kind === "recall" || !!record.checks;
    const drafts = new Map();
    const getDraft = (degree, question) => {
        const key = `${degree}|${question}`;
        if (!drafts.has(key)) drafts.set(key, draft({ profile, degree, question, dubious, names }));
        return drafts.get(key);
    };
    let current = null;

    const wire = (root) => {
        const form = root?.querySelector?.("form") ?? root;
        const field = (name) => form?.querySelector?.(`[name="${name}"]`);
        if (!field("check") && !field("exploitDegree")) return;

        const fillExploit = () => {
            const degree = Number(field("exploitDegree").value);
            field("exploitText").value = exploitResult(profile, degree).text;
            // A critical failure: off-guard until the start of their next turn
            field("offGuard").checked = degree === 0;
            form.querySelector("[data-ehb-off-guard]").style.display = degree === 0 ? "" : "none";
        };
        const fillRecall = () => {
            const degree = Number(field("degree").value);
            const question = field("question").value;
            const second = form.querySelector("[data-ehb-second]");
            const truth = form.querySelector("[data-ehb-truth]");
            if (degree < 0) {
                current = null;
                for (const name of ["includeName", "includeLore", "include0", "include1"]) field(name).checked = false;
                field("name").value = "";
                field("answer0").value = "";
                second.style.display = "none";
                truth.textContent = "";
                return;
            }
            current = getDraft(degree, question);
            field("includeName").checked = !!current.name;
            field("name").value = current.name?.text ?? "";
            field("includeLore").checked = current.lore;
            field("includeLore").disabled = !profile.publicNotes;
            const [first, other] = current.answers;
            field("include0").checked = !!first;
            field("answer0").value = first?.text ?? "";
            field("include1").checked = !!other;
            field("answer1").value = other?.text ?? "";
            second.style.display = other ? "" : "none";

            const notes = [];
            if (current.name?.false) notes.push("the name is false");
            current.answers.forEach(
                (a, i) =>
                    a.false && notes.push(`${current.answers.length > 1 ? `answer ${i + 1}` : "the answer"} is a lie`),
            );
            if (question === "other" && current.answers.length > 0) notes.push("write the answer to their question");
            if (current.answers.some((a) => a.false && !a.text)) notes.push("no lie fits: write one");
            truth.textContent = notes.length > 0 ? `Note: ${notes.join("; ")}. The player can't tell.` : "";
        };

        if (field("exploitDegree")) {
            field("exploitDegree").addEventListener("change", fillExploit);
            fillExploit();
        }
        if (field("check")) {
            const setDegree = () => {
                const row = record.checks[Number(field("check").value)];
                let degree = row?.degree ?? 1;
                // Diverse Lore gives information only for a success or better
                if (record.kind === "exploit") degree = degree >= 2 && record.exploit.degree >= 2 ? degree : -1;
                field("degree").value = String(degree);
                fillRecall();
            };
            field("check").addEventListener("change", setDegree);
            field("degree").addEventListener("change", fillRecall);
            field("question").addEventListener("change", fillRecall);
            setDegree();
        }
    };

    const content = reviewContent(record, { target, recall });
    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `${record.kind === "exploit" ? EXPLOIT_TITLE : TITLE}: ${tokenDoc.name}` },
        position: { width: 560 },
        content,
        render: (event, dialog) => wire(dialog?.element ?? dialog ?? event?.target?.element),
        buttons: [
            {
                action: "send",
                label: "Send",
                default: true,
                callback: (_event, button) =>
                    readForm(button.form, { record, recall, profile, current: () => current }),
            },
            { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
    });
    if (!result || typeof result !== "object") return;
    await send(card, result, { tokenDoc, target, actor, profile });
}

function readForm(form, { record, recall, profile, current }) {
    const value = (name) => form.elements[name]?.value ?? "";
    const checked = (name) => !!form.elements[name]?.checked;
    const result = { exploit: null, recall: null };
    if (record.kind === "exploit") {
        const degree = Number(value("exploitDegree"));
        result.exploit = { degree, text: value("exploitText").trim(), offGuard: degree === 0 && checked("offGuard") };
    }
    const drafted = current();
    if (recall && drafted) {
        const degree = Number(value("degree"));
        const answers = drafted.answers
            .map((a, i) => ({ ...a, text: value(`answer${i}`).trim(), include: checked(`include${i}`) }))
            .filter((a) => a.include && a.text);
        // The name told is false unless it's the creature's, whatever the GM typed
        const name = checked("includeName") ? value("name").trim() : "";
        const isTrue = name.toLowerCase() === String(profile.name).toLowerCase();
        result.recall = {
            degree,
            check: Number(value("check")),
            question: value("question"),
            other: value("other").trim(),
            name: name ? { text: name, false: !isTrue } : null,
            lore: checked("includeLore"),
            answers,
        };
    }
    return result;
}

/* Sending it */

/** Who hears it: the character's players, and with shared knowledge, every player in the party */
function getRecipients(actor) {
    const actors = [actor];
    if (isShared()) actors.push(...(game.actors.party?.members ?? []));
    const users = game.users.filter((u) => !u.isGM && actors.some((a) => a.testUserPermission(u, "OWNER")));
    return users.length > 0 ? users : ChatMessage.getWhisperRecipients("GM");
}

async function send(card, result, { tokenDoc, target, actor, profile }) {
    const record = card.flags[MODULE_ID].recallKnowledge;
    if (record.status === "sent") {
        const again = await foundry.applications.api.DialogV2.confirm({
            window: { title: TITLE },
            content: "<p>This was already sent. Send it again?</p>",
            rejectClose: false,
        });
        if (!again) return;
    }

    const now = Date.now();
    const facts = [];
    const lines = [];
    const creature = esc(tokenDoc.name);

    if (result.exploit) {
        lines.push(`<p><strong>${EXPLOIT_TITLE}</strong> ${esc(result.exploit.text)}</p>`);
        facts.push({ actor: actor.uuid, kind: "exploit", text: result.exploit.text, false: false, at: now });
    }

    const recall = result.recall;
    let attempt = null;
    if (recall && recall.degree >= 0) {
        const row = record.checks?.[recall.check];
        attempt = {
            actor: actor.uuid,
            kind: "recall",
            degree: DEGREES[recall.degree],
            skill: row?.slug ?? null,
            at: now,
        };
        const told = [];
        if (recall.name) {
            told.push(`<p>Name: <strong>${esc(recall.name.text)}</strong></p>`);
            facts.push({
                actor: actor.uuid,
                kind: "name",
                text: recall.name.text,
                false: !!recall.name.false,
                at: now,
            });
        }
        if (recall.answers.length > 0) {
            const asked = esc(questionLabel(recall.question, recall.other));
            const answers = recall.answers.map((a) => esc(a.text)).join("<br>");
            told.push(`<p><em>${asked}</em><br>${answers}</p>`);
            // Each under its own subject: a lie from Dubious Knowledge is about something else
            for (const a of recall.answers) {
                const question = a.question === "other" ? recall.other || "other" : a.question;
                facts.push({ actor: actor.uuid, kind: "answer", question, text: a.text, false: !!a.false, at: now });
            }
        }
        if (recall.lore && profile.publicNotes) {
            const lore = await foundry.applications.ux.TextEditor.implementation.enrichHTML(profile.publicNotes, {
                relativeTo: target,
            });
            told.push(`<div>${lore}</div>`);
            facts.push({ actor: actor.uuid, kind: "lore", text: "Lore entry", false: false, at: now });
        }
        const heading = `<p><strong>${TITLE}</strong> ${esc(actor.name)} recalls about ${creature}:</p>`;
        lines.push(
            told.length > 0
                ? `${heading}${told.join("")}`
                : `<p><strong>${TITLE}</strong> ${esc(actor.name)} doesn't recall anything useful about ${creature}.</p>`,
        );
    }
    if (lines.length === 0) return ui.notifications.info(`${TITLE}: there's nothing to send.`);

    if (result.exploit?.offGuard) await applyOffGuard(actor).catch(log);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper: getRecipients(actor),
        content: lines.join(""),
        flags: { [MODULE_ID]: { recallKnowledgeResult: { card: card.id } } },
    });
    await addToRecord(record.key, target.name, { attempt, facts });
    if (isShared()) {
        await updateBestiary({ tokenDoc, actor, profile, result, attempt }).catch((error) => {
            log(error);
            ui.notifications.warn(`${TITLE}: the Bestiary couldn't be updated. See the console for details.`);
        });
    }

    const summary = [
        result.exploit ? `${EXPLOIT_TITLE}: ${degreeLabel(result.exploit.degree)}` : null,
        recall && recall.degree >= 0 ? `${TITLE}: ${degreeLabel(recall.degree)}` : null,
    ]
        .filter(Boolean)
        .join("; ");
    await card.update({
        [`flags.${MODULE_ID}.recallKnowledge.status`]: "sent",
        [`flags.${MODULE_ID}.recallKnowledge.sent`]: summary || "Nothing learned",
    });
}

/**
 * Exploit Vulnerability's critical failure: "You become off-guard until the start of your next turn." The effect
 * grants pf2e's Off-Guard and, with the thaumaturge as its origin, ends at the start of their next turn. A new one
 * replaces one they already have.
 */
async function applyOffGuard(actor) {
    const effect = await fromUuid(OFF_GUARD_UUID);
    if (!effect) return ui.notifications.error(`${EXPLOIT_TITLE}: the module's off-guard effect was not found.`);
    const source = effect.toObject();
    source._stats = { ...source._stats, compendiumSource: OFF_GUARD_UUID };
    const token = actor.getActiveTokens?.(true, true)?.[0] ?? null;
    source.system.context = {
        origin: { actor: actor.uuid, token: token?.uuid ?? null, item: null, spellcasting: null, rollOptions: [] },
        target: null,
        roll: null,
    };
    const existing = actor.itemTypes.effect.filter((e) => e.slug === source.system.slug).map((e) => e.id);
    if (existing.length > 0) await actor.deleteEmbeddedDocuments("Item", existing);
    await actor.createEmbeddedDocuments("Item", [source]);
}

/* PF2E Bestiary Tracking, when it's active */

function getBestiary() {
    if (!game.modules.get(BESTIARY_ID)?.active) return null;
    try {
        return game.journal.get(game.settings.get(BESTIARY_ID, "bestiary-tracking")) ?? null;
    } catch {
        return null;
    }
}

function findPage(bestiary, baseActor) {
    return bestiary.pages.find((p) => p.system?.actorBelongs?.(baseActor)) ?? null;
}

/**
 * Add the creature to the Bestiary. The module has no way to do that from code: its Add Monster macro adds the GM's
 * target, so it's run with the creature standing in as the GM's only target, for as long as it takes to read it.
 */
async function addToBestiary(bestiary, tokenDoc) {
    const add = game.modules.get(BESTIARY_ID)?.macros?.addMonster;
    if (typeof add !== "function") return null;
    const standIn = { document: tokenDoc, actor: tokenDoc.actor, baseActor: tokenDoc.baseActor };
    const user = game.user;
    const own = Object.getOwnPropertyDescriptor(user, "targets");
    let running;
    try {
        Object.defineProperty(user, "targets", { value: new Set([standIn]), configurable: true, writable: true });
        // The macro reads the target before its first await
        running = add();
    } finally {
        if (own) Object.defineProperty(user, "targets", own);
        else delete user.targets;
    }
    await running;
    return findPage(bestiary, tokenDoc.baseActor ?? tokenDoc.actor);
}

/** The Bestiary's update for an IWR category: reveal the types told, or add the lies as fake entries */
function iwrUpdate(page, category, { reveal = [], fake = [], values = false }) {
    const update = {};
    const entries = page.system[category] ?? {};
    for (const [key, entry] of Object.entries(entries)) {
        const told = reveal.includes("*") ? entry.empty : reveal.includes(entry.type);
        if (!told || entry.fake) continue;
        update[`system.${category}.${key}.revealed`] = true;
        if (values && "value" in entry) update[`system.${category}.${key}.valueRevealed`] = true;
    }
    for (const type of fake) {
        if (Object.values(entries).some((e) => e.type === type)) continue;
        const key = foundry.utils.randomID();
        update[`system.${category}.${key}`] = { type, revealed: true, fake: true, exceptions: {} };
    }
    return update;
}

function revealUpdate(page, reveal = {}, fake = {}, { values = false } = {}) {
    const update = {};
    for (const category of ["weaknesses", "resistances", "immunities"]) {
        Object.assign(
            update,
            iwrUpdate(page, category, { reveal: reveal[category] ?? [], fake: fake[category] ?? [], values }),
        );
    }
    for (const save of reveal.saves ?? []) {
        if (page.system.saves?.[save]) update[`system.saves.${save}.revealed`] = true;
    }
    for (const id of reveal.abilities ?? []) {
        for (const category of ["attacks", "actions", "passives"]) {
            if (page.system[category]?.[id]) update[`system.${category}.${id}.revealed`] = true;
        }
    }
    for (const id of reveal.spells ?? []) {
        if (id === "*" && page.system.spells?.fake) update["system.spells.fake.revealed"] = true;
        if (page.system.spells?.entries?.[id]) update[`system.spells.entries.${id}.revealed`] = true;
    }
    for (const type of reveal.senses ?? []) {
        if (page.system.senses?.senses?.[type]) update[`system.senses.senses.${type}.revealed`] = true;
    }
    for (const type of reveal.speeds ?? []) {
        if (page.system.speeds?.values?.[type]) update[`system.speeds.values.${type}.revealed`] = true;
    }
    return update;
}

async function updateBestiary({ tokenDoc, actor, profile, result, attempt }) {
    if (!game.settings.get(MODULE_ID, BESTIARY_SETTING)) return;
    const bestiary = getBestiary();
    if (!bestiary) return;
    const baseActor = tokenDoc.baseActor ?? tokenDoc.actor;
    const page = findPage(bestiary, baseActor) ?? (await addToBestiary(bestiary, tokenDoc));
    if (!page) return;

    const update = {};
    if (result.exploit) {
        const told = exploitResult(profile, result.exploit.degree);
        Object.assign(update, revealUpdate(page, told.reveal, {}, { values: told.values }));
    }
    const recall = result.recall;
    if (recall && recall.degree >= 0) {
        if (recall.name?.false) {
            update["system.name.revealed"] = true;
            update["system.name.custom"] = recall.name.text;
        } else if (recall.name) {
            update["system.name.revealed"] = true;
            update["system.name.custom"] = null;
        }
        if (recall.lore && page.system.notes?.public) update["system.notes.public.revealed"] = true;
        for (const told of recall.answers) Object.assign(update, revealUpdate(page, told.reveal, told.fake));
    }
    // The attempt in the Bestiary's Recall Knowledge tracker, for characters
    if (attempt && actor.isOfType("character")) {
        const attempts = page.system.recallKnowledge?.[actor.id]?.attempts ?? {};
        const used = Object.keys(attempts).filter((k) => attempts[k] !== "none");
        const next = used.length > 0 ? Math.max(...used.map(Number)) + 1 : 0;
        update[`system.recallKnowledge.${actor.id}.attempts.${next}`] = attempt.degree;
    }
    if (Object.keys(update).length === 0) return;
    await page.update(update);
    game.socket.emit(`module.${BESTIARY_ID}`, { action: "UpdateBestiary", data: {} });
    Hooks.callAll("UpdateBestiary", {});
}

/* The card's controls */

function renderCard(message, html) {
    const record = message.flags[MODULE_ID]?.recallKnowledge;
    const content = html?.querySelector?.(".message-content") ?? html;
    if (!record || !content?.querySelector || !isEnabled(featureOf(record.kind))) return;
    let controls = content.querySelector("[data-ehb-recall-knowledge]");
    if (!controls) {
        controls = document.createElement("div");
        controls.dataset.ehbRecallKnowledge = "";
        content.append(controls);
    }
    if (!game.user.isGM) return controls.replaceChildren();

    const items = [];
    const line = (text) => {
        const p = document.createElement("p");
        p.textContent = text;
        items.push(p);
    };
    if (record.kind === "exploit") {
        const { total, dc, degree } = record.exploit;
        line(`Esoteric Lore ${total} vs DC ${dc}: ${degreeLabel(degree)}`);
        const row = record.checks?.[record.chosen];
        if (row) line(`Diverse Lore: ${describeCheck(row, record.attempt)}`);
    } else {
        line(`d20: ${record.die}. ${describeCheck(record.checks[record.chosen], record.attempt)}`);
        if (record.checks.length > 1) line(`${record.checks.length - 1} other way(s) to read it in the review.`);
    }
    if (record.checks) {
        line(record.question ? `Question: ${questionLabel(record.question, record.other)}` : "No question asked yet.");
    }

    const known = inScope(getRecord(record.key).facts, record.actor);
    if (known.length > 0) {
        const told = known.map((f) => `${f.false ? "(false) " : ""}${f.text}`).join(" | ");
        line(`Known already: ${told}`);
    }

    if (record.status === "sent") line(`Sent: ${record.sent}`);
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fa-solid fa-book-open"></i> ${record.status === "sent" ? "Send Again" : "Review and Send"}`;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        review(message)
            .catch(log)
            .finally(() => (button.disabled = false));
    });
    items.push(button);
    controls.replaceChildren(...items);
}

/* What the party knows: a macro entry point */

async function showKnown(tokenDoc = game.user.targets.first()?.document) {
    if (!tokenDoc?.actor) return ui.notifications.warn(`${TITLE}: target a creature first.`);
    const record = getRecord(creatureKey(tokenDoc));
    const character = game.user.character;
    let facts = record.facts;
    if (!isShared() && !game.user.isGM) facts = facts.filter((f) => f.actor === character?.uuid);
    const describe = (f) => {
        const marker = game.user.isGM && f.false ? " <em>(false)</em>" : "";
        const subject = {
            name: "Name: ",
            lore: "",
            exploit: `${EXPLOIT_TITLE}: `,
            answer: `${esc(QUESTIONS.find((q) => q.id === f.question)?.label ?? `"${f.question}"`)} `,
        }[f.kind];
        return `<li>${subject ?? ""}${esc(f.text)}${marker}</li>`;
    };
    const content =
        facts.length > 0
            ? `<ul>${facts.map(describe).join("")}</ul>`
            : `<p>Nothing is known about ${esc(tokenDoc.name)} yet.</p>`;
    await foundry.applications.api.DialogV2.prompt({
        window: { title: `${TITLE}: ${tokenDoc.name}` },
        content,
        rejectClose: false,
    });
}

/* Hooks */

/** The settings menu's feature for a check: Recall Knowledge and Exploit Vulnerability are turned off separately */
const featureOf = (kind) => (kind === "exploit" ? "exploitVulnerability" : "recallKnowledge");

Hooks.on("createChatMessage", (message, options, userId) => {
    if (!createdHere(message, options, userId)) return;
    const check = getCheck(message);
    if (check && isEnabled(featureOf(check.kind))) onRolled(message, check).catch(log);
});

Hooks.on("renderChatMessageHTML", (message, html) => renderCard(message, html));

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SHARED_SETTING, {
        name: "Share with the party",
        hint:
            "What one character learns about a creature, the whole party learns: it's whispered to every player in " +
            "the party, counts toward later attempts' DCs, and is revealed in PF2E Bestiary Tracking. When off, only " +
            "the character who rolled learns it, and the Bestiary isn't updated.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, FALSE_NAMES_SETTING, {
        name: "False names on critical failures",
        hint:
            "A critical failure names another creature of the same type and about the same level, from pf2e's " +
            "bestiaries. When off, a critical failure gives only the lie in answer to the question.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, BESTIARY_SETTING, {
        name: "Update PF2E Bestiary Tracking",
        hint:
            "When that module is active, add the creature to the Bestiary and reveal what's learned (lies as fake " +
            "entries). When off, the Bestiary is left for the GM to update.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, RECORDS_SETTING, {
        scope: "world",
        config: false,
        type: Object,
        default: {},
    });

    const module = game.modules.get(MODULE_ID);
    module.api = {
        ...module.api,
        recallKnowledge: {
            /** Show what's known about the targeted creature */
            known: (tokenDoc) =>
                isEnabled("recallKnowledge")
                    ? showKnown(tokenDoc)
                    : ui.notifications.warn(`${TITLE} is turned off in the module's settings.`),
            /** Forget everything learned about the targeted creature (GM only) */
            forget: async (tokenDoc = game.user.targets.first()?.document) => {
                if (!game.user.isGM || !tokenDoc) return;
                const records = foundry.utils.deepClone(game.settings.get(MODULE_ID, RECORDS_SETTING) ?? {});
                delete records[creatureKey(tokenDoc)];
                await game.settings.set(MODULE_ID, RECORDS_SETTING, records);
            },
        },
    };
});

Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
        if (!String(data?.action ?? "").startsWith("recallKnowledge") || !isActiveGM()) return;
        await Promise.resolve(onGMEvent(data)).catch(log);
    });
});

export { getCheck };
