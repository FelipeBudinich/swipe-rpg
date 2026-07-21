import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { artSourceForId } from "../public/js/data/art-assets.js";
import {
  DEEP_SOUTH_CARDS,
  DEEP_SOUTH_DECKS,
  DEEP_SOUTH_INTRO_CARDS,
  DEEP_SOUTH_INTRO_SKIP_CONFIRMATION,
  DEEP_SOUTH_PLOT_CARDS,
  DEEP_SOUTH_PLOT_CARDS_BY_DECK,
  DEEP_SOUTH_STORY,
} from "../public/js/data/deep-south.js";
import {
  createInitialUnlockedCardIdsByDeck,
  normalizeCardEffect,
} from "../public/js/game/card-effects.js";

const EXPECTED_DECK_IDS = [
  "it-begins-here",
  "castro",
  "investigate-church",
  "gather-crew",
  "navigate",
  "rest-at-desolate-beach",
  "reach-the-coordinates",
  "explore-rlyeh",
  "gather-evidence",
];

function assertText(value, context) {
  assert.equal(typeof value, "string", `${context} must be text`);
  assert.ok(value.trim(), `${context} must not be empty`);
}

function resourceEntries(effect) {
  return Object.entries(effect?.resources ?? {});
}

function assertAdditionEffect(effect, context) {
  assert.equal(resourceEntries(effect).length, 0, context);
  assert.ok(Array.isArray(effect.addCards), context);
  assert.ok(effect.addCards.length > 0, context);
  for (const addition of effect.addCards) {
    const deck = DEEP_SOUTH_DECKS.find(({ id }) => id === addition.deckId);
    assert.equal(deck?.type, "plot", context);
    assert.ok(addition.cardIds.length > 0, context);
    for (const id of addition.cardIds) {
      assert.ok(
        deck.cards.some((card) => card.id === id),
        `${context}: ${id} must belong to ${addition.deckId}`,
      );
    }
  }
}

function assertPlotBackEffect(effect, cardId) {
  const normalized = normalizeCardEffect(effect, DEEP_SOUTH_STORY);
  assert.deepEqual(normalized, effect, `${cardId} back must be normalized`);
  if (effect.addCards) {
    assertAdditionEffect(effect, `${cardId} addition`);
    assert.equal(effect.discoveries, undefined);
    return;
  }
  const entries = resourceEntries(effect);
  assert.equal(entries.length, 2, `${cardId} must exchange two resources`);
  assert.deepEqual(
    entries.map(([, amount]) => amount).sort(),
    [-1, 1],
    `${cardId} must have one +1 and one -1`,
  );
  assert.equal(effect.addCards, undefined);
  assert.equal(effect.discoveries, undefined);
}

function assertEntryEffect(effect, cardId) {
  if (effect === null) return;
  const normalized = normalizeCardEffect(effect, DEEP_SOUTH_STORY);
  assert.deepEqual(normalized, effect, `${cardId} entry must be normalized`);
  if (effect.addCards) {
    assertAdditionEffect(effect, `${cardId} entry addition`);
    return;
  }
  const entries = resourceEntries(effect);
  assert.equal(entries.length, 1, `${cardId} entry changes one resource`);
  assert.ok(
    Math.abs(entries[0][1]) === 1,
    `${cardId} entry delta has magnitude one`,
  );
}

test("Deep South publishes the ordered nine-deck story", () => {
  assert.equal(DEEP_SOUTH_STORY.id, "deep-south");
  assert.equal(DEEP_SOUTH_STORY.title, "Deep South");
  assert.deepEqual(DEEP_SOUTH_DECKS.map(({ id }) => id), EXPECTED_DECK_IDS);
  assert.equal(DEEP_SOUTH_DECKS[0].type, "intro");
  assert.deepEqual(
    DEEP_SOUTH_DECKS.slice(1).map(({ plotStep }) => plotStep),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test("every authored story card has one universal front/back contract", () => {
  assert.equal(DEEP_SOUTH_INTRO_CARDS.length, 8);
  assert.equal(DEEP_SOUTH_PLOT_CARDS.length, 40);
  assert.equal(DEEP_SOUTH_CARDS.length, 48);
  assert.equal(new Set(DEEP_SOUTH_CARDS.map(({ id }) => id)).size, 48);

  for (const card of DEEP_SOUTH_CARDS) {
    assertText(card.id, "card ID");
    assertText(card.deckId, `${card.id} deck ID`);
    assert.equal(typeof card.initiallyAvailable, "boolean", card.id);
    assert.ok(Object.hasOwn(card, "entryEffect"), card.id);
    assert.equal(Object.hasOwn(card, "choices"), false, card.id);
    assert.equal(Object.hasOwn(card, "result"), false, card.id);
    assert.equal(Object.hasOwn(card, "tone"), false, card.id);
    assert.equal(Object.hasOwn(card, "costs"), false, card.id);
    for (const faceName of ["front", "back"]) {
      const face = card.faces?.[faceName];
      assert.ok(face, `${card.id} needs ${faceName}`);
      assertText(face.title, `${card.id} ${faceName} title`);
      assertText(face.text, `${card.id} ${faceName} text`);
      assertText(face.artId, `${card.id} ${faceName} art`);
      assertText(face.artAlt, `${card.id} ${faceName} art alt`);
      assert.equal(Object.hasOwn(face, "result"), false, card.id);
      assert.equal(Object.hasOwn(face, "tone"), false, card.id);
      assert.equal(Object.hasOwn(face, "costs"), false, card.id);
    }
    assert.ok(
      Object.hasOwn(card.faces.back, "effect"),
      `${card.id} back effect must be explicit`,
    );
    assertEntryEffect(card.entryEffect, card.id);
  }
});

test("plot decks contain five cards and every back obeys exchange-or-add", () => {
  for (const deck of DEEP_SOUTH_DECKS.filter(({ type }) => type === "plot")) {
    assert.equal(deck.cards.length, 5, deck.id);
    assert.equal(DEEP_SOUTH_PLOT_CARDS_BY_DECK[deck.id], deck.cards);
    for (const card of deck.cards) {
      assert.equal(card.deckId, deck.id);
      assert.equal(card.type, "plot");
      assertPlotBackEffect(card.faces.back.effect, card.id);
    }
  }
});

test("the photograph is the explicit Intro effect exception", () => {
  const photograph = DEEP_SOUTH_INTRO_CARDS[0];
  assert.equal(photograph.id, "intro-fathers-diary");
  assert.equal(photograph.turnLabel, "Turn the photograph over");
  assert.equal(photograph.faces.front.title, "My father’s photograph");
  assert.equal(photograph.faces.back.title, "The map on the reverse");
  assert.equal(photograph.faces.back.artLabel, "42°36′S, 73°57′W");
  assert.deepEqual(photograph.faces.back.effect, {
    resources: { eldritchLore: 1 },
    discoveries: ["fatherDiaryReverse"],
  });
  for (const card of DEEP_SOUTH_INTRO_CARDS.slice(1)) {
    assert.equal(card.faces.back.effect, null, card.id);
  }
});

test("the Intro tutorial describes Down as plot progression", () => {
  const paths = DEEP_SOUTH_INTRO_CARDS.find(({ id }) => id === "intro-paths");
  assert.equal(
    paths.faces.back.text,
    "Up retreats toward a previous chapter. Down exhausts the current chapter before pressing farther south. The exact destination is chosen before the preview appears.",
  );
});

test("every locked production card has a reachable authored unlock path", () => {
  const initial = createInitialUnlockedCardIdsByDeck(DEEP_SOUTH_STORY);
  const locked = new Set(
    DEEP_SOUTH_DECKS
      .filter(({ type }) => type === "plot")
      .flatMap((deck) =>
        deck.cards
          .filter((card) => !initial[deck.id].includes(card.id))
          .map((card) => card.id),
      ),
  );
  const referenced = new Set(
    DEEP_SOUTH_CARDS.flatMap((card) =>
      [card.faces.back.effect, card.entryEffect].flatMap((effect) =>
        (effect?.addCards ?? []).flatMap(({ cardIds }) => cardIds),
      ),
    ),
  );
  assert.ok(locked.size > 0);
  assert.deepEqual(
    [...locked].sort(),
    [...referenced].filter((id) => locked.has(id)).sort(),
  );
});

test("all authored art resolves to safe local nonempty files", async () => {
  for (const card of DEEP_SOUTH_CARDS) {
    for (const face of Object.values(card.faces)) {
      const source = artSourceForId(face.artId);
      assert.match(source, /^\/assets\/art\/[a-z0-9./-]+$/u);
      await access(new URL(`../public${source}`, import.meta.url));
    }
  }
});

test("the skip confirmation remains a synthetic Up/Down control", () => {
  assert.equal(DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.type, "intro-confirmation");
  assert.deepEqual(
    Object.keys(DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.choices).sort(),
    ["down", "up"],
  );
  assert.equal(
    DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.choices.up.label,
    "Skip to Castro",
  );
  assert.equal(
    DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.choices.down.label,
    "Keep reading",
  );
  assert.match(
    DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.text,
    /Swipe up again to skip to Castro\./u,
  );
  assert.match(
    DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.text,
    /Swipe down to keep reading\./u,
  );
  assert.equal(
    DEEP_SOUTH_CARDS.some(
      ({ id }) => id === DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.id,
    ),
    false,
  );
});

test("authored card source contains no retired directional schema", async () => {
  const source = await readFile(
    new URL("../public/js/data/cards/deep-south-cards.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bchoices\s*:/u);
  assert.doesNotMatch(source, /\bresult\s*:/u);
  assert.doesNotMatch(source, /\btone\s*:/u);
  assert.doesNotMatch(source, /\bcosts\s*:/u);
});
