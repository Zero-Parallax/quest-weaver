/**
 * Quest Weaver: the Quest Log window.
 *
 * The Job Board is a card grid of quests on offer; the other tabs are the
 * lifecycle. A player sees only quests their client was given and only the
 * revealed parts of them, because that is all a quest document carries.
 */

import { MODULE_ID, SETTING, STATUS, STATUS_LIST, STATUS_META } from "../config.js";
import { canCreateQuests } from "../settings.js";
import { QuestRepository } from "../core/quest-repository.js";
import { QuestSocket } from "../core/socket.js";
import { Status } from "../core/status.js";
import { AwardDialog } from "./award-dialog.js";
import { ImportExportDialog, exportQuest } from "./import-export.js";
import { StoryWebApp } from "./story-web.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Tabs in display order. `board` is not a status; it filters on `posted`. */
const TAB_IDS = ["board", STATUS.active, STATUS.completed, STATUS.failed, STATUS.abandoned];

/**
 * Read-only sheets for quests the viewer does not own, cached per page so a
 * second click focuses the open window instead of stacking another one.
 */
const viewSheets = new Map();

/** Open a quest: the editor for an owner, the player-facing view for anyone else. */
export function openQuestSheet(quest) {
  if (quest.page.isOwner) return quest.page.sheet.render(true);

  let sheet = viewSheets.get(quest.uuid);
  if (!sheet || sheet.document !== quest.page) {
    const SheetClass = quest.page.sheet.constructor;
    sheet = new SheetClass({ document: quest.page, mode: "view" });
    viewSheets.set(quest.uuid, sheet);
  }
  return sheet.render(true);
}

export class QuestLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "quest-weaver-log",
    classes: ["quest-weaver", "qw-log"],
    window: {
      title: "QW.Log.Title",
      icon: "fa-solid fa-scroll",
      resizable: true,
      contentClasses: ["qw-log-content"],
    },
    position: { width: 820, height: 760 },
    actions: {
      openQuest: QuestLogApp.#onOpenQuest,
      newQuest: QuestLogApp.#onNewQuest,
      setStatus: QuestLogApp.#onSetStatus,
      acceptQuest: QuestLogApp.#onAcceptQuest,
      abandonQuest: QuestLogApp.#onAbandonQuest,
      toggleMilestone: QuestLogApp.#onToggleMilestone,
      toggleVisibility: QuestLogApp.#onToggleVisibility,
      deleteQuest: QuestLogApp.#onDeleteQuest,
      awardQuest: QuestLogApp.#onAwardQuest,
      openImportExport: QuestLogApp.#onOpenImportExport,
      openStoryWeb: QuestLogApp.#onOpenStoryWeb,
      clearSearch: QuestLogApp.#onClearSearch,
      filterTag: QuestLogApp.#onFilterTag,
    },
  };

  /** @override */
  static PARTS = {
    toolbar: { template: `modules/${MODULE_ID}/templates/quest-log-toolbar.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    body: {
      template: `modules/${MODULE_ID}/templates/quest-log-body.hbs`,
      templates: [
        `modules/${MODULE_ID}/templates/parts/quest-row.hbs`,
        `modules/${MODULE_ID}/templates/parts/job-card.hbs`,
      ],
      scrollable: [".qw-tab-body"],
    },
  };

  /** @override */
  static TABS = {
    primary: {
      initial: "board",
      labelPrefix: "QW.Tab",
      tabs: TAB_IDS.map((id) => ({
        id,
        icon: `fa-solid ${id === "board" ? "fa-clipboard-list" : STATUS_META[id].icon}`,
      })),
    },
  };

  /** Free-text filter, kept across re-renders. */
  #search = "";

  /** Tag filter, or null for no tag filter. */
  #tag = null;

  /** The single shared instance, so the keybinding and button agree. */
  static #instance = null;

  /** Open the log, bringing an existing window forward instead of stacking another. */
  static open() {
    QuestLogApp.#instance ??= new QuestLogApp();
    if (QuestLogApp.#instance.rendered) QuestLogApp.#instance.bringToFront();
    else QuestLogApp.#instance.render(true);
    return QuestLogApp.#instance;
  }

  /** Re-render the open log, if there is one. */
  static refresh() {
    if (QuestLogApp.#instance?.rendered) QuestLogApp.#instance.render();
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const all = QuestRepository.all().filter((q) => this.#matches(q));

    // Drafts are a GM-only staging area, so they are kept out of the tabs a
    // player shares and given their own when the viewer is a GM.
    const drafts = isGM ? all.filter((q) => q.status === STATUS.draft) : [];

    const byTab = {
      board: all.filter((q) => q.system.posted && !Status.isTerminal(q.status)),
      [STATUS.active]: all.filter((q) => q.status === STATUS.active),
      [STATUS.completed]: all.filter((q) => q.status === STATUS.completed),
      [STATUS.failed]: all.filter((q) => q.status === STATUS.failed),
      [STATUS.abandoned]: all.filter((q) => q.status === STATUS.abandoned),
    };
    if (isGM) {
      byTab.draft = drafts;
      context.tabs.draft = {
        group: "primary",
        id: "draft",
        active: this.tabGroups.primary === "draft",
        cssClass: this.tabGroups.primary === "draft" ? "active" : "",
        icon: `fa-solid ${STATUS_META.draft.icon}`,
        label: "QW.Tab.draft",
      };
    }

    Object.assign(context, {
      isGM,
      search: this.#search,
      tag: this.#tag,
      tags: this.#allTags(),
      statuses: STATUS_LIST.map((s) => ({ id: s, ...STATUS_META[s] })),
      canAccept: game.settings.get(MODULE_ID, SETTING.playersCanAccept),
      canAbandon: game.settings.get(MODULE_ID, SETTING.playersCanAbandon),
      canTick: isGM || game.settings.get(MODULE_ID, SETTING.playersCanToggleMilestones),
      canCreate: canCreateQuests(),
      sections: Object.entries(byTab).map(([id, quests]) => ({
        id,
        active: this.tabGroups.primary === id,
        isBoard: id === "board",
        quests: quests.map((q) => this.#row(q)),
      })),
      total: all.length,
    });
    return context;
  }

  /** Everything a row or card needs, flattened so the template stays dumb. */
  #row(quest) {
    const s = quest.system;
    const meta = STATUS_META[s.status] ?? STATUS_META.draft;
    const coins = Object.entries(s.rewards.currency.amounts).filter(([, v]) => v > 0);

    return {
      uuid: quest.uuid,
      name: quest.name,
      img: s.img,
      banner: s.banner,
      summary: s.summary,
      status: s.status,
      statusLabel: `QW.Status.${s.status}`,
      icon: meta.icon,
      color: meta.color,
      difficulty: s.difficulty,
      location: s.location,
      deadline: s.deadline,
      tags: s.tags,
      giver: s.giver,
      progress: s.progress,
      milestones: s.milestones.map((m) => ({ ...m })),
      coins: coins.map(([key, value]) => ({ key, value })),
      xp: s.rewards.xp.value,
      items: s.rewards.items.map((i) => ({ name: i.name, img: i.img, qty: i.qty })),
      custom: s.rewards.custom.map((c) => c.text),
      hasRewards: s.hasRewards,
      assignees: s.assigned.actors
        .map((uuid) => fromUuidSync(uuid))
        .filter(Boolean)
        .map((a) => ({ name: a.name, img: a.img })),
      suggestedBy: s.suggested.by,
      suggestedReward: s.suggested.reward,
      isHidden: quest.isHidden,
      isMine: quest.system.assigned.actors.some((uuid) =>
        fromUuidSync(uuid)?.testUserPermission(game.user, "OWNER"),
      ),
      canEdit: quest.page.isOwner,
    };
  }

  /** Apply the search box and tag filter. */
  #matches(quest) {
    if (this.#tag && !quest.system.tags.includes(this.#tag)) return false;
    if (!this.#search) return true;
    const needle = this.#search.toLowerCase();
    const haystack = [
      quest.name,
      quest.system.location,
      quest.system.giver.name,
      quest.system.difficulty,
      ...quest.system.tags,
      ...quest.system.milestones.map((m) => m.text),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  }

  /** Every tag in use, for the filter row. */
  #allTags() {
    const tags = new Set();
    for (const quest of QuestRepository.all()) {
      for (const tag of quest.system.tags) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const search = this.element.querySelector('[name="qw-search"]');
    if (search) {
      // Re-render on a pause, not on every keystroke, and put the caret back
      // where it was so typing is not interrupted.
      let timer = null;
      search.addEventListener("input", (event) => {
        this.#search = event.target.value;
        clearTimeout(timer);
        timer = setTimeout(() => this.render(), 250);
      });
      if (this.#search) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    }

    if (game.user.isGM) this.#bindContextMenu();
  }

  /** Right-click a quest for the status and visibility controls. */
  #bindContextMenu() {
    const entries = [
      ...STATUS_LIST.map((status) => ({
        name: game.i18n.format("QW.Log.SetStatus", {
          status: game.i18n.localize(`QW.Status.${status}`),
        }),
        icon: `<i class="fa-solid ${STATUS_META[status].icon}" style="color:${STATUS_META[status].color}"></i>`,
        condition: (el) => QuestLogApp.#questFor(el)?.status !== status,
        callback: async (el) => {
          const quest = QuestLogApp.#questFor(el);
          if (quest) await Status.set(quest, status);
          this.render();
        },
      })),
      {
        name: "QW.Log.ToggleVisibility",
        icon: '<i class="fa-solid fa-eye"></i>',
        callback: async (el) => {
          const quest = QuestLogApp.#questFor(el);
          if (!quest) return;
          await (quest.isHidden
            ? QuestRepository.setVisibility(quest)
            : QuestRepository.hide(quest));
          this.render();
        },
      },
      {
        name: "QW.Award.Title",
        icon: '<i class="fa-solid fa-sack-dollar"></i>',
        callback: (el) => AwardDialog.open(QuestLogApp.#questFor(el)),
      },
      {
        name: "QW.IO.ExportQuest",
        icon: '<i class="fa-solid fa-file-export"></i>',
        callback: (el) => exportQuest(QuestLogApp.#questFor(el)),
      },
      {
        name: "QW.IO.ExportQuestSafe",
        icon: '<i class="fa-solid fa-user-shield"></i>',
        callback: (el) => exportQuest(QuestLogApp.#questFor(el), { playerSafe: true }),
      },
      {
        name: "QW.Log.Delete",
        icon: '<i class="fa-solid fa-trash"></i>',
        callback: (el) => QuestLogApp.#confirmDelete(QuestLogApp.#questFor(el), this),
      },
    ];

    new foundry.applications.ux.ContextMenu.implementation(
      this.element,
      "[data-quest-uuid]",
      entries,
      { jQuery: false, fixed: true },
    );
  }

  /** The quest a clicked element belongs to. */
  static #questFor(element) {
    const uuid = element?.closest("[data-quest-uuid]")?.dataset.questUuid;
    return uuid ? QuestRepository.get(uuid) : null;
  }

  static async #confirmDelete(quest, app) {
    if (!quest) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "QW.Log.Delete" },
      content: `<p>${game.i18n.format("QW.Log.DeleteConfirm", {
        name: foundry.utils.escapeHTML(quest.name),
      })}</p>`,
    });
    if (!ok) return;
    await QuestRepository.delete(quest);
    app.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onOpenQuest(event, target) {
    const quest = QuestLogApp.#questFor(target);
    if (quest) openQuestSheet(quest);
  }

  static async #onNewQuest() {
    if (game.user.isGM) {
      const quest = await QuestRepository.create({});
      this.render();
      quest.page.sheet.render(true);
      return;
    }
    await QuestLogApp.#proposeQuest();
    this.render();
  }

  /**
   * The player-facing version: a short form, not the GM's full editor,
   * since a player is describing something they want to track, not authoring
   * milestones and loot.
   */
  static async #proposeQuest() {
    const content = `
      <div class="qw-propose">
        <p class="hint">${game.i18n.localize("QW.Propose.Hint")}</p>
        <label><span>${game.i18n.localize("QW.Propose.Name")}</span>
          <input type="text" name="name" autofocus></label>
        <label><span>${game.i18n.localize("QW.Propose.Description")}</span>
          <textarea name="description" rows="4"></textarea></label>
        <label><span>${game.i18n.localize("QW.Propose.Reward")}</span>
          <input type="text" name="reward"
                 placeholder="${game.i18n.localize("QW.Propose.RewardPlaceholder")}"></label>
      </div>`;

    const data = await foundry.applications.api.DialogV2.prompt({
      window: { title: "QW.Propose.Title", icon: "fa-solid fa-feather" },
      classes: ["quest-weaver"],
      position: { width: 480 },
      content,
      ok: {
        label: "QW.Propose.Submit",
        icon: "fa-solid fa-paper-plane",
        callback: (event, button) => new FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
    if (!data) return; // Cancelled.
    if (!data.name?.trim()) {
      const { reportProblems } = await import("../ui/validation.js");
      return reportProblems([game.i18n.localize("QW.Validate.NeedsNameProposal")], {
        title: "QW.Propose.Title",
      });
    }

    try {
      await QuestSocket.request("proposeQuest", data);
      ui.notifications.info(game.i18n.localize("QW.Propose.Sent"));
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  static async #onSetStatus(event, target) {
    const quest = QuestLogApp.#questFor(target);
    if (!quest) return;
    await Status.set(quest, target.dataset.status);
    this.render();
  }

  static async #onAcceptQuest(event, target) {
    const uuid = target.closest("[data-quest-uuid]")?.dataset.questUuid;
    try {
      const result = await QuestSocket.request("acceptQuest", { questUuid: uuid });
      ui.notifications.info(
        game.i18n.format("QW.Notify.Accepted", { name: result?.accepted ?? "" }),
      );
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    this.render();
  }

  static async #onAbandonQuest(event, target) {
    const uuid = target.closest("[data-quest-uuid]")?.dataset.questUuid;
    try {
      await QuestSocket.request("abandonQuest", { questUuid: uuid });
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    this.render();
  }

  static async #onToggleMilestone(event, target) {
    const uuid = target.closest("[data-quest-uuid]")?.dataset.questUuid;
    try {
      await QuestSocket.request("toggleMilestone", {
        questUuid: uuid,
        milestoneId: target.dataset.milestoneId,
        done: target.checked ?? undefined,
      });
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    this.render();
  }

  static async #onToggleVisibility(event, target) {
    const quest = QuestLogApp.#questFor(target);
    if (!quest) return;
    await (quest.isHidden ? QuestRepository.setVisibility(quest) : QuestRepository.hide(quest));
    this.render();
  }

  static #onOpenImportExport() {
    ImportExportDialog.open();
  }

  static #onOpenStoryWeb() {
    StoryWebApp.open();
  }

  static async #onAwardQuest(event, target) {
    AwardDialog.open(QuestLogApp.#questFor(target));
  }

  static async #onDeleteQuest(event, target) {
    await QuestLogApp.#confirmDelete(QuestLogApp.#questFor(target), this);
  }

  static #onClearSearch() {
    this.#search = "";
    this.#tag = null;
    this.render();
  }

  static #onFilterTag(event, target) {
    const tag = target.dataset.tag;
    this.#tag = this.#tag === tag ? null : tag;
    this.render();
  }
}

/** Keep the log in step with document changes from any client. */
export function registerQuestLogHooks() {
  const refresh = () => QuestLogApp.refresh();
  Hooks.on("questWeaverRefresh", refresh);
  for (const hook of [
    "createJournalEntry",
    "updateJournalEntry",
    "deleteJournalEntry",
    "createJournalEntryPage",
    "updateJournalEntryPage",
    "deleteJournalEntryPage",
  ]) {
    Hooks.on(hook, refresh);
  }
}
