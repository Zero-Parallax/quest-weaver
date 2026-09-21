# Quest Weaver import format

A single JSON file describes a quest or a whole chain. It is meant to be written by hand or
drafted by an AI and pasted straight into **Quest Log → Import / Export**, so almost everything
is optional and the importer is forgiving about shape.

Nothing is created until you press Import: the dialog previews every quest first, says whether it
will be created or updated, and lists anything it could not understand.

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
  "quests": [ { /* see below */ } ]
}
```

| Field | Notes |
|---|---|
| `questWeaver` | Format version. Omit it; it defaults to the current version. |
| `chain` | Optional. Groups the quests so they can be exported together later. |
| `quests` | The quests. Required. |

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

## Hidden content, honestly

`hidden` and `gmNotes` keep content out of the quest document players receive. That stops it
leaking through the quest sheet, the job board, chat cards and player-safe exports. It is **not**
encryption. Foundry sends all world data to every connected client, so a determined player with
the browser console open can still read it. See the module README.

## Export

The Export tab writes this same format, so files round-trip. **Player-safe export** drops
`gmNotes` and everything still in the vault, which is what you want before sharing a chain.
Right-click a quest in the log to export just that one.

## Worked example

[`examples/example-chain.json`](../quest-weaver/examples/example-chain.json) is a three-quest chain
using hidden tracks, hidden XP, a hidden custom reward and prerequisites. The Import tab's
**Load the example** button pastes it in for you.
