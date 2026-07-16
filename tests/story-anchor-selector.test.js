import test from "node:test";
import assert from "node:assert/strict";

import {
  getEligibleAnchorVariants,
  selectAnchorVariant,
} from "../public/js/game/story/arc-engine.js";
import {
  calculateStoryCardWeight,
  getEligibleStoryCards,
  isEncounterAllowedByPolicy,
  selectStoryCard,
} from "../public/js/game/story/story-selector.js";

const choice = { label: "Choose", resultText: "Chosen.", effects: [] };
const requirementEvaluator = (requirements, state) =>
  (Array.isArray(requirements) ? requirements : [requirements]).every((requirement) =>
    requirement.type === "storyFactEquals"
      ? state.story.facts[requirement.key] === requirement.value
      : true,
  );

const anchorBeat = {
  id: "catalyst",
  budget: { minimum: 1, target: 1, maximum: 1 },
  completionObjective: { type: "anchorResolved" },
  anchor: {
    variants: [
      {
        cardId: "helped-anchor",
        requirements: [{ type: "storyFactEquals", key: "helped", value: true }],
        weight: 1,
      },
      {
        cardId: "watched-anchor",
        requirements: [{ type: "storyFactEquals", key: "watched", value: true }],
        weight: 1,
      },
    ],
    fallbackCardId: "fallback-anchor",
  },
};
const arc = { id: "arc", beats: [anchorBeat] };

function state(overrides = {}) {
  return {
    rngState: 777,
    decisionCount: 0,
    run: {
      recentCardIds: [],
      lastSeenTurnByCardId: {},
      resolvedOnceCards: [],
      forcedCardQueue: [],
      randomEncountersByBeat: {},
    },
    story: {
      arcId: "arc",
      currentBeatId: overrides.beatId ?? "catalyst",
      currentBeatIndex: 0,
      cardsResolvedInBeat: overrides.cardsResolvedInBeat ?? 0,
      totalWorldCardsResolved: 0,
      completedBeatIds: [],
      resolvedStoryTags: [],
      facts: overrides.facts ?? {},
      selectedAnchorIdByBeat: overrides.selectedAnchorIdByBeat ?? {},
      resolvedAnchorIds: [],
    },
  };
}

function card(id, beats, overrides = {}) {
  return {
    id,
    category: "travel",
    baseWeight: 1,
    cooldown: 0,
    oncePerRun: false,
    requirements: [],
    left: choice,
    right: choice,
    story: {
      arcIds: overrides.global ? undefined : ["arc"],
      beatWeights: beats,
      role: "ambient",
      completionTags: [],
      countsTowardStory: true,
      ...overrides.story,
    },
    ...overrides.card,
  };
}

test("anchor requirements, fixed-seed selection, persistence, and fallback are deterministic", () => {
  const eligibleState = state({ facts: { helped: true, watched: true } });
  assert.deepEqual(
    getEligibleAnchorVariants(eligibleState, arc, anchorBeat, {
      evaluateRequirements: requirementEvaluator,
    }).map(({ cardId }) => cardId),
    ["helped-anchor", "watched-anchor"],
  );
  const first = selectAnchorVariant(eligibleState, arc, anchorBeat, 777, {
    evaluateRequirements: requirementEvaluator,
  });
  const second = selectAnchorVariant(eligibleState, arc, anchorBeat, 777, {
    evaluateRequirements: requirementEvaluator,
  });
  assert.equal(first.cardId, second.cardId);

  const changedResources = {
    ...first.state,
    story: { ...first.state.story, facts: {} },
  };
  const persisted = selectAnchorVariant(changedResources, arc, anchorBeat, 999, {
    evaluateRequirements: requirementEvaluator,
  });
  assert.equal(persisted.cardId, first.cardId);
  assert.equal(persisted.state.rngState, first.state.rngState);

  const fallback = selectAnchorVariant(state(), arc, anchorBeat, 777, {
    evaluateRequirements: requirementEvaluator,
  });
  assert.equal(fallback.cardId, "fallback-anchor");
  assert.equal(fallback.source, "fallback");
});

test("multi-beat and global cards use the current beat's declared weight", () => {
  const beat = {
    id: "setup",
    budget: { minimum: 3, target: 4, maximum: 4 },
    completionObjective: { type: "storyTagResolved", tag: "done" },
    completionCardIds: ["completion"],
    encounterPolicy: { mode: "random" },
  };
  const multi = card("multi", { setup: 0.5, funAndGames: 3 });
  const global = card("global", { setup: 1 }, { global: true });
  const current = state({ beatId: "setup", cardsResolvedInBeat: 1 });
  assert.ok(calculateStoryCardWeight(current, multi, beat) < calculateStoryCardWeight(current, global, beat));
  assert.deepEqual(
    getEligibleStoryCards(current, [multi, global], beat).map(({ id }) => id),
    ["multi", "global"],
  );
});

test("a multi-beat completion card is ambient unless this beat declares it as a candidate", () => {
  const beat = {
    id: "setup",
    budget: { minimum: 3, target: 4, maximum: 4 },
    completionObjective: { type: "storyTagResolved", tag: "setup-done" },
    completionCardIds: ["setup-completion"],
    encounterPolicy: { mode: "none" },
  };
  const wrongBeatCompletion = card("theme-completion", { themeStated: 1, setup: 1 }, {
    story: { role: "completion", completionTags: ["theme-done"] },
  });
  const setupCompletion = card("setup-completion", { setup: 1 }, {
    story: { role: "completion", completionTags: ["setup-done"] },
  });
  const forced = state({ beatId: "setup", cardsResolvedInBeat: 3 });
  assert.deepEqual(
    getEligibleStoryCards(forced, [wrongBeatCompletion, setupCompletion], beat).map(({ id }) => id),
    ["setup-completion"],
  );

  const atMaximum = state({ beatId: "setup", cardsResolvedInBeat: 4 });
  assert.deepEqual(
    getEligibleStoryCards(atMaximum, [wrongBeatCompletion, setupCompletion], beat).map(({ id }) => id),
    ["setup-completion"],
  );
});

test("completion pressure rises toward target and maximum-minus-one excludes ambient", () => {
  const beat = {
    id: "setup",
    budget: { minimum: 3, target: 4, maximum: 4 },
    completionObjective: { type: "storyTagResolved", tag: "done" },
    encounterPolicy: { mode: "none" },
  };
  const ambient = card("ambient", { setup: 1 });
  const completion = card("completion", { setup: 1 }, {
    story: { role: "completion", completionTags: ["done"] },
  });
  const tooEarly = state({ beatId: "setup", cardsResolvedInBeat: 1 });
  assert.deepEqual(
    getEligibleStoryCards(tooEarly, [ambient, completion], beat).map(({ id }) => id),
    ["ambient"],
  );

  const early = state({ beatId: "setup", cardsResolvedInBeat: 2 });
  assert.deepEqual(
    getEligibleStoryCards(early, [ambient, completion], beat).map(({ id }) => id),
    ["ambient", "completion"],
  );

  const forced = state({ beatId: "setup", cardsResolvedInBeat: 3 });
  assert.deepEqual(getEligibleStoryCards(forced, [ambient, completion], beat).map(({ id }) => id), ["completion"]);
  assert.ok(
    calculateStoryCardWeight(forced, completion, beat) >
      calculateStoryCardWeight(early, completion, beat),
  );
});

test("recent-card exclusion and seeded story selection remain reproducible", () => {
  const beat = {
    id: "funAndGames",
    budget: { minimum: 5, target: 6, maximum: 7 },
    completionObjective: { type: "storyTagResolved", tag: "done" },
    encounterPolicy: { mode: "random" },
  };
  const a = card("a", { funAndGames: 1 });
  const b = card("b", { funAndGames: 3 });
  const current = state({ beatId: "funAndGames", cardsResolvedInBeat: 1 });
  current.run.recentCardIds = ["a"];
  assert.deepEqual(getEligibleStoryCards(current, [a, b], beat).map(({ id }) => id), ["b"]);
  assert.equal(selectStoryCard(current, [a, b], beat).card.id, selectStoryCard(current, [a, b], beat).card.id);
});

test("encounter policies block forbidden/random-over-cap cards and filter enemy tags", () => {
  const encounter = card("fight", { setup: 1 }, {
    card: { category: "encounter", enemyId: "brute", tags: ["encounter"] },
    story: { encounterType: "random", enemyId: "brute" },
  });
  const current = state({ beatId: "setup", cardsResolvedInBeat: 1 });
  const noCombat = { id: "setup", encounterPolicy: { mode: "none" } };
  assert.equal(isEncounterAllowedByPolicy(current, encounter, noCombat), false);

  const weakOnly = {
    id: "setup",
    encounterPolicy: {
      mode: "random",
      allowedEnemyTags: ["weak"],
      maximumRandomEncounters: 1,
      minimumCardsBeforeEncounter: 1,
    },
  };
  assert.equal(
    isEncounterAllowedByPolicy(current, encounter, weakOnly, {
      enemies: [{ id: "brute", story: { enemyTags: ["elite"] } }],
    }),
    false,
  );
  assert.equal(
    isEncounterAllowedByPolicy(current, encounter, weakOnly, {
      enemies: [{ id: "brute", story: { enemyTags: ["weak"] } }],
    }),
    true,
  );
  current.run.randomEncountersByBeat.setup = 1;
  assert.equal(
    isEncounterAllowedByPolicy(current, encounter, weakOnly, {
      enemies: [{ id: "brute", story: { enemyTags: ["weak"] } }],
    }),
    false,
  );
});
