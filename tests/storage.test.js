import assert from "node:assert/strict";
import test from "node:test";

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

test("corrupted storage recovers with a caller-provided fresh state", () => {
  const storage = memoryStorage({ [SAVE_KEY]: "{not-json" });
  const fallback = createInitialState({ seed: 31 });
  assert.deepEqual(
    loadState({
      storage,
      createFallback: () => fallback,
      normalize: normalizeState,
    }),
    fallback,
  );
});

test("version-5 reveal, unlock, draw, RNG, and terminal state round-trip", () => {
  const storage = memoryStorage();
  const base = createInitialState({ seed: 32 });
  const state = {
    ...base,
    status: "lost",
    terminalPending: true,
    currentDeckId: "castro",
    currentCardId: "castro-logbook-under-rain",
    currentCardToken: "4:castro:castro-logbook-under-rain:back",
    decisionCount: 4,
    discoveries: { fatherDiaryReverse: true },
    revealedCardIds: [
      "intro-fathers-diary",
      "castro-logbook-under-rain",
    ],
    unlockedCardIdsByDeck: {
      ...base.unlockedCardIdsByDeck,
      "investigate-church": [
        ...base.unlockedCardIdsByDeck["investigate-church"],
        "investigate-church-restricted-ledger",
      ],
    },
    rngState: 987654,
    resources: { eldritchLore: 2, crew: 1, sanity: 0 },
  };
  assert.equal(saveState(state, { storage }), true);
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 99 }),
    normalize: normalizeState,
  });
  assert.deepEqual(loaded, normalizeState(state));
  assert.equal(
    loaded.unlockedCardIdsByDeck["investigate-church"].includes(
      "investigate-church-restricted-ledger",
    ),
    true,
  );
  assert.equal(Object.hasOwn(loaded, "pendingFeedback"), false);
  assert.equal(Object.hasOwn(loaded, "introCardFace"), false);
});

test("compatible v4 pending payload migrates without replaying resources", () => {
  const storage = memoryStorage();
  const base = createInitialState({ seed: 33 });
  const legacy = {
    ...base,
    saveVersion: 4,
    currentDeckId: "investigate-church",
    currentCardId: null,
    currentCardToken: null,
    decisionCount: 7,
    resources: { eldritchLore: 3, crew: 2, sanity: 2 },
    pendingFeedback: {
      id: "legacy-result",
      destinationDeckId: "investigate-church",
      changes: { eldritchLore: 1 },
    },
  };
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 99 }),
    normalize: normalizeState,
  });
  assert.equal(loaded.saveVersion, 5);
  assert.equal(Object.hasOwn(loaded, "pendingFeedback"), false);
  assert.equal(loaded.currentDeckId, legacy.currentDeckId);
  assert.equal(loaded.currentCardId, null);
  assert.equal(loaded.decisionCount, legacy.decisionCount);
  assert.deepEqual(loaded.resources, legacy.resources);
});

test("JSON-null Sanity repairs to the initial value", () => {
  const storage = memoryStorage();
  const state = {
    ...createInitialState({ seed: 34 }),
    resources: {
      eldritchLore: 2,
      crew: 1,
      sanity: Number.NaN,
    },
  };
  assert.equal(saveState(state, { storage }), true);
  assert.equal(
    JSON.parse(storage.getItem(SAVE_KEY)).resources.sanity,
    null,
  );
  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 99 }),
    normalize: normalizeState,
  });
  assert.deepEqual(loaded.resources, {
    eldritchLore: 2,
    crew: 1,
    sanity: 3,
  });
});

test("save and clear tolerate a localStorage-shaped object", () => {
  const storage = memoryStorage();
  const state = createInitialState({ seed: 35 });
  assert.equal(saveState(state, { storage }), true);
  assert.deepEqual(
    loadState({
      storage,
      createFallback: () => null,
      normalize: normalizeState,
    }),
    state,
  );
  assert.equal(clearState({ storage }), true);
  assert.equal(
    loadState({ storage, createFallback: () => null }),
    null,
  );
});
