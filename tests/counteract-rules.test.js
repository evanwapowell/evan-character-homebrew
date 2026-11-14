import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    counteracts,
    degreeOfSuccess,
    describeReach,
    levelDC,
    maxCounteractedRank,
    rankFromLevel,
    rankFromText,
    spellRankDC,
} from "../scripts/lib/counteract-rules.js";

describe("counteract ranks by degree of success", () => {
    it("critical success counteracts up to 3 ranks higher", () => {
        assert.equal(maxCounteractedRank("criticalSuccess", 4), 7);
        assert.ok(counteracts("criticalSuccess", 4, 7));
        assert.ok(!counteracts("criticalSuccess", 4, 8));
    });

    it("success counteracts up to 1 rank higher", () => {
        assert.equal(maxCounteractedRank("success", 4), 5);
        assert.ok(counteracts("success", 4, 5));
        assert.ok(!counteracts("success", 4, 6));
    });

    it("failure counteracts only a lower rank", () => {
        assert.equal(maxCounteractedRank("failure", 4), 3);
        assert.ok(counteracts("failure", 4, 3));
        assert.ok(!counteracts("failure", 4, 4));
    });

    it("critical failure counteracts nothing", () => {
        assert.equal(maxCounteractedRank("criticalFailure", 4), null);
        assert.ok(!counteracts("criticalFailure", 4, 0));
        assert.equal(describeReach("criticalFailure", 4), "counteracts nothing");
    });

    it("describes the reach of each degree", () => {
        assert.equal(describeReach("criticalSuccess", 2), "counteracts rank 5 or lower");
        assert.equal(describeReach("failure", 1), "counteracts rank 0 or lower");
        assert.equal(describeReach("failure", 0), "counteracts nothing");
    });

    it("an unknown outcome counteracts nothing", () => {
        assert.equal(maxCounteractedRank("whatever", 4), null);
    });
});

describe("rankFromLevel", () => {
    it("is half the level rounded up", () => {
        assert.equal(rankFromLevel(1), 1);
        assert.equal(rankFromLevel(2), 1);
        assert.equal(rankFromLevel(7), 4);
        assert.equal(rankFromLevel(20), 10);
    });

    it("is at least 0", () => {
        assert.equal(rankFromLevel(0), 0);
        assert.equal(rankFromLevel(-1), 0);
        assert.equal(rankFromLevel("not a number"), 0);
    });
});

describe("DCs", () => {
    // pf2e's dcByLevel (src/module/dc.ts), the same in v13-dev and v14-dev
    const PF2E = [
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
    ];

    it("match pf2e's DC-by-level table", () => {
        for (const [level, dc] of PF2E) assert.equal(levelDC(level), dc, `level ${level}`);
    });

    it("fall back to 14 off the table, as pf2e's calculateDC does", () => {
        assert.equal(levelDC(30), 14);
        assert.equal(levelDC("x"), 14);
    });

    it("take the level off with proficiency without level", () => {
        assert.equal(levelDC(5, { pwol: true }), 15);
        assert.equal(levelDC(-1, { pwol: true }), 13);
    });

    it("for a spell rank are the DC for level 2 × rank − 1", () => {
        assert.equal(spellRankDC(1), 15);
        assert.equal(spellRankDC(3), 20);
        assert.equal(spellRankDC(10), 39);
    });
});

describe("degreeOfSuccess", () => {
    it("reads 10 over and under the DC", () => {
        assert.equal(degreeOfSuccess({ total: 30, dc: 20 }), "criticalSuccess");
        assert.equal(degreeOfSuccess({ total: 29, dc: 20 }), "success");
        assert.equal(degreeOfSuccess({ total: 20, dc: 20 }), "success");
        assert.equal(degreeOfSuccess({ total: 19, dc: 20 }), "failure");
        assert.equal(degreeOfSuccess({ total: 11, dc: 20 }), "failure");
        assert.equal(degreeOfSuccess({ total: 10, dc: 20 }), "criticalFailure");
    });

    it("moves a step up on a natural 20 and down on a natural 1", () => {
        assert.equal(degreeOfSuccess({ total: 19, natural: 20, dc: 20 }), "success");
        assert.equal(degreeOfSuccess({ total: 10, natural: 20, dc: 20 }), "failure");
        assert.equal(degreeOfSuccess({ total: 40, natural: 20, dc: 20 }), "criticalSuccess");
        assert.equal(degreeOfSuccess({ total: 25, natural: 1, dc: 20 }), "failure");
        assert.equal(degreeOfSuccess({ total: 5, natural: 1, dc: 20 }), "criticalFailure");
    });
});

describe("rankFromText", () => {
    it("reads a counteract rank stated in text", () => {
        assert.equal(rankFromText("It has a counteract rank of 4."), 4);
        assert.equal(rankFromText("counteract rank 10"), 10);
        assert.equal(rankFromText("The counteract rank is 3"), 3);
        assert.equal(rankFromText("no rank here"), null);
        assert.equal(rankFromText(null), null);
    });
});
