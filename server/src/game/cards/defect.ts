import type { CardDef } from "@multispire/shared";

// Defect card definitions. Pure functional game data (name + numbers), no flavor
// text. Values follow Slay the Spire 2. Signature system: Orbs — Lightning
// (end-of-turn damage), Frost (Block), Dark (charges, then bursts at lowest-HP),
// Plasma (Energy), and Glass (AoE damage that decays), scaled by Focus. Channel
// adds an orb; Evoke fires the rightmost orb's burst and removes it.
//
// This set is being reconciled to StS2; see docs/STS2_AUDIT.md for the remaining
// cards still to add and the effects still approximated.

export const DEFECT_CARDS: CardDef[] = [
  // ---- Starter ----
  {
    id: "strike_d",
    name: "Strike",
    character: "defect",
    type: "attack",
    rarity: "basic",
    cost: 1,
    target: "enemy",
    effects: [{ kind: "damage", amount: 6 }],
    upgrade: { effects: [{ kind: "damage", amount: 9 }] },
  },
  {
    id: "defend_d",
    name: "Defend",
    character: "defect",
    type: "skill",
    rarity: "basic",
    cost: 1,
    target: "self",
    effects: [{ kind: "block", amount: 5 }],
    upgrade: { effects: [{ kind: "block", amount: 8 }] },
  },
  {
    id: "zap",
    name: "Zap",
    character: "defect",
    type: "skill",
    rarity: "basic",
    cost: 1,
    target: "self",
    effects: [{ kind: "channelOrb", orb: "lightning" }],
    upgrade: { cost: 0 },
  },
  {
    id: "dualcast",
    name: "Dualcast",
    character: "defect",
    type: "skill",
    rarity: "basic",
    cost: 1,
    target: "self",
    effects: [{ kind: "evokeOrb", times: 2 }],
    upgrade: { cost: 0 },
  },

  // ---- Commons ----
  {
    id: "ball_lightning",
    name: "Ball Lightning",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 7 },
      { kind: "channelOrb", orb: "lightning" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 10 },
        { kind: "channelOrb", orb: "lightning" },
      ],
    },
  },
  {
    id: "beam_cell",
    name: "Beam Cell",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 0,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 3 },
      { kind: "applyPower", power: "vulnerable", amount: 1, to: "enemy" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 4 },
        { kind: "applyPower", power: "vulnerable", amount: 2, to: "enemy" },
      ],
    },
  },
  {
    id: "boost_away",
    name: "Boost Away",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 0,
    target: "self",
    effects: [
      { kind: "block", amount: 6 },
      { kind: "addCardToPile", cardId: "dazed", amount: 1, pile: "discard" },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 9 },
        { kind: "addCardToPile", cardId: "dazed", amount: 1, pile: "discard" },
      ],
    },
  },
  {
    id: "charge_battery",
    name: "Charge Battery",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 1,
    target: "self",
    effects: [
      { kind: "block", amount: 7 },
      { kind: "nextTurnBonus", energy: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 10 },
        { kind: "nextTurnBonus", energy: 1 },
      ],
    },
  },
  {
    id: "cold_snap",
    name: "Cold Snap",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 6 },
      { kind: "channelOrb", orb: "frost" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 9 },
        { kind: "channelOrb", orb: "frost" },
      ],
    },
  },
  {
    id: "coolheaded",
    name: "Coolheaded",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 1,
    target: "self",
    effects: [
      { kind: "channelOrb", orb: "frost" },
      { kind: "draw", amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "channelOrb", orb: "frost" },
        { kind: "draw", amount: 2 },
      ],
    },
  },
  {
    id: "focused_strike",
    name: "Focused Strike",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 9 },
      { kind: "applyPower", power: "focus", amount: 1, to: "self" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 11 },
        { kind: "applyPower", power: "focus", amount: 2, to: "self" },
      ],
    },
  },
  {
    id: "go_for_the_eyes",
    name: "Go for the Eyes",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 0,
    target: "enemy",
    // StS2: apply Weak only if the enemy intends to attack (modeled as: an
    // opponent has already queued an attack on you this turn).
    effects: [
      { kind: "damage", amount: 3 },
      { kind: "ifIncomingAttack", then: [{ kind: "applyPower", power: "weak", amount: 1, to: "enemy" }] },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 4 },
        { kind: "ifIncomingAttack", then: [{ kind: "applyPower", power: "weak", amount: 2, to: "enemy" }] },
      ],
    },
  },
  {
    id: "leap",
    name: "Leap",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 1,
    target: "self",
    effects: [{ kind: "block", amount: 9 }],
    upgrade: { effects: [{ kind: "block", amount: 12 }] },
  },
  {
    id: "sweeping_beam",
    name: "Sweeping Beam",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 1,
    target: "all_enemies",
    effects: [
      { kind: "damage", amount: 6 },
      { kind: "draw", amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 9 },
        { kind: "draw", amount: 1 },
      ],
    },
  },
  {
    id: "turbo",
    name: "TURBO",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 0,
    target: "self",
    effects: [
      { kind: "gainEnergy", amount: 2 },
      { kind: "addCardToPile", cardId: "void", amount: 1, pile: "discard" },
    ],
    upgrade: {
      effects: [
        { kind: "gainEnergy", amount: 3 },
        { kind: "addCardToPile", cardId: "void", amount: 1, pile: "discard" },
      ],
    },
  },

  {
    id: "hologram",
    name: "Hologram",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 1,
    target: "self",
    exhaust: true,
    // Gain Block and put a card from your discard pile back on top of your draw.
    effects: [
      { kind: "block", amount: 3 },
      { kind: "putDiscardOnDraw", amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 5 },
        { kind: "putDiscardOnDraw", amount: 1 },
      ],
    },
  },
  {
    id: "ftl",
    name: "FTL",
    character: "defect",
    type: "attack",
    rarity: "uncommon",
    cost: 0,
    target: "enemy",
    // StS2 only draws if you've played few cards; modeled as an unconditional draw.
    effects: [
      { kind: "damage", amount: 5 },
      { kind: "draw", amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 6 },
        { kind: "draw", amount: 1 },
      ],
    },
  },

  // ---- Uncommons ----
  {
    id: "bulk_up",
    name: "Bulk Up",
    character: "defect",
    type: "power",
    rarity: "uncommon",
    cost: 2,
    target: "self",
    // Lose 1 Orb Slot. Gain Strength and Dexterity.
    effects: [
      { kind: "gainOrbSlots", amount: -1 },
      { kind: "applyPower", power: "strength", amount: 2, to: "self" },
      { kind: "applyPower", power: "dexterity", amount: 2, to: "self" },
    ],
    upgrade: {
      effects: [
        { kind: "gainOrbSlots", amount: -1 },
        { kind: "applyPower", power: "strength", amount: 3, to: "self" },
        { kind: "applyPower", power: "dexterity", amount: 3, to: "self" },
      ],
    },
  },
  {
    id: "capacitor",
    name: "Capacitor",
    character: "defect",
    type: "power",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "gainOrbSlots", amount: 2 }],
    upgrade: { effects: [{ kind: "gainOrbSlots", amount: 3 }] },
  },
  {
    id: "chill",
    name: "Chill",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 0,
    target: "self",
    exhaust: true,
    // One Frost per enemy; in a duel that's a single Frost.
    effects: [{ kind: "channelOrb", orb: "frost" }],
    upgrade: { effects: [{ kind: "channelOrb", orb: "frost" }] },
  },
  {
    id: "darkness",
    name: "Darkness",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    // Channel a Dark orb, then trigger every Dark orb's passive (twice upgraded).
    effects: [
      { kind: "channelOrb", orb: "dark" },
      { kind: "triggerDarkPassive", times: 1 },
    ],
    upgrade: {
      effects: [
        { kind: "channelOrb", orb: "dark" },
        { kind: "triggerDarkPassive", times: 2 },
      ],
    },
  },
  {
    id: "double_energy",
    name: "Double Energy",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    exhaust: true,
    effects: [{ kind: "gainEnergy", amount: 0, doubleCurrent: true }],
    upgrade: { effects: [{ kind: "gainEnergy", amount: 0, doubleCurrent: true }] },
  },
  {
    id: "fusion",
    name: "Fusion",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 2,
    target: "self",
    effects: [{ kind: "channelOrb", orb: "plasma" }],
    upgrade: { cost: 1, effects: [{ kind: "channelOrb", orb: "plasma" }] },
  },
  {
    id: "glasswork",
    name: "Glasswork",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [
      { kind: "block", amount: 5 },
      { kind: "channelOrb", orb: "glass" },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 8 },
        { kind: "channelOrb", orb: "glass" },
      ],
    },
  },
  {
    id: "glacier",
    name: "Glacier",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 2,
    target: "self",
    effects: [
      { kind: "block", amount: 6 },
      { kind: "channelOrb", orb: "frost" },
      { kind: "channelOrb", orb: "frost" },
    ],
    upgrade: {
      effects: [
        { kind: "block", amount: 9 },
        { kind: "channelOrb", orb: "frost" },
        { kind: "channelOrb", orb: "frost" },
      ],
    },
  },
  {
    id: "null_d",
    name: "Null",
    character: "defect",
    type: "attack",
    rarity: "uncommon",
    cost: 2,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 10 },
      { kind: "applyPower", power: "weak", amount: 2, to: "enemy" },
      { kind: "channelOrb", orb: "dark" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 13 },
        { kind: "applyPower", power: "weak", amount: 3, to: "enemy" },
        { kind: "channelOrb", orb: "dark" },
      ],
    },
  },
  {
    id: "overclock",
    name: "Overclock",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 0,
    target: "self",
    effects: [
      { kind: "draw", amount: 2 },
      { kind: "addCardToPile", cardId: "burn", amount: 1, pile: "discard" },
    ],
    upgrade: {
      effects: [
        { kind: "draw", amount: 3 },
        { kind: "addCardToPile", cardId: "burn", amount: 1, pile: "discard" },
      ],
    },
  },
  {
    id: "scrape",
    name: "Scrape",
    character: "defect",
    type: "attack",
    rarity: "uncommon",
    cost: 1,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 7 },
      { kind: "draw", amount: 4 },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 10 },
        { kind: "draw", amount: 5 },
      ],
    },
  },
  {
    id: "skim",
    name: "Skim",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "draw", amount: 3 }],
    upgrade: { effects: [{ kind: "draw", amount: 4 }] },
  },
  {
    id: "sunder",
    name: "Sunder",
    character: "defect",
    type: "attack",
    rarity: "uncommon",
    cost: 3,
    target: "enemy",
    effects: [{ kind: "damage", amount: 24 }],
    upgrade: { effects: [{ kind: "damage", amount: 32 }] },
  },

  // ---- Rares ----
  {
    id: "defragment",
    name: "Defragment",
    character: "defect",
    type: "power",
    rarity: "rare",
    cost: 1,
    target: "self",
    effects: [{ kind: "applyPower", power: "focus", amount: 1, to: "self" }],
    upgrade: { effects: [{ kind: "applyPower", power: "focus", amount: 2, to: "self" }] },
  },
  {
    id: "hyperbeam",
    name: "Hyperbeam",
    character: "defect",
    type: "attack",
    rarity: "rare",
    cost: 2,
    target: "all_enemies",
    effects: [
      { kind: "damage", amount: 26 },
      { kind: "applyPower", power: "focus", amount: -3, to: "self" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 34 },
        { kind: "applyPower", power: "focus", amount: -3, to: "self" },
      ],
    },
  },
  {
    id: "ice_lance",
    name: "Ice Lance",
    character: "defect",
    type: "attack",
    rarity: "rare",
    cost: 3,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 19 },
      { kind: "channelOrb", orb: "frost" },
      { kind: "channelOrb", orb: "frost" },
      { kind: "channelOrb", orb: "frost" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 24 },
        { kind: "channelOrb", orb: "frost" },
        { kind: "channelOrb", orb: "frost" },
        { kind: "channelOrb", orb: "frost" },
      ],
    },
  },
  {
    id: "meteor_strike_d",
    name: "Meteor Strike",
    character: "defect",
    type: "attack",
    rarity: "rare",
    cost: 5,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 24 },
      { kind: "channelOrb", orb: "plasma" },
      { kind: "channelOrb", orb: "plasma" },
      { kind: "channelOrb", orb: "plasma" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 30 },
        { kind: "channelOrb", orb: "plasma" },
        { kind: "channelOrb", orb: "plasma" },
        { kind: "channelOrb", orb: "plasma" },
      ],
    },
  },
  {
    id: "rainbow",
    name: "Rainbow",
    character: "defect",
    type: "skill",
    rarity: "rare",
    cost: 2,
    target: "self",
    exhaust: true,
    effects: [
      { kind: "channelOrb", orb: "lightning" },
      { kind: "channelOrb", orb: "frost" },
      { kind: "channelOrb", orb: "dark" },
    ],
    upgrade: {
      effects: [
        { kind: "channelOrb", orb: "lightning" },
        { kind: "channelOrb", orb: "frost" },
        { kind: "channelOrb", orb: "dark" },
      ],
    },
  },
  {
    id: "refract",
    name: "Refract",
    character: "defect",
    type: "attack",
    rarity: "uncommon",
    cost: 3,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 9, times: 2 },
      { kind: "channelOrb", orb: "glass" },
      { kind: "channelOrb", orb: "glass" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 12, times: 2 },
        { kind: "channelOrb", orb: "glass" },
        { kind: "channelOrb", orb: "glass" },
      ],
    },
  },
  {
    id: "shatter",
    name: "Shatter",
    character: "defect",
    type: "attack",
    rarity: "rare",
    cost: 1,
    target: "all_enemies",
    effects: [
      { kind: "damage", amount: 11 },
      { kind: "evokeAllOrbs" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 15 },
        { kind: "evokeAllOrbs" },
      ],
    },
  },
  {
    id: "supercritical",
    name: "Supercritical",
    character: "defect",
    type: "skill",
    rarity: "rare",
    cost: 0,
    target: "self",
    exhaust: true,
    effects: [{ kind: "gainEnergy", amount: 4 }],
    upgrade: { effects: [{ kind: "gainEnergy", amount: 6 }] },
  },

  // ---- Ancients ----
  {
    id: "biased_cognition",
    name: "Biased Cognition",
    character: "defect",
    type: "power",
    rarity: "rare",
    cost: 1,
    target: "self",
    // Gain Focus, but lose 1 Focus at the start of each turn thereafter.
    effects: [
      { kind: "applyPower", power: "focus", amount: 4, to: "self" },
      { kind: "applyPower", power: "focus_drain", amount: 1, to: "self" },
    ],
    upgrade: {
      effects: [
        { kind: "applyPower", power: "focus", amount: 5, to: "self" },
        { kind: "applyPower", power: "focus_drain", amount: 1, to: "self" },
      ],
    },
  },
  {
    id: "quadcast",
    name: "Quadcast",
    character: "defect",
    type: "skill",
    rarity: "rare",
    cost: 1,
    target: "self",
    effects: [{ kind: "evokeOrb", times: 4 }],
    upgrade: { effects: [{ kind: "evokeOrb", times: 4 }] },
  },
];
