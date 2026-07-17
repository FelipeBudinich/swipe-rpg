import assert from "node:assert/strict";
import test from "node:test";

import { createSwipeController } from "../public/js/ui/swipe-controller.js";

class FakeCard extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.offsetWidth = 320;
    this.offsetHeight = 360;
    this.values = new Map();
    this.capturedPointers = new Set();
    this.style = {
      setProperty: (name, value) => this.values.set(name, value),
      removeProperty: (name) => this.values.delete(name),
      getPropertyValue: (name) => this.values.get(name) ?? "",
    };
  }

  getBoundingClientRect() {
    return { width: 320, height: 360 };
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

function pointerEvent(type, properties) {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

function installBrowserStubs(t, { reducedMotion = true } = {}) {
  const priorMatchMedia = globalThis.matchMedia;
  const priorRaf = globalThis.requestAnimationFrame;
  const priorCancelRaf = globalThis.cancelAnimationFrame;
  const priorInnerWidth = globalThis.innerWidth;
  const priorInnerHeight = globalThis.innerHeight;
  globalThis.matchMedia = () => ({ matches: reducedMotion });
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  t.after(() => {
    if (priorMatchMedia) globalThis.matchMedia = priorMatchMedia;
    else delete globalThis.matchMedia;
    if (priorRaf) globalThis.requestAnimationFrame = priorRaf;
    else delete globalThis.requestAnimationFrame;
    if (priorCancelRaf) globalThis.cancelAnimationFrame = priorCancelRaf;
    else delete globalThis.cancelAnimationFrame;
    if (priorInnerWidth === undefined) delete globalThis.innerWidth;
    else globalThis.innerWidth = priorInnerWidth;
    if (priorInnerHeight === undefined) delete globalThis.innerHeight;
    else globalThis.innerHeight = priorInnerHeight;
  });
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("programmatic commits accept all four directions and animate along the matching axis", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const observed = [];
  const controller = createSwipeController({
    card,
    async onCommit(direction) {
      observed.push({
        direction,
        x: card.style.getPropertyValue("--card-x"),
        y: card.style.getPropertyValue("--card-y"),
        preview: card.dataset.previewDirection,
      });
      return true;
    },
  });

  for (const direction of ["up", "down", "left", "right"]) {
    assert.equal(await controller.commit(direction), true);
  }

  assert.deepEqual(
    observed.map(({ direction, preview }) => [direction, preview]),
    [
      ["up", "up"],
      ["down", "down"],
      ["left", "left"],
      ["right", "right"],
    ],
  );
  assert.equal(observed[0].x, "0px");
  assert.match(observed[0].y, /^-/);
  assert.equal(observed[1].x, "0px");
  assert.doesNotMatch(observed[1].y, /^-/);
  assert.match(observed[2].x, /^-/);
  assert.equal(observed[2].y, "-12px");
  assert.doesNotMatch(observed[3].x, /^-/);
  assert.equal(card.dataset.swipeState, "idle");
  assert.equal(card.values.size, 0);
});

test("unsupported directions never invoke resolution", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  let calls = 0;
  const controller = createSwipeController({
    card,
    onCommit: async () => {
      calls += 1;
      return true;
    },
  });
  assert.equal(await controller.commit("diagonal"), false);
  assert.equal(await controller.commit(null), false);
  assert.equal(calls, 0);
});

test("vertical drag previews up and commits after the preserved distance threshold", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const previews = [];
  const commits = [];
  createSwipeController({
    card,
    onPreview: (direction, strength) => previews.push([direction, strength]),
    onCommit: async (direction) => {
      commits.push(direction);
      return true;
    },
  });

  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 7,
      button: 0,
      clientX: 160,
      clientY: 250,
      timeStamp: 0,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointermove", {
      pointerId: 7,
      clientX: 164,
      clientY: 130,
      timeStamp: 220,
    }),
  );
  assert.equal(card.dataset.previewDirection, "up");
  assert.equal(card.style.getPropertyValue("--choice-up-opacity") !== "0", true);
  card.dispatchEvent(
    pointerEvent("pointerup", {
      pointerId: 7,
      clientX: 164,
      clientY: 130,
      timeStamp: 240,
    }),
  );
  await settle();
  assert.deepEqual(commits, ["up"]);
  assert.deepEqual(previews.at(-1), [null, 0]);
});

test("vertical drag previews down and commits a deliberate flick", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const commits = [];
  createSwipeController({
    card,
    onCommit: async (direction) => {
      commits.push(direction);
      return true;
    },
  });

  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 9,
      button: 0,
      clientX: 150,
      clientY: 120,
      timeStamp: 0,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointermove", {
      pointerId: 9,
      clientX: 149,
      clientY: 160,
      timeStamp: 35,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointerup", {
      pointerId: 9,
      clientX: 149,
      clientY: 160,
      timeStamp: 40,
    }),
  );
  await settle();
  assert.deepEqual(commits, ["down"]);
});

test("dominant axis determines diagonal swipe direction", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const commits = [];
  createSwipeController({
    card,
    onCommit: async (direction) => {
      commits.push(direction);
      return true;
    },
  });

  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 2,
      button: 0,
      clientX: 200,
      clientY: 250,
      timeStamp: 0,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointermove", {
      pointerId: 2,
      clientX: 105,
      clientY: 205,
      timeStamp: 180,
    }),
  );
  assert.equal(card.dataset.previewDirection, "left");
  card.dispatchEvent(
    pointerEvent("pointerup", {
      pointerId: 2,
      clientX: 105,
      clientY: 205,
      timeStamp: 200,
    }),
  );
  await settle();
  assert.deepEqual(commits, ["left"]);
});

test("short slow drags return to center without committing", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const commits = [];
  createSwipeController({
    card,
    onCommit: async (direction) => {
      commits.push(direction);
      return true;
    },
  });

  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
      timeStamp: 0,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointermove", {
      pointerId: 1,
      clientX: 118,
      clientY: 111,
      timeStamp: 300,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointerup", {
      pointerId: 1,
      clientX: 118,
      clientY: 111,
      timeStamp: 340,
    }),
  );
  await settle();
  assert.deepEqual(commits, []);
  assert.equal(card.dataset.previewDirection, "none");
  assert.equal(card.style.getPropertyValue("--card-x"), "");
  assert.equal(card.style.getPropertyValue("--card-y"), "");
});

test("blocked choices recenter and report their exact direction", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const blocked = [];
  let commits = 0;
  const controller = createSwipeController({
    card,
    canCommit: (direction) => direction !== "right",
    onBlocked: (direction) => blocked.push(direction),
    onCommit: async () => {
      commits += 1;
      return true;
    },
  });
  assert.equal(await controller.commit("right"), false);
  assert.deepEqual(blocked, ["right"]);
  assert.equal(commits, 0);
  assert.equal(card.dataset.swipeState, "idle");
});

test("dragging toward an unavailable Intro direction shows no false preview", (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  const previews = [];
  createSwipeController({
    card,
    canCommit: (direction) => direction === "up" || direction === "left",
    onPreview: (direction, strength) => previews.push([direction, strength]),
    onCommit: async () => true,
  });
  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 6,
      button: 0,
      clientX: 100,
      clientY: 100,
      timeStamp: 0,
    }),
  );
  card.dispatchEvent(
    pointerEvent("pointermove", {
      pointerId: 6,
      clientX: 100,
      clientY: 180,
      timeStamp: 200,
    }),
  );
  assert.equal(card.dataset.previewDirection, "none");
  assert.deepEqual(previews.at(-1), [null, 0]);
  assert.equal(card.style.getPropertyValue("--choice-down-opacity"), "0");
});

test("input locks prevent pointer starts and direct commits", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  let locked = true;
  let commits = 0;
  const controller = createSwipeController({
    card,
    isInputLocked: () => locked,
    onCommit: async () => {
      commits += 1;
      return true;
    },
  });
  assert.equal(await controller.commit("up"), false);
  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 4,
      button: 0,
      clientX: 100,
      clientY: 100,
      timeStamp: 0,
    }),
  );
  assert.notEqual(card.dataset.swipeState, "dragging");
  locked = false;
  assert.equal(await controller.commit("up"), true);
  assert.equal(commits, 1);
});

test("duplicate commits are ignored until the active resolution finishes", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  let resolveHeld;
  let reportStarted;
  const started = new Promise((resolve) => {
    reportStarted = resolve;
  });
  const held = new Promise((resolve) => {
    resolveHeld = resolve;
  });
  let commits = 0;
  const controller = createSwipeController({
    card,
    async onCommit() {
      commits += 1;
      reportStarted();
      await held;
      return true;
    },
  });

  const first = controller.commit("down");
  await started;
  assert.equal(controller.isCommitting, true);
  assert.equal(await controller.commit("left"), false);
  assert.equal(commits, 1);
  resolveHeld();
  assert.equal(await first, true);
  assert.equal(controller.isCommitting, false);
});

test("a commit callback can reset for the next card without losing its entry state", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  let controller;
  controller = createSwipeController({
    card,
    async onCommit() {
      controller.resetForNextCard();
      card.dataset.swipeState = "entering";
      return true;
    },
  });
  assert.equal(await controller.commit("right"), true);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "entering");
  assert.equal(card.values.size, 0);
});

test("destroy removes pointer handlers and cancels active presentation state", async (t) => {
  installBrowserStubs(t);
  const card = new FakeCard();
  let commits = 0;
  const controller = createSwipeController({
    card,
    onCommit: async () => {
      commits += 1;
      return true;
    },
  });
  controller.destroy();
  assert.equal(await controller.commit("left"), false);
  card.dispatchEvent(
    pointerEvent("pointerdown", {
      pointerId: 5,
      button: 0,
      clientX: 100,
      clientY: 100,
      timeStamp: 0,
    }),
  );
  assert.equal(commits, 0);
  assert.notEqual(card.dataset.swipeState, "dragging");
});
