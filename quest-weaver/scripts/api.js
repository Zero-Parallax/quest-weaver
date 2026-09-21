/**
 * Quest Weaver: public API, exposed as `game.modules.get("quest-weaver").api`.
 * Macros and other modules should go through this instead of importing files.
 */

import { EDGE_TYPE, MODULE_ID, NODE_KIND, STATUS, TYPE } from "./config.js";
import { Quest, QuestRepository } from "./core/quest-repository.js";
import { QuestLogApp, openQuestSheet } from "./apps/quest-log.js";
import { AwardDialog } from "./apps/award-dialog.js";
import { StoryWebApp } from "./apps/story-web.js";
import { StoryWeb } from "./core/story-web.js";
import { ImportExportDialog, exportChain, exportQuest } from "./apps/import-export.js";
import { parseImport } from "./io/schema.js";
import { planImport, runImport } from "./io/importer.js";
import { buildExport } from "./io/exporter.js";
import { Award } from "./rewards/award.js";
import * as currency from "./rewards/currency.js";
import { activeAdapter, listAdapters } from "./rewards/adapters/index.js";
import { Status } from "./core/status.js";
import { QuestSocket } from "./core/socket.js";
import { Vault } from "./core/vault.js";
import { denominations } from "./settings.js";

export function buildApi() {
  return {
    QuestRepository,
    Quest,
    Vault,
    Status,
    QuestSocket,
    Award,
    StoryWeb,
    currency,
    activeAdapter,
    listAdapters,
    denominations,
    constants: { MODULE_ID, TYPE, STATUS, NODE_KIND, EDGE_TYPE },

    /** Create a quest from a plain object. */
    create: (data) => QuestRepository.create(data),
    /** All quests this client can see. */
    all: () => QuestRepository.all(),
    /** Look up one quest by page UUID. */
    get: (uuid) => QuestRepository.get(uuid),
    /** Open the Quest Log window. */
    openLog: () => QuestLogApp.open(),
    /** Open a quest's sheet: editor for owners, read-only view otherwise. */
    openQuest: (uuid) => {
      const quest = QuestRepository.get(uuid);
      return quest ? openQuestSheet(quest) : null;
    },
    /** Move a quest to a new status, announcing it as usual. */
    setStatus: (uuid, status) => Status.set(QuestRepository.get(uuid), status),
    /** Open the award dialog for a quest. */
    award: (uuid) => AwardDialog.open(QuestRepository.get(uuid)),
    /** Open the import/export window. */
    openImportExport: () => ImportExportDialog.open(),
    /** Open the GM story web. */
    openWeb: () => StoryWebApp.open(),
    /** Validate a payload without importing it. */
    parseImport,
    /** Say what an import would do. */
    planImport: (payload) => planImport(parseImport(payload).quests),
    /** Import quests from JSON, a JSON string, or a parsed object. */
    importQuests: (payload, options) => runImport(parseImport(payload).quests, options),
    /** Build an export payload for the given quests. */
    buildExport,
    exportQuest: (uuid, options) => exportQuest(QuestRepository.get(uuid), options),
    exportChain,
  };
}
