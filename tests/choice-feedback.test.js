import test from "node:test";
import assert from "node:assert/strict";

import {
  CHOICE_FEEDBACK_CHANGE_FIELDS,
  CHOICE_FEEDBACK_CHANGE_LABELS,
  CHOICE_FEEDBACK_TONES,
  FEEDBACK_ART_BY_TONE,
  choiceFeedbackId,
  classifyChoiceFeedbackTone,
  createPendingFeedback,
  formatFeedbackChange,
  normalizeChoiceFeedbackChanges,
  normalizePendingFeedback,
} from "../public/js/game/choice-feedback.js";

function createFeedback(overrides = {}) {
  return createPendingFeedback({
    sourceCardId: "castro-rain",
    sourceCardToken: "4:castro:castro-rain",
    sourceDeckId: "castro",
    direction: "down",
    destinationDeckId: "investigate-church",
    resultText: "The chart carries the expedition south.",
    changes: { eldritchLore: 1 },
    ...overrides,
  });
}

test("feedback schema contains only new resources and fixed local tone art", () => {
  assert.deepEqual(CHOICE_FEEDBACK_CHANGE_FIELDS, [
    "eldritchLore",
    "crew",
    "sanity",
  ]);
  assert.deepEqual(CHOICE_FEEDBACK_CHANGE_LABELS, {
    eldritchLore: "Eldritch Lore",
    crew: "Crew",
    sanity: "Sanity",
  });
  assert.deepEqual(CHOICE_FEEDBACK_TONES, [
    "neutral",
    "reward",
    "damage",
    "danger",
  ]);
  for (const artId of Object.values(FEEDBACK_ART_BY_TONE)) {
    assert.match(artId, /^result-/u);
  }
});

test("payload creation is deterministic, serializable, and filters unknown changes", () => {
  const first = createFeedback({
    changes: {
      eldritchLore: 1,
      crew: 0,
      sanity: Number.NaN,
      hp: -9,
    },
  });
  const second = createFeedback({
    changes: {
      eldritchLore: 1,
      crew: 0,
      sanity: Number.NaN,
      hp: -9,
    },
  });
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(first.changes, { eldritchLore: 1 });
  assert.equal(first.tone, "reward");
  assert.equal(first.artId, undefined);
});

test("tone classification makes Sanity loss damage and Crew loss danger", () => {
  assert.equal(classifyChoiceFeedbackTone({ sanity: -1 }), "damage");
  assert.equal(classifyChoiceFeedbackTone({ crew: -1 }), "danger");
  assert.equal(classifyChoiceFeedbackTone({ eldritchLore: 1 }), "reward");
  assert.equal(classifyChoiceFeedbackTone({ crew: 1 }), "reward");
  assert.equal(classifyChoiceFeedbackTone({}), "neutral");
  assert.equal(
    classifyChoiceFeedbackTone({ sanity: -1 }, "neutral"),
    "neutral",
  );
  assert.equal(
    classifyChoiceFeedbackTone({ sanity: -1 }, "unknown"),
    "damage",
  );
});

test("normalization preserves valid feedback only over its destination with no card", () => {
  const feedback = createFeedback();
  const state = {
    currentDeckId: "investigate-church",
    currentCardId: null,
  };
  assert.deepEqual(normalizePendingFeedback(feedback, state), feedback);
  assert.equal(
    normalizePendingFeedback(feedback, {
      ...state,
      currentDeckId: "castro",
    }),
    null,
  );
  assert.equal(
    normalizePendingFeedback(feedback, {
      ...state,
      currentCardId: "church-card",
    }),
    null,
  );
  assert.equal(
    normalizePendingFeedback({ ...feedback, tone: "unknown" }, state),
    null,
  );
});

test("feedback identifiers and signed text are stable", () => {
  assert.equal(
    choiceFeedbackId("4:castro:castro-rain"),
    "choice-feedback:4:castro:castro-rain",
  );
  assert.equal(formatFeedbackChange("eldritchLore", 1), "+1 Eldritch Lore");
  assert.equal(formatFeedbackChange("crew", -1), "-1 Crew");
  assert.deepEqual(
    normalizeChoiceFeedbackChanges({
      eldritchLore: 1,
      crew: -1,
      sanity: 0,
      internal: 99,
    }),
    { eldritchLore: 1, crew: -1 },
  );
});

test("malformed feedback cannot be created or normalized", () => {
  assert.equal(createFeedback({ sourceCardToken: "" }), null);
  assert.equal(createFeedback({ direction: "forward" }), null);
  assert.equal(createFeedback({ resultText: " " }), null);
  assert.equal(normalizePendingFeedback("bad", {}), null);
});
