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

/**
 * A player's requests, checked by the GM's session (issue #64): until 1.26.20, the GM grew a tree for any caster, at
 * any rank, on any square, and damaged any tree by any amount, as the request said
 */
for (const version of ["v13", "v14"]) {
    describe(`Protector Tree: a player's requests, checked by the GM (${version})`, () => {
        /** The GM and a player, settled: Sylva (level 5, the player's) with Timber Sentinel, at the scene's corner */
        async function setup(t) {
            const tick = useFakeTimers(t);
            world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                ],
            });
            const gm = await world.connect("gm", { scripts: ["protector-tree.js"] });
            const player = await world.connect("player", { scripts: ["protector-tree.js"] });
            tick(2_000);
            await world.flush();
            t.mock.method(console, "warn", () => {});

            const scene = makeScene(world);
            const caster = makeActor(world, { name: "Sylva", owners: ["player"] });
            caster.system.details.level.value = 5;
            const casterToken = addToken(world, scene, caster);
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
            // Foundry's Actor.create and token creation, as far as growing the tree uses them: what each tree was made with
            const made = [];
            gm.globals.Actor = {
                [Symbol.hasInstance]: (value) => value?.documentName === "Actor",
                create: async (data) => {
                    const tree = makeActor(world, { name: data.name, type: "hazard" });
                    tree.flags = structuredClone(data.flags);
                    tree.getTokenDocument = async (changes) => ({ toObject: () => ({ ...changes }) });
                    made.push({ tree, data });
                    return tree;
                },
            };
            scene.createEmbeddedDocuments = async (_type, sources) =>
                sources.map((source) => addToken(world, scene, made.at(-1).tree, { x: source.x, y: source.y }));
            gm.run(() => (CONFIG.PF2E.hazardTraits = { plant: "Plant", wood: "Wood" }));
            const card = await player.run(() => ChatMessage.create(itemCard(impulse)));
            const data = {
                kind: "impulse",
                rank: 3,
                casterUuid: caster.uuid,
                casterTokenUuid: casterToken.uuid,
                itemUuid: impulse.uuid,
                sceneId: scene.id,
                x: 300,
                y: 200,
                elevation: 0,
                messageId: card.id,
            };
            const ask = async (action, request) => {
                const answer = player.run(() => player.scripts["settings.js"].askGM(action, request));
                for (let i = 0; i < 20; i++) {
                    await world.flush();
                    await new Promise((resolve) => setImmediate(resolve));
                }
                return answer;
            };
            return { gm, player, scene, caster, casterToken, impulse, made, card, data, ask };
        }

        it("grows the tree for the player's caster at the rank the caster's level gives, not the request's", async (t) => {
            const { made, data, ask } = await setup(t);
            const answer = await ask("protectorTreeCreate", { ...data, rank: 9 });
            assert.equal(answer.ok, true);
            assert.equal(made.length, 1);
            // Half of level 5, rounded up: rank 3, 10 Hit Points a rank
            assert.equal(made[0].data.system.attributes.hp.max, 30);
            assert.equal(made[0].data.flags[MODULE_ID].protectorTree.rank, 3);
        });

        it("refuses a caster the player doesn't own, and a card that isn't the caster's", async (t) => {
            const { player, scene, made, data, ask } = await setup(t);
            const other = makeActor(world, { name: "Druid" });
            other.system.details.level.value = 5;
            const otherToken = addToken(world, scene, other, { x: 0, y: 5 });
            const otherImpulse = addItem(world, other, {
                name: "Timber Sentinel",
                type: "feat",
                slug: "timber-sentinel",
            });
            const notTheirs = await ask("protectorTreeCreate", {
                ...data,
                casterUuid: other.uuid,
                casterTokenUuid: otherToken.uuid,
                itemUuid: otherImpulse.uuid,
                messageId: null,
            });
            assert.deepEqual(notTheirs, { ok: false, reason: "refused", error: "Player doesn't own the caster" });

            const otherCard = await player.run(() => ChatMessage.create(itemCard(otherImpulse)));
            const wrongCard = await ask("protectorTreeCreate", { ...data, messageId: otherCard.id });
            assert.deepEqual(wrongCard, { ok: false, reason: "refused", error: "the card isn't Sylva's" });
            assert.equal(made.length, 0);
        });

        it("refuses a square beyond 30 feet, an occupied one, or one off the grid", async (t) => {
            const { scene, made, data, ask } = await setup(t);
            const far = await ask("protectorTreeCreate", { ...data, x: 1000, y: 0 });
            assert.deepEqual(far, { ok: false, reason: "refused", error: "the square is beyond 30 feet" });
            // The caster's own square, then a goblin's
            const own = await ask("protectorTreeCreate", { ...data, x: 0, y: 0 });
            assert.deepEqual(own, { ok: false, reason: "refused", error: "the square is occupied" });
            const goblin = addToken(world, scene, makeActor(world, { name: "Goblin", type: "npc" }));
            Object.assign(goblin, { x: 300, y: 200 });
            const occupied = await ask("protectorTreeCreate", data);
            assert.deepEqual(occupied, { ok: false, reason: "refused", error: "the square is occupied" });
            const offGrid = await ask("protectorTreeCreate", { ...data, x: 150, y: 200 });
            assert.deepEqual(offGrid, { ok: false, reason: "refused", error: "that isn't a square" });
            assert.equal(made.length, 0);
        });

        it("refuses the spell at a rank above what the caster can cast", async (t) => {
            const { caster, made, data, ask } = await setup(t);
            const spell = addItem(world, caster, { name: "Protector Tree", type: "spell", slug: "protector-tree" });
            const request = { ...data, kind: "spell", itemUuid: spell.uuid, messageId: null };
            const tooHigh = await ask("protectorTreeCreate", { ...request, rank: 9 });
            assert.deepEqual(tooHigh, { ok: false, reason: "refused", error: "rank 9 is out of reach" });
            assert.equal(made.length, 0);
            const allowed = await ask("protectorTreeCreate", { ...request, rank: 2 });
            assert.equal(allowed.ok, true);
            assert.equal(made[0].data.system.attributes.hp.max, 20);
        });

        /** Sylva's active tree, with Valeros (the player's) beside it and Amiri (also the player's) far away */
        function standingTree({ scene, caster }) {
            const effect = addEffect(world, caster, { name: "Effect: Protector Tree" });
            const tree = makeActor(world, { name: "Protector Tree (Sylva)", type: "hazard" });
            tree.flags = {
                [MODULE_ID]: { protectorTree: { caster: caster.uuid, effect: effect.uuid, rank: 1, active: true } },
            };
            tree.hitPoints = { value: 10, max: 10 };
            const damaged = [];
            tree.applyDamage = async ({ damage }) => void damaged.push(damage);
            // In pixels, on a scene of 100 pixels a square
            const at = (token, x, y) => Object.assign(token, { x, y });
            const treeToken = at(addToken(world, scene, tree), 200, 200);
            const valeros = at(
                addToken(world, scene, makeActor(world, { name: "Valeros", owners: ["player"] })),
                300,
                200,
            );
            const amiri = at(
                addToken(world, scene, makeActor(world, { name: "Amiri", owners: ["player"] })),
                2000,
                200,
            );
            return { tree, treeToken, valeros, amiri, damaged };
        }

        it("damages the tree next to the player's ally", async (t) => {
            const setupData = await setup(t);
            const { treeToken, valeros, damaged } = standingTree(setupData);
            const answer = await setupData.ask("protectorTreeDamage", {
                tokenUuid: treeToken.uuid,
                amount: 7,
                allyTokenUuid: valeros.uuid,
            });
            assert.equal(answer.ok, true);
            assert.deepEqual(damaged, [7]);
        });

        it("refuses a tree the ally isn't next to, an ally the player doesn't own, or a token that isn't a tree", async (t) => {
            const setupData = await setup(t);
            const { scene, ask } = setupData;
            const { treeToken, valeros, amiri, damaged } = standingTree(setupData);
            const notNext = await ask("protectorTreeDamage", {
                tokenUuid: treeToken.uuid,
                amount: 7,
                allyTokenUuid: amiri.uuid,
            });
            assert.deepEqual(notNext, { ok: false, reason: "refused", error: "no active tree protects Amiri" });

            const kyra = Object.assign(addToken(world, scene, makeActor(world, { name: "Kyra" })), { x: 200, y: 300 });
            const notTheirs = await ask("protectorTreeDamage", {
                tokenUuid: treeToken.uuid,
                amount: 7,
                allyTokenUuid: kyra.uuid,
            });
            assert.deepEqual(notTheirs, {
                ok: false,
                reason: "refused",
                error: "Player doesn't own the creature the tree protects",
            });

            const goblin = addToken(world, scene, makeActor(world, { name: "Goblin", type: "npc" }));
            const notATree = await ask("protectorTreeDamage", {
                tokenUuid: goblin.uuid,
                amount: 7,
                allyTokenUuid: valeros.uuid,
            });
            assert.deepEqual(notATree, { ok: false, reason: "refused", error: "no active tree protects Valeros" });
            assert.deepEqual(damaged, []);
        });
    });
}
