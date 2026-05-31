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
  | { kind: "damage"; amount: number; times?: number }
  | { kind: "block"; amount: number }
  | { kind: "applyPower"; power: PowerId; amount: number; to: "enemy" | "self" }
  | { kind: "draw"; amount: number }
  | { kind: "gainEnergy"; amount: number }
  | { kind: "loseHp"; amount: number } // self damage that ignores block
  | { kind: "heal"; amount: number }
  // Damage equal to the caster's current block (e.g. Body Slam).
  | { kind: "damageEqualToBlock" }
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
  /** True if the card cannot be played (curses / some statuses). */
  unplayable?: boolean;
  /** Optional upgraded form, swapped in when the instance is upgraded. */
  upgrade?: Partial<Pick<CardDef, "name" | "cost" | "effects" | "exhaust">>;
}

/** Powers / buffs / debuffs that live on a player as stacks. */
export type PowerId =
  | "strength"
  | "strength_down"
  | "dexterity"
  | "vulnerable"
  | "weak"
  | "frail"
  | "regen"
  | "metallicize"
  | string; // unknown ids are tolerated and logged by the registry

export interface PowerDef {
  id: PowerId;
  name: string;
  /** "buff" stays until removed; "debuff" typically ticks down each turn. */
  kind: "buff" | "debuff";
  /** If true, stacks decrement by 1 at the start of the owner's turn. */
  decaysPerTurn?: boolean;
}
