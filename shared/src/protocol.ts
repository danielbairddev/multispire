// Wire protocol between client and server. The server is authoritative; clients
// send intents and render the per-player view the server pushes back.

import type { CardType, Character, PowerId, TargetKind } from "./cards.js";
import type { Loadout } from "./loadout.js";

// ---------- Client -> Server ----------

export type ClientMessage =
  | { t: "join"; name: string; matchId?: string; mode?: MatchMode; loadout?: Loadout }
  | { t: "startMatch" } // host kicks off the game from the lobby
  | { t: "playCard"; cardUid: string; targetId?: string }
  // Resolve a pending card-selection prompt (Headbutt, Warcry, Burning Pact).
  | { t: "chooseCards"; uids: string[] }
  | { t: "pass" }
  // Dismiss the end-of-turn resolution summary; the turn advances once everyone has.
  | { t: "ackResolution" }
  | { t: "chat"; text: string };

export type MatchMode = "1v1" | "ffa";

// ---------- Server -> Client ----------

export type ServerMessage =
  | { t: "joined"; playerId: string; matchId: string }
  | { t: "lobby"; view: LobbyView }
  | { t: "state"; view: GameView }
  | { t: "log"; entries: LogEntry[] }
  // Non-fatal feedback (e.g. loadout import warnings) shown to one client.
  | { t: "notice"; message: string }
  | { t: "error"; message: string };

/** One deck-buildable card, served to the client for the deckbuilder. */
export interface CardCatalogEntry {
  id: string;
  name: string;
  type: CardType;
  cost: number | "X";
  target: TargetKind;
  description: string; // base form
  upgradedDescription?: string; // present when upgradable
  /** Cost of the upgraded form, when upgrading changes it (e.g. Barricade 3→2). */
  upgradedCost?: number | "X";
  upgradable: boolean;
  /** False when this card is only partially modeled and currently disabled. */
  supported: boolean;
  /** Character pool this card belongs to (for hero filtering in the deckbuilder). */
  character: Character;
}

export interface RelicCatalogEntry {
  id: string;
  name: string;
  description: string;
}

/** A joinable open game shown on the homepage so players can join with a click. */
export interface OpenMatchView {
  matchId: string;
  mode: MatchMode;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  /** Summary of the imported loadout so everyone can see what's loaded. */
  deckSize: number;
  relicCount: number;
  maxHp: number;
  custom: boolean; // true if a loadout was imported (vs the default deck)
}

export interface LobbyView {
  matchId: string;
  mode: MatchMode;
  hostId: string;
  players: LobbyPlayer[];
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
  /** Star Energy cost (Regent cards), when the card has one. */
  starCost?: number;
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

/** One distinct card in a player's build, with how many copies they brought. */
export interface BuildCard {
  id: string;
  name: string;
  type: CardType;
  count: number;
  upgraded: boolean;
}

/** The static loadout a player brought — public info, visible to everyone. */
export interface PlayerBuild {
  maxHp: number;
  deckSize: number;
  relics: { id: string; name: string }[];
  cards: BuildCard[];
}

export interface PlayerView {
  id: string;
  name: string;
  /** A stable display color assigned at join, so it's clear who is who. */
  color: string;
  hp: number;
  maxHp: number;
  /** Current Block. Public — visible for every player. (`null` only if unknown.) */
  block: number | null;
  isBlocking: boolean;
  energy: number | null; // hidden for opponents -> null
  maxEnergy: number;
  /** Regent Star Energy (second resource). Hidden for opponents -> null. */
  stars: number | null;
  /** Regent Forge: accumulated Sovereign Blade bonus damage. Public; 0 if unused. */
  forge: number;
  /** Whether this player uses the Regent's Star/Forge resources (HUD gating). */
  usesStars: boolean;
  powers: PowerView[];
  handCount: number;
  drawCount: number;
  discardCount: number;
  exhaustCount: number;
  /** Only present for the viewing player. */
  hand?: CardView[];
  /** Pile contents, only sent to the viewing player (for the deck viewer).
   *  Draw pile is sorted by name so it doesn't leak draw order. */
  drawPile?: CardView[];
  discardPile?: CardView[];
  exhaustPile?: CardView[];
  alive: boolean;
  /** Has this player passed during the current priority round. */
  passed: boolean;
  /** The static build (deck/relics/HP) this player brought. Visible to all. */
  build: PlayerBuild;
}

/** One attack as it actually landed during resolution (fully revealed). */
export interface ResolutionAttack {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  cardName: string;
  damage: number; // per-hit damage dealt
  times: number;
  blocked: number; // total absorbed by block
  hpLost: number; // total HP removed
  /** Target's Block before this attack landed. */
  blockBefore: number;
  /** Target's Block remaining after this attack landed. */
  blockAfter: number;
  lethal: boolean;
}

/** Block a player gained this turn, with the card that granted it. */
export interface ResolutionBlock {
  playerId: string;
  playerName: string;
  cardName: string;
  amount: number; // final block gained (after Dexterity / Frail)
}

/** End-of-turn summary shown to all players before the next turn begins. */
export interface ResolutionView {
  turn: number;
  blocks: ResolutionBlock[]; // block gained this turn (applied before attacks land)
  attacks: ResolutionAttack[];
  deaths: string[]; // names defeated this resolution
  youAcked: boolean;
  waitingOn: string[]; // names of players who haven't dismissed yet
}

/** A card-selection prompt the engine is paused on, shown only to the chooser. */
export interface PendingChoiceView {
  /** Human prompt, e.g. "Choose a card to Exhaust". */
  prompt: string;
  /** Which pile the eligible cards come from (for the heading). "discover" means
   *  the cards are freshly generated options, not drawn from an existing pile. */
  source: "hand" | "discard" | "discover";
  /** How many cards must be picked. */
  pick: number;
  /** The eligible cards to choose among. */
  cards: CardView[];
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
  /** Present while a turn's results are being shown and acknowledged. */
  resolution?: ResolutionView | null;
  /** Present (for the choosing player only) while a card-selection prompt is open. */
  pendingChoice?: PendingChoiceView | null;
  winnerId?: string | null;
  log: LogEntry[];
  /** The most recent card play, so the client can animate it. `seq` strictly
   *  increases; the client animates when it sees a new seq. */
  lastPlay?: LastPlay | null;
}

/** A transient record of the most recently played card (for play animations). */
export interface LastPlay {
  seq: number;
  playerId: string;
  cardName: string;
  cardType: CardType;
  /** The chosen target (for an attack/targeted skill), if any. */
  targetId?: string | null;
}
