import test from "node:test";
import assert from "node:assert/strict";

import {
  createRng,
  nextUint32,
  normalizeSeed,
  randomFloat,
  randomInt,
  weightedChoice,
} from "../public/js/rng.js";

test("seeded RNG reproduces the same sequence", () => {
  let first = createRng("same-road").state;
  let second = createRng("same-road").state;
  const firstValues = [];
  const secondValues = [];

  for (let index = 0; index < 20; index += 1) {
    const a = nextUint32(first);
    const b = nextUint32(second);
    first = a.state;
    second = b.state;
    firstValues.push(a.value);
    secondValues.push(b.value);
  }

  assert.deepEqual(firstValues, secondValues);
  assert.notDeepEqual(firstValues, Array(20).fill(firstValues[0]));
});
test("serialized 32-bit state resumes the future sequence exactly", () => {
  let state = normalizeSeed(0xdeadbeef);
  for (let index = 0; index < 7; index += 1) state = randomFloat(state).state;
  const saved = JSON.parse(JSON.stringify({ rngState: state }));

  const a = randomInt(state, -3, 9);
  const b = randomInt(saved.rngState, -3, 9);
  assert.deepEqual(a, b);
  assert.ok(a.value >= -3 && a.value <= 9);
  assert.equal(a.state >>> 0, a.state);
});

test("weighted selection is reproducible and ignores non-positive weights", () => {
  const entries = [
    { id: "never", weight: 0 },
    { id: "also-never", weight: -10 },
    { id: "north", weight: 2 },
    { id: "south", weight: 7 },
  ];
  const first = weightedChoice(42, entries);
  const second = weightedChoice(42, entries);
  assert.equal(first.value.id, second.value.id);
  assert.equal(first.state, second.state);
  assert.notEqual(first.value.id, "never");

  const empty = weightedChoice(42, [{ weight: 0 }]);
  assert.equal(empty.value, null);
  assert.equal(empty.index, -1);
});
