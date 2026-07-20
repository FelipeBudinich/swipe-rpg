# Deep South

Deep South is a mobile-first, four-direction card game about an expedition
from Chiloé into an impossible southern sea. It uses static HTML, native
JavaScript modules, locally compiled Tailwind CSS, and a small hardened Node.js
file server.

Every authored story card has a front and a back. Left and Right are
equivalent on a front: either direction previews the same effect and turns the
same card over. The back contains the result narrative and the effect that was
applied. A revealed card cannot return to its front, so only Up and Down remain
available on its back.

Up and Down navigate immediately. Their preview is planned from the exact
destination card and shows that card's entry effect, if any. Committing the
direction applies the planned entry effect and renders the destination with no
intervening outcome card, Continue control, modal, or acknowledgement step.

## Architecture

- `public/js/data/deep-south.js` is the canonical story registry and ordered
  nine-deck definition.
- `public/js/data/cards/deep-south-cards.js` contains the eight Intro cards and
  forty plot cards using the universal two-face schema.
- `public/js/data/art-assets.js` maps allowlisted art IDs to local raster or SVG
  assets.
- `public/js/game/state.js` owns the serializable version-5 run and version-4
  migration.
- `public/js/game/deck-draw.js` owns pure deterministic per-deck draw planning,
  draw, discard, and refill behavior.
- `public/js/game/card-effects.js` normalizes, formats, previews, and applies
  resource, discovery, and card-addition effects.
- `public/js/game/direction-plan.js` is the single authority for direction
  availability, destinations, effects, labels, and deterministic peeks.
- `public/js/game/engine.js` commits canonical flips and navigation, loss, and
  restart.
- `public/js/game/choice-availability.js` exposes the canonical direction plan
  to input callers.
- `public/js/ui/render.js` renders the HUD, story card, transient direction
  previews, and terminal surface.
- `public/js/ui/swipe-controller.js` implements four-axis Pointer Events
  gestures.
- `public/js/ui/directional-input.js` maps keyboard arrows to the same direction
  policy.
- `public/js/main.js` coordinates persistence, input locking, animation,
  rendering, resource pulses, and focus.
- `server.js` serves `public/` with strict headers and path containment.

Rendering and input handlers never choose destinations or mutate resources.
They consume the same pure plan that the engine commits.

## Decks and navigation

| Order | Type | ID | Display name |
| ---: | --- | --- | --- |
| 0 | Intro | `it-begins-here` | It begins here |
| 1 | Chapter 1 | `castro` | Castro |
| 2 | Chapter 2 | `investigate-church` | Investigate Church |
| 3 | Chapter 3 | `gather-crew` | Gather Crew |
| 4 | Chapter 4 | `navigate` | Navigate |
| 5 | Chapter 5 | `rest-at-desolate-beach` | Rest at desolate beach |
| 6 | Chapter 6 | `reach-the-coordinates` | Reach the coordinates |
| 7 | Chapter 7 | `explore-rlyeh` | Explore R'lyeh |
| 8 | Chapter 8 | `gather-evidence` | Gather Evidence |

The Intro is sequential. Down reads the next Intro card; Up opens the persisted
skip confirmation. From that control, Down returns to the same Intro card and
Up enters Castro. A revealed Intro card stays revealed if the confirmation
is opened and cancelled.

For plot cards:

- Down draws from the previous chapter. Down is unavailable in Castro.
- Up draws the next unresolved card in the current draw cycle.
- When the current cycle is exhausted, Up advances to the next chapter.
- In Gather Evidence, Up deterministically refills the deck when exhausted
  and avoids an immediate repeat when another card exists.

Plot decks retain independent draw/discard piles. Pure planning previews the
exact deterministic destination without consuming RNG or mutating a pile.

## Controls

- Swipe or press **Arrow Left** or **Arrow Right** to turn a front card over.
- Swipe or press **Arrow Up** to continue through the current chapter and
  onward.
- Swipe or press **Arrow Down** to return toward the previous chapter. Down is
  unavailable in Castro.

There are no visible directional buttons. Direction feedback appears
transiently below the card header. On a front, both horizontal previews use the
same label, effect detail, affordability, and resource highlight. On a back,
horizontal drag and keyboard directions are unavailable.

The first photograph uses the custom label **Turn the photograph over**. Its
preview shows `Discovery recorded · +1 Eldritch Lore`; the one-way reveal
awards the Lore and records `fatherDiaryReverse` exactly once. The reverse map,
coordinates, and discovery detail remain on the same card.

The top HUD contains only Deep South and Eldritch Lore, Crew, and Sanity. The
card header announces the chapter and live unlocked-card count:

```text
Chapter 4, Navigate - 5 cards left in deck
```

The count includes the active card, excludes locked cards, does not count the
back as another card, remains stable during a flip, and updates immediately
when cards are unlocked.

## Card and effect data

Every authored card uses one face pair and an explicit entry effect:

```js
{
  id: "navigate-wrong-stars",
  deckId: "navigate",
  type: "plot",
  initiallyAvailable: true,
  faces: {
    front: {
      title: "Stars in the wrong water",
      text: "...",
      artId: "deep-south-navigate",
      artAlt: "..."
    },
    back: {
      title: "Sound the depth",
      text: "The lead line never strikes bottom and returns warm.",
      artId: "deep-south-navigate",
      artAlt: "...",
      effect: {
        resources: {
          eldritchLore: 1,
          sanity: -1
        }
      }
    }
  },
  entryEffect: null
}
```

Ordinary plot backs contain either one `+1`/`-1` resource exchange or a
card-addition effect. Entry effects use the same normalized shape and may be
`null`, one resource delta, or a card addition. A null entry effect keeps its
route available and produces no empty preview line.

Negative Crew and Eldritch Lore on a back are affordability requirements.
Negative Sanity is never a gate and may end the run. Resources clamp at zero:

```js
{
  eldritchLore: 0,
  crew: 0,
  sanity: 3
}
```

Card additions validate deck membership atomically, unlock idempotently, and
join an initialized draw pile in authored order. Locked cards are draw-eligible
and counted only after they are unlocked.

See [the domain contract](docs/deep-south.md) and
[the retired-outcome migration ledger](docs/retired-directional-outcomes.md)
for the full rules and content decisions.

## Persistence and migration

State is saved after every successful flip, navigation, terminal transition,
and restart under the existing local-storage key. Schema version 5 persists:

- Story identity, current deck, Intro position, and skip confirmation
- `revealedCardIds`
- `unlockedCardIdsByDeck`
- `fatherDiaryReverse` and other allowlisted discoveries
- Current card identity and face-aware deterministic token
- Independent draw/discard state, run seed, and RNG state
- Decision count, terminal-pending state, and the three resources

Compatible version-4 saves migrate without replaying effects. The old
photograph discovery/reverse state maps to the generic revealed-card
collection. All v4 plot cards remain unlocked to preserve compatible runs.
Legacy pending-outcome payloads are discarded; already-applied resources,
decision count, RNG, and draw piles are retained, and the destination is
prepared normally. Older or foreign-story state starts a clean run.

## Development

Requirements: Node.js 24 and npm 11.

```bash
npm ci
npm test
npm run check:security
npm run build
npm run audit:runs
npm audit --audit-level=high
npm start
```

Development mode:

```bash
npm run dev
```

The game has no runtime packages, remote assets, API, account system, or
network-loaded content.
