export const SAVE_KEY = "jrpg-swipe-save-v1";

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function makeFallback(createFallback) {
  return typeof createFallback === "function" ? createFallback() : null;
}

/**
 * Read and defensively normalize a saved game. Storage failures and malformed
 * data intentionally behave like a missing save so the title can always boot.
 */
export function loadState({
  storage = defaultStorage(),
  key = SAVE_KEY,
  createFallback = () => null,
  normalize = (value) => value,
} = {}) {
  if (!storage || typeof storage.getItem !== "function") {
    return makeFallback(createFallback);
  }

  try {
    const serialized = storage.getItem(key);
    if (!serialized) return makeFallback(createFallback);

    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return makeFallback(createFallback);
    }

    const fallback = makeFallback(createFallback);
    const normalized = normalize(parsed, fallback);
    return normalized && typeof normalized === "object" ? normalized : fallback;
  } catch {
    return makeFallback(createFallback);
  }
}

export function saveState(state, { storage = defaultStorage(), key = SAVE_KEY } = {}) {
  if (!storage || typeof storage.setItem !== "function") return false;

  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState({ storage = defaultStorage(), key = SAVE_KEY } = {}) {
  if (!storage || typeof storage.removeItem !== "function") return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
