import type {
  BuildCard,
  CardDef,
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
import { resolveCard } from "./cards/registry.js";
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
    // Apply relic starting effects.
    for (const id of p.relics) {
      const r = getRelic(id);
      if (r?.startingBlock) p.block += r.startingBlock;
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
      // Discard leftover hand, draw a fresh hand.
      p.discard.push(...p.hand);
      p.hand = [];
      this.drawCards(p, HAND_SIZE);
      // Refresh energy (+ relic bonuses).
      let energy = p.maxEnergy;
      for (const rid of p.relics) energy += getRelic(rid)?.bonusEnergyPerTurn ?? 0;
      p.energy = energy;
      // Metallicize: gain block at the top of the turn.
      const metal = p.powers.get("metallicize") ?? 0;
      if (metal > 0) {
        p.block += metal;
        this.blockEvents.push({ playerId: p.id, playerName: p.name, cardName: "Metallicize", amount: metal });
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

    const cost = def.cost === "X" ? p.energy : def.cost;
    if (typeof cost === "number" && cost > p.energy) return "Not enough energy.";

    // Resolve target.
    const targets = this.resolveTargets(def, playerId, targetId);
    if (targets === null) return "Pick a valid target.";

    // Pay + move the card out of hand.
    p.energy -= typeof cost === "number" ? cost : 0;
    p.hand.splice(idx, 1);
    const goesToExhaust = !!def.exhaust || def.type === "power";
    if (goesToExhaust) p.exhaust.push(inst);
    else p.discard.push(inst);

    const cardLabel = `${def.name}${inst.upgraded ? "+" : ""}`;
    const targetSuffix = targets.length === 1 && targets[0] !== playerId ? ` → ${this.name(targets[0])}` : "";
    this.pushLog(`${p.name} plays ${cardLabel}${targetSuffix} — ${describeCard(def)}`);

    // Execute effects: damage is deferred, everything else is immediate.
    for (const eff of def.effects) this.applyEffect(eff, p, targets, def);

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
    // place before any attack lands. Attacks land in the order they were played,
    // each using the damage frozen at its play time.
    const attacks: ResolutionAttack[] = [];
    for (const atk of this.pending) {
      const src = this.players.get(atk.sourceId);
      const tgt = this.players.get(atk.targetId);
      if (!src || !tgt || !tgt.alive) continue;
      const per = atk.perHit;
      let blocked = 0;
      let hpLost = 0;
      for (let i = 0; i < atk.times; i++) {
        if (!tgt.alive) break;
        const r = this.dealDamage(tgt, per);
        blocked += r.blocked;
        hpLost += r.hp;
      }
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
        lethal: tgt.hp <= 0,
      });
      this.pushLog(
        `${src.name}'s ${atk.cardName} hits ${tgt.name} for ${per}${atk.times > 1 ? ` x${atk.times}` : ""} ` +
          `(${hpLost} HP lost${blocked > 0 ? `, ${blocked} blocked` : ""}).`,
      );
    }
    this.pending = [];

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
      p.block = 0;
      const regen = p.powers.get("regen") ?? 0;
      if (regen > 0) this.heal(p, regen);
      this.expireTemporaryStrength(p);
      this.decayPowers(p);
    }
    this.resolutionData = null;
    this.resolutionAcks.clear();
    this.phase = "action";
    this.beginTurn(false);
    this.pushLog(`--- Turn ${this.turn}: ${this.name(this.startingPlayerId!)} starts ---`);
  }

  // ----------------------------------------------------------------- effects

  private applyEffect(eff: Effect, source: InternalPlayer, targets: string[], def: CardDef): void {
    switch (eff.kind) {
      case "damage": {
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
            perHit: this.computeDamage(eff.amount, source, tgt),
            times: eff.times ?? 1,
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
        const dex = source.powers.get("dexterity") ?? 0;
        let amt = eff.amount + dex;
        if ((source.powers.get("frail") ?? 0) > 0) amt = Math.floor(amt * FRAIL_MULT);
        amt = Math.max(0, amt);
        source.block += amt;
        source.blockedThisTurn = true;
        this.blockEvents.push({ playerId: source.id, playerName: source.name, cardName: def.name, amount: amt });
        break;
      }
      case "applyPower": {
        const recipients = eff.to === "self" ? [source.id] : targets;
        for (const rid of recipients) {
          const r = this.players.get(rid);
          if (!r) continue;
          const pdef = getPower(eff.power); // validates / logs unknown power ids
          r.powers.set(eff.power, (r.powers.get(eff.power) ?? 0) + eff.amount);
          // Signal status changes explicitly so every player can follow them in
          // the event log (debuffs from cards/bosses especially).
          if (eff.power === "strength_down") {
            // Bookkeeping power for temporary Strength; not worth a log line.
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
      case "loseHp":
        source.hp = Math.max(0, source.hp - eff.amount);
        break;
      case "addCardToPile": {
        for (let i = 0; i < eff.amount; i++) {
          const c: CardInstance = { uid: uid("c"), id: eff.cardId, upgraded: false };
          if (eff.pile === "hand") source.hand.push(c);
          else if (eff.pile === "draw") source.draw.push(c);
          else source.discard.push(c);
        }
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

  private computeDamage(base: number, src: InternalPlayer, tgt: InternalPlayer, addStrength = true): number {
    // Strength is excluded for block-scaling attacks (e.g. Body Slam), matching
    // StS. Weak/Vulnerable still apply so a debuff landed earlier this turn counts.
    let d = base + (addStrength ? src.powers.get("strength") ?? 0 : 0);
    if ((src.powers.get("weak") ?? 0) > 0) d *= WEAK_MULT;
    if ((tgt.powers.get("vulnerable") ?? 0) > 0) d *= VULNERABLE_MULT;
    return Math.max(0, Math.floor(d));
  }

  private dealDamage(tgt: InternalPlayer, amount: number): { blocked: number; hp: number } {
    let remaining = amount;
    let blocked = 0;
    if (tgt.block > 0) {
      blocked = Math.min(tgt.block, remaining);
      tgt.block -= blocked;
      remaining -= blocked;
    }
    if (remaining > 0) tgt.hp = Math.max(0, tgt.hp - remaining);
    return { blocked, hp: remaining };
  }

  private heal(p: InternalPlayer, amount: number): void {
    p.hp = Math.min(p.maxHp, p.hp + amount);
  }

  // Flex-style temporary Strength: remove the tracked amount, then clear it.
  // Strength may legitimately go negative.
  private expireTemporaryStrength(p: InternalPlayer): void {
    const down = p.powers.get("strength_down") ?? 0;
    if (down <= 0) return;
    const str = (p.powers.get("strength") ?? 0) - down;
    if (str === 0) p.powers.delete("strength");
    else p.powers.set("strength", str);
    p.powers.delete("strength_down");
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

  private hasLegalPlay(p: InternalPlayer): boolean {
    for (const c of p.hand) {
      const def = resolveCard(c.id, c.upgraded);
      if (!def || def.unplayable || def.cost === -2) continue;
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
      hp: p.hp,
      maxHp: p.maxHp,
      block: isSelf ? p.block : null,
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
      case "damage":
        parts.push(`Deal ${e.amount}${e.times && e.times > 1 ? ` x${e.times}` : ""} damage`);
        break;
      case "damageEqualToBlock":
        parts.push("Deal damage equal to your Block");
        break;
      case "block":
        parts.push(`Gain ${e.amount} Block`);
        break;
      case "applyPower":
        if (e.power === "strength_down")
          parts.push(`Lose ${e.amount} Strength at end of turn`);
        else parts.push(`Apply ${e.amount} ${getPower(e.power).name}${e.to === "self" ? " to self" : ""}`);
        break;
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
      case "addCardToPile":
        parts.push(`Add ${e.amount} ${e.cardId} to ${e.pile}`);
        break;
      case "unimplemented":
        parts.push("(unimplemented)");
        break;
    }
  }
  return parts.join(". ") + (def.exhaust ? ". Exhaust." : ".");
}
