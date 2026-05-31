import type { CardDef } from "@multispire/shared";

// Ironclad card definitions. Pure functional game data: name, cost, and numeric
// effects. Values mirror Slay the Spire mechanics; tweak here to match StS2 as
// the import pipeline firms up. The `upgrade` field holds the upgraded delta.
//
// To add a card: append a CardDef here. The registry picks it up automatically.

export const IRONCLAD_CARDS: CardDef[] = [
  // ---- Starter ----
  {
    id: "strike_r",
    name: "Strike",
    character: "ironclad",
    type: "attack",
    rarity: "basic",
    cost: 1,
    target: "enemy",
    effects: [{ kind: "damage", amount: 6 }],
    upgrade: { effects: [{ kind: "damage", amount: 9 }] },
  },
  {
    id: "defend_r",
    name: "Defend",
    character: "ironclad",
    type: "skill",
    rarity: "basic",
    cost: 1,
    target: "self",
    effects: [{ kind: "block", amount: 5 }],
    upgrade: { effects: [{ kind: "block", amount: 8 }] },
  },
  {
    id: "bash",
    name: "Bash",
    character: "ironclad",
    type: "attack",
    rarity: "basic",
    cost: 2,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 8 },
      { kind: "applyPower", power: "vulnerable", amount: 2, to: "enemy" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 10 },
        { kind: "applyPower", power: "vulnerable", amount: 3, to: "enemy" },
      ],
    },
  },

  // ---- A few commons ----
  {
    id: "anger",
    name: "Anger",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 0,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 6 },
      { kind: "addCardToPile", cardId: "anger", amount: 1, pile: "discard" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 8 },
        { kind: "addCardToPile", cardId: "anger", amount: 1, pile: "discard" },
      ],
    },
  },
  {
    id: "cleave",
    name: "Cleave",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "all_enemies",
    effects: [{ kind: "damage", amount: 8 }],
    upgrade: { effects: [{ kind: "damage", amount: 11 }] },
  },
  {
    id: "clothesline",
    name: "Clothesline",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 2,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 12 },
      { kind: "applyPower", power: "weak", amount: 2, to: "enemy" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 14 },
        { kind: "applyPower", power: "weak", amount: 3, to: "enemy" },
      ],
    },
  },
  {
    id: "twin_strike",
    name: "Twin Strike",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [{ kind: "damage", amount: 5, times: 2 }],
    upgrade: { effects: [{ kind: "damage", amount: 7, times: 2 }] },
  },
  {
    id: "pommel_strike",
    name: "Pommel Strike",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 9 },
      { kind: "draw", amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 10 },
        { kind: "draw", amount: 2 },
      ],
    },
  },
  {
    id: "iron_wave",
    name: "Iron Wave",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [
      { kind: "block", amount: 5 },
      { kind: "damage", amount: 5 },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 7 },
        { kind: "damage", amount: 7 },
      ],
    },
  },
  {
    id: "body_slam",
    name: "Body Slam",
    character: "ironclad",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [{ kind: "damageEqualToBlock" }],
    upgrade: { cost: 0 },
  },
  {
    id: "shrug_it_off",
    name: "Shrug It Off",
    character: "ironclad",
    type: "skill",
    rarity: "common",
    cost: 1,
    target: "self",
    effects: [
      { kind: "block", amount: 8 },
      { kind: "draw", amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 11 },
        { kind: "draw", amount: 1 },
      ],
    },
  },
  {
    id: "flex",
    name: "Flex",
    character: "ironclad",
    type: "skill",
    rarity: "common",
    cost: 0,
    target: "self",
    // Flex's temporary strength loss is not modeled yet; net effect approximated.
    effects: [{ kind: "applyPower", power: "strength", amount: 2, to: "self" }],
    upgrade: { effects: [{ kind: "applyPower", power: "strength", amount: 4, to: "self" }] },
  },

  // ---- A couple uncommons (powers) ----
  {
    id: "inflame",
    name: "Inflame",
    character: "ironclad",
    type: "power",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "applyPower", power: "strength", amount: 2, to: "self" }],
    upgrade: { effects: [{ kind: "applyPower", power: "strength", amount: 3, to: "self" }] },
  },
  {
    id: "metallicize",
    name: "Metallicize",
    character: "ironclad",
    type: "power",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "applyPower", power: "metallicize", amount: 3, to: "self" }],
    upgrade: { effects: [{ kind: "applyPower", power: "metallicize", amount: 4, to: "self" }] },
  },

  // ---- Status / curse examples (so decks importing them don't crash) ----
  {
    id: "wound",
    name: "Wound",
    character: "neutral",
    type: "status",
    rarity: "special",
    cost: -2,
    target: "none",
    effects: [],
    unplayable: true,
  },
];
