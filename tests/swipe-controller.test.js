import assert from "node:assert/strict";
import test from "node:test";

import * as Engine from "../public/js/game/engine.js";
import {
  isActiveCommitResolutionBlocked,
  isNewInputBlocked,
} from "../public/js/ui/interaction-lock.js";
import { createSwipeController } from "../public/js/ui/swipe-controller.js";

class FakeCard extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.offsetWidth = 320;
    this.values = new Map();
    this.hidden = false;
    this.inert = false;
    this.capturedPointers = new Set();
    this.style = {
      setProperty: (name, value) => this.values.set(name, value),
      removeProperty: (name) => this.values.delete(name),
      getPropertyValue: (name) => this.values.get(name) ?? "",
    };
  }

  getBoundingClientRect() {
    return { width: 320 };
  }

  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }
}

function useReducedMotion(t, matches = true) {
  const priorMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches });
  t.after(() => {
    if (priorMatchMedia) globalThis.matchMedia = priorMatchMedia;
    else delete globalThis.matchMedia;
  });
}

function pointerEvent(type, properties) {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

test("commit start locks surrounding controls while active resolution remains allowed", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  const events = [];
  let inputLocked = false;
  let controller;
  const lockState = () => ({
    inputLocked,
    controllerCommitting: controller?.isCommitting === true,
  });
  controller = createSwipeController({
    card,
    isInputLocked: () => isNewInputBlocked(lockState()),
    onCommitStart() {
      events.push(["start", controller.isCommitting]);
    },
    async onCommit() {
      events.push(["resolve", controller.isCommitting]);
      assert.equal(isNewInputBlocked(lockState()), true);
      assert.equal(isActiveCommitResolutionBlocked(lockState()), false);
      inputLocked = true;
      try {
        return true;
      } finally {
        inputLocked = false;
        controller.resetForNextCard();
        card.dataset.swipeState = "entering";
      }
    },
  });

  assert.equal(await controller.commit("right"), true);
  assert.deepEqual(events, [["start", true], ["resolve", true]]);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "entering");
  assert.equal(card.values.size, 0);
});

test("defensive fallback unlocks and recenters a callback that forgot to reset", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  const previews = [];
  let commitCount = 0;
  let controller;
  controller = createSwipeController({
    card,
    onPreview(direction, strength) {
      previews.push([direction, strength]);
    },
    async onCommit() {
      commitCount += 1;
      assert.equal(controller.isCommitting, true);
      return true;
    },
  });

  assert.equal(await controller.commit("left"), true);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
  assert.equal(card.dataset.previewDirection, "none");
  assert.equal(card.values.size, 0);
  assert.deepEqual(previews.at(-1), [null, 0]);

  assert.equal(await controller.commit("right"), true);
  assert.equal(commitCount, 2);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.values.size, 0);
});

test("rapid duplicate commits resolve only the first choice", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  let commitCount = 0;
  let releaseCommit;
  let reportStarted;
  const started = new Promise((resolve) => {
    reportStarted = resolve;
  });
  const heldCommit = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  const controller = createSwipeController({
    card,
    async onCommit() {
      commitCount += 1;
      reportStarted();
      await heldCommit;
      return true;
    },
  });

  const first = controller.commit("left");
  await started;
  assert.equal(controller.isCommitting, true);
  assert.equal(await controller.commit("right"), false);
  assert.equal(commitCount, 1);
  releaseCommit();
  assert.equal(await first, true);
  assert.equal(controller.isCommitting, false);
});

test("disabled choices never invoke the resolution callback", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  let commitCount = 0;
  const blocked = [];
  const controller = createSwipeController({
    card,
    canCommit: (direction) => direction !== "left",
    onBlocked: (direction) => blocked.push(direction),
    onCommit: async () => {
      commitCount += 1;
      return true;
    },
  });

  assert.equal(await controller.commit("left"), false);
  assert.equal(commitCount, 0);
  assert.deepEqual(blocked, ["left"]);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
});

test("ignored resolution returns false, unlocks, and clears off-screen transforms", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  const controller = createSwipeController({
    card,
    onCommit: async () => false,
  });

  assert.equal(await controller.commit("right"), false);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
  assert.equal(card.dataset.previewDirection, "none");
  assert.equal(card.style.getPropertyValue("--card-x"), "");
  assert.equal(card.style.getPropertyValue("--card-y"), "");
  assert.equal(card.style.getPropertyValue("--card-rotation"), "");
});

test("an engine-stale token follows the accepted commit cleanup path", async (t) => {
  useReducedMotion(t);

  const game = Engine.createGame({ seed: 45 });
  const card = new FakeCard();
  let inputLocked = false;
  let state = game.state;
  let currentCard = game.card;
  let ignoredReason = null;
  let controller;
  controller = createSwipeController({
    card,
    async onCommit(direction) {
      inputLocked = true;
      try {
        const resolution = Engine.resolveChoice(state, direction, undefined, {
          expectedToken: "stale:opening-card",
        });
        ignoredReason = resolution.reason;
        if (resolution.ignored) return false;
        state = resolution.state;
        currentCard = resolution.card;
        return true;
      } finally {
        inputLocked = false;
        controller.resetForNextCard();
      }
    },
  });

  assert.equal(await controller.commit("left"), false);
  assert.equal(ignoredReason, "stale-resolution");
  assert.equal(state.decisionCount, 0);
  assert.equal(currentCard.id, "opening-hearthvale-oath");
  assert.equal(inputLocked, false);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
  assert.equal(card.values.size, 0);
});

test("callback exceptions report the error, unlock, and recenter", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  const expected = new Error("resolution failed");
  const errors = [];
  const controller = createSwipeController({
    card,
    onCommit: async () => {
      throw expected;
    },
    onError: (error) => errors.push(error),
  });

  assert.equal(await controller.commit("left"), false);
  assert.deepEqual(errors, [expected]);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
  assert.equal(card.values.size, 0);
});

test("destroying during an active callback clears the committed presentation", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  let reportStarted;
  let releaseCommit;
  const started = new Promise((resolve) => {
    reportStarted = resolve;
  });
  const heldCommit = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  const controller = createSwipeController({
    card,
    async onCommit() {
      reportStarted();
      await heldCommit;
      return true;
    },
  });

  const pending = controller.commit("right");
  await started;
  assert.equal(card.dataset.swipeState, "committing");
  controller.destroy();
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
  assert.equal(card.values.size, 0);
  releaseCommit();
  assert.equal(await pending, false);
});

test("normal motion resolves on the transform transition without changing sequencing", async (t) => {
  useReducedMotion(t, false);

  const card = new FakeCard();
  const states = [];
  let controller;
  controller = createSwipeController({
    card,
    onCommitStart() {
      states.push(["start", controller.isCommitting, card.dataset.swipeState]);
    },
    async onCommit() {
      states.push(["resolve", controller.isCommitting, card.dataset.swipeState]);
      controller.resetForNextCard();
      return true;
    },
  });

  const pending = controller.commit("left");
  const transitionEnd = new Event("transitionend");
  Object.defineProperty(transitionEnd, "propertyName", {
    configurable: true,
    value: "transform",
  });
  card.dispatchEvent(transitionEnd);

  assert.equal(await pending, true);
  assert.deepEqual(states, [
    ["start", true, undefined],
    ["resolve", true, "committing"],
  ]);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
});

test("pointer release below threshold recenters and beyond threshold commits once", async (t) => {
  useReducedMotion(t);

  const card = new FakeCard();
  let commitCount = 0;
  let resolveCommitted;
  const committed = new Promise((resolve) => {
    resolveCommitted = resolve;
  });
  let controller;
  controller = createSwipeController({
    card,
    async onCommit() {
      commitCount += 1;
      controller.resetForNextCard();
      resolveCommitted();
      return true;
    },
  });

  card.dispatchEvent(pointerEvent("pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100,
    timeStamp: 0,
  }));
  card.dispatchEvent(pointerEvent("pointerup", {
    pointerId: 1,
    clientX: 130,
    clientY: 100,
    timeStamp: 100,
  }));
  await Promise.resolve();
  assert.equal(commitCount, 0);
  assert.equal(card.dataset.swipeState, "idle");

  card.dispatchEvent(pointerEvent("pointerdown", {
    pointerId: 2,
    button: 0,
    clientX: 100,
    clientY: 100,
    timeStamp: 200,
  }));
  card.dispatchEvent(pointerEvent("pointerup", {
    pointerId: 2,
    clientX: 250,
    clientY: 100,
    timeStamp: 400,
  }));
  await committed;
  assert.equal(commitCount, 1);
  assert.equal(controller.isCommitting, false);
});

test("fixed-seed UI commit coordination advances three cards exactly once each", async (t) => {
  useReducedMotion(t);

  const game = Engine.createGame({ seed: 44 });
  const card = new FakeCard();
  let state = game.state;
  let currentCard = game.card;
  let inputLocked = false;
  let resolutionCount = 0;
  let controller;
  const firstToken = currentCard.resolutionToken;
  const firstCardId = currentCard.id;
  const lockState = () => ({
    inputLocked,
    controllerCommitting: controller?.isCommitting === true,
    drawerPaused: false,
    storyTransitionActive: false,
    terminalActive: false,
    feedbackActive: Boolean(state.pendingChoiceFeedback),
    confirmationOpen: false,
  });
  const dismissFeedback = () => {
    const feedback = state.pendingChoiceFeedback;
    assert.ok(feedback);
    const before = {
      decisionCount: state.decisionCount,
      worldCardsResolved: state.story.totalWorldCardsResolved,
      rngState: state.rngState,
      cardId: state.currentCardId,
      cardToken: state.currentCardToken,
    };
    const dismissed = Engine.dismissChoiceFeedback(state, {
      expectedFeedbackId: feedback.id,
    });
    assert.equal(dismissed.ignored, false);
    state = dismissed.state;
    currentCard = dismissed.card;
    assert.equal(state.pendingChoiceFeedback, null);
    assert.equal(state.decisionCount, before.decisionCount);
    assert.equal(state.story.totalWorldCardsResolved, before.worldCardsResolved);
    assert.equal(state.rngState, before.rngState);
    assert.equal(state.currentCardId, before.cardId);
    assert.equal(state.currentCardToken, before.cardToken);
    assert.equal(currentCard?.resolutionToken, before.cardToken);
    card.dataset.cardId = currentCard?.id ?? "special-surface";
    card.hidden = !currentCard;
    card.inert = !currentCard;
  };

  assert.equal(firstCardId, "opening-hearthvale-oath");
  card.dataset.cardId = firstCardId;
  controller = createSwipeController({
    card,
    isInputLocked: () => isNewInputBlocked(lockState()),
    canCommit: (direction) => currentCard?.[direction]?.disabled !== true,
    async onCommit(direction) {
      assert.equal(controller.isCommitting, true);
      assert.equal(isNewInputBlocked(lockState()), true);
      if (isActiveCommitResolutionBlocked(lockState())) return false;

      inputLocked = true;
      try {
        const resolution = Engine.resolveChoice(state, direction, undefined, {
          expectedToken: currentCard.resolutionToken,
        });
        resolutionCount += 1;
        if (resolution.ignored) return false;
        state = resolution.state;
        currentCard = resolution.card;
        card.dataset.cardId = currentCard?.id ?? "special-surface";
        card.hidden = Boolean(state.pendingChoiceFeedback) || !currentCard;
        card.inert = Boolean(state.pendingChoiceFeedback) || !currentCard;
        return true;
      } finally {
        inputLocked = false;
        controller.resetForNextCard();
        card.dataset.swipeState = "entering";
      }
    },
  });

  assert.equal(await controller.commit("left"), true);
  assert.equal(state.decisionCount, 1);
  assert.equal(state.story.totalWorldCardsResolved, 1);
  assert.notEqual(state.currentCardToken, firstToken);
  assert.notEqual(currentCard?.id, firstCardId);
  assert.ok(state.pendingChoiceFeedback);
  assert.equal(card.hidden, true);
  assert.equal(card.inert, true);
  assert.equal(card.dataset.swipeState, "entering");
  assert.equal(controller.isCommitting, false);

  assert.equal(await controller.commit("right"), false);
  assert.equal(resolutionCount, 1);
  dismissFeedback();
  assert.equal(card.hidden, false);
  assert.equal(card.inert, false);

  const stale = Engine.resolveChoice(state, "left", undefined, {
    expectedToken: firstToken,
  });
  assert.equal(stale.ignored, true);
  assert.equal(stale.reason, "stale-resolution");
  assert.equal(stale.state.decisionCount, 1);

  assert.equal(await controller.commit("right"), true);
  assert.ok(state.pendingChoiceFeedback);
  dismissFeedback();
  assert.equal(await controller.commit("left"), true);
  assert.ok(state.pendingChoiceFeedback);
  dismissFeedback();
  assert.equal(resolutionCount, 3);
  assert.equal(state.decisionCount, 3);
  assert.equal(state.story.totalWorldCardsResolved, 3);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.values.size, 0);
});
