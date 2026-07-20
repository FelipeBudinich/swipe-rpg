import assert from "node:assert/strict";
import test from "node:test";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  createGame,
  getNextCard,
  resolveChoice,
} from "../public/js/game/engine.js";
import {
  DIRECTIONS,
  cardAnnouncement,
  createRenderer,
  deriveChapterMapPresentation,
  deriveChoicePresentation,
  deriveDeckHud,
  deriveEffectLogPresentation,
  deriveLossPresentation,
  resolveArtSource,
} from "../public/js/ui/render.js";

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
    this.className = "";
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
  "terminal-summary",
  "terminal-title",
  "terminal-copy",
  "terminal-stats",
  "terminal-restart",
  "chapter-map-panel",
  "chapter-map-current",
  "chapter-map-route",
  "effect-log-panel",
  "effect-log-summary",
  "effect-log-empty",
  "effect-log-list",
  "effect-log-restart",
  "effect-log-restart-warning",
  ...DIRECTIONS.flatMap((direction) => [
    `choice-${direction}-overlay`,
    `choice-${direction}-overlay-label`,
    `choice-${direction}-overlay-detail`,
  ]),
];

function installRendererDocument(t, omittedId = null) {
  const priorDocument = globalThis.document;
  const requestedIds = [];
  const elements = new Map(
    RENDERER_ELEMENT_IDS
      .filter((id) => id !== omittedId)
      .map((id) => [id, new FakeElement(id)]),
  );
  globalThis.document = {
    getElementById(id) {
      requestedIds.push(id);
      return elements.get(id) ?? null;
    },
    createElement() {
      return new FakeElement();
    },
  };
  t.after(() => {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  });
  return { elements, requestedIds };
}

function allowedArtIds() {
  return new Set(
    DEEP_SOUTH_STORY.decks.flatMap((deck) => [
      deck.artId,
      ...(deck.cards ?? []).flatMap((card) =>
        Object.values(card.faces ?? {}).map((face) => face.artId),
      ),
    ]),
  );
}

function createTestRenderer() {
  return createRenderer({
    story: DEEP_SOUTH_STORY,
    allowedArtIds: allowedArtIds(),
  });
}

function resolve(game, direction) {
  return resolveChoice(game.state, direction, {
    expectedToken: game.card.resolutionToken,
  });
}

function enterCastro(seed) {
  let game = createGame({ seed });
  for (let index = 0; index < 8; index += 1) game = resolve(game, "down");
  assert.equal(game.state.currentDeckId, "castro");
  return game;
}

test("renderer requires all four transient preview-detail elements", (t) => {
  installRendererDocument(t, "choice-down-overlay-detail");
  assert.throws(
    () => createTestRenderer(),
    /Missing required element #choice-down-overlay-detail/u,
  );
});

test("front photograph presentations share exact label, effect, and resource", () => {
  const game = createGame({ seed: 601 });
  const left = deriveChoicePresentation(
    game.state,
    game.card,
    "left",
  );
  const right = deriveChoicePresentation(
    game.state,
    game.card,
    "right",
  );
  for (const presentation of [left, right]) {
    assert.equal(presentation.available, true);
    assert.equal(presentation.mode, "flip");
    assert.equal(
      presentation.label,
      "Turn the photograph over",
    );
    assert.equal(
      presentation.detail,
      "Discovery recorded · +1 Eldritch Lore",
    );
    assert.deepEqual(presentation.affects, ["eldritchLore"]);
  }
});

test("renderer writes both horizontal details through the normal plan path", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const game = createGame({ seed: 602 });
  renderer.render(game.state, game.card);

  for (const direction of ["left", "right"]) {
    assert.equal(
      renderer.elements.choiceOverlayLabels[direction].textContent,
      "Turn the photograph over",
    );
    assert.equal(
      renderer.elements.choiceOverlayDetails[direction].textContent,
      "Discovery recorded · +1 Eldritch Lore",
    );
    assert.equal(
      renderer.elements.choiceOverlayDetails[direction].hidden,
      false,
    );
  }
  assert.equal(renderer.elements.card.dataset.cardFace, "front");
  assert.equal(renderer.elements.detail.hidden, true);
});

test("front preview highlights Lore and back horizontal preview cannot activate", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  let game = createGame({ seed: 603 });
  renderer.render(game.state, game.card);
  renderer.previewChoice("left");
  assert.equal(
    renderer.elements.eldritchLoreHud.dataset.previewed,
    "true",
  );

  game = resolve(game, "left");
  renderer.render(game.state, game.card);
  assert.equal(renderer.elements.card.dataset.cardFace, "back");
  assert.equal(
    renderer.elements.detail.textContent,
    "Discovery recorded · +1 Eldritch Lore",
  );
  assert.equal(renderer.elements.detail.hidden, false);
  for (const direction of ["left", "right"]) {
    const presentation = deriveChoicePresentation(
      game.state,
      game.card,
      direction,
    );
    assert.equal(presentation.available, false);
    renderer.previewChoice(direction);
    assert.equal(
      renderer.elements.eldritchLoreHud.dataset.previewed,
      undefined,
    );
    assert.equal(
      renderer.elements.crewHud.dataset.previewed,
      undefined,
    );
    assert.equal(
      renderer.elements.sanityHud.dataset.previewed,
      undefined,
    );
  }
});

test("null destination entry effects use a compact one-line preview", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const game = createGame({ seed: 604 });
  renderer.render(game.state, game.card);
  assert.equal(
    renderer.elements.choiceOverlayLabels.up.textContent,
    "Skip toward Castro",
  );
  assert.equal(
    renderer.elements.choiceOverlayLabels.down.textContent,
    "Keep reading",
  );
  const down = deriveChoicePresentation(game.state, game.card, "down");
  assert.equal(down.available, true);
  assert.equal(down.label, "Keep reading");
  assert.equal(down.detail, "");
  assert.deepEqual(down.affects, []);
  assert.equal(
    renderer.elements.choiceOverlayDetails.down.textContent,
    "",
  );
  assert.equal(
    renderer.elements.choiceOverlayDetails.down.hidden,
    true,
  );
  renderer.previewChoice("down");
  for (const resource of [
    "eldritchLoreHud",
    "crewHud",
    "sanityHud",
  ]) {
    assert.equal(renderer.elements[resource].dataset.previewed, undefined);
  }
});

test("Intro presentations expose inverted Up skip and Down reading semantics", () => {
  let game = createGame({ seed: 6041 });
  const up = deriveChoicePresentation(game.state, game.card, "up");
  const down = deriveChoicePresentation(game.state, game.card, "down");
  assert.equal(up.available, true);
  assert.equal(up.label, "Skip toward Castro");
  assert.equal(down.available, true);
  assert.equal(down.label, "Keep reading");

  game = resolve(game, "up");
  const confirm = deriveChoicePresentation(game.state, game.card, "up");
  const cancel = deriveChoicePresentation(game.state, game.card, "down");
  assert.equal(confirm.label, "Enter Castro");
  assert.equal(cancel.label, "Keep reading");
});

test("plot presentations use Up to continue and Down to return", () => {
  const castro = enterCastro(6042);
  const castroUp = deriveChoicePresentation(
    castro.state,
    castro.card,
    "up",
  );
  const castroDown = deriveChoicePresentation(
    castro.state,
    castro.card,
    "down",
  );
  assert.equal(castroUp.available, true);
  assert.match(castroUp.label, /^Continue (?:in|to) Chapter/u);
  assert.equal(castroDown.available, false);
  assert.equal(castroDown.reason, "no-previous-chapter");

  const churchDeck = DEEP_SOUTH_STORY.decks.find(
    ({ id }) => id === "investigate-church",
  );
  const unlockedIds = castro.state.unlockedCardIdsByDeck[churchDeck.id];
  const [sourceCardId, destinationCardId] = unlockedIds;
  const church = getNextCard({
    ...castro.state,
    currentDeckId: churchDeck.id,
    currentCardId: sourceCardId,
    currentCardToken: null,
    drawStateByDeck: {
      ...castro.state.drawStateByDeck,
      [churchDeck.id]: {
        drawPile: [destinationCardId],
        discardPile: [],
        lastResolvedCardId: null,
      },
    },
  });
  const up = deriveChoicePresentation(church.state, church.card, "up");
  const down = deriveChoicePresentation(church.state, church.card, "down");
  assert.equal(up.available, true);
  assert.match(up.label, /^Continue in Chapter 2, Investigate Church$/u);
  assert.equal(down.available, true);
  assert.match(down.label, /^Return to Chapter 1, Castro$/u);
  const announcement = cardAnnouncement(
    church.state,
    church.card,
    "Chapter 2, Investigate Church",
  );
  assert.match(announcement, /Up: Continue in Chapter 2/u);
  assert.match(announcement, /Down: Return to Chapter 1/u);
});

test("Castro announces Down as blocked and cannot preview its resources", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const castro = enterCastro(6043);
  renderer.render(castro.state, castro.card);
  const announcement = cardAnnouncement(
    castro.state,
    castro.card,
    "Chapter 1, Castro",
  );
  assert.match(announcement, /Up: Continue/u);
  assert.match(
    announcement,
    /Down: No option\. Castro has no previous plot chapter/u,
  );
  assert.doesNotMatch(announcement, /Down: (?:Continue|Return)/u);
  renderer.previewChoice("down");
  for (const resource of [
    "eldritchLoreHud",
    "crewHud",
    "sanityHud",
  ]) {
    assert.equal(renderer.elements[resource].dataset.previewed, undefined);
  }
});

test("accessible front and back announcements expose only available directions", () => {
  let game = createGame({ seed: 605 });
  const front = cardAnnouncement(
    game.state,
    game.card,
    "It begins here - 8 cards left in deck",
  );
  assert.match(front, /My father’s photograph/u);
  assert.equal(
    (front.match(/Turn the photograph over/gu) ?? []).length,
    2,
  );
  assert.match(front, /Discovery recorded · \+1 Eldritch Lore/u);
  assert.match(front, /Up: Skip toward Castro/u);
  assert.match(front, /Down: Keep reading/u);

  game = resolve(game, "right");
  const back = cardAnnouncement(
    game.state,
    game.card,
    "It begins here - 8 cards left in deck",
  );
  assert.match(back, /The map on the reverse/u);
  assert.match(back, /Discovery recorded · \+1 Eldritch Lore/u);
  assert.doesNotMatch(back, /Left:|Right:|Turn the photograph over/u);
  assert.match(back, /Up: Skip toward Castro/u);
  assert.match(back, /Down: Keep reading/u);
});

test("deck HUD counts active unlocked cards once and remains face-neutral", () => {
  const deck = DEEP_SOUTH_STORY.decks.find(
    ({ id }) => id === "investigate-church",
  );
  const unlocked = deck.cards
    .filter(({ initiallyAvailable }) => initiallyAvailable)
    .map(({ id }) => id);
  const state = {
    currentDeckId: deck.id,
    currentCardId: unlocked[0],
    revealedCardIds: [],
    unlockedCardIdsByDeck: { [deck.id]: unlocked },
    drawStateByDeck: {
      [deck.id]: {
        drawPile: unlocked.slice(1),
        discardPile: [],
      },
    },
  };
  const front = deriveDeckHud(state);
  const back = deriveDeckHud({
    ...state,
    revealedCardIds: [unlocked[0]],
  });
  assert.equal(front.cardsLeft, unlocked.length);
  assert.equal(back.cardsLeft, front.cardsLeft);

  const addedId = deck.cards.find(
    ({ initiallyAvailable }) => !initiallyAvailable,
  )?.id;
  if (addedId) {
    const added = deriveDeckHud({
      ...state,
      unlockedCardIdsByDeck: {
        [deck.id]: [...unlocked, addedId],
      },
      drawStateByDeck: {
        [deck.id]: {
          drawPile: [...unlocked.slice(1), addedId, addedId],
          discardPile: [],
        },
      },
    });
    assert.equal(added.cardsLeft, unlocked.length + 1);
  }
});

test("chapter map derives all nine canonical locations without completion claims", () => {
  const game = createGame({ seed: 6051 });
  const map = deriveChapterMapPresentation(game.state, game.card);
  assert.equal(map.nodes.length, 9);
  assert.deepEqual(map.nodes[0], {
    id: "it-begins-here",
    title: "It begins here",
    stageLabel: "Prologue",
    position: "current",
    current: true,
  });
  assert.equal(map.nodes.at(-1).title, "Gather Evidence");
  assert.equal(map.nodes.filter(({ current }) => current).length, 1);
  assert.equal(map.currentLabel, "Current location: It begins here");
  assert.equal(map.currentCardTitle, "My father’s photograph");
  assert.doesNotMatch(JSON.stringify(map), /completed|cleared|locked|unvisited/iu);
});

test("effect log presentation is newest-first with chronological sequences", () => {
  const game = createGame({ seed: 6052 });
  const presentation = deriveEffectLogPresentation({
    ...game.state,
    effectLog: [
      {
        id: "effect:reveal:first",
        kind: "reveal",
        cardId: "intro-fathers-diary",
        direction: "left",
        effect: {
          resources: { eldritchLore: 1 },
          discoveries: ["fatherDiaryReverse"],
        },
      },
      {
        id: "effect:entry:second",
        kind: "entry",
        cardId: "castro-empty-berths",
        direction: "up",
        effect: { resources: { crew: 1 } },
      },
    ],
  });
  assert.deepEqual(presentation.map(({ id, sequence }) => [id, sequence]), [
    ["effect:entry:second", 2],
    ["effect:reveal:first", 1],
  ]);
  assert.equal(presentation[0].kindLabel, "Arrival effect");
  assert.equal(presentation[0].directionLabel, "Up");
  assert.equal(presentation[0].chapterLabel, "Chapter 1, Castro");
  assert.equal(presentation[0].detail, "+1 Crew");
  assert.equal(presentation[1].cardTitle, "The map on the reverse");
});

test("renderer keeps hidden Map and Log content current and clears previews", (t) => {
  installRendererDocument(t);
  const renderer = createTestRenderer();
  const game = resolve(createGame({ seed: 6053 }), "left");
  renderer.render(game.state, game.card);
  assert.equal(renderer.elements.mapRoute.children.length, 9);
  assert.equal(
    renderer.elements.mapRoute.children.filter(
      (node) => node.getAttribute("aria-current") === "location",
    ).length,
    1,
  );
  assert.equal(renderer.elements.logSummary.textContent, "1 effect recorded");
  assert.equal(renderer.elements.logEmpty.hidden, true);
  assert.equal(renderer.elements.logList.hidden, false);
  assert.equal(renderer.elements.logList.children.length, 1);
  assert.equal(
    renderer.elements.logList.children[0].dataset.effectKind,
    "reveal",
  );

  renderer.previewChoice("down");
  renderer.elements.eldritchLoreHud.dataset.previewed = "true";
  renderer.clearPreview();
  for (const resource of ["eldritchLoreHud", "crewHud", "sanityHud"]) {
    assert.equal(renderer.elements[resource].dataset.previewed, undefined);
  }
});

test("loss presentation waits until terminal-pending card is acknowledged", () => {
  const pending = {
    status: "lost",
    terminalPending: true,
    resources: { eldritchLore: 1, crew: 0, sanity: 0 },
  };
  assert.equal(deriveLossPresentation(pending), null);
  const terminal = deriveLossPresentation({
    ...pending,
    terminalPending: false,
  });
  assert.equal(terminal.title, "The sea remembers");
  assert.equal(terminal.restartLabel, "Begin Again");
  assert.deepEqual(
    terminal.stats.map(({ key, value }) => [key, value]),
    [
      ["eldritchLore", "1"],
      ["crew", "0"],
      ["sanity", "0"],
    ],
  );
});

test("renderer switches directly between card and terminal surfaces", (t) => {
  const { requestedIds } = installRendererDocument(t);
  const renderer = createTestRenderer();
  const game = createGame({ seed: 606 });
  renderer.render(game.state, game.card);
  assert.equal(renderer.elements.card.hidden, false);
  assert.equal(renderer.elements.terminal.hidden, true);
  assert.equal(requestedIds.includes("hud-deck-title"), false);
  assert.equal(
    requestedIds.some((id) => id.startsWith("choice-feedback")),
    false,
  );

  renderer.render(
    {
      ...game.state,
      status: "lost",
      terminalPending: false,
      resources: { ...game.state.resources, sanity: 0 },
    },
    null,
  );
  assert.equal(renderer.elements.card.hidden, true);
  assert.equal(renderer.elements.terminal.hidden, false);
  renderer.focusPrimarySurface();
  assert.equal(renderer.elements.terminalRestart.focused, true);
});

test("art resolution accepts allowlisted IDs and rejects arbitrary paths", () => {
  const allowed = new Set(["deep-south-castro"]);
  assert.equal(
    resolveArtSource("deep-south-castro", allowed),
    "/assets/art/deep-south-castro.svg",
  );
  assert.equal(
    resolveArtSource("../../server", allowed),
    "/assets/art/deep-south-it-begins-here.svg",
  );
});
