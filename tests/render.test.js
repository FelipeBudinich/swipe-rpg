import assert from "node:assert/strict";
import test from "node:test";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  createGame,
  resolveChoice,
} from "../public/js/game/engine.js";
import {
  DIRECTIONS,
  cardAnnouncement,
  createRenderer,
  deriveChoicePresentation,
  deriveDeckHud,
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
  const up = deriveChoicePresentation(game.state, game.card, "up");
  assert.equal(up.available, true);
  assert.equal(up.detail, "");
  assert.deepEqual(up.affects, []);
  assert.equal(
    renderer.elements.choiceOverlayDetails.up.textContent,
    "",
  );
  assert.equal(
    renderer.elements.choiceOverlayDetails.up.hidden,
    true,
  );
  renderer.previewChoice("up");
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

  game = resolve(game, "right");
  const back = cardAnnouncement(
    game.state,
    game.card,
    "It begins here - 8 cards left in deck",
  );
  assert.match(back, /The map on the reverse/u);
  assert.match(back, /Discovery recorded · \+1 Eldritch Lore/u);
  assert.doesNotMatch(back, /Left:|Right:|Turn the photograph over/u);
  assert.match(back, /Up:/u);
  assert.match(back, /Down:/u);
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
