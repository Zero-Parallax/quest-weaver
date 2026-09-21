# Sharing Quest Weaver

Three levels, in increasing order of effort. You can stop at any of them.

---

## 1. Hand someone a zip (no setup)

```powershell
.\tools\package.ps1
```

Gives you `dist\quest-weaver.zip`. They unzip it into their Foundry `Data\modules\` folder so
that the path is `Data\modules\quest-weaver\module.json`, restart Foundry, and enable it.

Good for a couple of friends. No updates, no issue tracker, and you get bug reports by text
message.

---

## 2. GitHub releases (what most modules do)

Testers paste **one URL** into Foundry's *Install Module* box and get automatic update prompts
forever after. This is the level worth reaching before asking strangers to try it.

### One-time setup

1. Create an empty GitHub repository called `quest-weaver` (public, or private while you test).
2. Point the module at it:

   ```powershell
   .\tools\set-repo.ps1 -Owner Zero-Parallax
   ```

   That fills in `url`, `manifest`, `download` and `bugs` in `module.json` and fixes the README
   link.
3. Push:

   ```powershell
   git remote add origin https://github.com/Zero-Parallax/quest-weaver.git
   git push -u origin main
   ```

### Every release

```powershell
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` builds the zip, stamps the version into the manifest and
publishes the release. Nothing to do by hand.

If you would rather not use Actions, `.\tools\package.ps1 -Version 0.1.0` produces the same two
files locally; create the release yourself and attach `dist\quest-weaver.zip` and
`dist\module.json`.

### What testers do

In Foundry: **Add-on Modules → Install Module**, paste

```
https://github.com/Zero-Parallax/quest-weaver/releases/latest/download/module.json
```

### The one trap

Two manifest files, and they must differ:

| File | `manifest` field points to | Why |
|---|---|---|
| inside `quest-weaver.zip` | the **specific** version | tells Foundry what is installed |
| attached to the release | `releases/latest/...` | lets Foundry notice a newer version |

Get these the wrong way round and the module installs fine but never offers an update. Both
scripts already do it correctly.

---

## 3. The Foundry package registry (public listing)

Once it is stable, submit it so people can find it in Foundry's own module browser.

1. Go to the [package submission form](https://foundryvtt.com/article/package-management/)
   (linked from the bottom of the Systems and Modules page on foundryvtt.com).
2. **Package Name** must be exactly `quest-weaver`, matching the manifest id.
   (Checked on 2026-09-21: that id is unclaimed.)
3. Package URL is your GitHub repo.
4. Foundry staff usually reply within a few days and give you a package admin page.
5. For each release, add the version on that admin page. Doing so also posts automatically to
   `#release-announcements` on the official Foundry Discord, which is free publicity.

Do not do this while the module is still changing shape every day. A listing invites installs
from people who expect it to work.

---

## Where to find testers

| Place | What it is good for |
|---|---|
| [League of Extraordinary FoundryVTT Developers](https://discord.com/invite/jrAeFNB) Discord | ~4,000 module developers. The right room for "here is a v14 module, does the data model look sane". They will spot Foundry-specific mistakes faster than players will. |
| Official Foundry VTT Discord | `#module-development` for questions, `#package-showcase` for "I made a thing". `#release-announcements` auto-posts once you are on the registry. |
| [r/FoundryVTT](https://reddit.com/r/FoundryVTT) | Actual GMs. Good for "would you use this", less so for code review. |
| [Foundry Hub](https://www.foundryvtt-hub.com/) | Listings, endorsements and articles; a lot of GMs browse it for modules. |
| Your own table | Still the best bug-finder. A real session surfaces things no checklist will. |

### What to say when you post

Be specific about what you want, and honest about maturity. Something like:

> **Quest Weaver**: a system-agnostic quest log, job board and GM story web for **v14**.
> Forien's Quest Log has not had a v14 release, so I built a replacement around v14's module
> sub-types: quests are real `JournalEntryPage` documents, so they get folders, permissions and
> compendium export for free.
>
> Early build. Tested against Nimble; adapters exist for D&D 5e and a generic path-mapped one,
> but only Nimble has been exercised in a real world. I would especially like eyes on:
> the reward-splitting maths, the JSON import format, and whether the story web is actually
> useful for planning or just pretty.
>
> Install: `https://github.com/Zero-Parallax/quest-weaver/releases/latest/download/module.json` · Issues: `https://github.com/Zero-Parallax/quest-weaver/issues`

---

## Before you invite strangers

Worth doing first, roughly in order:

- [ ] **Test on a second game system.** Everything so far has run on Nimble. The D&D 5e adapter
      is written from documented data paths but has never been run.
- [ ] **Test with a real party**, not two browser sessions. Concurrency and the socket bridge
      deserve a real session.
- [ ] **Decide on the secrecy story.** The README is honest that the vault is separation and not
      encryption. Some GMs will care; the encryption phase is the answer if they do.
- [ ] **Add a screenshot or two** to the README, the story web especially. Module listings live
      and die on screenshots.
- [ ] **Turn on GitHub Issues** and say in the README that you want reports.
- [ ] Consider tagging `v0.1.0` as a **pre-release** so nobody mistakes it for finished.
