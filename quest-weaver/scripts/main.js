/**
 * Quest Weaver: entry point.
 *
 * Registration order matters: data models must be on CONFIG before any document
 * of our subtypes is prepared, which means `init` and nothing later.
 */

import { buildApi } from "./api.js";
import { FLAG, LOG, MODULE_ID, SETTING, TYPE } from "./config.js";
import { QuestLogApp, registerQuestLogHooks } from "./apps/quest-log.js";
import { StoryWebApp, registerStoryWebHooks } from "./apps/story-web.js";
import { QuestPageSheet, registerQuestSheet, registerQuestSheetHooks } from "./apps/quest-sheet.js";
import { QuestModel } from "./data/quest-model.js";
import { SecretsModel } from "./data/secrets-model.js";
import { StoryWebModel } from "./data/storyweb-model.js";
import { QuestSocket } from "./core/socket.js";
import { Vault } from "./core/vault.js";
import { registerSettings } from "./settings.js";

Hooks.once("init", () => {
  Object.assign(CONFIG.JournalEntryPage.dataModels, {
    [TYPE.quest]: QuestModel,
    [TYPE.secrets]: SecretsModel,
    [TYPE.storyweb]: StoryWebModel,
  });

  registerSettings();
  registerQuestSheet();
  registerQuestSheetHooks();
  registerQuestLogHooks();
  registerStoryWebHooks();

  game.keybindings.register(MODULE_ID, "openLog", {
    name: "QW.Keybind.OpenLog",
    editable: [{ key: "KeyQ", modifiers: ["Control"] }],
    onDown: () => {
      QuestLogApp.open();
      return true;
    },
  });

  game.keybindings.register(MODULE_ID, "openWeb", {
    name: "QW.Keybind.OpenWeb",
    editable: [{ key: "KeyW", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => {
      StoryWebApp.open();
      return true;
    },
  });

  game.modules.get(MODULE_ID).api = buildApi();
  console.log(`${LOG} initialised`);
});

Hooks.once("ready", () => {
  QuestSocket.listen();
});

/**
 * Deleting a quest's JournalEntry must take its vault page with it, otherwise
 * the vault silently accumulates orphaned secrets.
 */
Hooks.on("preDeleteJournalEntry", (entry) => {
  if (!game.user.isGM) return;
  if (entry.getFlag(MODULE_ID, FLAG.isQuestEntry) !== true) return;
  for (const page of entry.pages) {
    if (page.type === TYPE.quest) Vault.purgeSecrets(page.uuid);
  }
});

/**
 * Quest entries are managed through the Quest Log window, so a GM can opt to
 * keep them out of the Journal sidebar, so you are not scrolling past dozens of them.
 */
Hooks.on("renderJournalDirectory", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;

  if (game.settings.get(MODULE_ID, SETTING.hideFromSidebar)) {
    for (const entry of game.journal) {
      if (entry.getFlag(MODULE_ID, FLAG.isQuestEntry) !== true) continue;
      root.querySelector(`[data-entry-id="${entry.id}"]`)?.classList.add("qw-hidden-entry");
    }
  }

  // A button in the Journal sidebar is the least surprising place to find the
  // log, since that is where the quests themselves live.
  if (root.querySelector(".qw-open-log")) return;
  const header = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!header) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "qw-open-log";
  button.innerHTML = `<i class="fa-solid fa-scroll"></i> ${game.i18n.localize("QW.Log.Title")}`;
  button.addEventListener("click", () => QuestLogApp.open());
  header.append(button);
});

/** A scene control so the log is reachable without the sidebar. */
Hooks.on("getSceneControlButtons", (controls) => {
  const notes = controls.notes ?? controls.journal;
  if (!notes?.tools) return;
  if (game.user.isGM) {
    notes.tools.questWeaverWeb = {
      name: "questWeaverWeb",
      title: "QW.Control.StoryWeb",
      icon: "fa-solid fa-diagram-project",
      button: true,
      onChange: () => StoryWebApp.open(),
    };
  }
  notes.tools.questWeaver = {
    name: "questWeaver",
    title: "QW.Control.QuestLog",
    icon: "fa-solid fa-scroll",
    button: true,
    onChange: () => QuestLogApp.open(),
  };
});

export { QuestLogApp, QuestPageSheet, StoryWebApp };
