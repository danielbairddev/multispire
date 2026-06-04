import type { CardDef } from "@multispire/shared";
import { reportMissing } from "../missing.js";
import { DEFECT_CARDS } from "./defect.js";
import { IRONCLAD_CARDS } from "./ironclad.js";
import { NECROBINDER_CARDS } from "./necrobinder.js";
import { NEUTRAL_CARDS } from "./neutral.js";
import { REGENT_CARDS } from "./regent.js";
import { SILENT_CARDS } from "./silent.js";

// All known cards, indexed by id. Future characters register their arrays here.
const ALL: CardDef[] = [
  ...IRONCLAD_CARDS,
  ...NEUTRAL_CARDS,
  ...REGENT_CARDS,
  ...SILENT_CARDS,
  ...DEFECT_CARDS,
  ...NECROBINDER_CARDS,
];

/**
 * Whether cards whose real behavior is only partially modeled (`approx: true`)
 * are allowed in play. Off by default so the UI clearly marks them unsupported
 * and they can't be added to a build or played — we don't want half-implemented
 * cards sneaking in. Flip to true to enable the approximations.
 */
export const APPROX_CARDS_ENABLED = false;

/** A card is supported unless it's an approximation and approximations are off. */
export function isCardSupported(def: CardDef): boolean {
  return !def.approx || APPROX_CARDS_ENABLED;
}

const BY_ID = new Map<string, CardDef>(ALL.map((c) => [c.id, c]));

// Punctuation-insensitive index: strip everything but [a-z0-9] from each card's
// id AND its display name, so "Ascender's Bane", "ascenders_bane", "Decisions,
// Decisions" all resolve without a hand-written alias. Built from ids first, then
// names (ids win on collision).
const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const BY_STRIPPED = new Map<string, string>();
for (const c of ALL) BY_STRIPPED.set(strip(c.id), c.id);
for (const c of ALL) {
  const k = strip(c.name);
  if (!BY_STRIPPED.has(k)) BY_STRIPPED.set(k, c.id);
}

// Aliases let importers use ids from other sources (e.g. CamelCase run exports)
// without an exact match. Keys are compared after lowercasing + stripping
// separators. Extend this as you map more real-world ids onto engine ids.
const CARD_ALIASES: Record<string, string> = {
  pommelstrike: "pommel_strike",
  twinstrike: "twin_strike",
  ironwave: "iron_wave",
  bodyslam: "body_slam",
  shrugitoff: "shrug_it_off",
  stonearmor: "stone_armor",
  bloodwall: "blood_wall",
  setupstrike: "setup_strike",
  fightme: "fight_me",
  break: "break_a",
  striker: "strike_r",
  strike: "strike_r",
  defendr: "defend_r",
  defend: "defend_r",
  // Multi-word ids from run exports, separators stripped + lowercased.
  heavyblade: "heavy_blade",
  perfectedstrike: "perfected_strike",
  swordboomerang: "sword_boomerang",
  truegrit: "true_grit",
  wildstrike: "wild_strike",
  battletrance: "battle_trance",
  bloodforblood: "blood_for_blood",
  burningpact: "burning_pact",
  ghostlyarmor: "ghostly_armor",
  powerthrough: "power_through",
  recklesscharge: "reckless_charge",
  searingblow: "searing_blow",
  seeingred: "seeing_red",
  seversoul: "sever_soul",
  secondwind: "second_wind",
  feelnopain: "feel_no_pain",
  darkembrace: "dark_embrace",
  fiendfire: "fiend_fire",
  spotweakness: "spot_weakness",
  demonform: "demon_form",
  limitbreak: "limit_break",
  flamebarrier: "flame_barrier",
  bandageup: "bandage_up",
  darkshackles: "dark_shackles",
  dramaticentrance: "dramatic_entrance",
  flashofsteel: "flash_of_steel",
  goodinstincts: "good_instincts",
  masterofstrategy: "master_of_strategy",
  swiftstrike: "swift_strike",
  // ---- Regent ----
  strikereg: "strike_reg",
  defendreg: "defend_reg",
  fallingstar: "falling_star",
  astralpulse: "astral_pulse",
  bigbang: "big_bang",
  blackhole: "black_hole",
  beatintoshape: "beat_into_shape",
  bundleofjoy: "bundle_of_joy",
  celestialmight: "celestial_might",
  childofthestars: "child_of_the_stars",
  cloakofstars: "cloak_of_stars",
  collisioncourse: "collision_course",
  cosmicindifference: "cosmic_indifference",
  crashlanding: "crash_landing",
  crescentspear: "crescent_spear",
  crushunder: "crush_under",
  "decisionsdecisions": "decisions_decisions",
  sovereignblade: "sovereign_blade",
  minionstrike: "minion_strike",
  divebomb: "dive_bomb",
  "begone!!": "begone",
  "charge!!!": "charge",
  // New Regent commons / uncommons / rares / ancients.
  gatherlight: "gather_light",
  glitterstream: "glitterstream",
  guidingstar: "guiding_star",
  hiddencache: "hidden_cache",
  knowthyplace: "know_thy_place",
  photoncut: "photon_cut",
  refineblade: "refine_blade",
  solarstrike: "solar_strike",
  spoilsofbattle: "spoils_of_battle",
  wroughtinwar: "wrought_in_war",
  gammablast: "gamma_blast",
  kinglykick: "kingly_kick",
  kinglypunch: "kingly_punch",
  knockoutblow: "knockout_blow",
  lunarblast: "lunar_blast",
  manifestauthority: "manifest_authority",
  palebluedot: "pale_blue_dot",
  particlewall: "particle_wall",
  pillarofcreation: "pillar_of_creation",
  royalgamble: "royal_gamble",
  shiningstrike: "shining_strike",
  spectrumshift: "spectrum_shift",
  summonforth: "summon_forth",
  dyingstar: "dying_star",
  foregoneconclusion: "foregone_conclusion",
  "guards!!!": "guards",
  hammertime: "hammer_time",
  heavenlydrill: "heavenly_drill",
  heirloomhammer: "heirloom_hammer",
  iaminvincible: "i_am_invincible",
  makeitso: "make_it_so",
  "monarch'sgaze": "monarchs_gaze",
  monarchsgaze: "monarchs_gaze",
  neutronaegis: "neutron_aegis",
  seekingedge: "seeking_edge",
  sevenstars: "seven_stars",
  swordsage: "sword_sage",
  thesmith: "the_smith",
  voidform: "void_form",
  meteorshower: "meteor_shower",
  thesealedthrone: "the_sealed_throne",
  // ---- Silent ----
  strikeg: "strike_g",
  defendg: "defend_g",
  daggerspray: "dagger_spray",
  daggerthrow: "dagger_throw",
  deadlypoison: "deadly_poison",
  poisonedstab: "poisoned_stab",
  quickslash: "quick_slash",
  suckerpunch: "sucker_punch",
  cloakanddagger: "cloak_and_dagger",
  dodgeandroll: "dodge_and_roll",
  flyingknee: "flying_knee",
  bladedance: "blade_dance",
  alloutattack: "all_out_attack",
  bouncingflask: "bouncing_flask",
  calculatedgamble: "calculated_gamble",
  cripplingcloud: "crippling_cloud",
  heelhook: "heel_hook",
  infiniteblades: "infinite_blades",
  legsweep: "leg_sweep",
  noxiousfumes: "noxious_fumes",
  riddlewithholes: "riddle_with_holes",
  afterimage: "after_image",
  athousandcuts: "a_thousand_cuts",
  diediedie: "die_die_die",
  grandfinale: "grand_finale",
  glassknife: "glass_knife",
  wraithform: "wraith_form",
  corpseexplosion: "corpse_explosion",
  flickflack: "flick_flack",
  leadingstrike: "leading_strike",
  piercingwail: "piercing_wail",
  bubblebubble: "bubble_bubble",
  // ---- Defect ----
  striked: "strike_d",
  defendd: "defend_d",
  balllightning: "ball_lightning",
  beamcell: "beam_cell",
  chargebattery: "charge_battery",
  coldsnap: "cold_snap",
  gofortheeyes: "go_for_the_eyes",
  steambarrier: "steam_barrier",
  sweepingbeam: "sweeping_beam",
  meteorstrike: "meteor_strike_d",
  biasedcognition: "biased_cognition",
  focusedstrike: "focused_strike",
  bulkup: "bulk_up",
  doubleenergy: "double_energy",
  icelance: "ice_lance",
  boostaway: "boost_away",
  // ---- Necrobinder ----
  striken: "strike_n",
  defendn: "defend_n",
  blightstrike: "blight_strike",
  negativepulse: "negative_pulse",
  gravewarden: "grave_warden",
  noescape: "no_escape",
  endofdays: "end_of_days",
  spiritofash: "spirit_of_ash",
  ascendersbane: "ascenders_bane",
  pullaggro: "pull_aggro",
  sculptingstrike: "sculpting_strike",
  glimpsebeyond: "glimpse_beyond",
};

/**
 * Map any incoming id onto a canonical engine card id. Tries: exact match,
 * lowercase match, then alias (lowercased, separators stripped). Returns the
 * best-guess canonical id (which may still be unknown — caller validates).
 */
export function canonicalCardId(raw: string): string {
  const trimmed = raw.trim();
  if (BY_ID.has(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (BY_ID.has(lower)) return lower;
  const stripped = strip(lower);
  if (CARD_ALIASES[stripped]) return CARD_ALIASES[stripped];
  // Punctuation-insensitive match against every card id and display name.
  if (BY_STRIPPED.has(stripped)) return BY_STRIPPED.get(stripped)!;
  return lower; // unknown; surfaced by getCard's missing-card logging
}

export function hasCard(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Look up a card definition. Unknown ids log a clear "go add this" message and
 * return null so the caller can skip the card without crashing the match.
 */
export function getCard(id: string): CardDef | null {
  const c = BY_ID.get(id);
  if (!c) {
    reportMissing("card", id);
    return null;
  }
  return c;
}

export function allCards(): CardDef[] {
  return ALL;
}

/** Supported, deckable cards of a character/pool — used to generate random cards
 *  (e.g. Bundle of Joy's "add 3 random Colorless cards"). Excludes tokens,
 *  statuses, curses and unplayables so we only ever hand out real cards. */
export function cardsForCharacter(character: CardDef["character"]): CardDef[] {
  return ALL.filter(
    (c) =>
      c.character === character &&
      !c.token &&
      !c.unplayable &&
      c.type !== "status" &&
      c.type !== "curse" &&
      isCardSupported(c),
  );
}

/** Resolve the effective definition for an instance, applying upgrade deltas. */
export function resolveCard(id: string, upgraded: boolean): CardDef | null {
  const base = getCard(id);
  if (!base) return null;
  if (!upgraded || !base.upgrade) return base;
  return { ...base, ...base.upgrade };
}
