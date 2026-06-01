import type {
  BuildCard,
  CardDef,
  CardType,
  CardView,
  Effect,
  GameView,
  LogEntry,
  PendingAttackView,
  PlayerBuild,
  PlayerView,
  PowerView,
  ResolutionAttack,
  ResolutionBlock,
  ResolutionView,
} from "@multispire/shared";
import { isCardSupported, resolveCard } from "./cards/registry.js";
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
  seedDeck: DeckList; // the build they brought, for the build viewer
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
  private rng: () => number;

  constructor(matchId: string, rng: () => number = Math.random) {
    this.matchId = matchId;
    this.rng = rng;
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
      seedDeck: seed.deck,
    };
    // Apply relic starting effects (self-targeted ones; enemy-targeted ones like
    // Bag of Marbles are applied in start() once everyone has joined).
    for (const id of p.relics) {
      const r = getRelic(id);
      if (!r) continue;
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
      // Clean up the leftover hand: Ethereal cards exhaust, the rest discard.
      const leftover = p.hand;
      p.hand = [];
      for (const c of leftover) {
        const cdef = resolveCard(c.id, c.upgraded);
        if (cdef?.ethereal) this.exhaustCard(p, c);
        else p.discard.push(c);
      }
      this.drawCards(p, HAND_SIZE);
      // Refresh energy (+ relic bonuses), and apply first-turn extra draw.
      let energy = p.maxEnergy;
      let extraDraw = 0;
      // Berserk: extra Energy at the start of each turn.
      energy += p.powers.get("berserk") ?? 0;
      for (const rid of p.relics) {
        const r = getRelic(rid);
        energy += r?.bonusEnergyPerTurn ?? 0;
        if (first) {
          energy += r?.bonusEnergyFirstTurn ?? 0;
          extraDraw += r?.bonusDrawFirstTurn ?? 0;
        }
      }
      if (extraDraw > 0) this.drawCards(p, extraDraw);
      // Brutality: lose HP (never lethal) and draw that many cards each turn.
      const brutality = p.powers.get("brutality") ?? 0;
      if (brutality > 0) {
        p.hp = Math.max(1, p.hp - brutality);
        this.drawCards(p, brutality);
      }
      p.energy = energy;
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
      p.blockedThisTurn = false;
      p.passed = false;
    }
    this.priorityId = this.startingPlayerId;
    this.autoPassIfStuck();
  }

  /** A player plays a card. Returns null on success or an error string. */
  playCard(playerId: string, cardUid: string, targetId?: string): string | null {
    if (this.phase !== "action") return "Not in the action phase.";
    if (this.priorityId !== playerId) return "It is not your priority.";
    const p = this.players.get(playerId);
    if (!p || !p.alive) return "You are not in this match.";

    const idx = p.hand.findIndex((c) => c.uid === cardUid);
    if (idx === -1) return "Card not in hand.";
    const inst = p.hand[idx];
    const def = resolveCard(inst.id, inst.upgraded);
    if (!def) return "Unknown card (logged for the devs).";
    if (def.unplayable || def.cost === -2) return "That card can't be played.";
    if (!isCardSupported(def)) return "That card isn't supported yet.";
    const restriction = this.playRestriction(p, def);
    if (restriction) return restriction;

    const cost = def.cost === "X" ? p.energy : def.cost;
    if (typeof cost === "number" && cost > p.energy) return "Not enough energy.";

    // Resolve target.
    const targets = this.resolveTargets(def, playerId, targetId);
    if (targets === null) return "Pick a valid target.";

    // Pay + move the card out of hand.
    p.energy -= typeof cost === "number" ? cost : 0;
    p.hand.splice(idx, 1);
    if (def.exhaust) {
      // A genuine Exhaust: fire on-exhaust hooks (Sentinel, Feel No Pain, etc.).
      this.exhaustCard(p, inst);
    } else if (def.type === "power") {
      // Powers leave play but don't count as "Exhausted" for exhaust synergies.
      p.exhaust.push(inst);
    } else {
      p.discard.push(inst);
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

    // Execute effects: damage is deferred, everything else is immediate.
    for (const eff of def.effects) this.applyEffect(eff, p, targets, def, inst.uid);

    // Rage: gain Block whenever you play an Attack this turn.
    const rage = p.powers.get("rage") ?? 0;
    if (def.type === "attack" && rage > 0) this.gainBlock(p, rage, "Rage");

    // A play resets the pass round for everyone.
    for (const q of this.players.values()) q.passed = false;
    p.passed = false;

    this.advancePriority(playerId);
    this.checkDeaths();
    return null;
  }

  /** A player passes priority. */
  pass(playerId: string): string | null {
    if (this.phase !== "action") return "Not in the action phase.";
    if (this.priorityId !== playerId) return "It is not your priority.";
    const p = this.players.get(playerId)!;
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

    // End-of-turn Burn ticks: each Burn still in hand deals 2 unblockable damage.
    for (const id of this.order) {
      const p = this.players.get(id)!;
      if (!p.alive) continue;
      const burns = p.hand.filter((c) => c.id === "burn").length;
      if (burns <= 0) continue;
      const dmg = burns * 2;
      p.hp = Math.max(0, p.hp - dmg);
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
      this.decayPowers(p);
    }
    this.resolutionData = null;
    this.resolutionAcks.clear();
    this.phase = "action";
    this.beginTurn(false);
    this.pushLog(`--- Turn ${this.turn}: ${this.name(this.startingPlayerId!)} starts ---`);
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
        // Perfected Strike: +damage for each "Strike" card across the source's deck.
        const strikeBonus = eff.perStrike ? eff.perStrike * this.countStrikeCards(source) : 0;
        // Rampage: this card instance hits harder each time it's played this combat.
        let rampageBonus = 0;
        if (eff.rampage && instUid) {
          rampageBonus = this.rampageStacks.get(instUid) ?? 0;
          this.rampageStacks.set(instUid, rampageBonus + eff.rampage);
        }
        const base = eff.amount + strikeBonus + rampageBonus;
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
        break;
      }
      case "draw":
        this.drawCards(source, eff.amount);
        break;
      case "gainEnergy":
        source.energy += eff.amount;
        break;
      case "heal":
        this.heal(source, eff.amount);
        break;
      case "loseHp": {
        source.hp = Math.max(0, source.hp - eff.amount);
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
      const cost = def.cost === "X" ? 0 : def.cost;
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
      if (c) p.hand.push(c);
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
    for (const p of this.players.values()) {
      if (p.alive && p.hp <= 0) {
        p.alive = false;
        this.pushLog(`${p.name} is defeated!`);
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
    return {
      matchId: this.matchId,
      phase: this.phase,
      turn: this.turn,
      youId: viewerId,
      priorityId: this.priorityId,
      startingPlayerId: this.startingPlayerId,
      players,
      pendingAttacks,
      resolution,
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
    const cost = def.cost === "X" ? owner.energy : def.cost;
    const playable =
      inHand &&
      this.phase === "action" &&
      this.priorityId === owner.id &&
      !def.unplayable &&
      def.cost !== -2 &&
      isCardSupported(def) &&
      !this.playRestriction(owner, def) &&
      typeof cost === "number" &&
      cost <= owner.energy &&
      !((def.target === "enemy" || def.target === "all_enemies") && this.aliveEnemies(owner.id).length === 0);
    return {
      uid: c.uid,
      id: c.id,
      name: def.name,
      type: def.type,
      cost: def.cost,
      target: def.target,
      description: describeCard(def),
      playable,
      upgraded: c.upgraded,
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
        const ramp = e.rampage ? `, +${e.rampage} damage each time it's played this combat` : "";
        parts.push(`Deal ${e.amount}${e.times && e.times > 1 ? ` x${e.times}` : ""} damage${mul}${per}${life}${kill}${ramp}`);
        break;
      }
      case "damageEqualToBlock":
        parts.push("Deal damage equal to your Block");
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
        parts.push(`Gain ${e.amount} energy`);
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
      case "unimplemented":
        parts.push("(unimplemented)");
        break;
    }
  }
  let text = parts.join(". ");
  if (def.requires === "all_attacks_in_hand") text += ". Play only if all cards in hand are Attacks";
  text += def.exhaust ? ". Exhaust." : ".";
  if (def.onExhaust && def.onExhaust.length) {
    const inner = describeCard({ effects: def.onExhaust } as CardDef).replace(/\.$/, "");
    text += ` When Exhausted: ${inner}.`;
  }
  if (def.ethereal) text += " Ethereal.";
  return text;
}
