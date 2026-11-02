/**
 * Checks run before a release: the manifest is valid, every script loads without syntax errors, and the compendium
 * source is well formed. Exits with an error listing every problem found.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const problems = [];

function* files(dir, extension) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* files(file, extension);
        else if (entry.name.endsWith(extension)) yield file;
    }
}

// The manifest
let manifest = {};
try {
    manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
} catch (error) {
    problems.push(`module.json isn't valid JSON: ${error.message}`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
    problems.push(`module.json's version "${manifest.version}" isn't of the form 1.2.3`);
}
for (const script of manifest.esmodules ?? []) {
    if (!fs.existsSync(path.join(ROOT, script))) problems.push(`module.json lists ${script}, which doesn't exist`);
}

// Every script, including ones only imported by others
for (const file of files(path.join(ROOT, "scripts"), ".js")) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) problems.push(`${path.relative(ROOT, file)} has a syntax error:\n${result.stderr.trim()}`);
}

// The compendium source
for (const pack of manifest.packs ?? []) {
    const source = path.join(ROOT, "src/packs", pack.name);
    if (!fs.existsSync(source)) {
        problems.push(`module.json lists the pack ${pack.name}, but src/packs/${pack.name} doesn't exist`);
        continue;
    }
    const ids = new Map();
    for (const file of files(source, ".json")) {
        const relative = path.relative(ROOT, file);
        let doc;
        try {
            doc = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (error) {
            problems.push(`${relative} isn't valid JSON: ${error.message}`);
            continue;
        }
        if (!/^[A-Za-z0-9]{16}$/.test(doc._id ?? "")) problems.push(`${relative} has no valid 16-character _id`);
        if (!doc.name) problems.push(`${relative} has no name`);
        if (ids.has(doc._id)) problems.push(`${relative} has the same _id as ${ids.get(doc._id)}`);
        ids.set(doc._id, relative);
    }
}

if (problems.length > 0) {
    console.error(`Found ${problems.length} problem(s):\n\n${problems.join("\n\n")}`);
    process.exit(1);
}
console.log("All checks passed.");
