/**
 * Quest Weaver: Nimble adapter.
 *
 * Verified against the installed nimble 0.9.0 system: character currency lives
 * at `system.currency.{gp,sp,cp}.value` and carries a label field alongside the
 * value. Nimble levels through play and has no experience track, so XP
 * rewards are recorded and announced, not written to a sheet.
 */

const DENOMINATIONS = [
  { key: "gp", label: "Gold", rate: 100 },
  { key: "sp", label: "Silver", rate: 10 },
  { key: "cp", label: "Copper", rate: 1 },
];

export const nimbleAdapter = {
  id: "nimble",
  label: "Nimble",
  matches: (systemId) => systemId === "nimble",

  denominations: () => DENOMINATIONS,
  quantityPath: "system.quantity",
  canCurrency: true,
  canXP: false,

  getCurrency(actor) {
    const out = {};
    for (const d of DENOMINATIONS) {
      out[d.key] = Number(actor.system?.currency?.[d.key]?.value ?? 0);
    }
    return out;
  },

  async applyCurrency(actor, deltas) {
    const update = {};
    for (const [key, amount] of Object.entries(deltas)) {
      if (!amount) continue;
      const current = Number(actor.system?.currency?.[key]?.value ?? 0);
      update[`system.currency.${key}.value`] = current + amount;
    }
    if (Object.keys(update).length) await actor.update(update);
    return update;
  },

  async applyXP() {
    return null; // Nimble has no XP field.
  },
};
