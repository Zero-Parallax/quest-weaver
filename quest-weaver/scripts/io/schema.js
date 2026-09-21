/**
 * Quest Weaver: the import format.
 *
 * Deliberately loose and human-shaped: a GM should be able to write a chain by
 * hand, or paste one an AI drafted, without knowing anything about Foundry's
 * data model. Everything here is about turning that into something the
 * repository can store, and saying clearly what could not be understood.
 *
 * Validation never throws. It returns errors and warnings so the import dialog
 * can show the GM what will happen before anything is created.
 */

import { STATUS, STATUS_LIST } from "../config.js";
import { newId } from "../data/fields.js";
import { denominations } from "../settings.js";

/** The format version this build writes and understands. */
export const FORMAT_VERSION = 1;

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const asString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const asBool = (v) => v === true || v === "true";
const asInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Parse and normalise an import payload.
 *
 * @param {object|string} raw  Parsed JSON, or a JSON string.
 * @returns {{quests: object[], chain: object|null, storyNodes: object[], edges: object[],
 *            errors: string[], warnings: string[]}}
 */
export function parseImport(raw) {
  const errors = [];
  const warnings = [];

  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return { quests: [], chain: null, storyNodes: [], edges: [], errors: [
        game.i18n.format("QW.IO.BadJSON", { message: err.message }),
      ], warnings };
    }
  }

  if (!data || typeof data !== "object") {
    return { quests: [], chain: null, storyNodes: [], edges: [],
      errors: [game.i18n.localize("QW.IO.NotAnObject")], warnings };
  }

  // A bare array of quests, or a single quest, is accepted as a convenience.
  if (Array.isArray(data)) data = { quests: data };
  if (data.name && !data.quests) data = { quests: [data] };

  const version = asInt(data.questWeaver ?? FORMAT_VERSION);
  if (version > FORMAT_VERSION) {
    warnings.push(game.i18n.format("QW.IO.NewerFormat", { version }));
  }

  const chain = data.chain
    ? {
        id: asString(data.chain.id) || newId(),
        name: asString(data.chain.name),
        description: asString(data.chain.description),
      }
    : null;

  const coinKeys = new Set(denominations().map((d) => d.key));
  const quests = [];
  const seenIds = new Set();

  asArray(data.quests).forEach((entry, index) => {
    const quest = parseQuest(entry, index, { coinKeys, chain, errors, warnings, seenIds });
    if (quest) quests.push(quest);
  });

  if (!quests.length && !errors.length) errors.push(game.i18n.localize("QW.IO.NoQuests"));

  // Links that point at nothing are dropped, not silently kept, because
  // a dangling prerequisite would quietly stall a chain.
  const known = new Set(quests.map((q) => q.importId));
  for (const quest of quests) {
    for (const key of ["requires", "unlocks", "children"]) {
      const kept = quest.links[key].filter((ref) => known.has(ref) || ref.includes("."));
      if (kept.length !== quest.links[key].length) {
        warnings.push(
          game.i18n.format("QW.IO.UnknownLink", { quest: quest.name, key }),
        );
      }
      quest.links[key] = kept;
    }
    if (quest.links.parent && !known.has(quest.links.parent) && !quest.links.parent.includes(".")) {
      warnings.push(game.i18n.format("QW.IO.UnknownLink", { quest: quest.name, key: "parent" }));
      quest.links.parent = "";
    }
  }

  return {
    quests,
    chain,
    storyNodes: asArray(data.storyNodes),
    edges: asArray(data.edges),
    errors,
    warnings,
  };
}

/**
 * Normalise one quest entry, splitting it into the public half and the vault
 * half as it goes. `hidden: true` anywhere means "vault".
 */
function parseQuest(entry, index, { coinKeys, chain, errors, warnings, seenIds }) {
  if (!entry || typeof entry !== "object") {
    errors.push(game.i18n.format("QW.IO.BadQuest", { index: index + 1 }));
    return null;
  }

  const name = asString(entry.name).trim();
  if (!name) {
    errors.push(game.i18n.format("QW.IO.MissingName", { index: index + 1 }));
    return null;
  }

  const importId = asString(entry.id).trim() || `qw-${index}-${name.slugify({ strict: true })}`;
  if (seenIds.has(importId)) {
    warnings.push(game.i18n.format("QW.IO.DuplicateId", { id: importId }));
  }
  seenIds.add(importId);

  let status = asString(entry.status).trim() || STATUS.draft;
  if (!STATUS_LIST.includes(status)) {
    warnings.push(game.i18n.format("QW.IO.BadStatus", { quest: name, status }));
    status = STATUS.draft;
  }

  // Tracks first: a hidden track drags its milestones into the vault with it.
  const trackIds = new Map();
  const publicTracks = [];
  const hiddenTracks = [];
  asArray(entry.tracks).forEach((t, i) => {
    const ref = asString(t?.id) || asString(t?.name) || `track-${i}`;
    const track = {
      id: newId(),
      name: asString(t?.name) || ref,
      icon: asString(t?.icon),
      order: i,
    };
    trackIds.set(ref, { id: track.id, hidden: asBool(t?.hidden) });
    (asBool(t?.hidden) ? hiddenTracks : publicTracks).push(track);
  });

  const publicMilestones = [];
  const hiddenMilestones = [];
  asArray(entry.milestones).forEach((m, i) => {
    const ref = asString(m?.track ?? m?.trackId);
    const track = trackIds.get(ref);
    const hidden = asBool(m?.hidden) || track?.hidden === true;
    const milestone = {
      id: newId(),
      trackId: track?.id ?? "",
      text: asString(m?.text ?? m),
      done: asBool(m?.done),
      order: i,
      revealed: !hidden,
      counter: { value: asInt(m?.counter?.value), max: m?.counter?.max == null ? null : asInt(m.counter.max) },
    };
    if (ref && !track) warnings.push(game.i18n.format("QW.IO.UnknownTrack", { quest: name, track: ref }));
    (hidden ? hiddenMilestones : publicMilestones).push(milestone);
  });

  const rewards = parseRewards(entry.rewards, { coinKeys, name, warnings });

  return {
    importId,
    name,
    status,
    posted: asBool(entry.posted),
    summary: asString(entry.summary),
    description: asString(entry.description),
    img: asString(entry.img),
    banner: asString(entry.banner),
    tags: asArray(entry.tags).map(asString).filter(Boolean),
    difficulty: asString(entry.difficulty),
    location: asString(entry.location),
    deadline: asString(entry.deadline),
    giver: {
      uuid: asString(entry.giver?.uuid),
      name: asString(entry.giver?.name ?? (typeof entry.giver === "string" ? entry.giver : "")),
      img: asString(entry.giver?.img),
    },
    visibility: entry.visibility ?? null,
    tracks: publicTracks,
    milestones: publicMilestones,
    rewards: rewards.public,
    links: {
      parent: asString(entry.links?.parent),
      children: asArray(entry.links?.children).map(asString),
      requires: asArray(entry.links?.requires).map(asString),
      unlocks: asArray(entry.links?.unlocks).map(asString),
    },
    chainId: chain?.id ?? "",
    web: entry.web ?? null,
    secrets: {
      gmNotes: asString(entry.gmNotes ?? entry.secrets?.gmNotes),
      hiddenTracks,
      hiddenMilestones,
      hiddenRewards: rewards.hidden,
    },
  };
}

/** Split a rewards block into revealed and vault halves. */
function parseRewards(raw, { coinKeys, name, warnings }) {
  const blank = () => ({
    items: [],
    currency: { amounts: {}, revealed: false, awarded: false },
    xp: { value: 0, revealed: false, awarded: false },
    custom: [],
  });
  const pub = blank();
  const hidden = blank();
  if (!raw || typeof raw !== "object") return { public: pub, hidden };

  // Currency may be `{gp: 5}` or `{amounts: {gp: 5}, hidden: true}`.
  const currencySource = raw.currency?.amounts ?? raw.currency ?? {};
  const currencyHidden = asBool(raw.currency?.hidden);
  for (const [key, value] of Object.entries(currencySource)) {
    if (key === "hidden" || key === "amounts") continue;
    if (!coinKeys.has(key)) {
      warnings.push(game.i18n.format("QW.IO.UnknownCoin", { quest: name, coin: key }));
      continue;
    }
    const target = currencyHidden ? hidden : pub;
    target.currency.amounts[key] = asInt(value);
  }
  if (Object.keys(pub.currency.amounts).length) pub.currency.revealed = true;

  const xpValue = asInt(raw.xp?.value ?? raw.xp);
  if (xpValue) {
    const target = asBool(raw.xp?.hidden) ? hidden : pub;
    target.xp.value = xpValue;
    if (target === pub) pub.xp.revealed = true;
  }

  asArray(raw.items).forEach((i) => {
    const item = {
      id: newId(),
      uuid: asString(i?.uuid),
      name: asString(i?.name ?? i),
      img: asString(i?.img),
      qty: Math.max(1, asInt(i?.qty ?? 1)),
      revealed: !asBool(i?.hidden),
      awarded: false,
      awardedTo: "",
    };
    if (!item.uuid) {
      warnings.push(game.i18n.format("QW.IO.ItemWithoutUuid", { quest: name, item: item.name }));
    }
    (asBool(i?.hidden) ? hidden : pub).items.push(item);
  });

  asArray(raw.custom).forEach((c) => {
    const entry = {
      id: newId(),
      text: asString(c?.text ?? c),
      revealed: !asBool(c?.hidden),
      awarded: false,
    };
    (asBool(c?.hidden) ? hidden : pub).custom.push(entry);
  });

  return { public: pub, hidden };
}
