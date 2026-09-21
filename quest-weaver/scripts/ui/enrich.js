/**
 * Quest Weaver: text enrichment helpers.
 *
 * v14 moved TextEditor under `foundry.applications.ux`; `.implementation` is the
 * class a system or module may have replaced, so always go through it.
 */

/** Enrich HTML relative to a document, respecting the viewer's secret access. */
export async function enrich(html, doc) {
  if (!html) return "";
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, {
    secrets: doc?.isOwner ?? false,
    relativeTo: doc,
    rollData: doc?.getRollData?.() ?? {},
  });
}
