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

import { EDGE_TYPE, NODE_KIND, STATUS, STATUS_LIST } from "../config.js";
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
/** A number, or null when there is none, so "no position" differs from 0. */
const asNumber = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const NODE_KINDS = new Set(Object.values(NODE_KIND));
const EDGE_TYPES = new Set(Object.values(EDGE_TYPE));
const CHAIN_TYPES = new Set([EDGE_TYPE.requires, EDGE_TYPE.unlocks]);

/**
 * Parse and normalise an import payload.
 *
 * @param {object|string} raw  Parsed JSON, or a JSON string.
 * @returns {{quests: object[], chain: object|null, webs: object[],
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
      return { quests: [], chain: null, webs: [], errors: [
        game.i18n.format("QW.IO.BadJSON", { message: err.message }),
      ], warnings };
    }
  }

  if (!data || typeof data !== "object") {
    return { quests: [], chain: null, webs: [],
      errors: [game.i18n.localize("QW.IO.NotAnObject")], warnings };
  }

  // A bare array of quests, a single quest, or a single web is accepted as a convenience.
  if (Array.isArray(data)) data = { quests: data };
  if (Array.isArray(data.nodes) && !data.quests && !data.webs) data = { webs: [data] };
  if (data.name && !data.quests && !data.webs) data = { quests: [data] };

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

  const webs = [];
  const seenWebIds = new Set();
  [...asArray(data.webs), ...asArray(data.web)].forEach((entry, index) => {
    const web = parseWeb(entry, index, { chain, errors, warnings, seenWebIds });
    if (web) webs.push(web);
  });

  if (!quests.length && !webs.length && !errors.length) {
    errors.push(game.i18n.localize("QW.IO.NoQuests"));
  }

  return { quests, chain, webs, errors, warnings };
}

/**
 * Normalise one story web.
 *
 * Node and edge ids stay as written: they only join the lists inside this file,
 * and the importer maps them to real ids. A quest node keeps its quest reference
 * unresolved, because it may name a quest already in the world rather than one
 * in this file, and only the importer can look there.
 */
function parseWeb(entry, index, { chain, errors, warnings, seenWebIds }) {
  if (!entry || typeof entry !== "object") {
    errors.push(game.i18n.format("QW.IO.BadWeb", { index: index + 1 }));
    return null;
  }

  const name = asString(entry.name).trim() || chain?.name || game.i18n.localize("QW.Web.Untitled");
  const importId = asString(entry.id).trim() || `qw-web-${index}-${name.slugify({ strict: true })}`;
  if (seenWebIds.has(importId)) {
    warnings.push(game.i18n.format("QW.IO.DuplicateWebId", { id: importId }));
  }
  seenWebIds.add(importId);

  const nodes = [];
  const byId = new Map();
  asArray(entry.nodes).forEach((n, i) => {
    if (!n || typeof n !== "object") {
      warnings.push(game.i18n.format("QW.IO.BadNode", { web: name, index: i + 1 }));
      return;
    }

    const quest = asString(n.quest ?? (n.kind === NODE_KIND.quest ? n.ref : "")).trim();
    const label = asString(n.label ?? n.name);
    let kind = quest ? NODE_KIND.quest : asString(n.kind).trim() || NODE_KIND.note;
    if (!NODE_KINDS.has(kind)) {
      warnings.push(game.i18n.format("QW.IO.UnknownNodeKind", { web: name, node: label, kind }));
      kind = NODE_KIND.note;
    }
    if (kind === NODE_KIND.quest && !quest) {
      warnings.push(game.i18n.format("QW.IO.QuestNodeWithoutQuest", { web: name, index: i + 1 }));
      return;
    }

    // A quest card is known by its quest's id unless it says otherwise, so edges
    // can name quests directly.
    const id = asString(n.id).trim() || quest || label.slugify({ strict: true }) || `node-${i}`;
    if (byId.has(id)) {
      warnings.push(game.i18n.format("QW.IO.DuplicateNodeId", { web: name, id }));
      return;
    }

    const node = {
      importId: id,
      kind,
      quest,
      label,
      img: asString(n.img),
      color: asString(n.color),
      notes: asString(n.notes),
      tags: asArray(n.tags).map(asString).filter(Boolean),
      x: asNumber(n.x),
      y: asNumber(n.y),
    };
    byId.set(id, node);
    nodes.push(node);
  });

  // An edge end may name a node by id or label, or a quest that has a card on this web.
  const slug = (text) => text.slugify({ strict: true });
  const byQuest = new Map(nodes.filter((n) => n.quest).map((n) => [n.quest, n]));
  const byLabel = new Map(nodes.filter((n) => n.label).map((n) => [slug(n.label), n]));
  const endpoint = (ref) => byId.get(ref) ?? byQuest.get(ref) ?? byLabel.get(slug(ref)) ?? null;

  const edges = [];
  const chainLinks = [];
  asArray(entry.edges).forEach((e) => {
    const fromRef = asString(e?.from).trim();
    const toRef = asString(e?.to).trim();
    const from = endpoint(fromRef);
    const to = endpoint(toRef);
    if (!from || !to) {
      warnings.push(game.i18n.format("QW.IO.UnknownEdgeEnd", { web: name, from: fromRef, to: toRef }));
      return;
    }
    if (from === to) return;

    // Anything not a known relationship is kept as a custom one, labelled with
    // what the file called it.
    let type = asString(e.type).trim() || EDGE_TYPE.leadsTo;
    let label = asString(e.label);
    if (!EDGE_TYPES.has(type)) {
      label ||= type;
      type = EDGE_TYPE.custom;
    }

    // The chain between two quests belongs on the quests, as on the web itself.
    if (CHAIN_TYPES.has(type) && from.quest && to.quest) {
      chainLinks.push({ from: from.quest, to: to.quest, type });
      return;
    }

    edges.push({
      from: from.importId,
      to: to.importId,
      type,
      label,
      color: asString(e.color),
      dashed: e.dashed == null ? type === EDGE_TYPE.hidden : asBool(e.dashed),
    });
  });

  return {
    importId,
    name,
    description: asString(entry.description),
    nodes,
    edges,
    chainLinks,
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
