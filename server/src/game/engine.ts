import type {
  BuildCard,
  CardDef,
  CardType,
  CardView,
  Effect,
  GameView,
  LogEntry,
  OrbType,
  PendingAttackView,
  PendingChoiceView,
  PlayerBuild,
  PlayerView,
  PowerView,
  ResolutionAttack,
  ResolutionBlock,
  ResolutionView,
} from "@multispire/shared";
import { cardsForCharacter, isCardSupported, resolveCard } from "./cards/registry.js";
import { getRelic } from "./relics.js";
import {
  FRAIL_MULT,
  VULNERABLE_MULT,
  WEAK_MULT,
  getPower,
} from "./powers.js";
import { reportMissing } from "./missing.js";
import type { DeckList } from "./decks.js";

const HAND_SIZE = 5;
const BASE_ENERGY = 3;
export const DEFAULT_MAX_HP = 75;

// Distinct, high-contrast colors handed out in join order so every player has a
// stable identity (used for names, attack arrows, and the resolution summary).
const PLAYER_COLORS = [
  "#e8503a", // red
  "#3aa0e8", // blue
  "#5fbf63", // green
  "#d9a84e", // gold
  "#b56fe0", // purple
  "#e8843a", // orange
  "#3ad0c0", // teal
  "#e85a9c", // pink
];

let uidCounter = 1;
const uid = (prefix: string) => `${prefix}_${(uidCounter++).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

interface CardInstance {
  uid: string;
  id: string;
  upgraded: boolean;
}

interface PendingAttack {
  uid: string;
  sourceId: string;
  targetId: string;
  cardName: string;
  // Final per-hit damage, frozen the moment the card was played. Strength/Weak/
  // Vulnerable are baked in here so debuffs only affect attacks played AFTER they
  // land — the turn plays out in card order, not all-at-once at resolution.
  perHit: number;
  times: number;
  // Reaper: heal the source for total unblocked damage dealt.
  lifesteal?: boolean;
  // Feed: permanently raise the source's max HP if this attack is lethal.
  maxHpOnKill?: number;
  // Knockout Blow: gain this many Stars if this attack is lethal.
  starsOnKill?: number;
}

interface ResolutionData {
  turn: number;
  blocks: ResolutionBlock[];
  attacks: ResolutionAttack[];
  deaths: string[];
}

interface InternalPlayer {
  id: string;
  name: string;
  color: string;
  hp: number;
  maxHp: number;
  block: number;
  blockedThisTurn: boolean;
  energy: number;
  maxEnergy: number;
  hand: CardInstance[];
  draw: CardInstance[];
  discard: CardInstance[];
  exhaust: CardInstance[];
  powers: Map<string, number>;
  relics: string[];
  passed: boolean;
  alive: boolean;
  // Number of times this player has lost HP this combat (Blood for Blood discount).
  hpLossCount: number;
  // Number of cards discarded this turn (Eviscerate discount).
  discardsThisTurn: number;
  // Whether the owner has applied Doom this turn (Death's Door doubles its Block).
  doomAppliedThisTurn: boolean;
  // --- Regent resources ---
  // Star Energy: a second resource that persists across turns within a combat.
  stars: number;
  // Forge: accumulated bonus damage on the Sovereign Blade this combat.
  forge: number;
  // True for Regent players (deck contains Regent cards): start with Stars and
  // surface the Star/Forge HUD. Non-Regent players ignore the whole system.
  usesStars: boolean;
  // Attacks played this turn (Beat into Shape Forges per other attack).
  attacksThisTurn: number;
  // Skills played this turn (Lunar Blast scales off it).
  skillsThisTurn: number;
  // Total cards played this turn (Pale Blue Dot's 5+ check).
  cardsPlayedThisTurn: number;
  // Star Energy gained this turn (Radiate scales off it).
  starsGainedThisTurn: number;
  // Cards created this combat (Supermassive scales off it).
  cardsCreatedThisCombat: number;
  // Total Star Energy spent this combat (Galactic Dust awards Block per threshold).
  starsSpentThisCombat: number;
  // Total Energy spent this combat (Orbit refunds 1 per 4 spent).
  energySpentThisCombat: number;
  // The X resource spent on the card currently being played (energy for cost "X",
  // all Star Energy for starCost -1). Feeds the damagePerX effect.
  xThisPlay: number;
  // Whether the owner has already spent Star Energy this turn (Mini Regent).
  spentStarsThisTurn: boolean;
  // Resources queued for the start of the next turn (Convergence, Glow, Refine Blade…).
  nextTurnEnergy: number;
  nextTurnStars: number;
  nextTurnBlock: number;
  nextTurnDraw: number;
  // One-shot: keep the whole hand at the next end-of-turn cleanup (Convergence).
  retainHandOnce: boolean;
  // --- Defect resources ---
  // Channeled orbs (left = oldest). Dark orbs store an accumulating `amount`.
  orbs: { type: OrbType; amount: number }[];
  // Maximum orbs that can be held at once.
  orbSlots: number;
  // True for Defect players (deck contains Defect cards): surface the orb HUD.
  usesOrbs: boolean;
  // --- Necrobinder ---
  // Osty (a summon). ostyMaxHp 0 means no Osty is currently summoned.
  ostyHp: number;
  ostyMaxHp: number;
  // True for Necrobinder players (deck contains Necrobinder cards): surface Osty.
  usesOsty: boolean;
  seedDeck: DeckList; // the build they brought, for the build viewer
}

// The Regent enters a fight with this much Star Energy.

// A card-selection the engine is paused on. The played card has already left the
// hand and been paid for; we're waiting for `playerId` to pick cards, after which
// `remaining` effects finish and the play completes.
type ChoiceKind =
  | "putDiscardOnDraw"
  | "putHandOnDraw"
  | "exhaustChosen"
  | "replaySkill"
  | "discardChosen"
  | "duplicateChosen"
  | "discover";
interface PendingChoice {
  playerId: string;
  kind: ChoiceKind;
  source: "hand" | "discard" | "discover";
  prompt: string;
  pick: number;
  // Continuation: the rest of the played card's effects, and its context.
  remaining: Effect[];
  effSource: InternalPlayer;
  targets: string[];
  def: CardDef;
  instUid?: string;
  // replaySkill only: how many times to play the chosen Skill.
  replayTimes?: number;
  // duplicateChosen only: how many copies to add of the chosen card.
  dupAmount?: number;
  // discover only: the generated options, and where the chosen card goes.
  options?: CardInstance[];
  discoverPile?: "draw" | "hand";
}

export interface PlayerSeed {
  id: string;
  name: string;
  deck: DeckList;
  relics?: string[];
  maxHp?: number;
}

export class GameEngine {
  readonly matchId: string;
  // YOLO priority: everyone plays all their cards freely (no priority passing),
  // then locks in with End Turn; the turn resolves once all living players end.
  readonly yoloPriority: boolean;
  phase: GameView["phase"] = "lobby";
  turn = 0;
  priorityId: string | null = null;
  startingPlayerId: string | null = null;
  winnerId: string | null = null;
  private order: string[] = [];
  private players = new Map<string, InternalPlayer>();
  private pending: PendingAttack[] = [];
  // Block gained this turn, in play order, for the end-of-turn summary.
  private blockEvents: ResolutionBlock[] = [];
  private resolutionData: ResolutionData | null = null;
  private resolutionAcks = new Set<string>();
  private log: LogEntry[] = [];
  private logSeq = 1;
  private lastPlay: { seq: number; playerId: string; cardName: string; cardType: string; targetId: string | null } | null = null;
  private playSeq = 1;
  // Rampage: per-card-instance bonus damage accumulated over this combat, keyed
  // by the card instance uid.
  private rampageStacks = new Map<string, number>();
  // Kingly Kick: per-card-instance cost reduction accumulated as the card is
  // drawn over this combat, keyed by the card instance uid.
  private costReduction = new Map<string, number>();
  // Kingly Punch: per-card-instance bonus damage accumulated as the card is
  // drawn over this combat, keyed by the card instance uid.
  private drawDamageBonus = new Map<string, number>();
  // Void: while drawing the start-of-turn hand, energy lost to drawn cards is
  // accumulated here and netted against the turn's fresh Energy (so it isn't
  // overwritten). Outside that window, the loss applies to live Energy directly.
  private inTurnStartDraw = false;
  private turnStartEnergyLoss = 0;
  // A card-selection the engine is paused on (Headbutt, Warcry, Burning Pact).
  // While set, no other play/pass is accepted until the chooser resolves it.
  private pendingChoice: PendingChoice | null = null;
  private rng: () => number;

  constructor(matchId: string, rng: () => number = Math.random, opts: { yoloPriority?: boolean } = {}) {
    this.matchId = matchId;
    this.rng = rng;
    this.yoloPriority = opts.yoloPriority ?? false;
  }

  // ----------------------------------------------------------------- setup

  addPlayer(seed: PlayerSeed): void {
    const draw = seed.deck
      .map((spec) => spec && ({ uid: uid("c"), id: spec.id, upgraded: !!spec.upgraded } as CardInstance))
      .filter((c): c is CardInstance => !!c);
    const p: InternalPlayer = {
      id: seed.id,
      name: seed.name,
      color: PLAYER_COLORS[this.order.length % PLAYER_COLORS.length],
      hp: seed.maxHp ?? DEFAULT_MAX_HP,
      maxHp: seed.maxHp ?? DEFAULT_MAX_HP,
      block: 0,
      blockedThisTurn: false,
      energy: 0,
      maxEnergy: BASE_ENERGY,
      hand: [],
      draw,
      discard: [],
      exhaust: [],
      powers: new Map(),
      relics: seed.relics ?? [],
      passed: false,
      alive: true,
      hpLossCount: 0,
      discardsThisTurn: 0,
      doomAppliedThisTurn: false,
      stars: 0,
      forge: 0,
      usesStars: seed.deck.some((spec) => resolveCard(spec.id, false)?.character === "regent"),
      attacksThisTurn: 0,
      skillsThisTurn: 0,
      cardsPlayedThisTurn: 0,
      starsGainedThisTurn: 0,
      cardsCreatedThisCombat: 0,
      starsSpentThisCombat: 0,
      energySpentThisCombat: 0,
      xThisPlay: 0,
      spentStarsThisTurn: false,
      nextTurnEnergy: 0,
      nextTurnStars: 0,
      nextTurnBlock: 0,
      nextTurnDraw: 0,
      retainHandOnce: false,
      orbs: [],
      orbSlots: 3,
      usesOrbs: seed.deck.some((spec) => resolveCard(spec.id, false)?.character === "defect"),
      ostyHp: 0,
      ostyMaxHp: 0,
      usesOsty: seed.deck.some((spec) => resolveCard(spec.id, false)?.character === "necrobinder"),
      seedDeck: seed.deck,
    };
    // Apply relic starting effects (self-targeted ones; enemy-targeted ones like
    // Bag of Marbles are applied in start() once everyone has joined).
    for (const id of p.relics) {
      const r = getRelic(id);
      if (!r) continue;
      if (r.startingStars) {
        p.stars += r.startingStars;
        p.usesStars = true;
      }
      if (r.bonusMaxHp) {
        p.maxHp += r.bonusMaxHp;
        p.hp += r.bonusMaxHp;
      }
      if (r.startingBlock) p.block += r.startingBlock;
      if (r.startingStrength) p.powers.set("strength", (p.powers.get("strength") ?? 0) + r.startingStrength);
      if (r.startingDexterity) p.powers.set("dexterity", (p.powers.get("dexterity") ?? 0) + r.startingDexterity);
      if (r.startingThorns) p.powers.set("thorns", (p.powers.get("thorns") ?? 0) + r.startingThorns);
      if (r.startingPlatedArmor)
        p.powers.set("plated_armor", (p.powers.get("plated_armor") ?? 0) + r.startingPlatedArmor);
    }
    this.players.set(p.id, p);
    this.order.push(p.id);
  }

  start(): void {
    if (this.players.size < 2) throw new Error("Need at least 2 players to start");
    this.phase = "action";
    for (const p of this.players.values()) {
      this.shuffle(p.draw);
    }
    // Enemy-targeted combat-start relics (e.g. Bag of Marbles) apply now that
    // every player is present.
    for (const p of this.players.values()) {
      for (const id of p.relics) {
        const r = getRelic(id);
        if (!r) continue;
        const v = r.startingEnemyVulnerable ?? 0;
        const w = r.startingEnemyWeak ?? 0;
        if (!v && !w) continue;
        for (const other of this.players.values()) {
          if (other.id === p.id) continue;
          if (v) other.powers.set("vulnerable", (other.powers.get("vulnerable") ?? 0) + v);
          if (w) other.powers.set("weak", (other.powers.get("weak") ?? 0) + w);
        }
      }
    }
    // Random starting player on the first turn.
    this.startingPlayerId = this.order[Math.floor(this.rng() * this.order.length)];
    this.beginTurn(true);
    this.pushLog(`Match starts. ${this.name(this.startingPlayerId!)} has priority.`);
  }

  // ----------------------------------------------------------------- turn flow

  private beginTurn(first = false): void {
    this.turn += 1;
    if (!first) {
      // Alternate the starting player each turn (rotate through alive players).
      this.startingPlayerId = this.nextAlive(this.startingPlayerId!, true);
    }
    this.pending = [];
    this.blockEvents = [];
    for (const id of this.order) {
      const p = this.players.get(id)!;
      if (!p.alive) continue;
      // Demon Form: gain Strength at the top of each turn.
      const demon = p.powers.get("demon_form") ?? 0;
      if (demon > 0) p.powers.set("strength", (p.powers.get("strength") ?? 0) + demon);
      // Furnace / Hammer Time: Forge at the start of each turn.
      const autoForge = p.powers.get("auto_forge") ?? 0;
      if (autoForge > 0) this.forge(p, autoForge);
      // Genesis: gain Star Energy at the start of each turn.
      const genesis = p.powers.get("genesis") ?? 0;
      if (genesis > 0) this.gainStars(p, genesis);
      // Wraith Form: lose Dexterity at the start of each turn (the Intangible cost).
      const wraith = p.powers.get("wraith_form") ?? 0;
      if (wraith > 0) {
        p.powers.set("dexterity", (p.powers.get("dexterity") ?? 0) - wraith);
        this.pushLog(`✦ ${p.name} loses ${wraith} Dexterity (Wraith Form).`);
      }
      // Poison: lose HP equal to the stacks (ignores Block), then it drops by 1.
      const poison = p.powers.get("poison") ?? 0;
      if (poison > 0) {
        p.hp = Math.max(0, p.hp - poison);
        this.pushLog(`☠ ${p.name} takes ${poison} Poison damage.`);
        if (poison - 1 > 0) p.powers.set("poison", poison - 1);
        else p.powers.delete("poison");
      }
      // Noxious Fumes: apply Poison to every enemy at the start of your turn.
      const fumes = p.powers.get("noxious_fumes") ?? 0;
      if (fumes > 0) {
        for (const q of this.players.values()) {
          if (q.alive && q.id !== p.id) q.powers.set("poison", (q.powers.get("poison") ?? 0) + fumes);
        }
        this.pushLog(`☠ ${p.name}'s Noxious Fumes applies ${fumes} Poison to all enemies.`);
      }
      // Countdown: apply Doom to a random enemy at the start of your turn.
      const countdown = p.powers.get("countdown") ?? 0;
      if (countdown > 0) {
        const enemies = this.aliveEnemies(p.id);
        if (enemies.length > 0) {
          const q = this.players.get(enemies[Math.floor(this.rng() * enemies.length)])!;
          q.powers.set("doom", (q.powers.get("doom") ?? 0) + countdown);
          this.pushLog(`☠ ${p.name}'s Countdown applies ${countdown} Doom to ${q.name}.`);
        }
      }
      // Clean up the leftover hand: Convergence retains everything once; otherwise
      // Retain keeps the card, Ethereal exhausts it, everything else discards.
      const leftover = p.hand;
      const keepAll = p.retainHandOnce;
      p.retainHandOnce = false;
      p.hand = [];
      for (const c of leftover) {
        const cdef = resolveCard(c.id, c.upgraded);
        if (keepAll || cdef?.retain) p.hand.push(c);
        else if (cdef?.ethereal) this.exhaustCard(p, c);
        else p.discard.push(c);
      }
      // New turn: reset per-turn counters and pay out any queued (Convergence,
      // Glow, Refine Blade, Hidden Cache…) resources before drawing.
      p.attacksThisTurn = 0;
      p.skillsThisTurn = 0;
      p.cardsPlayedThisTurn = 0;
      p.discardsThisTurn = 0;
      p.doomAppliedThisTurn = false;
      p.starsGainedThisTurn = 0;
      p.spentStarsThisTurn = false;
      // Focus Drain (Biased Cognition): lose Focus at the start of each turn.
      const focusDrain = p.powers.get("focus_drain") ?? 0;
      if (focusDrain > 0) {
        p.powers.set("focus", (p.powers.get("focus") ?? 0) - focusDrain);
        this.pushLog(`☠ ${p.name} loses ${focusDrain} Focus (Biased Cognition).`);
      }
      if (p.nextTurnStars > 0) {
        this.gainStars(p, p.nextTurnStars);
        p.nextTurnStars = 0;
      }
      if (p.nextTurnBlock > 0) {
        this.gainBlock(p, p.nextTurnBlock, "Next-turn Block");
        p.nextTurnBlock = 0;
      }
      // Spectrum Shift: add random Colorless cards to hand at the start of the turn.
      const spectrum = p.powers.get("spectrum_shift") ?? 0;
      if (spectrum > 0) this.addRandomCardsToPile(p, "neutral", spectrum, "hand");
      // Infinite Blades: add Shivs to your hand at the start of your turn.
      const blades = p.powers.get("infinite_blades") ?? 0;
      for (let i = 0; i < blades; i++) p.hand.push({ uid: uid("c"), id: "shiv", upgraded: false });
      if (blades > 0) this.onCardCreated(p, blades);
      // Bombardment and friends auto-play from the Exhaust pile each turn.
      this.autoPlayFromExhaust(p);
      // Open the start-of-turn draw window: energy lost to drawn cards (Void) is
      // netted against this turn's fresh Energy below rather than the stale value.
      this.inTurnStartDraw = true;
      this.turnStartEnergyLoss = 0;
      if (first) this.drawOpeningHand(p);
      else this.drawCards(p, HAND_SIZE);
      // Queued (Glow / Pale Blue Dot) extra draw, and Tyranny's draw-then-exhaust.
      if (p.nextTurnDraw > 0) {
        this.drawCards(p, p.nextTurnDraw);
        p.nextTurnDraw = 0;
      }
      const tyranny = p.powers.get("tyranny") ?? 0;
      for (let i = 0; i < tyranny; i++) {
        this.drawCards(p, 1);
        if (p.hand.length > 0) {
          const idx = Math.floor(this.rng() * p.hand.length);
          const [c] = p.hand.splice(idx, 1);
          this.exhaustCard(p, c);
        }
      }
      // Refresh energy (+ relic bonuses + queued Convergence energy), and apply
      // first-turn extra draw.
      let energy = p.maxEnergy + p.nextTurnEnergy;
      p.nextTurnEnergy = 0;
      let extraDraw = 0;
      // Berserk: extra Energy at the start of each turn.
      energy += p.powers.get("berserk") ?? 0;
      for (const rid of p.relics) {
        const r = getRelic(rid);
        energy += r?.bonusEnergyPerTurn ?? 0;
        // Bound Phylactery: summon Osty Max HP at the start of each turn.
        if (r?.summonPerTurn) this.summonOsty(p, r.summonPerTurn);
        if (first) {
          energy += r?.bonusEnergyFirstTurn ?? 0;
          extraDraw += r?.bonusDrawFirstTurn ?? 0;
          // Combat-start Regent relics (applied on the first turn so their cards
          // land in the opening hand and survive the cleanup): Fencing Manual
          // Forges, Orange Dough adds random Colorless cards.
          if (r?.startingForge) this.forge(p, r.startingForge);
          if (r?.startingRandomColorless) this.addRandomCardsToPile(p, "neutral", r.startingRandomColorless, "hand");
        }
      }
      if (extraDraw > 0) this.drawCards(p, extraDraw);
      // Brutality: lose HP (never lethal) and draw that many cards each turn.
      const brutality = p.powers.get("brutality") ?? 0;
      if (brutality > 0) {
        p.hp = Math.max(1, p.hp - brutality);
        p.hpLossCount++;
        this.drawCards(p, brutality);
      }
      // Net any Void-style energy loss from the start-of-turn draws, then close
      // the window so later (mid-turn) draws subtract from live Energy directly.
      p.energy = Math.max(0, energy - this.turnStartEnergyLoss);
      this.inTurnStartDraw = false;
      this.turnStartEnergyLoss = 0;
      // Metallicize / Plated Armor: gain block at the top of the turn.
      const metal = p.powers.get("metallicize") ?? 0;
      if (metal > 0) {
        p.block += metal;
        this.blockEvents.push({ playerId: p.id, playerName: p.name, cardName: "Metallicize", amount: metal });
      }
      const plated = p.powers.get("plated_armor") ?? 0;
      if (plated > 0) {
        p.block += plated;
        this.blockEvents.push({ playerId: p.id, playerName: p.name, cardName: "Plated Armor", amount: plated });
      }
      // Plating (StS2): gain Block equal to the stacks, then the stacks decay by 1.
      const plating = p.powers.get("plating") ?? 0;
      if (plating > 0) {
        p.block += plating;
        this.blockEvents.push({ playerId: p.id, playerName: p.name, cardName: "Plating", amount: plating });
        if (plating - 1 <= 0) p.powers.delete("plating");
        else p.powers.set("plating", plating - 1);
      }
      p.blockedThisTurn = false;
      p.passed = false;
    }
    // Poison (or Brutality) at the top of the turn may have been lethal.
    this.checkDeaths();
    if (this.yoloPriority) {
      // Everyone acts at once; there's no single priority holder.
      this.priorityId = null;
    } else {
      this.priorityId = this.startingPlayerId;
      this.autoPassIfStuck();
    }
  }

  /** A player plays a card. Returns null on success or an error string. */
  playCard(playerId: string, cardUid: string, targetId?: string): string | null {
    if (this.phase !== "action") return "Not in the action phase.";
    if (this.pendingChoice) return "Resolve the current card selection first.";
    const p = this.players.get(playerId);
    if (!p || !p.alive) return "You are not in this match.";
    if (this.yoloPriority) {
      if (p.passed) return "You've ended your turn.";
    } else if (this.priorityId !== playerId) {
      return "It is not your priority.";
    }

    const idx = p.hand.findIndex((c) => c.uid === cardUid);
    if (idx === -1) return "Card not in hand.";
    const inst = p.hand[idx];
    const def = resolveCard(inst.id, inst.upgraded);
    if (!def) return "Unknown card (logged for the devs).";
    if (def.unplayable || def.cost === -2) return "That card can't be played.";
    if (!isCardSupported(def)) return "That card isn't supported yet.";
    const restriction = this.playRestriction(p, def);
    if (restriction) return restriction;

    const effCost = this.effectiveCost(p, def, inst);
    const cost = effCost === "X" ? p.energy : effCost;
    if (typeof cost === "number" && cost > p.energy) return "Not enough energy.";
    const rawStarCost = def.starCost ?? 0;
    // starCost -1 means "spend ALL Star Energy" (e.g. Stardust); always affordable.
    const starSpend = rawStarCost === -1 ? p.stars : rawStarCost;
    if (starSpend > p.stars) return "Not enough Star Energy.";

    // The X resource feeding damagePerX: energy spent for a cost-"X" card, plus all
    // Star Energy spent for a starCost-(-1) card. Snapshot before we pay.
    const xAmount = (effCost === "X" ? cost : 0) + (rawStarCost === -1 ? starSpend : 0);

    // Resolve target.
    const targets = this.resolveTargets(def, playerId, targetId);
    if (targets === null) return "Pick a valid target.";

    // Pay + move the card out of hand.
    p.energy -= typeof cost === "number" ? cost : 0;
    this.spendEnergy(p, typeof cost === "number" ? cost : 0);
    p.xThisPlay = xAmount;
    p.hand.splice(idx, 1);
    if (def.exhaust) {
      // A genuine Exhaust: fire on-exhaust hooks (Sentinel, Feel No Pain, etc.).
      this.exhaustCard(p, inst);
    } else if (def.reshuffleOnPlay) {
      // Sovereign Blade cycles back into the draw pile after each use.
      p.draw.push(inst);
      this.shuffle(p.draw);
    } else if (def.type === "power") {
      // Powers leave play but don't count as "Exhausted" for exhaust synergies.
      p.exhaust.push(inst);
    } else {
      p.discard.push(inst);
    }
    // Spend Star Energy after the card leaves hand (fires Star-reactive powers).
    if (starSpend > 0) this.spendStars(p, starSpend);
    // Per-turn play counters (Beat into Shape, Lunar Blast, Pale Blue Dot).
    if (def.type === "attack") p.attacksThisTurn += 1;
    if (def.type === "skill") p.skillsThisTurn += 1;
    p.cardsPlayedThisTurn += 1;
    // The Sealed Throne: gain Star Energy whenever you play a card.
    const throne = p.powers.get("sealed_throne") ?? 0;
    if (throne > 0) this.gainStars(p, throne);
    // Monologue: gain temporary Strength whenever you play a card this turn.
    const monologue = p.powers.get("monologue") ?? 0;
    if (monologue > 0) {
      p.powers.set("strength", (p.powers.get("strength") ?? 0) + monologue);
      p.powers.set("strength_down", (p.powers.get("strength_down") ?? 0) + monologue);
    }
    // Make It So: every 3rd Skill played this turn, return a Make It So from your
    // discard or draw pile to your hand.
    if (def.type === "skill" && p.skillsThisTurn % 3 === 0) {
      this.returnCardToHand(p, "make_it_so");
    }
    // Parry: gain Block whenever you play the Sovereign Blade.
    if (def.id === "sovereign_blade") {
      const parry = p.powers.get("parry") ?? 0;
      if (parry > 0) this.gainBlock(p, parry, "Parry");
    }
    // After Image: gain Block whenever you play a card.
    const afterImage = p.powers.get("after_image") ?? 0;
    if (afterImage > 0) this.gainBlock(p, afterImage, "After Image");
    // Spirit of Ash: gain Block whenever you play an Ethereal card.
    if (def.ethereal) {
      const ash = p.powers.get("spirit_of_ash") ?? 0;
      if (ash > 0) this.gainBlock(p, ash, "Spirit of Ash");
    }
    // Necrobinder Soul-play reactions: Devour Life summons, Haunt strikes.
    if (def.id === "soul") {
      const devour = p.powers.get("devour_life") ?? 0;
      if (devour > 0) this.summonOsty(p, devour);
      const haunt = p.powers.get("haunt") ?? 0;
      if (haunt > 0) this.orbDamageRandomEnemy(p, haunt, "Haunt");
    }
    // Reaper Form: your Attacks also apply Doom equal to their base damage.
    const reaper = p.powers.get("reaper_form") ?? 0;
    if (reaper > 0 && def.type === "attack") {
      const dmg = def.effects.reduce(
        (s, e) => s + (e.kind === "damage" ? e.amount * (e.times ?? 1) : 0),
        0,
      );
      if (dmg > 0) {
        for (const tid of targets) {
          if (tid !== p.id) this.applyEffect({ kind: "applyPower", power: "doom", amount: dmg, to: "enemy" }, p, [tid], def, inst.uid);
        }
      }
    }
    // A Thousand Cuts: deal damage to all enemies whenever you play a card.
    const cuts = p.powers.get("thousand_cuts") ?? 0;
    if (cuts > 0) {
      for (const q of this.players.values()) {
        if (q.alive && q.id !== p.id) this.dealDamage(q, cuts);
      }
      this.pushLog(`✦ ${p.name}'s A Thousand Cuts deals ${cuts} to all enemies.`);
    }

    const cardLabel = `${def.name}${inst.upgraded ? "+" : ""}`;
    const targetSuffix = targets.length === 1 && targets[0] !== playerId ? ` → ${this.name(targets[0])}` : "";
    this.pushLog(`${p.name} plays ${cardLabel}${targetSuffix} — ${describeCard(def)}`);

    // Record the play so clients can animate it (a floating card by the player).
    this.lastPlay = {
      seq: this.playSeq++,
      playerId,
      cardName: cardLabel,
      cardType: def.type,
      targetId: targets.length === 1 && targets[0] !== playerId ? targets[0] : null,
    };

    // Execute effects: damage is deferred, everything else is immediate. An
    // interactive choice (Headbutt/Warcry/Burning Pact) pauses here; the rest of
    // the effects and the post-play sequence run from resolveChoice() instead.
    const paused = this.applyEffectList(def.effects, p, targets, def, inst.uid);
    if (paused) return null;

    this.finishPlay(p, def);
    return null;
  }

  /** Post-play sequence: Rage block, reset the pass round, advance, check deaths. */
  private finishPlay(p: InternalPlayer, def: CardDef): void {
    // Rage: gain Block whenever you play an Attack this turn.
    const rage = p.powers.get("rage") ?? 0;
    if (def.type === "attack" && rage > 0) this.gainBlock(p, rage, "Rage");

    // YOLO: playing never yields priority — you keep going until you End Turn.
    if (this.yoloPriority) {
      this.checkDeaths();
      return;
    }

    // A play resets the pass round for everyone.
    for (const q of this.players.values()) q.passed = false;
    p.passed = false;

    this.advancePriority(p.id);
    this.checkDeaths();
  }

  /** Energy cost after any state-dependent discount (e.g. Blood for Blood). */
  private effectiveCost(p: InternalPlayer, def: CardDef, inst?: CardInstance): number | "X" {
    if (def.cost === "X") return "X";
    // Void Form: the first N cards each turn cost 0.
    const vf = p.powers.get("void_form") ?? 0;
    if (vf > 0 && p.cardsPlayedThisTurn < vf) return 0;
    // Kingly Kick: subtract whatever cost reduction this instance has accrued.
    const drawDown = inst ? this.costReduction.get(inst.uid) ?? 0 : 0;
    if (def.dynamicCost === "hp_loss") return Math.max(0, def.cost - p.hpLossCount - drawDown);
    if (def.dynamicCost === "discards") return Math.max(0, def.cost - p.discardsThisTurn - drawDown);
    return Math.max(0, def.cost - drawDown);
  }

  /** A player passes priority. */
  pass(playerId: string): string | null {
    if (this.phase !== "action") return "Not in the action phase.";
    if (this.pendingChoice) return "Resolve the current card selection first.";
    const p = this.players.get(playerId);
    if (!p || !p.alive) return "You are not in this match.";
    // YOLO: "pass" means "End Turn" — lock in. Resolve once everyone has ended.
    if (this.yoloPriority) {
      if (p.passed) return "You've already ended your turn.";
      p.passed = true;
      this.pushLog(`${p.name} ends their turn.`);
      if (this.allPassed()) this.resolveTurn();
      return null;
    }
    if (this.priorityId !== playerId) return "It is not your priority.";
    p.passed = true;
    this.pushLog(`${p.name} passes.`);
    this.advancePriority(playerId);
    return null;
  }

  private advancePriority(fromId: string): void {
    if (this.allPassed()) {
      this.resolveTurn();
      return;
    }
    // Move to the next alive player; auto-pass anyone with no legal play.
    let next = this.nextAlive(fromId);
    this.priorityId = next;
    this.autoPassIfStuck();
  }

  /** If the priority player literally cannot act, auto-pass for them. */
  private autoPassIfStuck(): void {
    let guard = 0;
    while (this.phase === "action" && this.priorityId) {
      const p = this.players.get(this.priorityId)!;
      if (p.passed) {
        // Already passed this round; skip to someone who hasn't.
        if (this.allPassed()) return this.resolveTurn();
        this.priorityId = this.nextAlive(this.priorityId);
        if (guard++ > 64) return;
        continue;
      }
      if (this.hasLegalPlay(p)) return; // they can act; wait for input
      p.passed = true;
      this.pushLog(`${p.name} has nothing to play and passes.`);
      if (this.allPassed()) return this.resolveTurn();
      this.priorityId = this.nextAlive(this.priorityId);
      if (guard++ > 64) return;
    }
  }

  // ----------------------------------------------------------------- resolution

  private resolveTurn(): void {
    this.phase = "resolution";
    this.pushLog(`--- Resolution (turn ${this.turn}) ---`);

    // Blocks were all applied immediately during the turn, so they're already in
    // place before any attack lands. Summarize each defender's block and where it
    // came from, in the order it was gained, so the resolution is easy to follow.
    for (const id of this.order) {
      const p = this.players.get(id)!;
      if (!p.alive || p.block <= 0) continue;
      const sources = this.blockEvents.filter((b) => b.playerId === id);
      const detail = sources.length
        ? ` (${sources.map((s) => `${s.cardName} +${s.amount}`).join(", ")})`
        : "";
      this.pushLog(`🛡 ${p.name} has ${p.block} Block${detail}.`);
    }

    // Attacks land in the order they were played, each using the damage frozen at
    // its play time.
    const attacks: ResolutionAttack[] = [];
    for (const atk of this.pending) {
      const src = this.players.get(atk.sourceId);
      const tgt = this.players.get(atk.targetId);
      if (!src || !tgt || !tgt.alive) continue;
      const per = atk.perHit;
      const blockBefore = tgt.block;
      let blocked = 0;
      let hpLost = 0;
      let thornsDealt = 0;
      const thorns = tgt.powers.get("thorns") ?? 0;
      for (let i = 0; i < atk.times; i++) {
        if (!tgt.alive) break;
        const r = this.dealDamage(tgt, per);
        blocked += r.blocked;
        hpLost += r.hp;
        // Thorns reflects back to the attacker on each hit.
        if (thorns > 0 && src.alive) thornsDealt += this.dealDamage(src, thorns).hp;
      }
      // Reflect: deal the amount this attack was blocked back to the attacker.
      const reflect = tgt.powers.get("reflect") ?? 0;
      if (reflect > 0 && blocked > 0 && src.alive && src.id !== tgt.id) {
        const r = this.dealDamage(src, blocked);
        if (r.hp > 0) this.pushLog(`✦ ${tgt.name}'s Reflect deals ${r.hp} to ${src.name}.`);
      }
      // Envenom: dealing unblocked attack damage applies Poison to the target.
      const envenom = src.powers.get("envenom") ?? 0;
      if (envenom > 0 && hpLost > 0 && tgt.alive && src.id !== tgt.id) {
        tgt.powers.set("poison", (tgt.powers.get("poison") ?? 0) + envenom);
        this.pushLog(`☠ ${tgt.name} gains ${envenom} Poison (Envenom).`);
      }
      const lethal = tgt.hp <= 0;
      // Reaper-style lifesteal: heal the attacker for unblocked damage dealt.
      if (atk.lifesteal && hpLost > 0 && src.alive) {
        this.heal(src, hpLost);
        this.pushLog(`✦ ${src.name} heals ${hpLost} from lifesteal.`);
      }
      // Feed: a lethal blow permanently raises the attacker's max HP.
      if (lethal && atk.maxHpOnKill && src.alive) {
        src.maxHp += atk.maxHpOnKill;
        src.hp += atk.maxHpOnKill;
        this.pushLog(`✦ ${src.name}'s max HP rises by ${atk.maxHpOnKill}.`);
      }
      // Knockout Blow: a lethal blow grants the attacker Star Energy.
      if (lethal && atk.starsOnKill && src.alive) {
        this.gainStars(src, atk.starsOnKill);
        this.pushLog(`✦ ${src.name} gains ${atk.starsOnKill} Star Energy (knockout).`);
      }
      if (thornsDealt > 0)
        this.pushLog(`✦ ${tgt.name}'s Thorns deals ${thornsDealt} to ${src.name}.`);
      attacks.push({
        sourceId: src.id,
        sourceName: src.name,
        targetId: tgt.id,
        targetName: tgt.name,
        cardName: atk.cardName,
        damage: per,
        times: atk.times,
        blocked,
        hpLost,
        blockBefore,
        blockAfter: tgt.block,
        lethal,
      });
      const blockNote =
        blockBefore > 0 ? `, block ${blockBefore}→${tgt.block}` : "";
      this.pushLog(
        `${src.name}'s ${atk.cardName} hits ${tgt.name} for ${per}${atk.times > 1 ? ` x${atk.times}` : ""} ` +
          `(${hpLost} HP lost${blocked > 0 ? `, ${blocked} blocked` : ""}${blockNote}).`,
      );
    }
    this.pending = [];

    // Pale Blue Dot: if you played 5+ cards this turn, draw extra next turn.
    for (const id of this.order) {
      const p = this.players.get(id)!;
      if (!p.alive) continue;
      const pbd = p.powers.get("pale_blue_dot") ?? 0;
      if (pbd > 0 && p.cardsPlayedThisTurn >= 5) p.nextTurnDraw += pbd;
      // Lunar Pastry: gain Star Energy at the end of each of your turns.
      for (const rid of p.relics) {
        const s = getRelic(rid)?.starsEndOfTurn ?? 0;
        if (s > 0) this.gainStars(p, s);
      }
    }

    // End-of-turn Burn ticks: each Burn still in hand deals 2 unblockable damage.
    for (const id of this.order) {
      const p = this.players.get(id)!;
      if (!p.alive) continue;
      const burns = p.hand.filter((c) => c.id === "burn").length;
      if (burns <= 0) continue;
      const dmg = burns * 2;
      p.hp = Math.max(0, p.hp - dmg);
      p.hpLossCount++;
      this.pushLog(`🔥 ${p.name} takes ${dmg} from Burn.`);
    }

    // Record who dies as a direct result of this resolution.
    const aliveBefore = new Set(this.order.filter((id) => this.players.get(id)!.alive));
    this.checkDeaths();
    const deaths = this.order
      .filter((id) => aliveBefore.has(id) && !this.players.get(id)!.alive)
      .map((id) => this.name(id));

    this.resolutionData = { turn: this.turn, blocks: this.blockEvents.slice(), attacks, deaths };
    this.resolutionAcks.clear();

    // If the match ended, keep the summary for display (no ack gate needed).
    // Otherwise we hold in the resolution phase until every player acknowledges.
  }

  /** A player dismisses the resolution summary. Turn advances once all have. */
  acknowledgeResolution(playerId: string): string | null {
    if (this.phase !== "resolution") return null;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    this.resolutionAcks.add(playerId);
    if (this.allAcked()) this.finishResolution();
    return null;
  }

  /** Force the turn to advance (e.g. a player disconnected mid-summary). */
  skipResolution(): void {
    if (this.phase === "resolution") this.finishResolution();
  }

  private allAcked(): boolean {
    const alive = this.order.filter((id) => this.players.get(id)!.alive);
    return alive.length > 0 && alive.every((id) => this.resolutionAcks.has(id));
  }

  private finishResolution(): void {
    // Lightning orbs deal their end-of-turn damage BEFORE Block is cleared below,
    // so a target's remaining Block can still soak the hit.
    for (const p of this.players.values()) {
      if (p.alive) this.tickOrbDamage(p);
    }
    // End-of-turn upkeep: clear block, tick powers, then start the next turn.
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      // Barricade keeps Block across turns; otherwise it resets.
      if ((p.powers.get("barricade") ?? 0) <= 0) p.block = 0;
      const regen = p.powers.get("regen") ?? 0;
      if (regen > 0) this.heal(p, regen);
      this.expireTemporaryStrength(p);
      this.expireTemporaryDexterity(p);
      this.expireTemporaryThorns(p);
      // Monologue / Reflect last only for the turn they're played.
      p.powers.delete("monologue");
      p.powers.delete("reflect");
      // Doom: at end of turn, if Doom >= HP, the character dies (ignores Block).
      const doom = p.powers.get("doom") ?? 0;
      if (doom > 0 && doom >= p.hp) {
        p.hp = 0;
        this.pushLog(`☠ ${p.name} succumbs to Doom (${doom}).`);
      }
      this.decayPowers(p);
    }
    this.checkDeaths();
    // Frost/Dark/Plasma orb passives fire here (after Block is cleared so Frost
    // Block carries into the next turn's incoming attacks).
    for (const p of this.players.values()) {
      if (p.alive) this.tickOrbDefense(p);
    }
    // I Am Invincible: at the end of the turn, auto-play any such card sitting on
    // top of the draw pile. Done after Block is cleared so the Block it grants
    // carries into the next turn's incoming attacks.
    for (const p of this.players.values()) {
      if (p.alive) this.autoPlayFromDrawTop(p);
    }
    this.resolutionData = null;
    this.resolutionAcks.clear();
    this.phase = "action";
    this.beginTurn(false);
    this.pushLog(`--- Turn ${this.turn}: ${this.name(this.startingPlayerId!)} starts ---`);
  }

  // ----------------------------------------------------------------- choices

  // Run a list of effects in order. If one is an interactive card-selection,
  // pause: stash the remaining effects and return true. The caller (playCard or
  // resolveChoice) must NOT run the post-play sequence until a later resolveChoice
  // returns false. Auto-resolves a choice when there's nothing to decide.
  private applyEffectList(
    effects: Effect[],
    source: InternalPlayer,
    targets: string[],
    def: CardDef,
    instUid?: string,
  ): boolean {
    for (let i = 0; i < effects.length; i++) {
      const eff = effects[i];
      if (this.isChoiceEffect(eff)) {
        const paused = this.beginChoice(eff, source, targets, def, effects.slice(i + 1), instUid);
        if (paused) return true;
        continue; // auto-resolved (or nothing eligible); run the rest
      }
      this.applyEffect(eff, source, targets, def, instUid);
    }
    return false;
  }

  private isChoiceEffect(
    eff: Effect,
  ): eff is Extract<
    Effect,
    {
      kind:
        | "putDiscardOnDraw"
        | "putHandOnDraw"
        | "exhaustChosen"
        | "replayChosenSkill"
        | "discard"
        | "duplicateChosen"
        | "discover";
    }
  > {
    // A player-chosen discard pauses; a random discard resolves immediately.
    if (eff.kind === "discard") return !eff.random;
    return (
      eff.kind === "putDiscardOnDraw" ||
      eff.kind === "putHandOnDraw" ||
      eff.kind === "exhaustChosen" ||
      eff.kind === "replayChosenSkill" ||
      eff.kind === "duplicateChosen" ||
      eff.kind === "discover"
    );
  }

  // Skills eligible to be replayed by Decisions, Decisions: a Skill that needs no
  // target (self/none) and contains no nested interactive choice (so replaying it
  // can't pause again). Keeps the replay simple and safe.
  private replayableSkills(p: InternalPlayer): CardInstance[] {
    return p.hand.filter((c) => {
      const d = resolveCard(c.id, c.upgraded);
      if (!d || d.type !== "skill") return false;
      if (d.target !== "self" && d.target !== "none") return false;
      if (!isCardSupported(d)) return false;
      return !d.effects.some((e) => this.isChoiceEffect(e));
    });
  }

  // Begin a card selection. Returns true if the engine is now paused waiting for
  // the player; false if it auto-resolved (≤pick eligible) or was skipped (none).
  private beginChoice(
    eff: Effect,
    source: InternalPlayer,
    targets: string[],
    def: CardDef,
    remaining: Effect[],
    instUid?: string,
  ): boolean {
    if (!this.isChoiceEffect(eff)) return false;
    // Discover is special: the options are generated, not taken from a pile.
    if (eff.kind === "discover") {
      return this.beginDiscover(eff, source, targets, def, remaining, instUid);
    }
    const kind: ChoiceKind =
      eff.kind === "replayChosenSkill" ? "replaySkill" : eff.kind === "discard" ? "discardChosen" : eff.kind;
    const replayTimes = eff.kind === "replayChosenSkill" ? eff.times : undefined;
    const dupAmount = eff.kind === "duplicateChosen" ? eff.amount : undefined;
    const sourcePile: "hand" | "discard" = kind === "putDiscardOnDraw" ? "discard" : "hand";
    // The eligible pool: replaySkill is limited to replayable Skills in hand;
    // duplicateChosen may be restricted to Colorless (neutral) cards.
    let eligible =
      kind === "replaySkill"
        ? this.replayableSkills(source)
        : sourcePile === "discard"
          ? source.discard.slice()
          : source.hand.slice();
    if (eff.kind === "duplicateChosen" && eff.colorlessOnly) {
      eligible = eligible.filter((c) => resolveCard(c.id, c.upgraded)?.character === "neutral");
    }
    if (eligible.length === 0) return false; // nothing to choose; skip silently
    // replaySkill and duplicateChosen pick exactly one card; others pick `amount`.
    const pick =
      kind === "replaySkill" || kind === "duplicateChosen"
        ? 1
        : Math.min((eff as { amount: number }).amount, eligible.length);
    if (eligible.length <= pick) {
      // Forced selection of everything eligible; resolve immediately.
      this.performChoice(kind, source, eligible.map((c) => c.uid), replayTimes, dupAmount);
      return false;
    }
    this.pendingChoice = {
      playerId: source.id,
      kind,
      source: sourcePile,
      prompt: this.choicePrompt(kind, pick),
      pick,
      remaining,
      effSource: source,
      targets,
      def,
      instUid,
      replayTimes,
      dupAmount,
    };
    return true;
  }

  // Begin a Discover: generate `amount` distinct random cards from the pool and
  // pause for the player to pick `pick` of them (added to `pile`). If the pool is
  // small, generate as many distinct cards as it allows; if there's nothing to
  // pick from, skip silently.
  private beginDiscover(
    eff: Extract<Effect, { kind: "discover" }>,
    source: InternalPlayer,
    targets: string[],
    def: CardDef,
    remaining: Effect[],
    instUid?: string,
  ): boolean {
    const want = eff.amount ?? 3;
    const pick = eff.pick ?? 1;
    const pile = eff.pile ?? "hand";
    const pool = cardsForCharacter(eff.character).slice();
    if (pool.length === 0) return false;
    // Draw distinct cards from the pool (without replacement) for the options.
    const options: CardInstance[] = [];
    const chosenIds = new Set<string>();
    let guard = 0;
    while (options.length < want && chosenIds.size < pool.length && guard++ < 200) {
      const cand = pool[Math.floor(this.rng() * pool.length)];
      if (chosenIds.has(cand.id)) continue;
      chosenIds.add(cand.id);
      options.push({ uid: uid("disc"), id: cand.id, upgraded: false });
    }
    if (options.length === 0) return false;
    const effectivePick = Math.min(pick, options.length);
    if (options.length <= effectivePick) {
      // No real choice (pool too small) — add them all and continue.
      this.discoverAdd(source, options, pile);
      return false;
    }
    this.pendingChoice = {
      playerId: source.id,
      kind: "discover",
      source: "discover",
      prompt: `Discover a card${pile === "draw" ? " (to the top of your draw pile)" : ""}`,
      pick: effectivePick,
      remaining,
      effSource: source,
      targets,
      def,
      instUid,
      options,
      discoverPile: pile,
    };
    return true;
  }

  // Add the discovered (chosen) cards to the destination pile.
  private discoverAdd(p: InternalPlayer, cards: CardInstance[], pile: "draw" | "hand"): void {
    const dest = pile === "draw" ? p.draw : p.hand;
    for (const c of cards) dest.push(c);
    this.onCardCreated(p, cards.length);
    const names = cards.map((c) => resolveCard(c.id, c.upgraded)?.name ?? c.id).join(", ");
    const where = pile === "draw" ? "the top of their draw pile" : "their hand";
    this.pushLog(`✦ ${p.name} discovers ${names} to ${where}.`);
  }

  private choicePrompt(kind: ChoiceKind, pick: number): string {
    const n = pick > 1 ? `${pick} cards` : "a card";
    switch (kind) {
      case "putDiscardOnDraw":
        return `Choose ${n} from your discard to put on top of your draw pile`;
      case "putHandOnDraw":
        return `Choose ${n} from your hand to put on top of your draw pile`;
      case "exhaustChosen":
        return `Choose ${n} to Exhaust`;
      case "discardChosen":
        return `Choose ${n} to discard`;
      case "replaySkill":
        return `Choose a Skill to play again`;
      case "duplicateChosen":
        return `Choose a card to copy into your hand`;
      case "discover":
        return `Discover a card`;
    }
  }

  // Carry out the chosen movement. `uids` are already validated by the caller.
  private performChoice(
    kind: ChoiceKind,
    source: InternalPlayer,
    uids: string[],
    replayTimes?: number,
    dupAmount?: number,
  ): void {
    if (kind === "duplicateChosen") {
      // Copy the chosen card(s) into hand without removing the original.
      const n = dupAmount ?? 1;
      for (const u of uids) {
        const orig = source.hand.find((c) => c.uid === u);
        if (!orig) continue;
        const d = resolveCard(orig.id, orig.upgraded);
        for (let i = 0; i < n; i++) {
          source.hand.push({ uid: uid("c"), id: orig.id, upgraded: orig.upgraded });
        }
        this.pushLog(`✦ ${source.name} copies ${d?.name ?? orig.id}${n > 1 ? ` ×${n}` : ""} into their hand.`);
      }
      return;
    }
    const pile = kind === "putDiscardOnDraw" ? source.discard : source.hand;
    const chosen: CardInstance[] = [];
    for (const u of uids) {
      const idx = pile.findIndex((c) => c.uid === u);
      if (idx !== -1) chosen.push(pile.splice(idx, 1)[0]);
    }
    if (chosen.length === 0) return;
    if (kind === "replaySkill") {
      // Decisions, Decisions: play the chosen Skill `replayTimes` times. The card
      // has been removed from hand above; resolve its effects, then discard/exhaust.
      const c = chosen[0];
      const d = resolveCard(c.id, c.upgraded)!;
      const tgts = d.target === "self" ? [source.id] : [];
      const times = replayTimes ?? 1;
      for (let i = 0; i < times; i++) {
        for (const e of d.effects) this.applyEffect(e, source, tgts, d, c.uid);
      }
      if (d.exhaust) this.exhaustCard(source, c);
      else source.discard.push(c);
      this.pushLog(`✦ ${source.name} plays ${d.name} ${times} times.`);
      return;
    }
    if (kind === "discardChosen") {
      for (const c of chosen) this.discardCard(source, c); // Sly cards auto-play
      source.discardsThisTurn += chosen.length;
      const names = chosen.map((c) => resolveCard(c.id, c.upgraded)?.name ?? c.id).join(", ");
      this.pushLog(`✦ ${source.name} discards ${names}.`);
    } else if (kind === "exhaustChosen") {
      for (const c of chosen) this.exhaustCard(source, c);
      const names = chosen.map((c) => resolveCard(c.id, c.upgraded)?.name ?? c.id).join(", ");
      this.pushLog(`✦ ${source.name} exhausts ${names}.`);
    } else {
      // Put on TOP of the draw pile = end of the array (drawCards pops from the end).
      for (const c of chosen) source.draw.push(c);
      const names = chosen.map((c) => resolveCard(c.id, c.upgraded)?.name ?? c.id).join(", ");
      this.pushLog(`✦ ${source.name} puts ${names} on top of their draw pile.`);
    }
  }

  /** Resolve a pending card-selection prompt. Returns null on success or an error. */
  resolveChoice(playerId: string, uids: string[]): string | null {
    const pc = this.pendingChoice;
    if (!pc) return "No card selection is pending.";
    if (pc.playerId !== playerId) return "It is not your selection to make.";
    // Discover validates against the generated options, not a pile.
    const candidatePool =
      pc.source === "discover" ? pc.options ?? [] : pc.source === "discard" ? pc.effSource.discard : pc.effSource.hand;
    const valid = [...new Set(uids)].filter((u) => candidatePool.some((c) => c.uid === u));
    if (valid.length !== pc.pick) return `Choose exactly ${pc.pick} card${pc.pick > 1 ? "s" : ""}.`;
    const { kind, effSource, remaining, targets, def, instUid, replayTimes, dupAmount } = pc;
    this.pendingChoice = null;
    if (kind === "discover") {
      const picked = (pc.options ?? []).filter((c) => valid.includes(c.uid));
      this.discoverAdd(effSource, picked, pc.discoverPile ?? "hand");
    } else {
      this.performChoice(kind, effSource, valid, replayTimes, dupAmount);
    }
    // Continue the rest of the played card's effects (which may pause again).
    const paused = this.applyEffectList(remaining, effSource, targets, def, instUid);
    if (paused) return null;
    this.finishPlay(effSource, def);
    return null;
  }

  // ----------------------------------------------------------------- effects

  private applyEffect(
    eff: Effect,
    source: InternalPlayer,
    targets: string[],
    def: CardDef,
    instUid?: string,
  ): void {
    switch (eff.kind) {
      case "damage": {
        // Grand Finale: only lands if the caster's draw pile is empty.
        if (eff.onlyIfDrawEmpty && source.draw.length > 0) break;
        // Perfected Strike: +damage for each "Strike" card across the source's deck.
        const strikeBonus = eff.perStrike ? eff.perStrike * this.countStrikeCards(source) : 0;
        // Rampage: this card instance hits harder each time it's played this combat.
        let rampageBonus = 0;
        if (eff.rampage && instUid) {
          rampageBonus = this.rampageStacks.get(instUid) ?? 0;
          this.rampageStacks.set(instUid, rampageBonus + eff.rampage);
        }
        // Crescent Spear: +N damage per Star Energy card in hand.
        const starCardBonus = eff.perStarCard ? eff.perStarCard * this.countStarCards(source) : 0;
        // Lunar Blast / Radiate / Supermassive: scale off per-turn or per-combat counters.
        const skillBonus = eff.perSkillThisTurn ? eff.perSkillThisTurn * source.skillsThisTurn : 0;
        const starGainBonus = eff.perStarGainedThisTurn ? eff.perStarGainedThisTurn * source.starsGainedThisTurn : 0;
        const createdBonus = eff.perCardCreatedThisCombat
          ? eff.perCardCreatedThisCombat * source.cardsCreatedThisCombat
          : 0;
        // Vigor: a one-shot bonus to the next Attack, consumed when it's played.
        const vigor = source.powers.get("vigor") ?? 0;
        if (vigor > 0) source.powers.delete("vigor");
        // Accuracy: Shivs deal extra damage.
        const accuracyBonus = def.id === "shiv" ? (source.powers.get("accuracy") ?? 0) : 0;
        // Kingly Punch: this instance has grown each time it was drawn this combat.
        const drawBonus = instUid ? this.drawDamageBonus.get(instUid) ?? 0 : 0;
        // Soul Storm: +damage per Soul card in your Exhaust pile.
        const soulBonus = eff.perSoulInExhaust
          ? eff.perSoulInExhaust * source.exhaust.filter((c) => c.id === "soul").length
          : 0;
        const base =
          eff.amount + strikeBonus + rampageBonus + starCardBonus + skillBonus + starGainBonus + createdBonus + vigor + accuracyBonus + drawBonus + soulBonus;
        // Monarch's Gaze: attacking an enemy saps 1 Strength from it this turn.
        const gaze = source.powers.get("monarchs_gaze") ?? 0;
        for (const tid of targets) {
          const tgt = this.players.get(tid);
          if (!tgt) continue;
          // Freeze damage now so it reflects buffs/debuffs at THIS point in the
          // turn — not whatever lands later.
          this.pending.push({
            uid: uid("atk"),
            sourceId: source.id,
            targetId: tid,
            cardName: def.name,
            perHit: this.computeDamage(base, source, tgt, true, eff.strengthMul ?? 1),
            times: eff.times ?? 1,
            lifesteal: eff.lifesteal,
            maxHpOnKill: eff.maxHpOnKill,
            starsOnKill: eff.starsOnKill,
          });
          if (gaze > 0 && tid !== source.id) {
            tgt.powers.set("strength", (tgt.powers.get("strength") ?? 0) - 1);
          }
        }
        break;
      }
      case "damagePerX": {
        // Heavenly Drill / Stardust: deal `amount` damage X times, where X is the
        // resource spent on this card (energy for cost "X", all Stars for starCost -1).
        let times = source.xThisPlay;
        if (eff.doubleAt !== undefined && times >= eff.doubleAt) times *= 2;
        for (let h = 0; h < times; h++) {
          // randomTarget (Stardust): each hit picks a fresh random living enemy.
          let tid: string | undefined;
          if (eff.randomTarget) {
            const enemies = this.order
              .map((id) => this.players.get(id)!)
              .filter((q) => q.alive && q.id !== source.id);
            if (enemies.length === 0) break;
            tid = enemies[Math.floor(this.rng() * enemies.length)].id;
          } else {
            tid = targets[0];
          }
          const tgt = tid ? this.players.get(tid) : undefined;
          if (!tgt) continue;
          this.pending.push({
            uid: uid("atk"),
            sourceId: source.id,
            targetId: tgt.id,
            cardName: def.name,
            perHit: this.computeDamage(eff.amount, source, tgt, true),
            times: 1,
          });
        }
        break;
      }
      case "damageEqualToBlock": {
        for (const tid of targets) {
          const tgt = this.players.get(tid);
          if (!tgt) continue;
          this.pending.push({
            uid: uid("atk"),
            sourceId: source.id,
            targetId: tid,
            cardName: def.name,
            // Snapshot the source's current block now: later cards can't change it.
            perHit: this.computeDamage(Math.max(0, source.block), source, tgt, false),
            times: 1,
          });
        }
        break;
      }
      case "damageEqualToTargetDoom": {
        // Time's Up: deal damage equal to the target's current Doom.
        for (const tid of targets) {
          const tgt = this.players.get(tid);
          if (!tgt) continue;
          const doom = tgt.powers.get("doom") ?? 0;
          if (doom <= 0) continue;
          this.pending.push({
            uid: uid("atk"),
            sourceId: source.id,
            targetId: tid,
            cardName: def.name,
            perHit: this.computeDamage(doom, source, tgt, false),
            times: 1,
          });
        }
        break;
      }
      case "block": {
        const amt = this.gainBlock(source, eff.amount, def.name);
        void amt;
        break;
      }
      case "doubleBlock": {
        // Entrench: double current Block (ignores Dexterity/Frail; it's a multiply).
        const extra = source.block;
        if (extra > 0) {
          source.block += extra;
          this.blockEvents.push({ playerId: source.id, playerName: source.name, cardName: def.name, amount: extra });
        }
        break;
      }
      case "doubleStrength": {
        // Limit Break: double current Strength.
        const str = source.powers.get("strength") ?? 0;
        if (str !== 0) source.powers.set("strength", str * 2);
        break;
      }
      case "applyPower": {
        const recipients = eff.to === "self" ? [source.id] : targets;
        for (const rid of recipients) {
          const r = this.players.get(rid);
          if (!r) continue;
          const pdef = getPower(eff.power); // validates / logs unknown power ids
          // Artifact negates incoming debuffs (one charge per debuff). Bookkeeping
          // powers (temporary stat trackers) are exempt.
          const isBookkeeping =
            eff.power === "strength_down" ||
            eff.power === "dexterity_down" ||
            eff.power === "thorns_down";
          if (pdef.kind === "debuff" && !isBookkeeping && eff.amount > 0 && (r.powers.get("artifact") ?? 0) > 0) {
            r.powers.set("artifact", (r.powers.get("artifact") ?? 0) - 1);
            if ((r.powers.get("artifact") ?? 0) <= 0) r.powers.delete("artifact");
            this.pushLog(`✦ ${r.name}'s Artifact negates ${pdef.name}.`);
            continue;
          }
          r.powers.set(eff.power, (r.powers.get(eff.power) ?? 0) + eff.amount);
          // Signal status changes explicitly so every player can follow them in
          // the event log (debuffs from cards/bosses especially).
          if (isBookkeeping) {
            // Temporary stat trackers; the visible Strength/Thorns line covers it.
          } else if (eff.amount < 0) {
            // e.g. Disarm / Dark Shackles reduce a stat.
            this.pushLog(`☠ ${r.name} loses ${Math.abs(eff.amount)} ${pdef.name}${rid === source.id ? "" : ` (from ${source.name})`}.`);
          } else if (pdef.kind === "debuff") {
            this.pushLog(`☠ ${r.name} gains ${eff.amount} ${pdef.name}${rid === source.id ? "" : ` (from ${source.name})`}.`);
          } else {
            this.pushLog(`✦ ${r.name} gains ${eff.amount} ${pdef.name}.`);
          }
        }
        // Shroud: gain Block whenever you apply Doom; mark it for Death's Door.
        if (eff.power === "doom" && eff.amount > 0) {
          source.doomAppliedThisTurn = true;
          const shroud = source.powers.get("shroud") ?? 0;
          if (shroud > 0) this.gainBlock(source, shroud, "Shroud");
        }
        break;
      }
      case "draw":
        this.drawCards(source, eff.amount);
        break;
      case "gainEnergy":
        if (eff.doubleCurrent) source.energy *= 2;
        else source.energy += eff.amount;
        break;
      case "heal":
        this.heal(source, eff.amount);
        break;
      case "loseHp": {
        source.hp = Math.max(0, source.hp - eff.amount);
        if (eff.amount > 0) source.hpLossCount++;
        // Rupture: losing HP from a card grants Strength.
        const rupture = source.powers.get("rupture") ?? 0;
        if (rupture > 0 && eff.amount > 0) {
          source.powers.set("strength", (source.powers.get("strength") ?? 0) + rupture);
          this.pushLog(`✦ ${source.name} gains ${rupture} Strength (Rupture).`);
        }
        break;
      }
      case "addCardToPile": {
        for (let i = 0; i < eff.amount; i++) {
          const c: CardInstance = { uid: uid("c"), id: eff.cardId, upgraded: false };
          if (eff.pile === "hand") source.hand.push(c);
          else if (eff.pile === "draw") source.draw.push(c);
          else source.discard.push(c);
        }
        if (eff.amount > 0) this.onCardCreated(source, eff.amount);
        break;
      }
      case "discard": {
        // A chosen discard is handled by the choice machinery; this branch runs
        // for random discards (e.g. All-Out Attack).
        for (let i = 0; i < eff.amount && source.hand.length > 0; i++) {
          const idx = Math.floor(this.rng() * source.hand.length);
          const [c] = source.hand.splice(idx, 1);
          source.discardsThisTurn++;
          const cdef = resolveCard(c.id, c.upgraded);
          this.pushLog(`✦ ${source.name} discards ${cdef?.name ?? c.id}.`);
          this.discardCard(source, c); // Sly cards auto-play instead
        }
        break;
      }
      case "discardHandDraw": {
        // Calculated Gamble: discard your whole hand, then draw that many cards.
        const n = source.hand.length;
        if (n > 0) {
          const hand = source.hand;
          source.hand = [];
          source.discardsThisTurn += n;
          this.pushLog(`✦ ${source.name} discards their hand (${n}).`);
          for (const c of hand) this.discardCard(source, c); // Sly cards auto-play
          this.drawCards(source, n);
        }
        break;
      }
      case "discardNonAttacks": {
        // Unload: discard every non-Attack card from hand.
        const keep: CardInstance[] = [];
        const dumped: CardInstance[] = [];
        for (const c of source.hand) {
          const cdef = resolveCard(c.id, c.upgraded);
          if (cdef && cdef.type !== "attack") dumped.push(c);
          else keep.push(c);
        }
        source.hand = keep;
        for (const c of dumped) this.discardCard(source, c); // Sly cards auto-play
        source.discardsThisTurn += dumped.length;
        if (dumped.length > 0) {
          const names = dumped.map((c) => resolveCard(c.id, c.upgraded)?.name ?? c.id).join(", ");
          this.pushLog(`✦ ${source.name} discards non-Attacks: ${names}.`);
        }
        break;
      }
      case "multiplyTargetPoison": {
        // Catalyst: multiply each target's current Poison.
        for (const tid of targets) {
          const t = this.players.get(tid);
          if (!t) continue;
          const cur = t.powers.get("poison") ?? 0;
          if (cur > 0) {
            const next = cur * eff.factor;
            t.powers.set("poison", next);
            this.pushLog(`☠ ${t.name}'s Poison rises to ${next}.`);
          }
        }
        break;
      }
      case "gainStars":
        this.gainStars(source, eff.amount);
        break;
      case "channelOrb": {
        const n = eff.amount ?? 1;
        for (let i = 0; i < n; i++) this.channelOrb(source, eff.orb);
        break;
      }
      case "evokeOrb":
        this.evokeRightmostOrb(source, eff.times ?? 1);
        break;
      case "evokeAllOrbs": {
        // Evoke every orb, then remove them all (e.g. Shatter).
        const times = eff.times ?? 1;
        const all = source.orbs;
        source.orbs = [];
        for (const orb of all) for (let i = 0; i < times; i++) this.evokeOrbEffect(source, orb);
        break;
      }
      case "gainOrbSlots":
        source.usesOrbs = true;
        source.orbSlots += eff.amount;
        this.pushLog(`✦ ${source.name} gains ${eff.amount} Orb slot${eff.amount > 1 ? "s" : ""}.`);
        break;
      case "summon":
        this.summonOsty(source, eff.amount);
        break;
      case "ostyDamage": {
        // Osty strikes for a flat amount plus a fraction of his Max HP.
        const dmg = eff.amount + Math.floor((eff.perOstyMaxHp ?? 0) * source.ostyMaxHp);
        for (const tid of targets) {
          const tgt = this.players.get(tid);
          if (!tgt) continue;
          this.pending.push({
            uid: uid("atk"),
            sourceId: source.id,
            targetId: tid,
            cardName: `${def.name} (Osty)`,
            perHit: this.computeDamage(dmg, source, tgt, false),
            times: 1,
          });
        }
        break;
      }
      case "applyDoom": {
        for (const tid of targets) {
          const t = this.players.get(tid);
          if (!t) continue;
          const existing = t.powers.get("doom") ?? 0;
          let amt = eff.amount;
          if (eff.perExistingTen) amt += eff.perExistingTen * Math.floor(existing / 10);
          if (eff.perCardThisTurn) amt += eff.perCardThisTurn * source.cardsPlayedThisTurn;
          // Delegate to applyPower so Artifact negation, Shroud, and logging apply.
          if (amt > 0) {
            this.applyEffect({ kind: "applyPower", power: "doom", amount: amt, to: "enemy" }, source, [tid], def, instUid);
          }
        }
        break;
      }
      case "upgradeAllCards": {
        // Apotheosis: upgrade every card across hand, draw, and discard piles.
        for (const pile of [source.hand, source.draw, source.discard]) {
          for (const c of pile) c.upgraded = true;
        }
        this.pushLog(`✦ ${source.name} upgrades all their cards.`);
        break;
      }
      case "healOsty":
        if (source.ostyMaxHp > 0) {
          source.ostyHp = Math.min(source.ostyMaxHp, source.ostyHp + eff.amount);
        }
        break;
      case "loseHpTarget": {
        // Direct HP loss, ignoring Block (e.g. Capture Spirit).
        for (const tid of targets) {
          const t = this.players.get(tid);
          if (!t) continue;
          t.hp = Math.max(0, t.hp - eff.amount);
          this.pushLog(`☠ ${t.name} loses ${eff.amount} HP.`);
        }
        this.checkDeaths();
        break;
      }
      case "exhaustFromDraw": {
        for (let i = 0; i < eff.amount && source.draw.length > 0; i++) {
          const c = source.draw.pop()!;
          this.exhaustCard(source, c);
        }
        break;
      }
      case "triggerDarkPassive": {
        const focus = source.powers.get("focus") ?? 0;
        const times = eff.times ?? 1;
        for (const orb of source.orbs) {
          if (orb.type === "dark") orb.amount += Math.max(0, 6 + focus) * times;
        }
        break;
      }
      case "ifDoomAppliedThisTurn":
        if (source.doomAppliedThisTurn) {
          for (const sub of eff.then) this.applyEffect(sub, source, targets, def, instUid);
        }
        break;
      case "sacrificeOsty": {
        if (source.ostyMaxHp > 0) {
          const block = Math.floor(eff.blockPerMaxHp * source.ostyMaxHp);
          this.gainBlock(source, block, def.name);
          this.pushLog(`✦ ${source.name} sacrifices Osty for ${block} Block.`);
          source.ostyHp = 0;
          source.ostyMaxHp = 0;
        }
        break;
      }
      case "forge": {
        const otherAttacks = Math.max(0, source.attacksThisTurn - 1);
        const amount = eff.amount + (eff.perOtherAttackThisTurn ?? 0) * otherAttacks;
        this.forge(source, amount);
        this.pushLog(`✦ ${source.name} forges ${amount} (Sovereign Blade: ${source.forge}).`);
        break;
      }
      case "sovereignBladeDamage": {
        // The Sovereign Blade strikes for the caster's accumulated Forge.
        const vigor = source.powers.get("vigor") ?? 0;
        if (vigor > 0) source.powers.delete("vigor");
        // Seeking Edge: the Blade hits every enemy. Sword Sage: extra hits.
        const hitsAll = (source.powers.get("seeking_edge") ?? 0) > 0;
        const bladeTargets = hitsAll ? this.aliveEnemies(source.id) : targets;
        const times = 1 + (source.powers.get("sword_sage") ?? 0);
        for (const tid of bladeTargets) {
          const tgt = this.players.get(tid);
          if (!tgt) continue;
          this.pending.push({
            uid: uid("atk"),
            sourceId: source.id,
            targetId: tid,
            cardName: def.name,
            perHit: this.computeDamage(source.forge + vigor, source, tgt, true),
            times,
          });
        }
        break;
      }
      case "doubleForge": {
        // Conqueror: double the Sovereign Blade's damage.
        source.forge *= 2;
        this.grantSovereignBlade(source);
        this.pushLog(`✦ ${source.name}'s Forge doubles to ${source.forge}.`);
        break;
      }
      case "transformHand": {
        // BEGONE!!: transform random cards in hand into copies of `into`.
        let made = 0;
        for (let i = 0; i < eff.amount && source.hand.length > 0; i++) {
          const idx = Math.floor(this.rng() * source.hand.length);
          source.hand.splice(idx, 1);
          source.hand.push({ uid: uid("c"), id: eff.into, upgraded: false });
          made++;
        }
        if (made > 0) {
          this.onCardCreated(source, made);
          const into = resolveCard(eff.into, false)?.name ?? eff.into;
          this.pushLog(`✦ ${source.name} transforms ${made} card${made > 1 ? "s" : ""} into ${into}.`);
        }
        break;
      }
      case "transformDraw": {
        // CHARGE!!!: transform random cards in the draw pile into copies of `into`.
        let made = 0;
        for (let i = 0; i < eff.amount && source.draw.length > 0; i++) {
          const idx = Math.floor(this.rng() * source.draw.length);
          source.draw.splice(idx, 1);
          source.draw.push({ uid: uid("c"), id: eff.into, upgraded: false });
          made++;
        }
        if (made > 0) {
          this.onCardCreated(source, made);
          const into = resolveCard(eff.into, false)?.name ?? eff.into;
          this.pushLog(`✦ ${source.name} transforms ${made} draw-pile card${made > 1 ? "s" : ""} into ${into}.`);
        }
        break;
      }
      case "addRandomCards": {
        // Bundle of Joy / Manifest Authority / Spectrum Shift: add random Colorless cards.
        this.addRandomCardsToPile(source, eff.character, eff.amount, eff.pile);
        break;
      }
      case "fillHandWith": {
        // Crash Landing: fill the hand with copies of a card (e.g. Debris).
        const name = resolveCard(eff.cardId, false)?.name ?? eff.cardId;
        let made = 0;
        while (source.hand.length < HAND_SIZE) {
          source.hand.push({ uid: uid("c"), id: eff.cardId, upgraded: false });
          made++;
        }
        if (made > 0) {
          this.onCardCreated(source, made);
          this.pushLog(`✦ ${source.name}'s hand fills with ${made} ${name}.`);
        }
        break;
      }
      case "nextTurnBonus": {
        // Convergence / Glow / Refine Blade / Hidden Cache / Hegemony / Glitterstream:
        // queue resources for next turn and optionally retain hand.
        if (eff.energy) source.nextTurnEnergy += eff.energy;
        if (eff.stars) source.nextTurnStars += eff.stars;
        if (eff.block) source.nextTurnBlock += eff.block;
        if (eff.draw) source.nextTurnDraw += eff.draw;
        if (eff.retainHand) source.retainHandOnce = true;
        const bits = [
          eff.energy ? `${eff.energy} Energy` : "",
          eff.stars ? `${eff.stars} Star Energy` : "",
          eff.block ? `${eff.block} Block` : "",
          eff.draw ? `draw ${eff.draw}` : "",
        ].filter(Boolean);
        this.pushLog(
          `✦ ${source.name} queues a bonus${bits.length ? ` (next turn: ${bits.join(", ")})` : ""}${
            eff.retainHand ? "; retains hand" : ""
          }.`,
        );
        break;
      }
      case "returnThisCard": {
        // Particle Wall returns to hand; Shining Strike to the top of the draw pile.
        // The card has already been moved to discard/exhaust by playCard; pull it back.
        if (instUid) {
          const from = [source.discard, source.exhaust, source.draw];
          for (const pile of from) {
            const i = pile.findIndex((c) => c.uid === instUid);
            if (i !== -1) {
              const [c] = pile.splice(i, 1);
              if (eff.to === "hand") source.hand.push(c);
              else source.draw.push(c);
              break;
            }
          }
        }
        break;
      }
      case "summonBlade": {
        // Summon Forth: pull the Sovereign Blade into hand from anywhere (forging it
        // if it doesn't exist yet).
        this.grantSovereignBlade(source);
        for (const pile of [source.draw, source.discard, source.exhaust]) {
          const i = pile.findIndex((c) => c.id === "sovereign_blade");
          if (i !== -1) {
            const [c] = pile.splice(i, 1);
            source.hand.push(c);
            break;
          }
        }
        break;
      }
      case "exhaustRandom": {
        // True Grit: exhaust N random cards from the rest of the hand.
        for (let i = 0; i < eff.amount && source.hand.length > 0; i++) {
          const idx = Math.floor(this.rng() * source.hand.length);
          const [c] = source.hand.splice(idx, 1);
          const cdef = resolveCard(c.id, c.upgraded);
          this.pushLog(`✦ ${source.name} exhausts ${cdef?.name ?? c.id}.`);
          this.exhaustCard(source, c);
        }
        break;
      }
      case "exhaustNonAttacks": {
        // Sever Soul: exhaust every non-attack card in hand. Second Wind also gains
        // Block per card exhausted. Take a snapshot so exhaust hooks that draw
        // (Dark Embrace) don't disturb the iteration.
        const original = source.hand;
        source.hand = [];
        const keptAttacks: CardInstance[] = [];
        let exhausted = 0;
        for (const c of original) {
          const cdef = resolveCard(c.id, c.upgraded);
          if (cdef && cdef.type !== "attack") {
            exhausted++;
            this.exhaustCard(source, c);
          } else keptAttacks.push(c);
        }
        source.hand.unshift(...keptAttacks);
        if (exhausted > 0) this.pushLog(`✦ ${source.name} exhausts ${exhausted} non-attack card${exhausted > 1 ? "s" : ""}.`);
        if (eff.blockPerCard && exhausted > 0) this.gainBlock(source, eff.blockPerCard * exhausted, def.name);
        break;
      }
      case "exhaustHandForDamage": {
        // Fiend Fire: exhaust the whole remaining hand, then deal damage per card.
        const original = source.hand;
        source.hand = [];
        const exhausted = original.length;
        for (const c of original) this.exhaustCard(source, c);
        if (exhausted > 0) this.pushLog(`✦ ${source.name} exhausts ${exhausted} card${exhausted > 1 ? "s" : ""} (${def.name}).`);
        const dmg = eff.perCard * exhausted;
        if (dmg > 0) {
          for (const tid of targets) {
            const tgt = this.players.get(tid);
            if (!tgt) continue;
            this.pending.push({
              uid: uid("atk"),
              sourceId: source.id,
              targetId: tid,
              cardName: def.name,
              perHit: this.computeDamage(dmg, source, tgt, true),
              times: 1,
            });
          }
        }
        break;
      }
      case "ifTargetHasPower": {
        // Dropkick: only run the rider if a target currently has the power.
        const hit = targets.some((tid) => (this.players.get(tid)?.powers.get(eff.power) ?? 0) > 0);
        if (hit) for (const sub of eff.then) this.applyEffect(sub, source, targets, def, instUid);
        break;
      }
      case "ifIncomingAttack": {
        // Spot Weakness (PvP stand-in): run the rider only if an opponent has
        // already queued an attack on you this turn.
        const incoming = this.pending.some((a) => a.targetId === source.id);
        if (incoming) for (const sub of eff.then) this.applyEffect(sub, source, targets, def, instUid);
        break;
      }
      case "putDiscardOnDraw":
      case "putHandOnDraw":
      case "exhaustChosen":
      case "replayChosenSkill":
      case "duplicateChosen":
      case "discover":
        // Interactive choices are intercepted by applyEffectList before reaching
        // here. (Only reached if nested in onExhaust/ifTargetHasPower, which our
        // cards avoid; treated as a no-op rather than pausing in those contexts.)
        break;
      case "unimplemented":
        reportMissing("effect", def.id, eff.note);
        break;
      default: {
        const _exhaustive: never = eff;
        reportMissing("effect", def.id, `unknown effect kind`);
        void _exhaustive;
      }
    }
  }

  private computeDamage(
    base: number,
    src: InternalPlayer,
    tgt: InternalPlayer,
    addStrength = true,
    strengthMul = 1,
  ): number {
    // Strength is excluded for block-scaling attacks (e.g. Body Slam), matching
    // StS. `strengthMul` lets cards like Heavy Blade count Strength multiple
    // times. Weak/Vulnerable still apply so a debuff landed earlier this turn
    // counts.
    let d = base + (addStrength ? (src.powers.get("strength") ?? 0) * strengthMul : 0);
    if ((src.powers.get("weak") ?? 0) > 0) d *= WEAK_MULT;
    if ((tgt.powers.get("vulnerable") ?? 0) > 0) d *= VULNERABLE_MULT;
    return Math.max(0, Math.floor(d));
  }

  private dealDamage(tgt: InternalPlayer, amount: number): { blocked: number; hp: number } {
    // Intangible caps any single instance of damage at 1.
    let remaining = (tgt.powers.get("intangible") ?? 0) > 0 ? Math.min(1, amount) : amount;
    let blocked = 0;
    if (tgt.block > 0) {
      blocked = Math.min(tgt.block, remaining);
      tgt.block -= blocked;
      remaining -= blocked;
    }
    if (remaining > 0) {
      tgt.hp = Math.max(0, tgt.hp - remaining);
      tgt.hpLossCount++; // Blood for Blood: cheaper for each HP-loss this combat.
      // Plated Armor loses a stack each time you take unblocked attack damage.
      const plated = tgt.powers.get("plated_armor") ?? 0;
      if (plated > 0) {
        if (plated - 1 <= 0) tgt.powers.delete("plated_armor");
        else tgt.powers.set("plated_armor", plated - 1);
      }
    }
    return { blocked, hp: remaining };
  }

  private heal(p: InternalPlayer, amount: number): void {
    p.hp = Math.min(p.maxHp, p.hp + amount);
  }

  // Block gain, accounting for Dexterity, Frail, and the No Block drawback.
  // Returns the amount actually gained and records it for the turn summary.
  private gainBlock(p: InternalPlayer, base: number, cardName: string): number {
    if ((p.powers.get("no_block") ?? 0) > 0) return 0;
    const dex = p.powers.get("dexterity") ?? 0;
    let amt = base + dex;
    if ((p.powers.get("frail") ?? 0) > 0) amt = Math.floor(amt * FRAIL_MULT);
    amt = Math.max(0, amt);
    if (amt <= 0) return 0;
    p.block += amt;
    p.blockedThisTurn = true;
    this.blockEvents.push({ playerId: p.id, playerName: p.name, cardName, amount: amt });
    return amt;
  }

  // ----------------------------------------------------------------- Regent

  /** Gain Star Energy. Fires Star-reactive powers (e.g. Black Hole). */
  private gainStars(p: InternalPlayer, amount: number): void {
    if (amount <= 0) return;
    p.stars += amount;
    p.usesStars = true;
    p.starsGainedThisTurn += amount;
    this.starReactive(p, amount);
  }

  /** Move the first card matching `cardId` from draw/discard into hand (Make It So). */
  private returnCardToHand(p: InternalPlayer, cardId: string): void {
    for (const pile of [p.discard, p.draw]) {
      const i = pile.findIndex((c) => c.id === cardId);
      if (i !== -1) {
        const [c] = pile.splice(i, 1);
        p.hand.push(c);
        const cdef = resolveCard(c.id, c.upgraded);
        this.pushLog(`✦ ${p.name} returns ${cdef?.name ?? c.id} to hand.`);
        return;
      }
    }
  }

  /** Track Energy spent this combat (Orbit refunds 1 per 4 spent). Energy is already
   *  deducted by the caller; this only handles combat tally + Orbit refunds. */
  private spendEnergy(p: InternalPlayer, amount: number): void {
    if (amount <= 0) return;
    const orbit = p.powers.get("orbit") ?? 0;
    if (orbit > 0) {
      const before = Math.floor(p.energySpentThisCombat / 4);
      const after = Math.floor((p.energySpentThisCombat + amount) / 4);
      const refund = (after - before) * orbit;
      if (refund > 0) {
        p.energy += refund;
        this.pushLog(`✦ ${p.name} refunds ${refund} Energy (Orbit).`);
      }
    }
    p.energySpentThisCombat += amount;
  }

  /** Spend Star Energy (already validated affordable). Fires Star-reactive powers. */
  private spendStars(p: InternalPlayer, amount: number): void {
    if (amount <= 0) return;
    p.stars = Math.max(0, p.stars - amount);
    // Child of the Stars: gain Block for each Star spent.
    const child = p.powers.get("child_of_the_stars") ?? 0;
    if (child > 0) this.gainBlock(p, child * amount, "Child of the Stars");
    // Relic reactions to spending Star Energy.
    for (const rid of p.relics) {
      const r = getRelic(rid);
      if (!r) continue;
      // Mini Regent: gain Strength the first time you spend Stars each turn.
      if (r.strengthOnFirstStarSpend && !p.spentStarsThisTurn) {
        p.powers.set("strength", (p.powers.get("strength") ?? 0) + r.strengthOnFirstStarSpend);
        this.pushLog(`✦ ${p.name} gains ${r.strengthOnFirstStarSpend} Strength (${r.name}).`);
      }
      // Galactic Dust: gain Block for every N Stars spent this combat.
      if (r.blockPerStarsSpent) {
        const { perStarsSpent, block } = r.blockPerStarsSpent;
        const before = Math.floor(p.starsSpentThisCombat / perStarsSpent);
        const after = Math.floor((p.starsSpentThisCombat + amount) / perStarsSpent);
        if (after > before) this.gainBlock(p, (after - before) * block, r.name);
      }
    }
    p.starsSpentThisCombat += amount;
    p.spentStarsThisTurn = true;
    this.starReactive(p, amount);
  }

  // Black Hole: deal damage to all enemies whenever Star Energy is spent or gained.
  private starReactive(p: InternalPlayer, _amount: number): void {
    const bh = p.powers.get("black_hole") ?? 0;
    if (bh <= 0) return;
    for (const eid of this.aliveEnemies(p.id)) {
      const tgt = this.players.get(eid)!;
      this.pending.push({
        uid: uid("atk"),
        sourceId: p.id,
        targetId: eid,
        cardName: "Black Hole",
        perHit: this.computeDamage(bh, p, tgt, false),
        times: 1,
      });
    }
  }

  // Bombardment: cards with `autoPlayFromExhaust` re-fire from the Exhaust pile at
  // the start of each of the owner's turns. Attacks pick a random living enemy.
  // I Am Invincible: at the end of the turn, while a card flagged
  // `playFromDrawIfTop` sits on top of the draw pile, play it (resolve its
  // effects, then discard or Exhaust it). The loop handles multiple stacked
  // copies that bubble up as each is removed.
  private autoPlayFromDrawTop(p: InternalPlayer): void {
    let guard = 0;
    while (guard++ < 50) {
      const top = p.draw[p.draw.length - 1];
      if (!top) break;
      const d = resolveCard(top.id, top.upgraded);
      if (!d?.playFromDrawIfTop) break;
      p.draw.pop();
      let targets: string[] = [];
      if (d.target === "enemy") {
        const enemies = this.aliveEnemies(p.id);
        targets = enemies.length ? [enemies[Math.floor(this.rng() * enemies.length)]] : [];
      } else if (d.target === "all_enemies") {
        targets = this.aliveEnemies(p.id);
      } else if (d.target === "self") {
        targets = [p.id];
      }
      this.pushLog(`✦ ${p.name}'s ${d.name} plays itself from the top of the draw pile.`);
      for (const e of d.effects) this.applyEffect(e, p, targets, d, top.uid);
      if (d.exhaust) this.exhaustCard(p, top);
      else p.discard.push(top);
    }
  }

  private autoPlayFromExhaust(p: InternalPlayer): void {
    for (const c of p.exhaust) {
      const d = resolveCard(c.id, c.upgraded);
      if (!d?.autoPlayFromExhaust) continue;
      let targets: string[] = [];
      if (d.target === "enemy") {
        const enemies = this.aliveEnemies(p.id);
        if (enemies.length === 0) continue;
        targets = [enemies[Math.floor(this.rng() * enemies.length)]];
      } else if (d.target === "all_enemies") {
        targets = this.aliveEnemies(p.id);
        if (targets.length === 0) continue;
      } else if (d.target === "self") {
        targets = [p.id];
      }
      this.pushLog(`✦ ${p.name}'s ${d.name} auto-fires from Exhaust.`);
      for (const e of d.effects) this.applyEffect(e, p, targets, d, c.uid);
    }
  }

  /** Forge: grow the Sovereign Blade's damage, granting the Blade on first use. */
  private forge(p: InternalPlayer, amount: number): void {
    if (amount <= 0) return;
    p.forge += amount;
    this.grantSovereignBlade(p);
  }

  // Ensure the player has a Sovereign Blade somewhere in their piles (added to
  // hand the first time they Forge this combat).
  private grantSovereignBlade(p: InternalPlayer): void {
    const piles = [p.hand, p.draw, p.discard, p.exhaust];
    const has = piles.some((pile) => pile.some((c) => c.id === "sovereign_blade"));
    if (has) return;
    p.hand.push({ uid: uid("c"), id: "sovereign_blade", upgraded: false });
    this.onCardCreated(p, 1);
    this.pushLog(`✦ ${p.name} forges the Sovereign Blade.`);
  }

  // ----------------------------------------------------------------- Defect orbs

  // Summon Osty with `amount` Max HP, or raise his Max HP if he already exists.
  private summonOsty(p: InternalPlayer, amount: number): void {
    if (amount <= 0) return;
    p.usesOsty = true;
    if (p.ostyMaxHp <= 0) {
      p.ostyMaxHp = amount;
      p.ostyHp = amount;
      this.pushLog(`✦ ${p.name} summons Osty (${amount} HP).`);
    } else {
      p.ostyMaxHp += amount;
      p.ostyHp += amount;
      this.pushLog(`✦ ${p.name}'s Osty grows by ${amount} HP (now ${p.ostyHp}/${p.ostyMaxHp}).`);
    }
  }

  private orbName(t: OrbType): string {
    return t === "lightning"
      ? "Lightning"
      : t === "frost"
        ? "Frost"
        : t === "dark"
          ? "Dark"
          : t === "glass"
            ? "Glass"
            : "Plasma";
  }

  // A freshly channeled orb's starting stored value. Dark charges up from 0; Glass
  // starts at 4 and decays; the rest don't use a stored value.
  private initialOrbAmount(type: OrbType): number {
    return type === "glass" ? 4 : 0;
  }

  // Channel a new orb. If the slots are full, the rightmost (most recently
  // channeled) orb is Evoked to make room (StS2 orb overflow).
  private channelOrb(p: InternalPlayer, type: OrbType): void {
    p.usesOrbs = true;
    if (p.orbs.length >= p.orbSlots && p.orbs.length > 0) {
      const evicted = p.orbs.pop()!;
      this.evokeOrbEffect(p, evicted);
    }
    p.orbs.push({ type, amount: this.initialOrbAmount(type) });
    this.pushLog(`✦ ${p.name} channels ${this.orbName(type)}.`);
  }

  // Evoke the RIGHTMOST (most recently channeled) orb `times`, then remove it
  // (Dualcast = twice, Quadcast = 4×). Note overflow eviction uses the oldest orb.
  private evokeRightmostOrb(p: InternalPlayer, times: number): void {
    const orb = p.orbs.pop();
    if (!orb) return;
    for (let i = 0; i < times; i++) this.evokeOrbEffect(p, orb);
  }

  // The Evoke (burst) effect of an orb. Lightning/Frost/Dark/Glass scale with Focus.
  private evokeOrbEffect(p: InternalPlayer, orb: { type: OrbType; amount: number }): void {
    const focus = p.powers.get("focus") ?? 0;
    switch (orb.type) {
      case "lightning":
        this.orbDamageRandomEnemy(p, Math.max(0, 8 + focus), "Lightning");
        break;
      case "frost":
        this.gainBlock(p, Math.max(0, 5 + focus), "Frost orb");
        break;
      case "dark":
        // Dark bursts its stored value at the lowest-HP enemy.
        if (orb.amount > 0) this.orbDamageLowestHpEnemy(p, orb.amount, "Dark");
        break;
      case "plasma":
        p.energy += 2;
        this.pushLog(`✦ ${p.name} evokes Plasma (+2 Energy).`);
        break;
      case "glass":
        // Glass bursts for double its current value (+Focus) to ALL enemies.
        this.orbDamageAllEnemies(p, Math.max(0, (orb.amount + focus) * 2), "Glass");
        break;
    }
  }

  // End-of-turn DAMAGE passives (Lightning). These fire BEFORE Block is cleared so
  // the target's current Block can still absorb the hit.
  private tickOrbDamage(p: InternalPlayer): void {
    const focus = p.powers.get("focus") ?? 0;
    for (const orb of p.orbs) {
      if (orb.type === "lightning") {
        this.orbDamageRandomEnemy(p, Math.max(0, 3 + focus), "Lightning");
      } else if (orb.type === "glass") {
        // Deal its current value (+Focus) to ALL enemies, then it decays by 1.
        this.orbDamageAllEnemies(p, Math.max(0, orb.amount + focus), "Glass");
        orb.amount = Math.max(0, orb.amount - 1);
      }
    }
  }

  // End-of-turn DEFENSE/utility passives (Frost Block, Dark charge, Plasma Energy).
  // These fire AFTER Block is cleared so Frost Block carries into the next turn.
  private tickOrbDefense(p: InternalPlayer): void {
    const focus = p.powers.get("focus") ?? 0;
    for (const orb of p.orbs) {
      switch (orb.type) {
        case "frost":
          this.gainBlock(p, Math.max(0, 2 + focus), "Frost orb");
          break;
        case "dark":
          orb.amount += Math.max(0, 6 + focus);
          break;
        case "plasma":
          p.nextTurnEnergy += 1;
          break;
        case "lightning":
        case "glass":
          break; // damage orbs handled in tickOrbDamage (before Block is cleared)
      }
    }
  }

  private orbDamageRandomEnemy(p: InternalPlayer, amount: number, label: string): void {
    if (amount <= 0) return;
    const enemies = this.aliveEnemies(p.id);
    if (enemies.length === 0) return;
    const targetId = enemies[Math.floor(this.rng() * enemies.length)];
    const tgt = this.players.get(targetId)!;
    const dealt = this.computeDamage(amount, p, tgt, false);
    this.dealDamage(tgt, dealt);
    this.pushLog(`✦ ${p.name}'s ${label} orb hits ${tgt.name} for ${dealt}.`);
    this.checkDeaths();
  }

  private orbDamageAllEnemies(p: InternalPlayer, amount: number, label: string): void {
    if (amount <= 0) return;
    for (const id of this.aliveEnemies(p.id)) {
      const tgt = this.players.get(id);
      if (!tgt) continue;
      this.dealDamage(tgt, this.computeDamage(amount, p, tgt, false));
    }
    this.pushLog(`✦ ${p.name}'s ${label} orb hits all enemies for ${amount}.`);
    this.checkDeaths();
  }

  private orbDamageLowestHpEnemy(p: InternalPlayer, amount: number, label: string): void {
    if (amount <= 0) return;
    const enemies = this.aliveEnemies(p.id)
      .map((id) => this.players.get(id)!)
      .sort((a, b) => a.hp - b.hp);
    const tgt = enemies[0];
    if (!tgt) return;
    const dealt = this.computeDamage(amount, p, tgt, false);
    this.dealDamage(tgt, dealt);
    this.pushLog(`✦ ${p.name}'s ${label} orb hits ${tgt.name} for ${dealt}.`);
    this.checkDeaths();
  }

  // Discard a card from hand as the result of a discard EFFECT this turn. Sly
  // cards (StS2) immediately play themselves for free instead of being discarded.
  private discardCard(p: InternalPlayer, c: CardInstance): void {
    const def = resolveCard(c.id, c.upgraded);
    if (def?.sly && this.phase === "action") this.slyAutoPlay(p, c, def);
    else p.discard.push(c);
  }

  // Auto-play a Sly card for free (no energy), then send it to discard/exhaust.
  private slyAutoPlay(p: InternalPlayer, c: CardInstance, def: CardDef): void {
    let targets: string[] = [];
    if (def.target === "enemy") {
      const e = this.aliveEnemies(p.id);
      targets = e.length ? [e[Math.floor(this.rng() * e.length)]] : [];
    } else if (def.target === "all_enemies") {
      targets = this.aliveEnemies(p.id);
    } else if (def.target === "self") {
      targets = [p.id];
    }
    this.pushLog(`✦ ${p.name}'s ${def.name} plays itself (Sly).`);
    for (const e of def.effects) this.applyEffect(e, p, targets, def, c.uid);
    p.cardsPlayedThisTurn += 1;
    if (def.exhaust) this.exhaustCard(p, c);
    else p.discard.push(c);
  }

  // Whenever you create a card: track the count and fire create-reactive powers
  // (Arsenal gains Strength, Pillar of Creation gains Block).
  private onCardCreated(p: InternalPlayer, count: number): void {
    if (count <= 0) return;
    p.cardsCreatedThisCombat += count;
    const arsenal = p.powers.get("arsenal") ?? 0;
    if (arsenal > 0) {
      p.powers.set("strength", (p.powers.get("strength") ?? 0) + arsenal * count);
      this.pushLog(`✦ ${p.name} gains ${arsenal * count} Strength (Arsenal).`);
    }
    const pillar = p.powers.get("pillar_of_creation") ?? 0;
    if (pillar > 0) this.gainBlock(p, pillar * count, "Pillar of Creation");
    // Regalite: gain Block whenever you create a card.
    for (const rid of p.relics) {
      const block = getRelic(rid)?.blockPerCardCreated ?? 0;
      if (block > 0) this.gainBlock(p, block * count, getRelic(rid)!.name);
    }
  }

  // Add `amount` random playable cards of a character/pool to a pile (Bundle of Joy,
  // Manifest Authority, Spectrum Shift). Fires create-reactive powers.
  private addRandomCardsToPile(
    p: InternalPlayer,
    character: CardDef["character"],
    amount: number,
    pile: "discard" | "draw" | "hand",
  ): void {
    const pool = cardsForCharacter(character);
    if (pool.length === 0 || amount <= 0) return;
    const dest = pile === "discard" ? p.discard : pile === "draw" ? p.draw : p.hand;
    let made = 0;
    for (let i = 0; i < amount; i++) {
      const pick = pool[Math.floor(this.rng() * pool.length)];
      dest.push({ uid: uid("c"), id: pick.id, upgraded: false });
      made++;
    }
    if (made > 0) {
      this.onCardCreated(p, made);
      const where = pile === "draw" ? "draw pile" : pile === "discard" ? "discard pile" : "hand";
      this.pushLog(`✦ ${p.name} adds ${made} random card${made > 1 ? "s" : ""} to ${where}.`);
    }
  }

  // How many "Star Energy cards" (cards with a Star cost) are in this hand.
  private countStarCards(p: InternalPlayer): number {
    return p.hand.filter((c) => (resolveCard(c.id, c.upgraded)?.starCost ?? 0) > 0).length;
  }

  // Flex-style temporary Strength: remove the tracked amount, then clear it. The
  // tracker can be negative (e.g. Dark Shackles temporarily REDUCES enemy Strength,
  // so end-of-turn we add it back). Strength may legitimately go negative.
  private expireTemporaryStrength(p: InternalPlayer): void {
    const down = p.powers.get("strength_down") ?? 0;
    if (down === 0) return;
    const str = (p.powers.get("strength") ?? 0) - down;
    if (str === 0) p.powers.delete("strength");
    else p.powers.set("strength", str);
    p.powers.delete("strength_down");
  }

  private expireTemporaryDexterity(p: InternalPlayer): void {
    const down = p.powers.get("dexterity_down") ?? 0;
    if (down <= 0) return;
    const dex = (p.powers.get("dexterity") ?? 0) - down;
    if (dex === 0) p.powers.delete("dexterity");
    else p.powers.set("dexterity", dex);
    p.powers.delete("dexterity_down");
  }

  // Flame Barrier-style temporary Thorns: remove the tracked amount at end of turn.
  private expireTemporaryThorns(p: InternalPlayer): void {
    const down = p.powers.get("thorns_down") ?? 0;
    if (down <= 0) return;
    const thorns = (p.powers.get("thorns") ?? 0) - down;
    if (thorns <= 0) p.powers.delete("thorns");
    else p.powers.set("thorns", thorns);
    p.powers.delete("thorns_down");
  }

  private decayPowers(p: InternalPlayer): void {
    for (const [id, stacks] of [...p.powers.entries()]) {
      const def = getPower(id);
      if (def.decaysPerTurn) {
        const next = stacks - 1;
        if (next <= 0) p.powers.delete(id);
        else p.powers.set(id, next);
      }
    }
  }

  // ----------------------------------------------------------------- helpers

  private resolveTargets(def: CardDef, sourceId: string, targetId?: string): string[] | null {
    switch (def.target) {
      case "self":
      case "none":
        return [sourceId];
      case "all_enemies":
        return this.order.filter((id) => id !== sourceId && this.players.get(id)!.alive);
      case "enemy": {
        if (!targetId) {
          // Auto-pick if exactly one living opponent.
          const enemies = this.order.filter((id) => id !== sourceId && this.players.get(id)!.alive);
          if (enemies.length === 1) return [enemies[0]];
          return null;
        }
        const t = this.players.get(targetId);
        if (!t || !t.alive || targetId === sourceId) return null;
        return [targetId];
      }
    }
  }

  // Extra play restrictions beyond cost/target (e.g. Clash needs an all-attack
  // hand). Returns an error string, or null if the card may be played.
  private playRestriction(p: InternalPlayer, def: CardDef): string | null {
    if (def.requires === "all_attacks_in_hand") {
      const allAttacks = p.hand.every((c) => resolveCard(c.id, c.upgraded)?.type === "attack");
      if (!allAttacks) return "Can only be played if every card in hand is an Attack.";
    }
    return null;
  }

  private hasLegalPlay(p: InternalPlayer): boolean {
    for (const c of p.hand) {
      const def = resolveCard(c.id, c.upgraded);
      if (!def || def.unplayable || def.cost === -2) continue;
      if (!isCardSupported(def) || this.playRestriction(p, def)) continue;
      const eff = this.effectiveCost(p, def);
      const cost = eff === "X" ? 0 : eff;
      if ((def.starCost ?? 0) > p.stars) continue; // can't afford the Star cost
      if (cost <= p.energy) {
        // Needs a target? If an enemy card and no living enemy, it's not legal.
        if (def.target === "enemy" || def.target === "all_enemies") {
          if (this.aliveEnemies(p.id).length === 0) continue;
        }
        return true;
      }
    }
    return false;
  }

  // Perfected Strike counts every "Strike" card across all of a player's piles.
  private countStrikeCards(p: InternalPlayer): number {
    const piles = [p.hand, p.draw, p.discard, p.exhaust];
    let n = 0;
    for (const pile of piles)
      for (const c of pile) {
        const def = resolveCard(c.id, c.upgraded);
        if (def && /strike/i.test(def.name)) n++;
      }
    return n;
  }

  private aliveEnemies(id: string): string[] {
    return this.order.filter((o) => o !== id && this.players.get(o)!.alive);
  }

  private allPassed(): boolean {
    const alive = this.order.map((id) => this.players.get(id)!).filter((p) => p.alive);
    return alive.length > 0 && alive.every((p) => p.passed);
  }

  private nextAlive(fromId: string, allowSame = false): string {
    const n = this.order.length;
    const start = this.order.indexOf(fromId);
    for (let step = 1; step <= n; step++) {
      const cand = this.order[(start + step) % n];
      if (this.players.get(cand)!.alive) {
        if (!allowSame && cand === fromId) continue;
        return cand;
      }
    }
    return fromId;
  }

  // The very first hand of the combat. Innate cards are guaranteed to open in
  // hand: move them to the top of the (already-shuffled) draw pile, then draw at
  // least that many so they all come up. With <5 Innate cards the rest of a
  // normal 5-card hand fills in behind them; with more, you draw all of them.
  private drawOpeningHand(p: InternalPlayer): void {
    const innate = p.draw.filter((c) => resolveCard(c.id, c.upgraded)?.innate);
    if (innate.length > 0) {
      const innateUids = new Set(innate.map((c) => c.uid));
      p.draw = p.draw.filter((c) => !innateUids.has(c.uid));
      p.draw.push(...innate); // top of the pile = end of the array
    }
    this.drawCards(p, Math.max(HAND_SIZE, innate.length));
  }

  private drawCards(p: InternalPlayer, n: number): void {
    // No Draw (e.g. Battle Trance) blocks any further draws this turn. The fresh
    // start-of-turn hand is drawn before this is ever applied, so it's safe here.
    if ((p.powers.get("no_draw") ?? 0) > 0) return;
    for (let i = 0; i < n; i++) {
      if (p.draw.length === 0) {
        if (p.discard.length === 0) break; // truly out of cards
        p.draw = p.discard;
        p.discard = [];
        this.shuffle(p.draw);
      }
      const c = p.draw.pop();
      if (c) {
        p.hand.push(c);
        // Kingly Kick / Kingly Punch change permanently each time they're drawn.
        const def = resolveCard(c.id, c.upgraded);
        if (def?.costDownOnDraw) {
          this.costReduction.set(c.uid, (this.costReduction.get(c.uid) ?? 0) + def.costDownOnDraw);
        }
        if (def?.damageUpOnDraw) {
          this.drawDamageBonus.set(c.uid, (this.drawDamageBonus.get(c.uid) ?? 0) + def.damageUpOnDraw);
        }
        // Void: lose Energy when drawn. During the start-of-turn draw the loss is
        // banked (netted against fresh Energy); mid-turn it hits live Energy now.
        if (def?.energyLossOnDraw) {
          if (this.inTurnStartDraw) this.turnStartEnergyLoss += def.energyLossOnDraw;
          else p.energy = Math.max(0, p.energy - def.energyLossOnDraw);
        }
      }
    }
  }

  // Move a card to the exhaust pile and fire every on-exhaust trigger: the card's
  // own onExhaust effects (e.g. Sentinel) plus the owner's exhaust-reactive powers
  // (Feel No Pain gains Block, Dark Embrace draws). Used by every genuine Exhaust
  // path — playing an Exhaust card, Ethereal cleanup, True Grit, Sever Soul,
  // Second Wind, Fiend Fire. Powers leaving play do NOT route through here.
  private exhaustCard(owner: InternalPlayer, inst: CardInstance): void {
    owner.exhaust.push(inst);
    const def = resolveCard(inst.id, inst.upgraded);
    if (def?.onExhaust) {
      for (const eff of def.onExhaust) this.applyEffect(eff, owner, [owner.id], def, inst.uid);
    }
    const fnp = owner.powers.get("feel_no_pain") ?? 0;
    if (fnp > 0) this.gainBlock(owner, fnp, "Feel No Pain");
    const embrace = owner.powers.get("dark_embrace") ?? 0;
    if (embrace > 0) this.drawCards(owner, embrace);
  }

  private shuffle(arr: CardInstance[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private checkDeaths(): void {
    if (this.phase === "gameover") return;
    // Loop until stable: a Corpse Explosion can kill further targets, which may
    // themselves explode.
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.players.values()) {
        if (p.alive && p.hp <= 0) {
          p.alive = false;
          changed = true;
          this.pushLog(`${p.name} is defeated!`);
          // Corpse Explosion: on death, deal its Max HP (×stacks) to all enemies.
          const boom = p.powers.get("corpse_explosion") ?? 0;
          if (boom > 0) {
            const dmg = p.maxHp * boom;
            for (const q of this.players.values()) {
              if (q.alive && q.id !== p.id) this.dealDamage(q, dmg);
            }
            this.pushLog(`💥 ${p.name}'s Corpse Explosion deals ${dmg} to all enemies.`);
          }
        }
      }
    }
    const alive = this.order.filter((id) => this.players.get(id)!.alive);
    if (alive.length <= 1) {
      this.phase = "gameover";
      this.winnerId = alive[0] ?? null;
      this.priorityId = null;
      this.pushLog(this.winnerId ? `${this.name(this.winnerId)} wins!` : "Draw.");
    }
  }

  private name(id: string): string {
    return this.players.get(id)?.name ?? id;
  }

  private pushLog(text: string): void {
    this.log.push({ id: this.logSeq++, text });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  // ----------------------------------------------------------------- views

  viewFor(viewerId: string): GameView {
    const players: PlayerView[] = this.order.map((id) => this.playerView(id, viewerId));
    const pendingAttacks: PendingAttackView[] = this.pending.map((a) => ({
      uid: a.uid,
      sourceId: a.sourceId,
      targetId: a.targetId,
      amount:
        a.targetId === viewerId || a.sourceId === viewerId
          ? this.previewDamage(a)
          : null,
      times: a.times,
    }));
    let resolution: ResolutionView | null = null;
    if (this.resolutionData) {
      const aliveIds = this.order.filter((id) => this.players.get(id)!.alive);
      resolution = {
        turn: this.resolutionData.turn,
        blocks: this.resolutionData.blocks,
        attacks: this.resolutionData.attacks,
        deaths: this.resolutionData.deaths,
        youAcked: this.resolutionAcks.has(viewerId),
        waitingOn: aliveIds.filter((id) => !this.resolutionAcks.has(id)).map((id) => this.name(id)),
      };
    }
    // Show the card-selection prompt only to the player who must make it.
    let pendingChoice: PendingChoiceView | null = null;
    if (this.pendingChoice && this.pendingChoice.playerId === viewerId) {
      const pc = this.pendingChoice;
      // replaySkill offers only the eligible skills; discover offers the freshly
      // generated options; otherwise it's a pile (hand or discard).
      const pile =
        pc.kind === "discover"
          ? pc.options ?? []
          : pc.kind === "replaySkill"
            ? this.replayableSkills(pc.effSource)
            : pc.source === "discard"
              ? pc.effSource.discard
              : pc.effSource.hand;
      pendingChoice = {
        prompt: pc.prompt,
        source: pc.source,
        pick: pc.pick,
        cards: pile.map((c) => this.cardView(c, pc.effSource, false)),
      };
    }
    return {
      matchId: this.matchId,
      phase: this.phase,
      turn: this.turn,
      youId: viewerId,
      priorityId: this.priorityId,
      yoloPriority: this.yoloPriority,
      startingPlayerId: this.startingPlayerId,
      players,
      pendingAttacks,
      resolution,
      pendingChoice,
      winnerId: this.winnerId,
      log: this.log.slice(-40),
      lastPlay: this.lastPlay
        ? {
            seq: this.lastPlay.seq,
            playerId: this.lastPlay.playerId,
            cardName: this.lastPlay.cardName,
            cardType: this.lastPlay.cardType as CardType,
            targetId: this.lastPlay.targetId,
          }
        : null,
    };
  }

  private previewDamage(a: PendingAttack): number {
    return a.perHit;
  }

  private playerView(id: string, viewerId: string): PlayerView {
    const p = this.players.get(id)!;
    const isSelf = id === viewerId;
    const powers: PowerView[] = [...p.powers.entries()].map(([pid, stacks]) => ({
      id: pid,
      name: getPower(pid).name,
      stacks,
      kind: getPower(pid).kind,
    }));
    const view: PlayerView = {
      id: p.id,
      name: p.name,
      color: p.color,
      hp: p.hp,
      maxHp: p.maxHp,
      // Block is public so everyone can see how protected each player is.
      block: p.block,
      isBlocking: p.block > 0 || p.blockedThisTurn,
      energy: isSelf ? p.energy : null,
      maxEnergy: p.maxEnergy,
      stars: isSelf ? p.stars : null,
      forge: p.forge,
      usesStars: p.usesStars,
      orbs: p.orbs.map((o) => ({ type: o.type, amount: o.amount })),
      orbSlots: p.usesOrbs ? p.orbSlots : 0,
      usesOrbs: p.usesOrbs,
      osty: p.usesOsty && p.ostyMaxHp > 0 ? { hp: p.ostyHp, maxHp: p.ostyMaxHp } : null,
      powers,
      handCount: p.hand.length,
      drawCount: p.draw.length,
      discardCount: p.discard.length,
      exhaustCount: p.exhaust.length,
      alive: p.alive,
      passed: p.passed,
      build: this.playerBuild(p),
    };
    if (isSelf) {
      view.hand = p.hand.map((c) => this.cardView(c, p));
      // Draw pile sorted by name so the viewer can't infer the shuffled order.
      view.drawPile = p.draw
        .map((c) => this.cardView(c, p, false))
        .sort((a, b) => a.name.localeCompare(b.name));
      view.discardPile = p.discard.map((c) => this.cardView(c, p, false));
      view.exhaustPile = p.exhaust.map((c) => this.cardView(c, p, false));
    }
    return view;
  }

  /** The static loadout a player brought, grouped into distinct cards. Public. */
  private playerBuild(p: InternalPlayer): PlayerBuild {
    const map = new Map<string, BuildCard>();
    for (const spec of p.seedDeck) {
      const key = `${spec.id}|${spec.upgraded ? 1 : 0}`;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        continue;
      }
      const def = resolveCard(spec.id, !!spec.upgraded);
      map.set(key, {
        id: spec.id,
        name: def?.name ?? spec.id,
        type: def?.type ?? "status",
        count: 1,
        upgraded: !!spec.upgraded,
      });
    }
    const cards = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    const relics = p.relics.map((id) => ({ id, name: getRelic(id)?.name ?? id }));
    return { maxHp: p.maxHp, deckSize: p.seedDeck.length, relics, cards };
  }

  private cardView(c: CardInstance, owner: InternalPlayer, inHand = true): CardView {
    const def = resolveCard(c.id, c.upgraded);
    if (!def) {
      return {
        uid: c.uid,
        id: c.id,
        name: c.id,
        type: "status",
        cost: 0,
        target: "none",
        description: "Unknown card (logged for devs).",
        playable: false,
        upgraded: c.upgraded,
      };
    }
    const effCost = this.effectiveCost(owner, def, c);
    const cost = effCost === "X" ? owner.energy : effCost;
    const playable =
      inHand &&
      this.phase === "action" &&
      // YOLO: you can play as long as you haven't ended your turn; otherwise it
      // must be your priority.
      (this.yoloPriority ? !owner.passed : this.priorityId === owner.id) &&
      !this.pendingChoice &&
      !def.unplayable &&
      def.cost !== -2 &&
      isCardSupported(def) &&
      !this.playRestriction(owner, def) &&
      typeof cost === "number" &&
      cost <= owner.energy &&
      (def.starCost ?? 0) <= owner.stars &&
      !((def.target === "enemy" || def.target === "all_enemies") && this.aliveEnemies(owner.id).length === 0);
    return {
      uid: c.uid,
      id: c.id,
      name: def.name,
      type: def.type,
      cost: effCost,
      target: def.target,
      description: describeCard(def),
      playable,
      upgraded: c.upgraded,
      starCost: def.starCost,
    };
  }
}

/** Build a short human description from a card's effects, for the client. */
export function describeCard(def: CardDef): string {
  const parts: string[] = [];
  for (const e of def.effects) {
    switch (e.kind) {
      case "damage": {
        const mul = e.strengthMul && e.strengthMul > 1 ? ` (Strength x${e.strengthMul})` : "";
        const per = e.perStrike ? ` (+${e.perStrike} per Strike in deck)` : "";
        const life = e.lifesteal ? ", heal for unblocked damage" : "";
        const kill = e.maxHpOnKill ? `, +${e.maxHpOnKill} max HP on kill` : "";
        const ramp = e.rampage
          ? e.rampage > 0
            ? `, +${e.rampage} damage each time it's played this combat`
            : `, ${e.rampage} damage each time it's played this combat`
          : "";
        const empty = e.onlyIfDrawEmpty ? " (only if your draw pile is empty)" : "";
        const star = e.perStarCard ? `, +${e.perStarCard} per Star Energy card in hand` : "";
        const skill = e.perSkillThisTurn ? `, +${e.perSkillThisTurn} per Skill played this turn` : "";
        const starGain = e.perStarGainedThisTurn ? `, +${e.perStarGainedThisTurn} per Star Energy gained this turn` : "";
        const created = e.perCardCreatedThisCombat ? `, +${e.perCardCreatedThisCombat} per card created this combat` : "";
        const koStars = e.starsOnKill ? `, gain ${e.starsOnKill} Star Energy if this kills` : "";
        const soul = e.perSoulInExhaust ? `, +${e.perSoulInExhaust} per Soul in your Exhaust pile` : "";
        parts.push(
          `Deal ${e.amount}${e.times && e.times > 1 ? ` x${e.times}` : ""} damage${mul}${per}${life}${kill}${ramp}${star}${skill}${starGain}${created}${koStars}${soul}${empty}`,
        );
        break;
      }
      case "damageEqualToBlock":
        parts.push("Deal damage equal to your Block");
        break;
      case "damageEqualToTargetDoom":
        parts.push("Deal damage equal to the target's Doom");
        break;
      case "block":
        parts.push(`Gain ${e.amount} Block`);
        break;
      case "doubleBlock":
        parts.push("Double your Block");
        break;
      case "doubleStrength":
        parts.push("Double your Strength");
        break;
      case "applyPower": {
        if (e.power === "strength_down") parts.push(`Lose ${e.amount} Strength at end of turn`);
        else if (e.power === "dexterity_down") parts.push(`Lose ${e.amount} Dexterity at end of turn`);
        else if (e.amount < 0) {
          // e.g. Disarm reduces enemy Strength.
          parts.push(`${e.to === "self" ? "Lose" : "Reduce enemy"} ${Math.abs(e.amount)} ${getPower(e.power).name}`);
        } else parts.push(`Apply ${e.amount} ${getPower(e.power).name}${e.to === "self" ? " to self" : ""}`);
        break;
      }
      case "draw":
        parts.push(`Draw ${e.amount}`);
        break;
      case "gainEnergy":
        parts.push(e.doubleCurrent ? "Double your energy" : `Gain ${e.amount} energy`);
        break;
      case "heal":
        parts.push(`Heal ${e.amount}`);
        break;
      case "loseHp":
        parts.push(`Lose ${e.amount} HP`);
        break;
      case "addCardToPile": {
        const cardName = resolveCard(e.cardId, false)?.name ?? e.cardId;
        parts.push(`Add ${e.amount} ${cardName} to ${e.pile}`);
        break;
      }
      case "discard":
        parts.push(`Discard ${e.amount}${e.random ? " at random" : ""} card${e.amount > 1 ? "s" : ""}`);
        break;
      case "discardHandDraw":
        parts.push("Discard your hand, then draw that many cards");
        break;
      case "multiplyTargetPoison":
        parts.push(e.factor === 2 ? "Double the target's Poison" : `Multiply the target's Poison by ${e.factor}`);
        break;
      case "discardNonAttacks":
        parts.push("Discard all non-Attack cards from your hand");
        break;
      case "exhaustRandom":
        parts.push(`Exhaust ${e.amount} random card${e.amount > 1 ? "s" : ""} from hand`);
        break;
      case "exhaustNonAttacks":
        parts.push(
          e.blockPerCard
            ? `Exhaust all non-Attack cards in hand; gain ${e.blockPerCard} Block for each`
            : "Exhaust all non-Attack cards in hand",
        );
        break;
      case "exhaustHandForDamage":
        parts.push(`Exhaust your hand; deal ${e.perCard} damage for each card Exhausted`);
        break;
      case "ifTargetHasPower": {
        const inner = e.then.map((sub) => describeCard({ effects: [sub] } as CardDef)).join(" ");
        parts.push(`If target has ${getPower(e.power).name}: ${inner.replace(/\.$/, "")}`);
        break;
      }
      case "ifIncomingAttack": {
        const inner = e.then.map((sub) => describeCard({ effects: [sub] } as CardDef)).join(" ");
        parts.push(`If an opponent is attacking you this turn: ${inner.replace(/\.$/, "")}`);
        break;
      }
      case "putDiscardOnDraw":
        parts.push(`Put ${e.amount} card${e.amount > 1 ? "s" : ""} from your discard pile on top of your draw pile`);
        break;
      case "putHandOnDraw":
        parts.push(`Put ${e.amount} card${e.amount > 1 ? "s" : ""} from your hand on top of your draw pile`);
        break;
      case "exhaustChosen":
        parts.push(`Exhaust ${e.amount} chosen card${e.amount > 1 ? "s" : ""} from your hand`);
        break;
      case "duplicateChosen": {
        const what = e.colorlessOnly ? "Colorless card" : "card";
        parts.push(
          e.amount > 1
            ? `Add ${e.amount} copies of a chosen ${what} in your hand to your hand`
            : `Add a copy of a chosen ${what} in your hand to your hand`,
        );
        break;
      }
      case "gainStars":
        parts.push(`Gain ${e.amount} Star Energy`);
        break;
      case "forge":
        parts.push(
          e.perOtherAttackThisTurn
            ? `Forge ${e.amount}, +${e.perOtherAttackThisTurn} for each other Attack played this turn`
            : `Forge ${e.amount}`,
        );
        break;
      case "sovereignBladeDamage":
        parts.push("Deal damage equal to your Forge");
        break;
      case "doubleForge":
        parts.push("Double your Forge");
        break;
      case "transformHand": {
        const into = resolveCard(e.into, false)?.name ?? e.into;
        parts.push(`Transform ${e.amount} random card${e.amount > 1 ? "s" : ""} in your hand into ${into}`);
        break;
      }
      case "transformDraw": {
        const into = resolveCard(e.into, false)?.name ?? e.into;
        parts.push(`Transform ${e.amount} random card${e.amount > 1 ? "s" : ""} in your draw pile into ${into}`);
        break;
      }
      case "addRandomCards": {
        const pool = e.character === "neutral" ? "Colorless" : e.character;
        parts.push(`Add ${e.amount} random ${pool} card${e.amount > 1 ? "s" : ""} to your ${e.pile}`);
        break;
      }
      case "discover": {
        const pool = e.character === "neutral" ? "Colorless" : e.character;
        const of = e.amount ?? 3;
        const pile = (e.pile ?? "hand") === "draw" ? "the top of your draw pile" : "your hand";
        parts.push(`Discover a ${pool} card (choose 1 of ${of}) and add it to ${pile}`);
        break;
      }
      case "fillHandWith": {
        const name = resolveCard(e.cardId, false)?.name ?? e.cardId;
        parts.push(`Fill your hand with ${name}`);
        break;
      }
      case "nextTurnBonus": {
        const bits = [
          e.energy ? `${e.energy} Energy` : "",
          e.stars ? `${e.stars} Star Energy` : "",
          e.block ? `${e.block} Block` : "",
          e.draw ? `draw ${e.draw}` : "",
        ].filter(Boolean);
        const lead = bits.length ? `Next turn, gain ${bits.join(" and ")}` : "";
        const retain = e.retainHand ? `${lead ? ". " : ""}Retain your hand` : "";
        parts.push(`${lead}${retain}`);
        break;
      }
      case "returnThisCard":
        parts.push(`Return this card to your ${e.to === "hand" ? "hand" : "draw pile"}`);
        break;
      case "summonBlade":
        parts.push("Put the Sovereign Blade into your hand");
        break;
      case "replayChosenSkill":
        parts.push(`Choose a Skill in your hand and play it ${e.times} times`);
        break;
      case "damagePerX": {
        const tgt = e.randomTarget ? " to random enemies" : "";
        const dbl = e.doubleAt !== undefined ? ` (X is doubled if X ≥ ${e.doubleAt})` : "";
        parts.push(`Deal ${e.amount} damage${tgt} X times${dbl}`);
        break;
      }
      case "channelOrb": {
        const n = e.amount ?? 1;
        const names: Record<string, string> = {
          lightning: "Lightning",
          frost: "Frost",
          dark: "Dark",
          plasma: "Plasma",
          glass: "Glass",
        };
        parts.push(`Channel ${n} ${names[e.orb] ?? e.orb}`);
        break;
      }
      case "evokeOrb":
        parts.push((e.times ?? 1) > 1 ? `Evoke your rightmost Orb ${e.times} times` : "Evoke your rightmost Orb");
        break;
      case "evokeAllOrbs":
        parts.push((e.times ?? 1) > 1 ? `Evoke all of your Orbs ${e.times} times` : "Evoke all of your Orbs");
        break;
      case "gainOrbSlots":
        parts.push(`Gain ${e.amount} Orb slot${e.amount > 1 ? "s" : ""}`);
        break;
      case "summon":
        parts.push(`Summon ${e.amount} (give Osty ${e.amount} Max HP)`);
        break;
      case "ostyDamage":
        parts.push(
          e.perOstyMaxHp
            ? `Osty deals ${e.amount} damage plus ${e.perOstyMaxHp}× his Max HP`
            : `Osty deals ${e.amount} damage`,
        );
        break;
      case "sacrificeOsty":
        parts.push(`Osty dies; gain Block equal to ${e.blockPerMaxHp}× his Max HP`);
        break;
      case "healOsty":
        parts.push(`Heal Osty ${e.amount}`);
        break;
      case "loseHpTarget":
        parts.push(`Target loses ${e.amount} HP`);
        break;
      case "exhaustFromDraw":
        parts.push(`Exhaust ${e.amount} card${e.amount > 1 ? "s" : ""} from your draw pile`);
        break;
      case "triggerDarkPassive":
        parts.push(`Trigger the passive of all Dark orbs${(e.times ?? 1) > 1 ? ` ${e.times} times` : ""}`);
        break;
      case "ifDoomAppliedThisTurn": {
        const inner = e.then.map((sub) => describeCard({ effects: [sub] } as CardDef)).join(" ").replace(/\.$/, "");
        parts.push(`If you applied Doom this turn: ${inner}`);
        break;
      }
      case "upgradeAllCards":
        parts.push("Upgrade all your cards for the rest of combat");
        break;
      case "applyDoom": {
        let t = `Apply ${e.amount} Doom`;
        if (e.perExistingTen) t += `, +${e.perExistingTen} per 10 Doom already on the target`;
        if (e.perCardThisTurn) t += `, +${e.perCardThisTurn} per card played this turn`;
        parts.push(t);
        break;
      }
      case "unimplemented":
        parts.push("(unimplemented)");
        break;
    }
  }
  let text = parts.join(". ");
  if (def.dynamicCost === "hp_loss") text += ". Costs 1 less for each time you've lost HP this combat";
  if (def.dynamicCost === "discards") text += ". Costs 1 less for each card discarded this turn";
  if (def.costDownOnDraw)
    text += `. Costs ${def.costDownOnDraw} less each time you draw it this combat`;
  if (def.damageUpOnDraw)
    text += `. Whenever you draw this card, increase its damage by ${def.damageUpOnDraw} this combat`;
  if (def.requires === "all_attacks_in_hand") text += ". Play only if all cards in hand are Attacks";
  text += def.exhaust ? ". Exhaust." : ".";
  if (def.onExhaust && def.onExhaust.length) {
    const inner = describeCard({ effects: def.onExhaust } as CardDef).replace(/\.$/, "");
    text += ` When Exhausted: ${inner}.`;
  }
  if (def.ethereal) text += " Ethereal.";
  if (def.starCost === -1) text += " Spends all your Star Energy.";
  else if (def.starCost) text += ` Costs ${def.starCost} Star Energy.`;
  if (def.retain) text += " Retain.";
  if (def.innate) text += " Innate.";
  if (def.sly) text += " Sly (if discarded this turn, it plays itself).";
  if (def.playFromDrawIfTop) text += " At end of turn, if on top of your draw pile, play it.";
  if (def.energyLossOnDraw) text += ` Lose ${def.energyLossOnDraw} Energy when drawn.`;
  return text;
}
