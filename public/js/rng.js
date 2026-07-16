/**
 * A tiny, deterministic 32-bit PRNG.
 *
 * All helpers are pure: callers pass the current uint32 state and receive the
 * next state alongside the sampled value.  This makes the generator safe to
 * serialize in save data without hiding mutable module-level state.
 */

export const DEFAULT_SEED = 0x6d2b79f5;

/** Convert numbers or strings into a stable, non-zero uint32 seed. */
export function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    const normalized = Math.trunc(seed) >>> 0;
    return normalized || DEFAULT_SEED;
  }

  const text = String(seed ?? "emberpath");
  // FNV-1a, with Math.imul so the result is identical in browsers and Node.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || DEFAULT_SEED;
}

export function createRng(seed) {
  const normalized = normalizeSeed(seed);
  return { seed: normalized, state: normalized };
}

/** Return the next xorshift32 output and serializable state. */
export function nextUint32(rngState) {
  let state = normalizeSeed(rngState);
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return { value: state, state };
}

/** Return a floating-point value in the half-open interval [0, 1). */
export function randomFloat(rngState) {
  const next = nextUint32(rngState);
  return { value: next.value / 0x100000000, state: next.state };
}

/** Return an integer in the inclusive range [min, max]. */
export function randomInt(rngState, min, max) {
  let lower = Math.ceil(Number(min));
  let upper = Math.floor(Number(max));
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new TypeError("randomInt bounds must be finite numbers");
  }
  if (upper < lower) [lower, upper] = [upper, lower];

  const next = randomFloat(rngState);
  return {
    value: lower + Math.floor(next.value * (upper - lower + 1)),
    state: next.state,
  };
}

/**
 * Deterministically choose a positive-weight entry.
 *
 * `entries` may be values paired with `getWeight`, or objects with a `weight`
 * field. Invalid, negative, and zero weights are ignored. A null value is
 * returned without consuming RNG state when no entry has positive weight.
 */
export function weightedChoice(rngState, entries, getWeight = (entry) => entry?.weight ?? 0) {
  const weighted = [];
  let total = 0;

  for (let index = 0; index < (entries?.length ?? 0); index += 1) {
    const entry = entries[index];
    const rawWeight = Number(getWeight(entry, index));
    const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0;
    if (weight > 0) {
      total += weight;
      weighted.push({ entry, index, ceiling: total });
    }
  }

  if (total <= 0) {
    return { value: null, index: -1, state: normalizeSeed(rngState) };
  }

  const next = randomFloat(rngState);
  const target = next.value * total;
  const selected = weighted.find(({ ceiling }) => target < ceiling) ?? weighted.at(-1);
  return { value: selected.entry, index: selected.index, state: next.state };
}

// Friendly aliases for consumers that prefer terse names.
export const next = randomFloat;
export const nextInt = randomInt;
export const randomInteger = randomInt;
export const weightedRandom = weightedChoice;
