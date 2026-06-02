# Slay the Spire 2 — Card Audit

Comparison of the **current implementation** against **Slay the Spire 2** data
(slaythespire.wiki.gg `Module:Cards/StS2_data/*`). Goal: make every card its StS2
variant. This doc is the agreed scope before code changes.

## Decisions (resolved)

- **Audit first**, then reconcile character-by-character. ✅ (this doc)
- **Co-op vs PvP:** stay PvP for now and **decide ally/all-players cards
  individually** as we reach them (reinterpret or skip per card).
- Execution order: Defect → Silent → Ironclad → verify Regent → Necrobinder.

## Roster (confirmed from the wiki)

StS2 has **5 characters**: Ironclad, Silent, Defect, **Regent**, **Necrobinder**.

- Ironclad / Silent / Defect / Regent — implemented (but built largely from **StS1**
  data, so numbers + rosters diverge from StS2; see below).
- **Necrobinder — not implemented at all.** New character, new mechanics.
- Watcher is **StS1-only** (correctly excluded).

## Cross-cutting issues (affect everything)

1. **Co-op vs PvP model.** StS2 is a **co-op** game. Many cards reference *allies*
   / *"ALL players"* / *"another player"* (Ironclad Demonic Shield, Tank; Defect
   Energy Surge, Ignition; Silent Flanking, Sneaky, Master Planner; lots of
   Necrobinder "all players summon"). This engine is **adversarial** (1v1/FFA).
   Decision needed: keep PvP and reinterpret ally effects, or add a co-op mode.
2. **New keyword: `Sly`** (Silent) — bonus when played as the turn's first/early
   card (exact rule TBD from wiki). Not modeled.
3. **New orb: `Glass`** (Defect) — 5th orb type. Not modeled.
4. **Necrobinder mechanics:** `Osty` (a persistent summon that attacks), `Doom`
   (stacking debuff), `Soul` (generated cards), heavy `Ethereal` use. None modeled.
5. **Status/curse cards** (Dazed, Slimed, Void, Wound, Burn, Fuel, Debris, Giant
   Rock, Glass orb's Status) — some StS2-specific ones missing.

## Defect (have full StS2 data)

Signature: orbs + Focus. Engine mostly correct after recent fixes
(evoke = rightmost ✓, Lightning before block-clear ✓). Gaps:

- **Missing orb type: Glass** (used by Glasswork, Refract, Spinner).
- **Extra (StS1-only, not in StS2 — remove/replace):** Consume, Core Surge,
  Doom and Gloom, Steam Barrier, Electrodynamics(? not in list), Biased Cognition
  is now **Ancient** rarity with a "lose 1 Focus/turn" downside.
- **Number/effect diffs on kept cards:** Beam Cell (Vuln 1/2), Go for the Eyes
  ("if enemy intends to attack"), Coolheaded, Glacier (6/9 block), Skim, Scrape
  (7/10 dmg, draw 4/5), Capacitor (2/3 slots), Defragment (now **Rare**),
  Hyperbeam (26/34), Meteor Strike (24/30), Rainbow, Tempest (X-cost), Sunder
  (24/32), etc.
- **Missing StS2 cards (~50):** Barrage, Boost Away, Claw, Compile Driver,
  Focused Strike, Gunk Up, Hologram, Hotfix, Leap, Lightning Rod, Momentum Strike,
  Uproar, Boot Sequence, Bulk Up, Chaos, Compact, Double Energy, Energy Surge,
  Feral, Fight Through, Fusion, Glasswork, Hailstorm, Iteration, Loop, Null,
  Refract, Rocket Punch, Scavenge, Shadow Shield, Smokestack, Storm, Subroutine,
  Synchronize, Synthesis, Tesla Coil, Thunder, White Noise, Adaptive Strike,
  All for One, Buffer, Consuming Shadow, Coolant, Creative AI, Echo Form,
  Flak Cannon, Genetic Algorithm, Helix Drill, Ice Lance, Ignition,
  Machine Learning, Modded, Multi-Cast, Reboot, Shatter, Signal Boost, Spinner,
  Supercritical, Trash to Treasure, Voltaic, Quadcast.

## Ironclad

Signature (Strength/Exhaust/Block) is correct. Roster diverges a lot.

- **Extra (StS1-only — remove):** Cleave, Clothesline, Flex, Metallicize, Clash,
  Heavy Blade, Warcry, Wild Strike, Blood for Blood, Carnage, Disarm, Dropkick,
  Entrench, Ghostly Armor, Intimidate, Power Through, Pummel, Reckless Charge,
  Searing Blow, Seeing Red, Sentinel, Sever Soul, Shockwave, Spot Weakness,
  Berserk, Brutality, Immolate, Limit Break, Reaper.
- **Missing StS2 cards (~55):** Armaments, Blood Wall, Breakthrough, Cinder,
  Havoc, Molten Fist, Setup Strike, Tremble, Ashen Strike, Bully, Demonic Shield,
  Dismantle, Dominate, Drum of Battle, Evil Eye, Expect a Fight, Fight Me!,
  Forgotten Ritual, Howl from Beyond, Infernal Blade, Inferno, Juggling, Pillage,
  Spite, Stampede, Stomp, Stone Armor (Plating), Taunt, Unrelenting, Vicious,
  Whirlwind, Colossus, Aggression, Brand, Cascade, Conflagration, Crimson Mantle,
  Cruelty, Hellraiser, Juggernaut, Mangle, One-Two Punch, Pact's End, Primal Force,
  Pyre, Stoke, Tank, Tear Asunder, Thrash, Unmovable, Break, Corruption, Grapple.
- **New status/mechanic:** `Plating` (Stone Armor / Stagger-style), Giant Rock.

## Silent

Signature (Poison/Shivs/Discard) correct. Roster diverges a lot; new keyword `Sly`.

- **Extra (StS1-only — remove):** Bane, Quick Slash, Flying Knee, Outmaneuver,
  All-Out Attack, Caltrops, Catalyst, Concentrate, Crippling Cloud, Heel Hook,
  Riddle with Holes, Terror, A Thousand Cuts, Die Die Die, Glass Knife, Unload,
  Eviscerate, Corpse Explosion.
- **Missing StS2 cards (~55):** Anticipate, Flick-Flack, Leading Strike,
  Piercing Wail, Ricochet, Snakebite, Untouchable, Blur, Bubble Bubble,
  Escape Plan, Expertise, Expose, Finisher, Flanking, Flechettes, Follow Through,
  Hand Trick, Haze, Hidden Daggers, Memento Mori, Mirage, Outbreak, Phantom Blades,
  Pinpoint, Pounce, Precise Cut, Reflex, Speedster, Strangle, Tactician,
  Up My Sleeve, Well-Laid Plans, Abrasive, Accelerant, Assassinate, Blade of Ink,
  Bullet Time, Burst, Corrosive Wave, Echoing Slash, Fan of Knives, Knife Trap,
  Malaise, Master Planner, Murder, Nightmare, Serpent Form, Shadow Step,
  Shadowmeld, Sneaky, Storm of Steel, The Hunt, Tools of the Trade, Tracking,
  Suppress.
- **Kept-but-different:** Survivor (8/11 block + discard 1), Neutralize (3/4 + Weak),
  Backstab (Innate ✓ already), Wraith Form (now **Ancient**, 2/3 Intangible).

## Regent — already close to StS2 ✅

The prior "Regent" work appears to have used **StS2** data (names match: Falling
Star, Venerate, Quasar, Kingly Kick/Punch, Sovereign Blade/Forge, Star Cost). This
is the most StS2-accurate set. Remaining: verify numbers per card, and the
ally/gold/Minion cards (Largesse, Hammer Time, Royalties, GUARDS!!!) still need the
co-op/economy decision above. Necrobinder/Star mechanics already in place.

## Necrobinder — not implemented (new build)

~90 cards. New mechanics required:
- **Osty:** a persistent summon with its own HP that attacks (many cards: Poke,
  Flatten, Sic 'Em, Squeeze, Sacrifice "Osty dies for block = 2× max HP").
- **Doom:** stacking enemy debuff (Blight Strike, Scourge, End of Days "kill if
  doom ≥ HP", Time's Up "damage = enemy doom").
- **Soul:** generated cards added to piles (Grave Warden, Severance, Soul Storm).
- Heavy **Ethereal** synergy (Defile, Parse, Pull from Below, Spirit of Ash).

## Suggested execution order

1. **Decide the co-op question** (blocks ~30 ally cards across characters).
2. Add shared mechanics: `Sly`, `Plating`, Glass orb, then Necrobinder's
   Osty/Doom/Soul.
3. Reconcile character-by-character (Defect → Silent → Ironclad → verify Regent),
   removing StS1-only cards and adding StS2 cards with exact numbers.
4. Build Necrobinder last (largest new surface).
