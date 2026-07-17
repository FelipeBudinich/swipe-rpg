# Deep South domain contract

`public/js/data/deep-south.js` is the sole ordered story definition. Its nine immutable deck objects determine display order, plot-step numbering, boundaries, and HUD copy.

## State

The version-4 run state is serializable:

```js
{
  saveVersion: 4,
  storyId: "deep-south",
  status: "playing",
  currentDeckId: "it-begins-here",
  introCardIndex: 0,
  introSkipPending: false,
  introCardFace: "front",
  discoveries: {
    fatherDiaryReverse: false
  },
  currentCardId: null,
  currentCardToken: null,
  lastResolvedToken: null,
  decisionCount: 0,
  runSeed,
  rngState,
  drawStateByDeck,
  resources: {
    eldritchLore: 0,
    crew: 0,
    sanity: 3
  },
  pendingFeedback: null
}
```

The ordered deck index is derived from the story definition and is not persisted.

## Navigation

Intro cards are read in sequence with up. A first down action shows the special skip-confirmation surface; a second down enters Castro. Up from that surface returns to the same Intro card and face.

The first Intro card is reversible. Left or right toggles its front and reverse without changing the Intro index or cards-left count. Its first reverse reveal records `discoveries.fatherDiaryReverse` and grants one Eldritch Lore exactly once; subsequent flips and reloads cannot repeat the reward. Cards 2–8 keep left and right present but disabled.

For plot cards, the engine alone maps direction to destination:

```text
up    -> max(Chapter 1, current chapter - 1)
down  -> min(Chapter 8, current chapter + 1)
left  -> current chapter
right -> current chapter
```

Cards provide labels, result prose, optional payable costs, and resource effects. They cannot override navigation. Up and down are required; left and right may be omitted when no meaningful local action exists.

## Choice availability and costs

One pure availability contract is shared by buttons, keyboard input, swipe
input, and the engine resolver. Missing choices and choices whose declared
Crew or Eldritch Lore costs cannot be paid are disabled without mutating the
run.

Payable costs use:

```js
costs: {
  crew: 1,
  eldritchLore: 0
}
```

Costs are deducted exactly once before the authored effects are applied.
Unexpected negative effects remain consequences and clamp normally. Sanity
loss is always a consequence, never an affordability check.

## Draw lifecycle

Each chapter deck persists:

```js
{
  drawPile: [],
  discardPile: [],
  lastResolvedCardId: null
}
```

Drawing is deterministic from the persisted random state. Resolution discards the source card before changing chapters. The destination card is not drawn until the outcome is acknowledged. Exhaustion reshuffles that deck's discard pile and avoids an immediate repeat when another card exists.

The HUD derives cards remaining directly from this state. For an active
chapter it adds the draw-pile length to the currently displayed unresolved
card. During persistent feedback it keeps the source chapter heading until
Continue draws the destination card. Intro count is the Intro length minus its
current sequential index.

## Outcome lifecycle

A plot decision:

1. Applies and clamps resource effects.
2. Discards the source card.
3. Derives the destination from direction.
4. Persists the destination and outcome payload with no current card.
5. Blocks further directional input.
6. Draws the destination card only after Continue.

If Sanity reaches zero, `status` is already `lost`, but the outcome remains the primary surface. Continue clears the outcome and reveals the loss presentation. Begin Again creates a completely fresh Intro and fresh plot-deck state.

## Content invariants

- Exactly one Intro deck and eight numbered plot decks exist.
- Intro content has exactly eight sequential primary cards; the first card's reverse is a face, not a ninth card.
- Every plot deck has at least five cards.
- Card IDs are globally unique.
- Every plot card defines up and down; left and right are optional.
- Effects contain only Eldritch Lore, Crew, and Sanity integer deltas.
- Costs contain only nonnegative Crew and Eldritch Lore integers.
- No resource gate can remove every action.
- Artwork is local, allowlisted, and script-free.

These rules are enforced by `tests/deep-south-content.test.js` and the engine/domain suites.
