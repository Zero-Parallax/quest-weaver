/**
 * Quest Weaver: import and export.
 *
 * Nothing is created until the GM has seen exactly what will happen: the
 * preview names every quest, says whether it is new or an update, and lists
 * anything that could not be understood.
 */

import { MODULE_ID, OWNERSHIP } from "../config.js";
import { QuestRepository } from "../core/quest-repository.js";
import { buildExport, downloadJSON, exportableQuests } from "../io/exporter.js";
import { planImport, runImport } from "../io/importer.js";
import { parseImport } from "../io/schema.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImportExportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "quest-weaver-io",
    classes: ["quest-weaver", "qw-io"],
    window: { title: "QW.IO.Title", icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 680, height: 720 },
    actions: {
      pickFile: ImportExportDialog.#onPickFile,
      parse: ImportExportDialog.#onParse,
      runImport: ImportExportDialog.#onRunImport,
      clearInput: ImportExportDialog.#onClearInput,
      exportAll: ImportExportDialog.#onExportAll,
      copyExample: ImportExportDialog.#onCopyExample,
    },
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/import-export.hbs`, scrollable: [""] },
  };

  /** @override */
  static TABS = {
    primary: {
      initial: "import",
      labelPrefix: "QW.IO.Tab",
      tabs: [
        { id: "import", icon: "fa-solid fa-file-import" },
        { id: "export", icon: "fa-solid fa-file-export" },
      ],
    },
  };

  /** Raw text in the paste box. */
  #text = "";

  /** Result of the last parse, or null. */
  #parsed = null;

  /** Per-quest plan rows from the last parse. */
  #plan = [];

  /** Toggled from the template by name, so these are deliberately not private. */
  updateExisting = true;
  startHidden = true;
  playerSafe = false;

  static #instance = null;

  static open() {
    ImportExportDialog.#instance ??= new ImportExportDialog();
    if (ImportExportDialog.#instance.rendered) ImportExportDialog.#instance.bringToFront();
    else ImportExportDialog.#instance.render(true);
    return ImportExportDialog.#instance;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const quests = exportableQuests();

    return Object.assign(context, {
      text: this.#text,
      parsed: this.#parsed,
      plan: this.#plan,
      updateExisting: this.updateExisting,
      startHidden: this.startHidden,
      playerSafe: this.playerSafe,
      canImport: !!this.#parsed && !this.#parsed.errors.length && this.#plan.length > 0,
      counts: {
        create: this.#plan.filter((p) => p.action === "create").length,
        update: this.#plan.filter((p) => p.action === "update").length,
      },
      exportCount: quests.length,
      isGM: game.user.isGM,
    });
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const textarea = this.element.querySelector('[name="qw-json"]');
    if (textarea) {
      textarea.addEventListener("input", (event) => {
        this.#text = event.target.value;
        // Invalidate a stale preview so it does not sit there looking current.
        if (this.#parsed) {
          this.#parsed = null;
          this.#plan = [];
          this.render();
        }
      });
    }

    for (const el of this.element.querySelectorAll("[data-toggle]")) {
      el.addEventListener("change", (event) => {
        this[event.target.dataset.toggle] = event.target.checked;
        this.render();
      });
    }

    const file = this.element.querySelector('input[type="file"]');
    file?.addEventListener("change", async (event) => {
      const chosen = event.target.files?.[0];
      if (!chosen) return;
      this.#text = await chosen.text();
      this.#parse();
    });
  }

  /* -------------------------------------------- */

  /** Parse the current text and build the plan. */
  #parse() {
    if (!this.#text.trim()) {
      this.#parsed = null;
      this.#plan = [];
      return this.render();
    }
    this.#parsed = parseImport(this.#text);
    this.#plan = this.#parsed.errors.length ? [] : planImport(this.#parsed.quests);
    this.render();
  }

  static #onPickFile() {
    this.element.querySelector('input[type="file"]')?.click();
  }

  static #onParse() {
    this.#parse();
  }

  static #onClearInput() {
    this.#text = "";
    this.#parsed = null;
    this.#plan = [];
    this.render();
  }

  static async #onRunImport() {
    if (!this.#parsed || this.#parsed.errors.length) return;
    try {
      const result = await runImport(this.#parsed.quests, {
        update: this.updateExisting,
        ownership: this.startHidden ? OWNERSHIP.NONE : OWNERSHIP.OBSERVER,
      });
      ui.notifications.info(
        game.i18n.format("QW.IO.Imported", { created: result.created, updated: result.updated }),
      );
      this.#text = "";
      this.#parsed = null;
      this.#plan = [];
      this.render();
    } catch (err) {
      ui.notifications.error(err.message);
      console.error("Quest Weaver | import failed", err);
    }
  }

  static #onExportAll() {
    const quests = exportableQuests();
    if (!quests.length) return ui.notifications.info(game.i18n.localize("QW.IO.NothingToExport"));

    const payload = buildExport(quests, { playerSafe: this.playerSafe });
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = this.playerSafe ? "-player-safe" : "";
    downloadJSON(payload, `quest-weaver-${game.world.id}-${stamp}${suffix}.json`);
    ui.notifications.info(game.i18n.format("QW.IO.Exported", { count: quests.length }));
  }

  /** Drop a worked example into the paste box so the shape is obvious. */
  static async #onCopyExample() {
    const response = await fetch(`modules/${MODULE_ID}/examples/example-chain.json`);
    this.#text = await response.text();
    this.#parse();
  }
}

/** Export a single quest straight to a file, used from the log's context menu. */
export function exportQuest(quest, { playerSafe = false } = {}) {
  if (!quest) return;
  const payload = buildExport([quest], { playerSafe });
  downloadJSON(payload, `${quest.name.slugify({ strict: true }) || "quest"}.json`);
}

/** Export every quest sharing a chain id. */
export function exportChain(chainId, { playerSafe = false } = {}) {
  const quests = QuestRepository.allUnfiltered().filter(
    (q) => q.system.source.chainId === chainId,
  );
  if (!quests.length) return;
  const payload = buildExport(quests, { playerSafe, chain: { id: chainId, name: chainId } });
  downloadJSON(payload, `${chainId}.json`);
}
