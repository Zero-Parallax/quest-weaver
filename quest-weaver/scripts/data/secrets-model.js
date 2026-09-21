/**
 * Quest Weaver: the GM-only companion to a quest.
 *
 * These pages live in a JournalEntry whose default ownership is NONE, which
 * Foundry enforces server-side: a player's client is never sent the document,
 * so there is nothing for them to dig out of the console. Page-level ownership
 * would not be enough, since it is only applied in the UI (foundryvtt#7662).
 */

import { SCHEMA_VERSION } from "../config.js";
import { milestoneField, rewardsField, trackField } from "./fields.js";

export class SecretsModel extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["QW.Secrets"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      /** UUID of the quest page this belongs to. */
      questUuid: new fields.StringField({ required: true, blank: true, initial: "" }),

      gmNotes: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      /** Tracks that exist only for the GM until revealed wholesale. */
      hiddenTracks: new fields.ArrayField(trackField(), { initial: [] }),
      hiddenMilestones: new fields.ArrayField(milestoneField(), { initial: [] }),
      hiddenRewards: rewardsField(),

      /** Append-only audit of what was revealed, so a GM can undo confidently. */
      revealLog: new fields.ArrayField(
        new fields.SchemaField({
          at: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          what: new fields.StringField({ required: true, blank: true, initial: "" }),
          by: new fields.StringField({ required: false, blank: true, initial: "" }),
        }),
        { initial: [] },
      ),

      _v: new fields.NumberField({ required: true, integer: true, initial: SCHEMA_VERSION }),
    };
  }
}
