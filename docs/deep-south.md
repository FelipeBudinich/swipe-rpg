# Deep South domain contract

`public/js/data/deep-south.js` is the sole ordered story definition. Its nine immutable deck objects determine display order, plot-step numbering, boundaries, and HUD copy.

## State

The version-3 run state is serializable:

```js
{
  saveVersion: 3,
  storyId: "deep-south",
  status: "playing",
  currentDeckId: "it-begins-here",
  introCardIndex: 0,
  introSkipPending: false,
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

Intro cards are read in sequence with up. A first left action shows the special skip-confirmation surface; a second left enters Castro. Up from that surface returns to the same Intro card.

For plot cards, the engine alone maps direction to destination:

```text
up    -> max(Plot Step 1, current step - 1)
down  -> min(Plot Step 8, current step + 1)
left  -> current step
right -> current step
```

Cards provide labels, result prose, and resource effects. They cannot override navigation.

## Draw lifecycle

Each plot deck persists:

```js
{
  drawPile: [],
  discardPile: [],
  lastResolvedCardId: null
}
```

Drawing is deterministic from the persisted random state. Resolution discards the source card before changing decks. The destination card is not drawn until the outcome is acknowledged. Exhaustion reshuffles that deck's discard pile and avoids an immediate repeat when another card exists.

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
- Intro content has at least four sequential cards.
- Every plot deck has at least five cards.
- Card IDs are globally unique.
- Every plot card defines up, down, left, and right.
- Effects contain only Eldritch Lore, Crew, and Sanity integer deltas.
- No resource gate can remove every action.
- Artwork is local, allowlisted, and script-free.

These rules are enforced by `tests/deep-south-content.test.js` and the engine/domain suites.
