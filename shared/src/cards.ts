// Card & effect schema. This is the data contract a deck-import pipeline targets.
// Card definitions are pure functional game data (name + numbers), no flavor text.

export type CardType = "attack" | "skill" | "power" | "status" | "curse";

export type Rarity = "basic" | "common" | "uncommon" | "rare" | "special";

export type Character = "ironclad" | "silent" | "defect" | "watcher" | "regent" | "neutral";

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
  // `perStarCard` adds damage for each Star Energy card (a card with a star cost)
  //   currently in hand (e.g. Crescent Spear).
  | {
      kind: "damage";
      amount: number;
      times?: number;
      strengthMul?: number;
      lifesteal?: boolean;
      maxHpOnKill?: number;
      perStrike?: number;
      rampage?: number;
      perStarCard?: number;
      // `perSkillThisTurn` adds damage for each Skill already played this turn
      //   (e.g. Lunar Blast). `perStarGainedThisTurn` adds damage for each Star
      //   Energy gained this turn (e.g. Radiate). `perCardCreatedThisCombat` adds
      //   damage for each card created this combat (e.g. Supermassive).
      //   `starsOnKill` grants that many Stars if the attack is lethal (Knockout Blow).
      perSkillThisTurn?: number;
      perStarGainedThisTurn?: number;
      perCardCreatedThisCombat?: number;
      starsOnKill?: number;
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
  // Run `then` only if an opponent has already queued an attack on you this turn
  // (our PvP stand-in for "if an enemy intends to attack", e.g. Spot Weakness).
  | { kind: "ifIncomingAttack"; then: Effect[] }
  // --- interactive choices (the engine pauses for the player to pick cards) ---
  // Choose `amount` card(s) from your discard pile to put on top of your draw
  // pile (e.g. Headbutt).
  | { kind: "putDiscardOnDraw"; amount: number }
  // Choose `amount` card(s) from your hand to put on top of your draw pile
  // (e.g. Warcry).
  | { kind: "putHandOnDraw"; amount: number }
  // Choose `amount` card(s) from your hand to Exhaust (e.g. Burning Pact).
  | { kind: "exhaustChosen"; amount: number }
  // Add `amount` copies of a card id to a pile (e.g. statuses, Wounds).
  | { kind: "addCardToPile"; cardId: string; amount: number; pile: "discard" | "draw" | "hand" }
  // --- Regent: Star Energy & Forge / Sovereign Blade ---
  // Gain `amount` Star Energy (the Regent's second resource).
  | { kind: "gainStars"; amount: number }
  // Forge `amount`: add to the Sovereign Blade's accumulated damage this combat,
  // and grant the Blade to hand the first time it's forged (e.g. Furnace, Bulwark).
  // `perOtherAttackThisTurn` adds that much Forge for each OTHER Attack you've
  // already played this turn (e.g. Beat into Shape).
  | { kind: "forge"; amount: number; perOtherAttackThisTurn?: number }
  // Deal damage equal to the caster's current Forge (the Sovereign Blade's hit).
  | { kind: "sovereignBladeDamage" }
  // Double the caster's current Forge (e.g. Conqueror).
  | { kind: "doubleForge" }
  // Transform `amount` random cards in hand into copies of `into` (e.g. BEGONE!!).
  | { kind: "transformHand"; into: string; amount: number }
  // Transform `amount` random cards in the draw pile into copies of `into`
  // (e.g. CHARGE!!!).
  | { kind: "transformDraw"; into: string; amount: number }
  // Add `amount` random cards of a given character/pool to a pile (e.g. Bundle of
  // Joy adds 3 random Colorless cards to hand).
  | { kind: "addRandomCards"; character: Character; amount: number; pile: "discard" | "draw" | "hand" }
  // Add copies of `cardId` to hand until the hand is full (e.g. Crash Landing's
  // "Fill your hand with Debris").
  | { kind: "fillHandWith"; cardId: string }
  // Grant resources at the start of your NEXT turn, and optionally retain your
  // hand at the end of THIS turn (e.g. Convergence).
  | { kind: "nextTurnBonus"; energy?: number; stars?: number; block?: number; draw?: number; retainHand?: boolean }
  // Return the just-played card to your hand (Particle Wall) or to the top of your
  // draw pile (Shining Strike) instead of discarding it.
  | { kind: "returnThisCard"; to: "hand" | "draw" }
  // Put the Sovereign Blade into your hand from anywhere (e.g. Summon Forth).
  | { kind: "summonBlade" }
  // Interactive: choose a Skill in hand and play its effects `times` times
  // (e.g. Decisions, Decisions). The engine pauses for the pick.
  | { kind: "replayChosenSkill"; times: number }
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
  /** A token (generated in-combat only, e.g. Sovereign Blade, Minion Strike).
   *  Never offered in the deckbuilder or as a reward. */
  token?: boolean;
  /** Star Energy cost (the Regent's second resource), in addition to `cost`. */
  starCost?: number;
  /** Retain: not discarded at end of turn; kept in hand (e.g. Sovereign Blade). */
  retain?: boolean;
  /** After being played, shuffle back into the draw pile instead of discarding
   *  (the Sovereign Blade cycles through the deck after each use). */
  reshuffleOnPlay?: boolean;
  /** While in the Exhaust pile, auto-plays its effects at the start of each of
   *  the owner's turns (e.g. Bombardment). Implies the card Exhausts. */
  autoPlayFromExhaust?: boolean;
  /** A play restriction the engine enforces (e.g. Clash needs an all-attack hand). */
  requires?: "all_attacks_in_hand";
  /**
   * A cost that changes with game state. "hp_loss" makes the card cost 1 less for
   * each time its owner has lost HP this combat (e.g. Blood for Blood).
   */
  dynamicCost?: "hp_loss";
  /**
   * Marks a card whose real behavior is only partially modeled. When approximated
   * cards are disabled (the default), these are shown as "not yet supported" and
   * can't be added to a build or played.
   */
  approx?: boolean;
  /** Optional upgraded form, swapped in when the instance is upgraded. */
  upgrade?: Partial<
    Pick<CardDef, "name" | "cost" | "effects" | "exhaust" | "ethereal" | "onExhaust" | "starCost" | "retain">
  >;
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
  // --- Regent powers ---
  // Vigor: your next Attack deals +N damage, then this is consumed.
  | "vigor"
  // Gain Block whenever you spend Star Energy (Child of the Stars): N per Star.
  | "child_of_the_stars"
  // Deal N damage to all enemies whenever you spend or gain Star Energy (Black Hole).
  | "black_hole"
  // Gain N Strength whenever you create a card (Arsenal).
  | "arsenal"
  // Forge N at the start of each turn (Furnace / Hammer Time).
  | "auto_forge"
  // Gain N Stars at the start of each turn (Genesis).
  | "genesis"
  // Add N random Colorless cards to hand at the start of each turn (Spectrum Shift).
  | "spectrum_shift"
  // At the start of each turn, draw 1 and Exhaust 1 random card from hand (Tyranny).
  | "tyranny"
  // Whenever you play a card, gain N Stars (The Sealed Throne).
  | "sealed_throne"
  // Gain N Block whenever you create a card (Pillar of Creation).
  | "pillar_of_creation"
  // Gain N Block whenever you play the Sovereign Blade (Parry).
  | "parry"
  // Whenever you attack an enemy, it loses 1 Strength this turn (Monarch's Gaze).
  | "monarchs_gaze"
  // The Sovereign Blade hits all enemies (Seeking Edge).
  | "seeking_edge"
  // The Sovereign Blade hits N additional times (Sword Sage).
  | "sword_sage"
  // If you play 5+ cards in a turn, draw N at the start of your next turn (Pale Blue Dot).
  | "pale_blue_dot"
  | string; // unknown ids are tolerated and logged by the registry

export interface PowerDef {
  id: PowerId;
  name: string;
  /** "buff" stays until removed; "debuff" typically ticks down each turn. */
  kind: "buff" | "debuff";
  /** If true, stacks decrement by 1 at the start of the owner's turn. */
  decaysPerTurn?: boolean;
}
