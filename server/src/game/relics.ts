import { reportMissing } from "./missing.js";

// Relic hooks. We model relics as a set of lifecycle callbacks the engine fires.
// Unknown relic ids log a clear "go add me" and are treated as no-ops so a match
// can continue. Only combat-relevant, statically-modelable effects are wired up;
// relics whose effects depend on systems we don't simulate (campfires, card
// rewards, potions, etc.) are included as flavor no-ops where useful.

export interface RelicHooks {
  id: string;
  name: string;
  /** Short functional description shown in the deckbuilder. */
  description: string;
  /** Bonus energy added at the start of each of the owner's turns. */
  bonusEnergyPerTurn?: number;
  /** Bonus energy added only on the owner's first turn. */
  bonusEnergyFirstTurn?: number;
  /** Block granted at the start of combat. */
  startingBlock?: number;
  /** Strength granted at the start of combat. */
  startingStrength?: number;
  /** Dexterity granted at the start of combat. */
  startingDexterity?: number;
  /** Thorns granted at the start of combat. */
  startingThorns?: number;
  /** Plated Armor granted at the start of combat. */
  startingPlatedArmor?: number;
  /** Vulnerable applied to every opponent at the start of combat. */
  startingEnemyVulnerable?: number;
  /** Weak applied to every opponent at the start of combat. */
  startingEnemyWeak?: number;
  /** Extra cards drawn on the owner's first turn. */
  bonusDrawFirstTurn?: number;
  /** Increases max HP (and current HP) when brought into a match. */
  bonusMaxHp?: number;
  /** Star Energy granted at the start of combat (Regent's Divine Right). */
  startingStars?: number;
}

export const RELICS: Record<string, RelicHooks> = {
  // ---- Starter ----
  burning_blood: {
    id: "burning_blood",
    name: "Burning Blood",
    description: "Ironclad starter. (Heal after combat is not modeled here.)",
  },
  divine_right: {
    id: "divine_right",
    name: "Divine Right",
    description: "Regent starter. Start each combat with 3 Star Energy.",
    startingStars: 3,
  },

  // ---- Block on combat start ----
  anchor: { id: "anchor", name: "Anchor", description: "Start each combat with 10 Block.", startingBlock: 10 },
  ancient_tea_set: {
    id: "ancient_tea_set",
    name: "Ancient Tea Set",
    description: "Start your first turn with 2 extra energy.",
    bonusEnergyFirstTurn: 2,
  },
  thread_and_needle: {
    id: "thread_and_needle",
    name: "Thread and Needle",
    description: "Start each combat with 4 Plated Armor.",
    startingPlatedArmor: 4,
  },

  // ---- Stat boosts on combat start ----
  vajra: { id: "vajra", name: "Vajra", description: "Start each combat with 1 Strength.", startingStrength: 1 },
  oddly_smooth_stone: {
    id: "oddly_smooth_stone",
    name: "Oddly Smooth Stone",
    description: "Start each combat with 1 Dexterity.",
    startingDexterity: 1,
  },
  // Convenience alias for the way folks usually say it.
  smooth_stone: {
    id: "smooth_stone",
    name: "Smooth Stone",
    description: "Start each combat with 1 Dexterity.",
    startingDexterity: 1,
  },
  bronze_scales: {
    id: "bronze_scales",
    name: "Bronze Scales",
    description: "Start each combat with 3 Thorns.",
    startingThorns: 3,
  },
  bag_of_marbles: {
    id: "bag_of_marbles",
    name: "Bag of Marbles",
    description: "At the start of combat, apply 1 Vulnerable to all enemies.",
    startingEnemyVulnerable: 1,
  },
  red_mask: {
    id: "red_mask",
    name: "Red Mask",
    description: "At the start of combat, apply 1 Weak to all enemies.",
    startingEnemyWeak: 1,
  },
  bag_of_preparation: {
    id: "bag_of_preparation",
    name: "Bag of Preparation",
    description: "Draw 2 additional cards on your first turn.",
    bonusDrawFirstTurn: 2,
  },

  // ---- Energy each turn ----
  philosophers_stone: {
    id: "philosophers_stone",
    name: "Philosopher's Stone",
    description: "Gain 1 extra energy each turn.",
    bonusEnergyPerTurn: 1,
  },
  ectoplasm: {
    id: "ectoplasm",
    name: "Ectoplasm",
    description: "Gain 1 extra energy each turn.",
    bonusEnergyPerTurn: 1,
  },
  coffee_dripper: {
    id: "coffee_dripper",
    name: "Coffee Dripper",
    description: "Gain 1 extra energy each turn.",
    bonusEnergyPerTurn: 1,
  },
  cursed_key: {
    id: "cursed_key",
    name: "Cursed Key",
    description: "Gain 1 extra energy each turn.",
    bonusEnergyPerTurn: 1,
  },
  sozu: {
    id: "sozu",
    name: "Sozu",
    description: "Gain 1 extra energy each turn.",
    bonusEnergyPerTurn: 1,
  },
  fusion_hammer: {
    id: "fusion_hammer",
    name: "Fusion Hammer",
    description: "Gain 1 extra energy each turn.",
    bonusEnergyPerTurn: 1,
  },

  // ---- Max HP ----
  strawberry: { id: "strawberry", name: "Strawberry", description: "Raise max HP by 7.", bonusMaxHp: 7 },
  pear: { id: "pear", name: "Pear", description: "Raise max HP by 10.", bonusMaxHp: 10 },
  mango: { id: "mango", name: "Mango", description: "Raise max HP by 14.", bonusMaxHp: 14 },
  lees_waffle: { id: "lees_waffle", name: "Lee's Waffle", description: "Raise max HP by 7.", bonusMaxHp: 7 },

  // ---- First-turn energy ----
  lantern: {
    id: "lantern",
    name: "Lantern",
    description: "Gain 1 extra energy on your first turn.",
    bonusEnergyFirstTurn: 1,
  },
};

const RELIC_ALIASES: Record<string, string> = {
  oddlysmoothstone: "oddly_smooth_stone",
  smoothstone: "smooth_stone",
  bagofmarbles: "bag_of_marbles",
  bronzescales: "bronze_scales",
  threadandneedle: "thread_and_needle",
  ancientteaset: "ancient_tea_set",
  philosophersstone: "philosophers_stone",
  philosopherstone: "philosophers_stone",
  coffeedripper: "coffee_dripper",
  cursedkey: "cursed_key",
  burningblood: "burning_blood",
  fusionhammer: "fusion_hammer",
  redmask: "red_mask",
  bagofpreparation: "bag_of_preparation",
  leeswaffle: "lees_waffle",
};

export function canonicalRelicId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed in RELICS) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower in RELICS) return lower;
  const stripped = lower.replace(/[\s_'-]+/g, "");
  if (RELIC_ALIASES[stripped]) return RELIC_ALIASES[stripped];
  return lower;
}

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
