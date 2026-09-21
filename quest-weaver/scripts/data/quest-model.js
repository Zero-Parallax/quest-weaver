/**
 * Quest Weaver: the public quest page.
 *
 * Everything on this model is data a player is allowed to see *if* they can see
 * the containing JournalEntry at all. Nothing secret lives here: hidden
 * milestones, unrevealed rewards and GM notes are held in the vault
 * (see secrets-model.js) and moved across on reveal.
 */

import { SCHEMA_VERSION } from "../config.js";
import {
  giverField,
  linksField,
  milestoneField,
  rewardsField,
  statusField,
  trackField,
} from "./fields.js";

export class QuestModel extends foundry.abstract.TypeDataModel {
  /** Field labels and hints come from QW.Quest.FIELDS.* in the language file. */
  static LOCALIZATION_PREFIXES = ["QW.Quest"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      status: statusField(),
      posted: new fields.BooleanField({ initial: false }),

      summary: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      img: new fields.FilePathField({ required: false, categories: ["IMAGE"] }),
      banner: new fields.FilePathField({ required: false, categories: ["IMAGE"] }),

      tags: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),
      difficulty: new fields.StringField({ required: false, blank: true, initial: "" }),
      location: new fields.StringField({ required: false, blank: true, initial: "" }),
      deadline: new fields.StringField({ required: false, blank: true, initial: "" }),

      giver: giverField(),
      assigned: new fields.SchemaField({
        actors: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),
        users: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),
      }),

      tracks: new fields.ArrayField(trackField(), { initial: [] }),
      milestones: new fields.ArrayField(milestoneField(), { initial: [] }),
      rewards: rewardsField(),
      links: linksField(),

      /**
       * Set when a player proposed this quest instead of the GM authoring it.
       * `reward` is what they asked for, which the GM can honour or ignore.
       */
      suggested: new fields.SchemaField({
        by: new fields.StringField({ required: false, blank: true, initial: "" }),
        reward: new fields.StringField({ required: false, blank: true, initial: "" }),
        approved: new fields.BooleanField({ initial: false }),
      }),

      source: new fields.SchemaField({
        importId: new fields.StringField({ required: false, blank: true, initial: "" }),
        chainId: new fields.StringField({ required: false, blank: true, initial: "" }),
      }),

      _v: new fields.NumberField({ required: true, integer: true, initial: SCHEMA_VERSION }),
    };
  }

  /**
   * Progress counts only what the viewer can actually see, so a player's bar
   * never hints at how many secret objectives are still hidden.
   */
  prepareDerivedData() {
    const visible = this.milestones.filter((m) => m.revealed);
    const done = visible.filter((m) => m.done).length;
    this.progress = {
      done,
      total: visible.length,
      pct: visible.length ? Math.round((done / visible.length) * 100) : 0,
    };
    this.hasRewards =
      this.rewards.items.length > 0 ||
      this.rewards.custom.length > 0 ||
      this.rewards.xp.value > 0 ||
      Object.values(this.rewards.currency.amounts).some((n) => n > 0);
  }

  /** Milestones grouped by track, in track order, with untracked ones last. */
  get milestonesByTrack() {
    const tracks = [...this.tracks].sort((a, b) => a.order - b.order);
    const groups = tracks.map((t) => ({
      track: t,
      milestones: this.milestones
        .filter((m) => m.trackId === t.id)
        .sort((a, b) => a.order - b.order),
    }));
    const loose = this.milestones
      .filter((m) => !this.tracks.some((t) => t.id === m.trackId))
      .sort((a, b) => a.order - b.order);
    if (loose.length) groups.push({ track: null, milestones: loose });
    return groups.filter((g) => g.milestones.length);
  }
}
