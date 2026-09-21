/**
 * Quest Weaver: exporting quests and chains.
 *
 * Writes the same shape the importer reads, so a file can round-trip. The
 * player-safe option drops everything still in the vault, which is what you want
 * before handing a chain to another GM's players or publishing it.
 */

import { QuestRepository } from "../core/quest-repository.js";
import { FORMAT_VERSION } from "./schema.js";

/**
 * Build an export payload.
 *
 * @param {Quest[]} quests
 * @param {object} [options]
 * @param {boolean} [options.playerSafe]  Omit GM notes and vault content.
 * @param {object} [options.chain]        Chain metadata to stamp on the file.
 * @returns {object}
 */
export function buildExport(quests, { playerSafe = false, chain = null } = {}) {
  // Links are written as import ids so the file is portable between worlds.
  const idByUuid = new Map();
  for (const quest of quests) {
    idByUuid.set(quest.uuid, quest.system.source.importId || slugFor(quest));
  }
  const ref = (uuid) => idByUuid.get(uuid) ?? uuid;

  return {
    questWeaver: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    ...(chain ? { chain } : {}),
    quests: quests.map((quest) => questToJSON(quest, { playerSafe, ref, idByUuid })),
  };
}

function slugFor(quest) {
  return quest.name.slugify({ strict: true }) || quest.id;
}

function questToJSON(quest, { playerSafe, ref }) {
  const s = quest.system;
  const secrets = playerSafe ? null : quest.secrets?.system;

  // Track ids are rewritten to their names so the file reads sensibly by hand.
  const trackName = new Map();
  for (const t of s.tracks) trackName.set(t.id, t.name || t.id);
  for (const t of secrets?.hiddenTracks ?? []) trackName.set(t.id, t.name || t.id);

  const tracks = [
    ...s.tracks.map((t) => ({ id: trackName.get(t.id), name: t.name, icon: t.icon || undefined })),
    ...(secrets?.hiddenTracks ?? []).map((t) => ({
      id: trackName.get(t.id),
      name: t.name,
      icon: t.icon || undefined,
      hidden: true,
    })),
  ];

  const milestone = (m, hidden) => ({
    track: trackName.get(m.trackId) || undefined,
    text: m.text,
    ...(m.done ? { done: true } : {}),
    ...(hidden ? { hidden: true } : {}),
    ...(m.counter?.max ? { counter: { value: m.counter.value, max: m.counter.max } } : {}),
  });

  const out = {
    id: s.source.importId || slugFor(quest),
    name: quest.name,
    status: s.status,
    ...(s.posted ? { posted: true } : {}),
    ...(s.summary ? { summary: s.summary } : {}),
    ...(s.description ? { description: s.description } : {}),
    ...(s.img ? { img: s.img } : {}),
    ...(s.banner ? { banner: s.banner } : {}),
    ...(s.tags.length ? { tags: [...s.tags] } : {}),
    ...(s.difficulty ? { difficulty: s.difficulty } : {}),
    ...(s.location ? { location: s.location } : {}),
    ...(s.deadline ? { deadline: s.deadline } : {}),
    ...(s.giver.name || s.giver.uuid
      ? { giver: { name: s.giver.name, img: s.giver.img || undefined, uuid: s.giver.uuid || undefined } }
      : {}),
    ...(tracks.length ? { tracks } : {}),
  };

  const milestones = [
    ...s.milestones.map((m) => milestone(m, false)),
    ...(secrets?.hiddenMilestones ?? []).map((m) => milestone(m, true)),
  ];
  if (milestones.length) out.milestones = milestones;

  const rewards = rewardsToJSON(s.rewards, secrets?.hiddenRewards);
  if (rewards) out.rewards = rewards;

  if (!playerSafe && secrets?.gmNotes) out.gmNotes = secrets.gmNotes;

  const links = {
    ...(s.links.parent ? { parent: ref(s.links.parent) } : {}),
    ...(s.links.children.length ? { children: s.links.children.map(ref) } : {}),
    ...(s.links.requires.length ? { requires: s.links.requires.map(ref) } : {}),
    ...(s.links.unlocks.length ? { unlocks: s.links.unlocks.map(ref) } : {}),
  };
  if (Object.keys(links).length) out.links = links;

  return out;
}

function rewardsToJSON(rewards, hidden) {
  const out = {};

  const coins = { ...rewards.currency.amounts };
  for (const [k, v] of Object.entries(hidden?.currency.amounts ?? {})) {
    coins[k] = (coins[k] ?? 0) + v;
  }
  const trimmed = Object.fromEntries(Object.entries(coins).filter(([, v]) => v > 0));
  if (Object.keys(trimmed).length) out.currency = trimmed;

  const xp = rewards.xp.value + (hidden?.xp.value ?? 0);
  if (xp) out.xp = xp;

  const items = [
    ...rewards.items.map((i) => ({ name: i.name, uuid: i.uuid || undefined, qty: i.qty })),
    ...(hidden?.items ?? []).map((i) => ({
      name: i.name,
      uuid: i.uuid || undefined,
      qty: i.qty,
      hidden: true,
    })),
  ];
  if (items.length) out.items = items;

  const custom = [
    ...rewards.custom.map((c) => ({ text: c.text })),
    ...(hidden?.custom ?? []).map((c) => ({ text: c.text, hidden: true })),
  ];
  if (custom.length) out.custom = custom;

  return Object.keys(out).length ? out : null;
}

/** Offer a payload to the browser as a download. */
export function downloadJSON(payload, filename) {
  const text = JSON.stringify(payload, null, 2);
  foundry.utils.saveDataToFile(text, "application/json", filename);
  return text;
}

/** Everything the current user can see, for the "export all" case. */
export function exportableQuests() {
  return game.user.isGM ? QuestRepository.allUnfiltered() : QuestRepository.all();
}

export const Exporter = { buildExport, downloadJSON, exportableQuests };
