import type { CardDef } from "@multispire/shared";
import { reportMissing } from "../missing.js";
import { IRONCLAD_CARDS } from "./ironclad.js";
import { NEUTRAL_CARDS } from "./neutral.js";

// All known cards, indexed by id. Future characters register their arrays here.
const ALL: CardDef[] = [...IRONCLAD_CARDS, ...NEUTRAL_CARDS];

/**
 * Whether cards whose real behavior is only partially modeled (`approx: true`)
 * are allowed in play. Off by default so the UI clearly marks them unsupported
 * and they can't be added to a build or played — we don't want half-implemented
 * cards sneaking in. Flip to true to enable the approximations.
 */
export const APPROX_CARDS_ENABLED = false;

/** A card is supported unless it's an approximation and approximations are off. */
export function isCardSupported(def: CardDef): boolean {
  return !def.approx || APPROX_CARDS_ENABLED;
}

const BY_ID = new Map<string, CardDef>(ALL.map((c) => [c.id, c]));

// Aliases let importers use ids from other sources (e.g. CamelCase run exports)
// without an exact match. Keys are compared after lowercasing + stripping
// separators. Extend this as you map more real-world ids onto engine ids.
const CARD_ALIASES: Record<string, string> = {
  pommelstrike: "pommel_strike",
  twinstrike: "twin_strike",
  ironwave: "iron_wave",
  bodyslam: "body_slam",
  shrugitoff: "shrug_it_off",
  striker: "strike_r",
  strike: "strike_r",
  defendr: "defend_r",
  defend: "defend_r",
  // Multi-word ids from run exports, separators stripped + lowercased.
  heavyblade: "heavy_blade",
  perfectedstrike: "perfected_strike",
  swordboomerang: "sword_boomerang",
  truegrit: "true_grit",
  wildstrike: "wild_strike",
  battletrance: "battle_trance",
  bloodforblood: "blood_for_blood",
  burningpact: "burning_pact",
  ghostlyarmor: "ghostly_armor",
  powerthrough: "power_through",
  recklesscharge: "reckless_charge",
  searingblow: "searing_blow",
  seeingred: "seeing_red",
  seversoul: "sever_soul",
  spotweakness: "spot_weakness",
  demonform: "demon_form",
  limitbreak: "limit_break",
  flamebarrier: "flame_barrier",
  bandageup: "bandage_up",
  darkshackles: "dark_shackles",
  dramaticentrance: "dramatic_entrance",
  flashofsteel: "flash_of_steel",
  goodinstincts: "good_instincts",
  masterofstrategy: "master_of_strategy",
  swiftstrike: "swift_strike",
};

/**
 * Map any incoming id onto a canonical engine card id. Tries: exact match,
 * lowercase match, then alias (lowercased, separators stripped). Returns the
 * best-guess canonical id (which may still be unknown — caller validates).
 */
export function canonicalCardId(raw: string): string {
  const trimmed = raw.trim();
  if (BY_ID.has(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (BY_ID.has(lower)) return lower;
  const stripped = lower.replace(/[\s_-]+/g, "");
  if (CARD_ALIASES[stripped]) return CARD_ALIASES[stripped];
  return lower; // unknown; surfaced by getCard's missing-card logging
}

export function hasCard(id: string): boolean {
  return BY_ID.has(id);
}

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
