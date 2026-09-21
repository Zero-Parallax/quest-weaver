/**
 * Quest Weaver: awarding rewards.
 *
 * Building the plan and applying it are kept apart on purpose: the dialog shows
 * the GM exactly the plan it is about to run, so nothing is handed out that was
 * not on screen first.
 *
 * Only revealed rewards can be awarded. Anything still in the vault has not been
 * shown to the players, so handing it over would be a reveal by the back door.
 */

import { MODULE_ID, SETTING } from "../config.js";
import { QuestRepository, rewardUpdates } from "../core/quest-repository.js";
import { activeAdapter, applyItems } from "./adapters/index.js";
import { formatCurrency, splitCurrency, splitXP } from "./currency.js";

/**
 * Work out who gets what.
 *
 * @param {Quest} quest
 * @param {object} options
 * @param {string[]} options.recipients        Actor UUIDs, in display order.
 * @param {"equal"|"single"} [options.currencyMode]
 * @param {string} [options.remainderTo]       Actor UUID, or "spread".
 * @param {string} [options.soleRecipient]     Actor UUID when currencyMode is "single".
 * @param {"divide"|"each"} [options.xpMode]
 * @param {Record<string, string>} [options.itemAssignments]  reward id → actor UUID.
 * @returns {object} a plan the dialog can render and `apply` can run
 */
export function buildPlan(quest, options = {}) {
  const {
    recipients = [],
    currencyMode = "equal",
    remainderTo = "spread",
    soleRecipient = null,
    xpMode = "divide",
    itemAssignments = {},
  } = options;

  const rewards = quest.system.rewards;
  const adapter = activeAdapter();

  // Only revealed rewards are on the table, and nothing is handed out twice.
  const items = rewards.items.filter((i) => !i.awarded);
  const custom = rewards.custom.filter((c) => !c.awarded);
  const currencyPot = rewards.currency.awarded ? {} : rewards.currency.amounts;
  const xpPot = rewards.xp.awarded ? 0 : rewards.xp.value;

  const { shares: currencyShares, base } = splitCurrency(currencyPot, recipients, {
    mode: currencyMode,
    remainderTo,
    soleRecipient,
  });
  const xpShares = splitXP(xpPot, recipients, { mode: xpMode });

  const rows = recipients.map((uuid) => {
    const actor = fromUuidSync(uuid);
    const assigned = items.filter((i) => (itemAssignments[i.id] ?? recipients[0]) === uuid);
    return {
      uuid,
      name: actor?.name ?? game.i18n.localize("QW.Award.UnknownActor"),
      img: actor?.img,
      currency: currencyShares[uuid] ?? {},
      currencyLabel: formatCurrency(currencyShares[uuid] ?? {}),
      xp: xpShares[uuid] ?? 0,
      // `uuid` must survive into the plan: it is what applyItems resolves.
      items: assigned.map((i) => ({ id: i.id, uuid: i.uuid, name: i.name, img: i.img, qty: i.qty })),
    };
  });

  return {
    questUuid: quest.uuid,
    questName: quest.name,
    rows,
    custom: custom.map((c) => ({ id: c.id, text: c.text })),
    totals: { currency: currencyPot, currencyBase: base, xp: xpPot, items: items.length },
    adapter: {
      id: adapter.id,
      label: adapter.label,
      canCurrency: adapter.canCurrency,
      canXP: adapter.canXP,
    },
    empty: !base && !xpPot && !items.length && !custom.length,
  };
}

/**
 * Run a plan.
 *
 * Whatever the adapter cannot write to a sheet is still reported on the chat
 * card, so the table can enter it by hand instead of silently losing it.
 */
export async function apply(plan) {
  const quest = QuestRepository.get(plan.questUuid);
  if (!quest) throw new Error(game.i18n.localize("QW.Error.QuestGone"));

  const adapter = activeAdapter();
  const applied = [];

  for (const row of plan.rows) {
    const actor = await fromUuid(row.uuid);
    if (!actor) continue;

    const result = { name: actor.name, img: actor.img, currency: row.currencyLabel, xp: row.xp };

    if (adapter.canCurrency && Object.keys(row.currency).length) {
      await adapter.applyCurrency(actor, row.currency);
      result.currencyApplied = true;
    }
    if (adapter.canXP && row.xp) {
      await adapter.applyXP(actor, row.xp);
      result.xpApplied = true;
    }
    if (row.items.length) {
      result.items = await applyItems(actor, row.items);
    }
    applied.push(result);
  }

  await markAwarded(quest, plan);
  await postCard(quest, plan, applied, adapter);
  return applied;
}

/** Flag everything in the plan as handed out so it cannot be awarded twice. */
async function markAwarded(quest, plan) {
  const rewards = quest.page.system.toObject().rewards;
  const awardedItems = new Set(plan.rows.flatMap((r) => r.items.map((i) => i.id)));
  const recipientNames = new Map(
    plan.rows.flatMap((r) => r.items.map((i) => [i.id, r.name])),
  );

  for (const item of rewards.items) {
    if (!awardedItems.has(item.id)) continue;
    item.awarded = true;
    item.awardedTo = recipientNames.get(item.id) ?? "";
  }
  for (const entry of rewards.custom) {
    if (plan.custom.some((c) => c.id === entry.id)) entry.awarded = true;
  }
  if (plan.totals.currencyBase > 0) rewards.currency.awarded = true;
  if (plan.totals.xp > 0) rewards.xp.awarded = true;

  await quest.page.update(rewardUpdates("system.rewards", rewards));
}

/** Announce the award, flagging anything the GM still has to enter by hand. */
async function postCard(quest, plan, applied, adapter) {
  if (!game.settings.get(MODULE_ID, SETTING.chatOnAward)) return;

  const manual = [];
  if (plan.totals.currencyBase > 0 && !adapter.canCurrency) {
    manual.push(game.i18n.localize("QW.Award.ManualCurrency"));
  }
  if (plan.totals.xp > 0 && !adapter.canXP) {
    manual.push(game.i18n.localize("QW.Award.ManualXP"));
  }

  const rows = applied
    .map((r) => {
      const bits = [];
      if (r.currency) bits.push(r.currency);
      if (r.xp) bits.push(`${r.xp} XP`);
      if (r.items?.length) bits.push(r.items.join(", "));
      if (!bits.length) return "";
      return `<li><strong>${foundry.utils.escapeHTML(r.name)}</strong>: ${foundry.utils.escapeHTML(
        bits.join(" · "),
      )}</li>`;
    })
    .join("");

  const customRows = plan.custom
    .map((c) => `<li><i class="fa-solid fa-gift"></i> ${foundry.utils.escapeHTML(c.text)}</li>`)
    .join("");

  await ChatMessage.implementation.create({
    content: `<div class="quest-weaver qw-chat qw-award-card">
      <h4><i class="fa-solid fa-sack-dollar"></i> ${foundry.utils.escapeHTML(quest.name)}</h4>
      <ul class="qw-award-list">${rows}${customRows}</ul>
      ${
        manual.length
          ? `<p class="qw-award-manual"><i class="fa-solid fa-triangle-exclamation"></i> ${manual.join(
              " ",
            )}</p>`
          : ""
      }
    </div>`,
  });
}

export const Award = { buildPlan, apply };
