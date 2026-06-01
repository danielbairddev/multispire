import type { PowerDef, PowerId } from "@multispire/shared";
import { reportMissing } from "./missing.js";

// Powers (buffs/debuffs) the engine understands. Add new ones here.
export const POWERS: Record<string, PowerDef> = {
  strength: { id: "strength", name: "Strength", kind: "buff" },
  // Tracks temporary Strength (e.g. Flex). At end of turn it removes that much
  // Strength, then clears itself. Resolved specially in finishResolution.
  strength_down: { id: "strength_down", name: "Strength Down", kind: "debuff" },
  dexterity: { id: "dexterity", name: "Dexterity", kind: "buff" },
  // Temporary Dexterity bookkeeping, mirrors strength_down.
  dexterity_down: { id: "dexterity_down", name: "Dexterity Down", kind: "debuff" },
  metallicize: { id: "metallicize", name: "Metallicize", kind: "buff" },
  regen: { id: "regen", name: "Regen", kind: "buff", decaysPerTurn: true },
  vulnerable: { id: "vulnerable", name: "Vulnerable", kind: "debuff", decaysPerTurn: true },
  weak: { id: "weak", name: "Weak", kind: "debuff", decaysPerTurn: true },
  frail: { id: "frail", name: "Frail", kind: "debuff", decaysPerTurn: true },
  // Reflects damage to attackers when they hit you.
  thorns: { id: "thorns", name: "Thorns", kind: "buff" },
  // Gains Block each turn; loses a stack when you take unblocked attack damage.
  plated_armor: { id: "plated_armor", name: "Plated Armor", kind: "buff" },
  // Block is no longer removed at the start of your turn.
  barricade: { id: "barricade", name: "Barricade", kind: "buff" },
  // Gain this much Strength at the start of each of your turns.
  demon_form: { id: "demon_form", name: "Demon Form", kind: "buff" },
  // Negates the next debuff that would be applied to you (one per stack).
  artifact: { id: "artifact", name: "Artifact", kind: "buff" },
  // All damage you take is reduced to 1. Ticks down each turn.
  intangible: { id: "intangible", name: "Intangible", kind: "buff", decaysPerTurn: true },
  // Rage: gain Block whenever you play an Attack this turn. Cleared each turn.
  rage: { id: "rage", name: "Rage", kind: "buff", decaysPerTurn: true },
  // No Block: you cannot gain Block this turn (Battle Trance-style drawback). Decays.
  no_block: { id: "no_block", name: "No Block", kind: "debuff", decaysPerTurn: true },
  // No Draw: you cannot draw more cards this turn (Battle Trance drawback). Decays.
  no_draw: { id: "no_draw", name: "No Draw", kind: "debuff", decaysPerTurn: true },
  // Bookkeeping for temporary Thorns (e.g. Flame Barrier). Removed at end of turn
  // like strength_down. Never decays on its own.
  thorns_down: { id: "thorns_down", name: "Thorns Down", kind: "debuff" },
  // Feel No Pain: gain this much Block whenever a card is Exhausted.
  feel_no_pain: { id: "feel_no_pain", name: "Feel No Pain", kind: "buff" },
  // Dark Embrace: draw this many cards whenever a card is Exhausted.
  dark_embrace: { id: "dark_embrace", name: "Dark Embrace", kind: "buff" },
  // Berserk: gain this much Energy at the start of each of your turns.
  berserk: { id: "berserk", name: "Berserk", kind: "buff" },
  // Brutality: lose this much HP and draw that many cards at the start of each turn.
  brutality: { id: "brutality", name: "Brutality", kind: "buff" },
  // Rupture: gain this much Strength whenever you lose HP from a card.
  rupture: { id: "rupture", name: "Rupture", kind: "buff" },
};

export function getPower(id: PowerId): PowerDef {
  const p = POWERS[id];
  if (!p) {
    reportMissing("power", id);
    // Tolerant fallback: an inert buff so the match continues.
    return { id, name: id, kind: "buff" };
  }
  return p;
}

// Damage multipliers contributed by powers.
export const VULNERABLE_MULT = 1.5; // incoming attack damage when target is Vulnerable
export const WEAK_MULT = 0.75; // outgoing attack damage when attacker is Weak
export const FRAIL_MULT = 0.75; // block gained when player is Frail
