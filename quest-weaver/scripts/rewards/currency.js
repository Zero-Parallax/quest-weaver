/**
 * Quest Weaver: currency maths.
 *
 * Everything works in the smallest configured denomination, so a pot of
 * 3gp 2sp splits three ways without losing a copper to rounding. The functions
 * here are pure and take their denomination table as an argument, which keeps
 * them testable and independent of settings.
 */

import { denominations } from "../settings.js";

/** Denominations largest-first, which is the order every conversion wants. */
export function sortedDenominations(denoms = denominations()) {
  return [...denoms].sort((a, b) => b.rate - a.rate);
}

/** Total value of an `{gp: 3, sp: 2}` purse in the smallest denomination. */
export function toBase(amounts = {}, denoms = denominations()) {
  const rates = Object.fromEntries(denoms.map((d) => [d.key, d.rate]));
  return Object.entries(amounts).reduce(
    (total, [key, value]) => total + (rates[key] ?? 0) * (Number(value) || 0),
    0,
  );
}

/** Expand a base-unit total back into the largest coins that fit. */
export function fromBase(total, denoms = denominations()) {
  const out = {};
  let left = Math.max(0, Math.round(total));
  for (const d of sortedDenominations(denoms)) {
    if (d.rate <= 0) continue;
    const n = Math.floor(left / d.rate);
    if (n > 0) {
      out[d.key] = n;
      left -= n * d.rate;
    }
  }
  return out;
}

/**
 * Divide a base-unit total between `count` shares.
 *
 * The remainder is what makes this fiddly: 10 copper between 3 people is 3 each
 * with 1 left over. `remainder` decides where that last coin goes: spread over
 * the earliest shares, or all of it into one index (the party fund).
 *
 * @param {number} total
 * @param {number} count
 * @param {object} [options]
 * @param {"spread"|number} [options.remainder] "spread", or the index to give it to.
 * @returns {number[]} one base-unit amount per share
 */
export function splitBase(total, count, { remainder = "spread" } = {}) {
  if (count <= 0) return [];
  const each = Math.floor(total / count);
  let left = total - each * count;
  const shares = new Array(count).fill(each);

  if (left > 0) {
    if (Number.isInteger(remainder) && remainder >= 0 && remainder < count) {
      shares[remainder] += left;
    } else {
      for (let i = 0; left > 0; i = (i + 1) % count, left--) shares[i] += 1;
    }
  }
  return shares;
}

/**
 * Split a purse between recipients.
 *
 * @param {Record<string, number>} amounts
 * @param {string[]} recipientIds
 * @param {object} [options]
 * @param {"equal"|"single"} [options.mode]
 * @param {"spread"|string} [options.remainderTo] a recipient id, or "spread"
 * @param {string} [options.soleRecipient] required when mode is "single"
 * @returns {{ shares: Record<string, Record<string, number>>, base: number, perShare: number[] }}
 */
export function splitCurrency(amounts, recipientIds, options = {}) {
  const { mode = "equal", remainderTo = "spread", soleRecipient = null } = options;
  const denoms = denominations();
  const base = toBase(amounts, denoms);

  if (!recipientIds.length || base <= 0) {
    return { shares: {}, base, perShare: [] };
  }

  if (mode === "single") {
    const target = soleRecipient ?? recipientIds[0];
    return {
      shares: { [target]: fromBase(base, denoms) },
      base,
      perShare: recipientIds.map((id) => (id === target ? base : 0)),
    };
  }

  const remainderIndex = recipientIds.indexOf(remainderTo);
  const perShare = splitBase(base, recipientIds.length, {
    remainder: remainderIndex >= 0 ? remainderIndex : "spread",
  });

  const shares = {};
  recipientIds.forEach((id, i) => {
    shares[id] = fromBase(perShare[i], denoms);
  });
  return { shares, base, perShare };
}

/**
 * Split experience. Some tables divide a pot, others hand the same figure to
 * everyone, so both are offered.
 */
export function splitXP(value, recipientIds, { mode = "divide" } = {}) {
  if (!recipientIds.length || value <= 0) return {};
  if (mode === "each") {
    return Object.fromEntries(recipientIds.map((id) => [id, value]));
  }
  const shares = splitBase(value, recipientIds.length);
  return Object.fromEntries(recipientIds.map((id, i) => [id, shares[i]]));
}

/** Render a purse as "3 gp, 2 sp", largest coin first. */
export function formatCurrency(amounts = {}, denoms = denominations()) {
  return sortedDenominations(denoms)
    .filter((d) => (amounts[d.key] ?? 0) > 0)
    .map((d) => `${amounts[d.key]} ${d.key}`)
    .join(", ");
}
