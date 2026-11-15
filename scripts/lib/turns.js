/**
 * The turns of an encounter. A combat update says only that the turn or the round changed. Going back through the turn
 * order arrives that way, and so does a creature keeping its turn at a new place in the order: Foundry commits the
 * turn's new index when a combatant is added or removed, and pf2e when initiative is set or the tracker is reordered
 * (EncounterPF2e#setMultipleInitiatives, src/module/encounter/document.ts). `turnChange` reads what an update did, once
 * for every script: the turn that ended and the turn that started.
 *
 * - Only when the turn order moved forward.
 * - Once per creature per round, by pf2e's own records on the combatant (`roundOfLastTurn` and `roundOfLastTurnEnd`,
 *   src/module/encounter/combatant.ts): pf2e starts or ends a turn only when the record isn't that round's. They're
 *   read as the update arrives, before pf2e writes this turn into them, so the module starts and ends a turn when
 *   pf2e does: Previous Turn and then Next Turn does neither.
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

/** pf2e's record of a combatant's turns: the round it last started one in, and the round it last ended one in */
function turnRecord(combatant) {
    const flags = combatant?.flags?.[game.system.id] ?? {};
    return { started: flags.roundOfLastTurn ?? null, ended: flags.roundOfLastTurnEnd ?? null };
}

/**
 * What a combat update did, read when it arrives (in the `updateCombat` hook, before anything is awaited): the turn that
 * ended and the turn that started, each `{ combatant, round }` or null, or null when it did neither.
 */
function turnChange(combat, changed) {
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

    const record = turnRecord(combatant);
    // Back on a creature in the middle of its turn (after Previous Turn, or when the order changed around it): the
    // creature that had its index in between didn't have a turn to end
    const midTurn = record.started === round && record.ended !== round;
    const ended = prior && !midTurn && turnRecord(prior).ended !== last.round;
    const started = combatant && record.started !== round;
    if (!ended && !started) return null;
    return {
        ended: ended ? { combatant: prior, round: last.round } : null,
        started: started ? { combatant, round } : null,
    };
}

/** Run a turn's work in the GM session that acts for its scene, and wait for all of it */
async function run(handlers, combat, { combatant, round }) {
    if (handlers.length === 0) return;
    const scene = combatant.token?.parent ?? combat.scene ?? null;
    if (!(await confirmActiveGM({ scene }))) return;
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

/** One turn change at a time, in the order the updates arrived */
let queue = Promise.resolve();

Hooks.on("updateCombat", (combat, changed) => {
    const change = turnChange(combat, changed);
    if (!change) return;
    queue = queue
        .then(async () => {
            if (change.ended) await run(endHandlers, combat, change.ended);
            if (change.started) await run(startHandlers, combat, change.started);
        })
        .catch((error) => console.error(`${MODULE_ID} | Turn`, error));
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

export { onTurnEnd, onTurnStart, turnChange };
