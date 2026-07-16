import test from "node:test";
import assert from "node:assert/strict";

import { clearState, loadState, saveState, SAVE_KEY } from "../public/js/storage.js";

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

test("corrupted storage recovers with a fresh state", () => {
  const storage = memoryStorage({ [SAVE_KEY]: "{not-json" });
  const recovered = loadState({
    storage,
    createFallback: () => ({ version: 1, fresh: true }),
  });
  assert.deepEqual(recovered, { version: 1, fresh: true });
});

test("normalizer can defensively repair a parsed save", () => {
  const storage = memoryStorage({
    [SAVE_KEY]: JSON.stringify({ version: 1, player: { hp: "bad" } }),
  });
  const loaded = loadState({
    storage,
    createFallback: () => ({ version: 1, player: { hp: 30 } }),
    normalize: (raw, fallback) => ({
      ...fallback,
      player: { hp: Number.isFinite(raw.player?.hp) ? raw.player.hp : fallback.player.hp },
    }),
  });
  assert.equal(loaded.player.hp, 30);
});

test("save and clear tolerate a localStorage-shaped object", () => {
  const storage = memoryStorage();
  const state = { version: 1, journeyStep: 4 };
  assert.equal(saveState(state, { storage }), true);
  assert.deepEqual(loadState({ storage, createFallback: () => null }), state);
  assert.equal(clearState({ storage }), true);
  assert.equal(loadState({ storage, createFallback: () => null }), null);
});
