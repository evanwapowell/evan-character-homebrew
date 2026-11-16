# Evan's Character Homebrew

A Foundry VTT module of homebrew content and automations for the Pathfinder 2e (pf2e) system, used at Evan's tables. It
supports Foundry v13 and v14 (pf2e 7.x and 8.x); v12 is no longer supported.

## Layout

- `module.json`: the manifest. Scripts are listed under `esmodules`; `"socket": true` is needed for the GM hand-offs
  below.
- `src/packs/evans-character-homebrew/`: the compendium's source, one JSON file per item, in folders matching the
  compendium's folders (see "Editing the compendium"). `packs/` is built from it and isn't committed.
- `scripts/*.js`: plain ES modules loaded by Foundry, with no build step.
    - `settings.js`: the Features settings menu (Configure Settings → this module → Configure Features), with an
      on/off switch for each feature and the features' own settings, and the helpers the other scripts import:
      `featureHooks` (with `onTurnStart` and `onTurnEnd` from `lib/turns.js`), `isEnabled`, `guardApi`, `canAnimate`,
      for the Finch version, `canAnimateFinch` and `isFinchVersion`, from `lib/session.js`, `confirmActiveGM`,
      `confirmPrimarySession`, `createdHere` and `hasModuleData` (and `isActiveGM` and `isPrimarySession`, for tests),
      and from `lib/gm.js`, `askGM`, `onGMRequest`, `warnGM`, `refuse`, `owns` and `isAuthor`.
    - `lib/session.js`: a user (the GM especially) can be connected more than once, in two windows or on two devices,
      and each session runs the hooks. A user's sessions announce themselves over the module socket (whether they're
      shown, and the scene they view), and one of them is chosen to act for the user: for work on a scene, one viewing
      it, then a shown one, then the oldest. Work reaches every session; each waits until it has heard from the
      others, and one that isn't chosen asks the chosen one whether it's there and takes over when it doesn't answer
      within 2 seconds. Messages and items are marked with the session that created them.
    - `lib/gm.js`: work a player's client hands to the active GM. `askGM(action, data, { title, task })` sends the
      request with an ID on the module socket and waits: the GM session that acts (`confirmActiveGM`) answers that it
      took the request (within 10 seconds), then that it's done (within 60), with what the handler registered by
      `onGMRequest(action, handler, { check })` returned, or its error. It resolves to `{ ok: true, result }` or
      `{ ok: false, reason }` ("absent": no GM logged in; "unanswered"; "refused"; "failed"), warning the user when
      `title` is given (`warnGM` for a warning of one's own). A GM's own requests run in their session. Requests keep
      each action's payload, so a GM session on an earlier version still does the work during an update. The GM's
      session doesn't take a player's data on trust: Foundry gives the socket's listeners the sender's user ID (pf2e's
      own socket reads it), and a request from a player goes through the action's `check(data, sender)` first, which
      reads again from the documents what it can (a save's outcome from its message, a range from the tokens, a rank
      from the item), checks the player owns the creature acting (`owns`) and made the message (`isAuthor`), and
      `refuse(reason)`s a request that doesn't match its feature (logged with one `console.warn`, and answered
      "refused"). It returns the data the handler gets; the handler gets `(data, sender)`. A GM's requests skip it.
    - `lib/geometry.js`: distances between tokens from their documents (`spaceOf`, `distanceBetween`, `tokenDistance`),
      as pf2e counts them on a square grid, for checks on a scene the GM's session isn't viewing.
    - `lib/saves.js`: a save a player's client reports, read again where it was rolled: `reportedSaveMessage` (their
      save message, for a creature they own) or `reportedToolbeltSave` (PF2e Toolbelt's result on the card,
      `toolbeltSave`).
    - `lib/turns.js`: the turns of an encounter. A combat update also arrives when the turn order goes back, and when
      the turn's index shifts under the creature whose turn it is (a combatant added, removed or moved in the order),
      so it reads what an update did, once for every script: the turn that ended and the turn that started, only going
      forward, and once per creature per round by the module's own record on the combatant
      (`flags.evan-character-homebrew.turn`: the rounds its turn last started and ended in; pf2e's `roundOfLastTurnEnd`
      is also written when a round goes back, so it isn't used). The active GM's work registered with `onTurnEnd` runs
      first, then `onTurnStart`'s, each awaited, one turn change after another, in the session chosen for the turn's
      scene.
    - `manifest-will.js`: the Manifest Will aura's turn-start effects (removed at the creature's next turn start, when
      it leaves the encounter, or when the encounter ends), concealment flat checks, cast animations, and re-centering
      on a seneschal's charge.
    - `sustain.js`: the Sustain buttons (actor sheet and PF2e HUD), reposting the spell's card, and ending sustained
      effects that weren't Sustained. pf2e's Sustain action prompts with the caster's sustained spells on any creature
      in the scene (buffs on allies included), one entry per casting (the effects sharing a spell and pf2e's start, and
      pf2e's copies of an aura's effect with the aura); a spell's Sustain button asks which casting when there are two.
      An NPC's spell, or an unidentified effect, ending for not being Sustained is whispered to the GM. At the start of
      a player's creature's turn in an encounter, the active GM posts a chat reminder whispered to its owners listing
      its sustained spells, each with a Sustain button (it shows Sustained or Ended as that changes).
    - `ongoing-misery.js`: Familiar of Ongoing Misery.
    - `lib/casting.js`: whether a spell's card is from casting it or only sent to chat (`isSpellCast`). pf2e marks a
      cast from 8.5.0 (`origin:action:slug:cast-a-spell` in the card's `flags.pf2e.origin.rollOptions`); before that
      the two can't be told apart, so the hex familiars take any card from a spellcasting entry for a cast, and
      Protector Tree and Sepulchral Mask fall back on the card's button or the effect's drag.
    - `lib/items.js`: `findItems(test)`, the items passing `test` on every creature in the world (world actors, and
      unlinked tokens on every scene), without building the actor of an unlinked token that holds none: an unbuilt
      token (pf2e's `hasConstructedActor`) is read from its source's delta items, so `test` reads only what items and
      sources share (`type`, `name`, `flags`, `system`, `_stats`). Never loop over every token's `actor`.
    - `lib/names.js`: a creature's name as players may see it, by pf2e's rule (`playersCanSeeName`: "Token name
      visibility" off, or the token's nameplate shown to anyone, or a party member). `nameForPlayers` (the token's name
      or "the creature") for text only players read, `nameForUser` for a dialog, and `nameMarkup` (or `forPlayers` for
      other text) in a message everyone reads: the name, replaced with the stand-in when a player's session renders it,
      as pf2e does for damage taken. Public text names the token, never the actor.
    - `lib/serially.js`: `serially(key, work)` runs work on one thing (a card) after the work queued before it, so two
      saves for one card arriving together are applied in turn (Extract Element, Parasitic Might).
    - `witch-charge.js`: the Designate Witch's Charge action. The active GM gives each target Effect: Witch's Charge
      with the witch as origin, then removes the witch's earlier charges, then posts the card. A charge without an
      origin (dragged from the compendium) is removed only when the witch is the only world actor with the Witch's
      Charge feat; otherwise it's left, and the GM is told in a whisper.
    - `extract-element.js`: the kineticist's Extract Element action: checks the target, applies the save's result
      (damage, and Effect: Extract Element with the impulse bypasses: each resistance entry but a custom one, and
      immunities), once per use (recorded on the card after the damage is dealt), plays each element's animation, and
      ends the effects when the kinetic aura ends.
    - `protector-tree.js`: Timber Sentinel (wood kineticist) and the Protector Tree spell it casts. Using the impulse
      (or casting the spell, which pf2e 8.5 marks; otherwise the card's Place Tree button) has its user pick a square
      within 30 feet; the active GM makes the tree, a hazard actor (AC 10, 10 HP per rank: half the kineticist's level
      rounded up, or the cast rank) in a "Protector Trees" folder, owned by the caster's players, at the caster's
      elevation, once per card (the card's button stays disabled until it's placed), and gives the caster Effect:
      Protector Tree (1 minute). pf2e's `applyDamage` is wrapped (through libWrapper when it's active): damage from a
      Strike (told by its roll options, not its item) that hits an ally of the caster (not the caster) adjacent to the
      tree (a Tiny creature measured from its whole square, as pf2e does) goes to the tree first, and the ally takes
      only what's left after the tree reaches 0 HP, keeping its damage types, materials and its share of precision and
      splash damage and of a critical hit's doubling. Splash damage only (also at half or double) isn't taken. At 0 HP
      the tree's token
      and actor are removed; when the effect ends otherwise (duration, or the impulse used again), it stays as an
      ordinary tree, and deleting its token removes its actor.
    - `sepulchral-mask.js`: Sepulchral Mask (psychopomp sorcerer): puts Aura: Sepulchral Mask on the caster when the
      spell is cast (pf2e 8.5 marks real casts) or when pf2e's spell effect is dragged from the card, posts a card for
      each enemy that starts its turn in the emanation (the caster rolls the damage, or the GM for them, the creature
      its Will save; players see an NPC caster's DC only when pf2e shows DCs), and applies the damage and Will penalty
      for the save's result. A save from a turn card the GM deleted is applied nowhere.
    - `parasitic-might.js`: Familiar of Parasitic Might (Devourer of Decay witch): on a hex's Cast or Sustain, the witch
      picks a creature within 15 feet of the familiar below half its Hit Points, and a card from the familiar has it
      roll a Fortitude save against the witch's spell DC; a failure makes it sickened 1. Saves rolled from the box pf2e
      adds to hex cards are handled too.
    - `scroungers-glee.js`: Scrounger's Glee: adds Effect: Scrounger's Glee to the spell conditions' Apply button on a
      failed save (it keeps the target at frightened 1 or more while it isn't deafened), and when an ally critically
      succeeds at a Strike against the target, asks the caster's user whether to Dismiss the spell to heal that ally.
    - `spirit-stitched-familiar.js`: Spirit Familiar's Shed Spirit and Stitched Familiar's Stitching Strike (witch
      feats; the familiar's activities). pf2e's card has a save link with no DC, so using the action (from the
      familiar, or the witch) has its user pick an enemy in range (their target, when it's in range), rolls the damage
      ((6 + 2 per 2 levels past 8)d6) and posts a card with a button for the enemy's save against the witch's spell
      DC. The active GM applies the damage for the result (once: a reroll is left to adjust by hand). Stitching Strike,
      on a failure or critical failure: Effect: Stitching Strike (immobilized, 1 round from the witch's turn), with an
      Escape link at the DC; a successful Escape against it (or with no DC, compared with it) ends the effect. Shed
      Spirit, once damage was dealt (HP and temporary HP lost): a button for the familiar's user to choose an ally
      within 30 feet of the enemy, and the GM restores half that. JB2A animations for each step, and fibers on the
      immobilized creature tied to the effect.
    - `rallying-charge.js`: Rallying Charge (marshal): after the marshal uses the feat, their next Strike is the
      charge's; when it's a melee Strike that hits and its damage is rolled against an enemy, each ally within 60 feet
      who can see the marshal (not blinded or unconscious, no sight-blocking wall between them) gets pf2e's Effect:
      Rallying Charge (Marshal) with the marshal as its origin, so it grants their Charisma modifier as temporary Hit
      Points until the start of their next turn. A miss, a ranged Strike or the end of the marshal's turn spends it.
      Damage rolled while viewing another scene leaves the charge active, to be rolled again on the marshal's scene.
    - `recall-knowledge.js` with `lib/recall-knowledge-facts.js`: Recall Knowledge about creatures, from pf2e's action
      or Basic Action Macros' (which rolls one d20 for every skill and Lore: each skill's modifier is worked out from
      its statistic without rolling, and a Lore is listed but isn't the default). The roller's player picks a question
      (or writes one); the GM gets a card with the degree of success against the creature's identification DCs (harder
      for each later attempt, counted again when the card is reviewed), reviews what's learned (success: name and
      answer; critical success: the lore entry too; critical failure: a name (the one already known, else a false one,
      else the true one) and a lie; Dubious Knowledge: the answer and a wrong answer to the same question) and sends it
      as a whisper. What's learned is recorded per creature, for the party or (world setting) only the character, by
      card (sending a card again replaces what it recorded; which facts are false stays on the GM's card, not in the
      world setting), and revealed in PF2E Bestiary Tracking. pf2e's reroll updates the card of the roll it replaces.
      Exploit Vulnerability's check is read too: its weaknesses by degree of success, off-guard on a critical failure
      (Effect: Exploit Vulnerability (Critical Failure)), and with Diverse Lore, Recall Knowledge's information. The
      facts library has no Foundry dependencies.
    - `spell-target-effects.js` with `lib/spell-effect-links.js`: an Apply button on the card of a spell without a save
      (Heroism, Stoke the Heart, Shield) for the spell effects it links. The caster checks which creatures get each
      effect: by default themselves for an aura (named "Aura:" or with an Aura rule, like Bless) or a spell with no
      targets or area, themselves and their allies in an emanation (Courageous Anthem), otherwise their targets or PF2e
      Toolbelt's. The effects are made as pf2e makes them when dragged from the card (`lib/spell-effect-source.js`:
      cast rank, caster as origin with the spellcasting, the spell's traits), so Sustain tracks them; for a creature
      the caster's player doesn't own, the player makes the effect's choices (ChoiceSet rules with a list, like Resist
      Energy's damage type) before the GM creates it, since pf2e asks whoever creates it. Once applied, the card is
      marked (`flags.evan-character-homebrew.spellTargetEffects.applied`): its button says Applied and nothing is
      checked when it's used again. The link parser picks the defaults (a heightened entry's version of the effect, a
      longer-lasting version where a heightened entry changes the duration (Darkvision (24 hours)), not a battle
      form's variants, amp or immunity effects) and has no Foundry dependencies.
    - `spell-conditions.js` with `lib/spell-condition-parser.js`: the "Apply" buttons that read a spell's text for a
      save result and apply its conditions. What the text gives later or only if something happens ("If it's asleep,
      it wakes up and is Paralyzed", Petrify's petrified) is offered unchecked. The parser has no Foundry
      dependencies, so it can be run in Node. What it applies records the spell, caster, rank and DC
      (`flags.evan-character-homebrew.spellSource`), for Counteract. A timer that ends at the target's own next turn
      ("until its next turn begins", "until the end of its next turn") is an effect with the target as origin, of the
      rounds pf2e's expiry needs when it's created: 0 when the target's turn is still to come this round (pf2e ends an
      effect at its origin's turn only once its rounds are up, and time moves on with the round), 1 when it has acted,
      on its own turn (unless the timer is "for that turn") or outside an encounter. A condition with a value the text
      doesn't give as a number ("drained [[/r 1d4]]") asks for it, and isn't applied without one. Spell effects are
      made as pf2e makes them when dragged from the save's message (`lib/spell-effect-source.js`). A save against a
      spell cast from a scroll or wand finds its spell on the cast's card (pf2e's save message can't). Whom it was
      applied to is recorded on the message (`flags.evan-character-homebrew.spellConditions.applied`), so the button
      says Applied and the dialog checks nothing for them again.
    - `counteract.js` with `lib/counteract-rules.js`: counteracting. pf2e's Counteract button on spell cards (spells
      with `system.counteraction`, like Dispel Magic) only rolls the check; this takes it over (removing its
      `data-action` in `renderChatMessageHTML`, which runs before pf2e attaches its listeners). The caster checks what
      to counteract on their targets: a spell's effects and conditions from one casting (rank cast at, caster's spell
      DC), an aura's effects at their source (an aura from an ability, not an effect, is reported, not removed: pf2e
      would give its effects back), other effects (half their level, DC for their level), afflictions (their DC),
      conditions, the creature itself or something else (both reported, not removed). Unknown ranks are typed in, a DC
      left blank is the DC for the rank, and DCs of NPCs' spells are hidden from players unless pf2e shows DCs, as are
      the rank and DC worked out from an NPC's level (its own, or an effect's on it). Players aren't shown effects pf2e
      keeps unidentified, or names behind nameplates they can't see (`lib/names.js`). The check is rolled through pf2e's
      counteract statistic (against the DC, for one target) with an identifier, and when its message arrives, what's
      counteracted is removed (through the active GM for creatures the user doesn't own) and a result card is posted; a
      reroll updates the card. A blind roll's card is posted by the active GM, whispered to the GMs, and what it
      counteracts is ended from the card's button. Counteract rolls made otherwise (an item's `[[/r 1d20+N
      #Counteract]]`, a counteract `@Check`) get a button to resolve them the same way, and `api.counteract()` is a
      macro that rolls with the selected creature's spellcasting, a skill or a set modifier. The rules library has no
      Foundry dependencies.
- `scripts/lib/finch.js` and `animations/finch/`: the "Finch version" (a world setting in the menu's Module section, on
  by default): custom animations made for one character, a changeling witch whose theme is lost things, in place of
  JB2A's. Manifest Will (divine, occult and primal; arcane keeps JB2A's): an intro that builds the aura, then a seamless
  loop, played by Sequencer attached to the token and tied to the aura effect, whose own texture is removed (without
  Sequencer, or when the session creating the aura isn't viewing its scene and so plays nothing, the loop becomes the
  aura's texture). Familiar of Ongoing Misery: a wisp that drifts from the familiar, then a marionette's control bar
  drawing a fey sigil up out of the creature. They need Sequencer but not JB2A. `tools/check.mjs` checks every file the
  scripts play from the module exists.
- `art/finch/`: the Finch animations' source (Gemini-painted sprites, the Blender scenes that render them, and the
  export to WebM with alpha); not part of the release.
- `token-subjects/`: token art.
- `tools/packs.mjs` and `tools/check.mjs`, run with npm (`package.json`): build or unpack the compendium, and check the
  module (see "Testing"). `tools/fetch-pf2e.mjs`, `tools/pf2e-data.mjs` and `tools/parse-spells.mjs` fetch pf2e's
  spells at the commits pinned in `tools/pf2e.json` and run the spell parsers over them.
- `tests/`: run by `npm test`, not part of the release: unit tests for the libraries with no Foundry dependencies, the
  spell parsers' baselines over pf2e's spells (`tests/baselines/`), and tests of the real scripts on a Foundry
  stand-in (`tests/harness/`).
- `.github/workflows/ci.yml`: runs `npm test` (with pf2e's data fetched and cached) and `npm run build` on every pull
  request.
- `.github/workflows/release.yml`: builds and publishes releases (see below).

## Releases and workflow

- A push to `main` publishes a release when `module.json`'s version hasn't been released yet: the workflow fetches
  pf2e's data for the spell baselines, runs `npm test`, builds the compendium, points the manifest's `download` at this
  version's release, zips `module.json`, `packs/`, `scripts/`, `token-subjects/` and `animations/`, and publishes
  them as the latest release, tagged with the version. Foundry's manifest URL points at the latest release. Other
  branches, and pushes that don't bump the version, publish nothing, and an existing release is never overwritten.
- So bump `version` in `module.json` with every change to the module (the workflow fills in `download`): the middle
  number for a new feature (1.12.0 → 1.13.0), the last for a fix or small tweak (1.13.0 → 1.13.1). Changes outside the
  zipped files (like this file) don't need a bump.
- When a change is done and tested, open a PR to `main` and merge it once its checks pass (the Checks workflow runs
  `npm test` and `npm run build` on every PR), so the release goes out. Then check that the release's `module.json` and
  zip are live.
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

Link pf2e's items by ID, in rule elements and in descriptions (`Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL`,
not `...Item.Frightened`): pf2e's own source uses names, but only its build turns them into IDs, and a name doesn't
resolve in Foundry.

Scripts refer to compendium items by ID, so never change existing IDs. The UUID prefix is
`Compendium.evan-character-homebrew.evans-character-homebrew.Item.`. IDs in use:

- `UBwodLsLo9kNHtBJ` Manifest Will (spell); `pTHgvPpA9r18ZHO2` Aura: Manifest Will
- `9xjkgwwxe5NIKr4t` Arcane, `Ydg4REm5EQX3eua6` Divine, `zs66wcnBpWxSmvys` Occult, `DJJvRoc5yfNaraKe` Primal: the
  tradition effects the turn-start script hands out
- `f0BUHuiZLiODSsg3` Designate Witch's Charge
- `otpFtLUFZlVa0nhn` Effect: Extract Element
- `yHoBoom9axaemxWS` Effect: Protector Tree
- `JZzkqIbry9lR8y0P` Aura: Sepulchral Mask; `GOsDZYg9DXFPhzwg` Effect: Sepulchral Mask (the enemies' penalty)
- `AxUfnmwrn1XTPTNU` Effect: Scrounger's Glee
- `4vnb6uF59O5c4qNh` Effect: Stitching Strike
- `1rKbOmjn488MljOU` Effect: Exploit Vulnerability (Critical Failure)

The scripts also rely on pf2e compendium IDs, which are the same in every pf2e version, for example Effect: Witch's
Charge (`ugeStF0Rj8phBPWL`), the Sustain action (`3f5DMFu8fPiqHpRg`), Extract Element (`low5ORd87QeA9Oug`), Timber
Sentinel (`aHlcMMNQ85VLK7QT`) and Protector Tree (`K9gI08enGtmih5X1`), and Sepulchral Mask (`3mINzPzup2m9qzFU`) with its
Spell Effect (`TER4qOsYPTszhhDG`), Devourer of Decay (`T9wA833bzZVlB3Lo`), Familiar of Parasitic Might
(`J5Wyh1EPmk848ivR`), Scrounger's Glee (`VNv96dJPi0WXKSFN`), Shed Spirit (`uruoG0PuuA0CqEG7`), Stitching Strike
(`PTEiTXsObvtke43x`), Rallying Charge (Marshal) (`df4cBV3qZn3qNUmP`) with its Effect (`wjNNHgX6ceKLbn8Q`), and Exploit
Vulnerability (`fodJ3zuwQsYnBbtk`). Each script declares the ones it uses as constants at the top.

## Code conventions

- Format with Prettier (`.prettierrc`: print width 120, tab width 4); `npm run format` formats the scripts, tools and
  tests, and `npm test` fails on unformatted code.
- Code against pf2e's real APIs, checked in its source for every supported version: `foundryvtt/pf2e` branches `v13-dev`
  (pf2e 7.x) and `v14-dev` (pf2e 8.x). Don't rely on memory for pf2e internals.
- Players can't edit creatures they don't own. When a change has to reach another creature, the user's client asks the
  active GM with `askGM`, and the script registers the GM's side with `onGMRequest` at its top level; don't use the
  module socket directly. Record the work as done (on a card, in a flag) only when the answer is `ok`, and return from
  the handler what the asker needs to know (Counteract's handler returns what it removed). Every `onGMRequest` gives a
  `check`, since anyone can send any data on the socket: send what the GM can read again (the save's or roll's message
  ID, the card's ID) and have the check derive the rest from the documents (outcome, rank, range, allegiance, who owns
  the creature acting), not from the payload, and build chat text on the GM's side from names.
- A user can have more than one session, so check `await confirmActiveGM()` for the active GM's work, never
  `game.user === game.users.activeGM`, and `createdHere(document, options, userId)` in `createChatMessage` and
  `createItem` hooks, never `userId === game.user.id`. Work given to a user (a prompt for whoever answers for a
  creature) checks `await confirmPrimarySession()`. Both can wait seconds, and may ask the user's other sessions over
  the socket, so check first that the hook or request is the feature's (cheap tests before them), and pass `{ scene }`
  for work measured on a scene's canvas. In scripts, `isActiveGM()` and `isPrimarySession()` (what the session knows
  now, without waiting) aren't used for work.
- Work at the start or the end of a creature's turn is registered with `featureHooks(id).onTurnStart(handler)` or
  `onTurnEnd(handler)`, never read from `updateCombat`: the handler gets `{ combat, combatant, round }` for the turn
  (the combat may have moved on), runs in the active GM's session for the turn's scene (already confirmed), and is
  awaited, the end of a turn before the start of the next.
- Every chat message carries the session mark in this module's flags, so `message.flags[MODULE_ID]` is always set.
  To tell whether a message is one of the module's own, test a named key or `hasModuleData(message)`.
- Scripts react to Sustains through `game.modules.get(MODULE_ID).sustainHandlers`, which run one after another so their
  prompts don't overlap. They add spell effects to the spell conditions' Apply button through `spellEffects`
  (`(spell, outcome) => [effect UUIDs]`). Macro entry points go on `game.modules.get(MODULE_ID).api`.
- Every feature can be turned off in the Features menu. A new feature gets an entry in `FEATURES` in
  `scripts/settings.js` (its switch is registered there), registers its hooks with `featureHooks("<id>")` (cleanup
  hooks, like ending effects, can stay on `Hooks.on`), and checks `isEnabled` in its Sustain handlers and
  `spellEffects`; macro entry points are wrapped in `guardApi`. Animations check `canAnimate()`.
- World settings live next to the feature they control, registered in that script's `init` hook with `config: false`,
  and are listed in the feature's `settings` in `FEATURES` so the menu shows them. Keep existing setting keys, so saved
  values carry over.

## Other modules

The module must work on its own. Other modules are compatibility only: check `game.modules.get(id)?.active` and do
nothing when they're absent. Never add them as dependencies (`relationships.requires`); recommending them is fine.

- Sequencer and JB2A (free) play the animations, using JB2A file paths that exist in the free pack.
- PF2e Toolbelt's Target Helper rolls saves without save messages, so spell conditions and Manifest Will's flat check
  also read its card flags and its `pf2e-toolbelt.rollSave` hook.
- PF2e HUD's spell sidebar gets the Sustain icon.
- libWrapper, when active, wraps pf2e's `applyDamage` for Protector Tree; without it the method is wrapped directly.
- PF2e Flat Check rolls only for conditions; Manifest Will's distance-based concealment is handled here instead.
- PF2e Workbench's Basic Action Macros rolls Recall Knowledge with its own macro: a whispered table and a bare d20, with
  no statistic or degree of success, so Recall Knowledge works each skill's modifier out with a roll that isn't posted.
- PF2E Bestiary Tracking has no API for adding a creature: its Add Monster macro adds the GM's first target, which it
  reads before its first `await`, so Recall Knowledge runs it with the creature standing in as the GM's only target.
  Reveals are updates to the creature's journal page, followed by the module's `UpdateBestiary` socket event.

## Rules

Follow the rules as written by default. Where a table plays differently, add a world setting for it rather than changing
the default: see "Manifest Will (Divine): allies only" and "Familiar of Ongoing Misery: once per condition" in the
Features menu. Ongoing
Misery's default (prolong on every hex) reflects how the table plays now, pending the GM's decision.

## Testing

Run `npm test` and `npm run build` before pushing; the Checks workflow runs them again on every PR. `npm test` runs:

- `tools/check.mjs`: the manifest, every script's syntax, the files the scripts play, the compendium source, and the
  conventions above that reading the files can confirm: relative imports resolve to files that export each name, every
  top-level script is in `esmodules`, no test of the bare `flags[MODULE_ID]` on a message, no comparing `game.user`
  with `game.users.activeGM` or `userId` with `game.user.id` outside `lib/session.js`, no `isActiveGM()` or
  `isPrimarySession()` in `scripts/` (`confirmActiveGM()` and `confirmPrimarySession()` instead), no direct use of the
  module socket in `scripts/` outside `lib/session.js` and `lib/gm.js` (`askGM` and `onGMRequest`), every
  `onGMRequest` in `scripts/` with a `check`, no `updateCombat`
  hook in `scripts/` outside `lib/turns.js` (`onTurnStart` and `onTurnEnd`), compendium links (in `src/packs/` and
  string literals in `scripts/`) end in a 16-character ID, and the module's own items the scripts use exist in
  `src/packs/`.
- Prettier's check.
- The unit tests in `tests/` (`*.test.js`, Node's built-in `node:test` runner), for the libraries with no Foundry
  dependencies: `counteract-rules`, `recall-knowledge-facts`, `spell-effect-links` and `spell-condition-parser`. A
  change to one of these libraries adds or updates its tests.
- The spell parsers over all of pf2e's spells (`tests/spell-baselines.test.js`): both parsers' output for every spell
  (with a save for `spell-condition-parser`, without one for `spell-effect-links`; this module's spells too) at the
  pf2e commits pinned in `tools/pf2e.json`, compared with the baselines in `tests/baselines/`, with a readable diff per
  spell. The baselines record today's output, wrong results included, so a parser fix changes them in the same PR:
  run `npm run test:update-baselines` and commit the baselines, so the change is reviewed spell by spell.
  `tests/spell-expectations.test.js` holds results written by hand for common spells that must stay right (Fear,
  Slow, Heroism, battle forms and others); add a spell there when a fix makes it right. Both need pf2e's data:
  `npm run fetch-pf2e` (`tools/fetch-pf2e.mjs`) makes a shallow, sparse clone of the pinned commits into
  `.cache/pf2e/` (git-ignored). Without it the tests are skipped locally; CI caches the data by the pinned commits
  and always runs them. To move to newer pf2e data, change the commits in `tools/pf2e.json`, fetch, update the
  baselines and review their diff. `node tools/parse-spells.mjs` runs the parsers without writing anything.
- Tests of the real scripts on a Foundry stand-in (`tests/harness/`): `foundry.mjs` fakes the globals the scripts touch
  (`Hooks`, `game` with users, settings, modules, the module socket (its listeners get the sender's user ID, as
  from Foundry's server) and messages, `ui.notifications`, `foundry.utils`,
  `ChatMessage.create` running `preCreateChatMessage` and then `createChatMessage` in every session, `fromUuid`, `Roll`
  (each die rolls its middle; `toMessage` reads `rollMode` on v13 and `messageMode` on v14, as Foundry does), and jsdom
  for `document` and `DOMParser`); `pf2e.mjs` builds pf2e-shaped actors, items, effects, scenes, tokens, encounters and
  chat messages, following pf2e's source (each builder names its file). `createWorld({ users, version, systemVersion })`
  (Foundry "v13" or "v14", and pf2e's exact version) then `world.connect(userId, { scripts })` opens a session with its
  own copy of the scripts and globals, so one user can be connected twice; `session.run(fn)` runs code as that session,
  `session.scripts[name]` has the script's exports, `world.flush()` delivers socket messages, and `useFakeTimers(t)`
  gives fake timers that keep each session's own. `session.setShown`, `session.viewScene(scene)`, `session.disconnect({
  silently })`, `session.latency` (socket messages to and from it are delivered that many milliseconds later, on the
  timers) and `session.unreachable` (socket messages to and from it are lost while its user stays active: a frozen
  window) set up the session cases. Actors made with `makeActor(world, { owners })` are owned by GMs and those users, as
  the running session sees it, and have `createEmbeddedDocuments`, `deleteEmbeddedDocuments` and the auras of their
  effects' Aura rules (their tokens' `auras` have `containsToken`); items have `update` (an effect's as pf2e's
  `_preUpdate` fills a duration's expiry) and `delete`, and messages `update`, which come back a tick later, as from
  the server. Scenes are in `game.scenes`, on a 100-pixel, 5-foot square grid. `addToken` makes a linked token, or with
  `{ unlinked: true, deltaItems }` an unlinked one whose own actor is built only when `actor` is read (`builds` counts
  them; until then `hasConstructedActor` is false and `_source.delta.items` has its items). Collections iterate their
  values, as Foundry's do. `CONFIG.Actor.documentClass.prototype.applyDamage` can be wrapped, and records what reaches
  it on the actor it's called on (`damageApplied`); `CONST` and `Folder.create` are Foundry's.
  `spellCard(world, spell, { actualCast })` is a spell's card, marked as cast where the pf2e version does, and
  `embeddedSpellCard(world, actor, spell)` a scroll or wand's spell with its card (the spell's UUID finds nothing, as in
  pf2e). Actors have pf2e's `alliance` and `isAllyOf`, and `game.pf2e.Predicate` tests plain roll options.
  Tokens have pf2e's `playersCanSeeName` (from their `displayName`), and `world.pf2eSettings` holds pf2e's settings
  the scripts read (`tokens.nameVisibility`, `metagame.dcs`).
  `makeCombat(world, { scene, combatants })` is an encounter: `startCombat`, `nextTurn`, `previousTurn`,
  `removeCombatant` and `setInitiative` send the updates Foundry and pf2e send (the turn's index shifting included), and
  pf2e's turn records are written on the combatants after each, on pf2e 7.x's conditions. The world's time
  (`game.time.worldTime`) moves 6 seconds with each round, and an effect made with `createEmbeddedDocuments` starts at
  it and expires as pf2e's do (`remainingDuration`, pf2e's `calculateRemainingDuration`); expired effects stay on their
  actor. `addSkills(actor, skills)` gives a creature pf2e's skill statistics (`withRollOptions`, a `check` whose
  modifiers are tested against roll options, `roll` recorded in `actor.skillRolls`), totalled by
  `game.pf2e.StatisticModifier`. `tests/hidden-information.test.js` checks what players aren't shown (Counteract's levels, unidentified effects and
  names; names behind nameplates) with Counteract's ability auras and blind rolls, `tests/guards.test.js` checks that pf2e's messages reach the features and the module's
  own don't, `tests/session.test.js` the session helpers, `tests/gm-requests.test.js` the requests to the GM (with
  their checks: the sender, refusals, Counteract's removal),
  `tests/turns.test.js` the turns of an encounter with Manifest Will's and Sustain's work on them,
  `tests/sustain.test.js` what one Sustain keeps going (a casting, an aura's copies) and whom an ending is told,
  `tests/sepulchral-mask.test.js` the turn-start card's buttons and a save from a deleted card,
  `tests/manifest-will.test.js` Manifest Will's flat check, re-centering and Finch aura, `tests/hex-casts.test.js` casts
  told from cards sent to chat and the hex familiars on each, `tests/spell-conditions.test.js` the Apply button's
  timers, from a save's message through its dialog to the turn the effect expires at
  (`tests/spell-conditions-later.test.js`: what it offers unchecked; `tests/spell-conditions-apply.test.js`: applying
  once, scroll spells, values asked for, spell effects), `tests/spell-target-effects.test.js` the no-save Apply button
  (who gets each effect, choices, applying once), and `tests/recall-knowledge.test.js` Recall Knowledge from the check
  through the card's review to the whisper and the record (sending again, rerolls, attempts, Basic Action Macros' roll,
  names on critical failures), `tests/witch-charge.test.js` Designate Witch's Charge from the card through the GM's
  work, `tests/extract-element.test.js` the bypass rules, results applied once and the cleanup when the aura ends,
  `tests/parasitic-might.test.js` the save's result applied once, and `tests/protector-tree.test.js` what the tree takes
  (Strikes, splash, Tiny creatures, the remainder), growing it once at the caster's elevation, and a Strike through the
  wrapped `applyDamage`. Fix a hook-driven bug with a test here; export what a test needs from a script (a patch
  bump), or drive it through the hook, and add to the stand-in as tests need it.

There's no Foundry instance in this environment. Test against pf2e's real data (the fetched `.cache/pf2e/`, or cloned
from `foundryvtt/pf2e`) in Node, on the stand-in in `tests/harness/`, exercising the actual scripts end to end. Say
clearly in summaries and PRs that changes weren't run in Foundry.
