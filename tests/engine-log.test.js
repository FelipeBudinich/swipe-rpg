import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEP_SOUTH_CARD_BY_ID,
  DEEP_SOUTH_DECK_BY_ID,
  DEEP_SOUTH_STORY,
} from "../public/js/data/deep-south.js";
import { formatCardEffect } from "../public/js/game/card-effects.js";
import {
  createGame,
  getNextCard,
  planDirection,
  resolveChoice,
  restartGame,
  restartRun,
} from "../public/js/game/engine.js";

function resolve(game, direction, expectedToken = game.card?.resolutionToken) {
  return resolveChoice(game.state, direction, { expectedToken });
}

function forceCard(game, cardId) {
  const card = DEEP_SOUTH_CARD_BY_ID[cardId];
  const deck = DEEP_SOUTH_DECK_BY_ID[card.deckId];
  const unlocked = new Set(game.state.unlockedCardIdsByDeck[deck.id] ?? []);
  unlocked.add(cardId);
  const orderedUnlocked = deck.cards
    .map(({ id }) => id)
    .filter((id) => unlocked.has(id));
  return getNextCard({
    ...game.state,
    currentDeckId: deck.id,
    currentCardId: cardId,
    currentCardToken: null,
    lastResolvedToken: null,
    effectLog: [],
    revealedCardIds: game.state.revealedCardIds.filter((id) => id !== cardId),
    unlockedCardIdsByDeck: {
      ...game.state.unlockedCardIdsByDeck,
      [deck.id]: orderedUnlocked,
    },
    drawStateByDeck: {
      ...game.state.drawStateByDeck,
      [deck.id]: {
        drawPile: orderedUnlocked.filter((id) => id !== cardId),
        discardPile: [],
        lastResolvedCardId: null,
      },
    },
  });
}

test("a reveal logs its exact committed effect once", () => {
  const start = createGame({ seed: 801 });
  const sourceToken = start.card.resolutionToken;
  const revealed = resolve(start, "left");
  assert.equal(revealed.state.effectLog.length, 1);
  assert.deepEqual(revealed.state.effectLog[0], {
    id: `effect:reveal:${sourceToken}`,
    kind: "reveal",
    cardId: "intro-fathers-diary",
    direction: "left",
    effect: {
      resources: { eldritchLore: 1 },
      discoveries: ["fatherDiaryReverse"],
    },
  });
  assert.equal(
    formatCardEffect(revealed.state.effectLog[0].effect, DEEP_SOUTH_STORY),
    "Discovery recorded · +1 Eldritch Lore",
  );

  const stale = resolve(revealed, "left", sourceToken);
  assert.equal(stale.ignored, true);
  assert.deepEqual(stale.state.effectLog, revealed.state.effectLog);
});

test("a plot card-addition reveal stores the filtered canonical addition", () => {
  let game = createGame({ seed: 802 });
  game = resolve(game, "up");
  game = resolve(game, "up");
  game = forceCard(game, "castro-marks-on-the-pilings");
  const plan = planDirection(game.state, game.card, "right");
  const revealed = resolve(game, "right");
  assert.equal(revealed.state.effectLog.length, 1);
  assert.deepEqual(revealed.state.effectLog[0].effect, plan.effect);
  assert.match(
    formatCardEffect(revealed.state.effectLog[0].effect, DEEP_SOUTH_STORY),
    /Adds 1 card to Chapter 2, Investigate Church/u,
  );
});

test("destination entry effects belong to the destination and null entries do not log", () => {
  let game = createGame({ seed: 803 });
  game = resolve(game, "down");
  assert.equal(game.state.effectLog.length, 0);

  for (let index = 1; index < 7; index += 1) game = resolve(game, "down");
  assert.equal(game.state.introCardIndex, 7);
  const castro = DEEP_SOUTH_DECK_BY_ID.castro;
  const emptyBerths = "castro-empty-berths";
  game = getNextCard({
    ...game.state,
    drawStateByDeck: {
      ...game.state.drawStateByDeck,
      castro: {
        drawPile: [
          emptyBerths,
          ...castro.cards
            .map(({ id }) => id)
            .filter((id) => id !== emptyBerths &&
              game.state.unlockedCardIdsByDeck.castro.includes(id)),
        ],
        discardPile: [],
        lastResolvedCardId: null,
      },
    },
  });
  const sourceToken = game.card.resolutionToken;
  const plan = planDirection(game.state, game.card, "down");
  assert.equal(plan.destinationCardId, emptyBerths);
  assert.deepEqual(plan.effect, { resources: { crew: 1 } });
  const entered = resolve(game, "down");
  assert.equal(entered.state.effectLog.length, 1);
  assert.deepEqual(entered.state.effectLog[0], {
    id: `effect:entry:${sourceToken}`,
    kind: "entry",
    cardId: emptyBerths,
    direction: "down",
    effect: { resources: { crew: 1 } },
  });
});

test("skip controls, blocked directions, and terminal acknowledgement do not append", () => {
  let game = createGame({ seed: 804 });
  const blocked = resolve(game, "right", "stale-token");
  assert.equal(blocked.ignored, true);
  assert.deepEqual(blocked.state.effectLog, []);

  game = resolve(game, "up");
  assert.equal(game.state.introSkipPending, true);
  assert.deepEqual(game.state.effectLog, []);
  game = resolve(game, "down");
  assert.equal(game.state.introSkipPending, false);
  assert.deepEqual(game.state.effectLog, []);
});

test("restartRun works while active and restartGame remains lost-only", () => {
  const revealed = resolve(createGame({ seed: 805 }), "left");
  const activeRejected = restartGame(revealed.state, { seed: 900 });
  assert.equal(activeRejected.ignored, true);
  assert.equal(activeRejected.reason, "run-active");

  const restarted = restartRun(revealed.state, { seed: 900 });
  assert.equal(restarted.ignored, false);
  assert.deepEqual(restarted.state.effectLog, []);
  assert.equal(restarted.state.runSeed, 900);
  assert.equal(restarted.card.id, "intro-fathers-diary");
});
