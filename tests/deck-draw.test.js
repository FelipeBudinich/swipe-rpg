import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeckDrawState,
  createDrawStateByDeck,
  discardToDeck,
  drawFromDeck,
  normalizeDeckDrawState,
  normalizeDrawStateByDeck,
} from "../public/js/game/deck-draw.js";

const cards = Object.freeze([
  Object.freeze({ id: "card-a" }),
  Object.freeze({ id: "card-b" }),
  Object.freeze({ id: "card-c" }),
]);

const decks = Object.freeze([
  Object.freeze({ id: "intro", type: "intro", cards: [{ id: "intro-card" }] }),
  Object.freeze({ id: "plot-one", type: "plot", cards }),
  Object.freeze({
    id: "plot-two",
    type: "plot",
    cards: [{ id: "card-d" }, { id: "card-e" }],
  }),
]);

test("draw-state factories create independent plot decks and exclude the sequential Intro", () => {
  assert.deepEqual(createDeckDrawState(), {
    drawPile: [],
    discardPile: [],
    lastResolvedCardId: null,
  });
  assert.deepEqual(createDrawStateByDeck(decks), {
    "plot-one": createDeckDrawState(),
    "plot-two": createDeckDrawState(),
  });
});

test("seeded draws are deterministic and use every card before reshuffling", () => {
  const transcript = (seed) => {
    let drawState = createDeckDrawState();
    let rngState = seed;
    const drawn = [];
    for (let index = 0; index < cards.length; index += 1) {
      const result = drawFromDeck(drawState, cards, rngState);
      drawn.push(result.cardId);
      drawState = discardToDeck(result.drawState, result.cardId, cards);
      rngState = result.rngState;
    }
    return { drawn, drawState, rngState };
  };

  const first = transcript(1234);
  const second = transcript(1234);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.drawn).size, cards.length);
  assert.deepEqual(new Set(first.drawState.discardPile), new Set(cards.map(({ id }) => id)));
});

test("an exhausted deck reshuffles its discard without an immediate repeat when avoidable", () => {
  const exhausted = {
    drawPile: [],
    discardPile: ["card-a", "card-b", "card-c"],
    lastResolvedCardId: "card-c",
  };
  const result = drawFromDeck(exhausted, cards, 7);

  assert.notEqual(result.cardId, "card-c");
  assert.equal(result.drawState.discardPile.length, 0);
  assert.equal(result.drawState.drawPile.length, 2);
  assert.deepEqual(
    new Set([result.cardId, ...result.drawState.drawPile]),
    new Set(cards.map(({ id }) => id)),
  );
});

test("discard and normalization reject duplicate, foreign, and cross-pile card IDs", () => {
  const normalized = normalizeDeckDrawState(
    {
      drawPile: ["card-a", "foreign", "card-a", "card-b"],
      discardPile: ["card-b", "card-c", "foreign"],
      lastResolvedCardId: "foreign",
    },
    cards,
  );
  assert.deepEqual(normalized, {
    drawPile: ["card-a", "card-b"],
    discardPile: ["card-c"],
    lastResolvedCardId: null,
  });

  assert.deepEqual(discardToDeck(normalized, "foreign", cards), normalized);
  assert.deepEqual(discardToDeck(normalized, "card-a", cards), {
    drawPile: ["card-b"],
    discardPile: ["card-c", "card-a"],
    lastResolvedCardId: "card-a",
  });
});

test("per-deck normalization preserves valid piles and supplies fresh missing deck state", () => {
  const normalized = normalizeDrawStateByDeck(
    {
      "plot-one": {
        drawPile: ["card-b"],
        discardPile: ["card-a"],
        lastResolvedCardId: "card-a",
      },
      foreign: {
        drawPile: ["foreign"],
        discardPile: [],
        lastResolvedCardId: null,
      },
    },
    decks,
  );

  assert.deepEqual(normalized, {
    "plot-one": {
      drawPile: ["card-b"],
      discardPile: ["card-a"],
      lastResolvedCardId: "card-a",
    },
    "plot-two": createDeckDrawState(),
  });
});
