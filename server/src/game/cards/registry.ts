import type { CardDef } from "@multispire/shared";
import { reportMissing } from "../missing.js";
import { IRONCLAD_CARDS } from "./ironclad.js";

// All known cards, indexed by id. Future characters register their arrays here.
const ALL: CardDef[] = [...IRONCLAD_CARDS];

const BY_ID = new Map<string, CardDef>(ALL.map((c) => [c.id, c]));

/**
 * Look up a card definition. Unknown ids log a clear "go add this" message and
 * return null so the caller can skip the card without crashing the match.
 */
export function getCard(id: string): CardDef | null {
  const c = BY_ID.get(id);
  if (!c) {
    reportMissing("card", id);
    return null;
  }
  return c;
}

export function allCards(): CardDef[] {
  return ALL;
}

/** Resolve the effective definition for an instance, applying upgrade deltas. */
export function resolveCard(id: string, upgraded: boolean): CardDef | null {
  const base = getCard(id);
  if (!base) return null;
  if (!upgraded || !base.upgrade) return base;
  return { ...base, ...base.upgrade };
}
