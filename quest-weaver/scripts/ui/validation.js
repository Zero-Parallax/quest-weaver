/**
 * Quest Weaver: telling the GM what is wrong.
 *
 * Foundry reports a refused save as a red notification carrying the raw schema
 * error. It reads like "name: may not be undefined", sits next to a document
 * UUID, and fades after a few seconds, so in practice all you see is a flash of
 * red. This turns the same information into something a GM can act on and keeps
 * it on screen until dismissed.
 */

const { DialogV2 } = foundry.applications.api;

/** Matches Foundry's internal container markers, such as "SchemaField#_updateDiff". */
const INTERNAL = /^\w+Field#/;

/** Splits a message into lines regardless of line ending. */
const LINES = /\r?\n/;

/** The label the GM actually sees on the sheet, for a schema field path. */
function labelFor(path, page) {
  if (path === "name") return game.i18n.localize("QW.Validate.Field.name");

  if (path.startsWith("system.")) {
    const field = page?.system?.schema?.getField?.(path.slice("system.".length));
    if (field?.label) return game.i18n.localize(field.label);
  }
  return path;
}

/** Schema wording turned into something plainer. */
function plainProblem(message) {
  const m = message.trim();
  if (/may not be undefined|may not be a blank string|is required/i.test(m)) {
    return game.i18n.localize("QW.Validate.MustNotBeEmpty");
  }
  if (/is not a valid choice/i.test(m)) return game.i18n.localize("QW.Validate.BadChoice");
  return m;
}

/**
 * Pull "field: problem" pairs out of a DataModelValidationError.
 *
 * The structured failure is not exposed on the error object, so this reads the
 * message. Foundry nests it two spaces per level, with container lines ending
 * in an internal marker and only the leaves carrying a real reason:
 *
 *   JournalEntryPage [uuid] validation errors: SchemaField#_updateDiff
 *     system: SchemaField#_updateDiff
 *       status: wibble is not a valid choice
 *
 * Indentation is tracked to rebuild "system.status", the containers are
 * dropped, and each leaf is reported against its label on the sheet.
 */
export function describeValidationError(err, page) {
  const raw = String(err?.message ?? "");
  const lines = raw.split(LINES).slice(1);
  const stack = [];
  const problems = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)(.+?):\s*(.*)$/);
    if (!match) continue;

    const [, indent, key, value] = match;
    const depth = Math.max(0, Math.floor(indent.length / 2) - 1);
    stack.length = depth;

    if (INTERNAL.test(value.trim())) {
      stack.push(key.trim());
      continue;
    }
    const path = [...stack, key.trim()].join(".");
    problems.push(`${labelFor(path, page)}: ${plainProblem(value)}`);
  }

  if (problems.length) return problems;
  return [raw.split(LINES)[0] || game.i18n.localize("QW.Validate.Unknown")];
}

/**
 * Show a dismissible list of what needs fixing.
 *
 * Deliberately not awaited by callers: it is a report, and the save it belongs
 * to has already been abandoned.
 */
export function reportProblems(problems, { title = "QW.Validate.Title" } = {}) {
  const items = problems
    .map((p) => `<li>${foundry.utils.escapeHTML(p)}</li>`)
    .join("");

  DialogV2.prompt({
    window: { title, icon: "fa-solid fa-triangle-exclamation" },
    classes: ["quest-weaver", "qw-validate"],
    position: { width: 460 },
    content: `<div class="qw-validate-body">
      <p>${game.i18n.localize("QW.Validate.Intro")}</p>
      <ul class="qw-validate-list">${items}</ul>
    </div>`,
    ok: { label: "QW.Validate.Close", icon: "fa-solid fa-check" },
    rejectClose: false,
  });
}
