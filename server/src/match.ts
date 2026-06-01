import type { WebSocket } from "ws";
import type { LobbyView, MatchMode, OpenMatchView, ServerMessage } from "@multispire/shared";
import { DEFAULT_MAX_HP, GameEngine } from "./game/engine.js";
import { ironcladDemoDeck, type DeckList } from "./game/decks.js";

export interface MemberSeed {
  deck: DeckList;
  relics: string[];
  maxHp?: number;
  custom: boolean; // false => default deck (no loadout imported)
}

interface Member {
  id: string;
  name: string;
  ready: boolean;
  ws: WebSocket | null; // null = temporarily disconnected
  seed: MemberSeed;
}

function defaultSeed(): MemberSeed {
  return { deck: ironcladDemoDeck(), relics: [], custom: false };
}

const MAX_PLAYERS: Record<MatchMode, number> = { "1v1": 2, ffa: 4 };

export class Match {
  readonly id: string;
  mode: MatchMode;
  hostId: string;
  started = false;
  private members: Member[] = [];
  private engine: GameEngine | null = null;

  constructor(id: string, mode: MatchMode, hostId: string) {
    this.id = id;
    this.mode = mode;
    this.hostId = hostId;
  }

  get playerCount(): number {
    return this.members.length;
  }

  get maxPlayers(): number {
    return MAX_PLAYERS[this.mode];
  }

  isFull(): boolean {
    return this.members.length >= MAX_PLAYERS[this.mode];
  }

  /** True when others can still join: lobby is open and has room. */
  isJoinable(): boolean {
    return !this.started && this.members.length > 0 && !this.isFull();
  }

  hostName(): string {
    return this.members.find((m) => m.id === this.hostId)?.name ?? "Host";
  }

  hasMember(id: string): boolean {
    return this.members.some((m) => m.id === id);
  }

  addMember(id: string, name: string, ws: WebSocket, seed?: MemberSeed): string | null {
    if (this.started) return "Match already started.";
    if (this.isFull()) return "Match is full.";
    this.members.push({ id, name, ready: false, ws, seed: seed ?? defaultSeed() });
    if (!this.members.some((m) => m.id === this.hostId)) this.hostId = id;
    return null;
  }

  /** Replace a member's loadout (e.g. re-import before the match starts). */
  setLoadout(id: string, name: string, seed: MemberSeed): void {
    const m = this.members.find((x) => x.id === id);
    if (!m || this.started) return;
    if (name) m.name = name;
    m.seed = seed;
  }

  attach(id: string, ws: WebSocket): void {
    const m = this.members.find((x) => x.id === id);
    if (m) m.ws = ws;
  }

  detach(id: string): void {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    m.ws = null;
    // Before the game starts, a disconnect drops you from the lobby.
    if (!this.started) {
      this.members = this.members.filter((x) => x.id !== id);
      if (id === this.hostId && this.members[0]) this.hostId = this.members[0].id;
    }
  }

  setReady(id: string, ready: boolean): void {
    const m = this.members.find((x) => x.id === id);
    if (m) m.ready = ready;
  }

  start(starterId: string): string | null {
    if (starterId !== this.hostId) return "Only the host can start the match.";
    if (this.started) return "Already started.";
    if (this.members.length < 2) return "Need at least 2 players.";
    const engine = new GameEngine(this.id);
    for (const m of this.members) {
      engine.addPlayer({
        id: m.id,
        name: m.name,
        deck: m.seed.deck,
        relics: m.seed.relics,
        maxHp: m.seed.maxHp,
      });
    }
    engine.start();
    this.engine = engine;
    this.started = true;
    return null;
  }

  getEngine(): GameEngine | null {
    return this.engine;
  }

  lobbyView(): LobbyView {
    return {
      matchId: this.id,
      mode: this.mode,
      hostId: this.hostId,
      players: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        ready: m.ready,
        deckSize: m.seed.deck.length,
        relicCount: m.seed.relics.length,
        maxHp: m.seed.maxHp ?? DEFAULT_MAX_HP,
        custom: m.seed.custom,
      })),
      started: this.started,
    };
  }

  private resolutionTimer: ReturnType<typeof setTimeout> | null = null;

  /** Push the right message to every connected member (per-player fog of war). */
  broadcast(): void {
    for (const m of this.members) {
      if (!m.ws || m.ws.readyState !== m.ws.OPEN) continue;
      const msg: ServerMessage = this.engine
        ? { t: "state", view: this.engine.viewFor(m.id) }
        : { t: "lobby", view: this.lobbyView() };
      m.ws.send(JSON.stringify(msg));
    }
    this.maintainResolutionTimeout();
  }

  // Safety net: if a connected player never dismisses the resolution summary,
  // advance the turn anyway after a grace period so the match can't hang.
  private maintainResolutionTimeout(): void {
    const inResolution = this.engine?.phase === "resolution";
    if (inResolution && !this.resolutionTimer) {
      this.resolutionTimer = setTimeout(() => {
        this.resolutionTimer = null;
        this.engine?.skipResolution();
        this.broadcast();
      }, 60_000);
    } else if (!inResolution && this.resolutionTimer) {
      clearTimeout(this.resolutionTimer);
      this.resolutionTimer = null;
    }
  }

  isEmpty(): boolean {
    return this.members.every((m) => m.ws === null);
  }
}

export class MatchManager {
  private matches = new Map<string, Match>();

  get(id: string): Match | undefined {
    return this.matches.get(id);
  }

  /** Join an existing match by id, or create a fresh one. */
  joinOrCreate(matchId: string | undefined, mode: MatchMode, playerId: string): Match {
    if (matchId) {
      const existing = this.matches.get(matchId);
      if (existing) return existing;
    }
    const id = matchId ?? this.newId();
    const m = new Match(id, mode, playerId);
    this.matches.set(id, m);
    return m;
  }

  remove(id: string): void {
    this.matches.delete(id);
  }

  /** The open games to advertise on the homepage. */
  openMatches(): OpenMatchView[] {
    const out: OpenMatchView[] = [];
    for (const m of this.matches.values()) {
      if (!m.isJoinable()) continue;
      out.push({
        matchId: m.id,
        mode: m.mode,
        hostName: m.hostName(),
        playerCount: m.playerCount,
        maxPlayers: m.maxPlayers,
      });
    }
    return out;
  }

  private newId(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    do {
      id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    } while (this.matches.has(id));
    return id;
  }
}
