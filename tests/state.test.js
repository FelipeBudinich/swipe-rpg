import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialState,
  createMeta,
  createStoryState,
  normalizeState,
  STORY_BEAT_IDS,
} from "../public/js/game/state.js";

const NINE_PHASE_IDS = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `phase-${index + 1}`),
);

test("state factories retain the canonical Ember defaults", () => {
  const story = createStoryState();
  const state = createInitialState({ seed: 7 });

  assert.equal(story.currentBeatId, STORY_BEAT_IDS[0]);
  assert.deepEqual(story.cardsResolvedByBeat, { [STORY_BEAT_IDS[0]]: 0 });
  assert.equal(state.story.currentBeatId, STORY_BEAT_IDS[0]);
  assert.equal(state.meta.furthestBeatId, STORY_BEAT_IDS[0]);
});

test("state factories derive progression bounds from supplied phase IDs", () => {
  const story = createStoryState("nine-phase", { storyPhaseIds: NINE_PHASE_IDS });
  const state = createInitialState({
    seed: 9,
    arcId: "nine-phase",
    beatIds: NINE_PHASE_IDS,
    meta: { furthestBeatIndex: 99 },
  });
  const meta = createMeta(
    { furthestBeatId: "phase-6", furthestBeatIndex: 1 },
    { beatIds: NINE_PHASE_IDS },
  );

  assert.equal(story.arcId, "nine-phase");
  assert.equal(story.currentBeatId, "phase-1");
  assert.deepEqual(story.cardsResolvedByBeat, { "phase-1": 0 });
  assert.equal(state.meta.furthestBeatIndex, 8);
  assert.equal(state.meta.furthestBeatId, "phase-9");
  assert.equal(meta.furthestBeatIndex, 5);
  assert.equal(meta.furthestBeatId, "phase-6");
});

test("save normalization uses supplied nine-phase ordering and rejects foreign phase IDs", () => {
  const base = createInitialState({
    seed: 11,
    arcId: "nine-phase",
    storyPhaseIds: NINE_PHASE_IDS,
  });
  const normalized = normalizeState(
    {
      ...base,
      mode: "storyTransition",
      story: {
        ...base.story,
        currentBeatId: "phase-7",
        currentBeatIndex: 99,
        completedBeatIds: ["phase-1", "foreign-phase", "phase-2"],
        cardsResolvedByBeat: {
          "phase-1": 2,
          "phase-7": 3,
          "foreign-phase": 40,
        },
        selectedAnchorIdByBeat: {
          "phase-7": "anchor-seven",
          "foreign-phase": "foreign-anchor",
        },
        pendingInterstitialBeatId: "phase-8",
        shownInterstitialBeatIds: ["phase-4", "foreign-phase"],
      },
      encounter: {
        enemyId: "test-enemy",
        hp: 4,
        currentIntent: "attack",
        originBeatId: "phase-6",
      },
      run: {
        ...base.run,
        randomEncountersByBeat: {
          "phase-3": 1,
          "foreign-phase": 9,
        },
      },
      meta: {
        ...base.meta,
        furthestBeatId: "phase-8",
        furthestBeatIndex: 99,
      },
    },
    { beatIds: NINE_PHASE_IDS },
  );

  assert.equal(normalized.story.currentBeatId, "phase-7");
  assert.equal(normalized.story.currentBeatIndex, 6);
  assert.deepEqual(normalized.story.completedBeatIds, ["phase-1", "phase-2"]);
  assert.deepEqual(normalized.story.cardsResolvedByBeat, {
    "phase-1": 2,
    "phase-7": 3,
  });
  assert.deepEqual(normalized.story.selectedAnchorIdByBeat, {
    "phase-7": "anchor-seven",
  });
  assert.equal(normalized.story.pendingInterstitialBeatId, "phase-8");
  assert.deepEqual(normalized.story.shownInterstitialBeatIds, ["phase-4"]);
  assert.equal(normalized.encounter.originBeatId, "phase-6");
  assert.deepEqual(normalized.run.randomEncountersByBeat, { "phase-3": 1 });
  assert.equal(normalized.meta.furthestBeatId, "phase-8");
  assert.equal(normalized.meta.furthestBeatIndex, 7);

  const clamped = normalizeState(
    {
      ...base,
      story: {
        ...base.story,
        currentBeatId: "foreign-phase",
        currentBeatIndex: 99,
      },
    },
    { storyPhaseIds: NINE_PHASE_IDS },
  );
  assert.equal(clamped.story.currentBeatId, "phase-9");
  assert.equal(clamped.story.currentBeatIndex, 8);
});
