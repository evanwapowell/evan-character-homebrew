/**
 * Extract Element (scripts/extract-element.js). Up to 1.26.18 (issue #60): a creature with a custom resistance kept all
 * its resistances against the kineticist's impulses (pf2e rejects a removal rule listing "custom" with other types), a
 * second resistance of one type stayed (a removal takes the first of each type); two saves for one use arriving
 * together both applied their damage, and a failure while applying left the use marked as resolved; and when the
 * kinetic aura ended, every unlinked token's actor in the world was built to look for the effects.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, makeActor, makeScene } from "./harness/pf2e.mjs";

const USERS = [{ id: "gm", name: "Gamemaster", isGM: true }];
const EFFECT_UUID = "Compendium.evan-character-homebrew.evans-character-homebrew.Item.otpFtLUFZlVa0nhn";
const MODULE_ID = "evan-character-homebrew";

let world;
afterEach(() => world?.close());

async function drain() {
    for (let i = 0; i < 40; i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/** pf2e's DamageRoll (found by its name), as far as the script uses it: a total, posted, and altered by a multiplier */
class DamageRoll {
    static rolled = [];
    constructor(formula) {
        this.formula = formula;
        this.total = 5;
    }
    async evaluate() {
        return this;
    }
    async toMessage() {
        DamageRoll.rolled.push(this.formula);
    }
    alter(multiplier) {
        const altered = new DamageRoll(this.formula);
        altered.total = this.total * multiplier;
        return altered;
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Extract Element (${version})`, () => {
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({ version, users: USERS });
            const gm = await world.connect("gm", { scripts: ["extract-element.js"] });
            tick(2_000);
            await world.flush();
            gm.run(() => {
                CONFIG.PF2E = {
                    damageTypes: { fire: "Fire", cold: "Cold", slashing: "Slashing" },
                    immunityTypes: { fire: "Fire", cold: "Cold", custom: "" },
                    resistanceTypes: { fire: "Fire", cold: "Cold", slashing: "Slashing", custom: "" },
                };
                CONFIG.Dice = { rolls: [DamageRoll] };
            });
            world.add({
                uuid: EFFECT_UUID,
                toObject: () => ({
                    name: "Effect: Extract Element",
                    type: "effect",
                    system: { slug: "effect-extract-element", rules: [] },
                    flags: {},
                    _stats: {},
                }),
            });
            const scene = makeScene(world);
            const kineticist = makeActor(world, { name: "Ignis" });
            kineticist.system.details.level.value = 5;
            const action = addItem(world, kineticist, {
                name: "Extract Element",
                type: "action",
                slug: "extract-element",
            });
            action.getOriginData = () => ({ actor: kineticist.uuid, uuid: action.uuid });
            const goblin = makeActor(world, { name: "Goblin", type: "npc" });
            goblin.attributes = { immunities: [], resistances: [] };
            const goblinToken = addToken(world, scene, goblin);
            return { gm, scene, kineticist, action, goblin, goblinToken };
        }

        it("bypasses every resistance but a custom one, and each entry of a type", async (t) => {
            const { gm, goblin } = await setup(t);
            goblin.attributes = {
                immunities: [{ type: "fire" }, { type: "custom" }],
                resistances: [{ type: "custom" }, { type: "fire" }, { type: "cold" }, { type: "fire" }],
            };
            const rules = gm.run(() => gm.scripts["extract-element.js"].getBypassRules(goblin));
            const removals = rules.filter((r) => r.mode === "remove").map((r) => [r.key, r.type]);
            assert.deepEqual(removals, [
                ["Resistance", ["fire", "cold"]],
                ["Resistance", ["fire"]],
                ["Immunity", ["fire"]],
            ]);
            const resistance = rules.find((r) => r.key === "Resistance" && r.mode !== "remove");
            assert.deepEqual(resistance.type, ["fire"], "the fire immunity becomes resistance to the impulse");
        });

        /** A use of the action, recorded on its card, and the request a save against it sends to the GM */
        async function use({ gm, kineticist, action, goblinToken }) {
            const card = await gm.run(() =>
                ChatMessage.create({
                    content: "<p>Extract Element</p>",
                    flags: {
                        [MODULE_ID]: {
                            extractElement: { kineticist: kineticist.uuid, target: goblinToken.uuid, element: "fire" },
                        },
                    },
                }),
            );
            const data = {
                kineticistUuid: kineticist.uuid,
                kineticistTokenUuid: null,
                itemUuid: action.uuid,
                targetTokenUuid: goblinToken.uuid,
                element: "fire",
                outcome: "failure",
                total: 12,
                cardId: card.id,
            };
            return { card, data };
        }

        it("applies the result once when two saves for one use arrive together", async (t) => {
            const setupData = await setup(t);
            const { gm, goblin } = setupData;
            const damage = [];
            goblin.applyDamage = async ({ damage: roll }) => void damage.push(roll.total);
            const { card, data } = await use(setupData);

            const resolve = (d) => gm.run(() => gm.scripts["extract-element.js"].resolveExtraction(d));
            await Promise.all([resolve(data), resolve({ ...data, outcome: "criticalFailure", total: 2 })]);
            await drain();

            assert.deepEqual(damage, [5], "the damage is dealt once");
            assert.equal(goblin.itemTypes.effect.length, 1, "one effect");
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, true);
        });

        it("leaves the use to be resolved again when applying the damage fails", async (t) => {
            const setupData = await setup(t);
            const { gm, goblin } = setupData;
            let fail = true;
            const damage = [];
            goblin.applyDamage = async ({ damage: roll }) => {
                if (fail) throw new Error("the server refused");
                damage.push(roll.total);
            };
            const { card, data } = await use(setupData);
            const resolve = (d) => gm.run(() => gm.scripts["extract-element.js"].resolveExtraction(d));

            await assert.rejects(resolve(data), /the server refused/);
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, undefined);
            fail = false;
            await resolve(data);
            await drain();
            assert.deepEqual(damage, [5]);
            assert.equal(card.flags[MODULE_ID].extractElement.resolved, true);
        });

        it("ends the effects when the kinetic aura ends, without building other unlinked tokens' actors", async (t) => {
            const { gm, scene, kineticist, goblin } = await setup(t);
            const aura = addEffect(world, kineticist, { name: "Effect: Kinetic Aura", slug: "effect-kinetic-aura" });
            const extraction = {
                name: "Effect: Extract Element (Fire)",
                type: "effect",
                source: EFFECT_UUID,
                flags: { [MODULE_ID]: { extractElement: { kineticist: kineticist.uuid, element: "fire" } } },
            };
            const onGoblin = addEffect(world, goblin, { name: extraction.name, flags: extraction.flags });
            const kobold = makeActor(world, { name: "Kobold", type: "npc" });
            const holding = addToken(world, scene, kobold, { unlinked: true, deltaItems: [extraction] });
            const other = addToken(world, scene, kobold, { unlinked: true });
            const built = addToken(world, scene, kobold, { unlinked: true });
            addEffect(world, built.actor, { name: extraction.name, flags: extraction.flags });

            await gm.run(() => aura.delete());
            await drain();

            assert.equal(goblin.items.has(onGoblin.id), false);
            assert.equal(holding.actor.itemTypes.effect.length, 0, "the unlinked token's effect ends");
            assert.equal(built.actor.itemTypes.effect.length, 0, "the built token actor's effect ends");
            assert.equal(other.builds, 0, "an unlinked token without one isn't built");
        });
    });
}
