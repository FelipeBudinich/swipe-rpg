import test from "node:test";
import assert from "node:assert/strict";

import {
  CHOICE_FEEDBACK_CHANGE_FIELDS,
  CHOICE_FEEDBACK_CHANGE_LABELS,
  CHOICE_FEEDBACK_TONES,
  CHOICE_FEEDBACK_VERSION,
  FEEDBACK_ART_BY_TONE,
  choiceFeedbackId,
  classifyChoiceFeedbackTone,
  createPendingChoiceFeedback,
  deriveChoiceFeedbackChanges,
  feedbackSuccessorIsSuppressed,
  isFinalImageCard,
  normalizeChoiceFeedbackChanges,
  normalizeChoiceFeedbackTone,
  normalizePendingChoiceFeedback,
  shouldCreateChoiceFeedback,
} from "../public/js/game/choice-feedback.js";
import { createInitialState } from "../public/js/game/state.js";

const feedbackArc = {
  beats: [
    {
      id: "finalImage",
      completionCardIds: ["quiet-epilogue"],
      anchor: {
        fallbackCardId: "fallback-epilogue",
        variants: [{ cardId: "variant-epilogue" }],
      },
      endingVariants: {
        "mapped-epilogue": { cardId: "mapped-object-epilogue" },
      },
    },
  ],
  endings: [
    { id: "dawn", finalImageCardId: "single-epilogue" },
    { id: "embers", finalImageCardIds: ["many-epilogue"] },
  ],
};

function choice(label = "Choose") {
  return { label, resultText: `${label} resolves.`, effects: [] };
}

function card(overrides = {}) {
  return {
    id: "next-world-card",
    category: "story",
    story: { countsTowardStory: true, role: "ambient" },
    left: choice("Left"),
    right: choice("Right"),
    ...overrides,
  };
}

function successor(overrides = {}) {
  const base = createInitialState({ seed: 101 });
  const nextCard = card(overrides.card);
  return {
    nextCard,
    nextState: {
      ...base,
      mode: overrides.mode ?? "exploration",
      currentCardId: nextCard.id,
      currentCardData: nextCard,
      currentCardToken: overrides.token ?? `1:${nextCard.id}`,
      story: {
        ...base.story,
        ...(overrides.story ?? {}),
      },
    },
  };
}

function feedbackInput(overrides = {}) {
  const { nextState, nextCard } = successor(overrides.successor);
  const beforeState = createInitialState({ seed: 101 });
  return {
    beforeState,
    resolvedMode: "exploration",
    resolvedCard: card({
      id: "source-world-card",
      story: { countsTowardStory: true, role: "ambient" },
    }),
    resultText: "The road opens before you.",
    nextState,
    nextCard,
    arc: feedbackArc,
    ...overrides,
  };
}

function payloadFor(nextState, overrides = {}) {
  return createPendingChoiceFeedback({
    sourceCard: card({ id: "source-world-card" }),
    sourceToken: "0:source-world-card",
    resultText: "The road opens before you.",
    changes: { xp: 8 },
    nextState,
    ...overrides,
  });
}

test("feedback schema exposes only recognized fields, tones, labels, and local art IDs", () => {
  assert.equal(CHOICE_FEEDBACK_VERSION, 1);
  assert.deepEqual(CHOICE_FEEDBACK_CHANGE_FIELDS, [
    "level",
    "xp",
    "hp",
    "mp",
    "gold",
    "attack",
    "defense",
    "maxHp",
    "maxMp",
    "inventory",
  ]);
  assert.deepEqual(CHOICE_FEEDBACK_TONES, [
    "neutral",
    "reward",
    "recovery",
    "damage",
    "danger",
  ]);
  assert.deepEqual(Object.keys(CHOICE_FEEDBACK_CHANGE_LABELS), CHOICE_FEEDBACK_CHANGE_FIELDS);
  assert.deepEqual(Object.keys(FEEDBACK_ART_BY_TONE), CHOICE_FEEDBACK_TONES);
  for (const artId of Object.values(FEEDBACK_ART_BY_TONE)) {
    assert.match(artId, /^result-(neutral|reward|recovery|damage|danger)$/);
  }
});

test("Final Image detection uses beat position, story role, and arc metadata", () => {
  assert.equal(
    isFinalImageCard(card(), { story: { currentBeatId: "finalImage" } }, feedbackArc),
    true,
  );
  assert.equal(
    isFinalImageCard(card({ story: { role: "ending" } }), { story: {} }, feedbackArc),
    true,
  );
  for (const id of [
    "quiet-epilogue",
    "fallback-epilogue",
    "variant-epilogue",
    "mapped-epilogue",
    "mapped-object-epilogue",
    "single-epilogue",
    "many-epilogue",
  ]) {
    assert.equal(isFinalImageCard(card({ id }), { story: {} }, feedbackArc), true, id);
  }
  assert.equal(isFinalImageCard(card(), { story: { currentBeatId: "setup" } }, feedbackArc), false);
});

test("eligible world, merchant, shrine, camp, and encounter choices create feedback", () => {
  for (const category of ["story", "merchant", "shrine", "camp", "encounter"]) {
    const input = feedbackInput();
    input.resolvedCard = card({
      id: `source-${category}`,
      category,
      story: { countsTowardStory: true, role: "ambient" },
    });
    assert.equal(shouldCreateChoiceFeedback(input), true, category);
  }

  const encounter = feedbackInput({
    successor: {
      mode: "combat",
      card: { id: "combat:ember-slime:1", category: "combat" },
    },
  });
  assert.equal(shouldCreateChoiceFeedback(encounter), true);
});

test("feedback eligibility requires authored world resolution and a prepared successor", () => {
  const eligible = feedbackInput();
  assert.equal(shouldCreateChoiceFeedback(eligible), true);
  assert.equal(shouldCreateChoiceFeedback({ ...eligible, resolvedMode: "combat" }), false);
  assert.equal(
    shouldCreateChoiceFeedback({
      ...eligible,
      resolvedCard: card({ story: { countsTowardStory: false, role: "ambient" } }),
    }),
    false,
  );
  assert.equal(shouldCreateChoiceFeedback({ ...eligible, resultText: "  " }), false);
  assert.equal(
    shouldCreateChoiceFeedback({
      ...eligible,
      nextState: { ...eligible.nextState, currentCardToken: null },
    }),
    false,
  );
  assert.equal(
    shouldCreateChoiceFeedback({
      ...eligible,
      nextCard: { ...eligible.nextCard, id: "different-card" },
    }),
    false,
  );
});

test("dedicated successor surfaces and Final Image suppress generic feedback", () => {
  for (const mode of [
    "combatReward",
    "levelUp",
    "loot",
    "storyTransition",
    "gameOver",
    "victory",
  ]) {
    const input = feedbackInput({ successor: { mode } });
    assert.equal(shouldCreateChoiceFeedback(input), false, mode);
  }

  for (const category of ["combatReward", "levelUp", "loot", "gameOver", "victory"]) {
    const input = feedbackInput({ successor: { card: { category } } });
    assert.equal(shouldCreateChoiceFeedback(input), false, category);
  }

  const finalSource = feedbackInput({
    resolvedCard: card({
      id: "many-epilogue",
      story: { countsTowardStory: true, role: "ending" },
    }),
  });
  assert.equal(shouldCreateChoiceFeedback(finalSource), false);

  const finalSuccessor = feedbackInput({
    successor: { card: { id: "many-epilogue" } },
  });
  assert.equal(shouldCreateChoiceFeedback(finalSuccessor), false);
});

test("structured changes include player, derived stat, and inventory deltas", () => {
  const before = createInitialState({ seed: 202 });
  const after = {
    ...before,
    player: {
      ...before.player,
      level: before.player.level + 1,
      xp: before.player.xp + 8,
      hp: before.player.hp - 4,
      mp: before.player.mp + 2,
      gold: before.player.gold - 5,
      baseStats: {
        attack: before.player.baseStats.attack + 2,
        defense: before.player.baseStats.defense + 1,
        maxHp: before.player.baseStats.maxHp + 6,
        maxMp: before.player.baseStats.maxMp + 4,
      },
      inventory: [...before.player.inventory, "bluewake-tonic"],
    },
  };

  assert.deepEqual(deriveChoiceFeedbackChanges(before, after), {
    level: 1,
    xp: 8,
    hp: -4,
    mp: 2,
    gold: -5,
    attack: 2,
    defense: 1,
    maxHp: 6,
    maxMp: 4,
    inventory: 1,
  });
});

test("structured changes account for equipment-derived stats", () => {
  const items = [
    {
      id: "sun-ward",
      type: "equipment",
      slot: "charm",
      statModifiers: { attack: 1, defense: 2, maxHp: 3, maxMp: 4 },
    },
  ];
  const before = createInitialState({ seed: 203 });
  const after = {
    ...before,
    player: {
      ...before.player,
      equipment: { ...before.player.equipment, charm: "sun-ward" },
      inventory: ["sun-ward"],
    },
  };

  assert.deepEqual(deriveChoiceFeedbackChanges(before, after, items), {
    attack: 1,
    defense: 2,
    maxHp: 3,
    maxMp: 4,
    inventory: 1,
  });
});

test("change normalization omits zero, unknown, NaN, and infinite values", () => {
  assert.deepEqual(
    normalizeChoiceFeedbackChanges({
      hp: -3,
      mp: 0,
      xp: Number.NaN,
      gold: Number.POSITIVE_INFINITY,
      decisionCount: 2,
      storyProgress: 8,
    }),
    { hp: -3 },
  );
  assert.deepEqual(normalizeChoiceFeedbackChanges(null), {});
});

test("tone classification follows requested priority and explicit recognized overrides", () => {
  assert.equal(classifyChoiceFeedbackTone({ hp: -1, xp: 10 }), "damage");
  assert.equal(classifyChoiceFeedbackTone({ gold: -1, hp: 2 }), "danger");
  assert.equal(classifyChoiceFeedbackTone({ hp: 2, xp: 10 }), "recovery");
  assert.equal(classifyChoiceFeedbackTone({ mp: 2 }), "recovery");
  assert.equal(classifyChoiceFeedbackTone({ xp: 8 }), "reward");
  assert.equal(classifyChoiceFeedbackTone({ inventory: 1 }), "reward");
  assert.equal(classifyChoiceFeedbackTone({}), "neutral");
  assert.equal(classifyChoiceFeedbackTone({ hp: -1 }, "reward"), "reward");
  assert.equal(classifyChoiceFeedbackTone({ hp: -1 }, "legacy-danger-tone"), "damage");
  assert.equal(normalizeChoiceFeedbackTone("danger"), "danger");
  assert.equal(normalizeChoiceFeedbackTone("victory"), null);
});

test("payload creation is deterministic, serializable, filtered, and nonmutating", () => {
  const { nextState } = successor();
  const stateSnapshot = JSON.stringify(nextState);
  const input = {
    sourceCard: card({ id: "opening-hearthvale-oath" }),
    sourceToken: "0:opening-hearthvale-oath",
    resultText: "You accept the oath before the gathered village.",
    changes: { xp: 8, hp: 0, gold: Number.NaN, rngState: 99 },
    nextState,
  };

  const first = createPendingChoiceFeedback(input);
  const second = createPendingChoiceFeedback(input);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.id, "choice-feedback:0:opening-hearthvale-oath");
  assert.equal(first.sourceCardId, "opening-hearthvale-oath");
  assert.equal(first.sourceResolutionToken, "0:opening-hearthvale-oath");
  assert.equal(first.resultText, input.resultText);
  assert.equal(first.tone, "reward");
  assert.deepEqual(first.changes, { xp: 8 });
  assert.equal(first.nextCardId, nextState.currentCardId);
  assert.equal(first.nextCardToken, nextState.currentCardToken);
  assert.equal(JSON.stringify(nextState), stateSnapshot);
  assert.equal(choiceFeedbackId("0:opening-hearthvale-oath"), first.id);
  assert.equal(choiceFeedbackId(""), null);
});

test("payload creation requires stable source and successor identity", () => {
  const { nextState } = successor();
  assert.equal(
    createPendingChoiceFeedback({
      sourceCard: card(),
      sourceToken: "",
      resultText: "Result.",
      nextState,
    }),
    null,
  );
  assert.equal(
    createPendingChoiceFeedback({
      sourceCard: card(),
      sourceToken: "0:source",
      resultText: " ",
      nextState,
    }),
    null,
  );
  assert.equal(
    createPendingChoiceFeedback({
      sourceCard: card(),
      sourceToken: "0:source",
      resultText: "Result.",
      nextState: { ...nextState, currentCardToken: null },
    }),
    null,
  );
});

test("normalization preserves valid feedback over the same exploration or combat successor", () => {
  for (const mode of ["exploration", "combat"]) {
    const { nextState } = successor({
      mode,
      card: mode === "combat" ? { id: "combat:ember-slime:1", category: "combat" } : {},
    });
    const payload = payloadFor(nextState);
    const normalized = normalizePendingChoiceFeedback(payload, {
      state: nextState,
      card: nextState.currentCardData,
      arc: feedbackArc,
    });
    assert.deepEqual(normalized, payload, mode);
    assert.notEqual(normalized, payload);
    assert.notEqual(normalized.changes, payload.changes);
  }
});

test("normalization rejects malformed, stale, and unsupported payloads without touching state", () => {
  const { nextState } = successor();
  const valid = payloadFor(nextState);
  const cases = [
    [],
    { ...valid, version: 99 },
    { ...valid, id: "" },
    { ...valid, id: "random-id" },
    { ...valid, sourceCardId: null },
    { ...valid, sourceResolutionToken: null },
    { ...valid, resultText: null },
    { ...valid, tone: "victory" },
    { ...valid, changes: { hp: Number.NaN } },
    { ...valid, changes: { hp: Number.POSITIVE_INFINITY } },
    { ...valid, changes: { decisionCount: 1 } },
    { ...valid, nextCardId: "different-card" },
    { ...valid, nextCardToken: "99:different-token" },
  ];
  const stateSnapshot = JSON.stringify(nextState);
  for (const malformed of cases) {
    assert.equal(
      normalizePendingChoiceFeedback(malformed, {
        state: nextState,
        card: nextState.currentCardData,
        arc: feedbackArc,
      }),
      null,
    );
  }
  assert.equal(JSON.stringify(nextState), stateSnapshot);
  assert.equal(normalizePendingChoiceFeedback(undefined, { state: nextState }), null);
});

test("normalization clears dedicated, terminal, transition, completed, and Final Image successors", () => {
  for (const mode of [
    "combatReward",
    "levelUp",
    "loot",
    "storyTransition",
    "gameOver",
    "victory",
  ]) {
    const { nextState } = successor({ mode });
    assert.equal(
      normalizePendingChoiceFeedback(payloadFor(nextState), {
        state: nextState,
        card: nextState.currentCardData,
        arc: feedbackArc,
      }),
      null,
      mode,
    );
  }

  const final = successor({ card: { id: "single-epilogue" } });
  assert.equal(
    normalizePendingChoiceFeedback(payloadFor(final.nextState), {
      state: final.nextState,
      card: final.nextCard,
      arc: feedbackArc,
    }),
    null,
  );

  const completed = successor({ story: { completed: true, status: "completed" } });
  assert.equal(
    feedbackSuccessorIsSuppressed(completed.nextState, completed.nextCard, feedbackArc),
    true,
  );
});

test("normalization returns a canonical copy and omits persisted zero changes", () => {
  const { nextState } = successor();
  const valid = {
    ...payloadFor(nextState),
    changes: { xp: 8, hp: 0 },
    ignoredTopLevel: "not copied",
  };
  const normalized = normalizePendingChoiceFeedback(valid, {
    state: nextState,
    card: nextState.currentCardData,
    arc: feedbackArc,
  });
  assert.deepEqual(normalized.changes, { xp: 8 });
  assert.equal("ignoredTopLevel" in normalized, false);
});
