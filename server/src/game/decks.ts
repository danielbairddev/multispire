// Deck construction. For now every player gets the Ironclad starter deck.
// This is the seam the user's card-import pipeline will plug into: produce a
// DeckList (array of { id, upgraded }) and the engine builds a shuffled draw pile.

export interface DeckCardSpec {
  id: string;
  upgraded?: boolean;
}

export type DeckList = DeckCardSpec[];

export function ironcladStarterDeck(): DeckList {
  return [
    ...Array.from({ length: 5 }, () => ({ id: "strike_r" })),
    ...Array.from({ length: 4 }, () => ({ id: "defend_r" })),
    { id: "bash" },
  ];
}

// The Regent's starting deck (mirrors Slay the Spire 2): 4 Strike, 4 Defend,
// one Falling Star, one Venerate. Pair with the Divine Right relic for the 3
// opening Star Energy.
export function regentStarterDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_reg" })),
    ...Array.from({ length: 4 }, () => ({ id: "defend_reg" })),
    { id: "falling_star" },
    { id: "venerate" },
  ];
}

// A rounded ~20-card Regent demo build: starter core plus Star-spenders, a Forge
// engine, and a couple of scaling powers so a quick match has an arc.
export function regentDemoDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_reg" })),
    ...Array.from({ length: 3 }, () => ({ id: "defend_reg" })),
    { id: "falling_star" },
    { id: "venerate" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
    { id: "crescent_spear" },
    { id: "celestial_might" },
    { id: "astral_pulse" },
    { id: "crush_under" },
    { id: "cosmic_indifference" },
    { id: "bulwark" },
    { id: "conqueror" },
    { id: "furnace" },
    { id: "child_of_the_stars", upgraded: true },
    { id: "arsenal" },
  ];
}

// The Silent's starting deck (Slay the Spire): 5 Strike, 5 Defend, Neutralize,
// Survivor. Pair with the Ring of the Snake relic for the extra opening draw.
export function silentStarterDeck(): DeckList {
  return [
    ...Array.from({ length: 5 }, () => ({ id: "strike_g" })),
    ...Array.from({ length: 5 }, () => ({ id: "defend_g" })),
    { id: "neutralize" },
    { id: "survivor" },
  ];
}

// A rounded ~20-card Silent demo build: a Poison engine (Noxious Fumes, Deadly
// Poison, Bane), some Shiv generation, knives, and a couple of scaling powers.
export function silentDemoDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_g" })),
    ...Array.from({ length: 3 }, () => ({ id: "defend_g" })),
    { id: "neutralize" },
    { id: "survivor" },
    { id: "deadly_poison" },
    { id: "poisoned_stab" },
    { id: "bane" },
    { id: "dagger_throw" },
    { id: "blade_dance" },
    { id: "quick_slash" },
    { id: "sucker_punch" },
    { id: "footwork" },
    { id: "noxious_fumes", upgraded: true },
    { id: "caltrops" },
    { id: "a_thousand_cuts" },
    { id: "envenom" },
  ];
}

// The Defect's starter: Strikes/Defends plus Zap (channel Lightning) and
// Dualcast (evoke), the two cards the whole orb game is built around.
export function defectStarterDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_d" })),
    ...Array.from({ length: 4 }, () => ({ id: "defend_d" })),
    { id: "zap" },
    { id: "dualcast" },
  ];
}

// A rounded ~20-card Defect demo build: orb generators across all four orb types,
// a Focus engine to scale them, extra orb slots, and a couple of evoke payoffs.
export function defectDemoDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_d" })),
    ...Array.from({ length: 3 }, () => ({ id: "defend_d" })),
    { id: "zap" },
    { id: "dualcast" },
    { id: "ball_lightning" },
    { id: "cold_snap" },
    { id: "coolheaded" },
    { id: "beam_cell" },
    { id: "glacier" },
    { id: "glasswork" },
    { id: "defragment" },
    { id: "capacitor" },
    { id: "focused_strike" },
    { id: "shatter" },
    { id: "skim" },
    { id: "meteor_strike_d" },
  ];
}

// The default deck everyone gets if they press Play without importing a loadout.
// A rounded ~20-card Ironclad build: reliable damage, enough block to survive a
// few turns, a couple of debuff/scaling options, and one power so games have an
// arc. A few cards come pre-upgraded so quick matches feel a little spicy.
export function ironcladDemoDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_r" })),
    ...Array.from({ length: 4 }, () => ({ id: "defend_r" })),
    { id: "bash", upgraded: true },
    { id: "anger" },
    { id: "cleave" },
    { id: "twin_strike" },
    { id: "pommel_strike" },
    { id: "iron_wave" },
    { id: "clothesline" },
    { id: "shrug_it_off", upgraded: true },
    { id: "flex" },
    { id: "inflame" },
    { id: "body_slam" },
    { id: "metallicize" },
  ];
}
