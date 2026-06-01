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

console.log(`\n✅ engine tests passed (${passed} assertions)\n`);
