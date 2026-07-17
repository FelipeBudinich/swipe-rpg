import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIRECTIONS,
  FEEDBACK_ART_BY_TONE,
  affectedResources,
  cardAnnouncement,
  choiceDetail,
  choiceForDirection,
  deriveDeckHud,
  deriveFeedbackPresentation,
  deriveLossPresentation,
  resolveArtSource,
} from "../public/js/ui/render.js";

const story = {
  id: "deep-south",
  title: "Deep South",
  decks: [
    { id: "it-begins-here", title: "It begins here", type: "intro" },
    { id: "castro", title: "Castro", type: "plot", plotStep: 1 },
    {
      id: "investigate-church",
      title: "Investigate Church",
      type: "plot",
      plotStep: 2,
    },
    { id: "gather-crew", title: "Gather Crew", type: "plot", plotStep: 3 },
    { id: "navigate", title: "Navigate", type: "plot", plotStep: 4 },
    {
      id: "rest-at-desolate-beach",
      title: "Rest at desolate beach",
      type: "plot",
      plotStep: 5,
    },
    {
      id: "reach-the-coordinates",
      title: "Reach the coordinates",
      type: "plot",
      plotStep: 6,
    },
    {
      id: "explore-rlyeh",
      title: "Explore R'lyeh",
      type: "plot",
      plotStep: 7,
    },
    {
      id: "gather-evidence",
      title: "Gather Evidence",
      type: "plot",
      plotStep: 8,
    },
  ],
};

const plotCard = {
  id: "castro-bells",
  title: "Bells in the fog",
  text: "A bell sounds beneath the tide.",
  choices: {
    up: {
      label: "Return to the quay",
      result: "You retrace the wet timbers.",
      effects: { eldritchLore: 0, crew: 0, sanity: 0 },
    },
    down: {
      label: "Follow the sound",
      result: "The fog closes around you.",
      effects: { eldritchLore: 1, crew: 0, sanity: -1 },
    },
    left: {
      label: "Question the boatman",
      result: "He names a vanished vessel.",
      effects: { eldritchLore: 1, crew: 0, sanity: 0 },
    },
    right: {
      label: "Inspect the pilings",
      result: "Salt fills the carved marks.",
      effects: { eldritchLore: 0, crew: 1, sanity: 0 },
    },
  },
};

test("deck HUD derives intro and numbered plot labels from the canonical story", () => {
  assert.deepEqual(deriveDeckHud({ currentDeckId: "it-begins-here" }, story), {
    storyTitle: "Deep South",
    deck: story.decks[0],
    deckLabel: "Intro — It begins here",
    isIntro: true,
  });
  assert.deepEqual(
    deriveDeckHud({ currentDeckId: "navigate" }, story).deckLabel,
    "Plot Step 4 of 8 — Navigate",
  );
  assert.deepEqual(
    deriveDeckHud({ currentDeckId: "gather-evidence" }, story).deckLabel,
    "Plot Step 8 of 8 — Gather Evidence",
  );
});

test("intro exposes only up and left, including persisted skip confirmation copy", () => {
  const normal = { currentDeckId: "it-begins-here", introSkipPending: false };
  const confirmation = {
    currentDeckId: "it-begins-here",
    introSkipPending: true,
  };
  assert.equal(choiceForDirection(normal, {}, "up").label, "Continue reading");
  assert.equal(choiceForDirection(normal, {}, "left").label, "Skip introduction");
  assert.equal(choiceForDirection(normal, {}, "right"), null);
  assert.equal(choiceForDirection(normal, {}, "down"), null);
  assert.equal(choiceForDirection(confirmation, {}, "up").label, "Keep reading");
  assert.equal(choiceForDirection(confirmation, {}, "left").label, "Skip to Castro");
});

test("plot cards expose all four authored directional choices", () => {
  const state = { currentDeckId: "castro" };
  assert.deepEqual(
    DIRECTIONS.map((direction) => choiceForDirection(state, plotCard, direction)?.label),
    [
      "Return to the quay",
      "Follow the sound",
      "Question the boatman",
      "Inspect the pilings",
    ],
  );
});

test("choice detail and preview detection use only Deep South resources", () => {
  const choice = plotCard.choices.down;
  assert.deepEqual(affectedResources(choice), ["eldritchLore", "sanity"]);
  assert.equal(choiceDetail(choice), "+1 Eldritch Lore · -1 Sanity");
  assert.deepEqual(
    affectedResources({
      effects: {
        eldritchLore: Number.NaN,
        crew: Number.POSITIVE_INFINITY,
        sanity: 0,
        internalCounter: 99,
      },
    }),
    [],
  );
});

test("card announcements name every available direction and its actual effects", () => {
  const announcement = cardAnnouncement({ currentDeckId: "castro" }, plotCard);
  for (const phrase of [
    "Deep South",
    "Bells in the fog",
    "Up: Return to the quay",
    "Down: Follow the sound. +1 Eldritch Lore · -1 Sanity",
    "Left: Question the boatman",
    "Right: Inspect the pilings",
  ]) {
    assert.match(announcement, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("feedback presentation shows only actual nonzero expedition changes", () => {
  const presentation = deriveFeedbackPresentation({
    id: "feedback:castro-bells:down",
    sourceCardId: "castro-bells",
    sourceCardToken: "1:castro:castro-bells",
    sourceDeckId: "castro",
    direction: "down",
    resultText: "The bell answers from below",
    tone: "damage",
    changes: { eldritchLore: 1, sanity: -1 },
    destinationDeckId: "investigate-church",
  });

  assert.equal(presentation.tone, "damage");
  assert.equal(presentation.title, "The Cost");
  assert.equal(presentation.artId, FEEDBACK_ART_BY_TONE.damage);
  assert.deepEqual(
    presentation.rows.map(({ key, label, value, direction }) => ({
      key,
      label,
      value,
      direction,
    })),
    [
      {
        key: "eldritchLore",
        label: "Eldritch Lore",
        value: "+1 Eldritch Lore",
        direction: "gain",
      },
      {
        key: "sanity",
        label: "Sanity",
        value: "-1 Sanity",
        direction: "loss",
      },
    ],
  );
  assert.match(presentation.announcement, /Eldritch Lore plus 1/);
  assert.match(presentation.announcement, /Sanity minus 1/);
  assert.match(presentation.announcement, /Continue\.$/);
});

test("feedback uses only the persisted allowlisted tone", () => {
  const create = (tone) =>
    deriveFeedbackPresentation({
      id: "feedback:test",
      resultText: "The course changes.",
      tone,
      changes: {},
    });
  assert.equal(create("reward").tone, "reward");
  assert.equal(create("danger").tone, "danger");
  assert.equal(create("injected-class").tone, "neutral");
  assert.equal(
    deriveFeedbackPresentation({ id: "", resultText: "Bad" }),
    null,
  );
  assert.deepEqual(Object.keys(FEEDBACK_ART_BY_TONE), [
    "neutral",
    "reward",
    "damage",
    "danger",
  ]);
});

test("loss presentation is controlled solely by lost status", () => {
  const resources = { eldritchLore: 7, crew: 0, sanity: 0 };
  assert.equal(
    deriveLossPresentation({ status: "playing", resources }),
    null,
  );
  const presentation = deriveLossPresentation({ status: "lost", resources });
  assert.equal(presentation.restartLabel, "Begin Again");
  assert.deepEqual(
    presentation.stats.map(({ label, value }) => [label, value]),
    [
      ["Eldritch Lore", "7"],
      ["Crew", "0"],
      ["Sanity", "0"],
    ],
  );
});

test("art sources accept only fixed-format IDs in the local allowlist", () => {
  const allowed = new Set([
    "deep-south-castro",
    "deep-south-it-begins-here",
  ]);
  assert.equal(
    resolveArtSource("deep-south-castro", allowed),
    "/assets/art/deep-south-castro.svg",
  );
  assert.equal(
    resolveArtSource("../../server", allowed),
    "/assets/art/deep-south-it-begins-here.svg",
  );
  assert.equal(
    resolveArtSource("https://example.com/tracker", allowed),
    "/assets/art/deep-south-it-begins-here.svg",
  );
});

test("renderer prioritizes feedback before loss and renders with text-safe DOM methods", async () => {
  const source = await readFile(
    new URL("../public/js/ui/render.js", import.meta.url),
    "utf8",
  );
  const renderStart = source.indexOf("render(state, card)");
  const focusStart = source.indexOf("focusPrimarySurface()", renderStart);
  const renderSource = source.slice(renderStart, focusStart);
  const feedbackIndex = renderSource.indexOf("state.pendingFeedback");
  const lossIndex = renderSource.indexOf("deriveLossPresentation(state)");
  const cardIndex = renderSource.indexOf("renderCard(state, card)");
  assert.ok(feedbackIndex >= 0);
  assert.ok(lossIndex > feedbackIndex);
  assert.ok(cardIndex > lossIndex);
  assert.match(source, /choiceFeedbackChanges\.replaceChildren\(\)/);
  assert.match(source, /document\.createElement\("dt"\)/);
  assert.match(source, /document\.createElement\("dd"\)/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML/);
});

test("renderer binds all directional controls, overlays, and previews", async () => {
  const source = await readFile(
    new URL("../public/js/ui/render.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /for \(const direction of DIRECTIONS\)/);
  assert.match(source, /byId\(`choice-\$\{direction\}`\)/);
  assert.match(source, /byId\(`choice-\$\{direction\}-overlay`\)/);
  assert.match(source, /choiceForDirection\(currentState, activeCard, direction\)/);
  assert.match(source, /resourceTargets\[resource\]\.dataset\.previewed = "true"/);
  assert.doesNotMatch(source, /inventory|combat|rewardSummary|storyTransition/);
});
