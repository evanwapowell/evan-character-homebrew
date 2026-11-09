/**
 * Counteracting's rules (Player Core, "Counteracting"), with no Foundry dependencies so they can be run in Node.
 *
 * - An effect's counteract rank is its rank if it's a spell, or else half its level rounded up (minimum 0).
 * - The counteract check is compared to the target's DC: its caster's spell DC for a spell, the DC in its stat block
 *   (like an affliction's), or else the DC for its level.
 * - Critical success: counteract the target if its counteract rank is no more than 3 higher than yours. Success: no
 *   more than 1 higher. Failure: only if it's lower than yours. Critical failure: you fail to counteract it.
 */

const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** How much higher than yours the target's counteract rank can be, for each degree of success (null: never) */
const RANK_MARGIN = { criticalFailure: null, failure: -1, success: 1, criticalSuccess: 3 };

/** DCs by level (GM Core), as pf2e's `dc.ts` has them */
const DC_BY_LEVEL = new Map([
    [-1, 13],
    [0, 14],
    [1, 15],
    [2, 16],
    [3, 18],
    [4, 19],
    [5, 20],
    [6, 22],
    [7, 23],
    [8, 24],
    [9, 26],
    [10, 27],
    [11, 28],
    [12, 30],
    [13, 31],
    [14, 32],
    [15, 34],
    [16, 35],
    [17, 36],
    [18, 38],
    [19, 39],
    [20, 40],
    [21, 42],
    [22, 44],
    [23, 46],
    [24, 48],
    [25, 50],
]);

/** The DC for a level, as pf2e's `calculateDC`: with proficiency without level (`pwol`), the level is taken off */
function levelDC(level, { pwol = false } = {}) {
    const dc = DC_BY_LEVEL.get(Math.trunc(Number(level))) ?? 14;
    return pwol ? dc - Math.max(Math.trunc(Number(level)) || 0, 0) : dc;
}

/** The DC for a spell rank: the DC for level 2 × rank − 1, as pf2e's `calculateSpellDC` */
function spellRankDC(rank, options = {}) {
    return levelDC(Math.trunc(Number(rank)) * 2 - 1, options);
}

/** A counteract rank from a level: half the level rounded up, and at least 0 */
function rankFromLevel(level) {
    const value = Math.ceil(Number(level) / 2);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The degree of success of a check against a DC: 10 or more over is a critical success, 10 or more under a critical
 * failure, and a natural 20 or 1 moves the result one step up or down. Returns one of OUTCOMES.
 */
function degreeOfSuccess({ total, natural = null, dc }) {
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (natural === 20) degree = Math.min(3, degree + 1);
    else if (natural === 1) degree = Math.max(0, degree - 1);
    return OUTCOMES[degree];
}

/** The highest counteract rank a check with this degree of success counteracts (null: none) */
function maxCounteractedRank(outcome, rank) {
    const margin = RANK_MARGIN[outcome];
    return margin === null || margin === undefined ? null : rank + margin;
}

/** Whether a check with this degree of success, at counteract rank `rank`, counteracts a target of `targetRank` */
function counteracts(outcome, rank, targetRank) {
    const max = maxCounteractedRank(outcome, rank);
    return max !== null && targetRank <= max;
}

/**
 * What a degree of success counteracts, for a roll's notes and the result card: "counteracts rank 4 or lower", "fails"
 */
function describeReach(outcome, rank) {
    const max = maxCounteractedRank(outcome, rank);
    if (max === null || max < 0) return "counteracts nothing";
    return `counteracts rank ${max} or lower`;
}

/** A counteract rank stated in a text, like "a counteract rank of 4" or "counteract rank 10" */
function rankFromText(text) {
    const match = String(text ?? "").match(/counteract rank (?:of |is )?(\d+)/i);
    return match ? Number(match[1]) : null;
}

export {
    OUTCOMES,
    counteracts,
    degreeOfSuccess,
    describeReach,
    levelDC,
    maxCounteractedRank,
    rankFromLevel,
    rankFromText,
    spellRankDC,
};
