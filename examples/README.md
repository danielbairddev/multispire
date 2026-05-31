# Loadout import format

A **loadout** is a JSON snapshot of one player's build (deck, relics, HP). The
server validates it against the engine's content registries and uses it to seat
that player. Unknown ids never crash a match — they are reported as warnings and
logged server-side so you know exactly what to add.

Import a loadout in the UI: on the join screen open **Import deck / loadout**,
then paste JSON or **Load file**. The "Load example" button fills in the full
Ironclad deck below.

## Schema

```jsonc
{
  "name": "Ironclad",        // optional display name
  "character": "ironclad",   // optional, cosmetic for now
  "maxHp": 80,                // optional; defaults to 75
  "relics": ["burning_blood"],// optional; ids known to the engine
  "deck": [ /* see below */ ] // required
}
```

### Deck entries

Each entry in `deck` is either a **bare string** (one copy) or an **object**:

```jsonc
"bash"                                  // 1 copy, not upgraded
{ "id": "strike_r", "count": 5 }        // 5 copies
{ "id": "pommel_strike", "upgraded": true } // 1 upgraded copy
{ "id": "inflame", "count": 2, "upgraded": true }
```

| Field      | Type    | Default | Notes                                  |
| ---------- | ------- | ------- | -------------------------------------- |
| `id`       | string  | —       | Engine card id. Case-insensitive.      |
| `count`    | number  | `1`     | Number of copies to add.               |
| `upgraded` | boolean | `false` | Whether those copies are upgraded.     |

## Card / relic ids

Ids must resolve to the engine's content. Matching is lenient: it tries the
exact id, then a lowercased id, then an alias (lowercased, separators stripped).
So `Strike_R`, `strike_r`, and `PommelStrike` all resolve. See:

- Cards + aliases: `server/src/game/cards/ironclad.ts` and
  `server/src/game/cards/registry.ts`
- Relics: `server/src/game/relics.ts`

If an id is unknown you'll get a warning in the UI and a server log like:

```
[MISSING CARD] id="searing_blow" (referenced by an imported deck)
  -> Define it in server/src/game/cards/ironclad.ts
```

Add the missing definition there and re-import — that's the whole loop.

## Example files

- [`loadout.ironclad-starter.json`](loadout.ironclad-starter.json) — the bare
  starter deck.
- [`loadout.ironclad-full.json`](loadout.ironclad-full.json) — a fuller deck
  showing counts, upgrades, and a relic.

## Where this plugs in

The validator is `server/src/game/import.ts` (`importLoadout`). It returns a
deck list + relics + HP + warnings, which `match.ts` feeds into the engine via
`addPlayer`. When you build a run-importer, have it emit this JSON shape.
