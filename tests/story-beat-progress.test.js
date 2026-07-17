import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BEAT_BUDGETS,
  STORY_BEATS,
} from "../public/js/game/story/constants.js";
import {
  calculateStoryProgress,
  canAdvanceBeat,
  getStoryBudgetTotals,
  hasActiveRequiredStoryCombat,
  isKnownStoryBeatId,
  shouldForceBeatCompletion,
} from "../public/js/game/story/beat-progress.js";
import {
  advanceBeat,
  createInitialStoryState,
  recordStoryCardResolution,
} from "../public/js/game/story/arc-engine.js";

const arc = {
  id: "test-arc",
  transitionBeatIds: ["breakIntoTwo"],
  beats: STORY_BEATS.map((beat) => ({
    ...beat,
    budget: DEFAULT_BEAT_BUDGETS[beat.id],
    completionObjective: { type: "storyTagResolved", tag: `${beat.id}-done` },
  })),
};

function fixtureState(beatIndex = 0, overrides = {}) {
  const story = createInitialStoryState(arc, {
    currentBeatId: arc.beats[beatIndex].id,
    currentBeatIndex: beatIndex,
    ...overrides,
  });
  return {
    mode: "exploration",
    rngState: 123,
    encounter: null,
    run: { forcedCardQueue: [] },
    story,
  };
}

test("canonical beat budgets total 30 / 35 / 40", () => {
  assert.deepEqual(getStoryBudgetTotals(arc), { minimum: 30, target: 35, maximum: 40 });
});

test("story phase helpers accept a data-defined nine-phase deck", () => {
  const deckArc = {
    id: "nine-deck-story",
    transitionBeatIds: ["deck-02"],
    beats: Array.from({ length: 9 }, (_, index) => ({
      id: `deck-${String(index + 1).padStart(2, "0")}`,
      name: `Deck ${index + 1}`,
      budget: { minimum: 1, target: 2, maximum: 3 },
      completionObjective: { type: "storyTagResolved", tag: `deck-${index + 1}-done` },
    })),
  };
  const story = createInitialStoryState(deckArc);

  assert.equal(story.currentBeatId, "deck-01");
  assert.deepEqual(getStoryBudgetTotals(deckArc), {
    minimum: 9,
    target: 18,
    maximum: 27,
  });
  assert.equal(isKnownStoryBeatId("deck-09", deckArc), true);
  assert.equal(isKnownStoryBeatId("finalImage", deckArc), false);

  const advanced = advanceBeat({
    mode: "exploration",
    story: {
      ...story,
      cardsResolvedInBeat: 1,
      resolvedStoryTags: ["deck-1-done"],
    },
    run: { forcedCardQueue: [] },
    encounter: null,
  }, deckArc);
  assert.equal(advanced.story.currentBeatId, "deck-02");
  assert.equal(advanced.story.pendingInterstitialBeatId, "deck-02");
  assert.equal(advanced.mode, "storyTransition");
});

test("hybrid advancement requires minimum, objective, no local queue, and no combat", () => {
  const setup = arc.beats[2];
  let state = fixtureState(2, { cardsResolvedInBeat: 2 });
  assert.equal(canAdvanceBeat(state, setup), false);

  state = {
    ...state,
    story: { ...state.story, cardsResolvedInBeat: 3 },
  };
  assert.equal(canAdvanceBeat(state, setup), false);

  state = {
    ...state,
    story: { ...state.story, resolvedStoryTags: ["setup-done"] },
    run: {
      forcedCardQueue: [{ cardId: "setup-followup", originBeatId: "setup", beatLocal: true }],
    },
  };
  assert.equal(canAdvanceBeat(state, setup), false);

  state = { ...state, run: { forcedCardQueue: [] }, encounter: { enemyId: "test" } };
  assert.equal(canAdvanceBeat(state, setup), false);
  state = { ...state, encounter: null };
  assert.equal(canAdvanceBeat(state, setup), true);
});

test("combat rewards retain the legacy required-combat beat gate", () => {
  const beat = arc.beats[8];
  const state = fixtureState(8, {
    combatRewardBeatId: beat.id,
  });
  assert.equal(
    hasActiveRequiredStoryCombat({ ...state, mode: "combatReward" }, beat),
    true,
  );
});

test("maximum-minus-one forces completion and ambient cards cannot extend the budget", () => {
  const setup = arc.beats[2];
  const state = fixtureState(2, { cardsResolvedInBeat: 3 });
  assert.equal(shouldForceBeatCompletion(state, setup), true);
  assert.equal(
    shouldForceBeatCompletion(
      { ...state, story: { ...state.story, cardsResolvedInBeat: 4 } },
      setup,
    ),
    true,
  );
});

test("world-card recording is explicit, immutable, and maintains per-beat counts", () => {
  const state = fixtureState(0);
  const combatCard = { id: "combat", story: { countsTowardStory: false, role: "ambient" } };
  const afterCombat = recordStoryCardResolution(state, combatCard, {});
  assert.equal(afterCombat.story.totalWorldCardsResolved, 0);

  const card = {
    id: "opening",
    story: {
      countsTowardStory: true,
      role: "completion",
      completionTags: ["openingImage-done"],
    },
  };
  const resolved = recordStoryCardResolution(state, card, {});
  assert.equal(resolved.story.cardsResolvedInBeat, 1);
  assert.equal(resolved.story.cardsResolvedByBeat.openingImage, 1);
  assert.equal(resolved.story.totalWorldCardsResolved, 1);
  assert.deepEqual(resolved.story.resolvedStoryTags, ["openingImage-done"]);
  assert.equal(state.story.totalWorldCardsResolved, 0);
});

test("progress is monotonic and remains below 100% until Final Image completion", () => {
  const opening = fixtureState(0);
  const afterOpening = {
    ...fixtureState(1, {
      completedBeatIds: ["openingImage"],
      cardsResolvedInBeat: 0,
    }),
  };
  assert.ok(calculateStoryProgress(afterOpening, arc) >= calculateStoryProgress(opening, arc));

  const beforeVictory = fixtureState(14, {
    completedBeatIds: arc.beats.slice(0, 14).map(({ id }) => id),
    cardsResolvedInBeat: 1,
  });
  assert.ok(calculateStoryProgress(beforeVictory, arc) < 1);
  assert.equal(
    calculateStoryProgress(
      { ...beforeVictory, story: { ...beforeVictory.story, status: "completed", completed: true } },
      arc,
    ),
    1,
  );
});

test("advanceBeat enters major transition once and never skips a queued objective", () => {
  let state = fixtureState(4, {
    cardsResolvedInBeat: 2,
    resolvedStoryTags: ["debate-done"],
  });
  state = advanceBeat(state, arc);
  assert.equal(state.story.currentBeatId, "breakIntoTwo");
  assert.equal(state.story.pendingInterstitialBeatId, "breakIntoTwo");
  assert.equal(state.mode, "storyTransition");
});
