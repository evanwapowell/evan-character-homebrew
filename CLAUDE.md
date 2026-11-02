# Evan's Character Homebrew

A Foundry VTT module of homebrew content and automations for the Pathfinder 2e (pf2e) system, used at Evan's tables. It
supports Foundry v13 and v14 (pf2e 7.x and 8.x); v12 is no longer supported.

## Layout

- `module.json`: the manifest. Scripts are listed under `esmodules`; `"socket": true` is needed for the GM hand-offs
  below.
- `packs/evans-character-homebrew/`: the compendium, a LevelDB database (see "Editing the compendium").
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
- `.github/workflows/main.yaml`: builds the release (see below).

## Releases and workflow

- Every push to any branch runs the workflow, which zips `module.json`, `packs/`, `scripts/` and `token-subjects/` and
  creates (or overwrites) the GitHub release named for `module.json`'s version. Foundry's manifest URL points at the
  latest release, so whatever is pushed is what tables get.
- So bump the version on every push that changes the module, in both `version` and the `download` URL: the middle number
  for a new feature (1.12.0 → 1.13.0), the last for a fix or small tweak (1.13.0 → 1.13.1). Changes outside the zipped
  files (like this file) don't need a bump; the release is rebuilt with the same contents.
- When a change is done and tested, open a PR to `main` and merge it, so the release goes out. Then check that the
  release's `module.json` and zip are live.
- Anything a new script needs must be inside one of the zipped folders. Add new entry scripts to `esmodules`; files they
  import (like `scripts/lib/`) don't need listing.

## Editing the compendium

Foundry reads compendiums only as LevelDB folders, so the pack in the repo is binary. To change it:

1. Copy `packs/evans-character-homebrew/` to a scratch folder: opening a LevelDB database rewrites its log files, so
   don't open the repo's copy directly.
2. In a scratch folder, `npm install @foundryvtt/foundryvtt-cli classic-level`, then use the CLI's `extractPack` to
   write the items out as JSON.
3. Edit the JSON, then use `compilePack` to build a new LevelDB folder.
4. Compare the old and new databases entry by entry (with `classic-level`) to confirm only the intended items changed,
   then replace the repo's pack folder with the new one.

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

There's no Foundry instance in this environment. Test against pf2e's real data (cloned from `foundryvtt/pf2e`) in Node,
with stand-ins for Foundry objects and jsdom for HTML, exercising the actual scripts end to end. Run the parser over
every spell with a save when changing it. Say clearly in summaries and PRs that changes weren't run in Foundry.
