import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BEAT_BUDGETS,
  MAJOR_ANCHOR_BEAT_IDS,
  STORY_BEATS,
} from "../public/js/game/story/constants.js";
import {
  ArcValidationError,
  validateArcDefinition,
  validateArcDefinitions,
} from "../public/js/game/story/arc-validator.js";

const choice = { label: "Choose", resultText: "Chosen.", effects: [] };
const makeCard = (id, beatId, role, completionTags = []) => ({
  id,
  baseWeight: 1,
  cooldown: 0,
  oncePerRun: true,
  requirements: [],
  left: structuredClone(choice),
  right: structuredClone(choice),
  story: {
    arcIds: ["validator-arc"],
    beatWeights: { [beatId]: 1 },
    role,
    completionTags,
    countsTowardStory: true,
  },
});

function validFixture() {
  const cards = [];
  const beats = STORY_BEATS.map((definition) => {
    const beat = {
      ...definition,
      budget: { ...DEFAULT_BEAT_BUDGETS[definition.id] },
      completionObjective: {
        type: "storyTagResolved",
        tag: `${definition.id}-complete`,
      },
      encounterPolicy: { mode: "none" },
    };
    if (MAJOR_ANCHOR_BEAT_IDS.includes(definition.id)) {
      const cardId = `anchor-${definition.id}`;
      beat.completionObjective = { type: "anchorResolved" };
      beat.anchor = {
        variants: [{ cardId, requirements: [], weight: 1 }],
        fallbackCardId: cardId,
      };
      cards.push(
        makeCard(
          cardId,
          definition.id,
          definition.id === "finalImage" ? "ending" : "anchor",
        ),
      );
    } else {
      cards.push(
        makeCard(
          `completion-${definition.id}`,
          definition.id,
          "completion",
          [`${definition.id}-complete`],
        ),
      );
    }
    if (definition.id === "finale") beat.bossEnemyId = "test-final-boss";
    return beat;
  });

  const secondEndingCard = makeCard("final-image-second", "finalImage", "ending");
  cards.push(secondEndingCard);
  beats.at(-1).anchor.variants.push({
    cardId: secondEndingCard.id,
    requirements: [{ type: "endingSelected", endingId: "ending-two" }],
    weight: 1,
  });

  return {
    arc: {
      id: "validator-arc",
      title: "Validator Arc",
      beats,
      finalBossId: "test-final-boss",
      endings: [
        {
          id: "ending-one",
          title: "Ending One",
          finalImageCardIds: ["anchor-finalImage"],
        },
        {
          id: "ending-two",
          title: "Ending Two",
          finalImageCardIds: ["final-image-second"],
        },
      ],
    },
    cards,
  };
}

test("validates the exact 15-beat order and 30 / 35 / 40 budgets", () => {
  const { arc, cards } = validFixture();
  assert.deepEqual(validateArcDefinition(arc, cards, {
    enemies: [{ id: "test-final-boss" }],
  }), {
    valid: true,
    errors: [],
    arcId: "validator-arc",
    totals: { minimum: 30, target: 35, maximum: 40 },
    cardCount: cards.length,
  });
});

test("rejects reordered/missing beats, invalid budgets, and malformed anchors", () => {
  const { arc, cards } = validFixture();
  [arc.beats[0], arc.beats[1]] = [arc.beats[1], arc.beats[0]];
  arc.beats.find(({ id }) => id === "catalyst").anchor.fallbackCardId = null;
  arc.beats.find(({ id }) => id === "setup").budget.target = 99;
  assert.throws(
    () => validateArcDefinition(arc, cards),
    (error) =>
      error instanceof ArcValidationError &&
      /Beat 1 must be openingImage/.test(error.message) &&
      /fallbackCardId/.test(error.message) &&
      /target greater than maximum/.test(error.message),
  );
});

test("rejects unknown references, direct advanceBeat effects, and morality-like state", () => {
  const { arc, cards } = validFixture();
  cards[0].left.effects.push(
    { type: "queueCard", cardId: "missing-card" },
    { type: "advanceBeat" },
    { type: "setStoryFact", key: "morality", value: 1 },
  );
  assert.throws(
    () => validateArcDefinition(arc, cards),
    (error) =>
      /queues unknown card missing-card/.test(error.message) &&
      /attempts to advance the beat directly/.test(error.message) &&
      /abstract morality or alignment score/.test(error.message),
  );
});

test("rejects duplicate arc IDs across a registry", () => {
  const { arc, cards } = validFixture();
  assert.throws(
    () => validateArcDefinitions([arc, structuredClone(arc)], { [arc.id]: cards }),
    /Duplicate arc ID/,
  );
});
