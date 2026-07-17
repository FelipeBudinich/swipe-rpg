import test from "node:test";
import assert from "node:assert/strict";

import {
  diffHud,
  hudSnapshot,
} from "../public/js/ui/feedback.js";

test("HUD snapshots and diffs contain exactly Eldritch Lore, Crew, and Sanity", () => {
  const before = hudSnapshot({
    resources: { eldritchLore: 0, crew: 1, sanity: 3 },
  });
  const after = hudSnapshot({
    resources: { eldritchLore: 1, crew: 0, sanity: 2 },
  });
  assert.deepEqual(before, { eldritchLore: 0, crew: 1, sanity: 3 });
  assert.deepEqual(diffHud(before, after), {
    eldritchLore: 1,
    crew: -1,
    sanity: -1,
  });
});

test("unchanged HUD resources do not create feedback deltas", () => {
  const snapshot = { eldritchLore: 2, crew: 0, sanity: 1 };
  assert.deepEqual(diffHud(snapshot, snapshot), {});
});
