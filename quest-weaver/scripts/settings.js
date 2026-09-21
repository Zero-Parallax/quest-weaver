/**
 * Quest Weaver: world settings.
 *
 * Denominations and data paths are settings rather than constants because
 * systems disagree about money: Nimble has gold/silver/copper and no platinum,
 * 5e adds electrum, and plenty of systems have a single abstract wealth score.
 */

import { MODULE_ID, OWNERSHIP, SETTING } from "./config.js";
import { listAdapters } from "./rewards/adapters/index.js";

/**
 * Coin presets keyed by system id. `rate` is the value in the smallest coin.
 * Anything unrecognised gets the familiar four-coin ladder.
 */
const DENOMINATION_PRESETS = {
  nimble: [
    { key: "gp", label: "Gold", rate: 100 },
    { key: "sp", label: "Silver", rate: 10 },
    { key: "cp", label: "Copper", rate: 1 },
  ],
  dnd5e: [
    { key: "pp", label: "Platinum", rate: 1000 },
    { key: "gp", label: "Gold", rate: 100 },
    { key: "ep", label: "Electrum", rate: 50 },
    { key: "sp", label: "Silver", rate: 10 },
    { key: "cp", label: "Copper", rate: 1 },
  ],
  default: [
    { key: "pp", label: "Platinum", rate: 1000 },
    { key: "gp", label: "Gold", rate: 100 },
    { key: "sp", label: "Silver", rate: 10 },
    { key: "cp", label: "Copper", rate: 1 },
  ],
};

export function defaultDenominations() {
  return DENOMINATION_PRESETS[game.system?.id] ?? DENOMINATION_PRESETS.default;
}

/** Parsed denomination list, falling back to the preset if the JSON is broken. */
export function denominations() {
  const raw = game.settings.get(MODULE_ID, SETTING.denominations);
  if (!raw) return defaultDenominations();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (err) {
    console.warn(`Quest Weaver | denominations setting is not valid JSON, using the preset`, err);
  }
  return defaultDenominations();
}

/** Difficulty suggestions for the quest sheet, as a trimmed list. */
export function difficultyOptions() {
  return (game.settings.get(MODULE_ID, SETTING.difficulties) ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Whether a user may propose their own quests. */
export function canCreateQuests(user = game.user) {
  if (user.isGM) return true;
  const mode = game.settings.get(MODULE_ID, SETTING.playersCanCreate);
  if (mode === "all") return true;
  if (mode === "trusted") return user.isTrusted;
  return false;
}

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", ...data });

  reg(SETTING.folderName, {
    name: "QW.Settings.FolderName.Name",
    hint: "QW.Settings.FolderName.Hint",
    config: true,
    type: String,
    default: "Quest Weaver",
  });

  reg(SETTING.vaultName, {
    name: "QW.Settings.VaultName.Name",
    hint: "QW.Settings.VaultName.Hint",
    config: true,
    type: String,
    default: "Quest Weaver: GM Vault",
  });

  reg(SETTING.hideFromSidebar, {
    name: "QW.Settings.HideFromSidebar.Name",
    hint: "QW.Settings.HideFromSidebar.Hint",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => ui.journal?.render(),
  });

  reg(SETTING.denominations, {
    name: "QW.Settings.Denominations.Name",
    hint: "QW.Settings.Denominations.Hint",
    config: true,
    type: String,
    default: "",
  });

  reg(SETTING.adapter, {
    name: "QW.Settings.Adapter.Name",
    hint: "QW.Settings.Adapter.Hint",
    config: true,
    type: String,
    default: "auto",
    choices: {
      auto: "QW.Settings.Adapter.Auto",
      ...Object.fromEntries(listAdapters().map((a) => [a.id, a.label])),
    },
  });

  reg(SETTING.currencyPaths, {
    name: "QW.Settings.CurrencyPaths.Name",
    hint: "QW.Settings.CurrencyPaths.Hint",
    config: true,
    type: String,
    default: "",
  });

  reg(SETTING.xpPath, {
    name: "QW.Settings.XpPath.Name",
    hint: "QW.Settings.XpPath.Hint",
    config: true,
    type: String,
    default: "",
  });

  reg(SETTING.defaultOwnership, {
    name: "QW.Settings.DefaultOwnership.Name",
    hint: "QW.Settings.DefaultOwnership.Hint",
    config: true,
    type: Number,
    default: OWNERSHIP.NONE,
    choices: {
      [OWNERSHIP.NONE]: "QW.Ownership.None",
      [OWNERSHIP.OBSERVER]: "QW.Ownership.Observer",
    },
  });

  reg(SETTING.playersCanAccept, {
    name: "QW.Settings.PlayersCanAccept.Name",
    hint: "QW.Settings.PlayersCanAccept.Hint",
    config: true,
    type: Boolean,
    default: true,
  });

  reg(SETTING.playersCanAbandon, {
    name: "QW.Settings.PlayersCanAbandon.Name",
    hint: "QW.Settings.PlayersCanAbandon.Hint",
    config: true,
    type: Boolean,
    default: false,
  });

  reg(SETTING.playersCanToggleMilestones, {
    name: "QW.Settings.PlayersCanToggleMilestones.Name",
    hint: "QW.Settings.PlayersCanToggleMilestones.Hint",
    config: true,
    type: Boolean,
    default: false,
  });

  reg(SETTING.difficulties, {
    name: "QW.Settings.Difficulties.Name",
    hint: "QW.Settings.Difficulties.Hint",
    config: true,
    type: String,
    default: "Trivial, Easy, Moderate, Hard, Dangerous, Deadly",
  });

  reg(SETTING.playersCanCreate, {
    name: "QW.Settings.PlayersCanCreate.Name",
    hint: "QW.Settings.PlayersCanCreate.Hint",
    config: true,
    type: String,
    default: "no",
    choices: {
      no: "QW.Settings.PlayersCanCreate.No",
      trusted: "QW.Settings.PlayersCanCreate.Trusted",
      all: "QW.Settings.PlayersCanCreate.All",
    },
  });

  reg(SETTING.playerQuestTag, {
    name: "QW.Settings.PlayerQuestTag.Name",
    hint: "QW.Settings.PlayerQuestTag.Hint",
    config: true,
    type: String,
    default: "player-quest",
  });

  reg(SETTING.autoUnlock, {
    name: "QW.Settings.AutoUnlock.Name",
    hint: "QW.Settings.AutoUnlock.Hint",
    config: true,
    type: Boolean,
    default: false,
  });

  for (const [key, label] of [
    [SETTING.chatOnStatusChange, "ChatOnStatusChange"],
    [SETTING.chatOnReveal, "ChatOnReveal"],
    [SETTING.chatOnAward, "ChatOnAward"],
  ]) {
    reg(key, {
      name: `QW.Settings.${label}.Name`,
      hint: `QW.Settings.${label}.Hint`,
      config: true,
      type: Boolean,
      default: true,
    });
  }

  // Internal bookkeeping, never shown.
  reg(SETTING.schemaVersion, { config: false, type: Number, default: 0 });
}
