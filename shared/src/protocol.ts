// Wire protocol between client and server. The server is authoritative; clients
// send intents and render the per-player view the server pushes back.

import type { CardType, PowerId, TargetKind } from "./cards.js";

// ---------- Client -> Server ----------

export type ClientMessage =
  | { t: "join"; name: string; matchId?: string; mode?: MatchMode }
  | { t: "startMatch" } // host kicks off the game from the lobby
  | { t: "playCard"; cardUid: string; targetId?: string }
  | { t: "pass" }
  | { t: "chat"; text: string };

export type MatchMode = "1v1" | "ffa";

// ---------- Server -> Client ----------

export type ServerMessage =
  | { t: "joined"; playerId: string; matchId: string }
  | { t: "lobby"; view: LobbyView }
  | { t: "state"; view: GameView }
  | { t: "log"; entries: LogEntry[] }
  | { t: "error"; message: string };

export interface LobbyView {
  matchId: string;
  mode: MatchMode;
  hostId: string;
  players: { id: string; name: string; ready: boolean }[];
  started: boolean;
}

export interface LogEntry {
  id: number;
  text: string;
}

// ---------- Per-player game view (fog of war applied) ----------

export interface CardView {
  uid: string;
  id: string;
  name: string;
  type: CardType;
  cost: number | "X";
  target: TargetKind;
  /** Short generated text so the client need not own the card DB. */
  description: string;
  playable: boolean; // enough energy + legal to play right now
  upgraded: boolean;
}

export interface PowerView {
  id: PowerId;
  name: string;
  stacks: number;
  kind: "buff" | "debuff";
}

/** An attack that has been queued this turn and will land at resolution. */
export interface PendingAttackView {
  uid: string;
  sourceId: string;
  targetId: string;
  /** Preview damage with current stats. Shown only to the target (and source). */
  amount: number | null; // null = hidden (you're not the target)
  times: number;
}

export interface PlayerView {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  /** Your own exact block; opponents see null but get `isBlocking`. */
  block: number | null;
  isBlocking: boolean;
  energy: number | null; // hidden for opponents -> null
  maxEnergy: number;
  powers: PowerView[];
  handCount: number;
  drawCount: number;
  discardCount: number;
  exhaustCount: number;
  /** Only present for the viewing player. */
  hand?: CardView[];
  alive: boolean;
  /** Has this player passed during the current priority round. */
  passed: boolean;
}

export type Phase = "lobby" | "action" | "resolution" | "gameover";

export interface GameView {
  matchId: string;
  phase: Phase;
  turn: number;
  youId: string;
  /** Whose priority it is to act right now. */
  priorityId: string | null;
  startingPlayerId: string | null;
  players: PlayerView[];
  pendingAttacks: PendingAttackView[];
  winnerId?: string | null;
  log: LogEntry[];
}
