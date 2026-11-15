/**
 * Finding items (an effect someone gave out) on every creature in the world: world actors, and the actors of unlinked
 * tokens on every scene. Foundry builds an unlinked token's actor only when something asks for it (pf2e's
 * `TokenDocumentPF2e#hasConstructedActor`), and building every one in the world is slow, so a token whose actor isn't
 * built yet is read from its source: the items its actor delta adds. Only a token holding a matching item has its
 * actor built.
 *
 * `test` is given items and item sources alike, so it reads only what both have: `type`, `name`, `flags`, `system`
 * and `_stats` (not pf2e's getters, like `sourceId` or `origin`).
 */

/** Every actor with items that pass `test`, as `{ actor, items }` */
export function findItems(test) {
    const found = [];
    const add = (actor) => {
        const items = actor ? actor.items.filter((item) => test(item)) : [];
        if (items.length > 0) found.push({ actor, items });
    };
    for (const actor of game.actors) add(actor);
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.actorLink) continue;
            // pf2e's getter; without it, the actor is read (and built)
            const built = token.hasConstructedActor ?? true;
            if (built || (token._source?.delta?.items ?? []).some((source) => test(source))) add(token.actor);
        }
    }
    return found;
}
