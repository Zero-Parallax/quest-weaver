/**
 * Quest Weaver: quest storage.
 *
 * One JournalEntry per quest, holding exactly one page of type
 * `quest-weaver.quest`. The entry's ownership is the visibility switch:
 *
 *   default NONE       → the quest does not exist for players
 *   default OBSERVER   → everyone can see it
 *   { userId: OBSERVER } → a personal quest
 *
 * Foundry enforces that server-side. The companion secrets page lives in the
 * vault; `Quest` below stitches the two halves back together for the GM.
 */

import { FLAG, LOG, MODULE_ID, OWNERSHIP, SETTING, STATUS, TYPE } from "../config.js";
import { Vault } from "./vault.js";

/**
 * Replace a field outright instead of merging into it.
 *
 * Foundry merges objects on update, so anything that needs to *shrink* (an
 * emptied coin purse, a cleared audience) keeps its old keys unless the new
 * value is wrapped. v14 also silently drops an entire update containing a
 * legacy `-=` deletion key, so this is the only reliable route.
 */
export function replace(value) {
  return foundry.data.operators.ForcedReplacement.create(value);
}

/**
 * Expand a rewards block into explicit update paths.
 *
 * `replace()` does not cascade: replacing the parent SchemaField leaves the
 * nested `currency.amounts` TypedObjectField merged, so a coin purse that
 * should have been emptied keeps its old denominations. The purse therefore
 * needs its own replaced entry.
 */
export function rewardUpdates(prefix, rewards) {
  return {
    [`${prefix}.items`]: rewards.items,
    [`${prefix}.custom`]: rewards.custom,
    [`${prefix}.xp`]: rewards.xp,
    [`${prefix}.currency.revealed`]: rewards.currency.revealed,
    [`${prefix}.currency.awarded`]: rewards.currency.awarded,
    [`${prefix}.currency.amounts`]: replace(rewards.currency.amounts),
  };
}

/**
 * A quest as the current user may see it: the public page always, plus the
 * vault page when the user is a GM and it exists.
 */
export class Quest {
  constructor(page, secrets = null) {
    this.page = page;
    this.secrets = secrets;
  }

  /** Wrap a page, attaching its secrets when the viewer is entitled to them. */
  static wrap(page) {
    return new Quest(page, game.user.isGM ? Vault.secretsFor(page.uuid) : null);
  }

  get id() { return this.page.id; }
  get uuid() { return this.page.uuid; }
  get name() { return this.page.name; }
  get img() { return this.page.system.img; }
  get entry() { return this.page.parent; }
  get system() { return this.page.system; }
  get status() { return this.page.system.status; }
  get isOwner() { return this.page.isOwner; }

  /**
   * Whether the current user is meant to see this quest.
   *
   * This has to be checked explicitly. Foundry delivers every world document to
   * every client, so a quest whose entry is set to NONE still turns up in
   * `game.journal`. Ownership expresses the GM's intent, and it is the UI's
   * job to honour it.
   */
  get visible() {
    return game.user.isGM || this.entry.testUserPermission(game.user, "OBSERVER");
  }

  /** GM notes, or an empty string for anyone who should not have them. */
  get gmNotes() { return this.secrets?.system.gmNotes ?? ""; }

  /**
   * True when no player can currently see this quest. Derived from `audience`
   * and not from the raw ownership object, because the GM's own OWNER entry
   * would otherwise read as "somebody can see it".
   */
  get isHidden() {
    return this.audience.length === 0;
  }

  /** Users who can see this quest, excluding GMs. */
  get audience() {
    const o = this.entry.ownership ?? {};
    return game.users.filter((u) => {
      if (u.isGM) return false;
      const level = o[u.id] ?? o.default ?? OWNERSHIP.NONE;
      return level >= OWNERSHIP.OBSERVER;
    });
  }

  /**
   * Every milestone the viewer is entitled to: the revealed ones for everyone,
   * plus the vault's hidden ones for a GM. Sorted so a reveal does not make a
   * row jump around.
   */
  get allMilestones() {
    const pub = this.system.milestones.map((m) => ({ ...m, hidden: false }));
    const hidden = (this.secrets?.system.hiddenMilestones ?? []).map((m) => ({
      ...m,
      hidden: true,
    }));
    return [...pub, ...hidden].sort((a, b) => a.order - b.order);
  }

  /** Tracks from both halves, GM-only tracks flagged. */
  get allTracks() {
    const pub = this.system.tracks.map((t) => ({ ...t, hidden: false }));
    const hidden = (this.secrets?.system.hiddenTracks ?? []).map((t) => ({ ...t, hidden: true }));
    return [...pub, ...hidden].sort((a, b) => a.order - b.order);
  }
}

export class QuestRepository {
  /** The folder quest entries are filed under, created on first use. */
  static async ensureFolder() {
    const name = game.settings.get(MODULE_ID, SETTING.folderName);
    const existing = game.folders.find((f) => f.type === "JournalEntry" && f.name === name);
    if (existing) return existing;
    if (!game.user.isGM) return null;
    return Folder.implementation.create({ name, type: "JournalEntry", color: "#7a5ea8" });
  }

  /** Every quest page in the world that this client has been sent. */
  static allPages() {
    return game.journal.contents.flatMap((entry) =>
      entry.pages.filter((p) => p.type === TYPE.quest),
    );
  }

  /** Every quest the current user is entitled to see. */
  static all() {
    return QuestRepository.allPages()
      .map((p) => Quest.wrap(p))
      .filter((q) => q.visible);
  }

  /** Every quest in the world, including ones hidden from the current user. */
  static allUnfiltered() {
    return QuestRepository.allPages().map((p) => Quest.wrap(p));
  }

  /** Look a quest up by the UUID of its page, respecting visibility. */
  static get(uuid) {
    const page = QuestRepository.allPages().find((p) => p.uuid === uuid);
    if (!page) return null;
    const quest = Quest.wrap(page);
    return quest.visible ? quest : null;
  }

  /**
   * Create a quest. `system` is the public half; `secrets` is the vault half.
   * Both are optional: a bare `{ name }` produces a valid empty draft.
   */
  static async create({ name, system = {}, secrets = {}, ownership = null } = {}) {
    if (!game.user.isGM) throw new Error("Quest Weaver | only a GM can create quests");

    const folder = await QuestRepository.ensureFolder();
    const title = name || game.i18n.localize("QW.Quest.Untitled");
    const defaultOwnership = game.settings.get(MODULE_ID, SETTING.defaultOwnership);

    const entry = await JournalEntry.implementation.create({
      name: title,
      folder: folder?.id ?? null,
      ownership: ownership ?? { default: Number(defaultOwnership) },
      flags: { [MODULE_ID]: { [FLAG.isQuestEntry]: true } },
      pages: [
        {
          name: title,
          type: TYPE.quest,
          system: foundry.utils.mergeObject({ status: STATUS.draft }, system, { inplace: false }),
        },
      ],
    });

    const page = entry.pages.find((p) => p.type === TYPE.quest);
    const secretsPage = await Vault.ensureSecrets(page);
    if (secretsPage && Object.keys(secrets).length) await secretsPage.update({ system: secrets });

    console.log(`${LOG} created quest "${title}" (${page.uuid})`);
    return Quest.wrap(page);
  }

  /**
   * The single write path. Keys prefixed `secrets.` are routed to the vault
   * page, everything else to the public page, so a caller never has to know
   * which half a field lives in.
   *
   *   QuestRepository.update(quest, {
   *     "system.status": "active",
   *     "secrets.system.gmNotes": "<p>...</p>",
   *   });
   */
  static async update(quest, changes = {}) {
    const pub = {};
    const sec = {};
    for (const [key, value] of Object.entries(changes)) {
      if (key.startsWith("secrets.")) sec[key.slice("secrets.".length)] = value;
      else pub[key] = value;
    }

    const work = [];
    if (Object.keys(pub).length) work.push(quest.page.update(pub));
    if (Object.keys(sec).length) {
      const page = quest.secrets ?? (await Vault.ensureSecrets(quest.page));
      if (!page) throw new Error("Quest Weaver | no vault page available for this quest");
      quest.secrets = page;
      work.push(page.update(sec));
    }
    await Promise.all(work);
    return quest;
  }

  /** Rename both halves at once so the vault stays legible in the sidebar. */
  static async rename(quest, name) {
    await Promise.all([
      quest.entry.update({ name }),
      quest.page.update({ name }),
      quest.secrets?.update({ name: `${name} (GM)` }),
    ]);
  }

  /**
   * Set who can see the quest. Passing no users makes it world-visible at
   * `level`; passing users makes it personal to them and invisible to the rest.
   *
   * The ownership object is force-replaced rather than merged. A plain update
   * merges, which would leave a previous audience in place, and v14 silently
   * drops an entire update that contains a legacy `-=` deletion key.
   */
  static async setVisibility(quest, { level = OWNERSHIP.OBSERVER, users = null } = {}) {
    const ownership = { default: users?.length ? OWNERSHIP.NONE : level };

    // Keep GM entries so the quest still lists its author as owner.
    for (const [id, lvl] of Object.entries(quest.entry.ownership ?? {})) {
      if (id !== "default" && game.users.get(id)?.isGM) ownership[id] = lvl;
    }
    for (const id of users ?? []) ownership[id] = level;

    await quest.entry.update({ ownership: replace(ownership) });
  }

  /** Hide the quest from every player without touching its content. */
  static async hide(quest) {
    return QuestRepository.setVisibility(quest, { level: OWNERSHIP.NONE, users: null });
  }

  /** Delete the quest, its container entry and its vault page. */
  static async delete(quest) {
    if (!game.user.isGM) throw new Error("Quest Weaver | only a GM can delete quests");
    const uuid = quest.uuid;
    await quest.entry.delete();
    await Vault.purgeSecrets(uuid);
  }
}
