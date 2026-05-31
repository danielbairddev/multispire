import type { ImportReport, Loadout, LoadoutCardEntry } from "@multispire/shared";
import { canonicalCardId, hasCard } from "./cards/registry.js";
import { hasRelic } from "./relics.js";
import type { DeckList } from "./decks.js";
import { reportMissing } from "./missing.js";

export interface ImportedSeed {
  name?: string;
  maxHp?: number;
  deck: DeckList;
  relics: string[];
  report: ImportReport;
}

const MAX_DECK = 200; // sanity guard against absurd imports

/**
 * Validate and normalize a raw loadout into something the engine can consume.
 * Never throws: structural problems and unknown ids become warnings, and the
 * deck is still built so the match can proceed (unknown cards are inert).
 */
export function importLoadout(raw: unknown): ImportedSeed {
  const warnings: string[] = [];
  const deck: DeckList = [];
  const relics: string[] = [];

  const lo = raw as Loadout;
  if (!lo || typeof lo !== "object" || !Array.isArray(lo.deck)) {
    warnings.push("Loadout has no `deck` array; ignoring import.");
    return { deck, relics, report: report(false, warnings, deck, relics, undefined) };
  }

  // ---- deck ----
  for (const item of lo.deck) {
    const entry = normalizeEntry(item, warnings);
    if (!entry) continue;
    const canonical = canonicalCardId(entry.id);
    if (!hasCard(canonical)) {
      reportMissing("card", entry.id, "referenced by an imported deck");
      warnings.push(`Unknown card "${entry.id}" (x${entry.count}) — kept as a placeholder; add it to the registry.`);
    }
    for (let i = 0; i < entry.count; i++) {
      if (deck.length >= MAX_DECK) {
        warnings.push(`Deck exceeds ${MAX_DECK} cards; extra cards were dropped.`);
        break;
      }
      deck.push({ id: canonical, upgraded: entry.upgraded });
    }
  }
  if (deck.length === 0) warnings.push("Imported deck is empty.");

  // ---- relics ----
  for (const r of lo.relics ?? []) {
    const id = String(r).trim();
    if (!id) continue;
    if (!hasRelic(id)) {
      reportMissing("relic", id, "referenced by an imported loadout");
      warnings.push(`Unknown relic "${id}" — ignored; add it to relics.ts.`);
      continue; // don't attach unknown relics (no hooks to run)
    }
    relics.push(id);
  }

  // ---- hp / name ----
  let maxHp: number | undefined;
  if (lo.maxHp != null) {
    const n = Math.floor(Number(lo.maxHp));
    if (Number.isFinite(n) && n > 0) maxHp = n;
    else warnings.push(`Invalid maxHp "${lo.maxHp}" — using default.`);
  }
  const name = typeof lo.name === "string" && lo.name.trim() ? lo.name.trim() : undefined;

  return { name, maxHp, deck, relics, report: report(true, warnings, deck, relics, maxHp) };
}

function normalizeEntry(
  item: unknown,
  warnings: string[],
): { id: string; count: number; upgraded: boolean } | null {
  if (typeof item === "string") {
    const id = item.trim();
    if (!id) return null;
    return { id, count: 1, upgraded: false };
  }
  if (item && typeof item === "object") {
    const e = item as LoadoutCardEntry;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    if (!id) {
      warnings.push("Deck entry missing an `id`; skipped.");
      return null;
    }
    let count = e.count == null ? 1 : Math.floor(Number(e.count));
    if (!Number.isFinite(count) || count < 1) {
      warnings.push(`Card "${id}" had an invalid count; treated as 1.`);
      count = 1;
    }
    return { id, count, upgraded: !!e.upgraded };
  }
  warnings.push("Unrecognized deck entry; skipped.");
  return null;
}

function report(
  ok: boolean,
  warnings: string[],
  deck: DeckList,
  relics: string[],
  maxHp: number | undefined,
): ImportReport {
  return { ok, warnings, deckSize: deck.length, relicCount: relics.length, maxHp };
}
