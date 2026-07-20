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
  createRenderer,
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

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.tabIndex = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  append(...children) {
    this.children.push(...children);
  }

  focus() {
    this.focused = true;
  }
}

const RENDERER_ELEMENT_IDS = [
  "app",
  "player-hud",
  "story-title",
  "hud-deck-title",
  "player-resource-row",
  "eldritch-lore-hud",
  "hud-eldritch-lore",
  "crew-hud",
  "hud-crew",
  "sanity-hud",
  "hud-sanity",
  "card-stack",
  "card-backdrop",
  "card",
  "card-art",
  "card-art-label",
  "card-speaker",
  "card-title",
  "card-text",
  "card-detail",
  "card-live",
  "choice-feedback-card",
  "choice-feedback-kicker",
  "choice-feedback-title",
  "choice-feedback-text",
  "choice-feedback-art",
  "choice-feedback-changes",
  "choice-feedback-controls",
  "choice-feedback-continue",
  "terminal-summary",
  "terminal-title",
  "terminal-copy",
  "terminal-stats",
  "terminal-restart",
  ...DIRECTIONS.flatMap((direction) => [
    `choice-${direction}-overlay`,
    `choice-${direction}-overlay-label`,
    `choice-${direction}-overlay-detail`,
  ]),
];

function installRendererDocument(t, omittedId = null) {
  const priorDocument = globalThis.document;
  const elements = new Map(
    RENDERER_ELEMENT_IDS.filter((id) => id !== omittedId).map((id) => [
      id,
      new FakeElement(id),
    ]),
  );
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: () => new FakeElement(),
  };
  t.after(() => {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  });
  return elements;
}

const rendererStory = {
  id: "deep-south",
  title: "Deep South",
  decks: [
    {
      id: "castro",
      title: "Castro",
      type: "plot",
      plotStep: 1,
      artId: "deep-south-castro",
      cards: ["preview-card"],
    },
  ],
};

function rendererState(resources = { eldritchLore: 2, crew: 2, sanity: 3 }) {
  return {
    status: "playing",
    currentDeckId: "castro",
    currentCardId: "preview-card",
    currentCardToken: "preview-token",
    drawStateByDeck: {
      castro: { drawPile: [], discardPile: [] },
    },
    resources,
  };
}

function rendererCard(choices) {
  return {
    id: "preview-card",
    title: "Preview card",
    text: "The choice waits.",
    artId: "deep-south-castro",
    artAlt: "A preview.",
    choices,
  };
}

function createTestRenderer() {
  return createRenderer({
    story: rendererStory,
    allowedArtIds: new Set(["deep-south-castro"]),
  });
}

function assertChoicePreview(renderer, state, card, direction) {
  const presentation = deriveChoicePresentation(state, card, direction);
  const previewDetail = renderer.elements.choiceOverlayDetails[direction];
  assert.equal(previewDetail.textContent, presentation.detail.trim());
  assert.equal(previewDetail.hidden, !presentation.detail.trim());
  assert.equal(
    renderer.elements.choiceOverlayLabels[direction].textContent,
    presentation.label,
  );
}

test("renderer requires every directional preview-detail element", (t) => {
  installRendererDocument(t, "choice-down-overlay-detail");
  assert.throws(
    () => createTestRenderer(),
    /Missing required element #choice-down-overlay-detail/u,
  );
});

test("renderer gives every directional preview its nonempty detail", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const state = rendererState();
  const card = rendererCard({
    up: {
      label: "Study the chart",
      effects: { eldritchLore: 1 },
    },
    down: {
      label: "Lower a sailor",
      costs: { crew: 1 },
      effects: { sanity: -1 },
    },
    left: {
      label: "Recruit the witness",
      effects: { crew: 1 },
    },
    right: {
      label: "Consult the logbook",
      costs: { eldritchLore: 1 },
      effects: {},
    },
  });
  card.speaker = "Authored speaker must not replace canonical context";

  renderer.render(state, card);

  for (const direction of DIRECTIONS) {
    assertChoicePreview(renderer, state, card, direction);
    assert.equal(
      renderer.elements.choiceOverlayDetails[direction].hidden,
      false,
    );
  }
  assert.equal(
    renderer.elements.speaker.textContent,
    "Chapter 1, Castro - 1 card left in deck",
  );
});

test("rerender clears stale directional preview details", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const state = rendererState();
  const detailedCard = rendererCard(
    Object.fromEntries(
      DIRECTIONS.map((direction, index) => [
        direction,
        {
          label: `Detailed ${direction}`,
          effects: {
            eldritchLore: index % 2 === 0 ? 1 : 0,
            crew: index % 2 === 1 ? 1 : 0,
          },
        },
      ]),
    ),
  );
  const emptyCard = rendererCard(
    Object.fromEntries(
      DIRECTIONS.map((direction) => [
        direction,
        { label: `Plain ${direction}`, effects: {} },
      ]),
    ),
  );

  renderer.render(state, detailedCard);
  for (const direction of DIRECTIONS) {
    assert.notEqual(
      renderer.elements.choiceOverlayDetails[direction].textContent,
      "",
    );
  }

  renderer.render(state, emptyCard);
  for (const direction of DIRECTIONS) {
    assertChoicePreview(renderer, state, emptyCard, direction);
    assert.equal(
      renderer.elements.choiceOverlayDetails[direction].textContent,
      "",
    );
    assert.equal(
      renderer.elements.choiceOverlayDetails[direction].hidden,
      true,
    );
  }
});

test("mixed preview details remain independent by direction", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const state = rendererState();
  const card = rendererCard({
    up: { label: "Read the inscription", effects: { eldritchLore: 1 } },
    down: { label: "Wait for daylight", effects: {} },
    left: { label: "Call the crew", effects: { crew: 1 } },
    right: { label: "Close the hatch", effects: {} },
  });

  renderer.render(state, card);

  for (const direction of DIRECTIONS) {
    assertChoicePreview(renderer, state, card, direction);
  }
  assert.deepEqual(
    Object.fromEntries(
      DIRECTIONS.map((direction) => [
        direction,
        renderer.elements.choiceOverlayDetails[direction].hidden,
      ]),
    ),
    { up: false, down: true, left: false, right: true },
  );
});

test("state-dependent presentation refreshes directional preview details", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const card = rendererCard({
    up: { label: "Wait", effects: {} },
    down: { label: "Wait", effects: {} },
    left: { label: "Wait", effects: {} },
    right: {
      label: "Send a sailor below",
      costs: { crew: 1 },
      effects: { eldritchLore: 1 },
    },
  });
  const lockedState = rendererState({
    eldritchLore: 0,
    crew: 0,
    sanity: 3,
  });
  const availableState = rendererState({
    eldritchLore: 0,
    crew: 1,
    sanity: 3,
  });

  renderer.render(lockedState, card);
  assertChoicePreview(renderer, lockedState, card, "right");
  assert.equal(
    renderer.elements.choiceOverlayDetails.right.textContent,
    "Requires 1 Crew.",
  );

  renderer.render(availableState, card);
  assertChoicePreview(renderer, availableState, card, "right");
  assert.equal(
    renderer.elements.choiceOverlayDetails.right.textContent,
    "Costs 1 Crew · +1 Eldritch Lore",
  );
});

test("deck HUD derives Intro and all chapter headings from canonical state", () => {
  const intro = deriveDeckHud(
    {
      currentDeckId: "it-begins-here",
      introCardIndex: 0,
    },
    story,
  );
  assert.equal(intro.deckLabel, "It begins here - 8 cards left in deck");
  assert.equal(
    intro.cardSpeakerLabel,
    "It begins here - 8 cards left in deck",
  );
  assert.equal(intro.chapterNumber, null);
  assert.equal(intro.cardsLeft, 8);

  for (const deck of story.decks.filter(({ type }) => type === "plot")) {
    const hud = deriveDeckHud(stateForDeck(deck.id, deck.cards.length), story);
    assert.equal(
      hud.deckLabel,
      `${deck.title}, Chapter ${deck.plotStep} - ${deck.cards.length} cards left in deck`,
    );
    assert.equal(
      hud.cardSpeakerLabel,
      `Chapter ${deck.plotStep}, ${deck.title} - ${deck.cards.length} cards left in deck`,
    );
    assert.equal(hud.chapterNumber, deck.plotStep);
    assert.equal(hud.cardsLeft, deck.cards.length);
    assert.doesNotMatch(
      `${hud.deckLabel} ${hud.cardSpeakerLabel}`,
      /Plot Step|Chapter 0/u,
    );
  }

  const navigate = deriveDeckHud(stateForDeck("navigate", 5), story);
  assert.equal(
    navigate.deckLabel,
    "Navigate, Chapter 4 - 5 cards left in deck",
  );
  assert.equal(
    navigate.cardSpeakerLabel,
    "Chapter 4, Navigate - 5 cards left in deck",
  );
});

test("card counts include the current card, use singular grammar, and retain source count during feedback", () => {
  const active = stateForDeck("castro", 1);
  assert.equal(
    deriveDeckHud(active, story).deckLabel,
    "Castro, Chapter 1 - 1 card left in deck",
  );
  assert.equal(
    deriveDeckHud(active, story).cardSpeakerLabel,
    "Chapter 1, Castro - 1 card left in deck",
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
    "It begins here - 6 cards left in deck",
  );
});

test("card-speaker chapters honor future plotStep values and preserve fallback numbering", () => {
  const futureStory = {
    title: "Future South",
    decks: [
      {
        id: "intro",
        title: "Prologue",
        type: "intro",
        cards: ["intro-card"],
      },
      {
        id: "legacy-plot",
        title: "Legacy plot",
        type: "plot",
        cards: ["legacy-card"],
      },
      {
        id: "future-plot",
        title: "Future waters",
        type: "plot",
        plotStep: 9,
        cards: ["future-card"],
      },
    ],
  };
  const stateFor = (deckId, cardId) => ({
    currentDeckId: deckId,
    currentCardId: cardId,
    drawStateByDeck: {
      [deckId]: { drawPile: [], discardPile: [] },
    },
  });

  assert.equal(
    deriveDeckHud(stateFor("future-plot", "future-card"), futureStory)
      .cardSpeakerLabel,
    "Chapter 9, Future waters - 1 card left in deck",
  );
  assert.equal(
    deriveDeckHud(stateFor("legacy-plot", "legacy-card"), futureStory)
      .cardSpeakerLabel,
    "Chapter 1, Legacy plot - 1 card left in deck",
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

test("the reversible Intro face exposes horizontal flips while ordinary cards do not", () => {
  const state = {
    currentDeckId: "it-begins-here",
    resources: { eldritchLore: 0, crew: 0, sanity: 3 },
  };
  const reversibleCard = {
    introFace: "front",
    choices: {
      up: { label: "Keep reading", effects: {} },
      down: { label: "Skip toward Castro", effects: {} },
      left: { label: "Turn the photograph over", effects: {} },
      right: { label: "Turn the photograph over", effects: {} },
    },
  };
  const ordinaryCard = {
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
  assert.equal(choiceForDirection(state, reversibleCard, "up").label, "Keep reading");
  assert.equal(
    choiceForDirection(state, reversibleCard, "down").label,
    "Skip toward Castro",
  );
  assert.equal(
    choiceForDirection(state, reversibleCard, "left").label,
    "Turn the photograph over",
  );
  assert.equal(
    choiceForDirection(state, reversibleCard, "right").label,
    "Turn the photograph over",
  );
  assert.equal(choiceForDirection(state, ordinaryCard, "left"), null);
  assert.equal(choiceForDirection(state, ordinaryCard, "right"), null);
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

test("choice presentation reports missing and resource-locked directions", () => {
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

test("card announcements lead with supplied chapter context and name every direction", () => {
  const context = "Chapter 4, Navigate - 5 cards left in deck";
  const announcement = cardAnnouncement(
    { currentDeckId: "castro" },
    plotCard,
    context,
  );
  assert.ok(announcement.startsWith(`${context}. Bells in the fog.`));
  for (const phrase of [
    context,
    "Bells in the fog",
    "Up: Return to the quay",
    "Down: Follow the sound. +1 Eldritch Lore · -1 Sanity",
    "Left: Question the boatman",
    "Right: Inspect the pilings",
  ]) {
    assert.match(announcement, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(announcement, /\.\./u);

  const fallbackAnnouncement = cardAnnouncement(
    { currentDeckId: "castro" },
    { ...plotCard, speaker: "Authored witness" },
  );
  assert.ok(fallbackAnnouncement.startsWith("Authored witness. Bells in the fog."));
});

test("reverse-face announcements include the coordinate and internal discovery annotation", () => {
  const announcement = cardAnnouncement(
    {
      currentDeckId: "it-begins-here",
      resources: { eldritchLore: 1, crew: 0, sanity: 3 },
    },
    {
      title: "The map on the reverse",
      text: "On the reverse, 42°36′S, 73°57′W beckoned.",
      artLabel: "42°36′S, 73°57′W",
      detail: "Discovery recorded · +1 Eldritch Lore",
      choices: {
        up: { label: "Keep reading", effects: {} },
        down: { label: "Skip toward Castro", effects: {} },
        left: { label: "Return to the photograph", effects: {} },
        right: { label: "Return to the photograph", effects: {} },
      },
    },
  );
  assert.match(announcement, /42°36′S, 73°57′W/u);
  assert.match(announcement, /Discovery recorded · \+1 Eldritch Lore/u);
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
    "intro-01-fathers-photograph",
  ]);
  assert.equal(
    resolveArtSource("deep-south-castro", allowed),
    "/assets/art/deep-south-castro.svg",
  );
  assert.equal(
    resolveArtSource("intro-01-fathers-photograph", allowed),
    "/assets/art/intro-01-fathers-photograph.png",
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
  const setChoicePreviewSource = source.slice(
    source.indexOf("const setChoicePreview ="),
    source.indexOf(
      "const renderCard =",
      source.indexOf("const setChoicePreview ="),
    ),
  );
  const previewChoiceSource = source.slice(
    source.indexOf("previewChoice(direction)"),
  );
  assert.match(source, /for \(const direction of DIRECTIONS\)/);
  assert.match(source, /byId\(`choice-\$\{direction\}-overlay`\)/);
  assert.match(
    source,
    /byId\(\s*`choice-\$\{direction\}-overlay-detail`,?\s*\)/,
  );
  assert.match(source, /getDirectionAvailability\(state, card, direction\)/);
  assert.equal(
    (
      setChoicePreviewSource.match(
        /deriveChoicePresentation\(state, card, direction\)/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(
    setChoicePreviewSource,
    /const previewDetail = String\(presentation\.detail \?\? ""\)\.trim\(\)/,
  );
  assert.match(
    setChoicePreviewSource,
    /overlayDetail\.textContent = previewDetail/,
  );
  assert.match(
    setChoicePreviewSource,
    /overlayDetail\.hidden = !previewDetail/,
  );
  assert.doesNotMatch(
    setChoicePreviewSource,
    /choiceDetail\(|choice\.effects|choice\.costs/,
  );
  assert.match(source, /"No option"/);
  assert.match(source, /choiceForDirection\(currentState, activeCard, direction\)/);
  assert.match(
    source,
    /getDirectionAvailability\(currentState, activeCard, direction\)\.available/,
  );
  assert.match(source, /resourceTargets\[resource\]\.dataset\.previewed = "true"/);
  assert.doesNotMatch(
    previewChoiceSource,
    /choiceOverlayDetails|overlayDetail|textContent|\.hidden\s*=/,
  );
  assert.doesNotMatch(
    source,
    /choiceOverlayDetails\.(?:up|down|left|right)/,
  );
  assert.doesNotMatch(
    source,
    /choiceControls|choiceButtons|choiceLabels|choiceDetails|byId\(`choice-\$\{direction\}`\)|button\.disabled|button\.hidden|disableChoices/,
  );
  assert.match(source, /elements\.speaker\.textContent = hud\.cardSpeakerLabel/u);
  assert.match(
    source,
    /cardAnnouncement\(state, card, hud\.cardSpeakerLabel\)/u,
  );
  assert.doesNotMatch(source, /directionHint|Plot Step/);
  assert.doesNotMatch(source, /inventory|combat|rewardSummary|storyTransition/);
});

test("renderer safely binds face state, coordinate overlay, and the existing detail slot", async () => {
  const source = await readFile(
    new URL("../public/js/ui/render.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /cardArtLabel:\s*byId\("card-art-label"\)/u);
  assert.match(source, /elements\.cardArtLabel\.textContent = artLabel/u);
  assert.match(source, /elements\.cardArtLabel\.hidden = !artLabel/u);
  assert.match(source, /elements\.detail\.textContent = detail/u);
  assert.match(source, /elements\.detail\.hidden = !detail/u);
  assert.match(source, /elements\.card\.dataset\.introFace = introFace/u);
  assert.match(source, /delete elements\.card\.dataset\.introFace/u);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML/u);
});
