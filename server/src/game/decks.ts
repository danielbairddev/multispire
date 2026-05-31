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
