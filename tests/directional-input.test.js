import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  planDirection,
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

test("ArrowUp requests and confirms Intro skipping through the real resolver", () => {
  const input = gameBackedHandler(createGame({ seed: 901 }));
  const first = keyboardEvent("ArrowUp");
  assert.equal(input.handler(first), true);
  assert.equal(first.prevented, true);
  assert.equal(input.game.state.introSkipPending, true);
  assert.equal(input.game.card.id, "deep-south-intro-skip-confirmation");

  const second = keyboardEvent("ArrowUp");
  assert.equal(input.handler(second), true);
  assert.equal(second.prevented, true);
  assert.equal(input.game.state.currentDeckId, "castro");
  assert.equal(input.game.state.introSkipPending, false);
  assert.equal(input.commitCount, 2);
});

test("ArrowDown follows the ordinary Intro sequence", () => {
  const input = gameBackedHandler(createGame({ seed: 903 }));
  const event = keyboardEvent("ArrowDown");
  assert.equal(input.handler(event), true);
  assert.equal(event.prevented, true);
  assert.equal(input.game.state.introCardIndex, 1);
  assert.equal(input.game.card.id, "intro-eldritch-lore");
  assert.equal(input.game.state.introSkipPending, false);
  assert.equal(input.commitCount, 1);
});

test("ArrowDown cancels Intro skipping and restores the same revealed face", () => {
  const front = createGame({ seed: 904 });
  const back = resolveChoice(front.state, "left", {
    expectedToken: front.card.resolutionToken,
  });
  const input = gameBackedHandler(back);

  assert.equal(input.handler(keyboardEvent("ArrowUp")), true);
  assert.equal(input.game.state.introSkipPending, true);
  const cancel = keyboardEvent("ArrowDown");
  assert.equal(input.handler(cancel), true);
  assert.equal(cancel.prevented, true);
  assert.equal(input.game.state.introSkipPending, false);
  assert.equal(input.game.card.id, "intro-fathers-diary");
  assert.equal(input.game.card.cardFace, "back");
  assert.equal(input.commitCount, 2);
});

test("ArrowUp is blocked in Castro without scrolling or mutation", () => {
  let game = createGame({ seed: 905 });
  for (let index = 0; index < 8; index += 1) {
    game = resolveChoice(game.state, "down", {
      expectedToken: game.card.resolutionToken,
    });
  }
  assert.equal(game.state.currentDeckId, "castro");
  const input = gameBackedHandler(game);
  const snapshot = structuredClone(input.game.state);
  const event = keyboardEvent("ArrowUp");
  assert.equal(input.handler(event), false);
  assert.equal(event.prevented, true);
  assert.equal(input.commitCount, 0);
  assert.deepEqual(input.blockedDirections, ["up"]);
  assert.deepEqual(input.game.state, snapshot);
});

test("ArrowDown enters the exact planned Castro destination once", () => {
  let game = createGame({ seed: 906 });
  for (let index = 0; index < 8; index += 1) {
    game = resolveChoice(game.state, "down", {
      expectedToken: game.card.resolutionToken,
    });
  }
  assert.equal(game.state.currentDeckId, "castro");
  const plan = planDirection(game.state, game.card, "down");
  assert.equal(plan.available, true);

  const input = gameBackedHandler(game);
  const event = keyboardEvent("ArrowDown");
  assert.equal(input.handler(event), true);
  assert.equal(event.prevented, true);
  assert.equal(input.commitCount, 1);
  assert.equal(input.game.card.id, plan.destinationCardId);
  assert.deepEqual(input.game.changes, plan.effect?.resources ?? {});
});

test("horizontal arrows on a revealed Intro back are blocked without mutation", () => {
  const firstCard = createGame({ seed: 902 });
  const secondCard = resolveChoice(firstCard.state, "left", {
    expectedToken: firstCard.card.resolutionToken,
  });
  assert.equal(secondCard.card.cardFace, "back");
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
  assert.equal(Object.hasOwn(input.game.state, "pendingFeedback"), false);
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
