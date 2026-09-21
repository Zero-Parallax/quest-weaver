/**
 * Quest Weaver: story webs.
 *
 * A web is a GM-only planning surface held in the vault. It holds its own
 * free-form nodes (NPCs, factions, places, secrets) and the positions of quest
 * nodes, but it does **not** own the quest chain: `requires` and `unlocks` live
 * on the quests themselves.
 *
 * That means those edges are derived rather than stored, so the graph and the
 * quest log can never disagree, and drawing one on the web edits the quest,
 * which makes the web an editor for the campaign, not a picture of it.
 */

import { EDGE_TYPE, NODE_KIND, STATUS_META, TYPE } from "../config.js";
import { newId } from "../data/fields.js";
import { QuestRepository } from "./quest-repository.js";
import { Vault } from "./vault.js";

/** Edge types that mean "quest chain" and belong on the quest documents. */
const CHAIN_TYPES = new Set([EDGE_TYPE.requires, EDGE_TYPE.unlocks]);

/** Colour per relationship, so a glance tells you what kind of link it is. */
export const EDGE_COLORS = {
  [EDGE_TYPE.leadsTo]: "#7a5ea8",
  [EDGE_TYPE.requires]: "#4a9eff",
  [EDGE_TYPE.unlocks]: "#3dba5a",
  [EDGE_TYPE.involves]: "#8a8f98",
  [EDGE_TYPE.rival]: "#e84040",
  [EDGE_TYPE.owns]: "#b8863b",
  [EDGE_TYPE.hidden]: "#b06c3a",
  [EDGE_TYPE.custom]: "#8a8f98",
};

export class StoryWeb {
  /** Every web in the vault. */
  static all() {
    return Vault.webs;
  }

  /** The web to show on open: the first, creating one if the vault is empty. */
  static async ensureDefault() {
    const existing = StoryWeb.all();
    if (existing.length) return existing[0];
    return Vault.createWeb(game.i18n.localize("QW.Web.Untitled"));
  }

  static get(uuid) {
    return StoryWeb.all().find((w) => w.uuid === uuid) ?? null;
  }

  /* -------------------------------------------- */
  /*  Reading                                     */
  /* -------------------------------------------- */

  /**
   * Build the renderable graph for a web.
   *
   * Quest nodes take their label and colour from the live quest, so a status
   * change or a rename shows up without touching the web.
   */
  static graph(web, { filter = null } = {}) {
    const source = web.system;
    const nodes = [];
    const questNodeByUuid = new Map();

    for (const node of source.nodes) {
      if (node.kind === NODE_KIND.quest) {
        const quest = QuestRepository.allUnfiltered().find((q) => q.uuid === node.ref);
        if (!quest) continue; // The quest was deleted; drop the node quietly.
        questNodeByUuid.set(node.ref, node.id);
        const meta = STATUS_META[quest.status] ?? STATUS_META.draft;
        nodes.push({
          id: node.id,
          kind: node.kind,
          ref: node.ref,
          x: node.x,
          y: node.y,
          label: quest.name,
          status: quest.status,
          color: node.color || meta.color,
          icon: meta.icon,
          hidden: quest.isHidden,
          progress: quest.system.progress,
          tags: quest.system.tags,
          notes: node.notes,
        });
      } else {
        nodes.push({
          id: node.id,
          kind: node.kind,
          ref: node.ref,
          x: node.x,
          y: node.y,
          label: node.label,
          img: node.img,
          color: node.color,
          notes: node.notes,
          tags: node.tags,
        });
      }
    }

    // Stored edges, then the ones derived from the quest chain itself.
    const edges = source.edges
      .filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
      .map((e) => ({ ...e, readOnly: false, color: e.color || EDGE_COLORS[e.type] }));

    for (const [uuid, nodeId] of questNodeByUuid) {
      const quest = QuestRepository.allUnfiltered().find((q) => q.uuid === uuid);
      if (!quest) continue;
      for (const target of quest.system.links.unlocks) {
        const toId = questNodeByUuid.get(target);
        if (!toId) continue;
        edges.push({
          id: `derived-${nodeId}-${toId}`,
          from: nodeId,
          to: toId,
          type: EDGE_TYPE.unlocks,
          color: EDGE_COLORS[EDGE_TYPE.unlocks],
          label: "",
          readOnly: true,
        });
      }
    }

    const filtered = filter ? nodes.filter(filter) : nodes;
    const keep = new Set(filtered.map((n) => n.id));
    return {
      nodes: filtered,
      edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }

  /* -------------------------------------------- */
  /*  Writing                                     */
  /* -------------------------------------------- */

  static async addNode(web, data) {
    const nodes = web.system.toObject().nodes;
    const node = {
      id: newId(),
      kind: data.kind ?? NODE_KIND.note,
      ref: data.ref ?? "",
      label: data.label ?? "",
      img: data.img ?? "",
      color: data.color ?? "",
      x: Math.round(data.x ?? 0),
      y: Math.round(data.y ?? 0),
      notes: data.notes ?? "",
      tags: data.tags ?? [],
    };
    nodes.push(node);
    await web.update({ "system.nodes": nodes });
    return node;
  }

  /** Put every quest on the web that is not already there. */
  static async addAllQuests(web, { spacing = 200 } = {}) {
    const source = web.system.toObject();
    const present = new Set(
      source.nodes.filter((n) => n.kind === NODE_KIND.quest).map((n) => n.ref),
    );
    const missing = QuestRepository.allUnfiltered().filter((q) => !present.has(q.uuid));
    if (!missing.length) return 0;

    missing.forEach((quest, i) => {
      source.nodes.push({
        id: newId(),
        kind: NODE_KIND.quest,
        ref: quest.uuid,
        label: quest.name,
        img: quest.system.img ?? "",
        color: "",
        x: (i % 5) * spacing,
        y: Math.floor(i / 5) * spacing,
        notes: "",
        tags: [],
      });
    });
    await web.update({ "system.nodes": source.nodes });
    return missing.length;
  }

  static async updateNode(web, nodeId, changes) {
    const nodes = web.system.toObject().nodes;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    Object.assign(node, changes);
    await web.update({ "system.nodes": nodes });
  }

  static async moveNode(web, nodeId, x, y) {
    return StoryWeb.updateNode(web, nodeId, { x: Math.round(x), y: Math.round(y) });
  }

  /** Apply many positions at once, for auto-layout. */
  static async moveNodes(web, positions) {
    const nodes = web.system.toObject().nodes;
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (pos) {
        node.x = Math.round(pos.x);
        node.y = Math.round(pos.y);
      }
    }
    await web.update({ "system.nodes": nodes });
  }

  static async removeNode(web, nodeId) {
    const source = web.system.toObject();
    source.nodes = source.nodes.filter((n) => n.id !== nodeId);
    source.edges = source.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    await web.update({ "system.nodes": source.nodes, "system.edges": source.edges });
  }

  /**
   * Connect two nodes.
   *
   * A chain link between two quests is written to the quests, not the web, so
   * the graph and the quest log stay one source of truth.
   */
  static async connect(web, fromId, toId, type = EDGE_TYPE.leadsTo, label = "") {
    const source = web.system.toObject();
    const from = source.nodes.find((n) => n.id === fromId);
    const to = source.nodes.find((n) => n.id === toId);
    if (!from || !to) return null;

    if (CHAIN_TYPES.has(type) && from.kind === NODE_KIND.quest && to.kind === NODE_KIND.quest) {
      return StoryWeb.#linkQuests(from.ref, to.ref, type);
    }

    source.edges.push({
      id: newId(),
      from: fromId,
      to: toId,
      type,
      label,
      color: "",
      dashed: type === EDGE_TYPE.hidden,
    });
    await web.update({ "system.edges": source.edges });
    return true;
  }

  /** Write a prerequisite relationship onto the quest documents themselves. */
  static async #linkQuests(fromUuid, toUuid, type) {
    const earlier = type === EDGE_TYPE.unlocks ? fromUuid : toUuid;
    const later = type === EDGE_TYPE.unlocks ? toUuid : fromUuid;

    const a = QuestRepository.allUnfiltered().find((q) => q.uuid === earlier);
    const b = QuestRepository.allUnfiltered().find((q) => q.uuid === later);
    if (!a || !b) return null;

    const unlocks = new Set(a.system.links.unlocks);
    unlocks.add(later);
    const requires = new Set(b.system.links.requires);
    requires.add(earlier);

    await Promise.all([
      a.page.update({ "system.links.unlocks": [...unlocks] }),
      b.page.update({ "system.links.requires": [...requires] }),
    ]);
    return true;
  }

  /** Remove an edge. Derived chain edges are removed from the quests. */
  static async disconnect(web, edgeId) {
    if (edgeId.startsWith("derived-")) {
      const [, fromId, toId] = edgeId.split("-");
      const source = web.system;
      const from = source.nodes.find((n) => n.id === fromId);
      const to = source.nodes.find((n) => n.id === toId);
      if (!from || !to) return;

      const a = QuestRepository.allUnfiltered().find((q) => q.uuid === from.ref);
      const b = QuestRepository.allUnfiltered().find((q) => q.uuid === to.ref);
      if (!a || !b) return;

      await Promise.all([
        a.page.update({
          "system.links.unlocks": a.system.links.unlocks.filter((u) => u !== b.uuid),
        }),
        b.page.update({
          "system.links.requires": b.system.links.requires.filter((u) => u !== a.uuid),
        }),
      ]);
      return;
    }

    const edges = web.system.toObject().edges.filter((e) => e.id !== edgeId);
    await web.update({ "system.edges": edges });
  }

  static async setView(web, view) {
    await web.update({
      "system.view.zoom": view.zoom,
      "system.view.panX": view.panX,
      "system.view.panY": view.panY,
    });
  }

  static async rename(web, name) {
    await web.update({ name });
  }

  static async create(name) {
    return Vault.createWeb(name);
  }

  static async delete(web) {
    await web.delete();
  }

  /** True when a page is a story web, used by refresh hooks. */
  static isWeb(page) {
    return page?.type === TYPE.storyweb;
  }
}
