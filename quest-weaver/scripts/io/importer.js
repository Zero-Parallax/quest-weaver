/**
 * Quest Weaver: importing quests, chains and story webs.
 *
 * Two passes, because a chain refers to itself: quests are created first, then
 * their links are rewritten from import ids to the UUIDs the documents ended up
 * with. Story webs come last, once every quest they show has a UUID.
 * Re-importing the same file updates the quests and webs it made last time
 * rather than growing a second copy, which is what makes iterating on a draft
 * bearable.
 */

import { FLAG, LOG, MODULE_ID, NODE_KIND, OWNERSHIP, STATUS } from "../config.js";
import { newId } from "../data/fields.js";
import { QuestRepository, rewardUpdates } from "../core/quest-repository.js";
import { StoryWeb } from "../core/story-web.js";
import { Vault } from "../core/vault.js";
import { layeredLayout } from "../ui/svg-graph.js";

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
 * Decide what importing some story webs would do, without doing it.
 *
 * @param {object[]} webs    Normalised webs from `parseImport`.
 * @param {object[]} quests  The quests imported alongside them.
 * @returns {{importId: string, name: string, existing: JournalEntryPage|null,
 *            action: "create"|"update", nodes: number, edges: number, missing: string[]}[]}
 */
export function planWebs(webs, quests = []) {
  const existingWebs = importedWebs();
  const inFile = new Set(quests.map((q) => q.importId));
  const world = worldQuestIndex();

  return webs.map((w) => {
    const existing = existingWebs.get(w.importId) ?? null;
    const missing = w.nodes
      .filter((n) => n.quest && !inFile.has(n.quest) && !world.has(n.quest))
      .map((n) => n.quest);
    return {
      importId: w.importId,
      name: w.name,
      existing,
      action: existing ? "update" : "create",
      nodes: w.nodes.length - missing.length,
      edges: w.edges.length + w.chainLinks.length,
      missing,
    };
  });
}

/**
 * Create or update everything in a parsed import.
 *
 * @param {object[]} quests
 * @param {object} [options]
 * @param {object[]} [options.webs]      Normalised story webs to import after the quests.
 * @param {boolean} [options.update]     Update quests and webs matched by import id (default true).
 * @param {number}  [options.ownership]  Default ownership for newly created quests.
 * @returns {Promise<{created: number, updated: number, quests: Quest[],
 *                    websCreated: number, websUpdated: number, webs: JournalEntryPage[]}>}
 */
export async function runImport(quests, { webs = [], update = true, ownership = OWNERSHIP.NONE } = {}) {
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

  // Pass three: story webs, now that every quest they show has a UUID.
  const web = await importWebs(webs, { update, questsByImportId: byImportId });

  console.log(
    `${LOG} import complete: ${created} created, ${updated} updated, ` +
      `${web.created} web(s) created, ${web.updated} web(s) updated`,
  );
  return {
    created,
    updated,
    quests: [...byImportId.values()],
    websCreated: web.created,
    websUpdated: web.updated,
    webs: web.webs,
  };
}

/**
 * Create or update story webs.
 *
 * A web remembers which of its nodes and edges came from the file, so a
 * re-import replaces those and leaves alone anything the GM added on the web by
 * hand. Nodes keep their ids across re-imports, so the GM's own connections to
 * them survive, and a node the file gives no position keeps the one it has.
 */
async function importWebs(webs, { update, questsByImportId }) {
  const result = { created: 0, updated: 0, webs: [] };
  if (!webs.length) return result;

  const existingWebs = importedWebs();
  const world = worldQuestIndex();
  const questFor = (ref) => questsByImportId.get(ref) ?? world.get(ref) ?? null;

  for (const source of webs) {
    const existing = update ? (existingWebs.get(source.importId) ?? null) : null;
    const previous = existing?.getFlag(MODULE_ID, FLAG.webImport) ?? {};
    const previousNodeIds = new Map(previous.nodes ?? []);
    const previousEdgeIds = new Set(previous.edges ?? []);
    const current = existing ? existing.system.toObject() : { nodes: [], edges: [] };
    const currentById = new Map(current.nodes.map((n) => [n.id, n]));

    // Nodes this file made last time make way for the new ones; the rest stay.
    const fromFile = new Set(previousNodeIds.values());
    const kept = current.nodes.filter((n) => !fromFile.has(n.id));
    const claimed = new Set();

    const realId = new Map();
    const unplaced = new Set();
    const nodes = [];
    for (const n of source.nodes) {
      let ref = "";
      let id = previousNodeIds.get(n.importId);
      if (!currentById.has(id)) id = null;
      // A card exported from this web under its own id is that card.
      if (!id && currentById.has(n.importId) && !fromFile.has(n.importId)) id = n.importId;
      if (claimed.has(id)) id = null;

      if (n.kind === NODE_KIND.quest) {
        const quest = questFor(n.quest);
        if (!quest) continue; // Named in the preview; nothing to draw.
        ref = quest.uuid;
        // A card the GM already put on the web for this quest becomes this one.
        if (!id) {
          const card = kept.find((k) => k.kind === NODE_KIND.quest && k.ref === ref && !claimed.has(k.id));
          id = card?.id ?? null;
        }
      }
      id ??= newId();
      claimed.add(id);

      const before = currentById.get(id);
      const x = n.x ?? before?.x ?? null;
      const y = n.y ?? before?.y ?? null;
      if (x === null || y === null) unplaced.add(id);

      realId.set(n.importId, id);
      nodes.push({
        id,
        kind: n.kind,
        ref,
        label: n.label,
        img: n.img,
        color: n.color,
        x: Math.round(x ?? 0),
        y: Math.round(y ?? 0),
        notes: n.notes,
        tags: n.tags,
      });
    }

    const allNodes = [...kept.filter((n) => !claimed.has(n.id)), ...nodes];
    const present = new Set(allNodes.map((n) => n.id));
    const edges = source.edges
      .filter((e) => realId.has(e.from) && realId.has(e.to))
      .map((e) => ({
        id: newId(),
        from: realId.get(e.from),
        to: realId.get(e.to),
        type: e.type,
        label: e.label,
        color: e.color,
        dashed: e.dashed,
      }));
    // A hand-drawn connection the file also has becomes the file's.
    const sameAs = (a) => (b) =>
      a.from === b.from && a.to === b.to && a.type === b.type && a.label === b.label;
    const keptEdges = current.edges.filter(
      (e) =>
        !previousEdgeIds.has(e.id) &&
        present.has(e.from) &&
        present.has(e.to) &&
        !edges.some(sameAs(e)),
    );

    const record = {
      importId: source.importId,
      nodes: [...realId],
      edges: edges.map((e) => e.id),
    };
    const system = {
      description: source.description,
      nodes: allNodes,
      edges: [...keptEdges, ...edges],
    };

    let web = existing;
    if (web) {
      await web.update({
        name: source.name,
        "system.description": system.description,
        "system.nodes": system.nodes,
        "system.edges": system.edges,
        [`flags.${MODULE_ID}.${FLAG.webImport}`]: record,
      });
      result.updated++;
    } else {
      web = await Vault.createWeb(source.name, {
        system,
        flags: { [MODULE_ID]: { [FLAG.webImport]: record } },
      });
      if (!web) continue;
      result.created++;
    }

    for (const link of source.chainLinks) {
      const a = questFor(link.from);
      const b = questFor(link.to);
      if (a && b) await StoryWeb.linkQuests(a.uuid, b.uuid, link.type);
    }

    if (unplaced.size) await placeNodes(web, unplaced);
    result.webs.push(web);
  }

  return result;
}

/**
 * Lay out nodes the file gave no position, the way Arrange does, and park them
 * below anything on the web that already has a place.
 */
async function placeNodes(web, unplaced) {
  const { nodes, edges } = StoryWeb.graph(web);
  const positions = layeredLayout(nodes.filter((n) => unplaced.has(n.id)), edges);
  if (!positions.size) return;

  const placed = nodes.filter((n) => !unplaced.has(n.id));
  if (placed.length) {
    const top = Math.max(...placed.map((n) => n.y)) + 200;
    const left = Math.min(...placed.map((n) => n.x));
    const shiftY = top - Math.min(...[...positions.values()].map((p) => p.y));
    for (const pos of positions.values()) {
      pos.x += left;
      pos.y += shiftY;
    }
  }
  await StoryWeb.moveNodes(web, positions);
}

/** Story webs that came from an import, by the id they were imported under. */
function importedWebs() {
  const webs = new Map();
  for (const web of StoryWeb.all()) {
    const id = web.getFlag(MODULE_ID, FLAG.webImport)?.importId;
    if (id) webs.set(id, web);
  }
  return webs;
}

/** Quests already in the world, by UUID and by the id they were imported under. */
function worldQuestIndex() {
  const index = new Map();
  for (const quest of QuestRepository.allUnfiltered()) {
    index.set(quest.uuid, quest);
    const id = quest.system.source.importId;
    if (id && !index.has(id)) index.set(id, quest);
  }
  return index;
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

export const Importer = { parse: null, planImport, planWebs, runImport, importedChains, STATUS };
