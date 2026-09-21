/**
 * Quest Weaver: generic adapter.
 *
 * The fallback for any system without a dedicated adapter. A GM can point it at
 * their system's data paths in settings; until they do, currency and XP are
 * reported on the award card for the table to enter by hand. Items are still
 * created automatically, because that works everywhere.
 *
 * Configure with, for example:
 *   Currency data paths  {"gp": "system.currency.gp", "sp": "system.currency.sp"}
 *   XP data path         system.details.xp.value
 */

import { MODULE_ID, SETTING } from "../../config.js";
import { defaultDenominations } from "../../settings.js";

/** Parse the GM's path mapping, tolerating an empty or malformed setting. */
function currencyPaths() {
  const raw = game.settings.get(MODULE_ID, SETTING.currencyPaths);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return foundry.utils.isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    console.warn("Quest Weaver | currency data paths are not valid JSON", err);
    return {};
  }
}

function xpPath() {
  return game.settings.get(MODULE_ID, SETTING.xpPath)?.trim() ?? "";
}

export const genericAdapter = {
  id: "generic",
  label: "Generic / configured paths",
  matches: () => true,

  denominations: () => defaultDenominations(),
  quantityPath: "system.quantity",

  get canCurrency() {
    return Object.keys(currencyPaths()).length > 0;
  },

  get canXP() {
    return xpPath().length > 0;
  },

  getCurrency(actor) {
    const out = {};
    for (const [key, path] of Object.entries(currencyPaths())) {
      out[key] = Number(foundry.utils.getProperty(actor, path) ?? 0);
    }
    return out;
  },

  async applyCurrency(actor, deltas) {
    const paths = currencyPaths();
    const update = {};
    for (const [key, amount] of Object.entries(deltas)) {
      if (!amount) continue;
      const path = paths[key];
      if (!path) continue;
      update[path] = Number(foundry.utils.getProperty(actor, path) ?? 0) + amount;
    }
    if (Object.keys(update).length) await actor.update(update);
    return update;
  },

  async applyXP(actor, amount) {
    const path = xpPath();
    if (!path || !amount) return null;
    const current = Number(foundry.utils.getProperty(actor, path) ?? 0);
    await actor.update({ [path]: current + amount });
    return current + amount;
  },
};
