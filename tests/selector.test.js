import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../public/js/game/state.js";
import {
  BUILT_IN_FALLBACK_CARD,
  effectiveWeight,
  getEligibleCards,
  selectExplorationCard,
} from "../public/js/game/selector.js";
import { isEncounterAllowedByPolicy } from "../public/js/game/story/story-selector.js";

const choice = { label: "Go", resultText: "Gone.", effects: [] };
const card = (id, overrides = {}) => ({
  id,
  category: "travel",
  baseWeight: 1,
  cooldown: 0,
  oncePerRun: false,
  requirements: [],
  tags: ["peaceful"],
  story: {
    arcIds: ["ember-crown"],
    beatWeights: { funAndGames: 1 },
    role: "ambient",
    completionTags: [],
    countsTowardStory: true,
  },
  left: choice,
  right: choice,
  ...overrides,
});
test("weighted exploration selection is reproducible for a fixed seed", () => {
  const deck = [card("a", { baseWeight: 1 }), card("b", { baseWeight: 4 }), card("c", { baseWeight: 2 })];
  const first = selectExplorationCard(createInitialState({ seed: 100 }), deck);
  const second = selectExplorationCard(createInitialState({ seed: 100 }), deck);
  assert.equal(first.card.id, second.card.id);
  assert.equal(first.state.rngState, second.state.rngState);
  assert.deepEqual(first.state.run.recentCardIds, [first.card.id]);
});

test("requirements, cooldowns, once-only history, and last-four history filter cards", () => {
  let state = createInitialState({ seed: 5 });
  state = {
    ...state,
    decisionCount: 8,
    run: {
      ...state.run,
      recentCardIds: ["recent"],
      lastSeenTurnByCardId: { cooling: 7 },
      resolvedOnceCards: ["once"],
    },
  };
  const deck = [
    card("recent"),
    card("cooling", { cooldown: 3 }),
    card("once", { oncePerRun: true }),
    card("locked", { requirements: [{ type: "minLevel", value: 9 }] }),
    card("eligible"),
  ];
  assert.deepEqual(getEligibleCards(state, deck).map(({ id }) => id), ["eligible"]);
});

test("no eligible storylet yields the deterministic safe fallback without consuming RNG", () => {
  const state = createInitialState({ seed: 6 });
  const result = selectExplorationCard(state, [card("locked", { requirements: [{ type: "minGold", value: 999 }] })]);
  assert.equal(result.card.id, BUILT_IN_FALLBACK_CARD.id);
  assert.equal(result.source, "fallback");
  assert.equal(result.state.rngState, state.rngState);
});

test("story world count blocks a first-card encounter and encounter policy remains authoritative", () => {
  const encounter = card("fight", { category: "encounter", tags: ["encounter"], baseWeight: 0.001 });
  const peaceful = card("rest", { baseWeight: 1000 });
  const first = selectExplorationCard(createInitialState({ seed: 7 }), [encounter, peaceful]);
  assert.equal(first.card.id, "rest");

  let paced = createInitialState({ seed: 7 });
  paced = {
    ...paced,
    decisionCount: 5,
    story: {
      ...paced.story,
      currentBeatId: "funAndGames",
      currentBeatIndex: 7,
      cardsResolvedInBeat: 5,
      totalWorldCardsResolved: 5,
    },
    run: { ...paced.run, turnsSinceEncounter: 5 },
  };
  assert.equal(selectExplorationCard(paced, [encounter, peaceful]).card.id, "fight");

  assert.equal(
    isEncounterAllowedByPolicy(paced, encounter, {
      id: "darkNightOfTheSoul",
      encounterPolicy: { mode: "none" },
    }),
    false,
  );
  assert.equal(
    isEncounterAllowedByPolicy(paced, encounter, {
      id: "funAndGames",
      encounterPolicy: { mode: "random", minimumCardsBeforeEncounter: 1 },
    }),
    true,
  );
});

test("low HP recovery and active-flag cards receive bounded pacing boosts", () => {
  let state = createInitialState({ seed: 8 });
  state = {
    ...state,
    player: { ...state.player, hp: 5 },
    run: { ...state.run, flags: { oath: true } },
  };
  const normal = card("normal");
  const recovery = card("recovery", { category: "recovery", tags: ["recovery"] });
  const consequence = card("consequence", { tags: ["flag:oath", "active-flag"] });
  assert.ok(effectiveWeight(recovery, state) > effectiveWeight(normal, state));
  assert.ok(effectiveWeight(consequence, state) > effectiveWeight(normal, state));
  assert.ok(effectiveWeight(recovery, state) < 3 * effectiveWeight(normal, state));
});
