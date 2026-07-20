import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEP_SOUTH_CARD_BY_ID,
  DEEP_SOUTH_DECK_BY_ID,
  DEEP_SOUTH_STORY,
} from "../public/js/data/deep-south.js";
import {
  createGame,
  getNextCard,
  planDirection,
  resolveChoice,
  restartGame,
} from "../public/js/game/engine.js";
import { normalizeState } from "../public/js/game/state.js";

function resolve(game, direction) {
  return resolveChoice(game.state, direction, {
    expectedToken: game.card?.resolutionToken,
  });
}

function enterCastro(seed = 1) {
  let game = createGame({ seed });
  for (let index = 0; index < 8; index += 1) {
    game = resolve(game, "up");
    assert.equal(game.ignored, false);
  }
  assert.equal(game.state.currentDeckId, "castro");
  return game;
}

function forceCard(game, cardId, {
  drawPile,
  resources,
  revealed = false,
} = {}) {
  const authored = DEEP_SOUTH_CARD_BY_ID[cardId];
  assert.ok(authored, cardId);
  const deck = DEEP_SOUTH_DECK_BY_ID[authored.deckId];
  const unlocked = new Set(
    game.state.unlockedCardIdsByDeck[deck.id] ?? [],
  );
  unlocked.add(cardId);
  const authoredUnlocked = deck.cards
    .map((card) => card.id)
    .filter((id) => unlocked.has(id));
  const nextDrawPile = drawPile ?? authoredUnlocked.filter((id) => id !== cardId);
  return getNextCard({
    ...game.state,
    currentDeckId: deck.id,
    currentCardId: cardId,
    currentCardToken: null,
    revealedCardIds: revealed
      ? [...new Set([...game.state.revealedCardIds, cardId])]
      : game.state.revealedCardIds.filter((id) => id !== cardId),
    unlockedCardIdsByDeck: {
      ...game.state.unlockedCardIdsByDeck,
      [deck.id]: authoredUnlocked,
    },
    drawStateByDeck: {
      ...game.state.drawStateByDeck,
      [deck.id]: {
        drawPile: [...nextDrawPile],
        discardPile: [],
        lastResolvedCardId: null,
      },
    },
    ...(resources ? { resources } : {}),
  });
}

test("front Left and Right synthesize one photograph reveal plan", () => {
  const game = createGame({ seed: 10 });
  assert.equal(game.card.id, "intro-fathers-diary");
  assert.equal(game.card.cardFace, "front");
  const left = planDirection(game.state, game.card, "left");
  const right = planDirection(game.state, game.card, "right");
  for (const plan of [left, right]) {
    assert.equal(plan.available, true);
    assert.equal(plan.mode, "flip");
    assert.equal(plan.label, "Turn the photograph over");
    assert.equal(
      plan.detail,
      "Discovery recorded · +1 Eldritch Lore",
    );
    assert.deepEqual(plan.affectedResources, ["eldritchLore"]);
    assert.equal(plan.destinationCardId, game.card.id);
    assert.deepEqual(plan.effect, {
      resources: { eldritchLore: 1 },
      discoveries: ["fatherDiaryReverse"],
    });
  }
  assert.deepEqual(
    { ...left, direction: null },
    { ...right, direction: null },
  );
});

test("either horizontal direction flips the same card and applies its effect once", () => {
  const startLeft = createGame({ seed: 11 });
  const startRight = createGame({ seed: 11 });
  const drawSnapshot = structuredClone(startLeft.state.drawStateByDeck);
  const left = resolve(startLeft, "left");
  const right = resolve(startRight, "right");

  for (const result of [left, right]) {
    assert.equal(result.ignored, false);
    assert.equal(result.card.id, "intro-fathers-diary");
    assert.equal(result.card.cardFace, "back");
    assert.equal(result.card.title, "The map on the reverse");
    assert.equal(result.state.currentDeckId, "it-begins-here");
    assert.equal(result.state.introCardIndex, 0);
    assert.equal(result.state.decisionCount, 0);
    assert.equal(result.state.resources.eldritchLore, 1);
    assert.equal(result.state.discoveries.fatherDiaryReverse, true);
    assert.deepEqual(result.state.revealedCardIds, [
      "intro-fathers-diary",
    ]);
    assert.deepEqual(result.changes, { eldritchLore: 1 });
    assert.deepEqual(result.state.drawStateByDeck, drawSnapshot);
    assert.equal(Object.hasOwn(result.state, "pendingFeedback"), false);
    assert.notEqual(
      result.card.resolutionToken,
      startLeft.card.resolutionToken,
    );
  }

  assert.deepEqual(left.state.resources, right.state.resources);
  assert.deepEqual(left.state.discoveries, right.state.discoveries);
  assert.deepEqual(left.state.revealedCardIds, right.state.revealedCardIds);
  assert.deepEqual(left.state.drawStateByDeck, right.state.drawStateByDeck);
  assert.deepEqual(left.changes, right.changes);
});

test("a revealed back cannot return or replay through any horizontal call", () => {
  let game = resolve(createGame({ seed: 12 }), "left");
  const snapshot = structuredClone(game.state);
  for (const direction of ["left", "right"]) {
    const plan = planDirection(game.state, game.card, direction);
    assert.equal(plan.available, false);
    assert.equal(plan.reason, "card-already-revealed");
    const result = resolve(game, direction);
    assert.equal(result.ignored, true);
    assert.equal(result.reason, "card-already-revealed");
    assert.deepEqual(result.state, snapshot);
    assert.equal(result.card.cardFace, "back");
  }

  const stale = resolveChoice(game.state, "left", {
    expectedToken: "intro:0:intro-fathers-diary:front",
  });
  assert.equal(stale.ignored, true);
  assert.equal(stale.reason, "stale-resolution");
  assert.deepEqual(stale.state, snapshot);
  assert.equal(stale.state.resources.eldritchLore, 1);
});

test("revealed state is reload-safe and revisits keep the back", () => {
  const revealed = resolve(createGame({ seed: 13 }), "right");
  const normalized = normalizeState(
    JSON.parse(JSON.stringify(revealed.state)),
  );
  const restored = getNextCard(normalized);
  assert.equal(restored.card.cardFace, "back");
  assert.equal(restored.state.resources.eldritchLore, 1);
  assert.equal(restored.state.discoveries.fatherDiaryReverse, true);
  assert.equal(
    planDirection(restored.state, restored.card, "left").available,
    false,
  );
  assert.equal(
    planDirection(restored.state, restored.card, "right").available,
    false,
  );
});

test("Intro Up/Down remain immediate and skip cancellation preserves a back", () => {
  let game = resolve(createGame({ seed: 14 }), "left");
  game = resolve(game, "down");
  assert.equal(game.card.id, "deep-south-intro-skip-confirmation");
  assert.equal(game.state.introSkipPending, true);
  assert.equal(planDirection(game.state, game.card, "left").available, false);

  game = resolve(game, "up");
  assert.equal(game.card.id, "intro-fathers-diary");
  assert.equal(game.card.cardFace, "back");
  assert.equal(game.state.resources.eldritchLore, 1);

  game = resolve(game, "up");
  assert.equal(game.card.id, "intro-eldritch-lore");
  assert.equal(game.card.cardFace, "front");
  assert.equal(game.state.resources.eldritchLore, 1);
});

test("plot flips count once, preserve draw state, and use face-aware tokens", () => {
  const game = forceCard(
    enterCastro(21),
    "castro-logbook-under-rain",
  );
  const drawSnapshot = structuredClone(game.state.drawStateByDeck);
  const beforeToken = game.card.resolutionToken;
  const result = resolve(game, "right");
  assert.equal(result.card.id, game.card.id);
  assert.equal(result.card.cardFace, "back");
  assert.equal(result.state.decisionCount, game.state.decisionCount + 1);
  assert.deepEqual(result.state.drawStateByDeck, drawSnapshot);
  assert.notEqual(result.card.resolutionToken, beforeToken);
  assert.match(result.card.resolutionToken, /:back$/u);
  assert.deepEqual(result.changes, {
    eldritchLore: 1,
    sanity: -1,
  });
});

test("revealed plot cards reload and revisit on their back without replay", () => {
  const front = forceCard(
    enterCastro(211),
    "castro-logbook-under-rain",
  );
  const revealed = resolve(front, "left");
  const normalized = normalizeState(
    JSON.parse(JSON.stringify(revealed.state)),
  );
  const restored = getNextCard(normalized);
  assert.equal(restored.card.id, front.card.id);
  assert.equal(restored.card.cardFace, "back");
  assert.deepEqual(restored.state.resources, revealed.state.resources);

  const revisited = forceCard(
    restored,
    front.card.id,
    {
      revealed: true,
      resources: restored.state.resources,
    },
  );
  assert.equal(revisited.card.cardFace, "back");
  const snapshot = structuredClone(revisited.state);
  const blocked = resolve(revisited, "right");
  assert.equal(blocked.ignored, true);
  assert.deepEqual(blocked.state, snapshot);
});

test("unaffordable back effects block both equivalent directions atomically", () => {
  const game = forceCard(
    enterCastro(22),
    "gather-crew-captain-without-a-ship",
    {
      resources: { eldritchLore: 0, crew: 0, sanity: 3 },
    },
  );
  const snapshot = structuredClone(game.state);
  for (const direction of ["left", "right"]) {
    const plan = planDirection(game.state, game.card, direction);
    assert.equal(plan.available, false);
    assert.equal(plan.reason, "insufficient-resources");
    assert.equal(plan.requirementText, "Requires 1 Eldritch Lore.");
    const result = resolve(game, direction);
    assert.equal(result.ignored, true);
    assert.deepEqual(result.state, snapshot);
  }
});

test("vertical planning is pure and commit enters the exact previewed card", () => {
  const game = forceCard(
    enterCastro(23),
    "castro-logbook-under-rain",
    {
      drawPile: [
        "castro-empty-berths",
        "castro-marks-on-the-pilings",
        "castro-bell-inside-the-fog",
      ],
    },
  );
  const snapshot = structuredClone(game.state);
  const first = planDirection(game.state, game.card, "down");
  const second = planDirection(game.state, game.card, "down");
  assert.deepEqual(first, second);
  assert.deepEqual(game.state, snapshot);
  assert.equal(first.mode, "navigate");
  assert.equal(first.destinationCardId, "castro-empty-berths");
  assert.equal(first.detail, "+1 Crew");
  assert.deepEqual(first.affectedResources, ["crew"]);

  const result = resolve(game, "down");
  assert.equal(result.ignored, false);
  assert.equal(result.card.id, first.destinationCardId);
  assert.equal(result.card.cardFace, "front");
  assert.equal(
    result.state.resources.crew,
    game.state.resources.crew + 1,
  );
  assert.deepEqual(result.changes, { crew: 1 });
  assert.deepEqual(result.state.drawStateByDeck, first.nextDrawState);
  assert.equal(result.state.rngState, first.nextRngState);
  assert.equal(result.state.decisionCount, game.state.decisionCount + 1);
  assert.equal(Object.hasOwn(result.state, "pendingFeedback"), false);
});

test("null entry effects keep routes available and render destinations immediately", () => {
  const game = forceCard(
    enterCastro(24),
    "castro-logbook-under-rain",
    {
      drawPile: [
        "castro-marks-on-the-pilings",
        "castro-empty-berths",
      ],
    },
  );
  const plan = planDirection(game.state, game.card, "down");
  assert.equal(plan.available, true);
  assert.equal(plan.destinationCardId, "castro-marks-on-the-pilings");
  assert.equal(plan.effect, null);
  assert.equal(plan.detail, "");
  assert.deepEqual(plan.affectedResources, []);

  const result = resolve(game, "down");
  assert.equal(result.card.id, plan.destinationCardId);
  assert.deepEqual(result.changes, {});
  assert.deepEqual(result.addedCardsByDeck, {});
});

test("Up selects the previous chapter and Castro Up is unavailable", () => {
  const castro = enterCastro(25);
  const blocked = planDirection(castro.state, castro.card, "up");
  assert.equal(blocked.available, false);
  assert.equal(blocked.reason, "no-previous-chapter");
  assert.equal(resolve(castro, "up").ignored, true);

  const church = forceCard(
    castro,
    "investigate-church-hymn-below-hearing",
  );
  const plan = planDirection(church.state, church.card, "up");
  assert.equal(plan.available, true);
  assert.equal(plan.destinationDeckId, "castro");
  const result = resolve(church, "up");
  assert.equal(result.state.currentDeckId, "castro");
  assert.equal(result.card.id, plan.destinationCardId);
});

test("Down exhausts the current cycle before advancing chapters", () => {
  const game = forceCard(
    enterCastro(26),
    "castro-logbook-under-rain",
    {
      drawPile: ["castro-empty-berths"],
    },
  );
  const inChapter = planDirection(game.state, game.card, "down");
  assert.equal(inChapter.destinationDeckId, "castro");
  const next = resolve(game, "down");
  assert.equal(next.state.currentDeckId, "castro");

  const exhausted = forceCard(next, "castro-empty-berths", {
    drawPile: [],
  });
  const advance = planDirection(
    exhausted.state,
    exhausted.card,
    "down",
  );
  assert.equal(advance.destinationDeckId, "investigate-church");
  const advanced = resolve(exhausted, "down");
  assert.equal(advanced.state.currentDeckId, "investigate-church");
  assert.equal(advanced.card.id, advance.destinationCardId);
});

test("final-chapter Down refills deterministically without an immediate repeat", () => {
  const currentId = "gather-evidence-crew-testimony";
  const alternativeId = "gather-evidence-warm-stone-sample";
  let game = forceCard(
    enterCastro(261),
    currentId,
    { drawPile: [] },
  );
  game = getNextCard({
    ...game.state,
    drawStateByDeck: {
      ...game.state.drawStateByDeck,
      "gather-evidence": {
        drawPile: [],
        discardPile: [alternativeId],
        lastResolvedCardId: alternativeId,
      },
    },
  });
  const first = planDirection(game.state, game.card, "down");
  const second = planDirection(game.state, game.card, "down");
  assert.deepEqual(first, second);
  assert.equal(first.destinationDeckId, "gather-evidence");
  assert.equal(first.destinationCardId, alternativeId);
  assert.notEqual(first.destinationCardId, currentId);
  const result = resolve(game, "down");
  assert.equal(result.card.id, first.destinationCardId);
});

test("a card-addition back unlocks once without changing its active count", () => {
  const game = forceCard(
    enterCastro(27),
    "castro-marks-on-the-pilings",
  );
  const unlockedId = "investigate-church-crypt-behind-the-vestry";
  assert.equal(
    game.state.unlockedCardIdsByDeck["investigate-church"].includes(
      unlockedId,
    ),
    false,
  );
  const drawSnapshot = structuredClone(game.state.drawStateByDeck);
  const result = resolve(game, "left");
  assert.deepEqual(result.addedCardsByDeck, {
    "investigate-church": [unlockedId],
  });
  assert.equal(
    result.state.unlockedCardIdsByDeck["investigate-church"].includes(
      unlockedId,
    ),
    true,
  );
  assert.deepEqual(result.state.drawStateByDeck.castro, drawSnapshot.castro);

  const repeated = resolve(result, "right");
  assert.equal(repeated.ignored, true);
  assert.deepEqual(repeated.state, result.state);
});

test("a lethal reveal shows its applied back before terminal", () => {
  const front = forceCard(
    enterCastro(28),
    "castro-logbook-under-rain",
    {
      resources: { eldritchLore: 0, crew: 0, sanity: 1 },
    },
  );
  const lethal = resolve(front, "left");
  assert.equal(lethal.state.status, "lost");
  assert.equal(lethal.state.terminalPending, true);
  assert.equal(lethal.card.id, front.card.id);
  assert.equal(lethal.card.cardFace, "back");
  assert.equal(
    planDirection(lethal.state, lethal.card, "left").available,
    false,
  );
  assert.equal(
    planDirection(lethal.state, lethal.card, "up").mode,
    "terminal",
  );

  const terminal = resolve(lethal, "up");
  assert.equal(terminal.ignored, false);
  assert.equal(terminal.state.status, "lost");
  assert.equal(terminal.state.terminalPending, false);
  assert.equal(terminal.card, null);
});

test("a lethal entry effect shows the planned destination before terminal", () => {
  let game = forceCard(
    enterCastro(281),
    "gather-evidence-rubbing-that-continues",
  );
  game = resolve(game, "left");
  const destinationId = "gather-evidence-map-redraws-itself";
  assert.equal(
    game.state.unlockedCardIdsByDeck["gather-evidence"].includes(
      destinationId,
    ),
    true,
  );
  game = getNextCard({
    ...game.state,
    resources: { ...game.state.resources, sanity: 1 },
    drawStateByDeck: {
      ...game.state.drawStateByDeck,
      "gather-evidence": {
        ...game.state.drawStateByDeck["gather-evidence"],
        drawPile: [destinationId],
      },
    },
  });
  const plan = planDirection(game.state, game.card, "down");
  assert.equal(plan.destinationCardId, destinationId);
  assert.equal(plan.detail, "-1 Sanity");
  const lethal = resolve(game, "down");
  assert.equal(lethal.state.status, "lost");
  assert.equal(lethal.state.terminalPending, true);
  assert.equal(lethal.card.id, destinationId);
  assert.equal(lethal.card.cardFace, "front");
  assert.deepEqual(lethal.changes, { sanity: -1 });
  assert.equal(Object.hasOwn(lethal.state, "pendingFeedback"), false);
});

test("restart clears generic reveals, discoveries, and dynamic unlocks", () => {
  let game = forceCard(
    enterCastro(29),
    "castro-marks-on-the-pilings",
  );
  game = resolve(game, "left");
  game = {
    ...game,
    state: {
      ...game.state,
      status: "lost",
      terminalPending: false,
      resources: { ...game.state.resources, sanity: 0 },
    },
  };
  const restarted = restartGame(game.state, { seed: 30 });
  assert.equal(restarted.ignored, false);
  assert.equal(restarted.card.id, "intro-fathers-diary");
  assert.equal(restarted.card.cardFace, "front");
  assert.deepEqual(restarted.state.revealedCardIds, []);
  assert.equal(restarted.state.discoveries.fatherDiaryReverse, false);
  assert.equal(
    restarted.state.unlockedCardIdsByDeck[
      "investigate-church"
    ].includes("investigate-church-crypt-behind-the-vestry"),
    false,
  );
});
