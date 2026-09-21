/**
 * Quest Weaver: player-to-GM bridge.
 *
 * Players have no write permission on quest documents, so any action they take
 * is sent to the GM's client to perform. Exactly one GM executes each request, because
 * `game.users.activeGM` designates the same user on every client. Otherwise a
 * table with two GMs would apply everything twice.
 */

import { LOG, MODULE_ID, OWNERSHIP, SETTING, SOCKET, STATUS } from "../config.js";
import { QuestRepository } from "./quest-repository.js";
import { Status } from "./status.js";
import { canCreateQuests } from "../settings.js";

const CHANNEL = `module.${MODULE_ID}`;

/** Requests awaiting a reply, keyed by request id. */
const pending = new Map();

/** How long a player waits before giving up on the GM's client. */
const TIMEOUT_MS = 10_000;

export class QuestSocket {
  static listen() {
    game.socket.on(CHANNEL, QuestSocket.#onMessage);
  }

  /**
   * Ask the GM's client to do something. Resolves with the handler's result, or
   * rejects with a localised message the caller can show.
   */
  static async request(action, payload = {}) {
    if (game.user.isGM) return QuestSocket.#handle(action, payload, game.user);

    if (!game.users.activeGM) {
      throw new Error(game.i18n.localize("QW.Error.NoGM"));
    }

    const id = foundry.utils.randomID(16);
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(game.i18n.localize("QW.Error.RequestTimeout")));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });

    game.socket.emit(CHANNEL, {
      type: SOCKET.request,
      id,
      action,
      payload,
      userId: game.user.id,
    });
    return promise;
  }

  /** Tell every client to refresh open Quest Weaver windows. */
  static refresh() {
    game.socket.emit(CHANNEL, { type: SOCKET.refresh });
    Hooks.callAll("questWeaverRefresh");
  }

  /* -------------------------------------------- */

  static async #onMessage(message) {
    if (message?.type === SOCKET.refresh) {
      Hooks.callAll("questWeaverRefresh");
      return;
    }

    if (message?.type === SOCKET.response) {
      if (message.userId !== game.user.id) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error));
      return;
    }

    if (message?.type !== SOCKET.request) return;
    // Only the designated GM acts, so a second GM at the table is a spectator.
    if (game.users.activeGM?.id !== game.user.id) return;

    const requester = game.users.get(message.userId);
    let result = null;
    let error = null;
    try {
      result = await QuestSocket.#handle(message.action, message.payload, requester);
    } catch (err) {
      error = err.message;
      console.warn(`${LOG} request "${message.action}" failed`, err);
    }

    game.socket.emit(CHANNEL, {
      type: SOCKET.response,
      id: message.id,
      userId: message.userId,
      ok: !error,
      result,
      error,
    });
    QuestSocket.refresh();
  }

  /**
   * Run a request. Reached on the GM's client for a player's request, or
   * directly when a GM triggers the same action themselves.
   */
  static async #handle(action, payload, requester) {
    const handler = HANDLERS[action];
    if (!handler) throw new Error(`Quest Weaver | unknown request "${action}"`);
    if (!requester) throw new Error("Quest Weaver | unknown requesting user");
    return handler(payload, requester);
  }
}

/* -------------------------------------------- */

/** Resolve the quest a request refers to, or fail loudly. */
function getQuest(uuid) {
  const quest = QuestRepository.get(uuid);
  if (!quest) throw new Error(game.i18n.localize("QW.Error.QuestGone"));
  return quest;
}

/** A player may only act on a quest they can actually see. */
function assertVisible(quest, user) {
  if (user.isGM) return;
  if (!quest.entry.testUserPermission(user, "OBSERVER")) {
    throw new Error(game.i18n.localize("QW.Error.NotYours"));
  }
}

function assertSetting(key, user) {
  if (user.isGM) return;
  if (!game.settings.get(MODULE_ID, key)) {
    throw new Error(game.i18n.localize("QW.Error.NotAllowed"));
  }
}

const HANDLERS = {
  /** Take a job from the board: assign the requester's character and go active. */
  async acceptQuest({ questUuid, actorUuid }, user) {
    const quest = getQuest(questUuid);
    assertVisible(quest, user);
    assertSetting(SETTING.playersCanAccept, user);

    const actor = actorUuid ? await fromUuid(actorUuid) : user.character;
    if (!actor) throw new Error(game.i18n.localize("QW.Error.NoCharacter"));
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) {
      throw new Error(game.i18n.localize("QW.Error.NotYourCharacter"));
    }

    const actors = new Set(quest.system.assigned.actors);
    actors.add(actor.uuid);
    await quest.page.update({
      "system.assigned.actors": [...actors],
      "system.posted": false,
    });
    if (quest.status !== STATUS.active) await Status.set(quest, STATUS.active);
    return { accepted: actor.name };
  },

  async abandonQuest({ questUuid }, user) {
    const quest = getQuest(questUuid);
    assertVisible(quest, user);
    assertSetting(SETTING.playersCanAbandon, user);
    await Status.set(quest, STATUS.abandoned);
    return { status: STATUS.abandoned };
  },

  async toggleMilestone({ questUuid, milestoneId, done }, user) {
    const quest = getQuest(questUuid);
    assertVisible(quest, user);
    assertSetting(SETTING.playersCanToggleMilestones, user);

    const milestones = quest.page.system.toObject().milestones;
    const milestone = milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new Error(game.i18n.localize("QW.Error.MilestoneGone"));
    milestone.done = done ?? !milestone.done;
    await quest.page.update({ "system.milestones": milestones });
    return { done: milestone.done };
  },

  /**
   * A player proposing a quest of their own.
   *
   * It is created visible to them and owned by them, so a personal tracker
   * works without a socket round trip for every tick. The GM sees it under the
   * configured tag, with whatever reward the player asked for recorded but not
   * granted.
   */
  async proposeQuest({ name, description, reward }, user) {
    if (!canCreateQuests(user)) throw new Error(game.i18n.localize("QW.Error.NotAllowed"));

    const title = String(name ?? "").trim();
    if (!title) throw new Error(game.i18n.localize("QW.Error.NeedsName"));

    const tag = game.settings.get(MODULE_ID, SETTING.playerQuestTag).trim();
    const actor = user.character;

    const quest = await QuestRepository.create({
      name: title,
      ownership: { default: OWNERSHIP.NONE, [user.id]: OWNERSHIP.OWNER },
      system: {
        status: STATUS.active,
        description: String(description ?? ""),
        tags: tag ? [tag] : [],
        suggested: { by: user.name, reward: String(reward ?? ""), approved: false },
        assigned: { actors: actor ? [actor.uuid] : [], users: [user.id] },
      },
    });

    if (game.settings.get(MODULE_ID, SETTING.chatOnStatusChange)) {
      await ChatMessage.implementation.create({
        content: `<div class="quest-weaver qw-chat"><strong>${foundry.utils.escapeHTML(
          user.name,
        )}</strong> ${game.i18n.localize("QW.Chat.ProposedQuest")}<br>${foundry.utils.escapeHTML(
          title,
        )}</div>`,
        whisper: ChatMessage.implementation.getWhisperRecipients("GM").map((u) => u.id),
      });
    }
    return { uuid: quest.uuid };
  },

  /** GM-only: everything below is triggered from the GM's own controls. */
  async setStatus({ questUuid, status }, user) {
    if (!user.isGM) throw new Error(game.i18n.localize("QW.Error.NotAllowed"));
    const quest = getQuest(questUuid);
    await Status.set(quest, status);
    return { status };
  },
};
