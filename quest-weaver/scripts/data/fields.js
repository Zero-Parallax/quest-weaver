/**
 * Quest Weaver: shared schema fragments.
 *
 * Milestones, tracks and rewards have the same shape whether they live on the
 * public quest page or in the GM vault. Defining them once means a reveal is a
 * plain move between two arrays, not a translation.
 */

import {
  EDGE_TYPE,
  EDGE_TYPE_CHOICES,
  NODE_KIND,
  NODE_KIND_CHOICES,
  STATUS,
  STATUS_CHOICES,
} from "../config.js";

const f = () => foundry.data.fields;

/** A short random id for array entries, which have no `_id` of their own. */
export function newId() {
  return foundry.utils.randomID(16);
}

/** `{ id, name, icon, order }`: a named group of milestones. */
export function trackField() {
  const fields = f();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: newId }),
    name: new fields.StringField({ required: true, blank: true, initial: "" }),
    icon: new fields.StringField({ required: false, blank: true, initial: "" }),
    order: new fields.NumberField({ required: true, integer: true, initial: 0 }),
  });
}

/**
 * One objective. `revealed` is only ever true on the public page, since the vault
 * holds the unrevealed ones, but the field exists on both so the two arrays
 * are structurally identical.
 */
export function milestoneField() {
  const fields = f();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: newId }),
    trackId: new fields.StringField({ required: false, blank: true, initial: "" }),
    text: new fields.StringField({ required: true, blank: true, initial: "" }),
    done: new fields.BooleanField({ initial: false }),
    order: new fields.NumberField({ required: true, integer: true, initial: 0 }),
    revealed: new fields.BooleanField({ initial: true }),
    counter: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      max: new fields.NumberField({ required: false, integer: true, nullable: true, initial: null }),
    }),
  });
}

/** A single item reward. `uuid` may dangle if the source was deleted, so the
 *  name and image are snapshotted at the time the reward was added. */
export function rewardItemField() {
  const fields = f();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: newId }),
    uuid: new fields.StringField({ required: false, blank: true, initial: "" }),
    name: new fields.StringField({ required: true, blank: true, initial: "" }),
    img: new fields.StringField({ required: false, blank: true, initial: "" }),
    qty: new fields.NumberField({ required: true, integer: true, min: 1, initial: 1 }),
    revealed: new fields.BooleanField({ initial: false }),
    awarded: new fields.BooleanField({ initial: false }),
    awardedTo: new fields.StringField({ required: false, blank: true, initial: "" }),
  });
}

/** A free-text reward ("a favour from the Guild"). */
export function rewardCustomField() {
  const fields = f();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: newId }),
    text: new fields.StringField({ required: true, blank: true, initial: "" }),
    revealed: new fields.BooleanField({ initial: false }),
    awarded: new fields.BooleanField({ initial: false }),
  });
}

/**
 * The whole reward block.
 *
 * `currency.amounts` is a TypedObjectField keyed by denomination instead of
 * fixed pp/gp/sp/cp fields, because systems disagree about which coins exist. Nimble,
 * for instance, has gp/sp/cp and no platinum.
 */
export function rewardsField() {
  const fields = f();
  return new fields.SchemaField({
    items: new fields.ArrayField(rewardItemField(), { initial: [] }),
    currency: new fields.SchemaField({
      amounts: new fields.TypedObjectField(
        new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        { initial: {} },
      ),
      revealed: new fields.BooleanField({ initial: false }),
      awarded: new fields.BooleanField({ initial: false }),
    }),
    xp: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      revealed: new fields.BooleanField({ initial: false }),
      awarded: new fields.BooleanField({ initial: false }),
    }),
    custom: new fields.ArrayField(rewardCustomField(), { initial: [] }),
  });
}

/** Who gave the quest. Free-text name and image so an NPC needs no Actor. */
export function giverField() {
  const fields = f();
  return new fields.SchemaField({
    uuid: new fields.StringField({ required: false, blank: true, initial: "" }),
    name: new fields.StringField({ required: false, blank: true, initial: "" }),
    img: new fields.StringField({ required: false, blank: true, initial: "" }),
  });
}

/** Quest-to-quest relationships, stored as UUIDs of other quest pages. */
export function linksField() {
  const fields = f();
  const uuidList = () =>
    new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] });
  return new fields.SchemaField({
    parent: new fields.StringField({ required: false, blank: true, initial: "" }),
    children: uuidList(),
    requires: uuidList(),
    unlocks: uuidList(),
  });
}

/** A node on a story web. `ref` points at a quest page UUID when kind is "quest". */
export function storyNodeField() {
  const fields = f();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: newId }),
    kind: new fields.StringField({
      required: true,
      blank: false,
      initial: NODE_KIND.note,
      choices: NODE_KIND_CHOICES,
    }),
    ref: new fields.StringField({ required: false, blank: true, initial: "" }),
    label: new fields.StringField({ required: true, blank: true, initial: "" }),
    img: new fields.StringField({ required: false, blank: true, initial: "" }),
    color: new fields.StringField({ required: false, blank: true, initial: "" }),
    x: new fields.NumberField({ required: true, initial: 0 }),
    y: new fields.NumberField({ required: true, initial: 0 }),
    notes: new fields.StringField({ required: false, blank: true, initial: "" }),
    tags: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),
  });
}

/** A directed, typed edge between two story web nodes. */
export function storyEdgeField() {
  const fields = f();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: newId }),
    from: new fields.StringField({ required: true, blank: false }),
    to: new fields.StringField({ required: true, blank: false }),
    type: new fields.StringField({
      required: true,
      blank: false,
      initial: EDGE_TYPE.leadsTo,
      choices: EDGE_TYPE_CHOICES,
    }),
    label: new fields.StringField({ required: false, blank: true, initial: "" }),
    color: new fields.StringField({ required: false, blank: true, initial: "" }),
    dashed: new fields.BooleanField({ initial: false }),
  });
}

/** Status field, shared by the model and anything that validates imports. */
export function statusField() {
  const fields = f();
  return new fields.StringField({
    required: true,
    blank: false,
    initial: STATUS.draft,
    choices: STATUS_CHOICES,
  });
}
