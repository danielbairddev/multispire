// Card & effect schema. This is the data contract a deck-import pipeline targets.
// Card definitions are pure functional game data (name + numbers), no flavor text.

export type CardType = "attack" | "skill" | "power" | "status" | "curse";

export type Rarity = "basic" | "common" | "uncommon" | "rare" | "special";

export type Character = "ironclad" | "silent" | "defect" | "watcher" | "neutral";

/** Who a card is aimed at when played. */
export type TargetKind =
  | "enemy" // pick a single opponent
  | "self" // affects the caster only
  | "all_enemies" // every opponent
  | "none"; // no target needed (utility)

/**
 * A single atomic effect. The engine interprets these.
 * Add new `kind`s here and handle them in the engine's effect interpreter.
 */
export type Effect =
  // `strengthMul` lets Strength count more than once (e.g. Heavy Blade = 3).
  // `lifesteal` heals the attacker for unblocked damage dealt (e.g. Reaper).
  // `maxHpOnKill` permanently raises the attacker's max HP if this kills (Feed).
  // `perStrike` adds damage for each "Strike" card in the deck (Perfected Strike).
  // `rampage` permanently raises THIS card's damage by N each time it's played
  //   this combat (e.g. Rampage).
  | {
      kind: "damage";
      amount: number;
      times?: number;
      strengthMul?: number;
      lifesteal?: boolean;
      maxHpOnKill?: number;
      perStrike?: number;
      rampage?: number;
    }
  | { kind: "block"; amount: number }
  | { kind: "applyPower"; power: PowerId; amount: number; to: "enemy" | "self" }
  | { kind: "draw"; amount: number }
  | { kind: "gainEnergy"; amount: number }
  | { kind: "loseHp"; amount: number } // self damage that ignores block
  | { kind: "heal"; amount: number }
  // Damage equal to the caster's current block (e.g. Body Slam).
  | { kind: "damageEqualToBlock" }
  // Double the caster's current Block (e.g. Entrench).
  | { kind: "doubleBlock" }
  // Double the caster's current Strength (e.g. Limit Break).
  | { kind: "doubleStrength" }
  // Exhaust `amount` random cards from the caster's hand (e.g. True Grit).
  | { kind: "exhaustRandom"; amount: number }
  // Exhaust every non-attack card in the caster's hand (e.g. Sever Soul).
  // `blockPerCard` grants that much Block for each card exhausted (Second Wind).
  | { kind: "exhaustNonAttacks"; blockPerCard?: number }
  // Exhaust the caster's whole hand, then deal `perCard` damage to the target for
  // each card exhausted (e.g. Fiend Fire).
  | { kind: "exhaustHandForDamage"; perCard: number }
  // Run `then` only if a target currently has `power` (e.g. Dropkick vs Vulnerable).
  | { kind: "ifTargetHasPower"; power: PowerId; then: Effect[] }
  // Add `amount` copies of a card id to a pile (e.g. statuses, Wounds).
  | { kind: "addCardToPile"; cardId: string; amount: number; pile: "discard" | "draw" | "hand" }
  // Escape hatch: an effect we know exists but haven't modeled yet. Logged loudly.
  | { kind: "unimplemented"; note: string };

export interface CardDef {
  id: string;
  name: string;
  character: Character;
  type: CardType;
  rarity: Rarity;
  /** Energy cost. "X" means spend-all-energy. -2 means unplayable (e.g. curses). */
  cost: number | "X";
  target: TargetKind;
  effects: Effect[];
  exhaust?: boolean;
  /** Effects that fire when this card is Exhausted (e.g. Sentinel gains Energy). */
  onExhaust?: Effect[];
  /** Ethereal: if still in hand at end of turn, it's exhausted instead of discarded. */
  ethereal?: boolean;
  /** True if the card cannot be played (curses / some statuses). */
  unplayable?: boolean;
  /** A play restriction the engine enforces (e.g. Clash needs an all-attack hand). */
  requires?: "all_attacks_in_hand";
  /**
   * Marks a card whose real behavior is only partially modeled. When approximated
   * cards are disabled (the default), these are shown as "not yet supported" and
   * can't be added to a build or played.
   */
  approx?: boolean;
  /** Optional upgraded form, swapped in when the instance is upgraded. */
  upgrade?: Partial<Pick<CardDef, "name" | "cost" | "effects" | "exhaust" | "ethereal" | "onExhaust">>;
}

/** Powers / buffs / debuffs that live on a player as stacks. */
export type PowerId =
  | "strength"
  | "strength_down"
  | "dexterity"
  | "dexterity_down"
  | "vulnerable"
  | "weak"
  | "frail"
  | "regen"
  | "metallicize"
  | "thorns"
  | "plated_armor"
  | "barricade"
  | "demon_form"
  | "artifact"
  | "intangible"
  | "rage"
  | "no_block"
  | "no_draw"
  | "thorns_down"
  // Whenever a card is Exhausted: gain Block (Feel No Pain) / draw a card (Dark Embrace).
  | "feel_no_pain"
  | "dark_embrace"
  // Gain Energy at the start of each turn (Berserk).
  | "berserk"
  // Lose HP and draw at the start of each turn (Brutality).
  | "brutality"
  // Gain Strength whenever you lose HP from a card (Rupture).
  | "rupture"
  | string; // unknown ids are tolerated and logged by the registry

export interface PowerDef {
  id: PowerId;
  name: string;
  /** "buff" stays until removed; "debuff" typically ticks down each turn. */
  kind: "buff" | "debuff";
  /** If true, stacks decrement by 1 at the start of the owner's turn. */
  decaysPerTurn?: boolean;
}
