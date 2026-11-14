/**
 * Rallying Charge (scripts/rallying-charge.js), driven through the chat hooks: the feat's card, the charge's Strike and
 * its damage. In 1.26.8 a damage roll made while viewing another scene spent the charge before warning, and the charge
 * couldn't be used again: the card was spent, and the earlier damage roll counted as another Strike's (issue #58).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_ID, createWorld, useFakeTimers } from "./harness/foundry.mjs";
import { addItem, addToken, checkMessage, itemCard, makeActor, makeScene } from "./harness/pf2e.mjs";

const FEAT_UUID = "Compendium.pf2e.feats-srd.Item.df4cBV3qZn3qNUmP";
const EFFECT_UUID = "Compendium.pf2e.feat-effects.Item.wjNNHgX6ceKLbn8Q";

async function settle(world, done) {
    for (let i = 0; i < 200 && !done(); i++) {
        await world.flush();
        await new Promise((resolve) => setImmediate(resolve));
    }
    await world.flush();
}

/** An actor that can be given effects: createEmbeddedDocuments and deleteEmbeddedDocuments on its items */
function withEffects(world, actor) {
    actor.createEmbeddedDocuments = async (type, sources) =>
        sources.map((source) => addItem(world, actor, { ...source, source: source._stats?.compendiumSource }));
    actor.deleteEmbeddedDocuments = async (type, ids) => ids.forEach((id) => actor.items.delete(id));
    return actor;
}

/** The Strike's attack roll and damage roll (Check.roll and DamageRoll's message in pf2e), with the speaker's token */
function attackMessage(marshal, token) {
    const data = checkMessage({
        actor: marshal,
        type: "attack-roll",
        statistic: "longsword",
        domains: ["attack-roll", "strike-attack-roll", "melee-strike-attack-roll"],
        options: ["action:strike", "melee"],
        die: 15,
        outcome: "success",
    });
    data.speaker = { ...data.speaker, scene: token.parent.id, token: token.id };
    return data;
}

function damageMessage(marshal, token) {
    return {
        speaker: { actor: marshal.id, alias: marshal.name, scene: token.parent.id, token: token.id },
        rolls: [{ total: 9, formula: "1d8 + 4", dice: [], options: {} }],
        flags: {
            pf2e: {
                context: {
                    type: "damage-roll",
                    sourceType: "attack",
                    actor: marshal.id,
                    token: token.id,
                    domains: ["damage", "strike-damage", "melee-strike-damage"],
                    options: ["action:strike", "melee"],
                    outcome: "success",
                    target: null,
                },
            },
        },
    };
}

for (const version of ["v13", "v14"]) {
    describe(`Rallying Charge (${version})`, () => {
        it("rolled away from the marshal's scene, the charge stays active until the damage is rolled again there", async (t) => {
            const tick = useFakeTimers(t);
            const world = createWorld({
                version,
                users: [
                    { id: "gm", name: "Gamemaster", isGM: true },
                    { id: "player", name: "Player" },
                ],
            });
            const player = await world.connect("player", { scripts: ["rallying-charge.js"] });
            t.after(() => world.close());
            tick(2_000);
            player.run(() => {
                CONFIG.Canvas = { polygonBackends: { sight: { testCollision: () => false } } };
            });

            const marshal = withEffects(world, makeActor(world, { name: "Seelah" }));
            const ally = withEffects(world, makeActor(world, { name: "Ezren" }));
            for (const actor of [marshal, ally]) {
                Object.assign(actor, {
                    isOwner: true,
                    isDead: false,
                    hasCondition: () => false,
                    isAllyOf: (other) => [marshal, ally].includes(other),
                });
            }
            marshal.abilities = { cha: { mod: 3 } };
            const feat = addItem(world, marshal, {
                name: "Rallying Charge",
                type: "feat",
                slug: "rallying-charge-marshal",
                source: FEAT_UUID,
            });
            // pf2e's effect, as fromUuid finds it in the compendium
            world.add({
                uuid: EFFECT_UUID,
                toObject: () => ({
                    name: "Effect: Rallying Charge (Marshal)",
                    type: "effect",
                    slug: "effect-rallying-charge-marshal",
                    _stats: {},
                    system: { slug: "effect-rallying-charge-marshal" },
                }),
            });

            const battlefield = makeScene(world, { name: "Battlefield" });
            const elsewhere = makeScene(world, { name: "Elsewhere" });
            const marshalToken = addToken(world, battlefield, marshal, { x: 0, y: 0 });
            addToken(world, battlefield, ally, { x: 4, y: 0 });
            const post = (data) => player.run(() => ChatMessage.create(data));

            const card = await post(itemCard(feat));
            await post(attackMessage(marshal, marshalToken));

            // Viewing another scene: a warning, and the charge isn't spent
            player.run(() => (canvas.scene = elsewhere));
            const offScene = await post(damageMessage(marshal, marshalToken));
            await settle(world, () => player.notifications.length > 0);
            assert.deepEqual(
                player.notifications.map((n) => n.type),
                ["warn"],
            );
            assert.match(player.notifications[0].message, /view Seelah's scene and roll the damage again/);
            assert.equal(card.flags[MODULE_ID].rallyingCharge.spent, false);
            assert.equal(offScene.flags[MODULE_ID].rallyingCharge.offScene, true);
            assert.equal(ally.itemTypes.effect.length, 0);

            // On the scene, the damage rolled again rallies the ally, and spends the charge
            player.run(() => (canvas.scene = battlefield));
            await post(damageMessage(marshal, marshalToken));
            await settle(world, () => ally.itemTypes.effect.length > 0);
            const [effect] = ally.itemTypes.effect;
            assert.ok(effect, "the ally gets the effect");
            assert.equal(effect.sourceId, EFFECT_UUID);
            assert.equal(effect.system.context.origin.actor, marshal.uuid);
            assert.equal(card.flags[MODULE_ID].rallyingCharge.spent, true);
            assert.ok(world.messages.some((m) => /gains 3 temporary Hit Points/.test(m.content)));
        });
    });
}
