import assert from "node:assert/strict";
import test from "node:test";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import { formatCardEffect } from "../public/js/game/card-effects.js";
import {
  EFFECT_LOG_MAX_ENTRIES,
  appendEffectLog,
  effectLogEntryId,
  normalizeEffectLog,
} from "../public/js/game/run-log.js";
import { createInitialState } from "../public/js/game/state.js";

const revealEntry = (overrides = {}) => ({
  id: "effect:reveal:intro:0:intro-fathers-diary:front",
  kind: "reveal",
  cardId: "intro-fathers-diary",
  direction: "left",
  effect: {
    resources: { eldritchLore: 1 },
    discoveries: ["fatherDiaryReverse"],
  },
  ...overrides,
});

const entryEffect = (overrides = {}) => ({
  id: "effect:entry:7:castro:castro-logbook-under-rain:back",
  kind: "entry",
  cardId: "investigate-church-restricted-ledger",
  direction: "up",
  effect: { resources: { sanity: -1 } },
  ...overrides,
});

test("invalid log values and entries normalize away", () => {
  assert.deepEqual(normalizeEffectLog(null, DEEP_SOUTH_STORY), []);
  assert.deepEqual(normalizeEffectLog({}, DEEP_SOUTH_STORY), []);
  for (const invalid of [
    revealEntry({ cardId: "unknown-card" }),
    revealEntry({ cardId: "deep-south-intro-skip-confirmation" }),
    revealEntry({ direction: "forward" }),
    revealEntry({ kind: "preview" }),
    revealEntry({ effect: null }),
    revealEntry({ effect: {} }),
    revealEntry({ id: "" }),
  ]) {
    assert.deepEqual(normalizeEffectLog([invalid], DEEP_SOUTH_STORY), []);
  }
});

test("valid reveal and destination entries preserve chronological order", () => {
  const entries = normalizeEffectLog(
    [revealEntry(), entryEffect()],
    DEEP_SOUTH_STORY,
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "reveal");
  assert.equal(entries[1].kind, "entry");
  assert.equal(
    formatCardEffect(entries[0].effect, DEEP_SOUTH_STORY),
    "Discovery recorded · +1 Eldritch Lore",
  );
});

test("duplicate IDs keep the first valid entry", () => {
  const first = revealEntry();
  const duplicate = revealEntry({ direction: "right" });
  assert.deepEqual(
    normalizeEffectLog([first, duplicate], DEEP_SOUTH_STORY),
    [first],
  );
});

test("normalization keeps the newest entries at the defensive maximum", () => {
  const values = Array.from(
    { length: EFFECT_LOG_MAX_ENTRIES + 3 },
    (_, index) => revealEntry({ id: `effect:reveal:token-${index}` }),
  );
  const normalized = normalizeEffectLog(values, DEEP_SOUTH_STORY);
  assert.equal(normalized.length, EFFECT_LOG_MAX_ENTRIES);
  assert.equal(normalized[0].id, "effect:reveal:token-3");
  assert.equal(normalized.at(-1).id, `effect:reveal:token-${EFFECT_LOG_MAX_ENTRIES + 2}`);
});

test("append is immutable and idempotent", () => {
  const state = createInitialState({ seed: 71 });
  const snapshot = structuredClone(state);
  const first = appendEffectLog(state, revealEntry(), DEEP_SOUTH_STORY);
  assert.deepEqual(state, snapshot);
  assert.notEqual(first.state, state);
  assert.equal(first.state.effectLog.length, 1);
  assert.deepEqual(first.entry, revealEntry());

  const duplicate = appendEffectLog(
    first.state,
    revealEntry({ direction: "right" }),
    DEEP_SOUTH_STORY,
  );
  assert.equal(duplicate.state, first.state);
  assert.equal(duplicate.entry, null);
});

test("entry IDs are deterministic and reject unsupported inputs", () => {
  assert.equal(
    effectLogEntryId("reveal", "token"),
    "effect:reveal:token",
  );
  assert.equal(effectLogEntryId("preview", "token"), "");
  assert.equal(effectLogEntryId("entry", ""), "");
});
