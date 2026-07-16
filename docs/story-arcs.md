# Story arc authoring

The game treats one complete story arc as one complete run. Arc definitions and story cards are immutable JavaScript data imported at startup; they are never fetched at runtime. The central story engine owns counting, beat completion, anchor selection, transitions, and ending completion. Rendering and pointer handlers do not mutate story state.

The shipped sample is **The Ember Crown** (`ember-crown`), an original heroic-fantasy arc. This document describes the reusable data contract rather than card-specific implementation tricks.

## Required beat order and budgets

Every arc contains the following 15 beats in this exact order. The budget numbers count world-card decisions, not every screen the player sees.

| # | Act | Beat ID | Display name | Minimum | Target | Maximum |
|---:|---|---|---|---:|---:|---:|
| 1 | Act I | `openingImage` | Opening Image | 1 | 1 | 1 |
| 2 | Act I | `themeStated` | Theme Stated | 1 | 1 | 2 |
| 3 | Act I | `setup` | Setup | 3 | 4 | 4 |
| 4 | Act I | `catalyst` | Catalyst | 1 | 1 | 1 |
| 5 | Act I | `debate` | Debate | 2 | 3 | 3 |
| 6 | Act I | `breakIntoTwo` | Break into Two | 1 | 1 | 1 |
| 7 | Act II-A | `bStory` | B Story | 2 | 2 | 2 |
| 8 | Act II-A | `funAndGames` | Fun and Games | 5 | 6 | 7 |
| 9 | Act II-A | `midpoint` | Midpoint | 2 | 2 | 2 |
| 10 | Act II-B | `badGuysCloseIn` | Bad Guys Close In | 4 | 5 | 6 |
| 11 | Act II-B | `allIsLost` | All Is Lost | 1 | 1 | 1 |
| 12 | Act II-B | `darkNightOfTheSoul` | Dark Night of the Soul | 2 | 2 | 3 |
| 13 | Act III | `breakIntoThree` | Break into Three | 1 | 1 | 1 |
| 14 | Act III | `finale` | Finale | 3 | 4 | 5 |
| 15 | Act III | `finalImage` | Final Image | 1 | 1 | 1 |
| **Total** |  |  |  | **30** | **35** | **40** |

The minimum is a hard lower bound. The target is a pacing signal used to raise the weight of completion candidates. At maximum minus one, the selector must surface a valid anchor or completion candidate; at maximum it must never select another ambient card. A malformed arc uses a deterministic production fallback and reports a development invariant instead of soft-locking.

## What counts as a world decision

A card opts in explicitly with `story.countsTowardStory`. Exploration, NPC, merchant, camp, shrine, environment, encounter-introduction, anchor, completion, Finale preparation/resolution, boss-introduction, and Final Image cards normally use `true`.

Combat rounds, loot handling, level-up choices, inventory/equipment actions, transition interstitials, death, and victory use `false` or have no story-card metadata. A forced story card may count, but it must say so explicitly. Queued beat-local cards also record their originating beat so they cannot drift into the next beat.

## Arc schema

An arc contains identity, ordered beats, encounter and sequence references, and exactly two ending definitions:

```js
{
  id: "ember-crown",
  title: "The Ember Crown",
  theme: "Power becomes heroic only when it is carried for others.",
  premise: "...",
  beatIds: [/* the 15 canonical IDs */],
  beats: [/* all 15 beat objects in canonical order */],
  transitionBeatIds: [
    "breakIntoTwo", "midpoint", "allIsLost", "breakIntoThree", "finale"
  ],
  midbossId: "iron-wyvern",
  finalBossId: "malrec-crown-bound",
  forcedSequences: [
    {
      id: "sun-vault-sequence",
      beatId: "funAndGames",
      cardIds: ["fun-sun-vault-door", "fun-sun-vault-heart"]
    }
  ],
  endings: [
    {
      id: "crown-of-dawn",
      title: "Crown of Dawn",
      finalImageCardIds: ["final-image-crown-of-dawn"]
    },
    {
      id: "unbound-flame",
      title: "The Unbound Flame",
      finalImageCardIds: ["final-image-unbound-flame"]
    }
  ]
}
```

Keep referenced IDs stable once a release can persist them. Content definitions are deep-frozen; state stores IDs and facts, never mutable copies of arc content.

## Beat schema and completion objectives

A beat declares its structure rather than implementing a callback:

```js
{
  id: "setup",
  name: "Setup",
  act: "Act I",
  budget: { min: 3, target: 4, max: 4 },
  completionObjective: {
    type: "storyTagResolved",
    tag: "setup-complete"
  },
  completionCardIds: ["setup-crown-lesson"],
  encounterPolicy: {
    mode: "random",
    weightMultiplier: 0.45,
    allowedEnemyTags: ["weak", "tutorial"],
    maximumRandomEncounters: 1,
    minimumCardsBeforeEncounter: 1
  }
}
```

The validator and progress helpers accept `minimum`/`maximum` as aliases for `min`/`max`, but authored arcs should follow the repository's existing convention consistently.

Completion objectives are declarative. They may require resolved tags, concrete facts, counters, a selected/resolved anchor, a specific defeated enemy, a selected ending, or an `all`/`any` composition of those requirements. Advancement occurs only when all four central invariants pass:

1. The beat minimum has been reached.
2. The completion objective is satisfied.
3. No beat-local forced card remains unresolved.
4. No required encounter, combat reward, or level-up sequence for that beat remains active.

Cards cannot use an `advanceBeat` effect. A card does not have enough context to prove these invariants, and allowing it to advance directly could skip an aftermath, strand a queued card, or enter victory before the Final Image.

## Story cards and multi-beat weights

Story metadata sits beside the existing concise card, choice, requirement, and effect data:

```js
story: {
  arcIds: ["ember-crown"],
  beatWeights: {
    setup: 0.6,
    funAndGames: 1.25,
    badGuysCloseIn: 0.4
  },
  role: "ambient",
  completionTags: [],
  countsTowardStory: true
}
```

Roles are `entry`, `ambient`, `completion`, `anchor`, and `ending`. A reusable global card may omit `arcIds`, but it must still declare positive weights for every allowed beat. The current beat's weight is one factor in the seeded effective weight, alongside ordinary requirements, once-per-run rules, cooldown/recent exclusion, encounter policy, concrete fact modifiers, and pacing pressure. Do not use `Math.random`.

Anchor and ending cards are not ambient content. Keep prose short enough for the mobile card, keep choices declarative, and add every art ID to the local SVG allowlist through imported content.

## Anchor variants

Only Catalyst, Break into Two, Midpoint, All Is Lost, Break into Three, Finale, and Final Image use mandatory anchor families. An anchor family contains conditional variants and an unconditional fallback:

```js
anchor: {
  variants: [
    {
      cardId: "all-lost-serin-taken",
      requirements: [
        { type: "storyFactEquals", key: "trustedSerin", value: true }
      ],
      weight: 1
    }
  ],
  fallbackCardId: "all-lost-wounded-retreat"
}
```

Eligibility goes through the shared requirement evaluator. Selection uses the serializable seeded RNG. The chosen card ID is persisted in `story.selectedAnchorIdByBeat`; reload does not reroll it, and later resource changes cannot silently replace it. Resolution is recorded once in `story.resolvedAnchorIds`. Non-major beats use one or more completion candidates, not a disguised single mandatory anchor.

## Concrete story facts

Choices record observable actions such as `helpedEvacuation`, `trustedSerin`, `recoveredSunShard`, `serinCaptured`, `learnedCrownTruth`, and `finalPlan`. Objective counters such as `villagersRescued` are also valid.

Do not add morality, karma, virtue, cruelty, alignment, or a renamed equivalent. Those values flatten authored causality into a hidden score. Concrete facts make anchor requirements, delayed consequences, boss behavior, and ending variations inspectable and testable.

## Encounter policies

Each beat declares one of four modes:

- `none`: no encounter can be selected.
- `random`: eligible enemy tags and encounter pacing apply.
- `scripted-only`: only an authored story effect may start combat.
- `boss-only`: only the beat's declared boss sequence may start combat.

`weightMultiplier`, `allowedEnemyTags`, `maximumRandomEncounters`, and `minimumCardsBeforeEncounter` further constrain random encounters. Existing recent-encounter and anti-repetition rules still apply. Midpoint and Finale bosses never enter the ordinary random pool.

## Major interstitials

Entering Break into Two, Midpoint, All Is Lost, Break into Three, or Finale may set `story.pendingInterstitialBeatId` and enter `storyTransition` mode. Each of those beat definitions provides original display copy:

```js
interstitial: {
  subtitle: "The Gate That Hunts",
  sentence: "Steel wings wake above the pass, guarding a truth Malrec failed to bury."
}
```

The renderer shows the exact beat name, subtitle, sentence, and a single accessible **Continue** button. Swiping and binary choices remain disabled. Dismissal records the beat in `shownInterstitialBeatIds`, persists immediately, and does not count as a world decision. Reload restores a pending interstitial. The same transition cannot appear twice in a run.

## Midpoint, All Is Lost, and Finale rules

The Midpoint is a fixed two-world-card sequence: introduction/confrontation, mandatory Iron Wyvern combat, then aftermath/revelation. Combat rounds, loot, and level-up screens do not consume its two-card budget. The beat cannot advance until the midboss is defeated and the aftermath tag resolves.

All Is Lost is an authored, recoverable setback selected from concrete prior actions and resources. It cannot fake a combat loss, delete a quest-critical item, silently delete equipped gear, or reduce HP below 1. Every family has an unconditional fallback. The chosen card records the specific setback as a fact for later recovery and Finale copy.

Finale is a three-to-five-world-card sequence: approach/preparation, boss-introduction anchor, multi-round Malrec combat, post-boss Crown decision, and ending selection. Boss defeat sets a concrete fact and queues resolution; it does not enter victory. The chosen ending leads into its ending-specific Final Image. Only resolution of that Final Image completes the arc and permits victory mode.

## Story progress

Story progress is derived, never separately mutated:

1. Sum the target budgets of completed beats.
2. Add up to the current beat's target from `cardsResolvedInBeat`.
3. Divide by the total target budget of 35.
4. Cap below 100% until the Final Image resolves and the arc is marked complete.

Combat rounds, inventory actions, loot, and interstitials cannot change this value. The HUD therefore remains monotonic and narrative-only in exploration, combat, loot, and level-up modes.

## Saves and migration

Schema version 2 adds explicit `story` state while retaining the existing local-storage key for practical continuity. Saves include the current beat/counts, facts, tags, selected/resolved anchors, forced story queue, pending/shown interstitials, ending selection, active combat, current card, seed, and RNG state.

Loading a version 1 save preserves valid meta discoveries and records, but starts a new Ember Crown run at Opening Image. It never guesses a beat from deprecated `journeyStep` or carries incompatible run resources forward. The old journey value is migration input only.

Client-side saves are player-controlled and can be inspected or edited. Story state, checkpoints, discoveries, and run records are not tamper-proof and must not be treated as authoritative competitive or financial data.

## Debug checkpoints

Development checkpoints use stable IDs from `01-opening-image` through `15-final-image`. A snapshot contains the deterministic run state and RNG state, while restoration keeps the current global meta progression and discards transient gesture/animation state.

Checkpoint controls are absent from ordinary play. They appear only on a local hostname with explicit URL opt-in:

```text
http://localhost:5000/?debug-checkpoints=1
```

The UI delegates save/restore to the story-checkpoint module; DOM handlers do not edit story fields. Do not loosen the local-host check or ship a public production cheat menu.

## Adding another arc

1. Create an immutable arc module under `public/js/data/arcs/` with a new stable ID and all 15 canonical beats.
2. Use the exact order and budgets above; add deterministic completion candidates for every beat.
3. Define the seven major anchor families with unconditional fallbacks and the five required interstitials.
4. Define beat encounter policies, a distinct mandatory Midpoint boss, the Finale boss sequence, and exactly two endings with distinct Final Images.
5. Add 45–60 concise world/story cards. Mark every card's role, count behavior, allowed beat weights, and optional arc restriction explicitly. Provide enough eligible content for every minimum, target, maximum, and fallback path.
6. Add local SVG art and update enemy/item data without placing bosses in random pools.
7. Register the arc and card collections in the central imported content lookup. Do not fetch data or add card-specific callbacks.
8. Run `validateArcDefinition` in tests and development startup. Supply the known card, enemy, item, and ending collections so unknown references cannot pass.
9. Add fixed-seed story simulations covering no-soft-lock completion, 30–40 world decisions, both endings, death/restart, reload, and checkpoint determinism.
10. Run `npm test`, `npm run check:security`, and `npm run build` before manual browser acceptance.

The validator must reject incorrect beat order/count/budgets, duplicate or unknown IDs, malformed anchors and fallbacks, impossible objectives, non-positive weights, missing explicit count flags, unknown content references, invalid Finale/ending definitions, direct beat-advance effects, and detectable morality/alignment state.
