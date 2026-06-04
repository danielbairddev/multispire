import type { PowerDef, PowerId } from "@multispire/shared";
import { reportMissing } from "./missing.js";

// Powers (buffs/debuffs) the engine understands. Add new ones here.
export const POWERS: Record<string, PowerDef> = {
  strength: { id: "strength", name: "Strength", kind: "buff" },
  // Tracks temporary Strength (e.g. Flex). At end of turn it removes that much
  // Strength, then clears itself. Resolved specially in finishResolution.
  strength_down: { id: "strength_down", name: "Strength Down", kind: "debuff" },
  dexterity: { id: "dexterity", name: "Dexterity", kind: "buff" },
  // Temporary Dexterity bookkeeping, mirrors strength_down.
  dexterity_down: { id: "dexterity_down", name: "Dexterity Down", kind: "debuff" },
  metallicize: { id: "metallicize", name: "Metallicize", kind: "buff" },
  regen: { id: "regen", name: "Regen", kind: "buff", decaysPerTurn: true },
  vulnerable: { id: "vulnerable", name: "Vulnerable", kind: "debuff", decaysPerTurn: true },
  weak: { id: "weak", name: "Weak", kind: "debuff", decaysPerTurn: true },
  frail: { id: "frail", name: "Frail", kind: "debuff", decaysPerTurn: true },
  // Reflects damage to attackers when they hit you.
  thorns: { id: "thorns", name: "Thorns", kind: "buff" },
  // Gains Block each turn; loses a stack when you take unblocked attack damage.
  plated_armor: { id: "plated_armor", name: "Plated Armor", kind: "buff" },
  // Block is no longer removed at the start of your turn.
  barricade: { id: "barricade", name: "Barricade", kind: "buff" },
  // Gain this much Strength at the start of each of your turns.
  demon_form: { id: "demon_form", name: "Demon Form", kind: "buff" },
  // Negates the next debuff that would be applied to you (one per stack).
  artifact: { id: "artifact", name: "Artifact", kind: "buff" },
  // All damage you take is reduced to 1. Ticks down each turn.
  intangible: { id: "intangible", name: "Intangible", kind: "buff", decaysPerTurn: true },
  // Rage: gain Block whenever you play an Attack this turn. Cleared each turn.
  rage: { id: "rage", name: "Rage", kind: "buff", decaysPerTurn: true },
  // No Block: you cannot gain Block this turn (Battle Trance-style drawback). Decays.
  no_block: { id: "no_block", name: "No Block", kind: "debuff", decaysPerTurn: true },
  // No Draw: you cannot draw more cards this turn (Battle Trance drawback). Decays.
  no_draw: { id: "no_draw", name: "No Draw", kind: "debuff", decaysPerTurn: true },
  // Bookkeeping for temporary Thorns (e.g. Flame Barrier). Removed at end of turn
  // like strength_down. Never decays on its own.
  thorns_down: { id: "thorns_down", name: "Thorns Down", kind: "debuff" },
  // Feel No Pain: gain this much Block whenever a card is Exhausted.
  feel_no_pain: { id: "feel_no_pain", name: "Feel No Pain", kind: "buff" },
  // Dark Embrace: draw this many cards whenever a card is Exhausted.
  dark_embrace: { id: "dark_embrace", name: "Dark Embrace", kind: "buff" },
  // Berserk: gain this much Energy at the start of each of your turns.
  berserk: { id: "berserk", name: "Berserk", kind: "buff" },
  // Brutality: lose this much HP and draw that many cards at the start of each turn.
  brutality: { id: "brutality", name: "Brutality", kind: "buff" },
  // Rupture: gain this much Strength whenever you lose HP from a card.
  rupture: { id: "rupture", name: "Rupture", kind: "buff" },
  // --- Regent powers ---
  // Vigor: your next Attack deals this much extra damage, then it's consumed.
  vigor: { id: "vigor", name: "Vigor", kind: "buff" },
  // Child of the Stars: gain N Block for each Star Energy spent.
  child_of_the_stars: { id: "child_of_the_stars", name: "Child of the Stars", kind: "buff" },
  // Black Hole: deal N damage to all enemies whenever you spend or gain Star Energy.
  black_hole: { id: "black_hole", name: "Black Hole", kind: "buff" },
  // Arsenal: gain N Strength whenever you create a card.
  arsenal: { id: "arsenal", name: "Arsenal", kind: "buff" },
  // Furnace / Hammer Time: Forge N at the start of each turn.
  auto_forge: { id: "auto_forge", name: "Auto-Forge", kind: "buff" },
  // Genesis: gain N Star Energy at the start of each turn.
  genesis: { id: "genesis", name: "Genesis", kind: "buff" },
  // Spectrum Shift: add N random Colorless cards to hand at the start of each turn.
  spectrum_shift: { id: "spectrum_shift", name: "Spectrum Shift", kind: "buff" },
  // Tyranny: at the start of each turn, draw 1 and Exhaust 1 random card from hand.
  tyranny: { id: "tyranny", name: "Tyranny", kind: "buff" },
  // The Sealed Throne: gain N Star Energy whenever you play a card.
  sealed_throne: { id: "sealed_throne", name: "The Sealed Throne", kind: "buff" },
  // Pillar of Creation: gain N Block whenever you create a card.
  pillar_of_creation: { id: "pillar_of_creation", name: "Pillar of Creation", kind: "buff" },
  // Parry: gain N Block whenever you play the Sovereign Blade.
  parry: { id: "parry", name: "Parry", kind: "buff" },
  // Monarch's Gaze: whenever you attack an enemy, it loses 1 Strength this turn.
  monarchs_gaze: { id: "monarchs_gaze", name: "Monarch's Gaze", kind: "buff" },
  // Seeking Edge: the Sovereign Blade hits all enemies.
  seeking_edge: { id: "seeking_edge", name: "Seeking Edge", kind: "buff" },
  // Sword Sage: the Sovereign Blade hits N additional times.
  sword_sage: { id: "sword_sage", name: "Sword Sage", kind: "buff" },
  // Pale Blue Dot: if you play 5+ cards in a turn, draw N at the start of your next turn.
  pale_blue_dot: { id: "pale_blue_dot", name: "Pale Blue Dot", kind: "buff" },
  // Monologue: gain N temporary Strength whenever you play a card this turn. Cleared end of turn.
  monologue: { id: "monologue", name: "Monologue", kind: "buff" },
  // Reflect: deal the blocked amount back to attackers this turn. Cleared end of turn.
  reflect: { id: "reflect", name: "Reflect", kind: "buff" },
  // Orbit: refund 1 Energy for every 4 total Energy you spend this combat.
  orbit: { id: "orbit", name: "Orbit", kind: "buff" },
  // --- Silent powers ---
  // Poison: lose HP equal to the stacks at the start of your turn, then it drops by 1.
  // Decrement is handled specially (after dealing its damage), not via decaysPerTurn.
  poison: { id: "poison", name: "Poison", kind: "debuff" },
  // Noxious Fumes: apply N Poison to all enemies at the start of your turn.
  noxious_fumes: { id: "noxious_fumes", name: "Noxious Fumes", kind: "buff" },
  // Infinite Blades: add N Shivs to your hand at the start of your turn.
  infinite_blades: { id: "infinite_blades", name: "Infinite Blades", kind: "buff" },
  // A Thousand Cuts: deal N damage to all enemies whenever you play a card.
  thousand_cuts: { id: "thousand_cuts", name: "A Thousand Cuts", kind: "buff" },
  // After Image: gain N Block whenever you play a card.
  after_image: { id: "after_image", name: "After Image", kind: "buff" },
  // Envenom: apply N Poison whenever you deal unblocked attack damage.
  envenom: { id: "envenom", name: "Envenom", kind: "buff" },
  // Accuracy: your Shivs deal N additional damage.
  accuracy: { id: "accuracy", name: "Accuracy", kind: "buff" },
  // Wraith Form: lose N Dexterity at the start of each of your turns.
  wraith_form: { id: "wraith_form", name: "Wraith Form", kind: "buff" },
  // Corpse Explosion: when this target dies, deal its Max HP (×N) to all enemies.
  corpse_explosion: { id: "corpse_explosion", name: "Corpse Explosion", kind: "debuff" },
  // Void Form: the first N cards you play each turn cost 0.
  void_form: { id: "void_form", name: "Void Form", kind: "buff" },
  // Focus: increases the value of Lightning, Frost, and Dark orbs.
  focus: { id: "focus", name: "Focus", kind: "buff" },
  // Plating (StS2 Ironclad): gain this much Block each turn; decreases by 1 each turn.
  plating: { id: "plating", name: "Plating", kind: "buff" },
  // Doom (Necrobinder): at end of turn, if Doom >= the target's HP, it dies.
  doom: { id: "doom", name: "Doom", kind: "debuff" },
  // Shroud (Necrobinder): gain Block whenever you apply Doom.
  shroud: { id: "shroud", name: "Shroud", kind: "buff" },
  // Spirit of Ash (Necrobinder): gain Block whenever you play an Ethereal card.
  spirit_of_ash: { id: "spirit_of_ash", name: "Spirit of Ash", kind: "buff" },
  // Focus Drain (Biased Cognition): lose this much Focus at the start of each turn.
  focus_drain: { id: "focus_drain", name: "Focus Drain", kind: "debuff" },
  // Countdown (Necrobinder): apply Doom to a random enemy at the start of each turn.
  countdown: { id: "countdown", name: "Countdown", kind: "buff" },
  // Devour Life (Necrobinder): Summon whenever you play a Soul.
  devour_life: { id: "devour_life", name: "Devour Life", kind: "buff" },
  // Haunt (Necrobinder): deal damage to a random enemy whenever you play a Soul.
  haunt: { id: "haunt", name: "Haunt", kind: "buff" },
  // Reaper Form (Necrobinder): your Attacks also apply Doom equal to their damage.
  reaper_form: { id: "reaper_form", name: "Reaper Form", kind: "buff" },
  // Calcify (Necrobinder): Osty's attacks deal additional damage.
  calcify: { id: "calcify", name: "Calcify", kind: "buff" },
};

export function getPower(id: PowerId): PowerDef {
  const p = POWERS[id];
  if (!p) {
    reportMissing("power", id);
    // Tolerant fallback: an inert buff so the match continues.
    return { id, name: id, kind: "buff" };
  }
  return p;
}

// Damage multipliers contributed by powers.
export const VULNERABLE_MULT = 1.5; // incoming attack damage when target is Vulnerable
export const WEAK_MULT = 0.75; // outgoing attack damage when attacker is Weak
export const FRAIL_MULT = 0.75; // block gained when player is Frail
