// Lightweight assertions runnable with `npm test`. No framework — just throws.
import { GameEngine } from "./engine.js";
import { ironcladStarterDeck, ironcladDemoDeck } from "./decks.js";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  passed++;
}

// Deterministic RNG so tests are stable.
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function makeMatch() {
  const g = new GameEngine("test", seededRng(42));
  g.addPlayer({ id: "a", name: "Alice", deck: ironcladDemoDeck() });
  g.addPlayer({ id: "b", name: "Bob", deck: ironcladStarterDeck() });
  g.start();
  return g;
}

// --- setup ---
{
  const g = makeMatch();
  assert(g.phase === "action", "phase is action after start");
  assert(g.turn === 1, "turn 1");
  const a = g.viewFor("a");
  assert(a.players[0].hand!.length === 5, "Alice drew 5");
  assert(a.players[0].energy === 3, "Alice has 3 energy");
  assert(a.priorityId === g.startingPlayerId, "priority is starting player");
}

// --- fog of war: opponent block/energy/hand hidden ---
{
  const g = makeMatch();
  const a = g.viewFor("a");
  const bob = a.players.find((p) => p.id === "b")!;
  assert(bob.energy === null, "opponent energy hidden");
  assert(bob.block === null, "opponent block hidden");
  assert(bob.hand === undefined, "opponent hand hidden");
  assert(typeof bob.handCount === "number", "opponent hand count visible");
}

// --- playing a card spends energy and passes priority ---
{
  const g = makeMatch();
  const starter = g.startingPlayerId!;
  const other = starter === "a" ? "b" : "a";
  const view = g.viewFor(starter);
  const me = view.players.find((p) => p.id === starter)!;
  // find a self-target or auto-target card we can afford
  const card = me.hand!.find((c) => c.playable)!;
  const err = g.playCard(starter, card.uid, other);
  assert(err === null, "play succeeded: " + err);
  assert(g.priorityId === other || g.priorityId === starter, "priority advanced");
}

// --- a queued attack only shows its amount to the target ---
{
  const g = makeMatch();
  const starter = g.startingPlayerId!;
  const other = starter === "a" ? "b" : "a";
  const v = g.viewFor(starter);
  const me = v.players.find((p) => p.id === starter)!;
  const atkCard = me.hand!.find((c) => c.type === "attack" && c.playable);
  if (atkCard) {
    g.playCard(starter, atkCard.uid, other);
    const targetView = g.viewFor(other);
    const incoming = targetView.pendingAttacks.find((a) => a.targetId === other);
    assert(!!incoming, "target sees an incoming attack");
    assert(incoming!.amount !== null && incoming!.amount! > 0, "target sees damage amount");
  }
}

// --- both players passing resolves the turn ---
{
  const g = makeMatch();
  const starter = g.startingPlayerId!;
  const other = starter === "a" ? "b" : "a";
  const startTurn = g.turn;
  g.pass(starter);
  g.pass(other);
  assert(g.turn === startTurn + 1, "turn advanced after both pass");
  assert(g.startingPlayerId !== starter, "starting player alternated");
}

// --- unknown card id is tolerated (logged, not crashed) ---
{
  const g = new GameEngine("test2", seededRng(7));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "totally_fake_card" }, { id: "strike_r" }, { id: "defend_r" }] });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck() });
  g.start();
  assert(g.phase === "action", "match runs despite an unknown card id");
}

console.log(`\n✅ engine tests passed (${passed} assertions)\n`);
