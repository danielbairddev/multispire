import type { CardCatalogEntry, RelicCatalogEntry } from "@multispire/shared";
import { allCards, resolveCard } from "./cards/registry.js";
import { RELICS } from "./relics.js";
import { describeCard } from "./engine.js";

// The set of cards the deckbuilder offers. Curses and statuses (e.g. Wound)
// aren't things you'd choose to put in a deck, so they're left out.
export function buildCatalog(): CardCatalogEntry[] {
  return allCards()
    .filter((c) => c.type !== "status" && c.type !== "curse" && !c.unplayable)
    .map((c) => {
      const base = resolveCard(c.id, false)!;
      const up = c.upgrade ? resolveCard(c.id, true)! : null;
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        cost: c.cost,
        target: c.target,
        description: describeCard(base),
        upgradedDescription: up ? describeCard(up) : undefined,
        upgradable: !!c.upgrade,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The relics the deckbuilder offers as picks. Arbitrary ids are still accepted
// on import (treated as no-ops), but these are the ones we know about.
export function buildRelicCatalog(): RelicCatalogEntry[] {
  return Object.values(RELICS)
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
