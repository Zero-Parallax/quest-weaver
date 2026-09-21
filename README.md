# Quest Weaver

A system-agnostic quest log, job board and GM story web for **Foundry VTT v14**.

Quests are real Foundry documents, module-defined `JournalEntryPage` subtypes, so they get
folders, permissions, compendium and Adventure export, core search and drag-and-drop for free.
No build step, no dependencies: drop the folder into `Data/modules` and enable it.

## Install

In Foundry: **Add-on Modules → Install Module**, and paste this manifest URL:

```
https://github.com/Zero-Parallax/quest-weaver/releases/latest/download/module.json
```

Requires Foundry **v14**. Bug reports and ideas are very welcome on
[the issue tracker](https://github.com/Zero-Parallax/quest-weaver/issues).

## Status

Early development. Working today:

- Quest documents with tracks, milestones, item/currency/XP/custom rewards, giver and party assignment
- A GM vault that holds unrevealed content, with one-click reveal and un-reveal
- An authoring sheet that merges both halves so the GM edits one coherent quest
- Drag Actors onto the giver or assignment boxes, drag Items in as rewards
- A Quest Log window: Job Board, Active, Completed, Failed, Abandoned, plus a GM-only Drafts tab
- Search, tag filters, right-click status and visibility menus, chat announcements
- Players can accept jobs; a GM's client performs the write on their behalf
- Award loot: split currency and XP across the party, assign items per character, with a
  preview of exactly what each person gets before anything is written
- Configurable currency denominations, auto-detected per game system
- Import and export quests and whole chains as JSON, with a preview before anything is created
  and a player-safe export that drops everything in the vault
- A **Who can see this quest** control on the sheet: everyone, or named players
- Trusted players can propose quests of their own to track, tagged and visible only to them
- A GM-only **story web**: quests and free-form nodes on a pan/zoom canvas, with the quest chain
  drawn automatically and editable by dragging links between cards
- Opens from the Journal sidebar, the Notes scene control, or Ctrl+Q

### Awarding across systems

Currency and experience live somewhere different in every system, so awarding goes through an
adapter. Shipped adapters: **Nimble** (verified against 0.9.0) and **D&D 5e**. Anything else uses
the generic adapter, which a GM can point at their own data paths in settings:

| Setting | Example |
|---|---|
| Currency data paths | `{"gp": "system.currency.gp", "sp": "system.currency.sp"}` |
| XP data path | `system.details.xp.value` |

Leave them blank and the split is still calculated and announced in chat, and the table enters
it by hand. Item rewards are always created automatically, because embedded Items work the same
way in every system. Nimble has no XP field at all, so XP there is tracked and announced rather
than written to a sheet, and the award card says so.

## How secrecy actually works

Read this before you rely on it.

Foundry sends *all* world data to *every* connected client. Its server builds each client's
payload with an unfiltered dump of every journal, actor, item and setting; document ownership
controls what the interface shows, not what crosses the wire. A player who opens the browser
console can read any document in the world, including ones set to `ownership: NONE` that never
appear in their sidebar. The same is true of world compendium packs: a pack a player has no
ownership of still serves its documents when asked directly.

This is a property of the platform, not of this module. Every quest module for Foundry has it.

What the vault does give you:

- Unrevealed milestones, unrevealed rewards and GM notes are never inside the quest document
  players receive. They live in a separate vault journal, and revealing physically moves them
  across.
- So they cannot leak through the quest sheet, chat cards, the job board, player-safe exports,
  compendium sharing, or any other module or macro that reads quest data.
- Reveals are logged, so you can see what the table has been told.

What it does not give you:

- Protection from a player who deliberately opens the console and goes looking.

If you need that, the planned opt-in encryption phase is the only thing that provides it:
vault content encrypted with a key held in the GM's browser, so what reaches players is
ciphertext. Until then, treat the vault as a filing system, not a safe.

### Importing quests

Quest Log → the import button in the toolbar. Paste JSON or choose a file, press Preview, and the
dialog shows every quest it found, whether it will be created or updated, and anything it could
not understand. Re-importing the same file updates the quests it made last time instead of
duplicating them, so you can iterate on a draft.

The format is documented in [docs/quest-json-schema.md](docs/quest-json-schema.md), and
**Load the example** in the dialog pastes in a worked three-quest chain. It is deliberately simple
enough to hand to an AI: ask for quests in that shape, paste the result, preview, import.

### Posting to the Job Board

Posting and visibility are separate on purpose, so you can lay out a board in advance and reveal it
when the party reaches town. **On the Job Board** puts a quest on the board; **Who can see this
quest** decides who receives it at all. A quest that is posted but visible to nobody shows a
one-click warning on its card instead of quietly doing nothing.

### Players proposing quests

With *Players can propose quests* set to trusted or all, players get a **Propose a quest** button:
a short form for a title, what is involved, and the reward they are hoping for. The quest is
created owned by and visible to only them, so it works as a personal tracker straight away, tagged
`player-quest` so you can filter for it. You are whispered when one arrives, and the log shows who
proposed it and what they asked for: recorded, not granted.

### The story web

**Quest Log → the web button**, the Notes scene control, or Ctrl+Shift+W. GM only, and stored in
the vault like every other secret.

Drop quests onto a web and it draws the chain for you: `requires` and `unlocks` edges are *derived*
from the quests, not stored on the web, so the graph and the quest log can never disagree.
Drawing one of those links between two quest cards writes it to the quests. The web is an editor
for the campaign, not a picture of it. Everything else (NPCs, factions, places, clues, secrets,
loose notes) lives on the web itself, with typed, labelled, coloured connections.

Drag the background to pan, scroll to zoom, drag a card to move it, and drag the link handle on a
card's edge onto another card to connect them. Double-click a quest to open it; right-click a card
or a connection for the rest. **Arrange** lays the chain out by dependency depth and parks
unconnected quests in a grid underneath.

## Requirements

- Foundry VTT **v14** (verified against 14.368)
- Any game system. Currency denominations default to a preset per system. Nimble is gold/silver/copper,
  D&D 5e adds platinum and electrum, anything unrecognised gets the usual four coins.

## Development

The module is plain ES modules with no build step.

```powershell
tools\link.ps1          # junction Data\modules\quest-weaver -> this repo
tools\check.ps1         # static checks: JSON, data-action handlers, i18n keys, template paths
```

Foundry discovers new module folders only when the server starts or when you return to the
Setup screen. After that, a browser refresh picks up code changes.

## Licence

MIT.

