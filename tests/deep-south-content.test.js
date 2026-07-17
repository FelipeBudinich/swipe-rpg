import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  artSourceForId,
  INTRO_RASTER_ART_IDS,
} from "../public/js/data/art-assets.js";
import {
  DEEP_SOUTH_CARD_BY_ID,
  DEEP_SOUTH_CARDS,
  DEEP_SOUTH_DECK_BY_ID,
  DEEP_SOUTH_DECK_IDS,
  DEEP_SOUTH_DECKS,
  DEEP_SOUTH_INTRO_CARDS,
  DEEP_SOUTH_INTRO_SKIP_CONFIRMATION,
  DEEP_SOUTH_PLOT_CARDS,
  DEEP_SOUTH_PLOT_CARDS_BY_DECK,
  DEEP_SOUTH_PLOT_DECKS,
  DEEP_SOUTH_STORY,
  DEEP_SOUTH_STORY_ID,
  DEEP_SOUTH_TITLE,
} from "../public/js/data/deep-south.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artDirectory = join(root, "public", "assets", "art");
const DIRECTIONS = ["down", "left", "right", "up"];
const REQUIRED_DIRECTIONS = ["down", "up"];
const EFFECT_KEYS = ["crew", "eldritchLore", "sanity"];
const COST_KEYS = ["crew", "eldritchLore"];
const EXPECTED_DECKS = [
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
  { id: "explore-rlyeh", title: "Explore R'lyeh", type: "plot", plotStep: 7 },
  { id: "gather-evidence", title: "Gather Evidence", type: "plot", plotStep: 8 },
];
const EXPECTED_INTRO_CARDS = [
  {
    id: "intro-fathers-diary",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 0,
    faces: {
      front: {
        title: "My father’s photograph",
        text: "47°9′S, 126°43′W—these coordinates were inscribed above an enigmatic photograph in my father’s diary. The image depicted an indescribable horror.",
        artId: "intro-01-fathers-photograph",
        artAlt:
          "An aged photograph of a colossal tentacled horror rising from a storm-darkened sea.",
      },
      reverse: {
        title: "The map on the reverse",
        text: "On the reverse, another set of coordinates—42°36′S, 73°57′W—beckoned me toward the Deep South.",
        artId: "intro-01-chiloe-map",
        artAlt:
          "A hand-drawn nautical map of Chiloé Island marked with the coordinates 42 degrees 36 minutes south, 73 degrees 57 minutes west.",
        artLabel: "42°36′S, 73°57′W",
        discoveryId: "fatherDiaryReverse",
        firstRevealEffects: { eldritchLore: 1 },
        rewardLabel: "Discovery recorded · +1 Eldritch Lore",
      },
    },
  },
  {
    id: "intro-eldritch-lore",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 1,
    title: "Eldritch Lore",
    text: "To unravel the mystery before me, I will need more than courage. I must gather Eldritch Lore from forbidden sources and whispered warnings to pierce the veil concealing what lies beyond human comprehension.",
    artId: "intro-02-eldritch-lore",
    artAlt:
      "Forbidden books, damp journals, and annotated nautical charts arranged on a candlelit desk.",
  },
  {
    id: "intro-crew",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 2,
    title: "Crew",
    text: "An able Crew—stalwart companions to steady me through the descent—will be indispensable on this journey.",
    artId: "intro-03-crew",
    artAlt: "Prospective crewmembers waiting beneath the rain at a dim southern harbor.",
  },
  {
    id: "intro-sanity",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 3,
    title: "Sanity",
    text: "Most vital of all is Sanity, that fragile tether to the waking world. I begin with 3 Sanity. If it falls to 0, the investigation ends before the final truth can be revealed.",
    artId: "intro-04-sanity",
    artAlt:
      "A lone investigator clings to a fragile thread of light as shapes gather in the darkness.",
  },
  {
    id: "intro-paths",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 4,
    title: "Paths through the dark",
    text: "To proceed, I must let fate guide my steps. I may investigate where I stand, press forward into the unknown, or retreat toward familiar ground.",
    artId: "intro-05-paths",
    artAlt:
      "A nautical chart presents paths toward local investigation, unknown southern waters, and a distant safe shore.",
  },
  {
    id: "intro-consequences",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 5,
    title: "Consequences",
    text: "Some places will offer respite; others will test my resolve. The choices I make may cost me members of my Crew or fragments of my Sanity—or reveal Eldritch Lore.",
    artId: "intro-06-consequences",
    artAlt:
      "An expedition ship rests in a silent cove beside an abandoned coat, a broken compass, and unnatural markings.",
  },
  {
    id: "intro-locked-trials",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 6,
    title: "Locked trials",
    text: "Certain trials will remain beyond my reach until I have succeeded in other chapters.",
    artId: "intro-07-locked-trials",
    artAlt:
      "A sealed ancient doorway bears several carved locks, only some of which have begun to glow.",
  },
  {
    id: "intro-departure",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 7,
    title: "Departure",
    text: "There is no certainty on this path—only fate, hope, and the dark truths waiting to be uncovered.",
    artId: "intro-08-departure",
    artAlt:
      "A small vessel leaves the lights of Chiloé and sails toward a wall of darkness over the southern sea.",
  },
];

function assertDeeplyFrozenData(value, path = "deepSouth") {
  assert.notEqual(typeof value, "function", `${path} contains executable content`);
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
  for (const [key, nested] of Object.entries(value)) {
    assertDeeplyFrozenData(nested, `${path}.${key}`);
  }
}

function deckMetadata(deck) {
  return {
    id: deck.id,
    title: deck.title,
    type: deck.type,
    ...(deck.type === "plot" ? { plotStep: deck.plotStep } : {}),
  };
}

function plotCorpus(deck) {
  return deck.cards.flatMap((card) => [
    card.title,
    card.text,
    ...Object.values(card.choices)
      .filter(Boolean)
      .flatMap(({ label, result }) => [label, result]),
  ]).join(" ");
}

function authoredChoices(card) {
  return DIRECTIONS.flatMap((direction) => {
    const choice = card.choices?.[direction];
    return choice ? [{ direction, choice }] : [];
  });
}

function introSurfaces(card) {
  return card.faces ? Object.values(card.faces) : [card];
}

test("Deep South publishes the exact ordered nine-deck story contract", () => {
  assert.equal(DEEP_SOUTH_STORY_ID, "deep-south");
  assert.equal(DEEP_SOUTH_TITLE, "Deep South");
  assert.equal(DEEP_SOUTH_STORY.id, DEEP_SOUTH_STORY_ID);
  assert.equal(DEEP_SOUTH_STORY.title, DEEP_SOUTH_TITLE);
  assert.strictEqual(DEEP_SOUTH_STORY.decks, DEEP_SOUTH_DECKS);
  assert.deepEqual(DEEP_SOUTH_DECKS.map(deckMetadata), EXPECTED_DECKS);
  assert.deepEqual(DEEP_SOUTH_DECK_IDS, EXPECTED_DECKS.map(({ id }) => id));
  assert.deepEqual(DEEP_SOUTH_PLOT_DECKS.map(({ plotStep }) => plotStep), [
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  assert.deepEqual(Object.keys(DEEP_SOUTH_DECK_BY_ID), DEEP_SOUTH_DECK_IDS);

  for (const deck of DEEP_SOUTH_DECKS) {
    assert.strictEqual(DEEP_SOUTH_DECK_BY_ID[deck.id], deck);
    assert.equal(deck.artId, `deep-south-${deck.id}`);
    assert.deepEqual(
      Object.keys(deck).sort(),
      (deck.type === "intro"
        ? ["artId", "cards", "id", "title", "type"]
        : ["artId", "cards", "id", "plotStep", "title", "type"]),
    );
  }
});

test("the Intro has exactly eight primary cards with exact UTF-8 copy and metadata", () => {
  assert.equal(DEEP_SOUTH_INTRO_CARDS.length, 8);
  assert.deepEqual(DEEP_SOUTH_INTRO_CARDS, EXPECTED_INTRO_CARDS);
  assert.deepEqual(
    DEEP_SOUTH_INTRO_CARDS.map(({ sequence }) => sequence),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );

  const [firstCard, ...ordinaryCards] = DEEP_SOUTH_INTRO_CARDS;
  assert.deepEqual(Object.keys(firstCard).sort(), [
    "deckId",
    "faces",
    "id",
    "sequence",
    "type",
  ]);
  assert.deepEqual(Object.keys(firstCard.faces), ["front", "reverse"]);
  assert.deepEqual(Object.keys(firstCard.faces.front).sort(), [
    "artAlt",
    "artId",
    "text",
    "title",
  ]);
  assert.deepEqual(Object.keys(firstCard.faces.reverse).sort(), [
    "artAlt",
    "artId",
    "artLabel",
    "discoveryId",
    "firstRevealEffects",
    "rewardLabel",
    "text",
    "title",
  ]);
  assert.deepEqual(firstCard.faces.reverse.firstRevealEffects, {
    eldritchLore: 1,
  });

  for (const card of ordinaryCards) {
    assert.equal(card.deckId, "it-begins-here");
    assert.equal(card.type, "intro");
    assert.equal(Object.hasOwn(card, "faces"), false);
    assert.deepEqual(Object.keys(card).sort(), [
      "artAlt",
      "artId",
      "deckId",
      "id",
      "sequence",
      "text",
      "title",
      "type",
    ]);
  }

  const surfaces = DEEP_SOUTH_INTRO_CARDS.flatMap(introSurfaces);
  assert.equal(surfaces.length, 9);
  assert.equal(new Set(surfaces.map(({ artId }) => artId)).size, 9);
  assert.equal(new Set(surfaces.map(({ artAlt }) => artAlt)).size, 9);
  assert.ok(surfaces.every(({ artAlt }) => artAlt.trim().length > 0));
  assert.equal(
    DEEP_SOUTH_INTRO_CARDS.includes(firstCard.faces.reverse),
    false,
    "the reverse must not become a ninth primary card",
  );
  assert.equal(
    Object.hasOwn(DEEP_SOUTH_CARD_BY_ID, firstCard.faces.reverse.discoveryId),
    false,
    "the reverse discovery ID must not enter the primary card registry",
  );
});

test("the canonical down-skip confirmation stays outside the eight-card Intro", () => {
  assert.deepEqual(DEEP_SOUTH_INTRO_SKIP_CONFIRMATION, {
    id: "deep-south-intro-skip-confirmation",
    type: "intro-confirmation",
    title: "Skip the logbook?",
    text: "Swipe down again to skip to Castro.\nSwipe up to keep reading.",
    artId: "deep-south-it-begins-here",
    choices: {
      down: { label: "Skip to Castro" },
      up: { label: "Keep reading" },
    },
  });
  assert.equal(
    DEEP_SOUTH_CARDS.some(({ id }) => id === DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.id),
    false,
  );
  assert.equal(
    DEEP_SOUTH_DECKS.some(({ cards }) =>
      cards.includes(DEEP_SOUTH_INTRO_SKIP_CONFIRMATION)),
    false,
  );
});

test("all eight plot decks contain five unique cards with required vertical navigation", () => {
  assert.equal(DEEP_SOUTH_DECKS.length, 9);
  assert.equal(DEEP_SOUTH_PLOT_DECKS.length, 8);
  assert.deepEqual(
    Object.keys(DEEP_SOUTH_PLOT_CARDS_BY_DECK),
    DEEP_SOUTH_PLOT_DECKS.map(({ id }) => id),
  );

  for (const deck of DEEP_SOUTH_PLOT_DECKS) {
    assert.equal(deck.cards.length, 5, `${deck.id} must contain five authored cards`);
    assert.strictEqual(DEEP_SOUTH_PLOT_CARDS_BY_DECK[deck.id], deck.cards);
    assert.equal(
      new Set(deck.cards.map((card) => JSON.stringify(card))).size,
      5,
      `${deck.id} contains duplicate cards`,
    );

    for (const card of deck.cards) {
      assert.equal(card.deckId, deck.id);
      assert.equal(card.type, "plot");
      assert.equal(card.artId, deck.artId);
      assert.match(card.id, new RegExp(`^${deck.id}-[a-z0-9]+(?:-[a-z0-9]+)*$`));
      assert.deepEqual(Object.keys(card).sort(), [
        "artId",
        "choices",
        "deckId",
        "id",
        "text",
        "title",
        "type",
      ]);
      assert.ok(card.choices.up, `${card.id} must define an up choice`);
      assert.ok(card.choices.down, `${card.id} must define a down choice`);
      assert.ok(
        Object.keys(card.choices).every((direction) => DIRECTIONS.includes(direction)),
        `${card.id} defines an unknown direction`,
      );
      assert.ok(
        authoredChoices(card).length >= REQUIRED_DIRECTIONS.length,
        `${card.id} does not have enough navigable choices`,
      );
    }
  }

  const missingLocalChoices = DEEP_SOUTH_PLOT_CARDS.flatMap((card) =>
    ["left", "right"].flatMap((direction) => {
      if (card.choices?.[direction]) return [];
      return [{
        cardId: card.id,
        direction,
        representedAsNull:
          Object.hasOwn(card.choices, direction) && card.choices[direction] === null,
      }];
    }));
  assert.equal(missingLocalChoices.length, 8);
  assert.ok(missingLocalChoices.some(({ direction }) => direction === "left"));
  assert.ok(missingLocalChoices.some(({ direction }) => direction === "right"));
  assert.ok(missingLocalChoices.some(({ representedAsNull }) => representedAsNull));
  assert.ok(missingLocalChoices.some(({ representedAsNull }) => !representedAsNull));

  assert.equal(DEEP_SOUTH_PLOT_CARDS.length, 40);
  assert.equal(DEEP_SOUTH_CARDS.length, 48);
  assert.deepEqual(
    DEEP_SOUTH_CARDS,
    [...DEEP_SOUTH_INTRO_CARDS, ...DEEP_SOUTH_PLOT_CARDS],
  );
  assert.equal(new Set(DEEP_SOUTH_CARDS.map(({ id }) => id)).size, 48);
  assert.equal(Object.keys(DEEP_SOUTH_CARD_BY_ID).length, 48);
  for (const card of DEEP_SOUTH_CARDS) {
    assert.strictEqual(DEEP_SOUTH_CARD_BY_ID[card.id], card);
  }
});

test("plot outcomes use bounded effects and explicit payable costs without double charging", () => {
  const outcomes = [];
  const paidChoices = [];

  for (const card of DEEP_SOUTH_PLOT_CARDS) {
    for (const { direction, choice } of authoredChoices(card)) {
      outcomes.push(choice);
      assert.deepEqual(
        Object.keys(choice).sort(),
        choice.costs
          ? ["costs", "effects", "label", "result"]
          : ["effects", "label", "result"],
      );
      assert.ok(choice.label.trim(), `${card.id}.${direction} has no label`);
      assert.ok(choice.result.trim(), `${card.id}.${direction} has no result`);
      assert.deepEqual(Object.keys(choice.effects).sort(), EFFECT_KEYS);
      assert.ok(
        [0, 1].includes(choice.effects.eldritchLore),
        `${card.id}.${direction} has an invalid eldritchLore effect`,
      );
      assert.ok(
        [-1, 0, 1].includes(choice.effects.crew),
        `${card.id}.${direction} has an invalid crew effect`,
      );
      assert.ok(
        [-1, 0].includes(choice.effects.sanity),
        `${card.id}.${direction} has an invalid sanity effect`,
      );

      if (choice.costs) {
        paidChoices.push({ card, direction, choice });
        assert.ok(Object.keys(choice.costs).length > 0);
        assert.ok(
          Object.keys(choice.costs).every((resource) => COST_KEYS.includes(resource)),
          `${card.id}.${direction} defines a forbidden cost`,
        );
        assert.equal(Object.hasOwn(choice.costs, "sanity"), false);
        for (const [resource, amount] of Object.entries(choice.costs)) {
          assert.ok(
            Number.isInteger(amount) && amount > 0,
            `${card.id}.${direction} has an invalid ${resource} cost`,
          );
          assert.ok(
            choice.effects[resource] >= 0,
            `${card.id}.${direction} duplicates its ${resource} cost in effects`,
          );
        }
      }
    }
  }

  assert.equal(outcomes.length, 152);
  assert.ok(
    paidChoices.some(({ choice }) => choice.costs.crew === 1),
    "at least one choice must exercise a payable Crew cost",
  );
  assert.ok(
    paidChoices.every(({ card }) => card.deckId !== "it-begins-here"),
    "intro choices must remain free",
  );
  const effects = outcomes.map(({ effects }) => effects);
  assert.ok(effects.filter(({ eldritchLore }) => eldritchLore === 1).length >= 40);
  assert.ok(effects.filter(({ crew }) => crew === 1).length >= 8);
  assert.ok(effects.filter(({ crew }) => crew === -1).length >= 4);
  assert.ok(effects.filter(({ sanity }) => sanity === -1).length >= 20);
  assert.ok(
    outcomes.filter((choice) =>
      !choice.costs &&
      Object.values(choice.effects).every((value) => value === 0)).length >= 40,
    "the story needs plentiful neutral choices",
  );
});

test("cards are concise, locally grounded, and contain no unrelated hard-gate schema", () => {
  const allIntroSurfaces = DEEP_SOUTH_INTRO_CARDS.flatMap(introSurfaces);
  for (const surface of allIntroSurfaces) {
    assert.ok(surface.title.length <= 40);
    assert.ok(surface.text.length <= 220);
    assert.ok(surface.artAlt.length <= 160);
  }
  for (const card of DEEP_SOUTH_PLOT_CARDS) {
    assert.ok(card.title.length <= 40, `${card.id} has an overlong title`);
    assert.ok(card.text.length <= 150, `${card.id} has overlong prompt prose`);
    for (const { choice: { label, result } } of authoredChoices(card)) {
      assert.ok(label.length <= 40, `${card.id} has an overlong choice label`);
      assert.ok(result.length <= 100, `${card.id} has an overlong result`);
    }
  }

  const fullCorpus = [
    ...allIntroSurfaces.map(({ title, text, artAlt }) => `${title} ${text} ${artAlt}`),
    ...DEEP_SOUTH_PLOT_CARDS.map(({ title, text }) => `${title} ${text}`),
  ].join(" ");
  for (const localAnchor of ["Castro", "Chiloé", "42°36′S, 73°57′W", "palafitos"]) {
    assert.match(fullCorpus, new RegExp(localAnchor, "u"));
  }

  const expectedThemes = {
    castro: /harbor|palafitos|cathedral|dock/ui,
    "investigate-church": /church|choir|crypt|parish|sacristan/ui,
    "gather-crew": /crew|diver|harpooner|navigator|radio operator/ui,
    navigate: /channel|compass|hull|wake|bunk/ui,
    "rest-at-desolate-beach": /beach|camp|fire|surf|tide/ui,
    "reach-the-coordinates": /coordinates|horizon|masonry|sea|stone/ui,
    "explore-rlyeh": /chamber|city|door|street|walls/ui,
    "gather-evidence": /evidence|film|map|photograph|specimen|testimony/ui,
  };
  for (const deck of DEEP_SOUTH_PLOT_DECKS) {
    assert.match(plotCorpus(deck), expectedThemes[deck.id]);
  }

  const forbiddenGateKeys = new Set([
    "advanceDeck",
    "condition",
    "cost",
    "destinationDeckId",
    "gate",
    "gates",
    "locked",
    "minimum",
    "nextDeckId",
    "requirement",
    "requirements",
    "requires",
    "targetDeckId",
    "unlock",
    "unlocks",
  ]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenGateKeys.has(key), false, `hard gate key ${key} is forbidden`);
      visit(nested);
    }
  };
  visit(DEEP_SOUTH_STORY);
  assertDeeplyFrozenData(DEEP_SOUTH_STORY);
  assertDeeplyFrozenData(DEEP_SOUTH_INTRO_SKIP_CONFIRMATION, "skipConfirmation");
});

test("every deck resolves to one safe, local, accessible SVG asset", () => {
  const expectedFiles = DEEP_SOUTH_DECKS.map(({ artId }) => `${artId}.svg`).sort();
  const actualFiles = readdirSync(artDirectory)
    .filter((name) => name.startsWith("deep-south-") && name.endsWith(".svg"))
    .sort();
  assert.deepEqual(actualFiles, expectedFiles);
  assert.equal(new Set(DEEP_SOUTH_DECKS.map(({ artId }) => artId)).size, 9);

  for (const file of expectedFiles) {
    const path = join(artDirectory, file);
    assert.equal(existsSync(path), true, `${file} is missing`);
    const source = readFileSync(path, "utf8");
    assert.match(source, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
    assert.match(source, /\bviewBox="0 0 400 400"/u);
    assert.match(source, /<title id="title">[^<]+<\/title>/u);
    assert.match(source, /<desc id="desc">[^<]+<\/desc>/u);
    assert.doesNotMatch(
      source,
      /<(?:script|foreignObject|iframe|object|embed|image|style)\b/ui,
    );
    assert.doesNotMatch(source, /\son[a-z]+\s*=/ui);
    assert.doesNotMatch(source, /\b(?:href|xlink:href)\s*=/ui);
    const contentWithoutSvgNamespace = source.replace(
      'xmlns="http://www.w3.org/2000/svg"',
      "",
    );
    assert.doesNotMatch(contentWithoutSvgNamespace, /(?:https?:|data:|javascript:)/ui);
  }
});

test("every Intro surface resolves to one consistent local raster asset", () => {
  const introSurfaces = [
    ...Object.values(DEEP_SOUTH_INTRO_CARDS[0].faces),
    ...DEEP_SOUTH_INTRO_CARDS.slice(1),
  ];
  const expectedIds = introSurfaces.map(({ artId }) => artId);
  assert.deepEqual(INTRO_RASTER_ART_IDS, expectedIds);
  assert.equal(new Set(expectedIds).size, 9);

  for (const artId of expectedIds) {
    assert.equal(artSourceForId(artId), `/assets/art/${artId}.png`);
    const path = join(artDirectory, `${artId}.png`);
    assert.equal(existsSync(path), true, `${artId}.png is missing`);
    const bytes = readFileSync(path);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${artId}.png is not a PNG`,
    );
    assert.equal(bytes.readUInt32BE(16), 960, `${artId}.png has the wrong width`);
    assert.equal(bytes.readUInt32BE(20), 540, `${artId}.png has the wrong height`);
  }

  assert.equal(
    artSourceForId("deep-south-it-begins-here"),
    "/assets/art/deep-south-it-begins-here.svg",
  );
});
