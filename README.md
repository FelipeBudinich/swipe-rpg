# Deep South

Deep South is a mobile-first, four-direction card game about an expedition from Chiloé into an impossible southern sea. It uses static HTML, native JavaScript modules, locally compiled Tailwind CSS, and a small hardened Node.js file server.

The expedition begins with eight sequential pieces of testimony. After Castro, every chapter is an independent deterministic card deck. Up moves toward Castro, down moves toward Gather Evidence, and left or right resolves an available local action. The run ends only when Sanity reaches zero.

## Architecture

- `public/js/data/deep-south.js` is the canonical story registry and ordered nine-deck definition.
- `public/js/data/cards/deep-south-cards.js` contains the eight Intro cards and forty plot cards.
- `public/js/data/art-assets.js` maps allowlisted art IDs to local raster or SVG assets.
- `public/js/game/state.js` owns the serializable run shape and migration.
- `public/js/game/deck-draw.js` owns deterministic per-deck draw/discard behavior.
- `public/js/game/engine.js` resolves Intro navigation, plot navigation, choices, feedback acknowledgement, loss, and restart.
- `public/js/game/effects.js` applies and clamps Eldritch Lore, Crew, and Sanity.
- `public/js/game/choice-availability.js` is the shared affordability and direction-availability policy used by the engine and every input path.
- `public/js/game/choice-feedback.js` creates and validates persistent outcome payloads.
- `public/js/ui/render.js` renders the HUD, transient directional previews, persistent outcome card, and loss surface.
- `public/js/ui/swipe-controller.js` implements four-axis Pointer Events gestures.
- `public/js/ui/directional-input.js` adapts keyboard arrows to the shared direction policy.
- `public/js/main.js` coordinates persistence, input locking, rendering, and focus.
- `server.js` serves `public/` with strict headers and path containment.

There is one state model and one canonical deck order. Rendering and input handlers never choose destination decks or mutate resources directly.

## Decks

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

The Intro is sequential. Plot decks draw without replacement, retain their own draw/discard piles when the expedition moves, and reshuffle deterministically when exhausted.

## Controls

- Swipe or press **Arrow Up** to move toward Castro.
- Swipe or press **Arrow Down** to move toward Gather Evidence.
- Swipe or press **Arrow Left** or **Arrow Right** for an available local action.
- Select **Continue** to acknowledge a persistent choice outcome.

During the Intro, up reads the next card. Down opens a persisted skip confirmation; down again enters Castro, while up cancels without advancing. The first card is reversible: left or right turns the photograph over, revealing a second coordinate and granting one Eldritch Lore exactly once per run. Left and right are unavailable on Intro cards 2–8.

The top HUD shows the story title and expedition resources. The current card
header shows the chapter, deck, and unresolved-card count:

```text
Chapter 4, Navigate - 5 cards left in deck
```

The count includes the currently displayed card. Dynamic cards added to a
chapter are included once they become available, while locked cards are
excluded until unlocked. Merely turning the current card over does not change
the count.

## Resources and loss

Fresh runs begin with:

```js
{
  eldritchLore: 0,
  crew: 0,
  sanity: 3
}
```

All three values clamp at zero. Zero Crew and zero Eldritch Lore remain playable. Sanity reaching zero is the only loss condition. The final Sanity change remains visible on the persistent outcome card before the loss surface appears.

## Card data

Plot cards always contain the required up/down navigation outcomes and may
optionally contain left/right local outcomes:

```js
{
  id: "navigate-wrong-stars",
  deckId: "navigate",
  type: "plot",
  title: "Stars in the wrong water",
  text: "...",
  artId: "deep-south-navigate",
  choices: {
    up: {
      label: "Turn toward cloud cover",
      result: "You seek the last ordinary weather.",
      effects: { eldritchLore: 0, crew: 0, sanity: 0 }
    },
    down: { /* authored outcome */ },
    left: null,
    right: {
      label: "Send a sailor below",
      costs: { crew: 1 },
      result: "...",
      effects: { eldritchLore: 1, crew: 0, sanity: 0 }
    }
  }
}
```

A card reached through up or down may declare `entryEffect: null`. That
destination stays available, its directional preview shows only the navigation
label, and it renders immediately without an outcome or Continue step.

To add a card:

1. Add it to the appropriate deck array in `public/js/data/cards/deep-south-cards.js`.
2. Give it a globally unique stable ID.
3. Supply up and down; add left/right only where the local action is meaningful.
4. Limit effects to `eldritchLore`, `crew`, and `sanity`.
5. Declare payable Crew or Eldritch Lore costs in `costs`, never twice in effects.
6. Keep navigation out of card data; direction-to-deck movement is centralized in the engine.
7. Run the content and full test suites.

## Persistence and migration

Run state is saved after every navigation, choice, outcome acknowledgement, and restart under the existing local-storage key. Schema version 4 persists:

- Story identity and playing/lost status
- Current deck and Intro position
- Intro skip-confirmation state
- The reversible diary face and its one-time discovery flag
- Current card identity and deterministic token
- Independent draw/discard state for every plot deck
- Seeded random state
- The three resources
- Persistent outcome feedback

Compatible version-3 Deep South saves migrate in place with the diary face set to front and the discovery unclaimed, preserving plot progress and resources. Older or foreign-story saves deliberately begin a clean Deep South run. The existing key is retained so those saves can be detected and replaced safely rather than ignored.

## Development

Requirements: Node.js 24 and npm 11.

```bash
npm ci
npm run build
npm test
npm run check:security
npm run audit:runs
npm start
```

Development mode:

```bash
npm run dev
```

The game has no runtime packages, remote assets, API, account system, or network-loaded content.

## Current scope

Gather Evidence deliberately has no automatic ending. The expedition can retreat, press deeper, or continue gathering proof until Sanity is exhausted. The current content ships with eight Intro cards and five cards in each of the eight plot decks.
