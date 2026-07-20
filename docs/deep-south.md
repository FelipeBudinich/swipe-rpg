# Deep South domain contract

`public/js/data/deep-south.js` is the sole ordered story definition. Its nine
immutable decks determine display order, plot-step numbering, boundaries, and
HUD copy.

## Version-5 state

```js
{
  saveVersion: 5,
  storyId: "deep-south",
  status: "playing",
  terminalPending: false,
  currentDeckId: "it-begins-here",
  introCardIndex: 0,
  introSkipPending: false,
  discoveries: {
    fatherDiaryReverse: false
  },
  revealedCardIds: [],
  unlockedCardIdsByDeck,
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
  }
}
```

Unknown revealed IDs, unlock IDs, and discovery IDs are discarded. Synthetic
control cards are never revealed. A new run clears all reveals, discoveries,
dynamic unlocks, and draw state.

Version-4 saves migrate in place. A completed or reverse photograph maps to
`revealedCardIds: ["intro-fathers-diary"]`; v4 plot cards remain unlocked; an
old pending outcome is discarded without replaying its already-applied effect.
The migration preserves compatible resources, deck, Intro index,
skip-confirmation state, decisions, seed, RNG, and draw piles.

## Universal card contract

Every authored Intro and plot card contains:

```js
{
  id,
  deckId,
  type,
  initiallyAvailable,
  faces: {
    front: { title, text, artId, artAlt, artLabel? },
    back: { title, text, artId, artAlt, artLabel?, effect }
  },
  entryEffect
}
```

`entryEffect` is explicit and either normalized or `null`. Authored cards do
not contain direction-specific choices, costs, results, or tones. The skip
confirmation is the sole synthetic Up/Down control and is not an authored
story card.

The generic face rule is:

```text
card.id absent from revealedCardIds -> front -> Left/Right may flip
card.id present in revealedCardIds  -> back  -> only Up/Down
```

Both horizontal plans are synthesized from `faces.back.effect`. They share
label, destination, mode, detail, affordability, affected resources, and
execution. A successful flip keeps the card and deck active, keeps draw/RNG
state unchanged, applies the effect atomically, records the reveal once, and
issues a fresh back token.

## Effects

The only executable effect fields are:

```js
{
  resources?: {
    eldritchLore?: integer,
    crew?: integer,
    sanity?: integer
  },
  addCards?: [{ deckId, cardIds }],
  discoveries?: ["fatherDiaryReverse"]
}
```

The centralized normalizer ignores unknown fields and rejects malformed card
additions atomically. No authored callbacks execute.

An ordinary plot back is exactly one of:

- one resource at `+1` and a different resource at `-1`; or
- one or more valid card additions with no resource deltas.

The photograph is the explicit Intro exception: `+1 Eldritch Lore` plus the
discovery. Other Intro backs may have a null effect.

An entry effect may be null, one `+1` or `-1` resource delta, or valid card
additions. Entry effects belong to destinations. They never gate navigation.
Backs that spend Crew or Lore are blocked until affordable; Sanity loss never
blocks a reveal.

One formatter produces preview details, back details, and accessible effect
copy. Null effects produce an empty string.

## Canonical direction planning

`planDirection(state, currentCard, direction, story)` is pure and is consumed
by the engine, renderer, pointer availability, keyboard availability,
preview labels, effect details, HUD highlighting, and accessibility copy.

Horizontal plans:

```text
front Left/Right -> mode "flip", same destination card, back effect
back Left/Right  -> unavailable, reason "card-already-revealed"
```

Vertical plans:

```text
Intro Up   -> next Intro, then Castro
Intro Down -> skip confirmation
Castro Up  -> unavailable
Plot Up    -> next card in previous chapter
Plot Down  -> next unresolved card in current draw cycle
              or first card in the next chapter after exhaustion
Final Down -> deterministic current-deck refill
```

The pure draw planner returns the exact destination ID, next draw state, and
next RNG state without mutating inputs. Commit recomputes from unchanged state
and enters the same card that was previewed.

## Resolution and loss

One successful plot swipe is one decision. A preview or blocked/stale call is
zero decisions. Intro swipes preserve the existing zero-decision behavior.
Tokens include decision count, deck, card, and face; a front token becomes
stale after a flip.

Vertical departure discards the source according to its deck lifecycle,
commits the planned destination and RNG, applies the destination entry effect,
and returns the destination card immediately.

If a back or entry effect reduces Sanity to zero, that newly displayed back or
destination remains visible with `terminalPending: true`. Only Up or Down may
then expose the terminal summary. There is no outcome surface or Continue
control. Begin Again creates a fresh version-5 run.

## Unlocks and counts

Locked cards are excluded from initial piles and HUD counts. Valid additions
unlock authored IDs idempotently and append them to an initialized remaining
draw pile in authored order. An untouched future deck remains lazily shuffled
from its complete unlocked set. Duplicate pile IDs are normalized away.

For a plot chapter, the HUD count is the unique IDs in its draw pile plus the
active current card when it belongs to that chapter and is not already in the
pile. A flip does not change the count. Navigation and unlocks update it
immediately.
