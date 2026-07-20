import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEP_SOUTH_DECK_IDS,
} from "../public/js/data/deep-south.js";
import {
  createGame,
  planDirection,
  resolveChoice,
} from "../public/js/game/engine.js";
import {
  auditSeeds,
  simulateRun,
} from "../scripts/audit-runs.mjs";

function resolve(game, direction) {
  return resolveChoice(game.state, direction, {
    expectedToken: game.card?.resolutionToken,
  });
}

test("a complete Intro reaches Castro with no acknowledgement surface", () => {
  let game = createGame({ seed: 501 });
  for (let index = 0; index < 8; index += 1) {
    const plan = planDirection(game.state, game.card, "down");
    assert.equal(plan.available, true);
    const destination = plan.destinationCardId;
    game = resolve(game, "down");
    assert.equal(game.ignored, false);
    assert.equal(game.card.id, destination);
    assert.equal(Object.hasOwn(game.state, "pendingFeedback"), false);
  }
  assert.equal(game.state.currentDeckId, "castro");
  assert.equal(game.card.cardFace, "front");
});

test("successful horizontal then vertical plot swipes always return a card", () => {
  let game = createGame({ seed: 502 });
  for (let index = 0; index < 8; index += 1) game = resolve(game, "down");

  const reveal = planDirection(game.state, game.card, "left");
  if (reveal.available) {
    game = resolve(game, "left");
    assert.equal(game.card.cardFace, "back");
    assert.equal(Object.hasOwn(game.state, "pendingFeedback"), false);
  }
  const navigation = planDirection(game.state, game.card, "up");
  assert.equal(navigation.available, true);
  game = resolve(game, "up");
  assert.equal(game.ignored, false);
  assert.ok(game.card);
  assert.equal(game.card.id, navigation.destinationCardId);
  assert.equal(Object.hasOwn(game.state, "pendingFeedback"), false);
});

test("audit transcripts are deterministic, outcome-free, and unstalled", () => {
  const first = simulateRun(2);
  const second = simulateRun(2);
  assert.deepEqual(first.transcript, second.transcript);
  assert.equal(first.stallReason, null);
  assert.deepEqual(first.visitedDeckIds, DEEP_SOUTH_DECK_IDS);
  assert.ok(first.transcript.some(({ type }) => type === "flip"));
  assert.ok(first.transcript.some(({ type }) => type === "navigate"));
  assert.equal(
    first.transcript.some(({ type }) => type === "feedback"),
    false,
  );
  assert.equal(
    first.transcript.some(
      (entry) => Object.hasOwn(entry, "pendingFeedback"),
    ),
    false,
  );
});

test("a representative seed audit has no stalls or missing cards", () => {
  const audit = auditSeeds(64);
  assert.equal(audit.stalled.length, 0);
  for (const run of audit.runs) {
    assert.equal(run.stallReason, null);
    if (run.state.status === "playing" || run.state.terminalPending) {
      assert.ok(run.card);
    }
  }
});
