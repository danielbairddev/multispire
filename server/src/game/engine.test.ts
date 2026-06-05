// Lightweight assertions runnable with `npm test`. No framework — just throws.
import { GameEngine } from "./engine.js";
import { ironcladStarterDeck, ironcladDemoDeck } from "./decks.js";
import { resolveCard, canonicalCardId } from "./cards/registry.js";

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
type Spec = { id: string; upgraded?: boolean };
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

// --- Headbutt: deals damage, then pauses to put a discard card on top of draw ---
{
  const g = solo([{ id: "strike_r" }, { id: "strike_r" }, { id: "headbutt" }]);
  play(g, "a", "strike_r", "b");
  play(g, "a", "strike_r", "b"); // build up a discard pile to choose from
  play(g, "a", "headbutt", "b");
  const atk = g.viewFor("b").pendingAttacks.find((x) => x.targetId === "b" && x.amount === 9);
  assert(!!atk, "Headbutt queued 9 damage");
  const pc = g.viewFor("a").pendingChoice;
  assert(!!pc && pc.source === "discard", "Headbutt opens a discard selection");
  // Other actions are blocked while a selection is pending.
  assert(g.pass("a") === "Resolve the current card selection first.", "pass blocked during a choice");
  const strike = pc!.cards.find((c) => c.id === "strike_r")!;
  assert(g.resolveChoice("a", [strike.uid]) === null, "resolveChoice succeeds");
  assert(g.viewFor("a").pendingChoice == null, "choice cleared after resolving");
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.drawPile!.some((c) => c.id === "strike_r"), "chosen Strike went onto the draw pile");
}

// --- Blood for Blood: cost drops by 1 for each time you've lost HP this combat ---
{
  const g = solo([{ id: "blood_for_blood" }, { id: "bloodletting" }]);
  let bfb = handOf(g, "a").find((c) => c.id === "blood_for_blood")!;
  assert(bfb.cost === 4, "Blood for Blood starts at cost 4 (got " + bfb.cost + ")");
  play(g, "a", "bloodletting"); // loseHp 3 -> one HP-loss event
  bfb = handOf(g, "a").find((c) => c.id === "blood_for_blood")!;
  assert(bfb.cost === 3, "Blood for Blood drops to 3 after losing HP once (got " + bfb.cost + ")");
}

// --- Spot Weakness: gains Strength only if an opponent is attacking you ---
{
  const g = solo([{ id: "spot_weakness" }]);
  play(g, "a", "spot_weakness");
  assert(powerOf(g, "a", "strength") === 0, "Spot Weakness gives nothing with no incoming attack");
}
{
  const g = solo([{ id: "spot_weakness" }, { id: "defend_r" }]);
  play(g, "b", "strike_r", "a"); // Bob queues an attack on Alice first
  play(g, "a", "spot_weakness");
  assert(powerOf(g, "a", "strength") === 3, "Spot Weakness grants 3 Strength vs an incoming attack");
}

// --- Burning Pact: exhaust a chosen hand card, then draw ---
{
  const g = solo([{ id: "burning_pact" }, { id: "strike_r" }, { id: "defend_r" }, { id: "bash" }]);
  play(g, "a", "burning_pact");
  const pc = g.viewFor("a").pendingChoice;
  assert(!!pc && pc.source === "hand", "Burning Pact opens a hand selection");
  const defend = pc!.cards.find((c) => c.id === "defend_r")!;
  g.resolveChoice("a", [defend.uid]);
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.exhaustPile!.some((c) => c.id === "defend_r"), "Burning Pact exhausted the chosen Defend");
  assert(g.viewFor("a").pendingChoice == null, "Burning Pact choice cleared");
}

// --- Warcry: draw, then put a chosen hand card on top of draw; exhausts itself ---
{
  const g = solo([{ id: "warcry" }, { id: "strike_r" }, { id: "defend_r" }, { id: "bash" }, { id: "clash" }]);
  play(g, "a", "warcry");
  const pc = g.viewFor("a").pendingChoice;
  assert(!!pc && pc.source === "hand", "Warcry opens a hand selection");
  const strike = pc!.cards.find((c) => c.id === "strike_r")!;
  g.resolveChoice("a", [strike.uid]);
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.exhaustPile!.some((c) => c.id === "warcry"), "Warcry exhausted itself");
  assert(me.drawPile!.some((c) => c.id === "strike_r"), "Warcry put the chosen card on top of draw");
}

// --- Regent helpers ---
function regentSolo(deckA: Spec[], seed = 7, hp = 200) {
  const g = new GameEngine("regent", seededRng(seed));
  g.addPlayer({ id: "a", name: "A", deck: deckA, relics: ["divine_right"], maxHp: hp });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: hp });
  g.start();
  return g;
}
const starsOf = (g: GameEngine, id: string) =>
  g.viewFor(id).players.find((p) => p.id === id)!.stars ?? 0;
const forgeOf = (g: GameEngine, id: string) =>
  g.viewFor(id).players.find((p) => p.id === id)!.forge;

// --- Regent: Star Energy economy (Divine Right grant, Venerate gain, spend) ---
{
  const g = regentSolo([
    { id: "venerate" },
    { id: "falling_star" },
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "cloak_of_stars" },
  ]);
  const me0 = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me0.usesStars === true, "Regent uses Star Energy");
  assert(starsOf(g, "a") === 3, "Divine Right grants 3 starting Stars");
  assert(g.viewFor("b").players.find((p) => p.id === "a")!.stars === null, "opponent Star Energy hidden");
  assert(play(g, "a", "venerate") === null, "Venerate plays");
  assert(starsOf(g, "a") === 5, "Venerate adds 2 Stars (3 -> 5)");
  const before = hpOf(g, "b");
  assert(play(g, "a", "falling_star", "b") === null, "Falling Star plays");
  assert(starsOf(g, "a") === 3, "Falling Star spends 2 Stars (5 -> 3)");
  assert(powerOf(g, "b", "vulnerable") >= 1, "Falling Star applies Vulnerable");
  finishTurn(g);
  assert(hpOf(g, "b") < before, "Falling Star dealt damage at resolution");
}

// --- Regent: not enough Star Energy blocks the play ---
{
  const g = regentSolo([
    { id: "comet" }, // starCost 5, we only have 3
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "comet", "b") === "Not enough Star Energy.", "Comet rejected without 5 Stars");
}

// --- Regent: Forge grants the Sovereign Blade, which strikes for the Forge ---
{
  const g = regentSolo([
    { id: "bulwark" }, // block 13 + forge 10
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "bulwark") === null, "Bulwark plays");
  assert(forgeOf(g, "a") === 10, "Bulwark forges 10");
  assert(handOf(g, "a").some((c) => c.id === "sovereign_blade"), "first Forge grants Sovereign Blade to hand");
  finishTurn(g); // Blade has Retain, so it stays in hand into turn 2
  assert(handOf(g, "a").some((c) => c.id === "sovereign_blade"), "Sovereign Blade retained into next turn");
  const before = hpOf(g, "b");
  assert(play(g, "a", "sovereign_blade", "b") === null, "Sovereign Blade plays");
  assert(g.viewFor("a").players.find((p) => p.id === "a")!.drawPile!.some((c) => c.id === "sovereign_blade"),
    "Sovereign Blade reshuffles into the draw pile after use");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 10, "Sovereign Blade deals damage equal to Forge (10)");
}

// --- Regent: Crescent Spear scales with Star-cost cards in hand ---
{
  const g = regentSolo([
    { id: "crescent_spear" }, // 6 + 2 per Star-cost card in hand
    { id: "falling_star" }, // Star-cost card
    { id: "cloak_of_stars" }, // Star-cost card
    { id: "strike_reg" },
    { id: "defend_reg" },
  ]);
  const before = hpOf(g, "b");
  assert(play(g, "a", "crescent_spear", "b") === null, "Crescent Spear plays");
  finishTurn(g);
  // After it leaves hand, 2 Star-cost cards remain: 6 + 2*2 = 10.
  assert(before - hpOf(g, "b") === 10, "Crescent Spear deals 6 + 2 per Star-cost card (10)");
}

// --- Regent: BEGONE!! transforms a hand card into a Minion Strike token ---
{
  const g = regentSolo([
    { id: "begone" },
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(!handOf(g, "a").some((c) => c.id === "minion_strike"), "no Minion Strike before BEGONE");
  assert(play(g, "a", "begone") === null, "BEGONE plays");
  assert(handOf(g, "a").some((c) => c.id === "minion_strike"), "BEGONE created a Minion Strike in hand");
}

// --- Regent: Beat into Shape forges more per OTHER attack played this turn ---
{
  const g = regentSolo([
    { id: "strike_reg" }, // an attack played first
    { id: "beat_into_shape" }, // forge 5 + 5 per other attack this turn
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "strike_reg", "b") === null, "Strike plays (1st attack)");
  assert(forgeOf(g, "a") === 0, "no Forge before Beat into Shape");
  assert(play(g, "a", "beat_into_shape", "b") === null, "Beat into Shape plays");
  // attacksThisTurn = 2 (strike + beat); otherAttacks = 1 -> forge 5 + 5*1 = 10.
  assert(forgeOf(g, "a") === 10, "Beat into Shape forges 5 + 5 per other attack (10)");
}

// --- Regent: Bombardment auto-plays from Exhaust each turn ---
{
  const g = regentSolo([
    { id: "bombardment" }, // cost 3, exhaust, auto-plays from exhaust
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const before = hpOf(g, "b");
  assert(play(g, "a", "bombardment", "b") === null, "Bombardment plays");
  assert(g.viewFor("a").players.find((p) => p.id === "a")!.exhaustCount >= 1, "Bombardment exhausts");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 18, "Bombardment deals 18 on first play");
  // On the owner's next turn it auto-plays from the Exhaust pile for another 18.
  finishTurn(g);
  assert(before - hpOf(g, "b") === 36, "Bombardment auto-plays from Exhaust for another 18 (36)");
}

// --- Regent: Bundle of Joy adds 3 random Colorless cards to hand ---
{
  const g = regentSolo([
    { id: "bundle_of_joy" }, // exhaust, add 3 random neutral cards to hand
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const beforeUids = new Set(handOf(g, "a").map((c) => c.uid));
  const before = beforeUids.size;
  assert(play(g, "a", "bundle_of_joy") === null, "Bundle of Joy plays");
  // -1 for the played-and-exhausted Bundle, +3 freshly created cards.
  assert(handOf(g, "a").length === before - 1 + 3, "Bundle of Joy nets +2 cards in hand");
  const added = handOf(g, "a").filter((c) => !beforeUids.has(c.uid));
  assert(added.length === 3, "Bundle of Joy added 3 new cards to hand");
}

// --- Regent: Collision Course adds a Debris to hand ---
{
  const g = regentSolo([
    { id: "collision_course" }, // damage 11 + add Debris to hand
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const before = hpOf(g, "b");
  assert(play(g, "a", "collision_course", "b") === null, "Collision Course plays");
  assert(handOf(g, "a").some((c) => c.id === "debris"), "Collision Course adds Debris to hand");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 11, "Collision Course deals 11");
}

// --- Regent: Crash Landing fills the hand with Debris ---
{
  const g = regentSolo([
    { id: "crash_landing" }, // all_enemies damage 21 + fill hand with Debris
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const before = hpOf(g, "b");
  assert(play(g, "a", "crash_landing", "b") === null, "Crash Landing plays");
  assert(handOf(g, "a").length === 5, "Crash Landing fills the hand (5)");
  assert(handOf(g, "a").some((c) => c.id === "debris"), "Crash Landing adds Debris");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 21, "Crash Landing deals 21");
}

// --- Regent: Convergence grants energy + Stars next turn ---
{
  const g = regentSolo([
    { id: "convergence" }, // next turn: +1 energy, +1 Star, retain hand
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "convergence") === null, "Convergence plays");
  const stars0 = starsOf(g, "a"); // 3, unspent by Convergence
  finishTurn(g);
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.energy === 4, "Convergence grants +1 energy next turn (4)");
  assert(starsOf(g, "a") === stars0 + 1, "Convergence grants +1 Star next turn");
}

// --- Regent: Decisions, Decisions replays a chosen Skill 3 times ---
{
  const g = regentSolo([
    { id: "venerate" }, // +2 Stars
    { id: "venerate" }, // +2 Stars (3 -> 7, enough for starCost 6)
    { id: "decisions_decisions" }, // draw 3, then replay a chosen Skill x3
    { id: "defend_reg" }, // the Skill we'll replay (block 5)
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "venerate") === null, "Venerate 1 plays");
  assert(play(g, "a", "venerate") === null, "Venerate 2 plays");
  assert(starsOf(g, "a") === 7, "two Venerates bring Stars to 7");
  assert(play(g, "a", "decisions_decisions") === null, "Decisions, Decisions plays");
  assert(starsOf(g, "a") === 1, "Decisions spends 6 Stars (7 -> 1)");
  const pc = g.viewFor("a").pendingChoice;
  assert(pc != null, "Decisions pauses for a Skill choice");
  assert(pc!.cards.every((c) => c.type === "skill"), "only Skills are offered to replay");
  const defend = handOf(g, "a").find((c) => c.id === "defend_reg")!;
  assert(g.resolveChoice("a", [defend.uid]) === null, "replay choice resolves");
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.block === 15, "Decisions replays Defend 3 times for 15 block");
}

const blockOf = (g: GameEngine, id: string) =>
  g.viewFor(id).players.find((p) => p.id === id)!.block;

// --- Regent: Summon Forth forges and pulls the Sovereign Blade into hand ---
{
  const g = regentSolo([
    { id: "summon_forth" },
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "summon_forth") === null, "Summon Forth plays");
  assert(forgeOf(g, "a") === 8, "Summon Forth forges 8");
  assert(handOf(g, "a").some((c) => c.id === "sovereign_blade"), "Sovereign Blade is in hand");
}

// --- Regent: Particle Wall returns itself to hand ---
{
  const g = regentSolo([
    { id: "particle_wall" }, // starCost 2, gain 9 block, return to hand
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const uidBefore = handOf(g, "a").find((c) => c.id === "particle_wall")!.uid;
  assert(play(g, "a", "particle_wall") === null, "Particle Wall plays");
  assert(blockOf(g, "a") === 9, "Particle Wall grants 9 Block");
  assert(handOf(g, "a").some((c) => c.id === "particle_wall"), "Particle Wall returned to hand");
  assert(handOf(g, "a").find((c) => c.id === "particle_wall")!.uid === uidBefore, "same card instance returned");
}

// --- Regent: Knockout Blow grants Stars when it kills ---
{
  // A low-HP opponent so the 30-damage blow is lethal.
  const g = new GameEngine("ko", seededRng(7));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [
      { id: "knockout_blow" },
      { id: "strike_reg" },
      { id: "defend_reg" },
      { id: "venerate" },
      { id: "cloak_of_stars" },
    ],
    relics: ["divine_right"],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 12 });
  g.start();
  const stars0 = g.viewFor("a").players.find((p) => p.id === "a")!.stars ?? 0;
  assert(play(g, "a", "knockout_blow", "b") === null, "Knockout Blow plays");
  finishTurn(g);
  const after = g.viewFor("a").players.find((p) => p.id === "a")!.stars ?? 0;
  assert(after === stars0 + 5, "Knockout Blow grants 5 Stars on a lethal hit");
}

// --- Regent: Genesis grants Stars at the start of each turn ---
{
  const g = regentSolo([
    { id: "genesis" }, // power: start of turn gain 2 Stars
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "genesis") === null, "Genesis plays");
  const stars0 = starsOf(g, "a");
  finishTurn(g);
  assert(starsOf(g, "a") === stars0 + 2, "Genesis grants 2 Stars at the start of next turn");
}

// --- Regent: Terraforming Vigor boosts the next Attack, then is consumed ---
{
  const g = regentSolo([
    { id: "terraforming" }, // gain 6 Vigor
    { id: "strike_reg" }, // 6 base + 6 Vigor = 12
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  assert(play(g, "a", "terraforming") === null, "Terraforming plays");
  assert(powerOf(g, "a", "vigor") === 6, "Terraforming grants 6 Vigor");
  const before = hpOf(g, "b");
  assert(play(g, "a", "strike_reg", "b") === null, "Strike plays");
  assert(powerOf(g, "a", "vigor") === 0, "Vigor consumed by the Attack");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 12, "Vigor adds +6 to the 6-damage Strike (12)");
}

// --- Regent relic: Fencing Manual forges 10 at combat start ---
{
  const g = new GameEngine("fm", seededRng(7));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [
      { id: "strike_reg" },
      { id: "defend_reg" },
      { id: "venerate" },
      { id: "cloak_of_stars" },
      { id: "celestial_might" },
    ],
    relics: ["divine_right", "fencing_manual"],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  assert(forgeOf(g, "a") === 10, "Fencing Manual forges 10 at the start of combat");
  assert(handOf(g, "a").some((c) => c.id === "sovereign_blade"), "Sovereign Blade granted by the opening Forge");
}

// --- Regent relic: Lunar Pastry grants a Star at end of turn ---
{
  const g = new GameEngine("lp", seededRng(7));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [
      { id: "strike_reg" },
      { id: "defend_reg" },
      { id: "venerate" },
      { id: "cloak_of_stars" },
      { id: "celestial_might" },
    ],
    relics: ["divine_right", "lunar_pastry"],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  const stars0 = g.viewFor("a").players.find((p) => p.id === "a")!.stars ?? 0;
  finishTurn(g);
  assert((g.viewFor("a").players.find((p) => p.id === "a")!.stars ?? 0) >= stars0 + 1, "Lunar Pastry adds a Star at end of turn");
}

const energyOf = (g: GameEngine, id: string) =>
  g.viewFor(id).players.find((p) => p.id === id)!.energy ?? 0;

// --- Regent: Monologue grants temporary Strength per card played this turn ---
{
  const g = regentSolo([{ id: "monologue" }, { id: "strike_reg" }, { id: "defend_reg" }]);
  assert(play(g, "a", "monologue") === null, "Monologue plays");
  // Playing Monologue itself doesn't grant Strength (power applies after the hook).
  assert(powerOf(g, "a", "strength") === 0, "Monologue: no Strength before another card");
  assert(play(g, "a", "strike_reg", "b") === null, "Strike plays under Monologue");
  assert(powerOf(g, "a", "strength") === 1, "Monologue: +1 Strength after a card play");
  assert(play(g, "a", "defend_reg") === null, "Defend plays under Monologue");
  assert(powerOf(g, "a", "strength") === 2, "Monologue: +1 more Strength per card");
  finishTurn(g);
  // Temporary Strength expires at end of turn.
  assert(powerOf(g, "a", "strength") === 0, "Monologue Strength is temporary");
}

// --- Regent: Reflect deals blocked damage back to the attacker ---
{
  const g = new GameEngine("refl", seededRng(7));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "reflect" }, { id: "defend_reg" }], relics: ["divine_right"], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: [{ id: "strike_r" }, { id: "strike_r" }, { id: "strike_r" }], maxHp: 200 });
  g.start();
  assert(play(g, "a", "reflect") === null, "Reflect plays (1 energy, 3 Stars)");
  assert(powerOf(g, "a", "reflect") === 1, "Reflect power applied");
  const bBefore = hpOf(g, "b");
  assert(play(g, "b", "strike_r", "a") === null, "B strikes A");
  finishTurn(g);
  // A had 17 Block; B's 6-damage Strike is fully blocked, and 6 reflects back to B.
  assert(hpOf(g, "b") === bBefore - 6, "Reflect deals the blocked 6 back to B (got " + (bBefore - hpOf(g, "b")) + ")");
  assert(powerOf(g, "a", "reflect") === 0, "Reflect clears at end of turn");
}

// --- Regent: Orbit refunds 1 Energy for every 4 Energy spent this combat ---
{
  const g = new GameEngine("orb", seededRng(7));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "orbit" }, { id: "defend_reg" }, { id: "defend_reg" }, { id: "strike_reg" }],
    relics: ["divine_right", "philosophers_stone"],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  assert(energyOf(g, "a") === 4, "Philosopher's Stone gives 4 energy");
  assert(play(g, "a", "orbit") === null, "Orbit plays (cost 2)"); // spent 2, energy 2
  assert(play(g, "a", "defend_reg") === null, "first Defend plays"); // spent 3, energy 1
  assert(play(g, "a", "defend_reg") === null, "second Defend plays"); // spent 4 -> refund 1
  assert(energyOf(g, "a") === 1, "Orbit refunds 1 Energy at 4 spent (got " + energyOf(g, "a") + ")");
}

// --- Regent: Make It So returns to hand on your 3rd Skill this turn ---
{
  const g = regentSolo([
    { id: "make_it_so" },
    { id: "defend_reg" },
    { id: "defend_reg" },
    { id: "defend_reg" },
  ]);
  assert(play(g, "a", "make_it_so", "b") === null, "Make It So plays");
  assert(!handOf(g, "a").some((c) => c.id === "make_it_so"), "Make It So left hand");
  play(g, "a", "defend_reg");
  play(g, "a", "defend_reg");
  assert(!handOf(g, "a").some((c) => c.id === "make_it_so"), "not back after 2 Skills");
  play(g, "a", "defend_reg");
  assert(handOf(g, "a").some((c) => c.id === "make_it_so"), "Make It So returns to hand after the 3rd Skill");
}

// --- Regent: Heavenly Drill deals X hits (X = Energy spent), doubled at 4+ ---
{
  const g = regentSolo([{ id: "heavenly_drill" }]);
  const bBefore = hpOf(g, "b");
  assert(play(g, "a", "heavenly_drill", "b") === null, "Heavenly Drill plays for X");
  finishTurn(g);
  // 3 energy -> X=3 (not doubled) -> 3 hits of 8 = 24.
  assert(hpOf(g, "b") === bBefore - 24, "Heavenly Drill: 3 hits of 8 = 24 (got " + (bBefore - hpOf(g, "b")) + ")");
}
{
  const g = new GameEngine("hd2", seededRng(7));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "heavenly_drill" }], relics: ["divine_right", "philosophers_stone"], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  const bBefore = hpOf(g, "b");
  assert(play(g, "a", "heavenly_drill", "b") === null, "Heavenly Drill plays with 4 energy");
  finishTurn(g);
  // 4 energy -> X=4 -> doubled to 8 hits of 8 = 64.
  assert(hpOf(g, "b") === bBefore - 64, "Heavenly Drill doubles X at 4+: 8 hits of 8 = 64 (got " + (bBefore - hpOf(g, "b")) + ")");
}

// --- Regent: Stardust spends all Stars, hitting random enemies X times ---
{
  const g = regentSolo([{ id: "stardust" }]);
  assert(starsOf(g, "a") === 3, "Divine Right grants 3 Stars for Stardust");
  const bBefore = hpOf(g, "b");
  assert(play(g, "a", "stardust", "b") === null, "Stardust plays");
  assert(starsOf(g, "a") === 0, "Stardust spends all Star Energy");
  finishTurn(g);
  // X = 3 Stars spent -> 3 hits of 5 = 15 (single opponent, so all land on B).
  assert(hpOf(g, "b") === bBefore - 15, "Stardust: 3 hits of 5 = 15 (got " + (bBefore - hpOf(g, "b")) + ")");
}

// =====================================================================
// Silent mechanics
// =====================================================================

// --- Poison: deals damage (ignoring Block) at start of turn, then drops by 1 ---
{
  const g = solo([{ id: "deadly_poison" }]);
  assert(play(g, "a", "deadly_poison", "b") === null, "Deadly Poison plays");
  assert(powerOf(g, "b", "poison") === 5, "Deadly Poison applies 5 Poison");
  const bBefore = hpOf(g, "b");
  finishTurn(g); // advance the turn so the Poison ticks at beginTurn
  assert(hpOf(g, "b") === bBefore - 5, "Poison deals 5 damage at start of turn");
  assert(powerOf(g, "b", "poison") === 4, "Poison drops to 4 after ticking");
}

// --- Shivs get Accuracy's bonus damage ---
{
  const g = solo([{ id: "accuracy" }, { id: "blade_dance" }]);
  assert(play(g, "a", "accuracy") === null, "Accuracy (power) plays");
  assert(play(g, "a", "blade_dance") === null, "Blade Dance adds Shivs");
  assert(handOf(g, "a").filter((c) => c.id === "shiv").length === 3, "Blade Dance adds 3 Shivs");
  const bBefore = hpOf(g, "b");
  assert(play(g, "a", "shiv", "b") === null, "Shiv plays");
  finishTurn(g);
  // 4 base + 4 Accuracy = 8.
  assert(hpOf(g, "b") === bBefore - 8, "Shiv deals 4 + 4 Accuracy = 8 (got " + (bBefore - hpOf(g, "b")) + ")");
}

// --- Skewer deals X hits (X = Energy spent) ---
{
  const g = solo([{ id: "skewer" }]);
  const bBefore = hpOf(g, "b");
  assert(play(g, "a", "skewer", "b") === null, "Skewer plays for X");
  finishTurn(g);
  // 3 energy -> X=3 -> 3 hits of 7 = 21.
  assert(hpOf(g, "b") === bBefore - 21, "Skewer: 3 hits of 7 = 21 (got " + (bBefore - hpOf(g, "b")) + ")");
}

// --- Catalyst multiplies the target's Poison ---
{
  const g = solo([{ id: "deadly_poison" }, { id: "catalyst" }]);
  play(g, "a", "deadly_poison", "b"); // 5 Poison
  assert(play(g, "a", "catalyst", "b") === null, "Catalyst plays");
  assert(powerOf(g, "b", "poison") === 10, "Catalyst doubles Poison 5 -> 10");
}

// --- A Thousand Cuts deals damage whenever you play a card ---
{
  const g = solo([{ id: "a_thousand_cuts" }, { id: "defend_g" }]);
  assert(play(g, "a", "a_thousand_cuts") === null, "A Thousand Cuts (power) plays");
  const bBefore = hpOf(g, "b");
  play(g, "a", "defend_g"); // playing any card triggers 1 damage to all enemies
  assert(hpOf(g, "b") === bBefore - 1, "A Thousand Cuts deals 1 on each card play");
}

// --- After Image grants Block whenever you play a card ---
{
  const g = solo([{ id: "after_image" }, { id: "defend_g" }]);
  assert(play(g, "a", "after_image") === null, "After Image (power) plays");
  const blockBefore = blockOf(g, "a") ?? 0;
  play(g, "a", "defend_g"); // +5 Defend block, +1 After Image
  assert(blockOf(g, "a") === blockBefore + 6, "After Image adds 1 Block on top of Defend's 5");
}

// --- Envenom applies Poison on unblocked attack damage ---
{
  const g = solo([{ id: "envenom" }, { id: "strike_g" }]);
  assert(play(g, "a", "envenom") === null, "Envenom (power) plays");
  play(g, "a", "strike_g", "b");
  // Resolve damage without acking so Poison hasn't ticked away yet.
  let guard = 0;
  while (g.phase === "action" && guard++ < 30) g.pass(g.priorityId!);
  assert(powerOf(g, "b", "poison") === 1, "Envenom applies 1 Poison on unblocked hit");
}

// --- Noxious Fumes applies Poison to all enemies at the start of your turn ---
{
  const g = solo([{ id: "noxious_fumes" }]);
  assert(play(g, "a", "noxious_fumes") === null, "Noxious Fumes (power) plays");
  assert(powerOf(g, "a", "noxious_fumes") === 2, "Noxious Fumes power is 2");
  finishTurn(g);
  assert(powerOf(g, "b", "poison") >= 1, "Noxious Fumes applied Poison to the enemy next turn");
}

// --- Survivor: discard a chosen card ---
{
  const g = solo([{ id: "survivor" }, { id: "strike_g" }, { id: "defend_g" }]);
  assert(play(g, "a", "survivor") === null, "Survivor plays");
  assert(blockOf(g, "a") === 8, "Survivor grants 8 Block");
  const pc = g.viewFor("a").pendingChoice;
  assert(!!pc, "Survivor opens a discard choice");
  const strike = handOf(g, "a").find((c) => c.id === "strike_g")!;
  assert(g.resolveChoice("a", [strike.uid]) === null, "discard choice resolves");
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.discardPile!.some((c) => c.id === "strike_g"), "chosen card moved to the discard pile");
}

// --- Calculated Gamble: discard the whole hand, draw that many, then exhaust ---
{
  const g = solo([{ id: "calculated_gamble" }, { id: "strike_g" }, { id: "defend_g" }]);
  assert(play(g, "a", "calculated_gamble") === null, "Calculated Gamble plays");
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.exhaustPile!.some((c) => c.id === "calculated_gamble"), "Calculated Gamble exhausts itself");
  // The 2 remaining cards are discarded then 2 are redrawn (reshuffled from discard).
  assert(handOf(g, "a").length === 2, "discarded 2 and redrew 2 (got " + handOf(g, "a").length + ")");
}

// --- Grand Finale: only lands when the draw pile is empty ---
{
  // Two-card deck: both are drawn into hand, so the draw pile is empty.
  const g = solo([{ id: "grand_finale" }, { id: "strike_g" }]);
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.drawCount === 0, "draw pile empty when whole deck is in hand");
  const bBefore = hpOf(g, "b");
  assert(play(g, "a", "grand_finale", "b") === null, "Grand Finale plays");
  finishTurn(g);
  assert(hpOf(g, "b") === bBefore - 60, "Grand Finale deals 60 with an empty draw pile");
}
{
  // Pad the deck so cards remain in the draw pile -> Grand Finale fizzles.
  const g = solo([
    { id: "grand_finale" },
    { id: "strike_g" },
    { id: "strike_g" },
    { id: "strike_g" },
    { id: "strike_g" },
    { id: "strike_g" },
    { id: "strike_g" },
  ]);
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.drawCount > 0, "draw pile non-empty with a padded deck");
  const bBefore = hpOf(g, "b");
  play(g, "a", "grand_finale", "b");
  finishTurn(g);
  assert(hpOf(g, "b") === bBefore, "Grand Finale deals 0 when the draw pile is not empty");
}

// --- Glass Knife: damage decreases by 2 each time it's played ---
{
  const g = solo([{ id: "glass_knife" }]);
  ensure(g, "a");
  const knife = handOf(g, "a").find((c) => c.id === "glass_knife")!;
  const bBefore = hpOf(g, "b");
  g.playCard("a", knife.uid, "b"); // first play: 8 x2 = 16
  finishTurn(g);
  assert(hpOf(g, "b") === bBefore - 16, "Glass Knife first play = 8 x2 = 16 (got " + (bBefore - hpOf(g, "b")) + ")");
  const b2 = hpOf(g, "b");
  // The same instance returns to hand next turn (single-card deck), now dealing 6 x2.
  ensure(g, "a");
  const knife2 = handOf(g, "a").find((c) => c.id === "glass_knife");
  if (knife2) {
    g.playCard("a", knife2.uid, "b");
    finishTurn(g);
    assert(hpOf(g, "b") === b2 - 12, "Glass Knife second play = 6 x2 = 12 (got " + (b2 - hpOf(g, "b")) + ")");
  }
}

// --- Unload: deal damage, then discard all non-Attack cards from hand ---
{
  const g = solo([{ id: "unload" }, { id: "strike_g" }, { id: "defend_g" }, { id: "footwork" }]);
  assert(play(g, "a", "unload", "b") === null, "Unload plays");
  const me = g.viewFor("a").players.find((p) => p.id === "a")!;
  assert(me.hand!.some((c) => c.id === "strike_g"), "Unload keeps the Attack in hand");
  assert(!me.hand!.some((c) => c.id === "defend_g"), "Unload discarded the Skill");
  assert(!me.hand!.some((c) => c.id === "footwork"), "Unload discarded the Power");
  assert(me.discardPile!.some((c) => c.id === "defend_g"), "discarded Skill is in the discard pile");
}

// --- Wraith Form: gain Intangible now, lose Dexterity each turn ---
{
  const g = solo([{ id: "wraith_form" }]);
  assert(play(g, "a", "wraith_form") === null, "Wraith Form plays");
  assert(powerOf(g, "a", "intangible") === 2, "Wraith Form grants 2 Intangible");
  assert(powerOf(g, "a", "wraith_form") === 1, "Wraith Form power applied");
  finishTurn(g); // start of next turn drains 1 Dexterity
  assert(powerOf(g, "a", "dexterity") === -1, "Wraith Form drains 1 Dexterity per turn (got " + powerOf(g, "a", "dexterity") + ")");
}

// --- Eviscerate: costs 1 less per card discarded this turn ---
{
  const g = new GameEngine("evis", seededRng(11));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "eviscerate" }, { id: "survivor" }, { id: "strike_g" }], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  const evisCard = () => g.viewFor("a").players.find((p) => p.id === "a")!.hand!.find((c) => c.id === "eviscerate");
  assert(evisCard()!.cost === 3, "Eviscerate base cost is 3");
  play(g, "a", "survivor"); // discards 1 (chosen)
  const strike = handOf(g, "a").find((c) => c.id === "strike_g")!;
  g.resolveChoice("a", [strike.uid]);
  assert(evisCard()!.cost === 2, "Eviscerate costs 1 less after one discard (got " + evisCard()!.cost + ")");
}

// --- Corpse Explosion: a Poison death detonates for the target's Max HP ---
{
  // Three players so the explosion has a third target to hit.
  const g = new GameEngine("corpse", seededRng(5));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "corpse_explosion" }], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 8 });
  g.addPlayer({ id: "c", name: "C", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  // Ensure A holds priority to play, then drop a heavy Poison on B.
  if (g.priorityId !== "a") g.pass(g.priorityId!);
  const ce = handOf(g, "a").find((x) => x.id === "corpse_explosion")!;
  g.playCard("a", ce.uid, "b");
  assert(powerOf(g, "b", "poison") === 6, "Corpse Explosion applies 6 Poison");
  assert(powerOf(g, "b", "corpse_explosion") === 1, "Corpse Explosion power applied");
  const cBefore = hpOf(g, "c");
  const aliveOf = (id: string) => g.viewFor("a").players.find((p) => p.id === id)!.alive;
  // A 3-player-aware turn finisher: everyone passes, then every alive player acks.
  const endTurn3 = () => {
    let g2 = 0;
    while (g.phase === "action" && g2++ < 30) g.pass(g.priorityId!);
    if (g.phase === "resolution") for (const id of ["a", "b", "c"]) if (aliveOf(id)) g.acknowledgeResolution(id);
  };
  // Run turns until B dies of Poison (6 -> 5 -> ... each start of turn).
  let guard = 0;
  while (aliveOf("b") && g.phase !== "gameover" && guard++ < 10) endTurn3();
  assert(!aliveOf("b"), "B dies to Poison");
  assert(hpOf(g, "c") < cBefore, "Corpse Explosion damaged the third player on B's death");
}

// --- Void Form: the first 2 cards each turn cost 0 ---
{
  const g = regentSolo([
    { id: "void_form" }, // power, cost 3
    { id: "strike_reg" }, // cost 1
    { id: "strike_reg" }, // cost 1
    { id: "defend_reg" },
    { id: "cloak_of_stars" },
  ]);
  ensure(g, "a");
  assert(energyOf(g, "a") === 3, "starts with 3 energy");
  assert(play(g, "a", "void_form") === null, "Void Form plays");
  assert(powerOf(g, "a", "void_form") === 2, "Void Form grants 2 stacks");
  assert(energyOf(g, "a") === 0, "Void Form cost all 3 energy");
  // First card after Void Form (the 2nd card played) is free.
  assert(play(g, "a", "strike_reg", "b") === null, "1st Strike is free under Void Form");
  assert(energyOf(g, "a") === 0, "still 0 energy after free Strike");
  // Third card played: no longer free, and we have no energy -> rejected.
  assert(play(g, "a", "strike_reg", "b") === "Not enough energy.", "3rd card costs energy again");
}

// --- Heirloom Hammer: deal 20 and copy a chosen Colorless card in hand ---
{
  const g = regentSolo([
    { id: "heirloom_hammer" }, // cost 2: 20 dmg + duplicate a Colorless card
    { id: "bite" }, // a Colorless card to copy
    { id: "swift_strike" }, // a second Colorless card, so the choice pauses
    { id: "defend_reg" },
    { id: "cloak_of_stars" },
  ]);
  ensure(g, "a");
  const before = hpOf(g, "b");
  const biteCount0 = handOf(g, "a").filter((c) => c.id === "bite").length;
  assert(biteCount0 === 1, "one Bite in hand to start");
  assert(play(g, "a", "heirloom_hammer", "b") === null, "Heirloom Hammer plays");
  // Two Colorless cards eligible, so a choice should be pending.
  assert(g.viewFor("a").pendingChoice != null, "Heirloom Hammer pauses for a copy choice");
  const bite = handOf(g, "a").find((c) => c.id === "bite")!;
  assert(g.resolveChoice("a", [bite.uid]) === null, "resolve the copy choice");
  const biteCount1 = handOf(g, "a").filter((c) => c.id === "bite").length;
  assert(biteCount1 === 2, "Bite was copied into hand (1 -> 2)");
  finishTurn(g);
  assert(hpOf(g, "b") < before, "Heirloom Hammer dealt damage at resolution");
}

// --- Kingly Kick: gets 1 cheaper each time it's drawn ---
{
  const g = regentSolo([
    { id: "kingly_kick" }, // base cost 4
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const kkCost = () => handOf(g, "a").find((c) => c.id === "kingly_kick")?.cost;
  assert(kkCost() === 3, "Kingly Kick costs 3 after its first draw (4 - 1), got " + kkCost());
  assert(play(g, "a", "kingly_kick", "b") === null, "Kingly Kick plays");
  finishTurn(g);
  // Reshuffled and redrawn on turn 2 -> another -1.
  assert(kkCost() === 2, "Kingly Kick costs 2 after a second draw, got " + kkCost());
}

// --- Innate: a flagged card always opens in the starting hand ---
{
  const filler = (n: number) => Array.from({ length: n }, () => ({ id: "strike_r" }));
  // A 10-card deck with one Innate card: it must open in hand on every seed,
  // and the opening hand is still the usual 5 cards.
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = solo([{ id: "backstab" }, ...filler(9)], seed);
    const hand = handOf(g, "a");
    assert(hand.some((c) => c.id === "backstab"), `Innate Backstab opens in hand (seed ${seed})`);
    assert(hand.length === 5, `opening hand is 5 with one Innate (seed ${seed}), got ${hand.length}`);
  }
}

// --- Innate: more Innate cards than the hand size all come up ---
{
  const filler = Array.from({ length: 4 }, () => ({ id: "strike_r" }));
  const innates = Array.from({ length: 6 }, () => ({ id: "backstab" }));
  const g = solo([...innates, ...filler], 7);
  const hand = handOf(g, "a");
  const bs = hand.filter((c) => c.id === "backstab").length;
  assert(bs === 6, "all 6 Innate cards open in hand, got " + bs);
  assert(hand.length === 6, "hand exceeds 5 when Innate count exceeds hand size, got " + hand.length);
}

// --- Innate granted by an upgrade: the upgraded form opens in hand ---
{
  const filler = Array.from({ length: 9 }, () => ({ id: "strike_r" }));
  const g = solo([{ id: "infinite_blades", upgraded: true }, ...filler], 3);
  assert(
    handOf(g, "a").some((c) => c.id === "infinite_blades"),
    "Upgraded Infinite Blades is Innate and opens in hand",
  );
}

// --- Quasar: Discover (pick 1 of 3) a Colorless card into hand ---
{
  const g = regentSolo([
    { id: "quasar" }, // cost 0, starCost 2
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  ensure(g, "a");
  assert(play(g, "a", "quasar") === null, "Quasar plays");
  const pc = g.viewFor("a").pendingChoice;
  assert(pc != null && pc.cards.length === 3, "Quasar offers 3 Discover options, got " + (pc?.cards.length ?? 0));
  assert(pc!.pick === 1, "Quasar Discover picks 1");
  assert(pc!.cards.every((c) => c.type !== "status" && c.type !== "curse"), "Discover options are playable cards");
  const chosen = pc!.cards[0];
  assert(g.resolveChoice("a", [chosen.uid]) === null, "resolve the Discover");
  assert(g.viewFor("a").pendingChoice == null, "Discover choice cleared");
  assert(handOf(g, "a").some((c) => c.id === chosen.id), "the discovered card is now in hand");
}

// --- Kingly Punch: grows its damage by 4 each time it's drawn ---
{
  const g = regentSolo([
    { id: "kingly_punch" }, // 8 base, +4 per draw
    { id: "strike_reg" },
    { id: "defend_reg" },
    { id: "venerate" },
    { id: "cloak_of_stars" },
  ]);
  const before = hpOf(g, "b");
  assert(play(g, "a", "kingly_punch", "b") === null, "Kingly Punch plays (turn 1)");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 12, "Kingly Punch deals 8+4 after one draw, got " + (before - hpOf(g, "b")));
  // Turn 2: reshuffled and redrawn -> +4 again, so 8 + 8 = 16.
  const before2 = hpOf(g, "b");
  assert(play(g, "a", "kingly_punch", "b") === null, "Kingly Punch plays (turn 2)");
  finishTurn(g);
  assert(before2 - hpOf(g, "b") === 16, "Kingly Punch grew to 8+8 on second draw, got " + (before2 - hpOf(g, "b")));
}

// --- I Am Invincible: auto-plays from the top of the draw pile at end of turn ---
{
  // A deck made entirely of I Am Invincible: the opening hand takes 5, leaving 2
  // on top of the draw pile, which both auto-play for Block at end of turn.
  const g = regentSolo(
    Array.from({ length: 7 }, () => ({ id: "i_am_invincible" })),
    7,
  );
  assert(blockOf(g, "a") === 0, "no Block before end-of-turn autoplay");
  finishTurn(g);
  assert(blockOf(g, "a") === 20, "two I Am Invincible auto-played for 20 Block, got " + blockOf(g, "a"));
}

// --- Void: lose 1 Energy when it's drawn (netted against the turn's energy) ---
{
  const g = solo(
    [{ id: "void" }, { id: "strike_r" }, { id: "strike_r" }, { id: "strike_r" }, { id: "defend_r" }],
    5,
  );
  assert(handOf(g, "a").some((c) => c.id === "void"), "Void is in the opening hand");
  assert(energyOf(g, "a") === 2, "Void cost 1 Energy when drawn (3 -> 2), got " + energyOf(g, "a"));
}

// --- Defect: orbs (channel / passive / evoke / Focus / overflow) ---
function defectSolo(deckA: Spec[], seed = 9, hp = 200) {
  const g = new GameEngine("defect", seededRng(seed));
  g.addPlayer({ id: "a", name: "A", deck: deckA, maxHp: hp });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: hp });
  g.start();
  return g;
}
const orbsOf = (g: GameEngine, id: string) => g.viewFor(id).players.find((p) => p.id === id)!.orbs;
const fillD = (n: number) => Array.from({ length: n }, () => ({ id: "strike_d" }));

// Zap channels a Lightning orb; its end-of-turn passive deals 3.
{
  const g = defectSolo([{ id: "zap" }, ...fillD(4)]);
  ensure(g, "a");
  assert(play(g, "a", "zap") === null, "Zap plays");
  assert(orbsOf(g, "a").length === 1 && orbsOf(g, "a")[0].type === "lightning", "Lightning orb channeled");
  const before = hpOf(g, "b");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 3, "Lightning passive deals 3 at end of turn, got " + (before - hpOf(g, "b")));
}

// Dualcast evokes the oldest orb twice (Lightning evoke = 8 each).
{
  const g = defectSolo([{ id: "zap" }, { id: "dualcast" }, ...fillD(3)]);
  ensure(g, "a");
  play(g, "a", "zap");
  const before = hpOf(g, "b");
  assert(play(g, "a", "dualcast") === null, "Dualcast plays");
  assert(before - hpOf(g, "b") === 16, "Dualcast evokes Lightning twice (8+8), got " + (before - hpOf(g, "b")));
  assert(orbsOf(g, "a").length === 0, "the orb is consumed by Dualcast");
}

// Frost orb passive grants Block that carries into the next turn.
{
  const g = defectSolo([{ id: "cold_snap" }, ...fillD(4)]);
  assert(play(g, "a", "cold_snap", "b") === null, "Cold Snap plays");
  finishTurn(g);
  assert(blockOf(g, "a") === 2, "Frost passive grants 2 Block, got " + blockOf(g, "a"));
}

// Focus increases orb output (Lightning passive 3 -> 4 with 1 Focus).
{
  const g = defectSolo([{ id: "defragment" }, { id: "zap" }, ...fillD(3)]);
  play(g, "a", "defragment");
  play(g, "a", "zap");
  const before = hpOf(g, "b");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 4, "Lightning passive scales with Focus (3+1), got " + (before - hpOf(g, "b")));
}

// Channeling into full slots evokes one orb (keeping the count at the slot max).
{
  // Glacier (2 Frost) + Chill (1 Frost) fills the 3 slots; Cold Snap channels a
  // 4th Frost, so one Frost is evoked on overflow (+5 Block) and the count holds.
  const g = defectSolo([{ id: "glacier" }, { id: "chill" }, { id: "cold_snap" }, ...fillD(2)]);
  play(g, "a", "glacier"); // 2 Frost, +6 Block
  play(g, "a", "chill"); // 3rd Frost (slots full)
  assert(orbsOf(g, "a").length === 3, "three orbs before overflow");
  const blockBefore = blockOf(g, "a") ?? 0;
  play(g, "a", "cold_snap", "b"); // channel 4th Frost -> overflow evokes a Frost (+5 Block)
  assert((blockOf(g, "a") ?? 0) - blockBefore === 5, "overflow evoked a Frost orb for 5 Block");
  assert(orbsOf(g, "a").length === 3, "still 3 orbs after overflow");
}

// Glass orb: channels at 4, deals its value to all enemies each turn, then decays.
{
  const g = defectSolo([{ id: "glasswork" }, ...fillD(4)]);
  play(g, "a", "glasswork"); // Gain 5 Block, Channel 1 Glass (value 4)
  assert(
    orbsOf(g, "a").some((o) => o.type === "glass" && o.amount === 4),
    "Glass orb channeled at value 4",
  );
  const before = hpOf(g, "b");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 4, "Glass passive deals 4 to all enemies, got " + (before - hpOf(g, "b")));
  assert(
    orbsOf(g, "a").some((o) => o.type === "glass" && o.amount === 3),
    "Glass orb decayed to 3 after firing",
  );
}

// Sly: a Sly card auto-plays for free when discarded during your turn.
{
  const g = solo(
    [{ id: "survivor" }, { id: "untouchable" }, { id: "strike_g" }, { id: "strike_g" }, { id: "defend_g" }],
    4,
  );
  ensure(g, "a");
  assert(play(g, "a", "survivor") === null, "Survivor plays");
  const blockBefore = blockOf(g, "a") ?? 0; // Survivor's Block already applied
  const unt = handOf(g, "a").find((c) => c.id === "untouchable")!;
  assert(g.resolveChoice("a", [unt.uid]) === null, "discard Untouchable to Survivor");
  assert(
    (blockOf(g, "a") ?? 0) - blockBefore === 6,
    "Sly Untouchable auto-plays for 6 Block when discarded, got " + ((blockOf(g, "a") ?? 0) - blockBefore),
  );
  assert(!handOf(g, "a").some((c) => c.id === "untouchable"), "Untouchable left hand after Sly play");
}

// Plating: gain Block each turn equal to the stacks, which then decay by 1.
{
  const g = solo([{ id: "stone_armor" }, { id: "strike_r" }, { id: "strike_r" }, { id: "defend_r" }, { id: "bash" }]);
  ensure(g, "a");
  assert(play(g, "a", "stone_armor") === null, "Stone Armor plays");
  assert(powerOf(g, "a", "plating") === 4, "Stone Armor grants 4 Plating");
  finishTurn(g); // start of next turn: +4 Block, Plating decays to 3
  assert((blockOf(g, "a") ?? 0) >= 4, "Plating granted 4 Block at the start of the turn");
  assert(powerOf(g, "a", "plating") === 3, "Plating decayed to 3, got " + powerOf(g, "a", "plating"));
}

// --- Necrobinder: Doom kills at end of turn if Doom >= HP (ignoring Block) ---
{
  const g = new GameEngine("doom", seededRng(3));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "blight_strike" }, { id: "scourge" }, { id: "strike_n" }], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 12 });
  g.start();
  if (g.priorityId !== "a") g.pass(g.priorityId!);
  // Stack Doom on B above its 12 HP via Scourge (13) — B should die at end of turn.
  play(g, "a", "scourge", "b");
  assert(powerOf(g, "b", "doom") === 13, "Scourge applies 13 Doom");
  const bAlive = () => g.viewFor("a").players.find((p) => p.id === "b")!.alive;
  finishTurn(g);
  assert(!bAlive(), "B dies to Doom (13 >= 12 HP) at end of turn");
}

// --- Necrobinder: Summon gives Osty HP; Osty strikes; Sacrifice converts it ---
{
  const g = new GameEngine("osty", seededRng(4));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "bodyguard" }, { id: "poke" }, { id: "sacrifice" }, { id: "strike_n" }, { id: "defend_n" }], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  const ostyOf = (id: string) => g.viewFor("a").players.find((p) => p.id === id)!.osty;
  assert(play(g, "a", "bodyguard") === null, "Bodyguard summons Osty");
  assert(ostyOf("a")?.maxHp === 5, "Osty summoned with 5 Max HP");
  const before = hpOf(g, "b");
  play(g, "a", "poke", "b"); // Osty deals 6 (queued)
  play(g, "a", "sacrifice"); // Osty dies, gain Block = 2 x 5 = 10
  assert((blockOf(g, "a") ?? 0) === 10, "Sacrifice gives Block = 2x Osty Max HP (10), got " + blockOf(g, "a"));
  assert(ostyOf("a") === null, "Osty is gone after Sacrifice");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 6, "Osty's Poke dealt 6, got " + (before - hpOf(g, "b")));
}

// --- YOLO priority: play all your cards freely, then End Turn to resolve ---
{
  const g = new GameEngine("yolo", seededRng(1), { yoloPriority: true });
  g.addPlayer({ id: "a", name: "A", deck: Array.from({ length: 5 }, () => ({ id: "strike_r" })), maxHp: 100 });
  g.addPlayer({ id: "b", name: "B", deck: Array.from({ length: 5 }, () => ({ id: "strike_r" })), maxHp: 100 });
  g.start();
  assert(g.viewFor("a").yoloPriority === true, "view reports YOLO mode");
  assert(g.viewFor("a").priorityId === null, "no single priority holder in YOLO");
  const before = hpOf(g, "b");
  // A plays 3 Strikes back-to-back without any priority hand-off.
  assert(play(g, "a", "strike_r", "b") === null, "A Strike 1");
  assert(play(g, "a", "strike_r", "b") === null, "A Strike 2 (no priority wait)");
  assert(play(g, "a", "strike_r", "b") === null, "A Strike 3");
  assert(play(g, "a", "strike_r", "b") === "Not enough energy.", "A is out of energy");
  // B acts concurrently (no waiting for A).
  assert(play(g, "b", "strike_r", "a") === null, "B plays concurrently");
  // Ending the turn locks A out; the turn resolves once everyone has ended.
  assert(g.pass("a") === null, "A ends turn");
  assert(play(g, "a", "strike_r", "b") === "You've ended your turn.", "A can't play after ending");
  assert(g.phase === "action", "still action until everyone ends");
  assert(g.pass("b") === null, "B ends turn");
  assert(g.phase === "resolution", "resolves once all players have ended");
  g.acknowledgeResolution("a");
  g.acknowledgeResolution("b");
  assert(before - hpOf(g, "b") === 18, "A's 3 Strikes dealt 18 to B, got " + (before - hpOf(g, "b")));
}

// --- Shroud: gain Block whenever you apply Doom; plus the new ids resolve ---
{
  const g = new GameEngine("shroud", seededRng(2));
  g.addPlayer({ id: "a", name: "A", deck: [{ id: "shroud" }, { id: "blight_strike" }, { id: "scourge" }], maxHp: 200 });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  assert(play(g, "a", "shroud") === null, "Shroud plays");
  assert(powerOf(g, "a", "shroud") === 2, "Shroud power applied");
  const blockBefore = blockOf(g, "a") ?? 0;
  assert(play(g, "a", "scourge", "b") === null, "Scourge applies Doom");
  assert((blockOf(g, "a") ?? 0) - blockBefore === 2, "Shroud gives 2 Block when Doom is applied");
}

// Previously-"unknown" ids are now real cards (not registry placeholders).
{
  for (const id of ["debilitate", "shroud", "spirit_of_ash", "spur", "graveblast", "apotheosis", "ascenders_bane"]) {
    assert(resolveCard(id, false) != null, `card id "${id}" resolves`);
  }
  for (const id of ["misery", "oblivion", "clumsy", "defy", "deaths_door", "enfeebling_touch", "drain_power", "capture_spirit", "severance", "soul"]) {
    assert(resolveCard(id, false) != null, `card id "${id}" resolves`);
  }
  // Punctuation-insensitive id matching (apostrophes/commas/etc.).
  for (const raw of ["Ascender's Bane", "ascenders_bane", "Decisions, Decisions", "GUARDS!!!", "Soul", "Seance", "Death's Door", "Capture Spirit"]) {
    assert(resolveCard(canonicalCardId(raw), false) != null, `"${raw}" resolves to a card`);
  }
}

// --- No Escape: Doom scales with the Doom already on the target ---
{
  const g = new GameEngine("noescape", seededRng(6));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "scourge" }, { id: "scourge" }, { id: "no_escape" }, { id: "strike_n" }, { id: "defend_n" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 300 });
  g.start();
  ensure(g, "a");
  play(g, "a", "scourge", "b"); // Doom 13
  play(g, "a", "scourge", "b"); // Doom 26
  assert(powerOf(g, "b", "doom") === 26, "B has 26 Doom before No Escape");
  play(g, "a", "no_escape", "b"); // +10 + 5×floor(26/10) = +20 -> 46
  assert(powerOf(g, "b", "doom") === 46, "No Escape scales (26 + 10 + 5×2 = 46), got " + powerOf(g, "b", "doom"));
}

// --- Death's Door: Block is doubled if you applied Doom this turn ---
{
  const g = new GameEngine("dd", seededRng(7));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "deaths_door" }, { id: "blight_strike" }, { id: "deaths_door" }, { id: "strike_n" }, { id: "defend_n" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  const b0 = blockOf(g, "a") ?? 0;
  play(g, "a", "deaths_door"); // no Doom yet -> 6
  assert((blockOf(g, "a") ?? 0) - b0 === 6, "Death's Door gives 6 Block without Doom");
  play(g, "a", "blight_strike", "b"); // applies Doom
  const b1 = blockOf(g, "a") ?? 0;
  play(g, "a", "deaths_door"); // doubled -> 12
  assert((blockOf(g, "a") ?? 0) - b1 === 12, "Death's Door doubles to 12 after Doom, got " + ((blockOf(g, "a") ?? 0) - b1));
}

// --- Time's Up: deal damage equal to the target's Doom ---
{
  const g = new GameEngine("timesup", seededRng(8));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "scourge" }, { id: "times_up" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  play(g, "a", "scourge", "b"); // Doom 13
  const before = hpOf(g, "b");
  play(g, "a", "times_up", "b"); // damage = 13 (deferred)
  finishTurn(g);
  assert(before - hpOf(g, "b") === 13, "Time's Up deals damage equal to Doom (13), got " + (before - hpOf(g, "b")));
}

// --- Reaper Form: your Attacks also apply Doom equal to their damage ---
{
  const g = new GameEngine("reaper", seededRng(9));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "reaper_form" }, { id: "strike_n" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  assert(play(g, "a", "reaper_form") === null, "Reaper Form plays");
  finishTurn(g); // next turn so we have energy for an attack
  ensure(g, "a");
  assert(play(g, "a", "strike_n", "b") === null, "Strike plays under Reaper Form");
  assert(powerOf(g, "b", "doom") === 6, "Reaper Form applies Doom = attack damage (6), got " + powerOf(g, "b", "doom"));
}

// --- Unleash: Osty deals its damage plus Osty's current HP; Calcify adds more ---
{
  const g = new GameEngine("unleash", seededRng(10));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "bodyguard" }, { id: "calcify" }, { id: "unleash" }, { id: "strike_n" }, { id: "defend_n" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  play(g, "a", "bodyguard"); // Osty 5 HP
  play(g, "a", "calcify"); // Osty attacks +4
  const before = hpOf(g, "b");
  play(g, "a", "unleash", "b"); // 6 + current HP 5 + Calcify 4 = 15
  finishTurn(g);
  assert(before - hpOf(g, "b") === 15, "Unleash deals 6 + Osty HP(5) + Calcify(4) = 15, got " + (before - hpOf(g, "b")));
}

// --- Debilitate: Exposed makes Vulnerable twice as effective ---
{
  const g = new GameEngine("debil", seededRng(11));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "putrefy" }, { id: "debilitate" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 300 });
  g.start();
  ensure(g, "a");
  play(g, "a", "putrefy", "b"); // Vulnerable 2 on B
  play(g, "a", "debilitate", "b"); // 10 dmg (×1.5 vuln = 15) + Exposed 3
  const before = hpOf(g, "b");
  play(g, "a", "strike_n", "b"); // 6 × 2.0 (vuln + Exposed) = 12
  finishTurn(g);
  // Debilitate already applied its 15 before `before`; Strike adds the doubled 12.
  void before;
  // B took 15 (Debilitate) + 12 (Strike) = 27 total this turn.
  assert(hpOf(g, "b") === 300 - 27, "Exposed doubles Vulnerable: Strike hit for 12, total 27, got " + (300 - hpOf(g, "b")));
}

// --- Sculpting Strike: adds Ethereal to a chosen hand card (Exhausts at turn end) ---
{
  const g = new GameEngine("sculpt", seededRng(12));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "sculpting_strike" }, { id: "strike_n" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  assert(play(g, "a", "sculpting_strike", "b") === null, "Sculpting Strike plays");
  assert(g.viewFor("a").pendingChoice != null, "Sculpting Strike pauses to pick a card");
  const target = handOf(g, "a").find((c) => c.id === "defend_n")!;
  assert(g.resolveChoice("a", [target.uid]) === null, "choose the card to make Ethereal");
  finishTurn(g);
  const exhaust = g.viewFor("a").players.find((p) => p.id === "a")!.exhaustPile ?? [];
  assert(exhaust.some((c) => c.id === "defend_n"), "the Ethereal'd card was Exhausted at end of turn");
}

// --- Osty attacks: Flatten free after Osty attacked; Rattle hits per Osty attack ---
{
  const g = new GameEngine("ostyatk", seededRng(13));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "bodyguard" }, { id: "poke" }, { id: "rattle" }, { id: "flatten" }, { id: "strike_n" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 300 });
  g.start();
  ensure(g, "a");
  const flattenCost = () => handOf(g, "a").find((c) => c.id === "flatten")!.cost;
  const before = hpOf(g, "b");
  play(g, "a", "bodyguard"); // summon Osty
  assert(flattenCost() === 2, "Flatten costs 2 before Osty attacks");
  play(g, "a", "poke", "b"); // Osty attack #1 (6 dmg)
  assert(flattenCost() === 0, "Flatten is free after Osty attacked this turn");
  play(g, "a", "rattle", "b"); // 7 × (1 + 1 prior) = 14
  finishTurn(g);
  assert(before - hpOf(g, "b") === 20, "Poke 6 + Rattle 7×2 = 20, got " + (before - hpOf(g, "b")));
}

// --- Snap: add Retain to a chosen hand card (kept across the turn) ---
{
  const g = new GameEngine("snap", seededRng(14));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "bodyguard" }, { id: "snap" }, { id: "strike_n" }, { id: "defend_n" }, { id: "poke" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  play(g, "a", "bodyguard");
  assert(play(g, "a", "snap", "b") === null, "Snap plays");
  assert(g.viewFor("a").pendingChoice != null, "Snap pauses to pick a card to Retain");
  const target = handOf(g, "a").find((c) => c.id === "strike_n")!;
  assert(g.resolveChoice("a", [target.uid]) === null, "choose the card to Retain");
  finishTurn(g);
  assert(
    handOf(g, "a").some((c) => c.uid === target.uid),
    "the Retain'd card stayed in hand into the next turn",
  );
}

// --- Danse Macabre: Block when you play a 2+ cost card ---
{
  const g = new GameEngine("danse", seededRng(15));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "danse_macabre" }, { id: "deathbringer" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  play(g, "a", "danse_macabre");
  const b0 = blockOf(g, "a") ?? 0;
  play(g, "a", "deathbringer"); // cost 2 -> +4 Block
  assert((blockOf(g, "a") ?? 0) - b0 === 4, "Danse Macabre gives 4 Block on a 2-cost card");
}

// --- Sleight of Flesh: deal damage whenever you apply a debuff ---
{
  const g = new GameEngine("sleight", seededRng(16));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "sleight_of_flesh" }, { id: "scourge" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  play(g, "a", "sleight_of_flesh");
  const before = hpOf(g, "b");
  play(g, "a", "scourge", "b"); // applies Doom (a debuff) -> 9 immediate damage
  assert(before - hpOf(g, "b") === 9, "Sleight of Flesh deals 9 when a debuff is applied, got " + (before - hpOf(g, "b")));
}

// --- Banshee's Cry costs 2 less per Ethereal in hand; Borrowed Time raises costs ---
{
  const g = new GameEngine("ethcost", seededRng(17));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "banshees_cry" }, { id: "defile" }, { id: "fear" }, { id: "strike_n" }, { id: "defend_n" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  // Defile + Fear are Ethereal in hand -> 9 - 2×2 = 5.
  assert(handOf(g, "a").find((c) => c.id === "banshees_cry")!.cost === 5, "Banshee's Cry costs 5 with 2 Ethereal in hand");
}
{
  const g = new GameEngine("costup", seededRng(18));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "borrowed_time" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }, { id: "poke" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  assert(handOf(g, "a").find((c) => c.id === "strike_n")!.cost === 1, "Strike costs 1 normally");
  play(g, "a", "borrowed_time");
  assert(handOf(g, "a").find((c) => c.id === "strike_n")!.cost === 2, "Borrowed Time makes Strike cost 2");
}

// --- Hang: damage scales with the enemy's Hang, then doubles it ---
{
  const g = new GameEngine("hang", seededRng(19));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "hang" }, { id: "hang" }, { id: "strike_n" }, { id: "defend_n" }, { id: "bodyguard" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  const before = hpOf(g, "b");
  play(g, "a", "hang", "b"); // 10 × 1, Hang -> 2
  play(g, "a", "hang", "b"); // 10 × 2 = 20, Hang -> 4
  assert(powerOf(g, "b", "hang") === 4, "Hang doubled to 4");
  finishTurn(g);
  assert(before - hpOf(g, "b") === 30, "Hang: 10 + 20 = 30, got " + (before - hpOf(g, "b")));
}

// --- Veilpiercer: the next Ethereal card you play is free ---
{
  const g = new GameEngine("veil", seededRng(20));
  g.addPlayer({
    id: "a",
    name: "A",
    deck: [{ id: "veilpiercer" }, { id: "defile" }, { id: "fear" }, { id: "strike_n" }, { id: "defend_n" }],
    maxHp: 200,
  });
  g.addPlayer({ id: "b", name: "B", deck: ironcladStarterDeck(), maxHp: 200 });
  g.start();
  ensure(g, "a");
  assert(handOf(g, "a").find((c) => c.id === "defile")!.cost === 1, "Defile costs 1 normally");
  play(g, "a", "veilpiercer", "b");
  assert(handOf(g, "a").find((c) => c.id === "defile")!.cost === 0, "Veilpiercer makes the next Ethereal free");
  play(g, "a", "defile", "b"); // consumes the free play
  assert(handOf(g, "a").find((c) => c.id === "fear")!.cost === 1, "the next Ethereal costs normally again");
}

console.log(`\n✅ engine tests passed (${passed} assertions)\n`);
