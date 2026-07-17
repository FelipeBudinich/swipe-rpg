import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createFeedbackController } from "../public/js/ui/feedback.js";

async function feedbackHarness(run) {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const hadDocument = Object.hasOwn(globalThis, "document");
  let nextTimer = 0;

  const createSection = () => {
    let changedWrites = 0;
    const dataset = new Proxy({}, {
      set(target, property, value) {
        if (property === "changed") changedWrites += 1;
        target[property] = value;
        return true;
      },
    });
    return {
      dataset,
      offsetWidth: 0,
      closest() {
        return this;
      },
      get changedWrites() {
        return changedWrites;
      },
    };
  };

  const sections = {
    hp: createSection(),
    mp: createSection(),
    xp: createSection(),
    gold: createSection(),
  };
  const deltas = Object.fromEntries(
    ["hp", "mp", "xp"].map((resource) => [
      `hud-${resource}-delta`,
      { dataset: {}, textContent: "" },
    ]),
  );
  let resultText = "";
  const resultWrites = [];
  const resultElement = {
    dataset: {},
    get textContent() {
      return resultText;
    },
    set textContent(value) {
      resultText = String(value ?? "");
      resultWrites.push(resultText);
    },
  };

  globalThis.document = {
    getElementById(id) {
      return deltas[id] ?? null;
    },
  };
  globalThis.setTimeout = (callback, delay = 0) => {
    nextTimer += 1;
    if (delay === 0) queueMicrotask(callback);
    return nextTimer;
  };
  globalThis.clearTimeout = () => {};

  try {
    const controller = createFeedbackController({
      resultElement,
      resourceElements: sections,
    });
    await run({ controller, deltas, resultElement, resultWrites, sections });
  } finally {
    if (hadDocument) globalThis.document = originalDocument;
    else delete globalThis.document;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test("level-only feedback pulses the combined progression section without a fake XP delta", async () => {
  await feedbackHarness(({ controller, deltas, sections }) => {
    controller.pulseChanges({ level: 1, xp: 0 });
    assert.equal(sections.xp.dataset.changed, "gain");
    assert.equal(sections.xp.changedWrites, 1);
    assert.equal(deltas["hud-xp-delta"].textContent, "");
    assert.equal(deltas["hud-xp-delta"].dataset.visible, undefined);
  });
});

test("simultaneous level and XP gains use one combined pulse and preserve the signed XP delta", async () => {
  await feedbackHarness(({ controller, deltas, sections }) => {
    controller.pulseChanges({ level: 1, xp: 5 });
    assert.equal(sections.xp.dataset.changed, "gain");
    assert.equal(sections.xp.changedWrites, 1);
    assert.equal(deltas["hud-xp-delta"].textContent, "+5");
    assert.equal(deltas["hud-xp-delta"].dataset.visible, "true");
  });
});

test("HP, MP, and XP feedback keeps signed deltas in their matching sections", async () => {
  await feedbackHarness(({ controller, deltas, sections }) => {
    controller.pulseChanges({ hp: -3, mp: 2, xp: 4 });
    assert.equal(sections.hp.dataset.changed, "loss");
    assert.equal(sections.mp.dataset.changed, "gain");
    assert.equal(sections.xp.dataset.changed, "gain");
    assert.equal(deltas["hud-hp-delta"].textContent, "-3");
    assert.equal(deltas["hud-mp-delta"].textContent, "+2");
    assert.equal(deltas["hud-xp-delta"].textContent, "+4");
  });
});

test("hidden announcements are independent of resource pulses and repeat identical messages", async () => {
  await feedbackHarness(async ({
    controller,
    resultElement,
    resultWrites,
    sections,
  }) => {
    controller.pulseChanges({ hp: -2 });
    assert.equal(resultElement.textContent, "");
    assert.equal(sections.hp.dataset.changed, "loss");

    controller.announce("The blow lands.");
    await Promise.resolve();
    await Promise.resolve();
    controller.announce("The blow lands.");
    await Promise.resolve();
    await Promise.resolve();

    const announcements = resultWrites
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value === "The blow lands.");
    assert.equal(announcements.length, 2);
    assert.ok(
      resultWrites
        .slice(announcements[0].index + 1, announcements[1].index)
        .includes(""),
    );
    assert.equal(resultElement.textContent, "The blow lands.");
  });
});

test("transient feedback combines a hidden announcement with one resource pulse", async () => {
  await feedbackHarness(async ({ controller, resultElement, sections }) => {
    controller.showTransient("You recover.", { hp: 4 }, "recovery");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(resultElement.textContent, "You recover.");
    assert.equal(sections.hp.dataset.changed, "gain");
    assert.equal(resultElement.dataset.kind, undefined);
  });
});

test("feedback controller has no timed visible-result behavior", async () => {
  const source = await readFile(new URL("../public/js/ui/feedback.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /resultTimer|dataset\.kind|2200/);
});

test("main wires feedback directly to the three combined resource sections", async () => {
  const source = await readFile(new URL("../public/js/main.js", import.meta.url), "utf8");
  assert.match(source, /hp: document\.getElementById\("hp-hud"\)/);
  assert.match(source, /mp: document\.getElementById\("mp-hud"\)/);
  assert.match(source, /xp: document\.getElementById\("level-xp-hud"\)/);
  assert.doesNotMatch(source, /document\.getElementById\("level-hud"\)/);
  assert.doesNotMatch(source, /document\.getElementById\("hud-level"\)/);
});
