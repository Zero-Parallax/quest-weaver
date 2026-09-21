/**
 * Quest Weaver: the story web window.
 *
 * A GM-only planning surface. The toolbar is rendered by Handlebars and
 * re-renders normally; the canvas is driven imperatively by SvgGraph, because
 * re-rendering a graph on every drag would throw away the pan, the zoom and the
 * pointer capture mid-gesture.
 */

import { EDGE_TYPE, MODULE_ID, NODE_KIND, NODE_KIND_CHOICES, EDGE_TYPE_CHOICES } from "../config.js";
import { QuestRepository } from "../core/quest-repository.js";
import { EDGE_COLORS, StoryWeb } from "../core/story-web.js";
import { SvgGraph, layeredLayout } from "../ui/svg-graph.js";
import { openQuestSheet } from "./quest-log.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Icons per node kind, so a web reads at a glance. */
const KIND_ICONS = {
  [NODE_KIND.quest]: "fa-scroll",
  [NODE_KIND.npc]: "fa-user",
  [NODE_KIND.faction]: "fa-shield-halved",
  [NODE_KIND.location]: "fa-location-dot",
  [NODE_KIND.event]: "fa-bolt",
  [NODE_KIND.clue]: "fa-magnifying-glass",
  [NODE_KIND.secret]: "fa-user-secret",
  [NODE_KIND.note]: "fa-note-sticky",
};

export class StoryWebApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "quest-weaver-web",
    classes: ["quest-weaver", "qw-web"],
    window: {
      title: "QW.Web.Title",
      icon: "fa-solid fa-diagram-project",
      resizable: true,
      contentClasses: ["qw-web-content"],
    },
    position: { width: 1040, height: 760 },
    actions: {
      addNode: StoryWebApp.#onAddNode,
      addQuest: StoryWebApp.#onAddQuest,
      addAllQuests: StoryWebApp.#onAddAllQuests,
      autoLayout: StoryWebApp.#onAutoLayout,
      fitView: StoryWebApp.#onFitView,
      newWeb: StoryWebApp.#onNewWeb,
      renameWeb: StoryWebApp.#onRenameWeb,
      deleteWeb: StoryWebApp.#onDeleteWeb,
      toggleSnap: StoryWebApp.#onToggleSnap,
    },
  };

  /** @override */
  static PARTS = {
    toolbar: { template: `modules/${MODULE_ID}/templates/story-web.hbs` },
  };

  /** UUID of the web on screen. */
  #webUuid = null;

  /** The canvas engine, rebuilt on each full render. */
  #graph = null;

  /** Grid snap size in graph units, 0 for free placement. */
  #snap = 0;

  /** Node kinds currently shown; empty means everything. */
  #kindFilter = new Set();

  static #instance = null;

  static async open() {
    if (!game.user.isGM) return null;
    StoryWebApp.#instance ??= new StoryWebApp();
    const app = StoryWebApp.#instance;
    if (!app.#webUuid) {
      const web = await StoryWeb.ensureDefault();
      app.#webUuid = web?.uuid ?? null;
    }
    if (app.rendered) app.bringToFront();
    else app.render(true);
    return app;
  }

  static refresh() {
    const app = StoryWebApp.#instance;
    if (app?.rendered) app.redraw();
  }

  get web() {
    return this.#webUuid ? StoryWeb.get(this.#webUuid) : null;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const webs = StoryWeb.all();
    const web = this.web ?? webs[0] ?? null;
    this.#webUuid = web?.uuid ?? null;

    return Object.assign(context, {
      webs: webs.map((w) => ({ uuid: w.uuid, name: w.name, active: w.uuid === this.#webUuid })),
      web,
      hasWeb: !!web,
      snap: this.#snap,
      kinds: Object.entries(NODE_KIND_CHOICES).map(([id, label]) => ({
        id,
        label,
        icon: KIND_ICONS[id],
        active: this.#kindFilter.has(id),
      })),
      nodeCount: web ? web.system.nodes.length : 0,
    });
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const canvas = this.element.querySelector(".qw-web-canvas-host");
    if (!canvas) return;

    this.#graph = new SvgGraph(canvas, {
      onNodeMove: (id, x, y) => StoryWeb.moveNode(this.web, id, x, y),
      onOpen: (id) => this.#openNode(id),
      onConnect: (from, to) => this.#promptConnect(from, to),
      onContext: (event, id, kind) => this.#contextMenu(event, id, kind),
      onViewChange: foundry.utils.debounce((view) => {
        if (this.web) StoryWeb.setView(this.web, view);
      }, 600),
    });
    this.#graph.setSnap(this.#snap);

    const select = this.element.querySelector('[name="qw-web-select"]');
    select?.addEventListener("change", (event) => {
      this.#webUuid = event.target.value;
      this.render();
    });

    this.redraw();

    const view = this.web?.system.view;
    if (view && (view.panX || view.panY || view.zoom !== 1)) this.#graph.setView(view);
    else this.#graph.fit();
  }

  /** Push the current web into the canvas without re-rendering the window. */
  redraw() {
    if (!this.#graph) return;
    const web = this.web;
    if (!web) return this.#graph.setData([], []);

    const filter = this.#kindFilter.size ? (n) => this.#kindFilter.has(n.kind) : null;
    const { nodes, edges } = StoryWeb.graph(web, { filter });

    this.#graph.setData(
      nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        color: n.color,
        classes: `kind-${n.kind}${n.hidden ? " is-hidden-quest" : ""}`,
        html: this.#nodeHTML(n),
      })),
      edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        color: e.color || EDGE_COLORS[e.type],
        dashed: e.dashed || e.type === EDGE_TYPE.hidden,
        label: e.label,
        readOnly: e.readOnly,
      })),
    );
  }

  /** The card markup for one node. */
  #nodeHTML(node) {
    const icon = KIND_ICONS[node.kind] ?? "fa-note-sticky";
    const label = foundry.utils.escapeHTML(node.label || game.i18n.localize("QW.Web.Untitled"));

    const bits = [`<div class="qw-web-node-head"><i class="fa-solid ${icon}"></i><span>${label}</span></div>`];

    if (node.kind === NODE_KIND.quest) {
      bits.push(
        `<div class="qw-web-node-meta">
          <span class="qw-web-status">${game.i18n.localize(`QW.Status.${node.status}`)}</span>
          ${node.hidden ? '<i class="fa-solid fa-eye-slash" title="hidden"></i>' : ""}
        </div>`,
      );
      if (node.progress?.total) {
        bits.push(
          `<div class="qw-web-progress"><div style="width:${node.progress.pct}%"></div></div>`,
        );
      }
    } else if (node.notes) {
      const text = foundry.utils.escapeHTML(node.notes.replace(/<[^>]+>/g, "").slice(0, 90));
      bits.push(`<div class="qw-web-node-notes">${text}</div>`);
    }

    return bits.join("");
  }

  /* -------------------------------------------- */
  /*  Interaction                                 */
  /* -------------------------------------------- */

  #openNode(nodeId) {
    const node = this.web?.system.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.kind === NODE_KIND.quest) {
      const quest = QuestRepository.allUnfiltered().find((q) => q.uuid === node.ref);
      if (quest) return openQuestSheet(quest);
      return;
    }
    return this.#editNode(nodeId);
  }

  /** Ask what kind of connection this is, then make it. */
  async #promptConnect(fromId, toId) {
    const web = this.web;
    if (!web) return;
    const from = web.system.nodes.find((n) => n.id === fromId);
    const to = web.system.nodes.find((n) => n.id === toId);
    const bothQuests = from?.kind === NODE_KIND.quest && to?.kind === NODE_KIND.quest;

    const options = Object.entries(EDGE_TYPE_CHOICES)
      .map(([id, label]) => `<option value="${id}">${game.i18n.localize(label)}</option>`)
      .join("");

    const data = await DialogV2.prompt({
      window: { title: "QW.Web.ConnectTitle", icon: "fa-solid fa-link" },
      classes: ["quest-weaver"],
      position: { width: 420 },
      content: `<div class="qw-propose">
        <p class="hint">${game.i18n.format("QW.Web.ConnectHint", {
          from: foundry.utils.escapeHTML(from?.label ?? "?"),
          to: foundry.utils.escapeHTML(to?.label ?? "?"),
        })}</p>
        <label><span>${game.i18n.localize("QW.Web.Relationship")}</span>
          <select name="type">${options}</select></label>
        <label><span>${game.i18n.localize("QW.Web.EdgeLabel")}</span>
          <input type="text" name="label"></label>
        ${
          bothQuests
            ? `<p class="hint">${game.i18n.localize("QW.Web.ChainHint")}</p>`
            : ""
        }
      </div>`,
      ok: {
        label: "QW.Web.Connect",
        icon: "fa-solid fa-link",
        callback: (event, button) => new FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
    if (!data) return;

    await StoryWeb.connect(web, fromId, toId, data.type, data.label ?? "");
    this.redraw();
  }

  #contextMenu(event, id, kind) {
    const entries = [];

    if (kind === "node") {
      const node = this.web?.system.nodes.find((n) => n.id === id);
      if (node?.kind === NODE_KIND.quest) {
        entries.push({
          name: game.i18n.localize("QW.Web.OpenQuest"),
          icon: '<i class="fa-solid fa-scroll"></i>',
          callback: () => this.#openNode(id),
        });
      } else {
        entries.push({
          name: game.i18n.localize("QW.Web.EditNode"),
          icon: '<i class="fa-solid fa-pen"></i>',
          callback: () => this.#editNode(id),
        });
      }
      entries.push({
        name: game.i18n.localize("QW.Web.RemoveNode"),
        icon: '<i class="fa-solid fa-trash"></i>',
        callback: async () => {
          await StoryWeb.removeNode(this.web, id);
          this.redraw();
        },
      });
    } else if (kind === "edge") {
      entries.push({
        name: game.i18n.localize("QW.Web.RemoveEdge"),
        icon: '<i class="fa-solid fa-link-slash"></i>',
        callback: async () => {
          await StoryWeb.disconnect(this.web, id);
          this.redraw();
        },
      });
    }

    if (!entries.length) return;
    StoryWebApp.#showMenu(event, entries);
  }

  /** A minimal context menu placed at the cursor. */
  static #showMenu(event, entries) {
    document.querySelector(".qw-web-menu")?.remove();
    const menu = document.createElement("nav");
    menu.className = "qw-web-menu quest-weaver";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    for (const entry of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.innerHTML = `${entry.icon} <span>${entry.name}</span>`;
      item.addEventListener("click", () => {
        menu.remove();
        entry.callback();
      });
      menu.append(item);
    }
    document.body.append(menu);

    const dismiss = (e) => {
      if (menu.contains(e.target)) return;
      menu.remove();
      window.removeEventListener("pointerdown", dismiss);
    };
    setTimeout(() => window.addEventListener("pointerdown", dismiss), 0);
  }

  /** Edit a free-form node's label, colour and notes. */
  async #editNode(nodeId) {
    const node = this.web?.system.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const kinds = Object.entries(NODE_KIND_CHOICES)
      .filter(([id]) => id !== NODE_KIND.quest)
      .map(
        ([id, label]) =>
          `<option value="${id}" ${id === node.kind ? "selected" : ""}>${game.i18n.localize(
            label,
          )}</option>`,
      )
      .join("");

    const data = await DialogV2.prompt({
      window: { title: "QW.Web.EditNode", icon: "fa-solid fa-pen" },
      classes: ["quest-weaver"],
      position: { width: 460 },
      content: `<div class="qw-propose">
        <label><span>${game.i18n.localize("QW.Web.NodeLabel")}</span>
          <input type="text" name="label" value="${foundry.utils.escapeHTML(node.label)}"></label>
        <label><span>${game.i18n.localize("QW.Web.NodeKind")}</span>
          <select name="kind">${kinds}</select></label>
        <label><span>${game.i18n.localize("QW.Web.NodeNotes")}</span>
          <textarea name="notes" rows="4">${foundry.utils.escapeHTML(node.notes)}</textarea></label>
      </div>`,
      ok: {
        label: "QW.Web.Save",
        icon: "fa-solid fa-check",
        callback: (event, button) => new FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
    if (!data) return;

    await StoryWeb.updateNode(this.web, nodeId, {
      label: data.label,
      kind: data.kind,
      notes: data.notes,
    });
    this.redraw();
  }

  /* -------------------------------------------- */
  /*  Toolbar actions                             */
  /* -------------------------------------------- */

  static async #onAddNode() {
    const web = this.web;
    if (!web) return;
    const centre = this.#graph?.centreOfView() ?? { x: 0, y: 0 };
    const node = await StoryWeb.addNode(web, {
      kind: NODE_KIND.note,
      label: game.i18n.localize("QW.Web.NewNode"),
      x: centre.x,
      y: centre.y,
    });
    this.redraw();
    if (node) this.#editNode(node.id);
  }

  static async #onAddQuest() {
    const web = this.web;
    if (!web) return;

    const present = new Set(
      web.system.nodes.filter((n) => n.kind === NODE_KIND.quest).map((n) => n.ref),
    );
    const available = QuestRepository.allUnfiltered().filter((q) => !present.has(q.uuid));
    if (!available.length) {
      return ui.notifications.info(game.i18n.localize("QW.Web.AllQuestsPresent"));
    }

    const options = available
      .map((q) => `<option value="${q.uuid}">${foundry.utils.escapeHTML(q.name)}</option>`)
      .join("");

    const data = await DialogV2.prompt({
      window: { title: "QW.Web.AddQuest", icon: "fa-solid fa-scroll" },
      classes: ["quest-weaver"],
      position: { width: 460 },
      content: `<div class="qw-propose">
        <label><span>${game.i18n.localize("QW.Web.PickQuest")}</span>
          <select name="uuid">${options}</select></label>
      </div>`,
      ok: {
        label: "QW.Web.Add",
        icon: "fa-solid fa-plus",
        callback: (event, button) => new FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
    if (!data?.uuid) return;

    const centre = this.#graph?.centreOfView() ?? { x: 0, y: 0 };
    await StoryWeb.addNode(web, { kind: NODE_KIND.quest, ref: data.uuid, ...centre });
    this.redraw();
  }

  static async #onAddAllQuests() {
    const added = await StoryWeb.addAllQuests(this.web);
    this.redraw();
    if (added) {
      await StoryWebApp.#layout.call(this);
      ui.notifications.info(game.i18n.format("QW.Web.AddedQuests", { count: added }));
    } else {
      ui.notifications.info(game.i18n.localize("QW.Web.AllQuestsPresent"));
    }
  }

  static async #onAutoLayout() {
    await StoryWebApp.#layout.call(this);
  }

  static async #layout() {
    const web = this.web;
    if (!web) return;
    const { nodes, edges } = StoryWeb.graph(web);
    const positions = layeredLayout(nodes, edges);
    await StoryWeb.moveNodes(web, positions);
    this.redraw();
    this.#graph?.fit();
  }

  static #onFitView() {
    this.#graph?.fit();
  }

  static #onToggleSnap() {
    this.#snap = this.#snap ? 0 : 20;
    this.#graph?.setSnap(this.#snap);
    this.render();
  }

  static async #onNewWeb() {
    const data = await DialogV2.prompt({
      window: { title: "QW.Web.NewWeb", icon: "fa-solid fa-diagram-project" },
      classes: ["quest-weaver"],
      position: { width: 420 },
      content: `<div class="qw-propose"><label><span>${game.i18n.localize(
        "QW.Web.NodeLabel",
      )}</span><input type="text" name="name" autofocus></label></div>`,
      ok: {
        label: "QW.Web.Create",
        icon: "fa-solid fa-plus",
        callback: (event, button) => new FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
    if (!data?.name?.trim()) return;
    const web = await StoryWeb.create(data.name.trim());
    this.#webUuid = web?.uuid ?? this.#webUuid;
    this.render();
  }

  static async #onRenameWeb() {
    const web = this.web;
    if (!web) return;
    const data = await DialogV2.prompt({
      window: { title: "QW.Web.Rename", icon: "fa-solid fa-pen" },
      classes: ["quest-weaver"],
      position: { width: 420 },
      content: `<div class="qw-propose"><label><span>${game.i18n.localize(
        "QW.Web.NodeLabel",
      )}</span><input type="text" name="name" value="${foundry.utils.escapeHTML(
        web.name,
      )}"></label></div>`,
      ok: {
        label: "QW.Web.Save",
        icon: "fa-solid fa-check",
        callback: (event, button) => new FormDataExtended(button.form).object,
      },
      rejectClose: false,
    });
    if (!data?.name?.trim()) return;
    await StoryWeb.rename(web, data.name.trim());
    this.render();
  }

  static async #onDeleteWeb() {
    const web = this.web;
    if (!web) return;
    const ok = await DialogV2.confirm({
      window: { title: "QW.Web.DeleteWeb" },
      content: `<p>${game.i18n.format("QW.Web.DeleteConfirm", {
        name: foundry.utils.escapeHTML(web.name),
      })}</p>`,
    });
    if (!ok) return;
    await StoryWeb.delete(web);
    this.#webUuid = null;
    this.render();
  }
}

/** Keep an open web in step with quest and web changes from any client. */
export function registerStoryWebHooks() {
  const refresh = foundry.utils.debounce(() => StoryWebApp.refresh(), 150);
  for (const hook of [
    "updateJournalEntryPage",
    "createJournalEntryPage",
    "deleteJournalEntryPage",
    "updateJournalEntry",
    "deleteJournalEntry",
  ]) {
    Hooks.on(hook, refresh);
  }
}
