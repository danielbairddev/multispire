import { reportMissing } from "./missing.js";

// Relic hooks. We model relics as a set of lifecycle callbacks the engine fires.
// Only a couple are defined for now; unknown relic ids log a clear "go add me".

export interface RelicHooks {
  id: string;
  name: string;
  /** Bonus energy added at the start of each of the owner's turns. */
  bonusEnergyPerTurn?: number;
  /** Block granted at the start of combat (e.g. some starters). */
  startingBlock?: number;
}

export const RELICS: Record<string, RelicHooks> = {
  // Ironclad starter relic: heal a bit at the end of combat. Combat here is a
  // single continuous match, so its in-combat effect is a no-op for now.
  burning_blood: { id: "burning_blood", name: "Burning Blood" },
};

export function hasRelic(id: string): boolean {
  return id in RELICS;
}

export function getRelic(id: string): RelicHooks | null {
  const r = RELICS[id];
  if (!r) {
    reportMissing("relic", id);
    return null;
  }
  return r;
}
