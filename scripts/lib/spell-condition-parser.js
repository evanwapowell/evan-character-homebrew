/**
 * Reads a spell's description and proposes what a creature suffers for a degree of success on its save: spell
 * effects the text links to, and conditions with their values, durations, and links to other conditions ("Slowed 1
 * as long as it's sickened"). Pure text reading with no Foundry dependencies, so it can be run against pf2e's spell
 * data outside the game.
 */

export const OUTCOMES = ["criticalSuccess", "success", "failure", "criticalFailure"];

/** Conditions that are never proposed: relational senses, attitudes, and ones pf2e handles elsewhere */
const IGNORED = new Set([
    "broken",
    "friendly",
    "helpful",
    "hidden",
    "hostile",
    "indifferent",
    "observed",
    "persistent-damage",
    "undetected",
    "unfriendly",
    "unnoticed",
]);

/** Conditions that end by their own rules (decreasing values, standing up, escaping), so they don't take a timer */
const SELF_ENDING = new Set(["doomed", "drained", "dying", "frightened", "grabbed", "prone", "restrained", "sickened"]);

const UNITS = { round: "rounds", minute: "minutes", hour: "hours", day: "days" };
const ROUNDS_PER_UNIT = { rounds: 1, minutes: 10, hours: 600, days: 14400 };
const NUMBER_WORDS = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
};
const COUNT = String.raw`(\d+d\d+|\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)`;
const SUBJECT = String.raw`(?:it|they|the (?:target|creature))`;
const IS = String.raw`(?:'s|'re| is| are| remains?)`;
const WHOSE = String.raw`(its|their|the target's|the creature's|your)`;

/** Words just before a condition that mean it isn't being applied */
const NEGATORS = [
    "already ",
    "can't be ",
    "cannot be ",
    "ends the ",
    "immune to ",
    "instead of ",
    "isn't ",
    "loses the ",
    "no longer ",
    "not ",
    "remove the ",
    "removes ",
    "reduce its ",
    "unaffected",
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Plain lowercase text: inline links become their labels, tags and entities are removed */
function toPlainText(html, conditionsById) {
    return html
        .replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g, (_match, uuid, label) => {
            if (label) return label;
            const last = uuid.split(".").at(-1);
            return conditionsById.get(last) ?? last;
        })
        .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (_match, label) => label ?? "")
        .replace(/\[\[[^\]]*\]\](?:\{([^}]*)\})?/g, (_match, label) => label ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/[‘’]/g, "'")
        .replace(/–|—/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/**
 * The HTML of each degree-of-success entry: what follows "<strong>Failure</strong>" up to the next entry, which
 * includes a spell effect linked in the paragraph after it. Whatever follows the last entry's paragraph (such as one
 * effect link for every degree) is returned as `general`.
 */
function getOutcomeHtml(html, labels) {
    const found = [];
    for (const outcome of OUTCOMES) {
        for (const label of labels[outcome] ?? []) {
            const match = html.match(new RegExp(String.raw`<strong>\s*${escapeRegExp(label)}\s*</strong>`, "i"));
            if (match) {
                found.push({ outcome, start: match.index, contentStart: match.index + match[0].length });
                break;
            }
        }
    }
    found.sort((a, b) => a.start - b.start);

    const sections = {};
    const starts = Object.fromEntries(found.map((entry) => [entry.outcome, entry.start]));
    let general = "";
    found.forEach((entry, index) => {
        const next = found[index + 1];
        const section = html.slice(entry.contentStart, next ? next.start : html.length);
        if (next) {
            sections[entry.outcome] = section;
        } else {
            const end = section.search(/<\/p>|<\/li>/);
            sections[entry.outcome] = end === -1 ? section : section.slice(0, end);
            general = end === -1 ? "" : section.slice(end);
        }
    });
    return { sections, general, starts };
}

const DEGREE_KEYS = {
    "critical success": "criticalSuccess",
    success: "success",
    failure: "failure",
    "critical failure": "criticalFailure",
};

/**
 * The degrees of success an effect's label names in its last parentheses: "Spell Effect: Faerie Dust (Critical
 * Failure)" → ["criticalFailure"], "(Failure or Critical Failure)" → ["failure", "criticalFailure"]; null if none
 */
function degreesNamed(label) {
    const named = label.toLowerCase().match(/\(([^()]*)\)\s*$/)?.[1];
    if (!named) return null;
    const parts = named.split(/\s*(?:,|\bor\b|\band\b|\/)\s*/).filter(Boolean);
    return parts.length > 0 && parts.every((part) => DEGREE_KEYS[part]) ? parts.map((part) => DEGREE_KEYS[part]) : null;
}

/** Links to effect items in a piece of text, e.g. "@UUID[Compendium.pf2e.spell-effects.Item.abc]{Spell Effect: X}" */
function findEffectLinks(html) {
    const links = [];
    for (const match of html.matchAll(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g)) {
        const [, uuid, label] = match;
        if (/^Compendium\.[^.]+\.[^.]*effect[^.]*\.Item\./i.test(uuid)) {
            links.push({ effect: uuid, label: label ?? uuid.split(".").at(-1) });
        }
    }
    return links;
}

function parseCount(text) {
    return /^\d+$/.test(text) ? Number(text) : (NUMBER_WORDS[text] ?? null);
}

/** "1 minute", "sustained up to 1 minute", "10 rounds": the spell's own duration, if it's a fixed amount of time */
function parseSpellDuration(text) {
    const match = String(text ?? "")
        .toLowerCase()
        .trim()
        .match(/^(?:sustained )?(?:up to )?(\d+|an?|one|two|three|ten) (round|minute|hour|day)s?$/);
    if (!match) return null;
    const value = parseCount(match[1]);
    return value ? { value, dice: null, unit: UNITS[match[2]], expiry: "turn-start", relativeTo: "caster" } : null;
}

/** Duration phrases in a sentence, with their positions */
function findDurations(sentence, spellDuration) {
    const durations = [];
    const add = (match, duration) =>
        durations.push({ start: match.index, end: match.index + match[0].length, duration });
    const turnEnd = (whose) => ({
        value: 1,
        dice: null,
        unit: "rounds",
        expiry: "turn-end",
        relativeTo: whose === "your" ? "caster" : "target",
    });

    for (const match of sentence.matchAll(new RegExp(String.raw`\bfor ${COUNT} (round|minute|hour|day)s?\b`, "g"))) {
        const dice = /d/.test(match[1]) ? match[1] : null;
        add(match, { value: dice ? null : parseCount(match[1]), dice, unit: UNITS[match[2]], expiry: "turn-start" });
        durations.at(-1).duration.relativeTo = "caster";
    }
    for (const match of sentence.matchAll(
        new RegExp(String.raw`\buntil the (start|end) of ${WHOSE} next turn\b`, "g"),
    )) {
        add(match, match[1] === "end" ? turnEnd(match[2]) : { ...turnEnd(match[2]), expiry: "turn-start" });
    }
    for (const match of sentence.matchAll(
        new RegExp(String.raw`\buntil ${WHOSE} next turn (begins|starts|ends)\b`, "g"),
    )) {
        add(match, match[2] === "ends" ? turnEnd(match[1]) : { ...turnEnd(match[1]), expiry: "turn-start" });
    }
    for (const match of sentence.matchAll(/\bfor (?:that|this|the rest of (?:its|that|the)) turn\b/g)) {
        add(match, turnEnd("its"));
    }
    // Shorter than a turn, but a turn is the closest timer pf2e has
    for (const match of sentence.matchAll(new RegExp(String.raw`\bfor ${WHOSE} next action\b`, "g"))) {
        add(match, turnEnd(match[1]));
    }
    // No timer, and not the spell's duration either ("the target is permanently enfeebled 2")
    for (const match of sentence.matchAll(/\bpermanently\b/g)) {
        add(match, { permanent: true });
    }
    if (spellDuration) {
        for (const match of sentence.matchAll(/\bfor the (?:spell's )?duration(?: of the spell)?\b/g)) {
            add(match, { ...spellDuration });
        }
    }
    durations.sort((a, b) => a.start - b.start);

    // "takes a penalty for 1 minute and is dazzled as long as it has this penalty": the earlier timer again
    const same = /\bas long as (?:it|they) (?:has|have|suffers?) (?:this|that|the) (?:penalty|effect)\b/g;
    for (const match of sentence.matchAll(same)) {
        const earlier = durations.findLast((d) => d.start < match.index);
        if (earlier) add(match, { ...earlier.duration });
    }
    return durations.sort((a, b) => a.start - b.start);
}

/** "as long as it's sickened", "while it's frightened", "until it's no longer clumsy" */
function findLinks(sentence, namePattern, slugsByName) {
    const pattern = new RegExp(
        String.raw`\b(?:(?:for )?as long as|while|until) ${SUBJECT}${IS}(?: no longer)? (${namePattern})\b`,
        "g",
    );
    return [...sentence.matchAll(pattern)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        anchor: slugsByName.get(match[1]),
    }));
}

/**
 * Whether a condition mentioned after this text is the caster's ("the target resists being banished and you are
 * Stunned 1"): the last subject before it is "you"
 */
const SUBJECTS = new RegExp(
    String.raw`\b(?:(?<!\b(?:than|to|at|from|by|with) )(you)(?:'re| are| become| fall| also| spend| take| gain)\b|it|they|the (?:target|creature|attacker)s?)\b`,
    "g",
);
function isCasters(before) {
    return !![...before.matchAll(SUBJECTS)].at(-1)?.[1];
}

/** Whether the text between two condition mentions only joins them in a list ("x, y, and z") */
function isListJoin(text) {
    return /^\s*(?:,|and|or|, and|, or)\s*$/.test(text);
}

/** Conditions that end by their own rules, and stunned with a value, which counts down */
const isTimeless = (condition) =>
    SELF_ENDING.has(condition.slug) || (condition.slug === "stunned" && !!condition.value);

/** "As success, with a duration of 1 hour", "but the duration is 3 rounds", "with an unlimited duration" */
const RESTATED = new RegExp(
    String.raw`\b(?:with a duration of|the duration is) (?:${COUNT} (round|minute|hour|day)s?\b|unlimited\b|permanent\b)|\bwith an? (?:unlimited|permanent) duration\b`,
);

function toRounds(duration) {
    return duration.value * (ROUNDS_PER_UNIT[duration.unit] ?? 1);
}

/** Read the conditions in a piece of plain text */
function readConditions(text, { namePattern, slugsByName, fallback }) {
    const mentionPattern = new RegExp(String.raw`\b(${namePattern})\b(?:(?: value is)? (\d+))?`, "g");
    const entries = [];
    for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
        const links = findLinks(sentence, namePattern, slugsByName);
        const inLink = (index) => links.some((l) => index >= l.start && index < l.end);

        const mentions = [];
        for (const match of sentence.matchAll(mentionPattern)) {
            if (inLink(match.index)) continue;
            const before = sentence.slice(Math.max(0, match.index - 25), match.index);
            if (NEGATORS.some((n) => before.endsWith(n) || before.includes(` ${n}`))) continue;
            if (isCasters(sentence.slice(0, match.index))) continue;
            // "Everything other than you is concealed from the target": others' condition, as the target sees them
            if (
                /^ (?:from|to) (?:the (?:target|creature)|it|them)\b/.test(
                    sentence.slice(match.index + match[0].length),
                )
            )
                continue;
            mentions.push({
                slug: slugsByName.get(match[1]),
                value: match[2] ? Number(match[2]) : null,
                start: match.index,
                end: match.index + match[0].length,
                duration: null,
                linkedTo: null,
            });
        }
        if (mentions.length === 0) continue;

        // A duration or link applies to the mention just before it, if nothing else comes between them, and back
        // through a list joined to it ("dazzled and deafened for 1 minute"), skipping valued conditions that end by
        // their own rules
        const assignBackwards = (position, assign) => {
            let index = mentions.findLastIndex((m) => m.end <= position);
            if (index === -1) return false;
            const between = sentence.slice(mentions[index].end, position);
            if (/[,;.]|\bthen\b/.test(between) || between.length > 40) return false;
            if (isTimeless(mentions[index]) && between.trim()) return false;
            assign(mentions[index]);
            while (index > 0) {
                const previous = mentions[index - 1];
                if (!isListJoin(sentence.slice(previous.end, mentions[index].start))) break;
                if (previous.duration || previous.linkedTo) break;
                if (!isTimeless(previous)) assign(previous);
                index -= 1;
            }
            return true;
        };

        let lastDuration = null;
        const durations = findDurations(sentence, fallback);
        durations.forEach(({ start, end, duration }, index) => {
            // "For 1 round, the target is stupefied 2": a timer before any condition applies to those after it
            if (!mentions.some((m) => m.end <= start)) {
                const until = durations[index + 1]?.start ?? sentence.length;
                for (const mention of mentions.filter((m) => m.start >= end && m.start < until)) {
                    if (!mention.duration && !mention.linkedTo) mention.duration = { ...duration };
                }
                return;
            }
            assignBackwards(start, (mention) => {
                if (mention.duration || mention.linkedTo) return;
                const resolved = { ...duration };
                // "blinded for 1 round, then dazzled for 1 minute": the second starts when the first ends
                const before = sentence.slice(0, mention.start);
                if (lastDuration && resolved.value && /\bthen\b/.test(before.slice(before.lastIndexOf(",")))) {
                    resolved.value = toRounds(resolved) + toRounds(lastDuration);
                    resolved.unit = "rounds";
                }
                mention.duration = resolved;
            });
            if (duration.value) lastDuration = duration;
        });
        // "While it's sickened, it's also slowed 1": a link with no condition before it applies to the one after it
        const assignForwards = (position, assign) => {
            let index = mentions.findIndex((m) => m.start >= position);
            if (index === -1) return;
            const between = sentence.slice(position, mentions[index].start);
            if (/[;.]|\bthen\b/.test(between) || between.length > 40) return;
            assign(mentions[index]);
            while (index < mentions.length - 1) {
                const next = mentions[index + 1];
                if (!isListJoin(sentence.slice(mentions[index].end, next.start))) break;
                assign(next);
                index += 1;
            }
        };
        for (const { start, end, anchor } of links) {
            const link = (mention) => {
                if (mention.slug !== anchor && !mention.duration && !mention.linkedTo) mention.linkedTo = anchor;
            };
            if (!assignBackwards(start, link)) assignForwards(end, link);
        }

        for (const mention of mentions) {
            const permanent = !!mention.duration?.permanent;
            const duration = permanent ? null : mention.duration;
            // A condition mentioned again ("the sickened value can't be reduced") adds nothing new
            const existing = entries.find((e) => e.slug === mention.slug);
            if (existing) {
                existing.value ??= mention.value;
                existing.duration ??= duration;
                continue;
            }
            const useSpellDuration = !duration && !permanent && !mention.linkedTo && !isTimeless(mention) && !!fallback;
            entries.push({
                slug: mention.slug,
                value: mention.value,
                duration: duration ?? (useSpellDuration ? { ...fallback } : null),
                linkedTo: mention.linkedTo,
                fromSpellDuration: useSpellDuration,
                permanent,
            });
        }
    }
    return entries;
}

/**
 * Spells without degree-of-success entries can state results in their text: "becomes sickened 1 if it fails a Will
 * save (or sickened 2 on a critical failure)", "If the target critically fails the save, it is also stunned 1", "On a
 * failure, it takes a penalty, and on a critical failure, it's also immobilized", "must succeed at a Reflex save or
 * fall prone", "On a successful save, it's pushed; otherwise, it's restrained". Returns the pieces of text that apply,
 * in order; later pieces override earlier ones, and a piece that `replacesLast` ("(or blinded on a critical
 * failure)") takes the place of the last condition before it.
 */
function getConditionalTexts(text, outcome) {
    if (!["failure", "criticalFailure"].includes(outcome)) return [];
    const parts = [];
    const override = /\((?:or )?([^)]*?) on a critical failure\)/;
    const failure = /\bfails?\b|\bfailed\b|\bon a failure\b|\bmust succeed at\b|^otherwise,/;
    for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
        const match = sentence.match(override);
        const plain = sentence.replace(override, "");
        // "On a failure, …, and on a critical failure, it's also immobilized": the failure's part, then the rest
        const at = plain.search(/\bon a critical failure\b/);
        const before = at === -1 ? plain : plain.slice(0, at);
        // "The target is stunned 1 if it critically fails", but not "a creature that fails or critically fails"
        const criticalOnly = at === -1 && /(?<!\bfails? or )\bcritically fail/.test(plain);
        if (criticalOnly) {
            if (outcome === "criticalFailure") parts.push({ text: plain });
            continue;
        }
        if (failure.test(before)) {
            parts.push({ text: before });
            if (outcome === "criticalFailure" && match) parts.push({ text: `${match[1]}.`, replacesLast: true });
        }
        if (at !== -1 && outcome === "criticalFailure") parts.push({ text: plain.slice(at) });
    }
    return parts;
}

/**
 * Later mentions override earlier ones ("As failure, except the target is stupefied 2"), keeping the timer or link
 * the earlier one had when the later one doesn't restate it
 */
function preferLater(entries) {
    const result = [];
    for (const entry of entries) {
        const index = result.findIndex((e) => e.slug === entry.slug);
        if (index === -1) {
            result.push(entry);
        } else {
            const earlier = result[index];
            const keepTimer =
                !entry.linkedTo && !entry.permanent && (!entry.duration || entry.fromSpellDuration) && earlier.duration;
            result[index] = keepTimer
                ? { ...entry, duration: earlier.duration, fromSpellDuration: earlier.fromSpellDuration }
                : { ...entry, linkedTo: entry.linkedTo ?? (entry.duration ? null : earlier.linkedTo) };
        }
    }
    return result;
}

/**
 * Propose what a creature suffers for a degree of success on the spell's save.
 * @param {string} html The spell's description
 * @param {string} outcome "criticalSuccess", "success", "failure" or "criticalFailure"
 * @param {object} options
 * @param {{ slug: string, name: string, id?: string }[]} options.conditions The conditions to recognize
 * @param {Record<string, string[]>} options.labels The labels of each degree of success, e.g. { failure: ["Failure"] }
 * @param {string} [options.spellDuration] The spell's duration text, used for conditions with no timer of their own
 * @returns {{ effects: { effect: string, label: string }[], conditions: { slug: string, value: number | null,
 *     duration: object | null, linkedTo: string | null, fromSpellDuration: boolean }[] }}
 */
export function parseSpellOutcome(html, outcome, { conditions, labels, spellDuration = "" }) {
    const usable = conditions.filter((c) => !IGNORED.has(c.slug));
    const conditionsById = new Map(conditions.filter((c) => c.id).map((c) => [c.id, c.name]));
    const slugsByName = new Map();
    for (const { slug, name } of usable) {
        slugsByName.set(name.toLowerCase(), slug);
        slugsByName.set(slug.replace(/-/g, " "), slug);
        slugsByName.set(slug, slug);
    }
    const namePattern = [...slugsByName.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|");
    const context = { namePattern, slugsByName, fallback: parseSpellDuration(spellDuration) };

    // Leave out heightening, which describes other ranks
    const body = html.split(/<strong>\s*Heightened/i)[0];
    const { sections: outcomes, general, starts } = getOutcomeHtml(body, labels);
    // An unnamed effect after the entries is the caster's when the spell says what "you gain" before them ("If this
    // kills it, you gain 10 temporary HP", followed by Spell Effect: Death Knell)
    const intro = toPlainText(body.slice(0, Math.min(...Object.values(starts))), conditionsById);
    const castersGain = /\byou (?:gain|get|receive)\b/.test(intro);
    const generalEffects = findEffectLinks(general).filter((e) => !castersGain || degreesNamed(e.label));

    const read = (key, seen = new Set()) => {
        const outcomeHtml = outcomes[key];
        if (!outcomeHtml || seen.has(key)) return { effects: [], conditions: [] };
        seen.add(key);
        const effects = findEffectLinks(outcomeHtml);
        let text = toPlainText(outcomeHtml, conditionsById);
        let inherited = { effects: [], conditions: [] };
        // "As failure, and the target is stunned 2"
        const asOther = text.match(/^as (?:the |a |on a )?(critical success|success|critical failure|failure)\b,?/);
        if (asOther) {
            const other = { "critical success": "criticalSuccess", success: "success", failure: "failure" };
            const otherKey = other[asOther[1]] ?? "criticalFailure";
            inherited = read(otherKey, seen);
            text = text.slice(asOther[0].length);
        }
        // "It then suffers the failure effect", "It then takes the effects of a failure" (not "if it was flying, it
        // takes the effects of critical failure instead")
        const degree = "(critical success|success|critical failure|failure)";
        const suffers = text.match(
            new RegExp(
                String.raw`\bsuffers? the ${degree} effects?\b|\bthen takes? the effects? of (?:a |the )?${degree}\b`,
            ),
        );
        if (suffers && !asOther) {
            const other = { "critical success": "criticalSuccess", success: "success", failure: "failure" };
            const later = read(other[suffers[1] ?? suffers[2]] ?? "criticalFailure", seen);
            inherited = { effects: later.effects, conditions: later.conditions };
            text = text.replace(suffers[0], "");
        }

        // An effect linked after the last entry applies to every degree the creature doesn't shrug off, or only takes
        // damage from, unless the degree has an effect of its own or the effect is named for other degrees ("Spell
        // Effect: Faerie Dust (Critical Failure)", "(Failure or Critical Failure)")
        const unaffected = /\bunaffected\b/.test(text) && !asOther;
        const damageOnly = /^(?:the |a |each )?\w+ takes? (?:no|half|full|double) damage\.?$/.test(text.trim());
        const general = generalEffects.filter((e) => {
            const degrees = degreesNamed(e.label);
            if (degrees) return degrees.includes(key);
            return effects.length === 0 && !unaffected && !damageOnly;
        });
        let own = readConditions(text, context);
        // "As success, with a duration of 1 hour", "As success, but the duration is unlimited": a new timer for the
        // conditions that take one
        const restated = text.match(RESTATED);
        if (restated) {
            const value = restated[1] ? parseCount(restated[1]) : null;
            const duration = value
                ? { value, dice: null, unit: UNITS[restated[2]], expiry: "turn-start", relativeTo: "caster" }
                : null;
            // Not a timer tied to the creature's turn ("slowed 1 for that turn")
            const retime = (c) =>
                c.linkedTo || c.permanent || isTimeless(c) || c.duration?.relativeTo === "target"
                    ? c
                    : { ...c, duration: duration && { ...duration }, fromSpellDuration: false, permanent: !duration };
            inherited = { ...inherited, conditions: inherited.conditions.map(retime) };
            own = own.map((c) => (c.duration && !c.fromSpellDuration ? c : retime(c)));
        }
        // An entry's own effect replaces the one it refers to ("As success, but the effect is permanent", followed by
        // Spell Effect: Outcast's Curse (Failure)), unless it adds to it ("As failure, and the creature also takes a
        // –1 penalty", followed by Spell Effect: Faerie Dust (Critical Failure)) or follows it ("It then suffers…")
        const ownEffects = [...effects, ...general];
        const adds = suffers || /^\s*(?:and|plus)\b/.test(text);
        return {
            effects: ownEffects.length > 0 && !adds ? ownEffects : [...inherited.effects, ...ownEffects],
            conditions: suffers
                ? preferLater([...own, ...inherited.conditions])
                : preferLater([...inherited.conditions, ...own]),
        };
    };

    let result = read(outcome);
    if (Object.keys(outcomes).length === 0) {
        const parts = [];
        for (const { text, replacesLast } of getConditionalTexts(toPlainText(body, conditionsById), outcome)) {
            const read = readConditions(text, context);
            // "Dazzled (or blinded on a critical failure)": blinded instead; the same condition keeps its timer
            const last = parts.at(-1)?.at(-1);
            if (replacesLast && last && read.length > 0 && !read.some((c) => c.slug === last.slug)) parts.at(-1).pop();
            parts.push(read);
        }
        result = { effects: [], conditions: preferLater(parts.flat()) };
    }
    result.effects = result.effects.filter((e, i, all) => all.findIndex((o) => o.effect === e.effect) === i);

    // Conditions others are linked to come first, so they exist when the link is made
    return {
        effects: result.effects,
        conditions: result.conditions
            .sort((a, b) => Number(!!a.linkedTo) - Number(!!b.linkedTo))
            .map(({ permanent: _permanent, ...condition }) => condition),
    };
}

/**
 * The conditions an effect grants through its GrantItem rules, by slug, so they aren't also proposed separately.
 * @param {object} effectSource The effect's source data
 * @param {{ slug: string, name: string, id?: string }[]} conditions The conditions to recognize
 */
export function getGrantedConditions(effectSource, conditions) {
    const slugs = new Set();
    for (const rule of effectSource?.system?.rules ?? []) {
        if (rule.key !== "GrantItem" || typeof rule.uuid !== "string" || !/conditionitems|conditions/.test(rule.uuid)) {
            continue;
        }
        const last = rule.uuid.split(".").at(-1).toLowerCase();
        const condition = conditions.find((c) => [c.id?.toLowerCase(), c.name.toLowerCase(), c.slug].includes(last));
        if (condition) slugs.add(condition.slug);
    }
    return slugs;
}

/**
 * Pre-answer an effect's "degree of success" choice, such as Spell Effect: Leaden Steps asks for, so applying it
 * doesn't prompt. Changes the source in place.
 */
export function preselectDegree(effectSource, outcome) {
    const degree =
        { criticalSuccess: "critical-success", success: "success", failure: "failure" }[outcome] ?? "critical-failure";
    for (const rule of effectSource?.system?.rules ?? []) {
        if (rule.key !== "ChoiceSet" || !Array.isArray(rule.choices) || rule.selection !== undefined) continue;
        const choice = rule.choices.find((c) => c.value === degree || c.value?.degree === degree);
        if (choice) rule.selection = choice.value;
    }
}
