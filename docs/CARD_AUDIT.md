# Card Audit Log

Single source of truth for auditing every card against the Slay the Spire 2 wiki
(`slaythespire.wiki.gg/.../StS2_data/*`). Worked through character-by-character.

**Policy:** a card ships **only when fully implemented** (all riders, exact wiki
numbers). No approximations — if a rider needs a mechanic or data we don't have,
the card stays ❌ until it can be done in full. Existing ⚠️ approximations are
bugs to fix, not acceptable states.

**Legend (per card):**
- ✅ **faithful** — fully implemented, matches the wiki.
- ⚠️ **approx** — TECH DEBT to fix: a rider is simplified/dropped (do not leave).
- ❌ **missing** — not implemented yet (preferred over an approximation).
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

### Approximations — ALL FIXED ✅
- **Unleash** — Osty 6/9 + Osty's current HP (+ Calcify added: Osty attacks +4/6).
- **Debilitate** — now applies **Exposed** (Weak/Vulnerable are 2× effective on
  the enemy for 3/4 turns).
- **Sculpting Strike** — now adds **Ethereal to a chosen hand card** (per-instance
  Ethereal + a choice prompt).
- **Misery** — now **spreads the enemy's debuffs to all other enemies** (Retain
  is upgrade-only, matching the wiki).

Necrobinder has **no remaining approximations** — every implemented card is
faithful. (Still ❌ missing: the on-event power cards and a few X-cost/utility
cards listed below.)

### Missing ❌ (StS2 Necrobinder cards not yet implemented)
Grouped by what each needs.

**Osty-attack scaling:**
- ✅ DONE: **Calcify**, **Protector** (+Osty Max HP), **Sic 'Em** (+Summon),
  **High Five** (+Vulnerable to all), **Flatten** (free if Osty attacked),
  **Rattle** (hits per Osty attack), **Squeeze** (+per other Osty attack),
  **Bone Shards** (Osty hits all + Block, then dies). Built an Osty-attack
  counter, `osty_attacked` dynamic cost, and `applyPowerAll`.
- ✅ DONE: **Snap** (add Retain to a chosen hand card — per-instance Retain via a
  new choice), **Fetch** (draw the first time Osty attacks each turn).
- ❌ still missing: Right Hand Hand (returns from discard when Osty attacks).

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

### Necrobinder — remaining missing (after batches 1–3)
Done across batches: all Doom/Soul/Ethereal payoffs, the on-event power cards
(Danse Macabre, Pagestorm, Sleight of Flesh, Friendship, Demesne, Lethality,
Countdown, Reaper Form, Devour Life, Haunt, Call of the Void), the Osty-attack
set, and Hang (+ multiplier), Veilpiercer, Eidolon, Banshee's Cry, Shared Fate.
**Still ❌:** The Scythe (wiki page 404 — need exact text), Undeath (copy a hand
card to discard), Dirge (X-cost summon), Melancholy (cost drops on enemy deaths),
Sentry Mode (needs the Sweeping Gaze token), Transfigure (needs the Replay
keyword), Necro Mastery (Osty-HP-loss → enemy HP loss), Right Hand Hand
(self-return on Osty attack). **🚫 blocked:** Legion of Bone (allies),
Forbidden Grimoire (end-of-combat deck removal).

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
