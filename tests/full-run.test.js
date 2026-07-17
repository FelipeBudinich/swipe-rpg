import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  dismissChoiceFeedback,
  restartGame,
  resolveChoice,
} from "../public/js/game/engine.js";
import { canChooseDirection } from "../public/js/game/choice-availability.js";
import { normalizeState } from "../public/js/game/state.js";
import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import { deriveDeckHud } from "../public/js/ui/render.js";
import { simulateRun } from "../scripts/audit-runs.mjs";

function commit(game, direction) {
  const result = resolveChoice(game.state, direction, {
    expectedToken: game.card?.resolutionToken,
  });
  assert.equal(result.ignored, false);
  return result;
}

function continueOutcome(result) {
  assert.ok(result.state.pendingFeedback);
  const next = dismissChoiceFeedback(result.state, {
    expectedFeedbackId: result.state.pendingFeedback.id,
  });
  assert.equal(next.ignored, false);
  return next;
}

function availableDirection(game, preferredDirections) {
  return preferredDirections.find((direction) =>
    canChooseDirection(game.state, game.card, direction));
}

test("representative Deep South run covers Intro, skip confirmation, both plot directions, loss feedback, reload, and restart", () => {
  let game = createGame({ seed: 2 });
  const firstIntroId = game.card.id;

  game = commit(game, "up");
  assert.equal(game.state.introCardIndex, 1);
  game = commit(game, "down");
  assert.equal(game.state.introSkipPending, true);
  const heldIntroIndex = game.state.introCardIndex;
  game = commit(game, "up");
  assert.equal(game.state.introSkipPending, false);
  assert.equal(game.state.introCardIndex, heldIntroIndex);
  game = commit(game, "down");
  game = commit(game, "down");
  assert.equal(game.state.currentDeckId, "castro");

  const visited = [game.state.currentDeckId];
  while (game.state.currentDeckId !== "gather-evidence") {
    game = continueOutcome(commit(game, "down"));
    visited.push(game.state.currentDeckId);
  }
  assert.deepEqual(
    visited,
    DEEP_SOUTH_STORY.decks.filter(({ type }) => type === "plot").map(({ id }) => id),
  );

  game = continueOutcome(commit(game, "up"));
  assert.equal(game.state.currentDeckId, "explore-rlyeh");

  let lossResult = null;
  for (let safety = 0; safety < 10 && !lossResult; safety += 1) {
    const damagingDirection = ["up", "down", "left", "right"].find(
      (direction) =>
        canChooseDirection(game.state, game.card, direction) &&
        Number(game.card.choices?.[direction]?.effects?.sanity) < 0,
    );
    const direction =
      damagingDirection ??
      availableDirection(game, ["left", "right", "down", "up"]);
    assert.ok(direction, "representative run reached a card with no action");
    const result = commit(game, direction);
    if (result.state.status === "lost") {
      lossResult = result;
    } else {
      game = continueOutcome(result);
    }
  }
  assert.ok(lossResult);
  assert.equal(lossResult.state.resources.sanity, 0);
  assert.ok(lossResult.state.pendingFeedback);
  assert.equal(lossResult.state.pendingFeedback.changes.sanity, -1);

  const reloaded = normalizeState(
    JSON.parse(JSON.stringify(lossResult.state)),
    { decks: DEEP_SOUTH_STORY.decks },
  );
  assert.equal(reloaded.status, "lost");
  assert.deepEqual(reloaded.pendingFeedback, lossResult.state.pendingFeedback);

  const terminal = dismissChoiceFeedback(reloaded, {
    expectedFeedbackId: reloaded.pendingFeedback.id,
  });
  assert.equal(terminal.state.status, "lost");
  assert.equal(terminal.card, null);

  const restarted = restartGame(terminal.state, { seed: 2026 });
  assert.equal(restarted.state.currentDeckId, "it-begins-here");
  assert.equal(restarted.card.id, firstIntroId);
  assert.deepEqual(restarted.state.resources, {
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
});

test("a fixed seed produces the same card, feedback, destination, and resource transcript", () => {
  const simulate = (seed) => {
    let game = createGame({ seed });
    game = commit(game, "down");
    game = commit(game, "down");
    const transcript = [];
    const directions = ["down", "left", "right", "up"];
    for (let index = 0; index < 12 && game.state.status === "playing"; index += 1) {
      const preferred = directions[index % directions.length];
      const direction = availableDirection(game, [
        preferred,
        ...directions.filter((candidate) => candidate !== preferred),
      ]);
      assert.ok(direction, "deterministic run reached a card with no action");
      const sourceCardId = game.card.id;
      const result = commit(game, direction);
      transcript.push({
        sourceCardId,
        direction,
        destinationDeckId: result.state.currentDeckId,
        resources: result.state.resources,
        feedback: result.state.pendingFeedback,
        rngState: result.state.rngState,
      });
      if (result.state.status === "lost") break;
      game = continueOutcome(result);
    }
    return transcript;
  };

  assert.deepEqual(simulate(404), simulate(404));
  assert.notDeepEqual(simulate(404), simulate(405));
});

test("chapter card counts hold through feedback and survive leaving, returning, and reload", () => {
  let game = createGame({ seed: 707 });
  game = commit(game, "down");
  game = commit(game, "down");
  assert.equal(
    deriveDeckHud(game.state, DEEP_SOUTH_STORY).deckLabel,
    "Castro, Chapter 1 - 5 cards left in deck",
  );

  const southbound = commit(game, "down");
  assert.equal(southbound.state.currentDeckId, "investigate-church");
  assert.equal(southbound.state.currentCardId, null);
  assert.equal(
    deriveDeckHud(southbound.state, DEEP_SOUTH_STORY).deckLabel,
    "Castro, Chapter 1 - 5 cards left in deck",
  );
  const reloadedFeedback = normalizeState(
    JSON.parse(JSON.stringify(southbound.state)),
    { decks: DEEP_SOUTH_STORY.decks },
  );
  assert.equal(
    deriveDeckHud(reloadedFeedback, DEEP_SOUTH_STORY).deckLabel,
    "Castro, Chapter 1 - 5 cards left in deck",
  );

  game = continueOutcome(southbound);
  assert.equal(
    deriveDeckHud(game.state, DEEP_SOUTH_STORY).deckLabel,
    "Investigate Church, Chapter 2 - 5 cards left in deck",
  );

  const northbound = commit(game, "up");
  assert.equal(
    deriveDeckHud(northbound.state, DEEP_SOUTH_STORY).deckLabel,
    "Investigate Church, Chapter 2 - 5 cards left in deck",
  );
  game = continueOutcome(northbound);
  assert.equal(
    deriveDeckHud(game.state, DEEP_SOUTH_STORY).deckLabel,
    "Castro, Chapter 1 - 4 cards left in deck",
  );

  const reloaded = normalizeState(JSON.parse(JSON.stringify(game.state)), {
    decks: DEEP_SOUTH_STORY.decks,
  });
  assert.equal(
    deriveDeckHud(reloaded, DEEP_SOUTH_STORY).deckLabel,
    "Castro, Chapter 1 - 4 cards left in deck",
  );
});

test("the final unresolved chapter card reports one before the next cycle resets to five", () => {
  let game = createGame({ seed: 808 });
  game = commit(game, "down");
  game = commit(game, "down");

  for (let expected = 5; expected >= 1; expected -= 1) {
    const grammar = expected === 1 ? "card" : "cards";
    const label = `Castro, Chapter 1 - ${expected} ${grammar} left in deck`;
    assert.equal(deriveDeckHud(game.state, DEEP_SOUTH_STORY).deckLabel, label);

    const result = commit(game, "up");
    assert.equal(
      deriveDeckHud(result.state, DEEP_SOUTH_STORY).deckLabel,
      label,
    );
    game = continueOutcome(result);
  }

  assert.equal(
    deriveDeckHud(game.state, DEEP_SOUTH_STORY).deckLabel,
    "Castro, Chapter 1 - 5 cards left in deck",
  );
});

test("the deterministic audit acknowledges outcomes without counting them as decisions", () => {
  const first = simulateRun(2, 96);
  const second = simulateRun(2, 96);
  assert.equal(first.stallReason, null);
  assert.deepEqual(first.transcript, second.transcript);
  assert.ok(first.transcript.some(({ type }) => type === "feedback"));
  assert.ok(first.transcript.some(({ type }) => type === "decision"));
  assert.deepEqual(first.visitedDeckIds, DEEP_SOUTH_STORY.decks.map(({ id }) => id));
  assert.equal(first.state.status, "lost");
  assert.equal(first.state.pendingFeedback, null);
});
