/**
 * Quest Weaver: a story web (narrative graph).
 *
 * Lives in the GM vault, so it is GM-only for the same reason the secrets pages
 * are. Node positions belong to the web, not to the quest, which lets one
 * quest appear on several webs at different places.
 */

import { SCHEMA_VERSION } from "../config.js";
import { storyEdgeField, storyNodeField } from "./fields.js";

export class StoryWebModel extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["QW.Web"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      nodes: new fields.ArrayField(storyNodeField(), { initial: [] }),
      edges: new fields.ArrayField(storyEdgeField(), { initial: [] }),
      view: new fields.SchemaField({
        zoom: new fields.NumberField({ required: true, min: 0.1, max: 4, initial: 1 }),
        panX: new fields.NumberField({ required: true, initial: 0 }),
        panY: new fields.NumberField({ required: true, initial: 0 }),
        snap: new fields.BooleanField({ initial: false }),
      }),
      _v: new fields.NumberField({ required: true, integer: true, initial: SCHEMA_VERSION }),
    };
  }

  /** Edges whose endpoints both still exist, since drawing anything else throws. */
  get liveEdges() {
    const ids = new Set(this.nodes.map((n) => n.id));
    return this.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }

  /** Node lookup by id, built once per data preparation. */
  prepareDerivedData() {
    this.nodeById = new Map(this.nodes.map((n) => [n.id, n]));
  }
}
