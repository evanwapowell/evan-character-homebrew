/**
 * Fetches the pf2e data the spell baselines are made from: a shallow, sparse clone of foundryvtt/pf2e at the commits
 * pinned in tools/pf2e.json, with only the packs the parsers read, into .cache/pf2e/<version> (git-ignored). A folder
 * already at its pinned commit is left alone. Needs git and network access.
 *
 *     npm run fetch-pf2e            both versions
 *     npm run fetch-pf2e -- v14     one
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PACKS, PINS, dataDir } from "./pf2e-data.mjs";

const REPOSITORY = "https://github.com/foundryvtt/pf2e.git";

const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

function fetchVersion(version) {
    const { commit } = PINS[version];
    const dir = dataDir(version);
    const marker = path.join(dir, ".commit");
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === commit) {
        console.log(`pf2e ${version}: already at ${commit.slice(0, 10)}`);
        return;
    }
    console.log(`pf2e ${version}: fetching ${commit.slice(0, 10)} (${PINS[version].branch})`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    git(dir, "init", "--quiet");
    git(dir, "remote", "add", "origin", REPOSITORY);
    git(dir, "sparse-checkout", "set", "--no-cone", ...PACKS.map((pack) => `/packs/pf2e/${pack}/`));
    git(dir, "fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", commit);
    git(dir, "checkout", "--quiet", "FETCH_HEAD");
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    fs.writeFileSync(marker, `${commit}\n`);
}

const wanted = process.argv.slice(2);
for (const version of wanted.length > 0 ? wanted : Object.keys(PINS)) {
    if (!PINS[version]) {
        console.error(`Unknown version "${version}": tools/pf2e.json has ${Object.keys(PINS).join(", ")}`);
        process.exit(1);
    }
    fetchVersion(version);
}
