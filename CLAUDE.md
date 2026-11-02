# Evan's Character Homebrew

A Foundry VTT module of homebrew content and automations for the Pathfinder 2e (pf2e) system, used at Evan's tables. It
supports Foundry v13 and v14 (pf2e 7.x and 8.x); v12 is no longer supported.

## Layout

- `module.json`: the manifest. Scripts are listed under `esmodules`; `"socket": true` is needed for the GM hand-offs
  below.
- `src/packs/evans-character-homebrew/`: the compendium's source, one JSON file per item, in folders matching the
  compendium's folders (see "Editing the compendium"). `packs/` is built from it and isn't committed.
- `scripts/*.js`: plain ES modules loaded by Foundry, with no build step.
    - `manifest-will.js`: the Manifest Will aura's turn-start effects, concealment flat checks, cast animations, and
      re-centering on a seneschal's charge.
    - `sustain.js`: the Sustain buttons (actor sheet and PF2e HUD), reposting the spell's card, and ending sustained
      effects that weren't Sustained.
    - `ongoing-misery.js`: Familiar of Ongoing Misery.
    - `witch-charge.js`: the Designate Witch's Charge action.
    - `spell-conditions.js` with `lib/spell-condition-parser.js`: the "Apply" buttons that read a spell's text for a
      save result and apply its conditions. The parser has no Foundry dependencies, so it can be run in Node.
- `token-subjects/`: token art.
- `tools/packs.mjs` and `tools/check.mjs`, run with npm (`package.json`): build or unpack the compendium, and check the
  module before a release.
- `.github/workflows/release.yml`: builds and publishes releases (see below).

## Releases and workflow

- A push to `main` publishes a release when `module.json`'s version hasn't been released yet: the workflow runs
  `npm test`, builds the compendium, points the manifest's `download` at this version's release, zips `module.json`,
  `packs/`, `scripts/` and `token-subjects/`, and publishes them as the latest release, tagged with the version.
  Foundry's manifest URL points at the latest release. Other branches, and pushes that don't bump the version, publish
  nothing, and an existing release is never overwritten.
- So bump `version` in `module.json` with every change to the module (the workflow fills in `download`): the middle
  number for a new feature (1.12.0 → 1.13.0), the last for a fix or small tweak (1.13.0 → 1.13.1). Changes outside the
  zipped files (like this file) don't need a bump.
- When a change is done and tested, open a PR to `main` and merge it, so the release goes out. Then check that the
  release's `module.json` and zip are live.
- Anything a new script needs must be inside one of the zipped folders. Add new entry scripts to `esmodules`; files they
  import (like `scripts/lib/`) don't need listing.

## Editing the compendium

Foundry reads compendiums only as LevelDB folders, built from `src/packs/` by `npm run build` (run `npm install` first).
Edit the JSON in `src/packs/` directly; `npm run build` then writes `packs/`, which can be loaded in Foundry for
testing. `npm test` checks the source.

When items are edited in Foundry instead:

- With access to the built pack folder (a local Foundry install), `npm run unpack -- <path to the pack folder>` updates
  the JSON source from it.
- Otherwise (for example on The Forge), use the item's "Export Data" and replace its file in `src/packs/` with the
  export. Exports have no `_key`, which `npm run build` adds from the item's `_id`; keep the `_id` the item had.

Scripts refer to compendium items by ID, so never change existing IDs. The UUID prefix is
`Compendium.evan-character-homebrew.evans-character-homebrew.Item.`. IDs in use:

- `UBwodLsLo9kNHtBJ` Manifest Will (spell); `pTHgvPpA9r18ZHO2` Aura: Manifest Will
- `9xjkgwwxe5NIKr4t` Arcane, `Ydg4REm5EQX3eua6` Divine, `zs66wcnBpWxSmvys` Occult, `DJJvRoc5yfNaraKe` Primal: the
  tradition effects the turn-start script hands out
- `f0BUHuiZLiODSsg3` Designate Witch's Charge

The scripts also rely on pf2e compendium IDs, which are the same in every pf2e version, for example Effect: Witch's
Charge (`ugeStF0Rj8phBPWL`) and the Sustain action (`3f5DMFu8fPiqHpRg`). Each script declares the ones it uses as
constants at the top.

## Code conventions

- Format with Prettier, print width 120 and tab width 4, matching the existing scripts.
- Code against pf2e's real APIs, checked in its source for every supported version: `foundryvtt/pf2e` branches `v13-dev`
  (pf2e 7.x) and `v14-dev` (pf2e 8.x). Don't rely on memory for pf2e internals.
- Players can't edit creatures they don't own. When a change has to reach another creature, the user's client asks the
  active GM over the module socket (`module.evan-character-homebrew`), as the existing socket actions do.
- Scripts react to Sustains through `game.modules.get(MODULE_ID).sustainHandlers`, which run one after another so their
  prompts don't overlap. Macro entry points go on `game.modules.get(MODULE_ID).api`.
- World settings live next to the feature they control, registered in that script's `init` hook.

## Other modules

The module must work on its own. Other modules are compatibility only: check `game.modules.get(id)?.active` and do
nothing when they're absent. Never add them as dependencies (`relationships.requires`); recommending them is fine.

- Sequencer and JB2A (free) play the animations, using JB2A file paths that exist in the free pack.
- PF2e Toolbelt's Target Helper rolls saves without save messages, so spell conditions and Manifest Will's flat check
  also read its card flags and its `pf2e-toolbelt.rollSave` hook.
- PF2e HUD's spell sidebar gets the Sustain icon.
- PF2e Flat Check rolls only for conditions; Manifest Will's distance-based concealment is handled here instead.

## Rules

Follow the rules as written by default. Where a table plays differently, add a world setting for it rather than changing
the default: see "Manifest Will (Divine): allies only" and "Familiar of Ongoing Misery: once per condition". Ongoing
Misery's default (prolong on every hex) reflects how the table plays now, pending the GM's decision.

## Testing

Run `npm test` and `npm run build` before pushing. There's no Foundry instance in this environment. Test against pf2e's
real data (cloned from `foundryvtt/pf2e`) in Node, with stand-ins for Foundry objects and jsdom for HTML, exercising the
actual scripts end to end. Run the parser over every spell with a save when changing it. Say clearly in summaries and
PRs that changes weren't run in Foundry.
