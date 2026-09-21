/**
 * Quest Weaver: the GM vault.
 *
 * A single JournalEntry with `ownership.default = NONE`. Foundry never sends a
 * document to a client that has no permission on it, so everything filed here
 * is genuinely unavailable to players, not merely hidden by the UI.
 *
 * The vault is found by flag, not by name, so renaming it in the sidebar is
 * harmless.
 */

import { FLAG, LOG, MODULE_ID, OWNERSHIP, SETTING, TYPE } from "../config.js";

export class Vault {
  /** The vault entry, or null if it has not been created yet. */
  static get entry() {
    return game.journal?.find((j) => j.getFlag(MODULE_ID, FLAG.isVault) === true) ?? null;
  }

  /**
   * Fetch the vault, creating it on first use. GM only. A player calling this
   * gets null and not a permission error, because for them the vault simply
   * does not exist.
   */
  static async ensure() {
    const existing = Vault.entry;
    if (existing) return existing;
    if (!game.user.isGM) return null;

    const name = game.settings.get(MODULE_ID, SETTING.vaultName);
    const entry = await JournalEntry.implementation.create({
      name,
      ownership: { default: OWNERSHIP.NONE },
      flags: { [MODULE_ID]: { [FLAG.isVault]: true } },
    });
    console.log(`${LOG} created GM vault "${name}" (${entry.uuid})`);
    return entry;
  }

  /** Every page in the vault of a given subtype. */
  static pages(type) {
    const entry = Vault.entry;
    if (!entry) return [];
    return entry.pages.filter((p) => p.type === type);
  }

  /** The secrets page belonging to a quest page, or null. */
  static secretsFor(questUuid) {
    return Vault.pages(TYPE.secrets).find((p) => p.system.questUuid === questUuid) ?? null;
  }

  /** Fetch or create the secrets page for a quest. */
  static async ensureSecrets(questPage) {
    const existing = Vault.secretsFor(questPage.uuid);
    if (existing) return existing;
    if (!game.user.isGM) return null;

    const entry = await Vault.ensure();
    if (!entry) return null;

    const [page] = await JournalEntryPage.implementation.create(
      [
        {
          name: `${questPage.name} (GM)`,
          type: TYPE.secrets,
          system: { questUuid: questPage.uuid },
        },
      ],
      { parent: entry },
    );
    return page;
  }

  /** All story webs, newest sort order first. */
  static get webs() {
    return Vault.pages(TYPE.storyweb).sort((a, b) => a.sort - b.sort);
  }

  /** Create a new, empty story web. */
  static async createWeb(name) {
    const entry = await Vault.ensure();
    if (!entry) return null;
    const [page] = await JournalEntryPage.implementation.create(
      [{ name: name || game.i18n.localize("QW.Web.Untitled"), type: TYPE.storyweb }],
      { parent: entry },
    );
    return page;
  }

  /**
   * Remove a quest's secrets page. Called when the quest itself is deleted, so
   * the vault does not accumulate orphans.
   */
  static async purgeSecrets(questUuid) {
    const page = Vault.secretsFor(questUuid);
    if (page && game.user.isGM) await page.delete();
  }
}
