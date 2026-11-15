/**
 * The turns of an encounter. A combat update says only that the turn or the round changed. Going back through the turn
 * order arrives that way, and so does a creature keeping its turn at a new place in the order: Foundry commits the
 * turn's new index when a combatant is added or removed, and pf2e when initiative is set or the tracker is reordered
 * (EncounterPF2e#setMultipleInitiatives, src/module/encounter/document.ts). This reads what an update did, once for
 * every script: the turn that ended and the turn that started.
 *
 * - Only when the turn order moved forward.
 * - Once per creature per round, by the module's own record on the combatant (`flags.<module>.turn`: the round its
 *   turn last started in, and the round it last ended in), written by the GM session that does the turn's work. A turn
 *   starts when the record isn't that round's yet, and ends only when it started and hasn't ended. So Previous Turn
 *   and then Next Turn does neither, and a creature that got the current index when the order changed has no turn to
 *   end. pf2e's own end record isn't used: pf2e 7.x also writes it when the round goes back
 *   (EncounterPF2e#_onUpdate compares the turn's index alone).
 *
 * The work registered with `onTurnEnd` runs first, then `onTurnStart`'s, each awaited, and one turn change after
 * another. So the start of a turn sees what the end of the last one did: an aura that ended for want of a Sustain is
 * gone before the next creature is checked against it. It's the active GM's work, done by the session `confirmActiveGM`
 * picks for the turn's scene.
 */

import { confirmActiveGM } from "./session.js";

const MODULE_ID = "evan-character-homebrew";

const endHandlers = [];
const startHandlers = [];

/**
 * What a combat update moved, read when it arrives (in the `updateCombat` hook, before anything is awaited): the turn
 * it left and the turn it came to, each `{ combatant, round }` or null. Null when the turn order didn't move forward.
 */
function turnMove(combat, changed) {
    if (!combat?.started || !changed || !("turn" in changed || "round" in changed)) return null;
    const { previous, round, turn } = combat;
    const combatant = combat.combatant ?? null;
    const last = previous?.round === null || previous?.round === undefined ? null : previous;
    // Going back through the turn order ends and starts nothing
    if (last && (round < last.round || (round === last.round && (turn ?? -1) <= (last.turn ?? -1)))) return null;

    // Round 0 is the encounter before it began: nobody's turn
    const prior = last && last.round >= 1 ? (combat.combatants.get(last.combatantId ?? "") ?? null) : null;
    // The same creature's turn, at a new place in the order
    if (prior && prior === combatant && last.round === round) return null;
    if (!prior && !combatant) return null;
    return {
        combat,
        from: prior ? { combatant: prior, round: last.round } : null,
        to: combatant ? { combatant, round } : null,
    };
}

/** The rounds a combatant's turn last started and ended in, as the module recorded them */
function turnRecord(combatant) {
    const own = combatant.flags?.[MODULE_ID]?.turn;
    return { started: own?.started ?? null, ended: own?.ended ?? null };
}

/**
 * Whether a combatant's turn in a round is under way: it started and hasn't ended. Before the module has recorded
 * anything for the combatant (an encounter under way when the module was loaded or updated), pf2e's record of the round
 * it last started a turn in says whether it started (CombatantPF2e#roundOfLastTurn, src/module/encounter/combatant.ts).
 */
function isUnderWay(combatant, round) {
    const own = combatant.flags?.[MODULE_ID]?.turn;
    const started = own ? own.started : combatant.flags?.[game.system.id]?.roundOfLastTurn;
    return started === round && !(own?.ended >= round);
}

async function record(combatant, change) {
    try {
        const turn = { ...turnRecord(combatant), ...change };
        await combatant.update({ [`flags.${MODULE_ID}.turn`]: turn }, { render: false });
    } catch (error) {
        console.error(`${MODULE_ID} | Turn`, error);
    }
}

/** Run a turn's work, and wait for all of it */
async function run(handlers, combat, { combatant, round }) {
    await Promise.all(
        handlers.map(async (handler) => {
            try {
                await handler({ combat, combatant, round });
            } catch (error) {
                console.error(`${MODULE_ID} | Turn`, error);
            }
        }),
    );
}

/**
 * A move's work, in the GM session that acts for its scene: the turn it left ends when it started and hasn't ended,
 * then the turn it came to starts, unless it already has this round (or a later one, in a round gone back to). Each is
 * recorded before its work, so it isn't done twice.
 */
async function turnWork({ combat, from, to }) {
    const scene = (to ?? from).combatant.token?.parent ?? combat.scene ?? null;
    if (!(await confirmActiveGM({ scene }))) return;
    const present = (turn) => (turn && combat.combatants.get(turn.combatant.id) === turn.combatant ? turn : null);

    const ended = present(from);
    if (ended && isUnderWay(ended.combatant, ended.round)) {
        await record(ended.combatant, { started: ended.round, ended: ended.round });
        await run(endHandlers, combat, ended);
    }

    const started = present(to);
    if (started && !(turnRecord(started.combatant).started >= started.round)) {
        await record(started.combatant, { started: started.round });
        await run(startHandlers, combat, started);
    }
}

/** One turn change at a time, in the order the updates arrived */
let queue = Promise.resolve();

Hooks.on("updateCombat", (combat, changed) => {
    const move = turnMove(combat, changed);
    if (!move) return;
    queue = queue.then(() => turnWork(move)).catch((error) => console.error(`${MODULE_ID} | Turn`, error));
});

/**
 * The active GM's work when a creature's turn ends: `handler({ combat, combatant, round })`, with the turn's own
 * combatant and round (the combat has moved on). It's awaited before the next turn's start. Scripts register through
 * `featureHooks(id).onTurnEnd`, so the work stops while the feature is off.
 */
function onTurnEnd(handler) {
    endHandlers.push(handler);
}

/** The active GM's work when a creature's turn starts, after the work of the turn that ended: as `onTurnEnd` */
function onTurnStart(handler) {
    startHandlers.push(handler);
}

export { onTurnEnd, onTurnStart };
