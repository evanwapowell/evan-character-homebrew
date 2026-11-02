/**
 * Build the compendium packs from their JSON source, or update the source from built packs.
 *
 *   npm run build                          src/packs/<name>/  ->  packs/<name>/ (LevelDB, what Foundry reads)
 *   npm run unpack                         packs/<name>/      ->  src/packs/<name>/
 *   npm run unpack -- <path to a pack>     that LevelDB pack  ->  src/packs/<name>/ (with one pack in module.json)
 *
 * Packs are listed in module.json. The source is laid out in folders matching the compendium's folders.
 */

import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
/** LevelDB key prefixes for each document type a pack can hold */
const COLLECTIONS = {
    Actor: "actors",
    Adventure: "adventures",
    Cards: "cards",
    Item: "items",
    JournalEntry: "journal",
    Macro: "macros",
    Playlist: "playlists",
    RollTable: "tables",
    Scene: "scenes",
};

function* jsonFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* jsonFiles(file);
        else if (entry.name.endsWith(".json")) yield file;
    }
}

/**
 * The CLI silently skips files without a `_key`, which files exported from Foundry ("Export Data") don't have. Copy
 * the source to a temporary folder, adding each missing key from the document's ID.
 */
function withKeys(source, collection) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "pack-source-"));
    for (const file of jsonFiles(source)) {
        const doc = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!doc._key) {
            if (!doc._id) {
                throw new Error(`${path.relative(ROOT, file)} has no _id: give it the ID of the entry it replaces.`);
            }
            doc._key = `!${collection}!${doc._id}`;
        }
        const target = path.join(copy, path.relative(source, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(doc));
    }
    return copy;
}

async function build() {
    for (const pack of manifest.packs) {
        const source = path.join(ROOT, "src/packs", pack.name);
        const target = path.join(ROOT, pack.path);
        const collection = COLLECTIONS[pack.type];
        if (!collection) throw new Error(`Unsupported pack type "${pack.type}" for ${pack.name}`);

        const keyed = withKeys(source, collection);
        fs.rmSync(target, { recursive: true, force: true });
        await compilePack(keyed, target, { recursive: true });
        fs.rmSync(keyed, { recursive: true, force: true });
        console.log(`Built ${pack.path} from src/packs/${pack.name}`);
    }
}

async function unpack(from) {
    if (from && manifest.packs.length !== 1) throw new Error("Give a pack path only when module.json has one pack.");
    for (const pack of manifest.packs) {
        const source = path.resolve(from ?? path.join(ROOT, pack.path));
        const target = path.join(ROOT, "src/packs", pack.name);
        await extractPack(source, target, { folders: true, clean: true });
        console.log(`Unpacked ${path.relative(ROOT, source) || source} into src/packs/${pack.name}`);
    }
}

const [command, from] = process.argv.slice(2);
if (command === "build") await build();
else if (command === "unpack") await unpack(from);
else throw new Error(`Unknown command "${command}": use "build" or "unpack".`);
