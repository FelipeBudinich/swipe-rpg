import test from "node:test";
import assert from "node:assert/strict";

import { DEEP_SOUTH_DECKS } from "../public/js/data/deep-south.js";
import { createPendingFeedback } from "../public/js/game/choice-feedback.js";
import {
  createInitialState,
  normalizeState,
} from "../public/js/game/state.js";
import {
  clearState,
  loadState,
  saveState,
  SAVE_KEY,
} from "../public/js/storage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("corrupted storage recovers with a fresh Deep South state", () => {
  const storage = memoryStorage({ [SAVE_KEY]: "{not-json" });
  const fallback = createInitialState({ seed: 31 });
  const recovered = loadState({
    storage,
    createFallback: () => fallback,
    normalize: normalizeState,
  });
  assert.deepEqual(recovered, fallback);
});

test("loading an incompatible earlier save deliberately starts a clean Deep South run", () => {
  const storage = memoryStorage({
    [SAVE_KEY]: JSON.stringify({
      version: 2,
      runSeed: 90,
      story: { arcId: "legacy-story", currentBeatId: "legacy-phase" },
      player: { level: 8, xp: 90, hp: 1, mp: 2 },
      currentCardId: "legacy-card",
    }),
  });
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 32 }),
    normalize: (raw) => normalizeState(raw, { seed: 32 }),
  });

  assert.deepEqual(loaded, createInitialState({ seed: 32 }));
});

test("Intro skip confirmation round-trips through localStorage", () => {
  const storage = memoryStorage();
  const state = {
    ...createInitialState({ seed: 33 }),
    introCardIndex: 2,
    introSkipPending: true,
  };

  assert.equal(saveState(state, { storage }), true);
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 99 }),
    normalize: normalizeState,
  });
  assert.equal(loaded.introCardIndex, 2);
  assert.equal(loaded.introSkipPending, true);
});

test("pending result feedback and lost state survive storage without exposing a card", () => {
  const sourceDeck = DEEP_SOUTH_DECKS.find((deck) => deck.type === "plot");
  const sourceCard = sourceDeck.cards[0];
  const feedback = createPendingFeedback({
    sourceCardId: sourceCard.id,
    sourceCardToken: `7:${sourceCard.id}`,
    sourceDeckId: sourceDeck.id,
    direction: "left",
    destinationDeckId: sourceDeck.id,
    resultText: "The impossible marks follow the expedition inland.",
    changes: { sanity: -1 },
  });
  const state = {
    ...createInitialState({ seed: 34 }),
    status: "lost",
    currentDeckId: sourceDeck.id,
    currentCardId: null,
    currentCardToken: null,
    decisionCount: 8,
    resources: { eldritchLore: 2, crew: 0, sanity: 0 },
    pendingFeedback: feedback,
  };
  const storage = memoryStorage();

  assert.equal(saveState(state, { storage }), true);
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 99 }),
    normalize: normalizeState,
  });
  assert.equal(loaded.status, "lost");
  assert.equal(loaded.currentCardId, null);
  assert.deepEqual(loaded.pendingFeedback, feedback);
});

test("save and clear tolerate a localStorage-shaped object", () => {
  const storage = memoryStorage();
  const state = createInitialState({ seed: 35 });
  assert.equal(saveState(state, { storage }), true);
  assert.deepEqual(
    loadState({ storage, createFallback: () => null, normalize: normalizeState }),
    state,
  );
  assert.equal(clearState({ storage }), true);
  assert.equal(loadState({ storage, createFallback: () => null }), null);
});
