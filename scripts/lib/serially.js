/**
 * Work on one thing (a card), one piece after another: two saves against one card arriving together are applied in
 * turn, so the second reads what the first recorded, rather than both reading the card before either recorded anything
 */

const queues = new Map();

/** Run `work` once the work queued before it under `key` has finished (or failed); resolves to what it returns */
export function serially(key, work) {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(
        () => work(),
        () => work(),
    );
    const settled = run.then(
        () => {},
        () => {},
    );
    queues.set(key, settled);
    settled.then(() => {
        if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
}
