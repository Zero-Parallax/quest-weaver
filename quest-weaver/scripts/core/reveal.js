/**
 * Quest Weaver: reveal operations.
 *
 * A reveal physically moves data from the vault page into the player-facing
 * quest page, and hiding moves it back. Nothing is ever merely flagged, so a
 * player-facing quest document contains only what players are meant to have.
 *
 * Everything an entry in the public document carries is, by definition,
 * revealed. `revealed` is kept on the schema so both halves share one shape
 * and so a reveal survives a round trip through import/export.
 */

import { MODULE_ID, SETTING } from "../config.js";
import { QuestRepository, rewardUpdates } from "./quest-repository.js";
import { Vault } from "./vault.js";

/** Source data for both halves, safe to mutate and write back. */
async function halves(quest) {
  const secretsPage = quest.secrets ?? (await Vault.ensureSecrets(quest.page));
  if (!secretsPage) throw new Error("Quest Weaver | no vault page available");
  quest.secrets = secretsPage;
  return {
    secretsPage,
    pub: quest.page.system.toObject(),
    sec: secretsPage.system.toObject(),
  };
}

/** Append to the vault's audit trail. */
function logReveal(sec, what) {
  sec.revealLog = [
    ...(sec.revealLog ?? []),
    { at: Date.now(), what, by: game.user.id },
  ].slice(-200);
}

export class Reveal {
  /* ---------------------------------------- */
  /*  Milestones                              */
  /* ---------------------------------------- */

  /** Move one milestone out of the vault and into the quest. */
  static async milestone(quest, id) {
    const { pub, sec } = await halves(quest);
    const i = sec.hiddenMilestones.findIndex((m) => m.id === id);
    if (i < 0) return quest;
    const [m] = sec.hiddenMilestones.splice(i, 1);

    // A hidden milestone may belong to a track that is itself still hidden.
    const track = sec.hiddenTracks.find((t) => t.id === m.trackId);
    if (track && !pub.tracks.some((t) => t.id === track.id)) pub.tracks.push({ ...track });

    pub.milestones.push({ ...m, revealed: true });
    logReveal(sec, `milestone:${id}`);
    return Reveal.#commit(quest, pub, sec, "QW.Chat.RevealedMilestone", m.text);
  }

  /** Move one milestone back into the vault. */
  static async hideMilestone(quest, id) {
    const { pub, sec } = await halves(quest);
    const i = pub.milestones.findIndex((m) => m.id === id);
    if (i < 0) return quest;
    const [m] = pub.milestones.splice(i, 1);
    sec.hiddenMilestones.push({ ...m, revealed: false });
    logReveal(sec, `hide-milestone:${id}`);
    return Reveal.#commit(quest, pub, sec);
  }

  /* ---------------------------------------- */
  /*  Tracks                                  */
  /* ---------------------------------------- */

  /** Reveal a whole track and every milestone on it. */
  static async track(quest, trackId) {
    const { pub, sec } = await halves(quest);
    const i = sec.hiddenTracks.findIndex((t) => t.id === trackId);
    if (i >= 0) pub.tracks.push({ ...sec.hiddenTracks.splice(i, 1)[0] });

    const moving = sec.hiddenMilestones.filter((m) => m.trackId === trackId);
    sec.hiddenMilestones = sec.hiddenMilestones.filter((m) => m.trackId !== trackId);
    for (const m of moving) pub.milestones.push({ ...m, revealed: true });

    logReveal(sec, `track:${trackId}`);
    return Reveal.#commit(quest, pub, sec);
  }

  /** Pull a track and its milestones back into the vault. */
  static async hideTrack(quest, trackId) {
    const { pub, sec } = await halves(quest);
    const i = pub.tracks.findIndex((t) => t.id === trackId);
    if (i >= 0) sec.hiddenTracks.push({ ...pub.tracks.splice(i, 1)[0] });

    const moving = pub.milestones.filter((m) => m.trackId === trackId);
    pub.milestones = pub.milestones.filter((m) => m.trackId !== trackId);
    for (const m of moving) sec.hiddenMilestones.push({ ...m, revealed: false });

    logReveal(sec, `hide-track:${trackId}`);
    return Reveal.#commit(quest, pub, sec);
  }

  /* ---------------------------------------- */
  /*  Rewards                                 */
  /* ---------------------------------------- */

  /**
   * Reveal a reward. `kind` is "items" or "custom" for list rewards, or
   * "currency" / "xp" for the singular ones, where `id` is ignored.
   */
  static async reward(quest, kind, id) {
    const { pub, sec } = await halves(quest);

    if (kind === "currency") {
      const amounts = sec.hiddenRewards.currency.amounts ?? {};
      for (const [key, value] of Object.entries(amounts)) {
        pub.rewards.currency.amounts[key] = (pub.rewards.currency.amounts[key] ?? 0) + value;
      }
      sec.hiddenRewards.currency.amounts = {};
      pub.rewards.currency.revealed = true;
    } else if (kind === "xp") {
      pub.rewards.xp.value += sec.hiddenRewards.xp.value ?? 0;
      sec.hiddenRewards.xp.value = 0;
      pub.rewards.xp.revealed = true;
    } else {
      const list = sec.hiddenRewards[kind] ?? [];
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return quest;
      const [r] = list.splice(i, 1);
      pub.rewards[kind].push({ ...r, revealed: true });
    }

    logReveal(sec, `reward:${kind}:${id ?? ""}`);
    return Reveal.#commit(quest, pub, sec, "QW.Chat.RevealedReward");
  }

  /** Put a reward back in the vault. */
  static async hideReward(quest, kind, id) {
    const { pub, sec } = await halves(quest);

    if (kind === "currency") {
      const amounts = pub.rewards.currency.amounts ?? {};
      for (const [key, value] of Object.entries(amounts)) {
        sec.hiddenRewards.currency.amounts[key] =
          (sec.hiddenRewards.currency.amounts[key] ?? 0) + value;
      }
      pub.rewards.currency.amounts = {};
      pub.rewards.currency.revealed = false;
    } else if (kind === "xp") {
      sec.hiddenRewards.xp.value = (sec.hiddenRewards.xp.value ?? 0) + pub.rewards.xp.value;
      pub.rewards.xp.value = 0;
      pub.rewards.xp.revealed = false;
    } else {
      const list = pub.rewards[kind] ?? [];
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return quest;
      const [r] = list.splice(i, 1);
      sec.hiddenRewards[kind].push({ ...r, revealed: false });
    }

    logReveal(sec, `hide-reward:${kind}:${id ?? ""}`);
    return Reveal.#commit(quest, pub, sec);
  }

  /** Reveal every reward the quest has in one go. */
  static async allRewards(quest) {
    await Reveal.reward(quest, "currency");
    await Reveal.reward(quest, "xp");
    for (const r of [...(quest.secrets?.system.hiddenRewards.items ?? [])]) {
      await Reveal.reward(quest, "items", r.id);
    }
    for (const r of [...(quest.secrets?.system.hiddenRewards.custom ?? [])]) {
      await Reveal.reward(quest, "custom", r.id);
    }
    return quest;
  }

  /* ---------------------------------------- */

  /** Write both halves and optionally announce the reveal in chat. */
  static async #commit(quest, pub, sec, chatKey = null, detail = "") {
    await QuestRepository.update(quest, {
      "system.tracks": pub.tracks,
      "system.milestones": pub.milestones,
      ...rewardUpdates("system.rewards", pub.rewards),
      "secrets.system.hiddenTracks": sec.hiddenTracks,
      "secrets.system.hiddenMilestones": sec.hiddenMilestones,
      ...rewardUpdates("secrets.system.hiddenRewards", sec.hiddenRewards),
      "secrets.system.revealLog": sec.revealLog,
    });

    if (chatKey && game.settings.get(MODULE_ID, SETTING.chatOnReveal) && !quest.isHidden) {
      await ChatMessage.implementation.create({
        content: `<div class="quest-weaver qw-chat"><strong>${quest.name}</strong><br>${game.i18n.format(
          chatKey,
          { detail: foundry.utils.escapeHTML(detail ?? "") },
        )}</div>`,
      });
    }
    return quest;
  }
}
