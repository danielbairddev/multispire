// A "loadout" is an importable snapshot of a player's build: their deck, relics,
// and HP. This is the contract a run-importer targets. It is intentionally
// forgiving (see the accepted deck-entry shapes below) and uses the engine's
// own card / relic ids. Unknown ids are tolerated and reported, never fatal.

export interface LoadoutCardEntry {
  /** Card id as known to the engine (e.g. "strike_r", "bash"). Case-insensitive. */
  id: string;
  /** How many copies. Defaults to 1. */
  count?: number;
  /** Whether these copies are upgraded. Defaults to false. */
  upgraded?: boolean;
}

/** A deck entry may be a bare card id (one copy) or a detailed entry. */
export type LoadoutDeckItem = string | LoadoutCardEntry;

export interface Loadout {
  /** Display name for the player. */
  name?: string;
  /** Cosmetic / future use; not required. */
  character?: string;
  /** Starting & max HP. Defaults to the engine default if omitted. */
  maxHp?: number;
  /** Relic ids known to the engine. Unknown ones are reported, not fatal. */
  relics?: string[];
  /** The deck. Order does not matter; the engine shuffles. */
  deck: LoadoutDeckItem[];
}

/** Result of validating a loadout against the engine's content registries. */
export interface ImportReport {
  ok: boolean;
  name?: string;
  maxHp?: number;
  deckSize: number;
  relicCount: number;
  /** Non-fatal problems: unknown cards/relics, bad counts, etc. */
  warnings: string[];
}
