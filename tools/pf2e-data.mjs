/**
 * pf2e's data, as the spell baselines read it: the commits pinned in tools/pf2e.json, fetched by
 * tools/fetch-pf2e.mjs into .cache/pf2e/<version>, and loaded here the way Foundry sees it. pf2e's source links
 * compendium items by name; its build turns the names into IDs, so the links are turned into IDs here too.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The pinned commits, one per supported pf2e version: { v13: { branch, commit }, v14: … } */
export const PINS = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/pf2e.json"), "utf8"));

/** pf2e's pack folders that are fetched, and the compendium names their links use */
const PACK_NAMES = {
    conditions: "conditionitems",
    spells: "spells-srd",
    "spell-effects": "spell-effects",
    "feat-effects": "feat-effects",
    "other-effects": "other-effects",
};
export const PACKS = Object.keys(PACK_NAMES);

export const dataDir = (version) => path.join(ROOT, ".cache/pf2e", version);

/** Whether a version's data has been fetched at its pinned commit */
export function hasData(version) {
    const marker = path.join(dataDir(version), ".commit");
    return fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === PINS[version]?.commit;
}

/**
 * Why the tests over a version's data are skipped (it isn't fetched), or false to run them. On CI they always run, so
 * missing data fails them rather than going unnoticed.
 */
export function skipWithoutData(version) {
    if (hasData(version) || process.env.CI) return false;
    return `pf2e ${version}'s data isn't fetched: run npm run fetch-pf2e`;
}

function* jsonFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* jsonFiles(file);
        else if (entry.name.endsWith(".json") && !entry.name.startsWith("_")) yield file;
    }
}

const readItems = (dir) =>
    [...jsonFiles(dir)].map((file) => JSON.parse(fs.readFileSync(file, "utf8"))).filter((doc) => doc._id && doc.type);

/** pf2e's sluggify for a condition's name: "Off-Guard" → "off-guard", "Persistent Damage" → "persistent-damage" */
const sluggify = (text) =>
    text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

/**
 * A version's packs, with links in descriptions resolved to IDs, plus this module's own items (its spells marked
 * `own`).
 * @returns {{ spells: object[], conditions: { slug, name, id, uuid }[], byUuid: Map<string, object> }}
 */
export function loadData(version) {
    if (!hasData(version))
        throw new Error(`pf2e ${version}'s data isn't fetched at its pinned commit: run npm run fetch-pf2e`);
    const dir = path.join(dataDir(version), "packs/pf2e");
    const byUuid = new Map();
    const byName = new Map();
    const packs = {};
    for (const [folder, pack] of Object.entries(PACK_NAMES)) {
        packs[folder] = readItems(path.join(dir, folder));
        for (const doc of packs[folder]) {
            const uuid = `Compendium.pf2e.${pack}.Item.${doc._id}`;
            byUuid.set(uuid, doc);
            byName.set(`${pack}.${doc.name}`, uuid);
        }
    }
    const own = readItems(path.join(ROOT, "src/packs/evans-character-homebrew"));
    for (const doc of own) {
        byUuid.set(`Compendium.evan-character-homebrew.evans-character-homebrew.Item.${doc._id}`, doc);
    }

    // As pf2e's build does: "Compendium.pf2e.conditionitems.Item.Frightened" → "…Item.TBSHQspnbcqxsmjL"
    const resolveLinks = (html) =>
        String(html ?? "").replace(/@UUID\[Compendium\.pf2e\.([\w-]+)\.Item\.([^\]]+)\]/g, (match, pack, name) => {
            const uuid = byName.get(`${pack}.${name}`);
            return uuid ? `@UUID[${uuid}]` : match;
        });
    const ownSpells = own.filter((doc) => doc.type === "spell").map((spell) => ({ ...spell, own: true }));
    const spells = [...packs.spells, ...ownSpells].map((spell) => ({
        ...spell,
        system: {
            ...spell.system,
            description: { ...spell.system.description, value: resolveLinks(spell.system.description?.value) },
        },
    }));

    const conditions = packs.conditions.map((doc) => ({
        slug: doc.system.slug || sluggify(doc.name),
        name: doc.name,
        id: doc._id,
        uuid: `Compendium.pf2e.conditionitems.Item.${doc._id}`,
    }));
    return { spells, conditions, byUuid };
}
