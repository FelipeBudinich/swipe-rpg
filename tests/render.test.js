import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  createGame,
  dismissChoiceFeedback,
  resolveChoice,
} from "../public/js/game/engine.js";
import {
  DIRECTIONS,
  FEEDBACK_ART_BY_TONE,
  affectedResources,
  cardAnnouncement,
  choiceDetail,
  choiceForDirection,
  deriveChoicePresentation,
  deriveDeckHud,
  deriveFeedbackPresentation,
  deriveLossPresentation,
  resolveArtSource,
} from "../public/js/ui/render.js";

const story = DEEP_SOUTH_STORY;

function stateForDeck(deckId, cardsLeft = 5) {
  const deck = story.decks.find(({ id }) => id === deckId);
  assert.ok(deck);
  const currentCard = deck.cards[0];
  return {
    currentDeckId: deckId,
    currentCardId: currentCard.id,
    drawStateByDeck: {
      [deckId]: {
        drawPile: deck.cards
          .slice(1, Math.max(1, cardsLeft))
          .map(({ id }) => id),
        discardPile: [],
      },
    },
    resources: { eldritchLore: 0, crew: 0, sanity: 3 },
  };
}

function resolve(game, direction) {
  return resolveChoice(game.state, direction, {
    expectedToken: game.card?.resolutionToken,
  });
}

function continueFromFeedback(game) {
  return dismissChoiceFeedback(game.state, {
    expectedFeedbackId: game.state.pendingFeedback?.id,
  });
}

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

test("deck HUD derives Intro and all chapter headings from canonical state", () => {
  const intro = deriveDeckHud(
    {
      currentDeckId: "it-begins-here",
      introCardIndex: 0,
    },
    story,
  );
  assert.equal(intro.deckLabel, "It begins here - 4 cards left in deck");
  assert.equal(intro.chapterNumber, null);
  assert.equal(intro.cardsLeft, 4);

  for (const deck of story.decks.filter(({ type }) => type === "plot")) {
    const hud = deriveDeckHud(stateForDeck(deck.id, deck.cards.length), story);
    assert.equal(
      hud.deckLabel,
      `${deck.title}, Chapter ${deck.plotStep} - ${deck.cards.length} cards left in deck`,
    );
    assert.equal(hud.chapterNumber, deck.plotStep);
    assert.equal(hud.cardsLeft, deck.cards.length);
    assert.doesNotMatch(hud.deckLabel, /Plot Step|Chapter 0/u);
  }
});

test("card counts include the current card, use singular grammar, and retain source count during feedback", () => {
  const active = stateForDeck("castro", 1);
  assert.equal(
    deriveDeckHud(active, story).deckLabel,
    "Castro, Chapter 1 - 1 card left in deck",
  );

  const feedbackState = {
    ...active,
    currentDeckId: "investigate-church",
    currentCardId: null,
    pendingFeedback: {
      sourceDeckId: "castro",
      sourceCardId: active.currentCardId,
    },
  };
  assert.equal(
    deriveDeckHud(feedbackState, story).deckLabel,
    "Castro, Chapter 1 - 1 card left in deck",
  );

  assert.equal(
    deriveDeckHud(
      {
        currentDeckId: "it-begins-here",
        introCardIndex: 2,
        introSkipPending: true,
      },
      story,
    ).deckLabel,
    "It begins here - 2 cards left in deck",
  );
});

test("card count changes only after Continue and survives chapter navigation", () => {
  let game = createGame({ seed: 73 });
  game = resolve(game, "down");
  game = resolve(game, "down");
  assert.equal(
    deriveDeckHud(game.state, story).deckLabel,
    "Castro, Chapter 1 - 5 cards left in deck",
  );

  game = resolve(game, "up");
  assert.ok(game.state.pendingFeedback);
  assert.equal(
    deriveDeckHud(game.state, story).deckLabel,
    "Castro, Chapter 1 - 5 cards left in deck",
  );
  game = continueFromFeedback(game);
  assert.equal(
    deriveDeckHud(game.state, story).deckLabel,
    "Castro, Chapter 1 - 4 cards left in deck",
  );

  game = resolve(game, "down");
  assert.equal(
    deriveDeckHud(game.state, story).deckLabel,
    "Castro, Chapter 1 - 4 cards left in deck",
  );
  game = continueFromFeedback(game);
  assert.equal(
    deriveDeckHud(game.state, story).deckLabel,
    "Investigate Church, Chapter 2 - 5 cards left in deck",
  );

  game = resolve(game, "up");
  game = continueFromFeedback(game);
  assert.equal(
    deriveDeckHud(game.state, story).deckLabel,
    "Castro, Chapter 1 - 3 cards left in deck",
  );
});

test("Intro presentation uses Up and Down while Left and Right are unavailable", () => {
  const state = {
    currentDeckId: "it-begins-here",
    resources: { eldritchLore: 0, crew: 0, sanity: 3 },
  };
  const normalCard = {
    choices: {
      up: { label: "Keep reading", effects: {} },
      down: { label: "Skip toward Castro", effects: {} },
    },
  };
  const confirmationCard = {
    choices: {
      up: { label: "Keep reading", effects: {} },
      down: { label: "Skip to Castro", effects: {} },
    },
  };
  assert.equal(choiceForDirection(state, normalCard, "up").label, "Keep reading");
  assert.equal(
    choiceForDirection(state, normalCard, "down").label,
    "Skip toward Castro",
  );
  assert.equal(choiceForDirection(state, normalCard, "left"), null);
  assert.equal(choiceForDirection(state, normalCard, "right"), null);
  assert.equal(
    choiceForDirection(state, confirmationCard, "down").label,
    "Skip to Castro",
  );
  assert.equal(
    choiceForDirection(state, confirmationCard, "up").label,
    "Keep reading",
  );
});

test("a fully authored plot card exposes all four directional choices", () => {
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

test("choice presentation keeps missing and resource-locked slots visible but disabled", () => {
  const card = {
    choices: {
      up: { label: "Climb", effects: { sanity: -1 } },
      right: {
        label: "Lower a sailor",
        costs: { crew: 1 },
        effects: { eldritchLore: 1 },
      },
    },
  };
  const empty = {
    resources: { eldritchLore: 0, crew: 0, sanity: 1 },
  };
  const missing = deriveChoicePresentation(empty, card, "left");
  assert.equal(missing.available, false);
  assert.equal(missing.label, "No option");
  assert.match(missing.ariaLabel, /No action is available/u);

  const locked = deriveChoicePresentation(empty, card, "right");
  assert.equal(locked.available, false);
  assert.equal(locked.label, "Lower a sailor");
  assert.equal(locked.detail, "Requires 1 Crew.");
  assert.deepEqual(locked.affects, ["eldritchLore", "crew"]);

  const affordable = deriveChoicePresentation(
    {
      resources: { eldritchLore: 0, crew: 1, sanity: 1 },
    },
    card,
    "right",
  );
  assert.equal(affordable.available, true);
  assert.equal(
    affordable.detail,
    "Costs 1 Crew · +1 Eldritch Lore",
  );

  const sanityLoss = deriveChoicePresentation(empty, card, "up");
  assert.equal(sanityLoss.available, true);
  assert.equal(sanityLoss.detail, "-1 Sanity");
});

test("card announcements name every available direction and its actual effects", () => {
  const announcement = cardAnnouncement({ currentDeckId: "castro" }, plotCard);
  for (const phrase of [
    "Bells in the fog",
    "Up: Return to the quay",
    "Down: Follow the sound. +1 Eldritch Lore · -1 Sanity",
    "Left: Question the boatman",
    "Right: Inspect the pilings",
  ]) {
    assert.match(announcement, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(announcement, /\.\./u);
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

test("renderer binds every directional slot to shared availability and previews only enabled choices", async () => {
  const source = await readFile(
    new URL("../public/js/ui/render.js", import.meta.url),
    "utf8",
  );
  const setChoiceSource = source.slice(
    source.indexOf("const setChoice ="),
    source.indexOf("const renderCard =", source.indexOf("const setChoice =")),
  );
  assert.match(source, /for \(const direction of DIRECTIONS\)/);
  assert.match(source, /byId\(`choice-\$\{direction\}`\)/);
  assert.match(source, /byId\(`choice-\$\{direction\}-overlay`\)/);
  assert.match(source, /getDirectionAvailability\(state, card, direction\)/);
  assert.match(setChoiceSource, /button\.hidden = false/);
  assert.match(setChoiceSource, /button\.disabled = !presentation\.available/);
  assert.match(setChoiceSource, /detail\.hidden = false/);
  assert.match(source, /"No option"/);
  assert.match(source, /choiceForDirection\(currentState, activeCard, direction\)/);
  assert.match(
    source,
    /getDirectionAvailability\(currentState, activeCard, direction\)\.available/,
  );
  assert.match(source, /resourceTargets\[resource\]\.dataset\.previewed = "true"/);
  assert.doesNotMatch(setChoiceSource, /button\.hidden\s*=\s*!/);
  assert.doesNotMatch(setChoiceSource, /detail\.hidden\s*=\s*!/);
  assert.doesNotMatch(source, /directionHint|Plot Step/);
  assert.doesNotMatch(source, /inventory|combat|rewardSummary|storyTransition/);
});
