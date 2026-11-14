/**
 * The spell parsers over every pf2e spell at the pinned commits, compared with the committed baselines in
 * tests/baselines/ (written by tools/parse-spells.mjs). A deliberate change to a parser updates them with
 * `npm run test:update-baselines`, so the PR shows what it changes spell by spell. Skipped when pf2e's data isn't
 * fetched (`npm run fetch-pf2e`); CI always fetches it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { PINS, skipWithoutData } from "../tools/pf2e-data.mjs";
import { KINDS, baselineFile, runParsers } from "../tools/parse-spells.mjs";

const show = (value) => JSON.stringify(value);

/** A readable difference per spell: what each degree of success (or field) was, and is now */
function differences(expected, actual) {
    const lines = [];
    for (const spell of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
        const before = expected[spell];
        const after = actual[spell];
        if (show(before) === show(after)) continue;
        if (before === undefined) {
            lines.push(`+ ${spell}: ${show(after)}`);
            continue;
        }
        if (after === undefined) {
            lines.push(`- ${spell}: ${show(before)}`);
            continue;
        }
        lines.push(`  ${spell}:`);
        for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
            if (show(before[key]) === show(after[key])) continue;
            if (before[key] !== undefined) lines.push(`    - ${key}: ${show(before[key])}`);
            if (after[key] !== undefined) lines.push(`    + ${key}: ${show(after[key])}`);
        }
    }
    return lines;
}

for (const version of Object.keys(PINS)) {
    describe(`spell parsers over pf2e ${version} (${PINS[version].branch})`, () => {
        const skip = skipWithoutData(version);
        const output = skip ? null : runParsers(version);
        for (const kind of KINDS) {
            it(`${kind} matches tests/baselines/${kind}.${version}.json`, { skip }, () => {
                const file = baselineFile(kind, version);
                assert.ok(fs.existsSync(file), `${file} is missing: run npm run test:update-baselines`);
                const lines = differences(JSON.parse(fs.readFileSync(file, "utf8")), output[kind]);
                assert.ok(
                    lines.length === 0,
                    `${lines.length} line(s) differ from the baseline (- baseline, + now). If the change is ` +
                        `intended, run npm run test:update-baselines and commit the baselines.\n${lines.join("\n")}`,
                );
            });
        }
    });
}
