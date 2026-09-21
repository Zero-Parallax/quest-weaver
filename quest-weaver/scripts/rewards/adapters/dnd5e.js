/**
 * Quest Weaver: D&D 5e adapter.
 *
 * Currency is a flat `system.currency.<coin>` and experience sits at
 * `system.details.xp.value`. Both have been stable across 5e system versions.
 */

const DENOMINATIONS = [
  { key: "pp", label: "Platinum", rate: 1000 },
  { key: "gp", label: "Gold", rate: 100 },
  { key: "ep", label: "Electrum", rate: 50 },
  { key: "sp", label: "Silver", rate: 10 },
  { key: "cp", label: "Copper", rate: 1 },
];

export const dnd5eAdapter = {
  id: "dnd5e",
  label: "D&D 5e",
  matches: (systemId) => systemId === "dnd5e",

  denominations: () => DENOMINATIONS,
  quantityPath: "system.quantity",
  canCurrency: true,
  canXP: true,

  getCurrency(actor) {
    const out = {};
    for (const d of DENOMINATIONS) out[d.key] = Number(actor.system?.currency?.[d.key] ?? 0);
    return out;
  },

  async applyCurrency(actor, deltas) {
    const update = {};
    for (const [key, amount] of Object.entries(deltas)) {
      if (!amount) continue;
      update[`system.currency.${key}`] = Number(actor.system?.currency?.[key] ?? 0) + amount;
    }
    if (Object.keys(update).length) await actor.update(update);
    return update;
  },

  async applyXP(actor, amount) {
    if (!amount) return null;
    const current = Number(actor.system?.details?.xp?.value ?? 0);
    await actor.update({ "system.details.xp.value": current + amount });
    return current + amount;
  },
};
