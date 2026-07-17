import test from "node:test";
import assert from "node:assert/strict";

import { createPendingFeedback } from "../public/js/game/choice-feedback.js";
import {
  INITIAL_DISCOVERIES,
  INITIAL_RESOURCES,
  INTRO_CARD_FACES,
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

function asVersionThree(state) {
  const legacy = structuredClone(state);
  legacy.saveVersion = 3;
  delete legacy.introCardFace;
  delete legacy.discoveries;
  return legacy;
}

test("a fresh run has only the Deep South resources and begins at the Intro", () => {
  const state = createInitialState({ seed: 17, decks: TEST_DECKS });
  const second = createInitialState({ seed: 17, decks: TEST_DECKS });

  assert.equal(state.saveVersion, SAVE_VERSION);
  assert.equal(state.saveVersion, 4);
  assert.equal(state.storyId, STORY_ID);
  assert.equal(state.storyId, "deep-south");
  assert.equal(state.status, "playing");
  assert.equal(state.currentDeckId, "it-begins-here");
  assert.equal(state.introCardIndex, 0);
  assert.equal(state.introSkipPending, false);
  assert.equal(state.introCardFace, "front");
  assert.deepEqual(state.discoveries, { fatherDiaryReverse: false });
  assert.deepEqual(state.discoveries, INITIAL_DISCOVERIES);
  assert.deepEqual(INTRO_CARD_FACES, ["front", "reverse"]);
  assert.notStrictEqual(state.discoveries, second.discoveries);
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

test("Intro position, reverse face, discovery, and skip confirmation survive normalization", () => {
  const raw = {
    ...createInitialState({ seed: 18, decks: TEST_DECKS }),
    introCardIndex: 0,
    introSkipPending: true,
    introCardFace: "reverse",
    discoveries: { fatherDiaryReverse: true },
    currentCardId: "intro-one",
    currentCardToken: "intro-skip:0:intro-one:reverse",
    resources: { eldritchLore: 0, crew: 0, sanity: 3 },
  };
  const normalized = normalizeState(JSON.parse(JSON.stringify(raw)), {
    decks: TEST_DECKS,
  });

  assert.equal(normalized.currentDeckId, "it-begins-here");
  assert.equal(normalized.introCardIndex, 0);
  assert.equal(normalized.introSkipPending, true);
  assert.equal(normalized.introCardFace, "reverse");
  assert.deepEqual(normalized.discoveries, { fatherDiaryReverse: true });
  assert.equal(normalized.resources.eldritchLore, 0);
  assert.equal(normalized.currentCardId, null);
  assert.equal(normalized.currentCardToken, null);
});

test("v4 Intro fields accept only canonical face and strict discovery values", () => {
  const base = createInitialState({ seed: 181, decks: TEST_DECKS });

  for (const invalidFace of [undefined, null, "back", "Reverse", 1, {}]) {
    const normalized = normalizeState(
      { ...base, introCardFace: invalidFace },
      { decks: TEST_DECKS },
    );
    assert.equal(normalized.introCardFace, "front");
  }

  const canonical = normalizeState(
    {
      ...base,
      currentDeckId: "castro",
      introCardFace: "reverse",
      discoveries: {
        fatherDiaryReverse: true,
        unknownDiscovery: true,
      },
    },
    { decks: TEST_DECKS },
  );
  assert.equal(canonical.introCardFace, "reverse");
  assert.deepEqual(canonical.discoveries, { fatherDiaryReverse: true });

  const undiscoveredReverse = normalizeState(
    {
      ...base,
      introCardFace: "reverse",
      discoveries: { fatherDiaryReverse: false },
    },
    { decks: TEST_DECKS },
  );
  assert.equal(undiscoveredReverse.introCardFace, "front");
  assert.deepEqual(undiscoveredReverse.discoveries, {
    fatherDiaryReverse: false,
  });

  for (const discoveries of [
    undefined,
    null,
    [],
    { fatherDiaryReverse: false },
    { fatherDiaryReverse: 1 },
    { fatherDiaryReverse: "true" },
  ]) {
    const normalized = normalizeState(
      { ...base, discoveries },
      { decks: TEST_DECKS },
    );
    assert.deepEqual(normalized.discoveries, {
      fatherDiaryReverse: false,
    });
    assert.equal(normalized.resources.eldritchLore, 0);
  }
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

test("normalization clears replay tokens that could deadlock a playing card", () => {
  for (const saveVersion of [3, SAVE_VERSION]) {
    const token = "4:castro:castro-one";
    const normalized = normalizeState(
      {
        ...createInitialState({ seed: 190, decks: TEST_DECKS }),
        saveVersion,
        currentDeckId: "castro",
        currentCardId: "castro-one",
        currentCardToken: token,
        lastResolvedToken: token,
        decisionCount: 4,
      },
      { decks: TEST_DECKS },
    );

    assert.equal(normalized.currentCardId, "castro-one");
    assert.equal(normalized.currentCardToken, token);
    assert.equal(normalized.lastResolvedToken, null);
  }

  const intro = normalizeState(
    {
      ...createInitialState({ seed: 1901, decks: TEST_DECKS }),
      lastResolvedToken: "intro:0:intro-one:front",
    },
    { decks: TEST_DECKS },
  );
  assert.equal(intro.currentCardToken, null);
  assert.equal(intro.lastResolvedToken, null);
});

test("compatible v3 plot saves migrate to v4 without losing active run state", () => {
  const base = createInitialState({ seed: 191, decks: TEST_DECKS });
  const raw = asVersionThree({
    ...base,
    currentDeckId: "castro",
    introCardIndex: 1,
    currentCardId: "castro-two",
    currentCardToken: "7:castro:castro-two",
    lastResolvedToken: "6:church:church-one",
    decisionCount: 7,
    runSeed: 101,
    rngState: 202,
    drawStateByDeck: {
      castro: {
        drawPile: ["castro-one"],
        discardPile: [],
        lastResolvedCardId: null,
      },
      "investigate-church": {
        drawPile: ["church-two"],
        discardPile: ["church-one"],
        lastResolvedCardId: "church-one",
      },
    },
    resources: { eldritchLore: 4, crew: 2, sanity: 1 },
  });
  raw.introCardFace = "reverse";
  raw.discoveries = { fatherDiaryReverse: true };

  const migrated = normalizeState(raw, { decks: TEST_DECKS });
  assert.equal(migrated.saveVersion, 4);
  assert.equal(migrated.currentDeckId, "castro");
  assert.equal(migrated.currentCardId, "castro-two");
  assert.equal(migrated.currentCardToken, "7:castro:castro-two");
  assert.equal(migrated.lastResolvedToken, "6:church:church-one");
  assert.equal(migrated.decisionCount, 7);
  assert.equal(migrated.runSeed, 101);
  assert.equal(migrated.rngState, 202);
  assert.deepEqual(migrated.drawStateByDeck, raw.drawStateByDeck);
  assert.deepEqual(migrated.resources, raw.resources);
  assert.equal(migrated.introCardFace, "front");
  assert.deepEqual(migrated.discoveries, { fatherDiaryReverse: false });
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

test("pending plot feedback is rejected when its route is not engine-derived", () => {
  const base = createInitialState({ seed: 200, decks: TEST_DECKS });
  const impossibleRoutes = [
    {
      direction: "down",
      destinationDeckId: "it-begins-here",
    },
    {
      direction: "up",
      destinationDeckId: "investigate-church",
    },
  ];

  for (const route of impossibleRoutes) {
    const sourceCardToken = `2:castro:castro-one:${route.direction}`;
    const feedback = createPendingFeedback({
      sourceCardId: "castro-one",
      sourceCardToken,
      sourceDeckId: "castro",
      direction: route.direction,
      destinationDeckId: route.destinationDeckId,
      resultText: "A malformed save points somewhere the engine cannot.",
      changes: {},
    });
    const normalized = normalizeState(
      {
        ...base,
        currentDeckId: route.destinationDeckId,
        currentCardId: null,
        currentCardToken: null,
        lastResolvedToken: sourceCardToken,
        pendingFeedback: feedback,
      },
      { decks: TEST_DECKS },
    );

    assert.equal(normalized.pendingFeedback, null);
    assert.equal(normalized.lastResolvedToken, null);
  }
});

test("compatible v3 pending feedback migrates with its destination and resources", () => {
  const base = createInitialState({ seed: 201, decks: TEST_DECKS });
  const feedback = createPendingFeedback({
    sourceCardId: "castro-one",
    sourceCardToken: "3:castro:castro-one",
    sourceDeckId: "castro",
    direction: "down",
    destinationDeckId: "investigate-church",
    resultText: "The old route still points south.",
    changes: { eldritchLore: 1 },
  });
  const raw = asVersionThree({
    ...base,
    currentDeckId: "investigate-church",
    currentCardId: null,
    currentCardToken: null,
    decisionCount: 4,
    resources: { eldritchLore: 2, crew: 1, sanity: 2 },
    pendingFeedback: feedback,
  });

  const migrated = normalizeState(raw, { decks: TEST_DECKS });
  assert.equal(migrated.saveVersion, 4);
  assert.equal(migrated.currentDeckId, "investigate-church");
  assert.equal(migrated.currentCardId, null);
  assert.equal(migrated.decisionCount, 4);
  assert.deepEqual(migrated.resources, raw.resources);
  assert.deepEqual(migrated.pendingFeedback, feedback);
  assert.equal(migrated.introCardFace, "front");
  assert.deepEqual(migrated.discoveries, { fatherDiaryReverse: false });
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
  const versionTwo = normalizeState(
    {
      ...createInitialState({ seed: 230, decks: TEST_DECKS }),
      saveVersion: 2,
      currentDeckId: "castro",
      resources: { eldritchLore: 9, crew: 9, sanity: 1 },
    },
    { seed: 231, decks: TEST_DECKS },
  );
  assert.deepEqual(
    versionTwo,
    createInitialState({ seed: 231, decks: TEST_DECKS }),
  );

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
  cloned.discoveries.fatherDiaryReverse = true;
  assert.equal(original.resources.sanity, 3);
  assert.equal(original.discoveries.fatherDiaryReverse, false);
  assert.equal(cloneState(() => {}), null);
});
