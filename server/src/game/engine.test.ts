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

// --- fog of war: opponent energy/hand hidden, but block is public ---
{
  const g = makeMatch();
  const a = g.viewFor("a");
  const bob = a.players.find((p) => p.id === "b")!;
  assert(bob.energy === null, "opponent energy hidden");
  assert(typeof bob.block === "number", "opponent block visible");
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

// --- Helpers for the newer-mechanic tests ---
type Spec = { id: string };
function solo(deckA: Spec[], seed = 11, hp = 200) {
  const g = new GameEngine("solo", seededRng(seed));
  g.addPlayer({ id: "a", name: "A", deck: deckA, maxHp: hp });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: hp });
  g.start();
  return g;
}
const handOf = (g: GameEngine, id: string) =>
  g.viewFor(id).players.find((p) => p.id === id)!.hand!;
const ensure = (g: GameEngine, id: string) => {
  if (g.priorityId !== id && g.priorityId) g.pass(g.priorityId);
};
function play(g: GameEngine, id: string, cardId: string, target?: string): string | null {
  ensure(g, id);
  const c = handOf(g, id).find((x) => x.id === cardId);
  if (!c) return "not in hand";
  return g.playCard(id, c.uid, target);
}
function finishTurn(g: GameEngine) {
  let guard = 0;
  while (g.phase === "action" && guard++ < 30) g.pass(g.priorityId!);
  if (g.phase === "resolution") {
    g.acknowledgeResolution("a");
    g.acknowledgeResolution("b");
  }
}
const powerOf = (g: GameEngine, id: string, power: string) =>
  g.viewFor(id).players.find((p) => p.id === id)!.powers.find((pw) => pw.id === power)?.stacks ?? 0;
const hpOf = (g: GameEngine, id: string) => g.viewFor("a").players.find((p) => p.id === id)!.hp;

// --- Players are assigned distinct colors ---
{
  const g = solo([{ id: "strike_r" }]);
  const ps = g.viewFor("a").players;
  assert(typeof ps[0].color === "string" && ps[0].color.startsWith("#"), "player has a color");
  assert(ps[0].color !== ps[1].color, "two players get distinct colors");
}

// --- Perfected Strike scales with the number of Strike cards in the deck ---
{
  const g = solo([{ id: "perfected_strike" }, { id: "strike_r" }, { id: "strike_r" }, { id: "strike_r" }]);
  const err = play(g, "a", "perfected_strike", "b");
  assert(err === null, "perfected strike played: " + err);
  const amt = g.viewFor("b").pendingAttacks.find((x) => x.targetId === "b")!.amount;
  // 6 base + 2 per Strike (3 Strikes + Perfected Strike itself contains "Strike") = 6 + 8.
  assert(amt === 14, "Perfected Strike = 6 + 2×4 Strike cards = 14 (got " + amt + ")");
}

// --- ifTargetHasPower: Dropkick refunds energy + draws vs a Vulnerable target ---
{
  const g = solo([{ id: "bash" }, { id: "dropkick" }, { id: "strike_r" }, { id: "strike_r" }]);
  play(g, "a", "bash", "b"); // applies Vulnerable
  play(g, "a", "dropkick", "b"); // 3 - 2 (bash) - 1 (dropkick) + 1 (refund) = 1
  const energy = g.viewFor("a").players.find((p) => p.id === "a")!.energy;
  assert(energy === 1, "Dropkick refunds 1 energy vs a Vulnerable target (got " + energy + ")");
}

// --- Sever Soul exhausts non-attacks in hand ---
{
  const g = solo([{ id: "sever_soul" }, { id: "defend_r" }, { id: "strike_r" }]);
  play(g, "a", "sever_soul", "b");
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.exhaustPile!.some((c) => c.id === "defend_r"), "Sever Soul exhausted the Defend");
  assert(me.hand!.some((c) => c.id === "strike_r"), "Sever Soul kept the attack in hand");
}

// --- Ethereal: an unplayed Carnage is exhausted at end of turn ---
{
  const g = solo([{ id: "carnage" }, { id: "defend_r" }]);
  finishTurn(g); // never play Carnage; it should leave hand to the exhaust pile
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.exhaustPile!.some((c) => c.id === "carnage"), "Ethereal Carnage exhausted at end of turn");
}

// --- Dark Shackles' Strength loss is temporary (restored at end of turn) ---
{
  const g = solo([{ id: "dark_shackles" }]);
  play(g, "a", "dark_shackles", "b");
  assert(powerOf(g, "b", "strength") === -9, "Dark Shackles drops Bob to -9 Strength");
  finishTurn(g);
  assert(powerOf(g, "b", "strength") === 0, "Strength restored to 0 after the turn");
}

// --- Flame Barrier grants Thorns that expires at end of turn ---
{
  const g = solo([{ id: "flame_barrier" }]);
  play(g, "a", "flame_barrier");
  assert(powerOf(g, "a", "thorns") === 4, "Flame Barrier gives 4 Thorns");
  finishTurn(g);
  assert(powerOf(g, "a", "thorns") === 0, "Thorns expires at end of turn");
}

// --- Reaper heals the attacker for unblocked damage dealt (lifesteal) ---
{
  const g = solo([{ id: "bloodletting" }, { id: "reaper" }]);
  play(g, "a", "bloodletting"); // lose 3 HP so the heal has room to show
  assert(hpOf(g, "a") === 197, "Bloodletting cost 3 HP");
  play(g, "a", "reaper", "b"); // deals 4 to Bob, heals A for 4 (capped at max)
  finishTurn(g);
  assert(hpOf(g, "a") === 200, "Reaper's lifesteal healed A back to full");
}

// --- Approximated cards are disabled: unplayable and rejected ---
{
  const g = solo([{ id: "headbutt" }, { id: "strike_r" }]);
  const card = handOf(g, "a").find((c) => c.id === "headbutt")!;
  assert(card.playable === false, "unsupported Headbutt is shown unplayable");
  ensure(g, "a");
  const err = g.playCard("a", card.uid, "b");
  assert(err === "That card isn't supported yet.", "playing an unsupported card is rejected");
}

console.log(`\n✅ engine tests passed (${passed} assertions)\n`);
