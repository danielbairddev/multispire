import type { CardDef } from "@multispire/shared";

// Defect card definitions. Pure functional game data (name + numbers), no flavor
// text. The Defect's signature system is Orbs: Lightning (end-of-turn damage),
// Frost (end-of-turn Block), Dark (charges, then bursts), and Plasma (Energy),
// scaled by Focus. Channel adds an orb; Evoke fires an orb's burst and removes it.
//
// To add a card: append a CardDef here. The registry picks it up automatically.

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
    id: "go_for_the_eyes",
    name: "Go for the Eyes",
    character: "defect",
    type: "attack",
    rarity: "common",
    cost: 0,
    target: "enemy",
    effects: [
      { kind: "damage", amount: 3 },
      { kind: "applyPower", power: "weak", amount: 1, to: "enemy" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 4 },
        { kind: "applyPower", power: "weak", amount: 2, to: "enemy" },
      ],
    },
  },
  {
    id: "steam_barrier",
    name: "Steam Barrier",
    character: "defect",
    type: "skill",
    rarity: "common",
    cost: 0,
    target: "self",
    effects: [{ kind: "block", amount: 6 }],
    upgrade: { effects: [{ kind: "block", amount: 8 }] },
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
    name: "Turbo",
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

  // ---- Uncommons ----
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
    id: "consume",
    name: "Consume",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 2,
    target: "self",
    effects: [
      { kind: "applyPower", power: "focus", amount: 2, to: "self" },
      { kind: "gainOrbSlots", amount: -1 },
    ],
    upgrade: {
      effects: [
        { kind: "applyPower", power: "focus", amount: 3, to: "self" },
        { kind: "gainOrbSlots", amount: -1 },
      ],
    },
  },
  {
    id: "darkness",
    name: "Darkness",
    character: "defect",
    type: "skill",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "channelOrb", orb: "dark" }],
    upgrade: { cost: 1, effects: [{ kind: "channelOrb", orb: "dark" }] },
  },
  {
    id: "defragment",
    name: "Defragment",
    character: "defect",
    type: "power",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "applyPower", power: "focus", amount: 1, to: "self" }],
    upgrade: { effects: [{ kind: "applyPower", power: "focus", amount: 2, to: "self" }] },
  },
  {
    id: "doom_and_gloom",
    name: "Doom and Gloom",
    character: "defect",
    type: "attack",
    rarity: "uncommon",
    cost: 2,
    target: "all_enemies",
    effects: [
      { kind: "damage", amount: 10 },
      { kind: "channelOrb", orb: "dark" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 14 },
        { kind: "channelOrb", orb: "dark" },
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
    // StS2: Gain 6 (9 upgraded) Block. Channel 2 Frost.
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
    // StS2: Deal 7 (10 upgraded) damage. Draw 4 (5) cards.
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
    id: "biased_cognition",
    name: "Biased Cognition",
    character: "defect",
    type: "power",
    rarity: "uncommon",
    cost: 1,
    target: "self",
    effects: [{ kind: "applyPower", power: "focus", amount: 4, to: "self" }],
    upgrade: { effects: [{ kind: "applyPower", power: "focus", amount: 5, to: "self" }] },
  },

  // ---- Rares ----
  {
    id: "core_surge",
    name: "Core Surge",
    character: "defect",
    type: "attack",
    rarity: "rare",
    cost: 1,
    target: "enemy",
    exhaust: true,
    effects: [
      { kind: "damage", amount: 11 },
      { kind: "applyPower", power: "artifact", amount: 1, to: "self" },
    ],
    upgrade: {
      effects: [
        { kind: "damage", amount: 15 },
        { kind: "applyPower", power: "artifact", amount: 1, to: "self" },
      ],
    },
  },
  {
    id: "electrodynamics",
    name: "Electrodynamics",
    character: "defect",
    type: "power",
    rarity: "rare",
    cost: 2,
    target: "self",
    effects: [
      { kind: "channelOrb", orb: "lightning" },
      { kind: "channelOrb", orb: "lightning" },
    ],
    upgrade: {
      effects: [
        { kind: "channelOrb", orb: "lightning" },
        { kind: "channelOrb", orb: "lightning" },
        { kind: "channelOrb", orb: "lightning" },
      ],
    },
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
    id: "tempest",
    name: "Tempest",
    character: "defect",
    type: "skill",
    rarity: "rare",
    cost: 2,
    target: "self",
    exhaust: true,
    // Channel a burst of Lightning (fixed in this engine; the real card scales on X).
    effects: [
      { kind: "channelOrb", orb: "lightning" },
      { kind: "channelOrb", orb: "lightning" },
      { kind: "channelOrb", orb: "lightning" },
    ],
    upgrade: {
      effects: [
        { kind: "channelOrb", orb: "lightning" },
        { kind: "channelOrb", orb: "lightning" },
        { kind: "channelOrb", orb: "lightning" },
        { kind: "channelOrb", orb: "lightning" },
      ],
    },
  },
];
