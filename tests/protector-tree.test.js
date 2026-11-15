/**
 * Protector Tree (scripts/protector-tree.js). Up to 1.26.18 (issue #59): the tree was always created at elevation 0,
 * so on a rooftop it was never next to anyone; any damage from a weapon or an NPC attack without an outcome counted as
 * a Strike that hit (an attack's inline damage, an area-fire attack); a card's Place Tree could grow two trees; a Tiny
 * creature half a square away was measured as two squares away; the damage left for the ally lost its precision and
 * splash components and a critical hit's doubling; and splash damage applied at half or double wasn't told apart.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addEffect, addItem, addToken, itemCard, makeActor, makeScene } from "./harness/pf2e.mjs";

const MODULE_ID = "evan-character-homebrew";
const EFFECT_UUID = "Compendium.evan-character-homebrew.evans-character-homebrew.Item.yHoBoom9axaemxWS";

let world;
afterEach(() => world?.close());

async function connect(t, version = "v14") {
    const tick = useFakeTimers(t);
    world = createWorld({ version, users: [{ id: "gm", name: "Gamemaster", isGM: true }] });
    const gm = await world.connect("gm", { scripts: ["protector-tree.js"] });
    tick(2_000);
    await world.flush();
    const script = (name, ...args) => gm.run(() => gm.scripts["protector-tree.js"][name](...args));
    return { gm, script };
}

describe("Protector Tree: what the tree takes", () => {
    it("takes a Strike's damage, and not an attack's inline damage or an area-fire attack", async (t) => {
        const { script } = await connect(t);
        const isStrikeHit = (params) => script("isStrikeHit", params);
        // A character's Strike, rolled against a target that was hit
        assert.equal(
            isStrikeHit({ rollOptions: new Set(["action:strike", "origin:action:slug:strike"]), outcome: "success" }),
            true,
        );
        // An NPC's Strike damage rolled without an attack roll: no outcome, the strike option all the same
        assert.equal(isStrikeHit({ rollOptions: ["origin:action:slug:strike", "melee"] }), true);
        // A miss
        assert.equal(isStrikeHit({ rollOptions: ["action:strike"], outcome: "failure" }), false);
        // An NPC attack's inline @Damage, or an area-fire attack: an attack item, no Strike
        const melee = { isOfType: (...types) => types.includes("melee") };
        assert.equal(isStrikeHit({ item: melee, rollOptions: [] }), false);
        assert.equal(isStrikeHit({ item: melee, rollOptions: ["origin:action:slug:area-fire"] }), false);
    });

    it("tells splash damage only, also once applied at half or double", async (t) => {
        const { script } = await connect(t);
        const instance = (total, splash, persistent = false) => ({
            total,
            persistent,
            componentTotal: (component) => (component === "splash" ? splash : 0),
        });
        assert.equal(script("isSplashOnly", { options: { splashOnly: true }, instances: [instance(3, 3)] }), true);
        // DamageRoll#alter drops the roll's options; halved, the splash term still counts in full
        assert.equal(script("isSplashOnly", { options: {}, instances: [instance(1, 3)] }), true);
        assert.equal(script("isSplashOnly", { options: {}, instances: [instance(6, 6), instance(4, 0)] }), false);
        assert.equal(script("isSplashOnly", { options: {}, instances: [] }), false);
    });

    it("leaves the ally the rest with its precision, splash and critical doubling", async (t) => {
        const { script } = await connect(t);
        const remainder = (instances, absorbed) => script("remainderFormula", instances, absorbed);
        assert.equal(remainder([{ type: "slashing", total: 12 }], 10), "{2[slashing]}");
        assert.equal(remainder([{ type: "slashing", total: 12 }], 12), null);
        // Its share of precision damage: 6 of 16, of the 8 left
        assert.equal(
            remainder([{ type: "piercing", total: 16, precision: 6, materials: ["silver"] }], 8),
            "{(5 + 3[precision])[piercing,silver]}",
        );
        // A critical hit: 20, 10 before doubling, 4 of it precision
        assert.equal(
            remainder([{ type: "slashing", total: 20, undoubled: 10, precision: 4 }], 10),
            "{(2 * (4 + 1[precision]))[slashing]}",
        );
        assert.equal(remainder([{ type: "slashing", total: 20, undoubled: 10 }], 11), "{(2 * 4 + 1)[slashing]}");
        // The tree takes the instances in order; persistent damage comes along
        assert.equal(
            remainder(
                [
                    { type: "fire", total: 4 },
                    { type: "fire", persistent: true, expression: "1d6", total: 0 },
                    { type: "slashing", total: 9, splash: 3 },
                ],
                6,
            ),
            "{(1d6)[persistent,fire],(5 + 2[splash])[slashing]}",
        );
    });

    it("measures a Tiny creature from the whole square it's in", async (t) => {
        const { script } = await connect(t);
        const scene = { grid: { size: 100, distance: 5 } };
        const token = (x, y, size = 1) => ({ parent: scene, x, y, width: size, height: size, elevation: 0 });
        const tree = token(200, 200);
        // In the right half of the square beside the tree
        assert.equal(script("isAdjacent", tree, token(350, 200, 0.5)), true);
        assert.deepEqual(script("spaceOf", token(350, 250, 0.5)), {
            x0: 300,
            y0: 200,
            x1: 400,
            y1: 300,
            z0: 0,
            z1: 2.5,
        });
        assert.equal(script("isAdjacent", tree, token(450, 200, 0.5)), false);
    });
});

for (const version of ["v13", "v14"]) {
    describe(`Protector Tree: growing the tree (${version})`, () => {
        async function setup(t) {
            const { gm, script } = await connect(t, version);
            const scene = makeScene(world);
            const caster = makeActor(world, { name: "Sylva" });
            caster.system.details.level.value = 5;
            const casterToken = addToken(world, scene, caster);
            casterToken.elevation = 20;
            const impulse = addItem(world, caster, { name: "Timber Sentinel", type: "feat", slug: "timber-sentinel" });
            world.add({
                uuid: EFFECT_UUID,
                toObject: () => ({
                    name: "Effect: Protector Tree",
                    type: "effect",
                    system: { slug: "effect-protector-tree", rules: [] },
                    flags: {},
                    _stats: {},
                }),
            });
            // Foundry's Actor.create and TokenDocument creation, as far as growing the tree uses them
            const trees = [];
            gm.globals.Actor = {
                [Symbol.hasInstance]: (value) => value?.documentName === "Actor",
                create: async (data) => {
                    await new Promise((resolve) => setImmediate(resolve));
                    const tree = makeActor(world, { name: data.name, type: "hazard" });
                    tree.flags = structuredClone(data.flags);
                    tree.getTokenDocument = async (changes) => ({ toObject: () => ({ ...changes }) });
                    trees.push(tree);
                    return tree;
                },
            };
            scene.createEmbeddedDocuments = async (_type, sources) =>
                sources.map((source) => {
                    const token = addToken(world, scene, trees.at(-1), { x: source.x, y: source.y });
                    token.elevation = source.elevation;
                    return token;
                });
            gm.run(() => (CONFIG.PF2E.hazardTraits = { plant: "Plant", wood: "Wood" }));
            const card = await gm.run(() => ChatMessage.create(itemCard(impulse)));
            const data = {
                kind: "impulse",
                rank: 3,
                casterUuid: caster.uuid,
                casterTokenUuid: casterToken.uuid,
                itemUuid: impulse.uuid,
                sceneId: scene.id,
                x: 300,
                y: 200,
                elevation: 20,
                messageId: card.id,
            };
            return { script, scene, caster, trees, card, data };
        }

        it("grows the tree at the caster's elevation, and marks the card", async (t) => {
            const { script, scene, caster, trees, card, data } = await setup(t);
            const result = await script("createTree", data);
            assert.equal(trees.length, 1);
            const token = scene.tokens.find((t) => t.actor === trees[0]);
            assert.equal(token.elevation, 20);
            assert.deepEqual(result, { tree: trees[0].uuid, token: token.uuid });
            assert.equal(card.flags[MODULE_ID].protectorTree.placed, token.uuid);
            assert.equal(caster.itemTypes.effect.length, 1);
        });

        it("grows one tree for a card, however many requests arrive", async (t) => {
            const { script, trees, data } = await setup(t);
            const results = await Promise.allSettled([script("createTree", data), script("createTree", data)]);
            assert.deepEqual(
                results.map((r) => r.status),
                ["fulfilled", "rejected"],
            );
            await assert.rejects(script("createTree", data), /already placed/);
            assert.equal(trees.length, 1);
        });
    });
}

/** pf2e's DamageRoll, as far as the tree reads it: instances with their components, and a roll made from a formula */
class DamageRoll {
    constructor(formula, data = {}, options = {}) {
        this.formula = formula;
        this.options = options;
        this.instances = [];
        this.total = 0;
    }
    async evaluate() {
        return this;
    }
}

for (const version of ["v13", "v14"]) {
    describe(`Protector Tree: a Strike against an ally next to the tree (${version})`, () => {
        it("on a rooftop, the tree takes the damage first and the ally the rest", async (t) => {
            const { gm } = await connect(t, version);
            const scene = makeScene(world);
            const caster = makeActor(world, { name: "Sylva" });
            const ally = makeActor(world, { name: "Valeros" });
            const effect = addEffect(world, caster, { name: "Effect: Protector Tree" });
            const tree = makeActor(world, { name: "Protector Tree (Sylva)", type: "hazard" });
            tree.flags = {
                [MODULE_ID]: { protectorTree: { caster: caster.uuid, effect: effect.uuid, rank: 1, active: true } },
            };
            tree.hitPoints = { value: 10, max: 10 };
            tree.applyDamage = async ({ damage }) =>
                void (tree.hitPoints.value = Math.max(0, tree.hitPoints.value - damage));
            // In pixels, on a scene of 100 pixels a square, 20 feet up
            const at = (token, x, y) => Object.assign(token, { x, y, elevation: 20 });
            const treeToken = at(addToken(world, scene, tree), 200, 200);
            const allyToken = at(addToken(world, scene, ally), 300, 200);

            const damage = new DamageRoll("(2d6 + 4 + 1d6[precision])[slashing]");
            damage.total = 16;
            damage.instances = [
                {
                    type: "slashing",
                    materials: [],
                    total: 16,
                    critImmuneTotal: 16,
                    componentTotal: (c) => (c === "precision" ? 4 : 0),
                },
            ];
            const params = {
                damage,
                token: allyToken,
                rollOptions: new Set(["action:strike", "origin:action:slug:strike"]),
                outcome: "success",
            };
            await gm.run(() => CONFIG.Actor.documentClass.prototype.applyDamage.call(ally, params));

            assert.equal(tree.hitPoints.value, 0, "the tree takes the damage, 10 of it to reach 0");
            assert.equal(ally.damageApplied.length, 1);
            assert.equal(ally.damageApplied[0].damage.formula, "{(4 + 2[precision])[slashing]}");
            assert.equal(ally.damageApplied[0].damage.options.degreeOfSuccess, 2);
        });
    });
}
