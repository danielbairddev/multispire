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

// A richer demo deck so matches have more to do than the bare starter.
export function ironcladDemoDeck(): DeckList {
  return [
    ...Array.from({ length: 4 }, () => ({ id: "strike_r" })),
    ...Array.from({ length: 4 }, () => ({ id: "defend_r" })),
    { id: "bash" },
    { id: "anger" },
    { id: "cleave" },
    { id: "twin_strike" },
    { id: "pommel_strike" },
    { id: "iron_wave" },
    { id: "shrug_it_off" },
    { id: "clothesline" },
    { id: "inflame" },
    { id: "body_slam" },
  ];
}
