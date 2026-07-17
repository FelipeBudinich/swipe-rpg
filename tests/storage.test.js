import test from "node:test";
import assert from "node:assert/strict";

import { DEEP_SOUTH_DECKS } from "../public/js/data/deep-south.js";
import { createPendingFeedback } from "../public/js/game/choice-feedback.js";
import {
  SAVE_VERSION,
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

test("JSON-null Sanity repairs to the initial value instead of forcing a loss", () => {
  const storage = memoryStorage();
  const state = {
    ...createInitialState({ seed: 311 }),
    resources: {
      eldritchLore: 2,
      crew: 1,
      sanity: Number.NaN,
    },
  };

  assert.equal(saveState(state, { storage }), true);
  const serialized = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(serialized.resources.sanity, null);

  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 999 }),
    normalize: normalizeState,
  });
  assert.equal(loaded.status, "playing");
  assert.deepEqual(loaded.resources, {
    eldritchLore: 2,
    crew: 1,
    sanity: 3,
  });
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

test("reversed Intro discovery and skip confirmation round-trip through localStorage", () => {
  const storage = memoryStorage();
  const state = {
    ...createInitialState({ seed: 33 }),
    introCardIndex: 0,
    introSkipPending: true,
    introCardFace: "reverse",
    discoveries: { fatherDiaryReverse: true },
    resources: { eldritchLore: 1, crew: 0, sanity: 3 },
  };

  assert.equal(saveState(state, { storage }), true);
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 99 }),
    normalize: normalizeState,
  });
  assert.equal(loaded.introCardIndex, 0);
  assert.equal(loaded.introSkipPending, true);
  assert.equal(loaded.introCardFace, "reverse");
  assert.deepEqual(loaded.discoveries, { fatherDiaryReverse: true });
  assert.equal(loaded.resources.eldritchLore, 1);
});

test("loading a compatible v3 plot save preserves progress and supplies v4 Intro defaults", () => {
  const sourceDeck = DEEP_SOUTH_DECKS.find((deck) => deck.type === "plot");
  const [currentCard, remainingCard] = sourceDeck.cards;
  const legacy = {
    ...createInitialState({ seed: 331 }),
    saveVersion: 3,
    currentDeckId: sourceDeck.id,
    currentCardId: currentCard.id,
    currentCardToken: `5:${sourceDeck.id}:${currentCard.id}`,
    decisionCount: 5,
    resources: { eldritchLore: 3, crew: 2, sanity: 2 },
    drawStateByDeck: {
      ...createInitialState({ seed: 331 }).drawStateByDeck,
      [sourceDeck.id]: {
        drawPile: [remainingCard.id],
        discardPile: [],
        lastResolvedCardId: null,
      },
    },
  };
  delete legacy.introCardFace;
  delete legacy.discoveries;
  const storage = memoryStorage({
    [SAVE_KEY]: JSON.stringify(legacy),
  });

  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 999 }),
    normalize: normalizeState,
  });
  assert.equal(loaded.saveVersion, SAVE_VERSION);
  assert.equal(loaded.saveVersion, 4);
  assert.equal(loaded.currentDeckId, sourceDeck.id);
  assert.equal(loaded.currentCardId, currentCard.id);
  assert.equal(loaded.currentCardToken, legacy.currentCardToken);
  assert.equal(loaded.decisionCount, 5);
  assert.deepEqual(loaded.resources, legacy.resources);
  assert.deepEqual(
    loaded.drawStateByDeck[sourceDeck.id],
    legacy.drawStateByDeck[sourceDeck.id],
  );
  assert.equal(loaded.introCardFace, "front");
  assert.deepEqual(loaded.discoveries, { fatherDiaryReverse: false });
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
