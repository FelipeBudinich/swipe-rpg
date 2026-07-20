import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEP_SOUTH_DECKS,
  DEEP_SOUTH_STORY,
} from "../public/js/data/deep-south.js";
import {
  INITIAL_DISCOVERIES,
  INITIAL_RESOURCES,
  SAVE_VERSION,
  STORY_ID,
  createInitialState,
  normalizeState,
} from "../public/js/game/state.js";

test("fresh version-5 state contains generic reveal and unlock collections", () => {
  const state = createInitialState({ seed: 101 });
  assert.equal(SAVE_VERSION, 5);
  assert.equal(state.saveVersion, 5);
  assert.equal(state.storyId, STORY_ID);
  assert.equal(state.status, "playing");
  assert.equal(state.terminalPending, false);
  assert.equal(state.currentDeckId, "it-begins-here");
  assert.equal(state.introCardIndex, 0);
  assert.equal(state.introSkipPending, false);
  assert.deepEqual(state.discoveries, INITIAL_DISCOVERIES);
  assert.deepEqual(state.revealedCardIds, []);
  assert.deepEqual(state.resources, INITIAL_RESOURCES);
  assert.equal(Object.hasOwn(state, "pendingFeedback"), false);
  assert.equal(Object.hasOwn(state, "introCardFace"), false);

  for (const deck of DEEP_SOUTH_DECKS.filter(
    ({ type }) => type === "plot",
  )) {
    assert.deepEqual(
      state.unlockedCardIdsByDeck[deck.id],
      deck.cards
        .filter(({ initiallyAvailable }) => initiallyAvailable)
        .map(({ id }) => id),
    );
  }
});

test("current saves retain compatible progress and filter unknown IDs", () => {
  const base = createInitialState({ seed: 102 });
  const raw = {
    ...base,
    currentDeckId: "castro",
    currentCardId: "castro-logbook-under-rain",
    currentCardToken: "3:castro:castro-logbook-under-rain:back",
    lastResolvedToken: null,
    decisionCount: 3,
    introCardIndex: 4,
    revealedCardIds: [
      "castro-logbook-under-rain",
      "unknown-card",
      "castro-logbook-under-rain",
    ],
    unlockedCardIdsByDeck: {
      ...base.unlockedCardIdsByDeck,
      castro: [
        ...base.unlockedCardIdsByDeck.castro,
        "unknown-card",
      ],
      "investigate-church": [
        ...base.unlockedCardIdsByDeck["investigate-church"],
        "investigate-church-restricted-ledger",
      ],
    },
    resources: { eldritchLore: 4, crew: 2, sanity: 2 },
  };
  const state = normalizeState(raw);
  assert.equal(state.currentDeckId, raw.currentDeckId);
  assert.equal(state.currentCardId, raw.currentCardId);
  assert.equal(state.currentCardToken, raw.currentCardToken);
  assert.equal(state.decisionCount, 3);
  assert.equal(state.introCardIndex, 4);
  assert.deepEqual(state.revealedCardIds, [
    "castro-logbook-under-rain",
  ]);
  assert.equal(
    state.unlockedCardIdsByDeck.castro.includes("unknown-card"),
    false,
  );
  assert.equal(
    state.unlockedCardIdsByDeck["investigate-church"].includes(
      "investigate-church-restricted-ledger",
    ),
    true,
  );
  assert.deepEqual(state.resources, raw.resources);
});

test("version-4 photograph state migrates to the generic one-way reveal", () => {
  const base = createInitialState({ seed: 103 });
  for (const introCardFace of ["front", "reverse"]) {
    const migrated = normalizeState({
      ...base,
      saveVersion: 4,
      introCardFace,
      discoveries: { fatherDiaryReverse: true },
      resources: { eldritchLore: 1, crew: 0, sanity: 3 },
    });
    assert.equal(migrated.saveVersion, 5);
    assert.deepEqual(migrated.revealedCardIds, [
      "intro-fathers-diary",
    ]);
    assert.equal(migrated.discoveries.fatherDiaryReverse, true);
    assert.equal(migrated.resources.eldritchLore, 1);
    assert.equal(Object.hasOwn(migrated, "introCardFace"), false);
  }

  const inconsistentReverse = normalizeState({
    ...base,
    saveVersion: 4,
    introCardFace: "reverse",
    discoveries: { fatherDiaryReverse: false },
  });
  assert.deepEqual(inconsistentReverse.revealedCardIds, [
    "intro-fathers-diary",
  ]);
  assert.equal(
    inconsistentReverse.discoveries.fatherDiaryReverse,
    false,
  );
});

test("version-4 normal plot saves preserve progress and unlock old content", () => {
  const base = createInitialState({ seed: 104 });
  const deck = DEEP_SOUTH_DECKS.find(({ id }) => id === "navigate");
  const currentCard = deck.cards[0];
  const raw = {
    ...base,
    saveVersion: 4,
    currentDeckId: deck.id,
    currentCardId: currentCard.id,
    currentCardToken: `9:${deck.id}:${currentCard.id}`,
    decisionCount: 9,
    resources: { eldritchLore: 3, crew: 2, sanity: 2 },
    introCardIndex: 6,
    introSkipPending: false,
  };
  const migrated = normalizeState(raw);
  assert.equal(migrated.currentDeckId, deck.id);
  assert.equal(migrated.currentCardId, currentCard.id);
  assert.equal(migrated.currentCardToken, null);
  assert.equal(migrated.decisionCount, 9);
  assert.equal(migrated.introCardIndex, 6);
  assert.deepEqual(migrated.resources, raw.resources);
  for (const plotDeck of DEEP_SOUTH_DECKS.filter(
    ({ type }) => type === "plot",
  )) {
    assert.deepEqual(
      migrated.unlockedCardIdsByDeck[plotDeck.id],
      plotDeck.cards.map(({ id }) => id),
    );
  }
});

test("version-4 pending outcomes are cleared without replaying effects", () => {
  const base = createInitialState({ seed: 105 });
  const drawState = structuredClone(base.drawStateByDeck);
  const raw = {
    ...base,
    saveVersion: 4,
    currentDeckId: "investigate-church",
    currentCardId: null,
    currentCardToken: null,
    decisionCount: 12,
    rngState: 83838,
    resources: { eldritchLore: 4, crew: 1, sanity: 2 },
    drawStateByDeck: drawState,
    pendingFeedback: {
      id: "legacy-outcome",
      sourceCardId: "castro-logbook-under-rain",
      destinationDeckId: "investigate-church",
      changes: { eldritchLore: 1 },
    },
  };
  const migrated = normalizeState(raw);
  assert.equal(Object.hasOwn(migrated, "pendingFeedback"), false);
  assert.equal(migrated.currentDeckId, raw.currentDeckId);
  assert.equal(migrated.currentCardId, null);
  assert.equal(migrated.currentCardToken, null);
  assert.equal(migrated.decisionCount, raw.decisionCount);
  assert.equal(migrated.rngState, raw.rngState);
  assert.deepEqual(migrated.resources, raw.resources);
  assert.deepEqual(migrated.drawStateByDeck, drawState);
});

test("a lethal migrated outcome becomes terminal-pending without feedback", () => {
  const base = createInitialState({ seed: 106 });
  const migrated = normalizeState({
    ...base,
    saveVersion: 4,
    currentDeckId: "castro",
    resources: { eldritchLore: 1, crew: 0, sanity: 0 },
    pendingFeedback: { id: "legacy-lethal" },
  });
  assert.equal(migrated.status, "lost");
  assert.equal(migrated.terminalPending, true);
  assert.equal(Object.hasOwn(migrated, "pendingFeedback"), false);
  assert.deepEqual(migrated.resources, {
    eldritchLore: 1,
    crew: 0,
    sanity: 0,
  });
});

test("current terminal-pending saves preserve their visible active card", () => {
  const base = createInitialState({ seed: 107 });
  const raw = {
    ...base,
    status: "lost",
    terminalPending: true,
    currentDeckId: "castro",
    currentCardId: "castro-logbook-under-rain",
    currentCardToken: "4:castro:castro-logbook-under-rain:back",
    revealedCardIds: ["castro-logbook-under-rain"],
    resources: { eldritchLore: 1, crew: 0, sanity: 0 },
  };
  const normalized = normalizeState(raw);
  assert.equal(normalized.status, "lost");
  assert.equal(normalized.terminalPending, true);
  assert.equal(normalized.currentCardId, raw.currentCardId);
  assert.equal(normalized.currentCardToken, raw.currentCardToken);
  assert.deepEqual(normalized.revealedCardIds, raw.revealedCardIds);
});

test("foreign, old, and incompatible state deliberately starts clean", () => {
  for (const raw of [
    { saveVersion: 3, storyId: STORY_ID, runSeed: 108 },
    { saveVersion: 5, storyId: "other", runSeed: 108 },
    {
      ...createInitialState({ seed: 108 }),
      player: { hp: 3 },
    },
  ]) {
    assert.deepEqual(
      normalizeState(raw, { seed: 108 }),
      createInitialState({ seed: 108 }),
    );
  }
});

test("normalization clamps resources and repairs invalid persisted fields", () => {
  const base = createInitialState({ seed: 109 });
  const normalized = normalizeState({
    ...base,
    currentDeckId: "missing",
    introCardIndex: 999,
    decisionCount: -4,
    rngState: "not-a-seed",
    resources: {
      eldritchLore: -4,
      crew: "2.9",
      sanity: Number.NaN,
    },
  });
  assert.equal(normalized.currentDeckId, "it-begins-here");
  assert.equal(normalized.introCardIndex, 7);
  assert.equal(normalized.decisionCount, 0);
  assert.deepEqual(normalized.resources, {
    eldritchLore: 0,
    crew: 2,
    sanity: 3,
  });
  assert.equal(
    Object.keys(normalized.drawStateByDeck).length,
    DEEP_SOUTH_STORY.decks.filter(({ type }) => type === "plot").length,
  );
});
