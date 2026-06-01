import type { Loadout } from "@multispire/shared";

// Used by the "Load example" button on the join screen. Mirrors
// examples/loadout.ironclad-full.json so the in-app example stays in sync.
export const EXAMPLE_LOADOUT: Loadout = {
  name: "Ironclad",
  character: "ironclad",
  maxHp: 80,
  relics: ["burning_blood"],
  deck: [
    { id: "strike_r", count: 4 },
    { id: "defend_r", count: 4 },
    "bash",
    "anger",
    "cleave",
    "twin_strike",
    { id: "pommel_strike", upgraded: true },
    "iron_wave",
    { id: "shrug_it_off", upgraded: true },
    "clothesline",
    { id: "inflame", upgraded: true },
    "body_slam",
  ],
};

// A ready-to-play Regent build showing off Star Energy and the Forge / Sovereign
// Blade engine. Bring Divine Right for the 3 opening Stars.
export const EXAMPLE_LOADOUT_REGENT: Loadout = {
  name: "Regent",
  character: "regent",
  maxHp: 75,
  relics: ["divine_right"],
  deck: [
    { id: "strike_reg", count: 4 },
    { id: "defend_reg", count: 3 },
    "falling_star",
    { id: "venerate", count: 2 },
    "cloak_of_stars",
    "crescent_spear",
    "celestial_might",
    "astral_pulse",
    "crush_under",
    "cosmic_indifference",
    "bulwark",
    "conqueror",
    "furnace",
    { id: "child_of_the_stars", upgraded: true },
    "arsenal",
  ],
};
