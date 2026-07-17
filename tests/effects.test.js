import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEffects,
  applyResourceEffects,
  isResourceKey,
  normalizeResourceEffects,
  normalizeResources,
  resourceChanges,
} from "../public/js/game/effects.js";

const state = (resources, status = "playing") => ({ resources, status });

test("only the three Deep South resource keys are recognized", () => {
  assert.equal(isResourceKey("eldritchLore"), true);
  assert.equal(isResourceKey("crew"), true);
  assert.equal(isResourceKey("sanity"), true);
  for (const obsolete of ["xp", "hp", "mp", "level", "gold"]) {
    assert.equal(isResourceKey(obsolete), false);
  }
  assert.deepEqual(
    normalizeResourceEffects({
      eldritchLore: 1,
      crew: -1,
      sanity: 0,
      hp: -99,
      arbitrary: 8,
    }),
    { eldritchLore: 1, crew: -1 },
  );
});

test("resource effects use small integer deltas and clamp every resource at zero", () => {
  const before = state({ eldritchLore: 0, crew: 0, sanity: 1 });
  const applied = applyResourceEffects(before, {
    eldritchLore: 1.8,
    crew: -4,
    sanity: -8,
  });

  assert.deepEqual(applied.state.resources, {
    eldritchLore: 1,
    crew: 0,
    sanity: 0,
  });
  assert.deepEqual(applied.changes, {
    eldritchLore: 1,
    sanity: -1,
  });
  assert.equal(applied.state.status, "lost");
});

test("zero Crew and zero Lore do not lose a run", () => {
  const applied = applyResourceEffects(
    state({ eldritchLore: 0, crew: 1, sanity: 2 }),
    { crew: -1 },
  );
  assert.deepEqual(applied.state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 2,
  });
  assert.equal(applied.state.status, "playing");
});

test("actual changes omit clamped and zero theoretical deltas", () => {
  const before = state({ eldritchLore: 0, crew: 0, sanity: 3 });
  const after = applyResourceEffects(before, {
    eldritchLore: -1,
    crew: -1,
    sanity: 0,
  });
  assert.deepEqual(after.changes, {});
  assert.deepEqual(resourceChanges(before, after.state), {});
});

test("normalization is finite, integral, nonnegative, and immutable", () => {
  const input = {
    eldritchLore: "4",
    crew: -3,
    sanity: Number.NaN,
  };
  assert.deepEqual(normalizeResources(input), {
    eldritchLore: 4,
    crew: 0,
    sanity: 0,
  });
  assert.deepEqual(input, {
    eldritchLore: "4",
    crew: -3,
    sanity: Number.NaN,
  });
});

test("central applyEffects alias returns the next state without another effect system", () => {
  const before = state({ eldritchLore: 0, crew: 0, sanity: 3 });
  const after = applyEffects(before, { crew: 1 });
  assert.deepEqual(after.resources, {
    eldritchLore: 0,
    crew: 1,
    sanity: 3,
  });
});
