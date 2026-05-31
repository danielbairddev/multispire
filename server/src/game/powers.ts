import type { PowerDef, PowerId } from "@multispire/shared";
import { reportMissing } from "./missing.js";

// Powers (buffs/debuffs) the engine understands. Add new ones here.
export const POWERS: Record<string, PowerDef> = {
  strength: { id: "strength", name: "Strength", kind: "buff" },
  dexterity: { id: "dexterity", name: "Dexterity", kind: "buff" },
  metallicize: { id: "metallicize", name: "Metallicize", kind: "buff" },
  regen: { id: "regen", name: "Regen", kind: "buff", decaysPerTurn: true },
  vulnerable: { id: "vulnerable", name: "Vulnerable", kind: "debuff", decaysPerTurn: true },
  weak: { id: "weak", name: "Weak", kind: "debuff", decaysPerTurn: true },
  frail: { id: "frail", name: "Frail", kind: "debuff", decaysPerTurn: true },
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
