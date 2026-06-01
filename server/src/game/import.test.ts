import { importLoadout } from "./import.js";

let passed = 0;
function assert(c: boolean, m: string) {
  if (!c) throw new Error("ASSERT FAILED: " + m);
  passed++;
}

// Bare strings + objects + counts + upgrades.
{
  const r = importLoadout({
    name: "Test",
    maxHp: 80,
    relics: ["burning_blood"],
    deck: ["bash", { id: "strike_r", count: 3 }, { id: "inflame", upgraded: true }],
  });
  assert(r.name === "Test", "name parsed");
  assert(r.maxHp === 80, "maxHp parsed");
  assert(r.deck.length === 5, "deck expanded to 5 (1 + 3 + 1)");
  assert(r.deck.filter((c) => c.id === "strike_r").length === 3, "3 strikes");
  assert(r.deck.some((c) => c.id === "inflame" && c.upgraded), "upgraded inflame present");
  assert(r.relics.length === 1, "relic kept");
  assert(r.report.warnings.length === 0, "no warnings on clean import");
}

// Alias + case-insensitive ids resolve.
{
  const r = importLoadout({ deck: ["Strike_R", "PommelStrike", "BODYSLAM"] });
  assert(r.deck[0].id === "strike_r", "Strike_R -> strike_r");
  assert(r.deck[1].id === "pommel_strike", "PommelStrike alias -> pommel_strike");
  assert(r.deck[2].id === "body_slam", "BODYSLAM alias -> body_slam");
  assert(r.report.warnings.length === 0, "aliases produce no warnings");
}

// Unknown card/relic become warnings but don't crash; card stays as placeholder.
{
  const r = importLoadout({ deck: ["strike_r", "totally_made_up_card"], relics: ["made_up_relic"] });
  assert(r.deck.length === 2, "unknown card kept as placeholder");
  assert(r.relics.length === 0, "unknown relic dropped");
  assert(r.report.warnings.length >= 2, "warnings for unknown card and relic");
}

// Garbage input is tolerated.
{
  const r = importLoadout({ foo: "bar" });
  assert(r.deck.length === 0, "no deck -> empty");
  assert(r.report.ok === false, "report flagged not ok");
}

console.log(`\n✅ import tests passed (${passed} assertions)\n`);
