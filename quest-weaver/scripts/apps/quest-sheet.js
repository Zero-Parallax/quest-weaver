/**
 * Quest Weaver: the quest page sheet.
 *
 * Reads from both halves of a quest and writes back to whichever half each
 * field belongs to, so the GM edits one coherent document and never has to
 * think about the public/vault split. Rows that still live in the vault are
 * marked, and the padlock on each row moves it across.
 */

import { MODULE_ID, OWNERSHIP, STATUS, STATUS_META, TYPE } from "../config.js";
import { Quest, QuestRepository, rewardUpdates } from "../core/quest-repository.js";
import { Reveal } from "../core/reveal.js";
import { SecretsModel } from "../data/secrets-model.js";
import { newId } from "../data/fields.js";
import { denominations, difficultyOptions } from "../settings.js";
import { enrich } from "../ui/enrich.js";
import { describeValidationError, reportProblems } from "../ui/validation.js";
import { AwardDialog } from "./award-dialog.js";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;

export class QuestPageSheet extends JournalEntryPageHandlebarsSheet {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["quest-weaver", "quest-page"],
    window: { icon: "fa-solid fa-scroll" },
    position: { width: 760, height: 800 },
    actions: {
      addTrack: QuestPageSheet.#onAddTrack,
      deleteTrack: QuestPageSheet.#onDeleteTrack,
      toggleTrackSecret: QuestPageSheet.#onToggleTrackSecret,
      addMilestone: QuestPageSheet.#onAddMilestone,
      deleteMilestone: QuestPageSheet.#onDeleteMilestone,
      toggleMilestoneSecret: QuestPageSheet.#onToggleMilestoneSecret,
      addCustomReward: QuestPageSheet.#onAddCustomReward,
      deleteReward: QuestPageSheet.#onDeleteReward,
      toggleRewardSecret: QuestPageSheet.#onToggleRewardSecret,
      revealAllRewards: QuestPageSheet.#onRevealAllRewards,
      awardRewards: QuestPageSheet.#onAwardRewards,
      clearGiver: QuestPageSheet.#onClearGiver,
      removeAssignee: QuestPageSheet.#onRemoveAssignee,
      openAssignee: QuestPageSheet.#onOpenAssignee,
    },
  };

  /** @inheritDoc */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: {
      template: `modules/${MODULE_ID}/templates/quest-page-edit.hbs`,
      classes: ["standard-form", "qw-edit"],
      scrollable: [""],
      templates: [
        `modules/${MODULE_ID}/templates/parts/milestone-row.hbs`,
        `modules/${MODULE_ID}/templates/parts/reward-rows.hbs`,
      ],
    },
    footer: super.EDIT_PARTS.footer,
  };

  /**
   * @override
   *
   * Deliberately not `root: true`. A root part has its wrapper stripped and its
   * children hoisted straight into `.window-content`, which means the view's own
   * container never exists in the DOM, so it cannot be given a layout or made
   * to scroll, and every rule scoped to it silently fails to match.
   */
  static VIEW_PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/quest-page-view.hbs`,
      classes: ["qw-view"],
      scrollable: [""],
    },
  };

  /**
   * Set when a save is refused, so pressing Save over a validation error does
   * not close the sheet and lose the GM's place.
   */
  #saveRefused = false;

  /** The quest facade for this page, re-wrapped on every access. */
  get quest() {
    return Quest.wrap(this.document);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const quest = this.quest;
    const system = this.document.system;

    Object.assign(context, {
      quest,
      system,
      // NB: `context.fields` belongs to the document schema and is used by the
      // core page header part. Our system fields go under a separate key.
      systemFields: system.schema.fields,
      gmNotesField: SecretsModel.schema.fields.gmNotes,
      isGM: game.user.isGM,
      statusMeta: STATUS_META[system.status] ?? STATUS_META.draft,
      enriched: {
        summary: await enrich(system.summary, this.document),
        description: await enrich(system.description, this.document),
        gmNotes: game.user.isGM ? await enrich(quest.gmNotes, this.document) : "",
      },
      groups: this.#milestoneGroups(quest),
      milestones: game.user.isGM
        ? quest.allMilestones
        : system.milestones.filter((m) => m.revealed),
      rewards: this.#visibleRewards(quest),
      coins: this.#coinRows(quest),
      assignees: this.#assignees(system),
      progress: system.progress,
      audience: quest.audience.map((u) => u.name),
      hidden: quest.isHidden,
      difficulties: difficultyOptions(),
      players: this.#playerVisibility(quest),
      visibleToAll: (quest.entry.ownership?.default ?? 0) >= OWNERSHIP.OBSERVER,
    });
    return context;
  }

  /**
   * Milestones grouped by track for the editor, with vault rows folded in so a
   * GM sees one list in narrative order, not two disconnected ones.
   */
  #milestoneGroups(quest) {
    if (!game.user.isGM) {
      return quest.system.milestonesByTrack.map((g) => ({ ...g, secret: false }));
    }
    const tracks = quest.allTracks;

    // Public rows are form-bound by their position in system.milestones, so
    // each one carries the index it must submit under.
    const index = new Map(quest.system.milestones.map((m, i) => [m.id, i]));
    const all = quest.allMilestones.map((m) => ({ ...m, idx: index.get(m.id) }));

    const groups = tracks.map((t) => ({
      track: t,
      secret: t.hidden,
      milestones: all.filter((m) => m.trackId === t.id),
    }));
    const loose = all.filter((m) => !tracks.some((t) => t.id === m.trackId));
    if (loose.length) groups.push({ track: null, secret: false, milestones: loose });
    return groups;
  }

  /**
   * Who can currently see this quest, one row per player.
   *
   * Visibility lives on the container JournalEntry, not in `system`, so
   * it cannot be a form field and gets its own control.
   */
  #playerVisibility(quest) {
    const ownership = quest.entry.ownership ?? {};
    return game.users
      .filter((u) => !u.isGM)
      .map((u) => ({
        id: u.id,
        name: u.name,
        checked: (ownership[u.id] ?? ownership.default ?? 0) >= OWNERSHIP.OBSERVER,
      }));
  }

  /** One editable row per configured denomination, public and vault side by side. */
  #coinRows(quest) {
    const pub = quest.system.rewards.currency.amounts ?? {};
    const sec = quest.secrets?.system.hiddenRewards.currency.amounts ?? {};
    return denominations().map((d) => ({
      key: d.key,
      label: d.label,
      value: pub[d.key] ?? 0,
      secretValue: sec[d.key] ?? 0,
    }));
  }

  /** Assigned actors resolved to something renderable, dangling refs dropped. */
  #assignees(system) {
    return system.assigned.actors
      .map((uuid) => {
        const actor = fromUuidSync(uuid);
        return actor ? { uuid, name: actor.name, img: actor.img } : null;
      })
      .filter(Boolean);
  }

  /**
   * Rewards the viewer may see. A GM sees everything, with vault entries
   * marked; a player sees only what the quest document actually carries.
   */
  #visibleRewards(quest) {
    const r = quest.system.rewards;
    const secret = quest.secrets?.system.hiddenRewards;
    const isGM = game.user.isGM;

    const items = [
      ...r.items.map((i, idx) => ({ ...i, kind: "items", idx, fromVault: false })),
      ...(isGM
        ? (secret?.items ?? []).map((i) => ({ ...i, kind: "items", fromVault: true }))
        : []),
    ];
    const custom = [
      ...r.custom.map((c, idx) => ({ ...c, kind: "custom", idx, fromVault: false })),
      ...(isGM
        ? (secret?.custom ?? []).map((c) => ({ ...c, kind: "custom", fromVault: true }))
        : []),
    ];

    const currency = Object.entries(r.currency.amounts)
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({ key, value }));
    const secretCurrency = isGM
      ? Object.values(secret?.currency.amounts ?? {}).some((v) => v > 0)
      : false;

    const xp = r.xp.value > 0 ? r.xp : null;
    const secretXp = isGM ? (secret?.xp.value ?? 0) > 0 : false;

    return {
      items,
      custom,
      currency,
      secretCurrency,
      xp,
      secretXp,
      any:
        items.length ||
        custom.length ||
        currency.length ||
        !!xp ||
        secretCurrency ||
        secretXp,
    };
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;

    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: "[data-drop]",
      callbacks: { drop: this.#onDrop.bind(this) },
    }).bind(this.element);

    for (const el of this.element.querySelectorAll("[data-qw-audience]")) {
      el.addEventListener("change", this.#onAudienceChange.bind(this));
    }

    // Vault rows are not part of the form, so they save themselves.
    for (const el of this.element.querySelectorAll("[data-vault-text], [data-vault-qty]")) {
      el.addEventListener("change", this.#onVaultRewardChange.bind(this));
    }
  }

  /**
   * Save an edit made directly to a vault reward row.
   *
   * These cannot be ordinary form fields: the form submits to the quest page,
   * and this content belongs to the secrets page. Without this, adding a custom
   * reward produced a row that could only be filled in by revealing it first.
   */
  async #onVaultRewardChange(event) {
    const input = event.target;
    const quest = this.quest;
    const sec = quest.secrets?.system.toObject();
    if (!sec) return;

    const textId = input.dataset.vaultText;
    const qtyId = input.dataset.vaultQty;

    if (textId) {
      const entry = sec.hiddenRewards.custom.find((c) => c.id === textId);
      if (!entry) return;
      entry.text = input.value;
    } else if (qtyId) {
      const entry = sec.hiddenRewards.items.find((i) => i.id === qtyId);
      if (!entry) return;
      entry.qty = Math.max(1, Number(input.value) || 1);
    } else return;

    await QuestRepository.update(
      quest,
      rewardUpdates("secrets.system.hiddenRewards", sec.hiddenRewards),
    );
  }

  /**
   * Apply the audience controls. "Everyone" wins outright; otherwise the ticked
   * players get it and nobody else does.
   */
  async #onAudienceChange() {
    const root = this.element;
    const all = root.querySelector('[data-qw-audience="all"]')?.checked;
    const users = [...root.querySelectorAll('[data-qw-audience="user"]')]
      .filter((el) => el.checked)
      .map((el) => el.dataset.userId);

    if (all) await QuestRepository.setVisibility(this.quest);
    else if (users.length) await QuestRepository.setVisibility(this.quest, { users });
    else await QuestRepository.hide(this.quest);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * Actors dropped on the giver box become the giver; dropped anywhere else
   * they join the party assignment. Items always become a reward.
   */
  async #onDrop(event) {
    const zone = event.target.closest("[data-drop]")?.dataset.drop;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.uuid) return;

    const doc = await fromUuid(data.uuid);
    if (!doc) return;

    if (doc instanceof Actor) {
      if (zone === "giver") {
        return this.document.update({
          "system.giver": { uuid: doc.uuid, name: doc.name, img: doc.img },
        });
      }
      const actors = new Set(this.document.system.assigned.actors);
      actors.add(doc.uuid);
      return this.document.update({ "system.assigned.actors": [...actors] });
    }

    if (doc instanceof Item) {
      // New item rewards land in the vault, so dropping one onto a live quest
      // never surprises players with loot they were not meant to see yet.
      const quest = this.quest;
      const sec = quest.secrets?.system.toObject();
      if (!sec) return;
      sec.hiddenRewards.items.push({
        id: newId(),
        uuid: doc.uuid,
        name: doc.name,
        img: doc.img,
        qty: 1,
        revealed: false,
      });
      return QuestRepository.update(quest, {
        ...rewardUpdates("secrets.system.hiddenRewards", sec.hiddenRewards),
      });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onAddTrack() {
    const tracks = this.document.system.toObject().tracks;
    tracks.push({
      id: newId(),
      name: game.i18n.localize("QW.Edit.NewTrack"),
      icon: "",
      order: tracks.length,
    });
    await this.document.update({ "system.tracks": tracks });
  }

  static async #onDeleteTrack(event, target) {
    const { trackId } = target.dataset;
    const quest = this.quest;
    const pub = quest.page.system.toObject();
    const sec = quest.secrets?.system.toObject();

    // Orphan the milestones instead of deleting them; losing objectives to a
    // mis-click would be worse than leaving them untracked.
    for (const m of pub.milestones) if (m.trackId === trackId) m.trackId = "";
    pub.tracks = pub.tracks.filter((t) => t.id !== trackId);

    const changes = { "system.tracks": pub.tracks, "system.milestones": pub.milestones };
    if (sec) {
      for (const m of sec.hiddenMilestones) if (m.trackId === trackId) m.trackId = "";
      sec.hiddenTracks = sec.hiddenTracks.filter((t) => t.id !== trackId);
      changes["secrets.system.hiddenTracks"] = sec.hiddenTracks;
      changes["secrets.system.hiddenMilestones"] = sec.hiddenMilestones;
    }
    await QuestRepository.update(quest, changes);
  }

  static async #onToggleTrackSecret(event, target) {
    const { trackId, secret } = target.dataset;
    const quest = this.quest;
    await (secret === "true" ? Reveal.track(quest, trackId) : Reveal.hideTrack(quest, trackId));
    this.render();
  }

  static async #onAddMilestone(event, target) {
    const trackId = target.dataset.trackId ?? "";
    const pub = this.document.system.toObject();
    pub.milestones.push({
      id: newId(),
      trackId,
      text: "",
      done: false,
      order: pub.milestones.length,
      revealed: true,
      counter: { value: 0, max: null },
    });
    await this.document.update({ "system.milestones": pub.milestones });
  }

  static async #onDeleteMilestone(event, target) {
    const { milestoneId, secret } = target.dataset;
    const quest = this.quest;
    if (secret === "true") {
      const sec = quest.secrets?.system.toObject();
      if (!sec) return;
      sec.hiddenMilestones = sec.hiddenMilestones.filter((m) => m.id !== milestoneId);
      await QuestRepository.update(quest, {
        "secrets.system.hiddenMilestones": sec.hiddenMilestones,
      });
    } else {
      const milestones = quest.page.system
        .toObject()
        .milestones.filter((m) => m.id !== milestoneId);
      await quest.page.update({ "system.milestones": milestones });
    }
  }

  static async #onToggleMilestoneSecret(event, target) {
    const { milestoneId, secret } = target.dataset;
    const quest = this.quest;
    await (secret === "true"
      ? Reveal.milestone(quest, milestoneId)
      : Reveal.hideMilestone(quest, milestoneId));
    this.render();
  }

  static async #onAddCustomReward() {
    const quest = this.quest;
    const sec = quest.secrets?.system.toObject();
    if (!sec) return;
    sec.hiddenRewards.custom.push({ id: newId(), text: "", revealed: false, awarded: false });
    await QuestRepository.update(quest, rewardUpdates("secrets.system.hiddenRewards", sec.hiddenRewards));
  }

  static async #onDeleteReward(event, target) {
    const { kind, rewardId, secret } = target.dataset;
    const quest = this.quest;
    if (secret === "true") {
      const sec = quest.secrets?.system.toObject();
      if (!sec) return;
      sec.hiddenRewards[kind] = sec.hiddenRewards[kind].filter((r) => r.id !== rewardId);
      await QuestRepository.update(quest, rewardUpdates("secrets.system.hiddenRewards", sec.hiddenRewards));
    } else {
      const rewards = quest.page.system.toObject().rewards;
      rewards[kind] = rewards[kind].filter((r) => r.id !== rewardId);
      await quest.page.update(rewardUpdates("system.rewards", rewards));
    }
  }

  static async #onToggleRewardSecret(event, target) {
    const { kind, rewardId, secret } = target.dataset;
    const quest = this.quest;
    await (secret === "true"
      ? Reveal.reward(quest, kind, rewardId)
      : Reveal.hideReward(quest, kind, rewardId));
    this.render();
  }

  static async #onRevealAllRewards() {
    await Reveal.allRewards(this.quest);
    this.render();
  }

  static async #onAwardRewards() {
    AwardDialog.open(this.quest);
  }

  static async #onClearGiver() {
    await this.document.update({ "system.giver": { uuid: "", name: "", img: "" } });
  }

  static async #onRemoveAssignee(event, target) {
    const actors = this.document.system.assigned.actors.filter(
      (a) => a !== target.dataset.uuid,
    );
    await this.document.update({ "system.assigned.actors": actors });
  }

  static async #onOpenAssignee(event, target) {
    const doc = await fromUuid(target.dataset.uuid);
    doc?.sheet?.render(true);
  }

  /* -------------------------------------------- */
  /*  Form submission                             */
  /* -------------------------------------------- */

  /**
   * Split the form data: GM notes and vault coin amounts are written to the
   * vault page, everything else goes to the quest page as normal.
   */
  /**
   * Close the sheet when Save is pressed.
   *
   * The sheet also submits on every field change, and those arrive here as
   * "change" events. Foundry's own `closeOnSubmit` cannot tell the two apart,
   * so it would shut the window as soon as you edited anything; checking the
   * event type is what separates a deliberate Save from an autosave.
   */
  /** @inheritDoc */
  async _onSubmitForm(formConfig, event) {
    this.#saveRefused = false;
    await super._onSubmitForm(formConfig, event);
    if (event?.type === "submit" && !this.#saveRefused) {
      this.#announceSave();
      await this.close({ submitted: true });
    }
  }

  /**
   * Say where the quest ended up.
   *
   * A new quest starts as a hidden draft, so without this it saves, the sheet
   * closes, and nothing visibly happens: the quest is sitting in a GM-only tab
   * the author may not have opened yet.
   */
  #announceSave() {
    const quest = this.quest;
    const s = quest.system;

    let where;
    if (s.status === STATUS.available) {
      where = game.i18n.localize(s.posted ? "QW.Save.Where.board" : "QW.Save.Where.boardUnposted");
    } else {
      where = game.i18n.localize(`QW.Save.Where.${s.status}`);
    }

    const audience = quest.audience;
    let who;
    if (quest.isHidden) who = game.i18n.localize("QW.Save.Who.hidden");
    else if ((quest.entry.ownership?.default ?? 0) >= OWNERSHIP.OBSERVER) {
      who = game.i18n.localize("QW.Save.Who.all");
    } else {
      who = game.i18n.format("QW.Save.Who.some", {
        names: audience.map((u) => u.name).join(", "),
      });
    }

    ui.notifications.info(
      game.i18n.format("QW.Save.Announce", { name: quest.name, where, who }),
    );
  }

  /**
   * Checks run before Foundry's, so the GM gets a sentence they can act on
   * instead of the schema's wording.
   */
  #ownChecks(data) {
    const problems = [];
    if ("name" in data && !String(data.name ?? "").trim()) {
      problems.push(game.i18n.localize("QW.Validate.NeedsName"));
    }
    return problems;
  }

  /**
   * Explain what is wrong, put the form back, and abandon the save.
   *
   * The document was never changed, so re-rendering restores the fields. The
   * throw is what stops Foundry proceeding; its own notification then repeats
   * the short version of the message.
   */
  #refuse(problems) {
    this.#saveRefused = true;
    reportProblems(problems);
    setTimeout(() => this.render(), 0);
    throw new Error(problems.join(" "));
  }

  /** @inheritDoc */
  _prepareSubmitData(event, form, formData, updateData) {
    // Validate before touching the vault, so a refused save does not half-apply.
    const problems = this.#ownChecks(formData.object);
    if (problems.length) this.#refuse(problems);

    const vault = {};

    const gmNotes = formData.object["secrets.system.gmNotes"];
    if (gmNotes !== undefined) {
      delete formData.object["secrets.system.gmNotes"];
      vault["secrets.system.gmNotes"] = gmNotes;
    }

    const secretCoins = {};
    for (const key of Object.keys(formData.object)) {
      const match = key.match(/^secrets\.currency\.(.+)$/);
      if (!match) continue;
      secretCoins[match[1]] = Number(formData.object[key]) || 0;
      delete formData.object[key];
    }
    if (Object.keys(secretCoins).length) {
      const sec = this.quest.secrets?.system.toObject();
      if (sec) {
        sec.hiddenRewards.currency.amounts = secretCoins;
        Object.assign(vault, rewardUpdates("secrets.system.hiddenRewards", sec.hiddenRewards));
      }
    }

    if (Object.keys(vault).length) {
      QuestRepository.update(this.quest, vault).catch(() =>
        ui.notifications.error(game.i18n.localize("QW.Error.VaultWrite")),
      );
    }

    try {
      return super._prepareSubmitData(event, form, formData, updateData);
    } catch (err) {
      // Anything the checks above did not anticipate still gets explained.
      return this.#refuse(describeValidationError(err, this.document));
    }
  }
}

/**
 * Keep open quest sheets in step with their vault page.
 *
 * A DocumentSheet re-renders automatically when its *own* document changes, but
 * half of a quest lives in a separate secrets document. Without this, dropping
 * an item into the rewards, adding a custom reward or deleting a vault row all
 * save correctly and then appear to do nothing until the sheet is reopened.
 *
 * Watching the document is better than calling render() at each call site: it
 * also catches edits made by another GM, and cannot be forgotten by the next
 * piece of code that writes to the vault.
 */
export function registerQuestSheetHooks() {
  const refreshFor = (page) => {
    if (page.type !== TYPE.secrets) return;
    const questUuid = page.system.questUuid;
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof QuestPageSheet && app.rendered && app.document.uuid === questUuid) {
        app.render();
      }
    }
  };

  Hooks.on("updateJournalEntryPage", refreshFor);
  Hooks.on("createJournalEntryPage", refreshFor);
  Hooks.on("deleteJournalEntryPage", refreshFor);

  // Ownership lives on the container entry, so the audience display needs its
  // own trigger when it is changed from the Quest Log instead of the sheet.
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!("ownership" in changes)) return;
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof QuestPageSheet && app.rendered && app.document.parent === entry) {
        app.render();
      }
    }
  });
}

/** Register the sheet for our subtype. Called from `init`. */
export function registerQuestSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    JournalEntryPage,
    MODULE_ID,
    QuestPageSheet,
    { types: [TYPE.quest], makeDefault: true, label: "QW.Sheet.Quest" },
  );
}
