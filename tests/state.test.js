import test from "node:test";
import assert from "node:assert/strict";

import { createPendingFeedback } from "../public/js/game/choice-feedback.js";
import {
  INITIAL_RESOURCES,
  SAVE_VERSION,
  STORY_ID,
  cloneState,
  createInitialState,
  normalizeState,
} from "../public/js/game/state.js";

const TEST_DECKS = Object.freeze([
  Object.freeze({
    id: "it-begins-here",
    type: "intro",
    cards: Object.freeze([
      Object.freeze({ id: "intro-one" }),
      Object.freeze({ id: "intro-two" }),
    ]),
  }),
  Object.freeze({
    id: "castro",
    type: "plot",
    cards: Object.freeze([
      Object.freeze({ id: "castro-one" }),
      Object.freeze({ id: "castro-two" }),
    ]),
  }),
  Object.freeze({
    id: "investigate-church",
    type: "plot",
    cards: Object.freeze([
      Object.freeze({ id: "church-one" }),
      Object.freeze({ id: "church-two" }),
    ]),
  }),
]);

test("a fresh run has only the Deep South resources and begins at the Intro", () => {
  const state = createInitialState({ seed: 17, decks: TEST_DECKS });

  assert.equal(state.saveVersion, SAVE_VERSION);
  assert.equal(state.storyId, STORY_ID);
  assert.equal(state.storyId, "deep-south");
  assert.equal(state.status, "playing");
  assert.equal(state.currentDeckId, "it-begins-here");
  assert.equal(state.introCardIndex, 0);
  assert.equal(state.introSkipPending, false);
  assert.equal(state.currentCardId, null);
  assert.equal(state.pendingFeedback, null);
  assert.deepEqual(state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
  assert.deepEqual(state.resources, INITIAL_RESOURCES);
  assert.deepEqual(Object.keys(state.drawStateByDeck), [
    "castro",
    "investigate-church",
  ]);
  assert.equal(Object.hasOwn(state, "player"), false);
  assert.equal(Object.hasOwn(state, "story"), false);
  assert.equal(Object.hasOwn(state, "version"), false);
});

test("Intro position and skip confirmation survive defensive normalization", () => {
  const raw = {
    ...createInitialState({ seed: 18, decks: TEST_DECKS }),
    introCardIndex: 1,
    introSkipPending: true,
    currentCardId: "intro-two",
    currentCardToken: "intro-skip:1:intro-two",
  };
  const normalized = normalizeState(JSON.parse(JSON.stringify(raw)), {
    decks: TEST_DECKS,
  });

  assert.equal(normalized.currentDeckId, "it-begins-here");
  assert.equal(normalized.introCardIndex, 1);
  assert.equal(normalized.introSkipPending, true);
  assert.equal(normalized.currentCardId, null);
  assert.equal(normalized.currentCardToken, null);
});

test("plot card, independent draw piles, and tokens survive reload", () => {
  const raw = {
    ...createInitialState({ seed: 19, decks: TEST_DECKS }),
    currentDeckId: "castro",
    introCardIndex: 1,
    currentCardId: "castro-two",
    currentCardToken: "4:castro-two",
    lastResolvedToken: "3:church-one",
    decisionCount: 4,
    drawStateByDeck: {
      castro: {
        drawPile: ["castro-one"],
        discardPile: [],
        lastResolvedCardId: null,
      },
      "investigate-church": {
        drawPile: [],
        discardPile: ["church-one"],
        lastResolvedCardId: "church-one",
      },
    },
    resources: {
      eldritchLore: 2,
      crew: 1,
      sanity: 2,
    },
  };
  const normalized = normalizeState(JSON.parse(JSON.stringify(raw)), {
    decks: TEST_DECKS,
  });

  assert.equal(normalized.currentDeckId, "castro");
  assert.equal(normalized.currentCardId, "castro-two");
  assert.equal(normalized.currentCardToken, "4:castro-two");
  assert.equal(normalized.lastResolvedToken, "3:church-one");
  assert.equal(normalized.decisionCount, 4);
  assert.deepEqual(normalized.drawStateByDeck, raw.drawStateByDeck);
  assert.deepEqual(normalized.resources, raw.resources);
  assert.equal(normalized.introSkipPending, false);
});

test("pending result feedback survives reload only in its destination with no exposed card", () => {
  const base = createInitialState({ seed: 20, decks: TEST_DECKS });
  const feedback = createPendingFeedback({
    sourceCardId: "castro-one",
    sourceCardToken: "0:castro-one",
    sourceDeckId: "castro",
    direction: "down",
    destinationDeckId: "investigate-church",
    resultText: "The chart draws the expedition south.",
    changes: { eldritchLore: 1 },
  });
  const raw = {
    ...base,
    currentDeckId: "investigate-church",
    currentCardId: null,
    pendingFeedback: feedback,
    resources: { eldritchLore: 1, crew: 0, sanity: 3 },
  };

  const normalized = normalizeState(JSON.parse(JSON.stringify(raw)), {
    decks: TEST_DECKS,
  });
  assert.deepEqual(normalized.pendingFeedback, feedback);
  assert.equal(normalized.currentCardId, null);

  const wrongDestination = normalizeState(
    { ...raw, currentDeckId: "castro" },
    { decks: TEST_DECKS },
  );
  assert.equal(wrongDestination.pendingFeedback, null);

  const exposedCard = normalizeState(
    { ...raw, currentCardId: "church-one", currentCardToken: "1:church-one" },
    { decks: TEST_DECKS },
  );
  assert.equal(exposedCard.pendingFeedback, null);
});

test("Sanity alone derives lost status and pending loss feedback remains reloadable", () => {
  const base = createInitialState({ seed: 21, decks: TEST_DECKS });
  const feedback = createPendingFeedback({
    sourceCardId: "castro-one",
    sourceCardToken: "0:castro-one",
    sourceDeckId: "castro",
    direction: "left",
    destinationDeckId: "castro",
    resultText: "The wet symbols remain behind closed eyes.",
    changes: { sanity: -1 },
  });
  const lost = normalizeState(
    {
      ...base,
      status: "playing",
      currentDeckId: "castro",
      resources: { eldritchLore: 0, crew: 0, sanity: 0 },
      pendingFeedback: feedback,
    },
    { decks: TEST_DECKS },
  );
  assert.equal(lost.status, "lost");
  assert.equal(lost.resources.sanity, 0);
  assert.deepEqual(lost.pendingFeedback, feedback);

  const zeroCrew = normalizeState(
    {
      ...base,
      status: "lost",
      currentDeckId: "castro",
      resources: { eldritchLore: 0, crew: 0, sanity: 2 },
    },
    { decks: TEST_DECKS },
  );
  assert.equal(zeroCrew.status, "playing");
});

test("malformed current cards, resources, draw piles, and Intro fields are repaired", () => {
  const raw = {
    ...createInitialState({ seed: 22, decks: TEST_DECKS }),
    currentDeckId: "castro",
    introCardIndex: 99,
    introSkipPending: true,
    currentCardId: "obsolete-fantasy-card",
    currentCardToken: "old-token",
    decisionCount: -20,
    drawStateByDeck: {
      castro: {
        drawPile: ["castro-one", "obsolete-fantasy-card", "castro-one"],
        discardPile: ["castro-one", "castro-two"],
        lastResolvedCardId: "obsolete-fantasy-card",
      },
      "obsolete-beat": {
        drawPile: ["old-card"],
        discardPile: [],
      },
    },
    resources: {
      eldritchLore: -2,
      crew: "4",
      sanity: Number.NaN,
    },
  };
  const normalized = normalizeState(raw, { decks: TEST_DECKS });

  assert.equal(normalized.introCardIndex, 1);
  assert.equal(normalized.introSkipPending, false);
  assert.equal(normalized.currentCardId, null);
  assert.equal(normalized.currentCardToken, null);
  assert.equal(normalized.decisionCount, 0);
  assert.deepEqual(normalized.resources, {
    eldritchLore: 0,
    crew: 4,
    sanity: 3,
  });
  assert.deepEqual(normalized.drawStateByDeck.castro, {
    drawPile: ["castro-one"],
    discardPile: ["castro-two"],
    lastResolvedCardId: null,
  });
  assert.equal(Object.hasOwn(normalized.drawStateByDeck, "obsolete-beat"), false);
});

test("incompatible and wrong-story saves migrate to a completely fresh Deep South run", () => {
  const incompatible = normalizeState(
    {
      version: 2,
      runSeed: 88,
      story: {
        arcId: "legacy-story",
        currentBeatId: "legacy-phase",
      },
      player: {
        level: 9,
        xp: 80,
        hp: 1,
        mp: 4,
      },
      currentCardId: "legacy-card",
      pendingChoiceFeedback: {
        resultText: "The old crown burns.",
      },
    },
    { seed: 23, decks: TEST_DECKS },
  );
  assert.deepEqual(incompatible, createInitialState({ seed: 23, decks: TEST_DECKS }));

  const wrongStory = normalizeState(
    {
      ...createInitialState({ seed: 24, decks: TEST_DECKS }),
      storyId: "foreign-story",
      currentDeckId: "castro",
      resources: { eldritchLore: 9, crew: 9, sanity: 1 },
    },
    { seed: 25, decks: TEST_DECKS },
  );
  assert.deepEqual(wrongStory, createInitialState({ seed: 25, decks: TEST_DECKS }));

  const mixedResources = normalizeState(
    {
      ...createInitialState({ seed: 27, decks: TEST_DECKS }),
      currentDeckId: "castro",
      resources: {
        eldritchLore: 4,
        crew: 3,
        sanity: 2,
        hp: 30,
      },
    },
    { seed: 28, decks: TEST_DECKS },
  );
  assert.deepEqual(
    mixedResources,
    createInitialState({ seed: 28, decks: TEST_DECKS }),
  );
});

test("cloneState returns a detached JSON-safe copy", () => {
  const original = createInitialState({ seed: 26, decks: TEST_DECKS });
  const cloned = cloneState(original);
  cloned.resources.sanity = 1;
  assert.equal(original.resources.sanity, 3);
  assert.equal(cloneState(() => {}), null);
});
