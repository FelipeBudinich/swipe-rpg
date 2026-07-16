import assert from "node:assert/strict";
import test from "node:test";

import { createSwipeController } from "../public/js/ui/swipe-controller.js";

class FakeCard extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.offsetWidth = 320;
    this.values = new Map();
    this.style = {
      setProperty: (name, value) => this.values.set(name, value),
      removeProperty: (name) => this.values.delete(name),
    };
  }

  getBoundingClientRect() {
    return { width: 320 };
  }
}

test("commit start locks surrounding controls before the exit animation resolves", async (t) => {
  const priorMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  t.after(() => {
    if (priorMatchMedia) globalThis.matchMedia = priorMatchMedia;
    else delete globalThis.matchMedia;
  });

  const card = new FakeCard();
  const events = [];
  let controller;
  controller = createSwipeController({
    card,
    onCommitStart() {
      events.push(["start", controller.isCommitting]);
    },
    async onCommit() {
      events.push(["resolve", controller.isCommitting]);
      controller.resetForNextCard();
    },
  });

  assert.equal(await controller.commit("right"), true);
  assert.deepEqual(events, [["start", true], ["resolve", true]]);
  assert.equal(controller.isCommitting, false);
  assert.equal(card.dataset.swipeState, "idle");
});
