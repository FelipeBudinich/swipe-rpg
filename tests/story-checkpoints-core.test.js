import test from "node:test";
import assert from "node:assert/strict";

import {
  createStoryCheckpoint,
  getCheckpointIdForBeat,
  isStoryCheckpointDebugEnabled,
  restoreStoryCheckpoint,
} from "../public/js/game/story/story-checkpoints.js";
import { selectStoryCard } from "../public/js/game/story/story-selector.js";

const choice = { label: "Go", resultText: "Gone.", effects: [] };
const deck = ["a", "b", "c"].map((id, index) => ({
  id,
  baseWeight: index + 1,
  cooldown: 0,
  requirements: [],
  left: choice,
  right: choice,
  story: {
    arcIds: ["arc"],
    beatWeights: { setup: 1 },
    role: "ambient",
    completionTags: [],
    countsTowardStory: true,
  },
}));
const beat = {
  id: "setup",
  budget: { minimum: 3, target: 4, maximum: 4 },
  completionObjective: { type: "storyTagResolved", tag: "done" },
  encounterPolicy: { mode: "none" },
};

function state() {
  return {
    version: 2,
    mode: "exploration",
    rngState: 91234,
    animationState: { unsafeToPersist: true },
    run: { recentCardIds: [], lastSeenTurnByCardId: {}, resolvedOnceCards: [] },
    story: {
      arcId: "arc",
      status: "active",
      currentBeatId: "setup",
      currentBeatIndex: 2,
      cardsResolvedInBeat: 1,
      totalWorldCardsResolved: 5,
      facts: { route: "north" },
    },
    meta: { discoveredEndingIds: ["old-ending"], bestLevel: 3 },
  };
}

function pendingFeedback() {
  return {
    version: 1,
    id: "choice-feedback:5:a",
    sourceCardId: "a",
    sourceResolutionToken: "5:a",
    resultText: "You choose the northern road.",
    tone: "neutral",
    changes: { xp: 3 },
    nextCardId: "b",
    nextCardToken: "6:b",
  };
}

test("all named checkpoint IDs are stable", () => {
  assert.equal(getCheckpointIdForBeat("openingImage"), "01-opening-image");
  assert.equal(getCheckpointIdForBeat("darkNightOfTheSoul"), "12-dark-night-of-the-soul");
  assert.equal(getCheckpointIdForBeat("finalImage"), "15-final-image");
});

test("checkpoints support an arbitrary nine-phase story definition", () => {
  const phases = Array.from({ length: 9 }, (_, index) => ({
    id: `deck-${String(index + 1).padStart(2, "0")}`,
  }));
  const base = state();
  const deckState = {
    ...base,
    story: {
      ...base.story,
      currentBeatId: "deck-09",
      currentBeatIndex: 8,
    },
  };
  const checkpoint = createStoryCheckpoint(deckState, "deck-09", { phases });

  assert.equal(checkpoint.id, "09-deck-09");
  assert.equal(checkpoint.beatId, "deck-09");
  assert.deepEqual(checkpoint.storyPhaseIds, phases.map(({ id }) => id));
  assert.equal(restoreStoryCheckpoint(checkpoint, deckState).story.currentBeatId, "deck-09");
});

test("checkpoint captures RNG/full run, strips animation state, and retains current meta on restore", () => {
  const original = state();
  const checkpoint = createStoryCheckpoint(original, "setup");
  assert.equal(checkpoint.rngState, original.rngState);
  assert.equal(checkpoint.snapshot.animationState, undefined);

  const current = { ...original, meta: { discoveredEndingIds: ["new-ending"], bestLevel: 9 } };
  const restored = restoreStoryCheckpoint(checkpoint, current);
  assert.deepEqual(restored.story.facts, { route: "north" });
  assert.deepEqual(restored.meta, current.meta);
});

test("restoring a checkpoint reproduces future seeded selection", () => {
  const original = state();
  const checkpoint = createStoryCheckpoint(original, "03-setup");
  const first = selectStoryCard(original, deck, beat);
  const restored = restoreStoryCheckpoint(checkpoint, { meta: { bestLevel: 99 } });
  const repeated = selectStoryCard(restored, deck, beat);
  assert.equal(repeated.card.id, first.card.id);
  assert.equal(repeated.state.rngState, first.state.rngState);
});

test("checkpoint save and restore preserves pending choice feedback and its prepared successor", () => {
  const feedback = pendingFeedback();
  const original = {
    ...state(),
    currentCardId: feedback.nextCardId,
    currentCardToken: feedback.nextCardToken,
    currentCardData: deck[1],
    pendingChoiceFeedback: feedback,
  };
  const checkpoint = createStoryCheckpoint(original, "03-setup");

  assert.deepEqual(checkpoint.snapshot.pendingChoiceFeedback, feedback);
  assert.equal(checkpoint.snapshot.currentCardId, feedback.nextCardId);
  assert.equal(checkpoint.snapshot.currentCardToken, feedback.nextCardToken);
  assert.equal(checkpoint.snapshot.rngState, original.rngState);

  const restored = restoreStoryCheckpoint(checkpoint, {
    meta: { discoveredEndingIds: ["new-ending"], bestLevel: 9 },
  });
  assert.deepEqual(restored.pendingChoiceFeedback, feedback);
  assert.equal(restored.currentCardId, feedback.nextCardId);
  assert.equal(restored.currentCardToken, feedback.nextCardToken);
  assert.equal(restored.rngState, original.rngState);
});

test("checkpoint controls require both localhost and explicit opt-in", () => {
  assert.equal(isStoryCheckpointDebugEnabled({ hostname: "localhost", search: "" }), false);
  assert.equal(
    isStoryCheckpointDebugEnabled({ hostname: "localhost", search: "?storyDebug=1" }),
    true,
  );
  assert.equal(
    isStoryCheckpointDebugEnabled({ hostname: "game.example", search: "?storyDebug=1" }),
    false,
  );
});
