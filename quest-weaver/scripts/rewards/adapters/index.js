/**
 * Quest Weaver: award adapters.
 *
 * Handing out loot is the one place a system-agnostic module cannot stay
 * agnostic: every system keeps money and experience somewhere different, and
 * some (Pathfinder 2e, for one) do not use fields at all. Each adapter says what
 * it can do, and the award flow degrades to "write it on the card" for the rest.
 *
 * Items are the exception, since creating an embedded Item works everywhere, so no
 * adapter has to implement it.
 */

import { MODULE_ID, SETTING } from "../../config.js";
import { genericAdapter } from "./generic.js";
import { nimbleAdapter } from "./nimble.js";
import { dnd5eAdapter } from "./dnd5e.js";

/** Adapters in priority order. The generic one always matches, so it is last. */
const ADAPTERS = [nimbleAdapter, dnd5eAdapter, genericAdapter];

/** Every adapter, for the settings dropdown. */
export function listAdapters() {
  return ADAPTERS.map((a) => ({ id: a.id, label: a.label }));
}

/**
 * The adapter in force: whichever the GM pinned in settings, or the first that
 * claims the active system.
 */
export function activeAdapter() {
  const pinned = game.settings.get(MODULE_ID, SETTING.adapter);
  if (pinned && pinned !== "auto") {
    const found = ADAPTERS.find((a) => a.id === pinned);
    if (found) return found;
  }
  return ADAPTERS.find((a) => a.matches(game.system.id)) ?? genericAdapter;
}

/**
 * Add items to an actor. System-agnostic: the source item's own data is copied,
 * with the quantity written to whatever path the adapter names.
 *
 * @param {Actor} actor
 * @param {{uuid: string, name: string, qty: number}[]} rewards
 * @returns {Promise<string[]>} names of the items actually created
 */
export async function applyItems(actor, rewards) {
  const adapter = activeAdapter();
  const toCreate = [];

  for (const reward of rewards) {
    const source = reward.uuid ? await fromUuid(reward.uuid) : null;
    if (!source) {
      // The source item is gone; say so instead of inventing a replacement.
      console.warn(`Quest Weaver | reward item "${reward.name}" could not be resolved`);
      continue;
    }
    const data = source.toObject();
    delete data._id;
    if (adapter.quantityPath && reward.qty > 1) {
      foundry.utils.setProperty(data, adapter.quantityPath, reward.qty);
    }
    toCreate.push(data);
  }

  if (!toCreate.length) return [];
  const created = await Item.implementation.createDocuments(toCreate, { parent: actor });
  return created.map((i) => i.name);
}
