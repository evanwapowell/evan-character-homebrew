/**
 * Runs the spell parsers over every pf2e spell (and this module's own) at the pinned commits, for the baselines in
 * tests/baselines/ that tests/spell-baselines.test.js compares against:
 *
 * - spell-conditions.<version>.json: for each spell with a save, what the spell conditions' Apply button proposes for
 *   each degree of success (`parseSpellOutcome`, less the conditions the linked effects grant, as
 *   scripts/spell-conditions.js does). Degrees with nothing to apply are left out.
 * - spell-effect-links.<version>.json: for each spell without a save that links effects, the effects
 *   scripts/spell-target-effects.js lists and the ones it applies by default, by the rank cast at (each rank where
 *   the choice changes).
 *
 *     node tools/parse-spells.mjs              print a summary
 *     node tools/parse-spells.mjs --update     rewrite the baselines (npm run test:update-baselines)
 *
 * Needs the data from tools/fetch-pf2e.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { OUTCOMES, getGrantedConditions, parseSpellOutcome } from "../scripts/lib/spell-condition-parser.js";
import { defaultEffects, parseLinks } from "../scripts/lib/spell-effect-links.js";
import { PINS, hasData, loadData } from "./pf2e-data.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
export const BASELINES = path.join(ROOT, "tests/baselines");
export const KINDS = ["spell-conditions", "spell-effect-links"];
export const baselineFile = (kind, version) => path.join(BASELINES, `${kind}.${version}.json`);

/** The labels scripts/spell-conditions.js reads degree-of-success entries by, in English */
const LABELS = {
    criticalSuccess: ["Critical Success"],
    success: ["Success"],
    failure: ["Failure"],
    criticalFailure: ["Critical Failure"],
};

/** "frightened 3", "slowed 1 for 1 minute (caster's turn start)", "stupefied 2 while frightened" */
export function describeCondition(condition) {
    let text = condition.slug + (condition.value != null ? ` ${condition.value}` : "");
    const duration = condition.duration;
    if (duration) {
        const amount = duration.dice ?? duration.value;
        const unit = amount === 1 ? duration.unit.replace(/s$/, "") : duration.unit;
        const whose = duration.relativeTo === "caster" ? "caster's" : "its";
        const when = duration.expiry === "turn-end" ? "end" : "start";
        text += ` for ${amount} ${unit} (${whose} turn ${when})`;
        if (condition.fromSpellDuration) text += " [spell's duration]";
    }
    if (condition.linkedTo) text += ` while ${condition.linkedTo}`;
    return text;
}

/** The key a spell is listed by: its name, "(this module)" after this module's own, and the ID when that's not unique */
export function spellKey(spell, spells) {
    const name = spell.own ? `${spell.name} (this module)` : spell.name;
    const same = spells.filter((s) => s.name === spell.name && !!s.own === !!spell.own);
    return same.length > 1 ? `${name} (${spell._id})` : name;
}

function keyed(spells) {
    return spells.map((spell) => [spellKey(spell, spells), spell]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const nameOf = (byUuid, uuid) => byUuid.get(uuid)?.name ?? uuid;

/** What the spell conditions' Apply button proposes for one degree of success: ["effect: …", "frightened 2", …] */
export function proposeConditions(spell, outcome, { conditions, byUuid }) {
    const parsed = parseSpellOutcome(spell.system.description.value, outcome, {
        conditions,
        labels: LABELS,
        spellDuration: spell.system.duration?.value,
    });
    const granted = new Set();
    const effects = [];
    for (const { effect } of parsed.effects) {
        // An effect in a pack that isn't fetched keeps its UUID; Foundry would find it
        const doc = byUuid.get(effect);
        effects.push(`effect: ${nameOf(byUuid, effect)}`);
        for (const slug of getGrantedConditions(doc, conditions)) granted.add(slug);
    }
    return [...effects, ...parsed.conditions.filter((c) => !granted.has(c.slug)).map(describeCondition)];
}

/** The effects a spell without a save links, as scripts/spell-target-effects.js reads them */
export function linkedEffects(spell, { byUuid }) {
    const effects = parseLinks(spell.system.description.value).flatMap((link) => {
        const doc = byUuid.get(link.uuid);
        return doc?.type === "effect" ? [{ ...link, name: doc.name }] : [];
    });
    if (effects.length === 0) return null;
    const listed = effects.some((e) => e.standalone) ? effects.filter((e) => e.standalone) : effects;
    const defaults = {};
    let previous = null;
    const base = Math.max(1, spell.system.level?.value ?? 1);
    for (let rank = base; rank <= 10; rank++) {
        const chosen = defaultEffects(effects, rank).map((uuid) => nameOf(byUuid, uuid));
        const key = JSON.stringify(chosen);
        if (key !== previous) defaults[rank] = chosen;
        previous = key;
    }
    return { listed: listed.map((e) => e.name), defaults };
}

/** Both parsers' output over a version's spells: { "spell-conditions": {…}, "spell-effect-links": {…} } */
export function runParsers(version) {
    const data = loadData(version);
    const conditions = {};
    const links = {};
    for (const [key, spell] of keyed(data.spells)) {
        if (spell.system.defense?.save) {
            const results = {};
            for (const outcome of OUTCOMES) {
                const proposed = proposeConditions(spell, outcome, data);
                if (proposed.length > 0) results[outcome] = proposed;
            }
            conditions[key] = results;
        } else {
            const result = linkedEffects(spell, data);
            if (result) links[key] = result;
        }
    }
    return { "spell-conditions": conditions, "spell-effect-links": links };
}

export const serialize = (output) => `${JSON.stringify(output, null, 4)}\n`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const update = process.argv.includes("--update");
    let missing = false;
    for (const version of Object.keys(PINS)) {
        if (!hasData(version)) {
            console.error(`pf2e ${version}'s data isn't fetched: run npm run fetch-pf2e`);
            missing = true;
            continue;
        }
        const output = runParsers(version);
        for (const kind of KINDS) {
            const count = Object.keys(output[kind]).length;
            if (update) {
                fs.mkdirSync(BASELINES, { recursive: true });
                fs.writeFileSync(baselineFile(kind, version), serialize(output[kind]));
                console.log(`Wrote ${path.relative(ROOT, baselineFile(kind, version))} (${count} spells)`);
            } else {
                console.log(`pf2e ${version}: ${kind}, ${count} spells`);
            }
        }
    }
    if (missing) process.exit(1);
}
