/**
 * Quest Weaver: importing quests and chains.
 *
 * Two passes, because a chain refers to itself: quests are created first, then
 * their links are rewritten from import ids to the UUIDs the documents ended up
 * with. Re-importing the same file updates the quests it made last time rather
 * than growing a second copy, which is what makes iterating on a draft bearable.
 */

import { LOG, OWNERSHIP, STATUS } from "../config.js";
import { QuestRepository, rewardUpdates } from "../core/quest-repository.js";
import { Vault } from "../core/vault.js";

/**
 * Decide what an import would do, without doing it.
 *
 * @param {object[]} quests  Normalised quests from `parseImport`.
 * @returns {{importId: string, name: string, existing: Quest|null, action: "create"|"update"}[]}
 */
export function planImport(quests) {
  const byImportId = new Map();
  for (const quest of QuestRepository.allUnfiltered()) {
    const id = quest.system.source.importId;
    if (id) byImportId.set(id, quest);
  }

  return quests.map((q) => {
    const existing = byImportId.get(q.importId) ?? null;
    return {
      importId: q.importId,
      name: q.name,
      existing,
      action: existing ? "update" : "create",
      milestones: q.milestones.length,
      hiddenMilestones: q.secrets.hiddenMilestones.length,
      rewards:
        q.rewards.items.length +
        q.rewards.custom.length +
        q.secrets.hiddenRewards.items.length +
        q.secrets.hiddenRewards.custom.length,
      hasNotes: !!q.secrets.gmNotes,
      links: q.links.requires.length + q.links.unlocks.length,
    };
  });
}

/**
 * Create or update everything in a parsed import.
 *
 * @param {object[]} quests
 * @param {object} [options]
 * @param {boolean} [options.update]     Update quests matched by import id (default true).
 * @param {number}  [options.ownership]  Default ownership for newly created quests.
 * @returns {Promise<{created: number, updated: number, quests: Quest[]}>}
 */
export async function runImport(quests, { update = true, ownership = OWNERSHIP.NONE } = {}) {
  if (!game.user.isGM) throw new Error(game.i18n.localize("QW.Error.NotAllowed"));

  const plan = planImport(quests);
  const byImportId = new Map();
  let created = 0;
  let updated = 0;

  // Pass one: the documents themselves, links left unresolved for now.
  for (let i = 0; i < quests.length; i++) {
    const source = quests[i];
    const entry = plan[i];
    const publicData = toPublicData(source);
    const secretData = toSecretData(source);

    let quest = entry.existing;
    if (quest && update) {
      await quest.entry.update({ name: source.name });
      await quest.page.update({
        name: source.name,
        ...flattenPublic(publicData),
        ...rewardUpdates("system.rewards", publicData.rewards),
      });
      const secretsPage = quest.secrets ?? (await Vault.ensureSecrets(quest.page));
      if (secretsPage) {
        await secretsPage.update({
          "system.gmNotes": secretData.gmNotes,
          "system.hiddenTracks": secretData.hiddenTracks,
          "system.hiddenMilestones": secretData.hiddenMilestones,
          ...rewardUpdates("system.hiddenRewards", secretData.hiddenRewards),
        });
      }
      quest = QuestRepository.get(quest.uuid) ?? quest;
      updated++;
    } else {
      quest = await QuestRepository.create({
        name: source.name,
        system: publicData,
        secrets: secretData,
        ownership: { default: ownership },
      });
      created++;
    }

    byImportId.set(source.importId, quest);
    if (source.visibility) await applyVisibility(quest, source.visibility);
  }

  // Pass two: rewrite links now that every quest has a UUID.
  for (const source of quests) {
    const quest = byImportId.get(source.importId);
    if (!quest) continue;
    const resolve = (ref) => byImportId.get(ref)?.uuid ?? (ref.includes(".") ? ref : null);

    const links = {
      parent: source.links.parent ? (resolve(source.links.parent) ?? "") : "",
      children: source.links.children.map(resolve).filter(Boolean),
      requires: source.links.requires.map(resolve).filter(Boolean),
      unlocks: source.links.unlocks.map(resolve).filter(Boolean),
    };
    if (links.parent || links.children.length || links.requires.length || links.unlocks.length) {
      await quest.page.update({ "system.links": links });
    }
  }

  console.log(`${LOG} import complete: ${created} created, ${updated} updated`);
  return { created, updated, quests: [...byImportId.values()] };
}

/** Turn a parsed quest's public half into `system` data. */
function toPublicData(source) {
  return {
    status: source.status,
    posted: source.posted,
    summary: source.summary,
    description: source.description,
    img: source.img || undefined,
    banner: source.banner || undefined,
    tags: source.tags,
    difficulty: source.difficulty,
    location: source.location,
    deadline: source.deadline,
    giver: source.giver,
    tracks: source.tracks,
    milestones: source.milestones,
    rewards: source.rewards,
    source: { importId: source.importId, chainId: source.chainId },
  };
}

/** The same data as update paths, so an update replaces rather than merges. */
function flattenPublic(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "rewards" || value === undefined) continue;
    out[`system.${key}`] = value;
  }
  return out;
}

function toSecretData(source) {
  return {
    gmNotes: source.secrets.gmNotes,
    hiddenTracks: source.secrets.hiddenTracks,
    hiddenMilestones: source.secrets.hiddenMilestones,
    hiddenRewards: source.secrets.hiddenRewards,
  };
}

/**
 * Apply a `visibility` hint from the file: "all", "hidden", or a list of player
 * names. Names are used instead of ids so a file can travel between worlds.
 */
async function applyVisibility(quest, visibility) {
  if (visibility === "hidden") return QuestRepository.hide(quest);
  if (visibility === "all") return QuestRepository.setVisibility(quest);

  const names = Array.isArray(visibility) ? visibility : [visibility];
  const users = names
    .map((n) => game.users.getName(String(n)))
    .filter(Boolean)
    .map((u) => u.id);
  if (!users.length) return QuestRepository.hide(quest);
  return QuestRepository.setVisibility(quest, { users });
}

/** Quests that came from an import, grouped by chain, for the export picker. */
export function importedChains() {
  const chains = new Map();
  for (const quest of QuestRepository.allUnfiltered()) {
    const id = quest.system.source.chainId;
    if (!id) continue;
    if (!chains.has(id)) chains.set(id, []);
    chains.get(id).push(quest);
  }
  return chains;
}

export const Importer = { parse: null, planImport, runImport, importedChains, STATUS };
