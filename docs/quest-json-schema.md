# Quest Weaver import format

A single JSON file describes a quest, a whole chain, or story webs to go with them. It is meant to be written by hand or
drafted by an AI and pasted straight into **Quest Log → Import / Export**, so almost everything
is optional and the importer is forgiving about shape.

Nothing is created until you press Import: the dialog previews every quest and web first, says
whether it will be created or updated, and lists anything it could not understand.

## Minimum viable file

```json
{ "quests": [{ "name": "The Sunken Bell" }] }
```

A bare array of quests works too, and so does a single quest object on its own.

## Full shape

```json
{
  "questWeaver": 1,
  "chain": { "id": "shadow-of-the-mire", "name": "Shadow of the Mire", "description": "..." },
  "quests": [ { /* see below */ } ],
  "webs": [ { /* see Story webs */ } ]
}
```

| Field | Notes |
|---|---|
| `questWeaver` | Format version. Omit it; it defaults to the current version. |
| `chain` | Optional. Groups the quests so they can be exported together later. |
| `quests` | The quests. Required unless the file has `webs`. |
| `webs` | Optional. GM story webs, see below. `web` with a single object works too. |

### A quest

```json
{
  "id": "mire-1",
  "name": "The Sunken Bell",
  "status": "available",
  "posted": true,
  "summary": "<p>The harbour bell has not rung for nine days.</p>",
  "description": "<p>Longer player-facing text.</p>",
  "img": "icons/environment/settlement/bell.webp",
  "banner": "",
  "difficulty": "Moderate",
  "location": "Mirefoot Harbour",
  "deadline": "Before the tide festival",
  "tags": ["harbour", "salvage"],
  "giver": { "name": "Harbourmaster Vex", "img": "", "uuid": "" },
  "visibility": "hidden",
  "tracks": [ ... ],
  "milestones": [ ... ],
  "rewards": { ... },
  "gmNotes": "<p>Only the GM ever sees this.</p>",
  "links": { "requires": ["mire-0"], "unlocks": ["mire-2"], "parent": "", "children": [] }
}
```

| Field | Default | Notes |
|---|---|---|
| `id` | derived from the name | **Use one.** Re-importing matches on it, so the same file updates its quests instead of duplicating them. Links refer to quests by this id. |
| `name` | none | Required. A quest without one is skipped with an error. |
| `status` | `draft` | One of `draft`, `available`, `active`, `completed`, `failed`, `abandoned`. Anything else becomes `draft` with a warning. |
| `posted` | `false` | Show on the Job Board. |
| `summary` / `description` | `""` | HTML. `summary` is the one-liner on board cards. |
| `giver` | none | An object, or just a string name. |
| `visibility` | import option | `"hidden"`, `"all"`, or a list of player names (matched by name, so a file travels between worlds). |

### Tracks and milestones

Tracks are named groups of objectives. A track marked `hidden` takes all of its milestones into
the GM vault with it.

```json
"tracks": [
  { "id": "main", "name": "Main" },
  { "id": "whispers", "name": "Whispers", "hidden": true }
],
"milestones": [
  { "track": "main", "text": "Find the bell in the silt channel" },
  { "track": "main", "text": "Raise it", "done": true },
  { "track": "whispers", "text": "Realise Vex is lying" },
  { "text": "An objective with no track", "hidden": true },
  { "text": "Collect 6 lamp eels", "counter": { "value": 0, "max": 6 } }
]
```

Track `id` is only used to join the two lists inside this file. The real ids are generated on
import. A milestone can be a plain string if all you need is text.

### Rewards

```json
"rewards": {
  "currency": { "gp": 50, "sp": 4 },
  "xp": 250,
  "items": [
    { "name": "Coil of Tarred Rope", "uuid": "Item.abc123", "qty": 2 },
    { "name": "Silver Key", "uuid": "Compendium.world.loot.Item.xyz", "hidden": true }
  ],
  "custom": [{ "text": "A favour from the Smugglers' Guild", "hidden": true }]
}
```

- **Currency** keys must match your configured denominations (Nimble: `gp`, `sp`, `cp`). Unknown
  coins are dropped with a warning.
- **XP** can be `250` or `{ "value": 250, "hidden": true }`.
- **Currency** can likewise be `{ "amounts": { "gp": 50 }, "hidden": true }`.
- **Items** need a `uuid` to be handed out automatically. Without one they still display, and you
  get a warning at import, then drag the real item onto the quest afterwards.
- Anything `hidden` goes to the GM vault and is not in the document players receive until you
  reveal it.

### Links

```json
"links": { "requires": ["mire-1"], "unlocks": ["mire-3"], "parent": "mire-1", "children": [] }
```

Values are the `id` of another quest **in the same file**, rewritten to real references on import.
A link to a quest that is not in the file is dropped with a warning. A full Foundry UUID is
accepted too, for linking into quests that already exist.

With *Advance quest chains automatically* enabled in settings, completing a quest promotes any
draft whose `requires` are all now complete.

## Story webs

A web is a list of cards (`nodes`) and the connections between them (`edges`). Webs are GM-only
and go into the vault, like everything else secret.

```json
"webs": [
  {
    "id": "mire-web",
    "name": "Shadow of the Mire",
    "description": "<p>Who is really behind the debts.</p>",
    "nodes": [
      { "quest": "mire-1", "x": 0, "y": 0 },
      { "quest": "mire-2" },
      { "id": "vex", "kind": "npc", "label": "Harbourmaster Vex", "notes": "Sank the bell himself." },
      { "id": "guild", "kind": "faction", "label": "Smugglers' Guild", "tags": ["smugglers"] }
    ],
    "edges": [
      { "from": "vex", "to": "mire-1", "type": "involves", "label": "gives the job" },
      { "from": "vex", "to": "guild", "type": "owns" },
      { "from": "mire-1", "to": "mire-2", "type": "unlocks" }
    ]
  }
]
```

| Field | Default | Notes |
|---|---|---|
| `id` | derived from the name | **Use one.** Re-importing matches on it and updates the web. |
| `name` | the chain's name | |
| `description` | `""` | HTML. |
| `nodes` | `[]` | The cards. |
| `edges` | `[]` | The connections. |

**Cards.** A card with `quest` shows that quest: the `id` of a quest in this file, the `id` a
quest was imported under earlier, or a quest's UUID. Its name and colour come from the live
quest. Any other card has a `kind`: `npc`, `faction`, `location`, `event`, `clue`, `secret` or
`note` (the default), plus a `label`, and optionally `notes`, `tags`, `img` and `color`.

A card's `id` is what edges refer to. It defaults to the quest's id for a quest card, and to the
label otherwise (`Harbourmaster Vex` becomes `harbourmaster-vex`). `x` and `y` place it; leave them out and the importer arranges the cards the way
**Arrange** does.

**Connections.** `from` and `to` name a card by its `id` or label, or a quest card by its
quest's id.
`type` is one of `leadsTo` (the default), `involves`, `rival`, `owns`, `hidden`, `custom`,
`requires` or `unlocks`; anything else is kept as a custom connection labelled with what you
wrote. Optional `label`, `color` and `dashed` (on by default for `hidden`).

`requires` and `unlocks` between two quest cards are written to the quests, exactly as when you
draw one on the web, so the quest chain and the web stay one thing. `"from": "mire-2", "to":
"mire-1", "type": "requires"` reads "mire-2 requires mire-1".

**Re-importing** replaces the cards and connections the file made last time and leaves alone
anything you added on the web by hand. A card the file gives no position keeps the one it has,
so you can arrange the web in Foundry and keep iterating on the file.

A file can hold only webs, with quest cards pointing at quests already in the world.

## Hidden content, honestly

`hidden` and `gmNotes` keep content out of the quest document players receive. That stops it
leaking through the quest sheet, the job board, chat cards and player-safe exports. It is **not**
encryption. Foundry sends all world data to every connected client, so a determined player with
the browser console open can still read it. See the module README.

## Export

The Export tab writes this same format, so files round-trip, story webs included. **Player-safe
export** drops `gmNotes`, story webs and everything else still in the vault, which is what you want
before sharing a chain.
Right-click a quest in the log to export just that one.

## Worked example

[`examples/example-chain.json`](../quest-weaver/examples/example-chain.json) is a three-quest chain
using hidden tracks, hidden XP, a hidden custom reward and prerequisites, with a story web of the
people behind it. The Import tab's
**Load the example** button pastes it in for you.
