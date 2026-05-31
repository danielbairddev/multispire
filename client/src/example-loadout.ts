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
