import test from "node:test";
import assert from "node:assert/strict";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  createGame,
  dismissChoiceFeedback,
  getCurrentCard,
  getDestinationDeckId,
  getNextCard,
  restartGame,
  resolveChoice,
} from "../public/js/game/engine.js";
import {
  getChoiceAvailability,
  getDirectionAvailability,
  normalizeChoiceCosts,
} from "../public/js/game/choice-availability.js";
import { createInitialState, normalizeState } from "../public/js/game/state.js";

const deckById = Object.fromEntries(
  DEEP_SOUTH_STORY.decks.map((deck) => [deck.id, deck]),
);

const COST_CONTRACT_CARD = {
  id: "castro-cost-contract",
  deckId: "castro",
  type: "plot",
  title: "Cost contract",
  text: "A deterministic fixture for resolver costs.",
  choices: {
    up: {
      label: "Pay one crew",
      result: "One crewmate takes the watch.",
      effects: {},
      costs: { crew: 1 },
    },
    down: {
      label: "Spend lore to learn",
      result: "Two clues combine into one useful conclusion.",
      effects: { eldritchLore: 1 },
      costs: { eldritchLore: 2 },
    },
    left: {
      label: "Risk your mind",
      result: "The impossible answer leaves a permanent mark.",
      effects: { sanity: -1 },
      costs: { sanity: 99 },
    },
  },
};

const COST_CONTRACT_STORY = {
  ...DEEP_SOUTH_STORY,
  decks: DEEP_SOUTH_STORY.decks.map((deck) =>
    deck.id === "castro"
      ? { ...deck, cards: [COST_CONTRACT_CARD] }
      : deck,
  ),
};

const NO_EFFECT_SOURCE_CARD = {
  id: "source-card",
  deckId: "source",
  type: "plot",
  title: "Source",
  text: "The route divides.",
  choices: {
    down: {
      label: "Next chapter",
      result: "This text must not become an outcome.",
      effects: {},
    },
  },
};

const NO_EFFECT_DESTINATION_CARD = {
  id: "destination-card",
  deckId: "destination",
  type: "plot",
  title: "Immediate destination",
  text: "The next card is ready.",
  entryEffect: null,
  choices: {
    up: {
      label: "Previous chapter",
      result: "Return.",
      effects: {},
    },
  },
};

const NO_EFFECT_ENTRY_STORY = {
  id: "no-effect-entry",
  title: "No Effect Entry",
  decks: [
    {
      id: "source",
      title: "Source",
      type: "plot",
      plotStep: 1,
      cards: [NO_EFFECT_SOURCE_CARD],
    },
    {
      id: "destination",
      title: "Destination",
      type: "plot",
      plotStep: 2,
      cards: [NO_EFFECT_DESTINATION_CARD],
    },
  ],
};

function resolve(state, card, direction, story = DEEP_SOUTH_STORY) {
  return resolveChoice(state, direction, {
    expectedToken: card?.resolutionToken,
    story,
  });
}

function acknowledge(result) {
  assert.ok(result.state.pendingFeedback);
  const dismissed = dismissChoiceFeedback(result.state, {
    expectedFeedbackId: result.state.pendingFeedback.id,
  });
  assert.equal(dismissed.ignored, false);
  return dismissed;
}

function enterCastro(seed = 17) {
  let game = createGame({ seed });
  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.introSkipPending, true);
  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.currentDeckId, "castro");
  return game;
}

function stateOnCard(
  deckId,
  cardId,
  resources = {},
  story = DEEP_SOUTH_STORY,
) {
  const base = createInitialState({
    seed: 71,
    decks: story.decks,
  });
  const state = {
    ...base,
    currentDeckId: deckId,
    currentCardId: cardId,
    currentCardToken: `0:${deckId}:${cardId}`,
    resources: { ...base.resources, ...resources },
  };
  return { state, card: getCurrentCard(state, story) };
}

test("a fresh run starts on the first sequential Intro card with exact resources", () => {
  const { state, card } = createGame({ seed: 1 });
  assert.equal(state.storyId, "deep-south");
  assert.equal(state.status, "playing");
  assert.equal(state.currentDeckId, "it-begins-here");
  assert.equal(state.introCardIndex, 0);
  assert.equal(state.introCardFace, "front");
  assert.deepEqual(state.discoveries, { fatherDiaryReverse: false });
  assert.equal(card.id, "intro-fathers-diary");
  assert.equal(card.introFace, "front");
  assert.equal(card.title, "My father’s photograph");
  assert.equal(card.artId, "intro-01-fathers-photograph");
  assert.match(card.artAlt, /aged photograph/u);
  assert.equal(card.detail, "");
  assert.ok(card.choices.left);
  assert.ok(card.choices.right);
  assert.deepEqual(state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
});

test("the diary toggles both ways and records its reverse discovery exactly once", () => {
  const front = createGame({ seed: 101 });
  const frontToken = front.card.resolutionToken;
  const decisionCount = front.state.decisionCount;
  const rngState = front.state.rngState;
  const drawStateByDeck = structuredClone(front.state.drawStateByDeck);

  let game = resolve(front.state, front.card, "left");
  assert.equal(game.ignored, false);
  assert.equal(game.state.introCardFace, "reverse");
  assert.deepEqual(game.state.discoveries, { fatherDiaryReverse: true });
  assert.equal(game.state.resources.eldritchLore, 1);
  assert.equal(game.state.decisionCount, decisionCount);
  assert.equal(game.state.introCardIndex, 0);
  assert.equal(game.state.currentDeckId, "it-begins-here");
  assert.equal(game.state.rngState, rngState);
  assert.deepEqual(game.state.drawStateByDeck, drawStateByDeck);
  assert.equal(game.state.pendingFeedback, null);
  assert.deepEqual(game.changes, { eldritchLore: 1 });
  assert.equal(game.card.id, "intro-fathers-diary");
  assert.equal(game.card.introFace, "reverse");
  assert.equal(game.card.title, "The map on the reverse");
  assert.equal(game.card.artId, "intro-01-chiloe-map");
  assert.match(game.card.artAlt, /hand-drawn nautical map/u);
  assert.equal(game.card.artLabel, "42°36′S, 73°57′W");
  assert.equal(
    game.card.detail,
    "Discovery recorded · +1 Eldritch Lore",
  );
  assert.notEqual(game.card.resolutionToken, frontToken);

  const stale = resolveChoice(game.state, "right", {
    expectedToken: frontToken,
  });
  assert.equal(stale.ignored, true);
  assert.equal(stale.reason, "stale-resolution");
  assert.strictEqual(stale.state, game.state);

  game = resolve(game.state, game.card, "right");
  assert.equal(game.state.introCardFace, "front");
  assert.equal(game.state.resources.eldritchLore, 1);
  assert.deepEqual(game.changes, {});
  assert.equal(game.card.title, "My father’s photograph");
  assert.equal(game.card.introFace, "front");

  game = resolve(game.state, game.card, "right");
  assert.equal(game.state.introCardFace, "reverse");
  assert.equal(game.card.introFace, "reverse");
  assert.equal(game.state.resources.eldritchLore, 1);
  assert.deepEqual(game.state.discoveries, { fatherDiaryReverse: true });
  assert.deepEqual(game.changes, {});
  assert.equal(game.state.pendingFeedback, null);
  assert.equal(game.state.decisionCount, decisionCount);
});

test("up advances from the reverse diary without changing its face or replaying its reward", () => {
  let game = createGame({ seed: 102 });
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.introCardFace, "reverse");
  assert.equal(game.state.resources.eldritchLore, 1);

  game = resolve(game.state, game.card, "up");
  assert.equal(game.ignored, false);
  assert.equal(game.state.introCardIndex, 1);
  assert.equal(game.state.introCardFace, "reverse");
  assert.equal(game.state.resources.eldritchLore, 1);
  assert.equal(game.state.decisionCount, 0);
  assert.equal(game.state.pendingFeedback, null);
  assert.equal(game.card.id, "intro-eldritch-lore");
  assert.equal(game.card.choices.left, undefined);
  assert.equal(game.card.choices.right, undefined);
});

test("a reloaded diary discovery cannot award Eldritch Lore again", () => {
  let game = createGame({ seed: 104 });
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.resources.eldritchLore, 1);

  const reloadedState = normalizeState(
    JSON.parse(JSON.stringify(game.state)),
    { decks: DEEP_SOUTH_STORY.decks },
  );
  game = getNextCard(reloadedState);
  assert.equal(game.state.introCardFace, "reverse");
  assert.deepEqual(game.state.discoveries, { fatherDiaryReverse: true });

  game = resolve(game.state, game.card, "right");
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.introCardFace, "reverse");
  assert.equal(game.state.resources.eldritchLore, 1);
  assert.deepEqual(game.changes, {});
  assert.equal(game.state.pendingFeedback, null);
});

test("an undiscovered persisted reverse repairs to front and keeps its reward earnable", () => {
  const base = createInitialState({
    seed: 105,
    decks: DEEP_SOUTH_STORY.decks,
  });
  const loaded = normalizeState(
    {
      ...base,
      introCardFace: "reverse",
      discoveries: { fatherDiaryReverse: false },
    },
    { decks: DEEP_SOUTH_STORY.decks },
  );
  let game = getNextCard(loaded);

  assert.equal(game.state.introCardFace, "front");
  assert.equal(game.card.introFace, "front");
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.introCardFace, "reverse");
  assert.deepEqual(game.state.discoveries, { fatherDiaryReverse: true });
  assert.equal(game.state.resources.eldritchLore, 1);
});

test("up reads the Intro sequentially and the final card enters Castro", () => {
  let game = createGame({ seed: 2 });
  const introIds = deckById["it-begins-here"].cards.map(({ id }) => id);
  assert.equal(game.card.id, introIds[0]);

  for (let index = 1; index < introIds.length; index += 1) {
    game = resolve(game.state, game.card, "up");
    assert.equal(game.ignored, false);
    assert.equal(game.state.introCardIndex, index);
    assert.equal(game.card.id, introIds[index]);
    assert.equal(game.state.pendingFeedback, null);
  }

  game = resolve(game.state, game.card, "up");
  assert.equal(game.state.currentDeckId, "castro");
  assert.equal(game.state.introSkipPending, false);
  assert.ok(game.card);
  assert.equal(game.state.pendingFeedback, null);
});

test("Intro skip requires two down swipes and cancel returns to the same card", () => {
  let game = createGame({ seed: 3 });
  game = resolve(game.state, game.card, "up");
  const originalCardId = game.card.id;
  const originalIndex = game.state.introCardIndex;

  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.introSkipPending, true);
  assert.equal(game.card.id, "deep-south-intro-skip-confirmation");
  assert.match(game.card.text, /Swipe down again to skip to Castro/u);

  game = resolve(game.state, game.card, "up");
  assert.equal(game.state.introSkipPending, false);
  assert.equal(game.state.introCardIndex, originalIndex);
  assert.equal(game.card.id, originalCardId);

  game = resolve(game.state, game.card, "down");
  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.currentDeckId, "castro");
  assert.ok(game.card);
});

test("skip confirmation retains the reverse face and cancel restores it", () => {
  let game = createGame({ seed: 103 });
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.introCardFace, "reverse");
  const reverseToken = game.card.resolutionToken;

  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.introSkipPending, true);
  assert.equal(game.state.introCardFace, "reverse");

  game = resolve(game.state, game.card, "up");
  assert.equal(game.state.introSkipPending, false);
  assert.equal(game.state.introCardIndex, 0);
  assert.equal(game.state.introCardFace, "reverse");
  assert.equal(game.card.title, "The map on the reverse");
  assert.equal(game.state.resources.eldritchLore, 1);
  assert.equal(game.state.pendingFeedback, null);
  assert.equal(game.state.decisionCount, 0);
  assert.equal(game.card.resolutionToken, reverseToken);

  game = resolve(game.state, game.card, "down");
  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.currentDeckId, "castro");
  assert.equal(game.state.introCardFace, "reverse");
  assert.deepEqual(game.state.discoveries, { fatherDiaryReverse: true });
  assert.equal(game.state.resources.eldritchLore, 1);
});

test("left and right are unavailable on Intro cards 2–8 and skip confirmation", () => {
  let game = createGame({ seed: 4 });
  game = resolve(game.state, game.card, "up");
  const introCards = deckById["it-begins-here"].cards;

  for (let index = 1; index < introCards.length; index += 1) {
    assert.equal(game.state.introCardIndex, index);
    for (const direction of ["left", "right"]) {
      const introResult = resolve(game.state, game.card, direction);
      assert.equal(introResult.ignored, true);
      assert.equal(introResult.reason, "intro-direction-ignored");
      assert.strictEqual(introResult.state, game.state);
    }
    if (index < introCards.length - 1) {
      game = resolve(game.state, game.card, "up");
    }
  }

  game = resolve(game.state, game.card, "down");
  assert.equal(game.state.introSkipPending, true);
  for (const direction of ["left", "right"]) {
    const confirmationResult = resolve(game.state, game.card, direction);
    assert.equal(confirmationResult.ignored, true);
    assert.equal(confirmationResult.reason, "intro-direction-ignored");
    assert.strictEqual(confirmationResult.state, game.state);
  }
});

test("plot navigation is derived centrally and never reaches the Intro", () => {
  assert.equal(getDestinationDeckId("castro", "up"), "castro");
  assert.equal(
    getDestinationDeckId("investigate-church", "up"),
    "castro",
  );
  assert.equal(
    getDestinationDeckId("investigate-church", "down"),
    "gather-crew",
  );
  assert.equal(
    getDestinationDeckId("gather-evidence", "down"),
    "gather-evidence",
  );
  assert.equal(getDestinationDeckId("navigate", "left"), "navigate");
  assert.equal(getDestinationDeckId("navigate", "right"), "navigate");
});

test("the shared availability predicate handles optional choices and only Crew/Lore costs", () => {
  const game = stateOnCard(
    "castro",
    COST_CONTRACT_CARD.id,
    { crew: 0, eldritchLore: 1, sanity: 1 },
    COST_CONTRACT_STORY,
  );

  assert.deepEqual(
    normalizeChoiceCosts({
      crew: "2.8",
      eldritchLore: 1,
      sanity: 99,
      arbitrary: 4,
    }),
    { crew: 2, eldritchLore: 1 },
  );

  const crew = getDirectionAvailability(game.state, game.card, "up");
  assert.equal(crew.available, false);
  assert.equal(crew.reason, "insufficient-resources");
  assert.equal(crew.requirementText, "Requires 1 Crew.");
  assert.deepEqual(crew.costs, { crew: 1 });
  assert.deepEqual(crew.shortfalls, { crew: 1 });

  const missing = getDirectionAvailability(game.state, game.card, "right");
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "choice-unavailable");
  assert.match(missing.requirementText, /No action is available/u);
  assert.deepEqual(missing.costs, {});

  const sanity = getChoiceAvailability(
    game.state,
    COST_CONTRACT_CARD.choices.left,
  );
  assert.equal(sanity.available, true);
  assert.equal(sanity.requirementText, "");
  assert.deepEqual(sanity.costs, {});
});

test("disabled choices are ignored atomically without state, draw, or resource changes", () => {
  const game = stateOnCard(
    "castro",
    COST_CONTRACT_CARD.id,
    { crew: 0 },
    COST_CONTRACT_STORY,
  );
  const before = structuredClone(game.state);

  for (const direction of ["up", "right"]) {
    const result = resolve(
      game.state,
      game.card,
      direction,
      COST_CONTRACT_STORY,
    );
    assert.equal(result.ignored, true);
    assert.equal(
      result.reason,
      direction === "up" ? "insufficient-resources" : "choice-unavailable",
    );
    assert.strictEqual(result.state, game.state);
    assert.deepEqual(result.state, before);
    assert.equal(result.state.pendingFeedback, null);
    assert.equal(result.state.decisionCount, before.decisionCount);
  }
  assert.deepEqual(game.state, before);

  const undrawn = {
    ...game.state,
    currentCardId: null,
    currentCardToken: null,
  };
  const lazyDisabled = resolveChoice(undrawn, "right", {
    story: COST_CONTRACT_STORY,
  });
  assert.equal(lazyDisabled.ignored, true);
  assert.equal(lazyDisabled.reason, "choice-unavailable");
  assert.strictEqual(lazyDisabled.state, undrawn);
});

test("the resolver re-checks and deducts choice costs exactly once", () => {
  const game = stateOnCard(
    "castro",
    COST_CONTRACT_CARD.id,
    { crew: 1 },
    COST_CONTRACT_STORY,
  );
  const result = resolve(
    game.state,
    game.card,
    "up",
    COST_CONTRACT_STORY,
  );

  assert.equal(result.ignored, false);
  assert.equal(result.state.resources.crew, 0);
  assert.deepEqual(result.changes, { crew: -1 });
  assert.deepEqual(result.state.pendingFeedback.changes, { crew: -1 });
  assert.equal(result.state.decisionCount, game.state.decisionCount + 1);
  assert.equal(
    result.state.drawStateByDeck.castro.discardPile.filter(
      (cardId) => cardId === COST_CONTRACT_CARD.id,
    ).length,
    1,
  );

  const duplicate = resolveChoice(result.state, "up", {
    expectedToken: game.card.resolutionToken,
    story: COST_CONTRACT_STORY,
  });
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "feedback-pending");
  assert.equal(duplicate.state.resources.crew, 0);
  assert.equal(duplicate.state.decisionCount, result.state.decisionCount);
});

test("feedback merges actual cost and effect deltas while sanity remains an effect", () => {
  let game = stateOnCard(
    "castro",
    COST_CONTRACT_CARD.id,
    { eldritchLore: 2 },
    COST_CONTRACT_STORY,
  );
  let result = resolve(
    game.state,
    game.card,
    "down",
    COST_CONTRACT_STORY,
  );
  assert.equal(result.state.resources.eldritchLore, 1);
  assert.deepEqual(result.changes, { eldritchLore: -1 });
  assert.deepEqual(result.state.pendingFeedback.changes, {
    eldritchLore: -1,
  });

  game = stateOnCard(
    "castro",
    COST_CONTRACT_CARD.id,
    { sanity: 1 },
    COST_CONTRACT_STORY,
  );
  assert.equal(
    getDirectionAvailability(game.state, game.card, "left").available,
    true,
  );
  result = resolve(
    game.state,
    game.card,
    "left",
    COST_CONTRACT_STORY,
  );
  assert.equal(result.state.resources.sanity, 0);
  assert.equal(result.state.status, "lost");
  assert.deepEqual(result.changes, { sanity: -1 });
  assert.deepEqual(result.state.pendingFeedback.changes, { sanity: -1 });
});

test("up at Castro resolves locally and draws another Castro card only after Continue", () => {
  const game = enterCastro(5);
  const rngBefore = game.state.rngState;
  const result = resolve(game.state, game.card, "up");

  assert.equal(result.state.currentDeckId, "castro");
  assert.equal(result.state.currentCardId, null);
  assert.equal(result.card, null);
  assert.equal(result.state.rngState, rngBefore);
  assert.ok(result.state.pendingFeedback);

  const next = acknowledge(result);
  assert.equal(next.state.currentDeckId, "castro");
  assert.ok(next.card);
  assert.notEqual(next.card.id, game.card.id);
});

test("down advances, up retreats, and left/right remain within the active chapter", () => {
  let game = enterCastro(6);
  let result = resolve(game.state, game.card, "down");
  assert.equal(result.state.currentDeckId, "investigate-church");
  game = acknowledge(result);

  result = resolve(game.state, game.card, "down");
  assert.equal(result.state.currentDeckId, "gather-crew");
  game = acknowledge(result);

  result = resolve(game.state, game.card, "up");
  assert.equal(result.state.currentDeckId, "investigate-church");
  game = acknowledge(result);

  for (const direction of ["left", "right"]) {
    result = resolve(game.state, game.card, direction);
    assert.equal(result.state.currentDeckId, "investigate-church");
    game = acknowledge(result);
  }
});

test("a vertical destination with entryEffect null renders immediately without feedback or mutations", () => {
  const game = stateOnCard(
    "source",
    NO_EFFECT_SOURCE_CARD.id,
    {},
    NO_EFFECT_ENTRY_STORY,
  );
  game.state.unlockedCardIds = ["destination-card"];
  const resourcesBefore = structuredClone(game.state.resources);
  const unlockedBefore = structuredClone(game.state.unlockedCardIds);

  const result = resolve(
    game.state,
    game.card,
    "down",
    NO_EFFECT_ENTRY_STORY,
  );

  assert.equal(result.ignored, false);
  assert.equal(result.state.currentDeckId, "destination");
  assert.equal(result.card.id, NO_EFFECT_DESTINATION_CARD.id);
  assert.equal(result.card.entryEffect, null);
  assert.equal(result.state.pendingFeedback, null);
  assert.equal(result.resultText, "");
  assert.deepEqual(result.changes, {});
  assert.deepEqual(result.state.resources, resourcesBefore);
  assert.deepEqual(result.state.unlockedCardIds, unlockedBefore);
});

test("resolution discards in the source deck and preserves destination draw state until Continue", () => {
  const game = enterCastro(7);
  const sourceCardId = game.card.id;
  const destinationBefore = structuredClone(
    game.state.drawStateByDeck["investigate-church"],
  );
  const result = resolve(game.state, game.card, "down");

  assert.equal(
    result.state.drawStateByDeck.castro.discardPile.includes(sourceCardId),
    true,
  );
  assert.deepEqual(
    result.state.drawStateByDeck["investigate-church"],
    destinationBefore,
  );
  assert.equal(result.state.currentCardId, null);
  assert.equal(getNextCard(result.state).card, null);

  const next = acknowledge(result);
  assert.ok(next.card);
  assert.notDeepEqual(
    next.state.drawStateByDeck["investigate-church"],
    destinationBefore,
  );
});

test("draw state survives leaving a chapter and returning", () => {
  let game = enterCastro(8);
  let result = resolve(game.state, game.card, "down");
  game = acknowledge(result);
  const churchAfterFirstDraw = structuredClone(
    game.state.drawStateByDeck["investigate-church"],
  );

  result = resolve(game.state, game.card, "down");
  game = acknowledge(result);
  result = resolve(game.state, game.card, "up");
  game = acknowledge(result);

  assert.equal(game.state.currentDeckId, "investigate-church");
  assert.equal(
    game.state.drawStateByDeck["investigate-church"].drawPile.length,
    churchAfterFirstDraw.drawPile.length - 1,
  );
});

test("actual applied Crew and Lore changes are clamped and persisted in feedback", () => {
  const loreCard = deckById.castro.cards.find(
    (card) => card.choices.left?.effects?.eldritchLore > 0,
  );
  let game = stateOnCard("castro", loreCard.id);
  let result = resolve(game.state, game.card, "left");
  assert.equal(result.state.resources.eldritchLore, 1);
  assert.deepEqual(result.state.pendingFeedback.changes, { eldritchLore: 1 });

  const lossCard = deckById.navigate.cards.find(
    (card) => card.choices.left?.effects?.crew < 0,
  );
  game = stateOnCard("navigate", lossCard.id, { crew: 0 });
  result = resolve(game.state, game.card, "left");
  assert.equal(result.state.resources.crew, 0);
  assert.deepEqual(result.changes, {});
  assert.deepEqual(result.state.pendingFeedback.changes, {});
  assert.equal(result.state.status, "playing");
});

test("Crew zero and Lore zero remain playable; only Sanity zero causes loss", () => {
  const neutralCard = deckById.castro.cards[0];
  let game = stateOnCard("castro", neutralCard.id, {
    eldritchLore: 0,
    crew: 0,
    sanity: 2,
  });
  let result = resolve(game.state, game.card, "up");
  assert.equal(result.state.status, "playing");

  const sanityCard = deckById.castro.cards.find(
    (card) => card.choices.right?.effects?.sanity < 0,
  );
  game = stateOnCard("castro", sanityCard.id, { sanity: 1 });
  result = resolve(game.state, game.card, "right");
  assert.equal(result.state.resources.sanity, 0);
  assert.equal(result.state.status, "lost");
  assert.equal(result.state.pendingFeedback.changes.sanity, -1);
  assert.equal(result.card, null);

  const terminal = acknowledge(result);
  assert.equal(terminal.state.status, "lost");
  assert.equal(terminal.state.pendingFeedback, null);
  assert.equal(terminal.card, null);
});

test("pending feedback blocks decisions, survives normalization, and dismisses once", () => {
  const game = enterCastro(9);
  const result = resolve(game.state, game.card, "left");
  const serialized = JSON.parse(JSON.stringify(result.state));
  const reloaded = normalizeState(serialized, {
    decks: DEEP_SOUTH_STORY.decks,
  });
  assert.deepEqual(reloaded.pendingFeedback, result.state.pendingFeedback);
  assert.equal(reloaded.currentCardId, null);

  const blocked = resolveChoice(reloaded, "right");
  assert.equal(blocked.ignored, true);
  assert.equal(blocked.reason, "feedback-pending");

  const dismissed = dismissChoiceFeedback(reloaded, {
    expectedFeedbackId: reloaded.pendingFeedback.id,
  });
  assert.equal(dismissed.ignored, false);
  assert.ok(dismissed.card);

  const duplicate = dismissChoiceFeedback(dismissed.state);
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "no-feedback");
});

test("stale feedback and stale decision tokens cannot mutate a run", () => {
  const game = enterCastro(10);
  const stale = resolveChoice(game.state, "left", {
    expectedToken: "stale-token",
  });
  assert.equal(stale.ignored, true);
  assert.deepEqual(stale.state, game.state);

  const result = resolve(game.state, game.card, "left");
  const staleDismissal = dismissChoiceFeedback(result.state, {
    expectedFeedbackId: "stale-feedback",
  });
  assert.equal(staleDismissal.ignored, true);
  assert.deepEqual(staleDismissal.state, result.state);
});

test("normalization repairs a self-equal replay token before resolution", () => {
  const card = deckById.castro.cards[0];
  const active = stateOnCard("castro", card.id);
  const loaded = normalizeState(
    {
      ...active.state,
      lastResolvedToken: active.state.currentCardToken,
    },
    { decks: DEEP_SOUTH_STORY.decks },
  );
  const prepared = getNextCard(loaded);
  const result = resolveChoice(prepared.state, "up", {
    expectedToken: prepared.card.resolutionToken,
  });

  assert.equal(loaded.lastResolvedToken, null);
  assert.equal(result.ignored, false);
  assert.ok(result.state.pendingFeedback);
});

test("Begin Again is available only after loss and resets every run field", () => {
  const active = enterCastro(11);
  const ignored = restartGame(active.state, { seed: 99 });
  assert.equal(ignored.ignored, true);

  const lostState = {
    ...active.state,
    status: "lost",
    introCardFace: "reverse",
    discoveries: { fatherDiaryReverse: true },
    resources: { eldritchLore: 7, crew: 0, sanity: 0 },
    currentCardId: null,
    currentCardToken: null,
    pendingFeedback: null,
  };
  const restarted = restartGame(lostState, { seed: 99 });
  assert.equal(restarted.ignored, false);
  assert.equal(restarted.state.currentDeckId, "it-begins-here");
  assert.equal(restarted.state.introCardIndex, 0);
  assert.equal(restarted.state.introSkipPending, false);
  assert.equal(restarted.state.introCardFace, "front");
  assert.deepEqual(restarted.state.discoveries, {
    fatherDiaryReverse: false,
  });
  assert.equal(restarted.state.status, "playing");
  assert.deepEqual(restarted.state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
  assert.equal(restarted.card.id, "intro-fathers-diary");
  assert.equal(restarted.card.title, "My father’s photograph");
});
