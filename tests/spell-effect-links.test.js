import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultEffects, parseLinks } from "../scripts/lib/spell-effect-links.js";

const uuid = (id) => `Compendium.pf2e.spell-effects.Item.${id}`;
const link = (id, name) => `@UUID[${uuid(id)}]{${name}}`;

/** The links as spell-target-effects.js passes them: every link is an effect, named by its label */
function effectsIn(html) {
    return parseLinks(html).map((l) => ({ ...l, name: l.label }));
}

const chosen = (html, rank) => defaultEffects(effectsIn(html), rank).map((u) => u.split(".").at(-1));

describe("parseLinks", () => {
    it("tells links in paragraphs of their own from links inside sentences", () => {
        const html = `<p>You gain cover (${link("cover00000000000", "Cover")}).</p><p>${link("effect0000000000", "Spell Effect: X")}</p>`;
        const links = parseLinks(html);
        assert.equal(links.length, 2);
        assert.equal(links[0].standalone, false);
        assert.equal(links[1].standalone, true);
    });

    it("records the heightened or amp entry a link is in, and each UUID once", () => {
        const html = [
            `<p>${link("base000000000000", "Spell Effect: X")}</p>`,
            `<hr />`,
            `<p><strong>Heightened (3rd)</strong> Better.</p>`,
            `<p>${link("third00000000000", "Spell Effect: X (3rd Rank)")}</p>`,
            `<p><strong>Heightened (+1)</strong> Even better. ${link("base000000000000", "Spell Effect: X")}</p>`,
            `<p><strong>Amp</strong> Louder.</p>`,
            `<p>${link("amp0000000000000", "Spell Effect: Amped X")}</p>`,
        ].join("");
        const links = parseLinks(html);
        assert.deepEqual(
            links.map((l) => [l.uuid.split(".").at(-1), l.section]),
            [
                ["base000000000000", null],
                ["third00000000000", { label: "Heightened (3rd)", rank: 3, amp: false }],
                ["amp0000000000000", { label: "Amp", rank: null, amp: true }],
            ],
        );
    });
});

describe("defaultEffects", () => {
    it("chooses a heightened entry's version of the effect at or above its rank, in place of the base effect", () => {
        const html = [
            `<p>Your stomach hardens.</p>`,
            `<p>${link("irongut000000000", "Spell Effect: Iron Gut")}</p>`,
            `<hr />`,
            `<p><strong>Heightened (3rd)</strong> The resistance increases.</p>`,
            `<p>${link("irongut300000000", "Spell Effect: Iron Gut (3rd Rank)")}</p>`,
            `<p><strong>Heightened (5th)</strong> The resistance increases more.</p>`,
            `<p>${link("irongut500000000", "Spell Effect: Iron Gut (5th Rank)")}</p>`,
        ].join("");
        assert.deepEqual(chosen(html, 2), ["irongut000000000"]);
        assert.deepEqual(chosen(html, 3), ["irongut300000000"]);
        assert.deepEqual(chosen(html, 4), ["irongut300000000"]);
        assert.deepEqual(chosen(html, 6), ["irongut500000000"]);
    });

    it("chooses a spell's only effect when it's linked after the heightened entries, as Heroism's is", () => {
        const html = [
            `<p>You tap into the target's inner heroism.</p>`,
            `<hr />`,
            `<p><strong>Heightened (6th)</strong> The status bonus increases to +2.</p>`,
            `<p><strong>Heightened (9th)</strong> The status bonus increases to +3.</p>`,
            `<p>${link("heroism000000000", "Spell Effect: Heroism")}</p>`,
        ].join("");
        assert.deepEqual(chosen(html, 3), ["heroism000000000"]);
    });

    it("chooses none of a battle form's versions, leaving the choice to the caster", () => {
        const html = [
            `<p>You transform into a dinosaur.</p>`,
            `<p>${link("ankylosaurus0000", "Spell Effect: Dinosaur Form (Ankylosaurus)")}</p>`,
            `<p>${link("brontosaurus0000", "Spell Effect: Dinosaur Form (Brontosaurus)")}</p>`,
            `<p>${link("tyrannosaurus000", "Spell Effect: Dinosaur Form (Tyrannosaurus)")}</p>`,
        ].join("");
        assert.deepEqual(chosen(html, 4), []);
    });

    it("chooses the plain effect among its versions", () => {
        const html = [
            `<p>${link("vessel0000000000", "Spell Effect: Magic's Vessel")}</p>`,
            `<p>${link("vesselresist0000", "Spell Effect: Magic's Vessel (Resistance)")}</p>`,
        ].join("");
        assert.deepEqual(chosen(html, 1), ["vessel0000000000"]);
    });

    it("skips immunity, amp and degree-of-success effects", () => {
        const html = [
            `<p>You raise a magical shield.</p>`,
            `<p>${link("shield0000000000", "Spell Effect: Shield")}</p>`,
            `<p>${link("shieldimmunity00", "Spell Effect: Shield Immunity")}</p>`,
            `<p>${link("mindswapcrit0000", "Spell Effect: Mind Swap (Critical Success)")}</p>`,
            `<hr />`,
            `<p><strong>Amp</strong> The shield is stronger.</p>`,
            `<p>${link("ampedshield00000", "Spell Effect: Amped Shield")}</p>`,
        ].join("");
        assert.deepEqual(chosen(html, 1), ["shield0000000000"]);
    });

    it("chooses an aura, not the effect it hands out to creatures in it", () => {
        const html = [
            `<p>${link("auramanifest0000", "Aura: Manifest Will")}</p>`,
            `<p>${link("effectmanifest00", "Spell Effect: Manifest Will")}</p>`,
        ].join("");
        assert.deepEqual(chosen(html, 3), ["auramanifest0000"]);
    });

    it("falls back on links in the text when no effect stands in a paragraph of its own", () => {
        const html = `<p>The target gains ${link("inline0000000000", "Spell Effect: Inline")} for 1 minute.</p>`;
        assert.deepEqual(chosen(html, 1), ["inline0000000000"]);
    });
});
