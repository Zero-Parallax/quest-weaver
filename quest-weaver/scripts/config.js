/**
 * Quest Weaver: shared constants.
 *
 * Nothing in here touches the Foundry API, so it is safe to import from
 * anywhere, including before `init`.
 */

export const MODULE_ID = "quest-weaver";

/** Prefix for console output. */
export const LOG = "Quest Weaver |";

/** Page subtypes. Foundry namespaces module subtypes with the module id. */
export const TYPE = {
  quest: `${MODULE_ID}.quest`,
  secrets: `${MODULE_ID}.secrets`,
  storyweb: `${MODULE_ID}.storyweb`,
};

/** Current schema version, stamped onto every document we write. */
export const SCHEMA_VERSION = 1;

/**
 * Quest lifecycle. `draft` is GM-only by convention; the others map to the
 * tabs in the quest log. Order here is the order tabs appear.
 */
export const STATUS = {
  draft: "draft",
  available: "available",
  active: "active",
  completed: "completed",
  failed: "failed",
  abandoned: "abandoned",
};

export const STATUS_LIST = Object.values(STATUS);

/**
 * Choice maps for fields rendered as selects.
 *
 * These must be objects, not arrays: Foundry builds `<option>` values from the
 * keys, so an array yields options valued by array index, not by the
 * status name.
 */
export const STATUS_CHOICES = Object.fromEntries(
  STATUS_LIST.map((s) => [s, `QW.Status.${s}`]),
);

/** Presentation metadata per status. Colours are also used by the story web. */
export const STATUS_META = {
  draft: { icon: "fa-pen-ruler", color: "#8a8f98", gmOnly: true },
  available: { icon: "fa-clipboard-list", color: "#e0a02a" },
  active: { icon: "fa-circle-play", color: "#3dba5a" },
  completed: { icon: "fa-circle-check", color: "#4a9eff" },
  failed: { icon: "fa-circle-xmark", color: "#e84040" },
  abandoned: { icon: "fa-circle-minus", color: "#b06c3a" },
};

/** Kinds of node the story web can hold besides quests. */
/** @see STATUS_CHOICES for why these are objects rather than arrays. */
export const NODE_KIND = {
  quest: "quest",
  npc: "npc",
  faction: "faction",
  location: "location",
  event: "event",
  clue: "clue",
  secret: "secret",
  note: "note",
};

export const NODE_KIND_CHOICES = Object.fromEntries(
  Object.values(NODE_KIND).map((k) => [k, `QW.NodeKind.${k}`]),
);

/** Relationship types between story web nodes. */
export const EDGE_TYPE = {
  leadsTo: "leadsTo",
  requires: "requires",
  unlocks: "unlocks",
  involves: "involves",
  rival: "rival",
  owns: "owns",
  hidden: "hidden",
  custom: "custom",
};

export const EDGE_TYPE_CHOICES = Object.fromEntries(
  Object.values(EDGE_TYPE).map((k) => [k, `QW.EdgeType.${k}`]),
);

/** Socket message names carried on `module.quest-weaver`. */
export const SOCKET = {
  request: "request",
  response: "response",
  refresh: "refresh",
};

/** Settings keys, collected so typos surface as import errors. */
export const SETTING = {
  folderName: "folderName",
  vaultName: "vaultName",
  hideFromSidebar: "hideFromSidebar",
  denominations: "denominations",
  adapter: "adapter",
  currencyPaths: "currencyPaths",
  xpPath: "xpPath",
  playersCanAccept: "playersCanAccept",
  playersCanAbandon: "playersCanAbandon",
  playersCanToggleMilestones: "playersCanToggleMilestones",
  autoUnlock: "autoUnlock",
  difficulties: "difficulties",
  playersCanCreate: "playersCanCreate",
  playerQuestTag: "playerQuestTag",
  defaultOwnership: "defaultOwnership",
  chatOnStatusChange: "chatOnStatusChange",
  chatOnReveal: "chatOnReveal",
  chatOnAward: "chatOnAward",
  schemaVersion: "schemaVersion",
};

/** Flag scope used on the container JournalEntry of every quest. */
export const FLAG = {
  isQuestEntry: "questEntry",
  isVault: "vault",
};

/**
 * Ownership levels, inlined so this file stays importable before `init`.
 * Values are stable across Foundry versions (CONST.DOCUMENT_OWNERSHIP_LEVELS).
 */
export const OWNERSHIP = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
