import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  resolveChoice,
} from "../public/js/game/engine.js";
import { canChooseDirection } from "../public/js/game/choice-availability.js";
import {
  ARROW_DIRECTION_BY_KEY,
  createArrowKeyHandler,
  directionForArrowKey,
} from "../public/js/ui/directional-input.js";

function keyboardEvent(key, overrides = {}) {
  return {
    key,
    target: null,
    defaultPrevented: false,
    repeat: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}

function gameBackedHandler(initialGame) {
  let game = initialGame;
  const blockedDirections = [];
  let commitCount = 0;
  const handler = createArrowKeyHandler({
    isDirectionAvailable: (direction) =>
      canChooseDirection(game.state, game.card, direction),
    onChoose(direction) {
      const result = resolveChoice(game.state, direction, {
        expectedToken: game.card?.resolutionToken,
      });
      assert.equal(result.ignored, false);
      game = result;
      commitCount += 1;
    },
    onBlocked(direction) {
      blockedDirections.push(direction);
    },
  });
  return {
    handler,
    get game() {
      return game;
    },
    get commitCount() {
      return commitCount;
    },
    blockedDirections,
  };
}

test("the keyboard adapter maps exactly the four arrow keys", () => {
  assert.deepEqual(ARROW_DIRECTION_BY_KEY, {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  });
  for (const [key, direction] of Object.entries(ARROW_DIRECTION_BY_KEY)) {
    assert.equal(directionForArrowKey(key), direction);
  }
  for (const key of ["a", "d", "Enter", " ", "Down"]) {
    assert.equal(directionForArrowKey(key), null);
  }
});

test("ArrowDown requests and confirms Intro skipping through the real resolver", () => {
  const input = gameBackedHandler(createGame({ seed: 901 }));
  const first = keyboardEvent("ArrowDown");
  assert.equal(input.handler(first), true);
  assert.equal(first.prevented, true);
  assert.equal(input.game.state.introSkipPending, true);
  assert.equal(input.game.card.id, "deep-south-intro-skip-confirmation");

  const second = keyboardEvent("ArrowDown");
  assert.equal(input.handler(second), true);
  assert.equal(second.prevented, true);
  assert.equal(input.game.state.currentDeckId, "castro");
  assert.equal(input.game.state.introSkipPending, false);
  assert.equal(input.commitCount, 2);
});

test("disabled Intro arrows are consumed without choice, state, or feedback mutation", () => {
  const firstCard = createGame({ seed: 902 });
  const secondCard = resolveChoice(firstCard.state, "up", {
    expectedToken: firstCard.card.resolutionToken,
  });
  assert.equal(secondCard.state.introCardIndex, 1);
  const input = gameBackedHandler(secondCard);
  const before = JSON.parse(JSON.stringify(input.game.state));

  for (const key of ["ArrowLeft", "ArrowRight"]) {
    const event = keyboardEvent(key);
    assert.equal(input.handler(event), false);
    assert.equal(event.prevented, true);
  }

  assert.equal(input.commitCount, 0);
  assert.deepEqual(input.blockedDirections, ["left", "right"]);
  assert.deepEqual(input.game.state, before);
  assert.equal(input.game.state.pendingFeedback, null);
});

test("blocked, repeated, editable, and unrelated key events are ignored", () => {
  let chosen = 0;
  const blockedHandler = createArrowKeyHandler({
    isInputBlocked: () => true,
    onChoose() {
      chosen += 1;
    },
  });
  assert.equal(blockedHandler(keyboardEvent("ArrowDown")), false);

  const handler = createArrowKeyHandler({
    isEditableTarget: (target) => target === "editable",
    onChoose() {
      chosen += 1;
    },
  });
  assert.equal(handler(keyboardEvent("ArrowDown", { repeat: true })), false);
  assert.equal(
    handler(keyboardEvent("ArrowDown", { target: "editable" })),
    false,
  );
  assert.equal(handler(keyboardEvent("Enter")), false);
  assert.equal(chosen, 0);
});
