/**
 * Checks run on every pull request and before a release: the manifest is valid, every script loads without syntax
 * errors and is listed or imported correctly, the compendium source is well formed, and the code follows the
 * conventions in CLAUDE.md that reading the files can confirm. Exits with an error listing every problem found.
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

// Files the scripts play from this module (the Finch version's animations) must be in it
for (const file of files(path.join(ROOT, "scripts"), ".js")) {
    const text = fs.readFileSync(file, "utf8");
    const dirs = [...text.matchAll(/const DIR = "modules\/evan-character-homebrew\/([^"]+)"/g)].map((m) => m[1]);
    for (const dir of dirs) {
        for (const [, name] of text.matchAll(/\$\{DIR\}\/([\w.-]+)/g)) {
            if (!fs.existsSync(path.join(ROOT, dir, name))) {
                problems.push(`${path.relative(ROOT, file)} plays ${dir}/${name}, which doesn't exist`);
            }
        }
    }
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

/* Conventions (CLAUDE.md) */

const SCRIPTS = [...files(path.join(ROOT, "scripts"), ".js")];
const relative = (file) => path.relative(ROOT, file);
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The code without its comments (blanked, keeping line numbers), so a comment explaining a rule doesn't break it */
function code(text) {
    let inBlock = false;
    return text
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (inBlock) {
                if (trimmed.includes("*/")) inBlock = false;
                return "";
            }
            if (trimmed.startsWith("//")) return "";
            if (trimmed.startsWith("/*")) {
                inBlock = !trimmed.includes("*/", 2);
                return "";
            }
            // A comment after code, outside a string: "foo(); // bar"
            return line.replace(/\s\/\/\s[^"'`]*$/, "");
        })
        .join("\n");
}

const codes = new Map(SCRIPTS.map((file) => [file, code(fs.readFileSync(file, "utf8"))]));

/** The names in an import or export list, "a, b as c": [["a", "a"], ["b", "c"]] (the name there, the name here) */
const listNames = (list) =>
    list
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
            const [name, alias = name] = item.split(/\s+as\s+/).map((part) => part.trim());
            return [name, alias];
        });

// 1. Imports resolve: `node --check` doesn't follow them, so a misspelled export only fails in Foundry
const exportCache = new Map();
function exportsOf(file, seen = new Set()) {
    if (exportCache.has(file)) return exportCache.get(file);
    const names = new Set();
    if (seen.has(file) || !fs.existsSync(file)) return names;
    seen.add(file);
    const text = code(fs.readFileSync(file, "utf8"));
    for (const [, name] of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/gm)) {
        names.add(name);
    }
    if (/^export\s+default\b/m.test(text)) names.add("default");
    for (const [, list] of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const [, alias] of listNames(list)) names.add(alias);
    }
    for (const [, from] of text.matchAll(/^export\s*\*\s*from\s*["']([^"']+)["']/gm)) {
        for (const name of exportsOf(path.resolve(path.dirname(file), from), seen)) names.add(name);
    }
    exportCache.set(file, names);
    return names;
}
for (const [file, text] of codes) {
    const statements = /^(?:import|export)\s+([^;"']*?)\s*from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm;
    for (const match of text.matchAll(statements)) {
        const [, clause = "", fromPath, bare] = match;
        const specifier = fromPath ?? bare;
        if (!specifier.startsWith(".")) continue;
        const where = `${relative(file)}:${lineOf(text, match.index)}`;
        const target = path.resolve(path.dirname(file), specifier);
        if (!fs.existsSync(target)) {
            problems.push(`${where} imports ${specifier}, which doesn't exist`);
            continue;
        }
        const exported = exportsOf(target);
        const braces = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
        const wanted = listNames(braces).map(([name]) => name);
        const head = clause
            .replace(/\{[^}]*\}/, "")
            .replace(/,/g, " ")
            .trim();
        if (head && !head.startsWith("*") && !match[0].startsWith("export")) wanted.push("default");
        for (const name of wanted) {
            if (!exported.has(name))
                problems.push(`${where} imports ${name} from ${specifier}, which doesn't export it`);
        }
    }
}

// 2. Every entry script is loaded by Foundry
for (const entry of fs.readdirSync(path.join(ROOT, "scripts"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    if (!(manifest.esmodules ?? []).includes(`scripts/${entry.name}`)) {
        problems.push(`scripts/${entry.name} isn't listed in module.json's esmodules`);
    }
}

// 3. The bare module flags on a message are always set (the session mark), so testing them tests nothing
const bareFlags = /\bflags\s*(?:\?\.)?\s*\[\s*MODULE_ID\s*\]\s*(?:\)|\|\||&&|\?(?![.?]))/g;
for (const [file, text] of codes) {
    for (const match of text.matchAll(bareFlags)) {
        problems.push(
            `${relative(file)}:${lineOf(text, match.index)} tests flags[MODULE_ID] itself, which every message has ` +
                `(the session mark): test a named key or hasModuleData(message)`,
        );
    }
}

// 4. A user can be connected more than once: isActiveGM() and createdHere() in place of comparing users
const sessionRules = [
    {
        pattern: /game\.user\s*[!=]==?\s*game\.users\.activeGM|game\.users\.activeGM\s*[!=]==?\s*game\.user\b/g,
        message: "compares game.user with game.users.activeGM: use isActiveGM()",
    },
    {
        pattern: /\buserId\s*[!=]==?\s*game\.user\.id\b|game\.user\.id\s*[!=]==?\s*userId\b/g,
        message: "compares userId with game.user.id: use createdHere(document, options, userId)",
    },
];
for (const [file, text] of codes) {
    if (relative(file) === path.join("scripts", "lib", "session.js")) continue;
    for (const { pattern, message } of sessionRules) {
        for (const match of text.matchAll(pattern))
            problems.push(`${relative(file)}:${lineOf(text, match.index)} ${message}`);
    }
}

// 5. Compendium links are by ID: a name only resolves in pf2e's own build. Literal links only: templated ones
// (`${PACK}.${ID}`) are checked by 6.
const LINK = /Compendium\.([\w-]+)\.([\w-]+)\.([A-Z]\w*)\.([^\s"'`\]}),.]*)/g;
const packFiles = [...(manifest.packs ?? [])].flatMap((pack) => {
    const dir = path.join(ROOT, "src/packs", pack.name);
    return fs.existsSync(dir) ? [...files(dir, ".json")] : [];
});
const linkSources = [...codes, ...packFiles.map((file) => [file, fs.readFileSync(file, "utf8")])];
for (const [file, text] of linkSources) {
    for (const match of text.matchAll(LINK)) {
        const id = match[4];
        if (id.startsWith("$")) continue;
        if (!/^[A-Za-z0-9]{16}$/.test(id)) {
            problems.push(
                `${relative(file)}:${lineOf(text, match.index)} links ${match[0]} by name: use the item's 16-character ID`,
            );
        }
    }
}

// 6. The module's own compendium items that the scripts use exist
const ownIds = new Set();
for (const file of packFiles) {
    try {
        ownIds.add(JSON.parse(fs.readFileSync(file, "utf8"))._id);
    } catch {
        // Reported above
    }
}
const OWN_PACK = "Compendium.evan-character-homebrew.evans-character-homebrew.Item";
for (const [file, text] of linkSources) {
    const prefixes = [escapeRegExp(OWN_PACK), String.raw`Compendium\.\$\{MODULE_ID\}\.evans-character-homebrew\.Item`];
    // Constants holding the pack's prefix (`const PACK = \`Compendium.${MODULE_ID}.evans-character-homebrew.Item\``)
    for (const [, name, value] of text.matchAll(/\bconst\s+(\w+)\s*=\s*[`"']([^`"']*)[`"']/g)) {
        if (value === OWN_PACK || value === "Compendium.${MODULE_ID}.evans-character-homebrew.Item") {
            prefixes.push(String.raw`\$\{${name}\}`);
        }
    }
    const constants = new Map(
        [...text.matchAll(/\bconst\s+(\w+)\s*=\s*["']([A-Za-z0-9]{16})["']/g)].map(([, name, id]) => [name, id]),
    );
    const uses = new RegExp(String.raw`(?:${prefixes.join("|")})\.(?:([A-Za-z0-9]+)|\$\{(\w+)\})`, "g");
    for (const match of text.matchAll(uses)) {
        const where = `${relative(file)}:${lineOf(text, match.index)}`;
        const id = match[1] ?? constants.get(match[2]);
        if (!id) problems.push(`${where} uses ${match[0]}, whose ID isn't a constant in the file`);
        else if (!ownIds.has(id)) problems.push(`${where} uses the module's item ${id}, which isn't in src/packs`);
    }
}

if (problems.length > 0) {
    console.error(`Found ${problems.length} problem(s):\n\n${problems.join("\n\n")}`);
    process.exit(1);
}
console.log("All checks passed.");
