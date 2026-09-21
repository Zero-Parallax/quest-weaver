/**
 * Quest Weaver: the award dialog.
 *
 * Shows the split before it happens. Every control re-plans immediately, so the
 * table sees the same figures the GM is about to commit.
 */

import { MODULE_ID } from "../config.js";
import { QuestRepository } from "../core/quest-repository.js";
import { Award } from "../rewards/award.js";
import { activeAdapter } from "../rewards/adapters/index.js";
import { formatCurrency } from "../rewards/currency.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AwardDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["quest-weaver", "qw-award"],
    window: { title: "QW.Award.Title", icon: "fa-solid fa-sack-dollar", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      award: AwardDialog.#onAward,
      addRecipient: AwardDialog.#onAddRecipient,
      removeRecipient: AwardDialog.#onRemoveRecipient,
    },
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/award-dialog.hbs`, scrollable: [""] },
  };

  constructor(quest, options = {}) {
    super(options);
    this.quest = quest;
    this.recipients = AwardDialog.#defaultRecipients(quest);
    this.currencyMode = "equal";
    this.remainderTo = "spread";
    this.xpMode = "divide";
    this.itemAssignments = {};
  }

  /** Open the dialog for a quest, or explain why there is nothing to give. */
  static open(quest) {
    if (!quest) return null;
    const dialog = new AwardDialog(quest);
    if (dialog.plan().empty) {
      ui.notifications.info(game.i18n.localize("QW.Award.NothingToAward"));
      return null;
    }
    return dialog.render(true);
  }

  /**
   * Start from the assigned party. Failing that, every character a player owns,
   * which is the usual shape of a table.
   */
  static #defaultRecipients(quest) {
    const assigned = quest.system.assigned.actors.filter((uuid) => fromUuidSync(uuid));
    if (assigned.length) return [...assigned];
    return game.actors
      .filter((a) => a.hasPlayerOwner)
      .map((a) => a.uuid);
  }

  /** The current plan, rebuilt from the live control state. */
  plan() {
    return Award.buildPlan(this.quest, {
      recipients: this.recipients,
      currencyMode: this.currencyMode,
      remainderTo: this.remainderTo,
      soleRecipient: this.remainderTo !== "spread" ? this.remainderTo : this.recipients[0],
      xpMode: this.xpMode,
      itemAssignments: this.itemAssignments,
    });
  }

  /** @inheritDoc */
  async _prepareContext() {
    const plan = this.plan();
    const adapter = activeAdapter();
    const chosen = new Set(this.recipients);

    return {
      quest: this.quest,
      plan,
      adapter,
      currencyMode: this.currencyMode,
      remainderTo: this.remainderTo,
      xpMode: this.xpMode,
      potLabel: formatCurrency(plan.totals.currency),
      hasCurrency: plan.totals.currencyBase > 0,
      hasXP: plan.totals.xp > 0,
      // Anyone not already receiving, so the GM can add a latecomer.
      candidates: game.actors
        .filter((a) => !chosen.has(a.uuid))
        .map((a) => ({ uuid: a.uuid, name: a.name })),
      warnings: [
        plan.totals.currencyBase > 0 && !adapter.canCurrency ? "QW.Award.ManualCurrency" : null,
        plan.totals.xp > 0 && !adapter.canXP ? "QW.Award.ManualXP" : null,
        this.recipients.length === 0 ? "QW.Award.NoRecipients" : null,
      ].filter(Boolean),
      canAward: this.recipients.length > 0 && !plan.empty,
    };
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    // Every control re-plans, so the preview always matches what will be run.
    for (const el of this.element.querySelectorAll("[data-plan-input]")) {
      el.addEventListener("change", (event) => {
        const field = event.target.dataset.planInput;
        if (field === "itemAssignment") {
          this.itemAssignments[event.target.dataset.rewardId] = event.target.value;
        } else {
          this[field] = event.target.value;
        }
        this.render();
      });
    }
  }

  /* -------------------------------------------- */

  static #onAddRecipient(event, target) {
    const uuid = target.previousElementSibling?.value;
    if (uuid && !this.recipients.includes(uuid)) this.recipients.push(uuid);
    this.render();
  }

  static #onRemoveRecipient(event, target) {
    this.recipients = this.recipients.filter((u) => u !== target.dataset.uuid);
    if (this.remainderTo === target.dataset.uuid) this.remainderTo = "spread";
    this.render();
  }

  static async #onAward() {
    const plan = this.plan();
    try {
      await Award.apply(plan);
      ui.notifications.info(game.i18n.localize("QW.Award.Done"));
    } catch (err) {
      ui.notifications.error(err.message);
      console.error("Quest Weaver | award failed", err);
    }
    // Re-read the quest so a second open reflects what was just handed out.
    this.quest = QuestRepository.get(plan.questUuid) ?? this.quest;
    await this.close();
  }
}
