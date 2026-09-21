/**
 * Quest Weaver: quest lifecycle.
 *
 * Status changes are funnelled through here instead of written directly, so
 * the chat announcement and chain progression happen once and in one place.
 */

import { MODULE_ID, SETTING, STATUS, STATUS_META } from "../config.js";
import { QuestRepository } from "./quest-repository.js";

/** Statuses that count as the quest being finished one way or another. */
const TERMINAL = new Set([STATUS.completed, STATUS.failed, STATUS.abandoned]);

export class Status {
  /**
   * Move a quest to a new status.
   *
   * @param {Quest} quest
   * @param {string} status
   * @param {object} [options]
   * @param {boolean} [options.silent] Skip the chat announcement.
   */
  static async set(quest, status, { silent = false } = {}) {
    if (!STATUS_META[status]) throw new Error(`Quest Weaver | unknown status "${status}"`);
    const previous = quest.status;
    if (previous === status) return quest;

    await quest.page.update({ "system.status": status });

    if (!silent) await Status.#announce(quest, status, previous);
    if (status === STATUS.completed) await Status.#advanceChain(quest);
    return quest;
  }

  /** Post a status card, unless the quest is invisible to everyone anyway. */
  static async #announce(quest, status, previous) {
    if (!game.settings.get(MODULE_ID, SETTING.chatOnStatusChange)) return;
    if (quest.isHidden) return;
    if (status === STATUS.draft) return;

    const meta = STATUS_META[status];
    await ChatMessage.implementation.create({
      content: `<div class="quest-weaver qw-chat">
        <strong>${foundry.utils.escapeHTML(quest.name)}</strong><br>
        <span class="qw-chat-status" style="--qw-chip:${meta.color}">
          <i class="fa-solid ${meta.icon}"></i>
          ${game.i18n.format("QW.Chat.StatusChanged", {
            from: game.i18n.localize(`QW.Status.${previous}`),
            to: game.i18n.localize(`QW.Status.${status}`),
          })}
        </span>
      </div>`,
    });
  }

  /**
   * Promote any draft quest whose prerequisites are now all complete.
   *
   * Off by default: a GM who has authored a chain may still want to decide by
   * hand when the next link appears.
   */
  static async #advanceChain(quest) {
    if (!game.settings.get(MODULE_ID, SETTING.autoUnlock)) return;

    const all = QuestRepository.all();
    const completed = new Set(
      all.filter((q) => q.status === STATUS.completed).map((q) => q.uuid),
    );

    for (const candidate of all) {
      if (candidate.status !== STATUS.draft) continue;
      const requires = candidate.system.links.requires;
      if (!requires.length) continue;
      if (!requires.includes(quest.uuid)) continue;
      if (!requires.every((uuid) => completed.has(uuid))) continue;

      await Status.set(candidate, STATUS.available, { silent: true });
      ui.notifications.info(
        game.i18n.format("QW.Notify.ChainAdvanced", { name: candidate.name }),
      );
    }
  }

  /** True when the quest can no longer be worked on. */
  static isTerminal(status) {
    return TERMINAL.has(status);
  }
}
