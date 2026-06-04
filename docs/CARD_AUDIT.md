# Card Audit Log

Single source of truth for auditing every card against the Slay the Spire 2 wiki
(`slaythespire.wiki.gg/.../StS2_data/*`). Worked through character-by-character.

**Legend (per card):**
- ✅ **faithful** — implemented and matches the wiki (numbers + effect).
- ⚠️ **approx** — playable but a rider/scaling is simplified or dropped.
- ❌ **missing** — not implemented yet.
- 🚫 **blocked** — needs a subsystem this PvP engine lacks (allies, gold) or
  data we don't have (token stats).

**Audit status by character**

| Character | Implemented | Audited | Notes |
|---|---|---|---|
| Ironclad | 74 | ⬜ pending | StS1-derived; many StS1-only cards still present |
| Silent | ~65 | ⬜ pending | StS1-derived + StS2 additions |
| Defect | 41 | 🔶 partial | orb engine audited; ~40 StS2 cards missing |
| Regent | ~88 | ✅ verified | numbers confirmed vs StS2 |
| Necrobinder | 42 | ✅ this pass | see below |
| Neutral | 14 | ⬜ pending | Colorless pool |

---

## Necrobinder — audited this pass

### Implemented & faithful ✅
Strike, Defend, Bodyguard (Summon 5/7), Poke (Osty 6/9), Blight Strike (8/10 +
Doom=dmg), Scourge (Doom 13/16 + draw), Negative Pulse, Grave Warden (Block +
Soul), Defile (Ethereal), Fear (Ethereal), Reap, Sow, Bury, Reave (+Soul),
Afterlife, Deathbringer, Putrefy, Enfeebling Touch, Drain Power, Severance (Soul
×3 piles), Sacrifice (Osty→Block), Reanimate, End of Days, Glimpse Beyond, Seance
(→Soul), Spirit of Ash, Shroud, Oblivion (Doom per card), No Escape (Doom scales),
Death's Door (doubles on Doom), Spur (Summon + heal Osty), Cleanse (Summon +
exhaust draw), Capture Spirit (lose-HP + Soul), Soul token.

### Implemented but approximated ⚠️
- **Unleash** — Osty 6/9, but the "+ HP scaling" rider is dropped.
- **Debilitate** — modeled as dmg + Vulnerable; real card makes debuffs 2×
  effective on the target (debuff-amplify) — not modeled.
- **Sculpting Strike** — dmg only; "add Ethereal to a card in hand" rider dropped.
- **Misery** — dmg + Retain; "spread the enemy's debuffs" rider dropped.

### Missing ❌ (StS2 Necrobinder cards not yet implemented)
Grouped by what each needs.

**Osty-attack scaling (need an "Osty attack count / per-Osty-attack" hook):**
Flatten, Snap, Sic 'Em, Rattle, Right Hand Hand, High Five, Squeeze, Bone Shards,
Calcify, Fetch, Protector.

**On-event power hooks (need new reactive triggers):**
- ✅ DONE this pass: **Countdown** (turn-start Doom), **Reaper Form** (attacks
  apply Doom = damage), **Devour Life** (Summon on Soul play), **Haunt** (Soul-play
  damage).
- ❌ still missing: Necro Mastery (enemies lose HP when Osty does), Friendship,
  Lethality (first-attack bonus), Sleight of Flesh (debuff-apply damage), Danse
  Macabre, Sentry Mode, Pagestorm (draw on Ethereal draw), Call of the Void,
  Demesne, Forbidden Grimoire.

**Doom/Soul/Ethereal payoffs:**
- ✅ DONE this pass: **Soul Storm** (dmg + per Soul in exhaust), **Time's Up**
  (dmg = enemy Doom), **Parse** (Ethereal draw), **Delay** (block + next-turn
  energy), **Dredge** (retrieve discards), **Neurosurge** (energy/draw/self-Doom),
  **Eradicate** (X-cost X-hit).
- ❌ still missing: Hang, Undeath, Pull from Below (per Ethereal played),
  Veilpiercer (next Ethereal costs 0), Banshee's Cry (cost scales with Ethereal),
  Transfigure, The Scythe (permanent +dmg), Eidolon, Melancholy, Death March,
  Borrowed Time, Dirge (X summon).

**Blocked 🚫:** Legion of Bone, Shared Fate, Glimpse-Beyond-style "all players"
(allies — co-op only).

---

## Defect — partial (orb engine audited)
Implemented set matches StS2 numbers (Glass orb, evoke rightmost, etc.).
**Missing (~40):** Barrage, Claw, Compile Driver, Gunk Up, Momentum Strike, Uproar,
Boot Sequence, Chaos, Compact, Energy Surge🚫, Feral, Fight Through, Hailstorm,
Iteration, Loop, Rocket Punch, Scavenge, Shadow Shield, Smokestack, Storm,
Subroutine, Synchronize, Synthesis, Tesla Coil, Thunder, White Noise, Adaptive
Strike, All for One, Buffer, Consuming Shadow, Coolant, Creative AI, Echo Form,
Flak Cannon, Genetic Algorithm, Helix Drill, Ignition🚫, Machine Learning, Modded,
Multi-Cast, Reboot, Signal Boost, Spinner, Trash to Treasure, Voltaic.

## Silent — pending full audit
StS1-only cards still present (Bane, Quick Slash, Caltrops, Catalyst, A Thousand
Cuts, Die Die Die, Glass Knife, Unload, Eviscerate, Corpse Explosion, etc.) →
remove. **Missing StS2 (~45):** see docs/STS2_AUDIT.md task #40.

## Ironclad — pending full audit
StS1-only cards still present (Cleave, Clothesline, Flex, Metallicize, Clash,
Heavy Blade, Warcry, etc.) → remove. **Missing StS2 (~50):** see STS2_AUDIT.md #41.

## Regent — ✅ verified
All ~88 cards match StS2. Blocked: Largesse/Hammer Time (allies), Royalties
(gold), GUARDS!!! (Minion Sacrifice token stats unknown).

## Neutral — pending
Apotheosis ✅, Ascender's Bane ✅, Clumsy ✅, Soul ✅. Audit the rest of the
Colorless pool vs StS2.

---

## Next actions (queue)
1. Necrobinder: implement the Doom/Soul/Ethereal payoff cards (small effects), then
   the on-event hooks, then the Osty-attack-scaling hook + its cards.
2. Silent & Ironclad: remove StS1-only cards (+ fix tests) and add the StS2 lists.
3. Defect: add the ~40 missing StS2 cards (several need on-play-power / on-evoke hooks).
4. Audit Neutral pool.
