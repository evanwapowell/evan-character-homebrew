/**
 * Distances between tokens read from their documents, so they can be measured on a scene no one is viewing (the GM's
 * session checking a player's request, for one), the way pf2e counts them on a square grid.
 */

/**
 * A token's space, in pixels, with its elevation and height in grid units (feet). A Tiny creature's space is the whole
 * square it's in, as pf2e measures it (`TokenPF2e#mechanicalBounds`: the grid square at its top-left corner, at least
 * a square wide and high).
 */
function spaceOf(token, scene = token.parent) {
    const size = scene.grid.size;
    const distance = scene.grid.distance;
    const width = Math.max(token.width, 0.5);
    const height = Math.max(token.height, 0.5);
    const z0 = Number(token.elevation) || 0;
    const z1 = z0 + Math.max(width, height) * distance;
    if (width < 1 || height < 1) {
        const x0 = Math.floor(token.x / size) * size;
        const y0 = Math.floor(token.y / size) * size;
        return {
            x0,
            y0,
            x1: x0 + Math.max(size, width * size),
            y1: y0 + Math.max(size, height * size),
            z0,
            z1,
        };
    }
    return { x0: token.x, y0: token.y, x1: token.x + width * size, y1: token.y + height * size, z0, z1 };
}

/**
 * The distance between two spaces as pf2e counts it on a square grid: the squares between them, every second diagonal
 * counting double, in feet. Spaces that touch are 5 feet apart.
 */
function distanceBetween(a, b, scene) {
    const size = scene.grid.size;
    const along = (a0, a1, b0, b1) => {
        if (a0 < b1 - 1 && b0 < a1 - 1) return 0;
        const gap = Math.max(0, b0 - a1, a0 - b1);
        return Math.round(gap / size) + 1;
    };
    const dx = along(a.x0, a.x1, b.x0, b.x1);
    const dy = along(a.y0, a.y1, b.y0, b.y1);
    const squares = Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
    return squares * scene.grid.distance;
}

/**
 * The distance between two tokens, in feet, from their documents: Infinity when they aren't on the same scene. Their
 * elevations aren't counted, so it's never more than pf2e's `TokenPF2e#distanceTo`, which a request was checked with.
 */
function tokenDistance(a, b) {
    const scene = a?.parent;
    if (!scene?.grid || !b || b.parent !== scene) return Infinity;
    return distanceBetween(spaceOf(a, scene), spaceOf(b, scene), scene);
}

export { distanceBetween, spaceOf, tokenDistance };
