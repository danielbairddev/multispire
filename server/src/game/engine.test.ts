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

// --- both players passing enters resolution; acks advance the turn ---
{
  const g = makeMatch();
  const starter = g.startingPlayerId!;
  const other = starter === "a" ? "b" : "a";
  const startTurn = g.turn;
  g.pass(starter);
  g.pass(other);
  // Turn now pauses on the resolution summary until every player dismisses it.
  assert(g.phase === "resolution", "both pass -> resolution phase");
  assert(g.turn === startTurn, "turn does not advance until acked");
  g.acknowledgeResolution(starter);
  assert(g.phase === "resolution", "still waiting on the other player's ack");
  g.acknowledgeResolution(other);
  assert(g.phase === "action", "back to action once everyone acked");
  assert(g.turn === startTurn + 1, "turn advanced after both ack");
  assert(g.startingPlayerId !== starter, "starting player alternated");
}

// --- Vulnerable only boosts attacks played AFTER it (order matters) ---
// Two cards fit in 3 energy (strike 1 + bash 2), so we prove each direction
// with its own mini-match: one where Strike precedes Bash, one where it follows.
function incomingAmounts(deck: { id: string }[]): number[] {
  const g = new GameEngine("order", seededRng(3));
  g.addPlayer({ id: "a", name: "A", deck, maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  const aHand = () => g.viewFor("a").players.find((p) => p.id === "a")!.hand!;
  // Play a's whole hand in deck order, passing for whoever else holds priority.
  for (const spec of deck) {
    if (g.priorityId !== "a") g.pass(g.priorityId!);
    const c = aHand().find((x) => x.id === spec.id && x.playable);
    if (c) g.playCard("a", c.uid, "b");
  }
  return g
    .viewFor("b")
    .pendingAttacks.filter((x) => x.targetId === "b")
    .map((x) => x.amount ?? 0)
    .sort((m, n) => m - n);
}
{
  // Strike BEFORE Bash: the strike is frozen at 6 (no Vulnerable yet).
  const before = incomingAmounts([{ id: "strike_r" }, { id: "bash" }]);
  assert(before.includes(6), "Strike played before Bash stays at 6");
  assert(before.includes(8), "Bash hits for 8 (never boosts itself)");
}
{
  // Strike AFTER Bash: target is now Vulnerable, so 6 -> 9 (x1.5).
  const after = incomingAmounts([{ id: "bash" }, { id: "strike_r" }]);
  assert(after.includes(8), "Bash hits for 8 even when it applies Vulnerable");
  assert(after.includes(9), "Strike played after Bash is boosted to 9");
}

// --- Flex grants temporary Strength that expires at end of turn ---
{
  // A Strike played after Flex is boosted (6 + 2 = 8), frozen at play time.
  const boosted = incomingAmounts([{ id: "flex" }, { id: "strike_r" }]);
  assert(boosted.includes(8), "Strike after Flex is boosted to 8");

  // And that Strength reverts once the turn resolves.
  const g = new GameEngine("flex", seededRng(5));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "flex" }], maxHp: 100 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 100 });
  g.start();
  const strOf = () =>
    g.viewFor("a").players.find((x) => x.id === "a")!.powers.find((pw) => pw.id === "strength")?.stacks ?? 0;
  if (g.priorityId !== "a") g.pass(g.priorityId!);
  const flex = g.viewFor("a").players.find((p) => p.id === "a")!.hand!.find((c) => c.id === "flex")!;
  g.playCard("a", flex.uid);
  assert(strOf() === 2, "Strength is 2 right after Flex");
  let guard = 0;
  while (g.phase === "action" && guard++ < 12) g.pass(g.priorityId!);
  g.acknowledgeResolution("a");
  g.acknowledgeResolution("b");
  assert(strOf() === 0, "Strength reverts to 0 at end of turn");
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
