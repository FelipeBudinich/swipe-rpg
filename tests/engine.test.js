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
import { createInitialState, normalizeState } from "../public/js/game/state.js";

const deckById = Object.fromEntries(
  DEEP_SOUTH_STORY.decks.map((deck) => [deck.id, deck]),
);

function resolve(state, card, direction) {
  return resolveChoice(state, direction, {
    expectedToken: card?.resolutionToken,
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
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.introSkipPending, true);
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.currentDeckId, "castro");
  return game;
}

function stateOnCard(deckId, cardId, resources = {}) {
  const base = createInitialState({
    seed: 71,
    decks: DEEP_SOUTH_STORY.decks,
  });
  const state = {
    ...base,
    currentDeckId: deckId,
    currentCardId: cardId,
    currentCardToken: `0:${deckId}:${cardId}`,
    resources: { ...base.resources, ...resources },
  };
  return { state, card: getCurrentCard(state) };
}

test("a fresh run starts on the first sequential Intro card with exact resources", () => {
  const { state, card } = createGame({ seed: 1 });
  assert.equal(state.storyId, "deep-south");
  assert.equal(state.status, "playing");
  assert.equal(state.currentDeckId, "it-begins-here");
  assert.equal(state.introCardIndex, 0);
  assert.equal(card.id, "intro-salt-stiff-packet");
  assert.deepEqual(state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
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

test("Intro skip requires two left swipes and cancel returns to the same card", () => {
  let game = createGame({ seed: 3 });
  game = resolve(game.state, game.card, "up");
  const originalCardId = game.card.id;
  const originalIndex = game.state.introCardIndex;

  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.introSkipPending, true);
  assert.equal(game.card.id, "deep-south-intro-skip-confirmation");
  assert.match(game.card.text, /Swipe left again to skip to Castro/u);

  game = resolve(game.state, game.card, "up");
  assert.equal(game.state.introSkipPending, false);
  assert.equal(game.state.introCardIndex, originalIndex);
  assert.equal(game.card.id, originalCardId);

  game = resolve(game.state, game.card, "left");
  game = resolve(game.state, game.card, "left");
  assert.equal(game.state.currentDeckId, "castro");
  assert.ok(game.card);
});

test("right and down are inert throughout the Intro", () => {
  const game = createGame({ seed: 4 });
  for (const direction of ["right", "down"]) {
    const result = resolve(game.state, game.card, direction);
    assert.equal(result.ignored, true);
    assert.equal(result.reason, "intro-direction-ignored");
    assert.deepEqual(result.state, game.state);
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

test("down advances, up retreats, and left/right remain within the active Plot Step", () => {
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

test("draw state survives leaving a Plot Step and returning", () => {
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
    (card) => card.choices.left.effects.eldritchLore > 0,
  );
  let game = stateOnCard("castro", loreCard.id);
  let result = resolve(game.state, game.card, "left");
  assert.equal(result.state.resources.eldritchLore, 1);
  assert.deepEqual(result.state.pendingFeedback.changes, { eldritchLore: 1 });

  const lossCard = deckById.navigate.cards.find(
    (card) => card.choices.left.effects.crew < 0,
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
    (card) => card.choices.right.effects.sanity < 0,
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

test("Begin Again is available only after loss and resets every run field", () => {
  const active = enterCastro(11);
  const ignored = restartGame(active.state, { seed: 99 });
  assert.equal(ignored.ignored, true);

  const lostState = {
    ...active.state,
    status: "lost",
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
  assert.equal(restarted.state.status, "playing");
  assert.deepEqual(restarted.state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
  assert.equal(restarted.card.id, "intro-salt-stiff-packet");
});
