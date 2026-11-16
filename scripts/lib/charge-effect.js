/**
 * pf2e's Effect: Witch's Charge, which Designate Witch's Charge gives (witch-charge.js) and Manifest Will's seneschal
 * centers on (manifest-will.js). Its ID is the same in every pf2e version.
 */

import { endsWithId } from "./util.js";

const CHARGE_EFFECT_ID = "ugeStF0Rj8phBPWL";
const CHARGE_EFFECT_UUID = "Compendium.pf2e.feat-effects.Item.ugeStF0Rj8phBPWL";

/**
 * Whether an effect is Effect: Witch's Charge: by its compendium source, or by its name (one made by hand). It can be
 * an item or an item's source (see lib/items.js), which has only `_stats` and `name`.
 */
function isChargeEffect(effect) {
    if (effect?._stats?.compendiumSource === CHARGE_EFFECT_UUID || endsWithId(effect, CHARGE_EFFECT_ID)) return true;
    return effect?.name === "Effect: Witch's Charge";
}

export { CHARGE_EFFECT_UUID, isChargeEffect };
