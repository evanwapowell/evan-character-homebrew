/**
 * PF2e Toolbelt, when it's active. Its Target Helper keeps a spell's or action's targets on its card
 * (`flags.pf2e-toolbelt.targetHelper.targets`, and `splashTargets`: token UUIDs) and rolls their saves from it (see
 * `toolbeltSave` in saves.js).
 */

import { resolveSync } from "./util.js";

const TOOLBELT_ID = "pf2e-toolbelt";

/** Whether PF2e Toolbelt is active */
const toolbeltActive = () => !!game.modules.get(TOOLBELT_ID)?.active;

/**
 * The tokens Target Helper recorded on a card, with its splash targets when asked for, or null when it recorded none
 * (or isn't active), so the caller can fall back on the user's targets. Tokens that are gone are left out.
 */
function toolbeltTargets(message, { splash = false } = {}) {
    if (!toolbeltActive()) return null;
    const data = message?.flags?.[TOOLBELT_ID]?.targetHelper;
    const list = (value) => (Array.isArray(value) ? value : []);
    const recorded = [...list(data?.targets), ...(splash ? list(data?.splashTargets) : [])];
    if (recorded.length === 0) return null;
    return recorded.map(resolveSync).filter((token) => token);
}

export { TOOLBELT_ID, toolbeltActive, toolbeltTargets };
