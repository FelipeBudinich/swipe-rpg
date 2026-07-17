import test from "node:test";
import assert from "node:assert/strict";

import { EMBER_CROWN_ARC } from "../public/js/data/arcs/ember-crown.js";
import { EMBER_CROWN_CARDS } from "../public/js/data/cards/ember-crown-cards.js";
import { EMBER_CROWN_ENEMIES } from "../public/js/data/ember-crown-enemies.js";
import { items } from "../public/js/data/items.js";
import {
  ArcValidationError,
  validateArcDefinition,
  validateArcDefinitions,
} from "../public/js/game/story/arc-validator.js";

const PHASE_IDS = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `phase-${index + 1}`),
);
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
  const beats = PHASE_IDS.map((id, index) => {
    const completionTag = `${id}-complete`;
    const beat = {
      id,
      name: `Phase ${index + 1}`,
      act: `Movement ${Math.floor(index / 3) + 1}`,
      budget: { minimum: 1, target: 2, maximum: 3 },
      completionObjective: {
        type: "storyTagResolved",
        tag: completionTag,
      },
      encounterPolicy: { mode: "none" },
    };
    cards.push(makeCard(`completion-${id}`, id, "completion", [completionTag]));
    return beat;
  });

  const anchorBeat = beats[3];
  const anchorCard = makeCard("phase-4-anchor", anchorBeat.id, "anchor");
  cards.splice(
    cards.findIndex(({ id }) => id === "completion-phase-4"),
    1,
    anchorCard,
  );
  anchorBeat.completionObjective = { type: "anchorResolved" };
  anchorBeat.anchor = {
    variants: [{ cardId: anchorCard.id, requirements: [], weight: 1 }],
    fallbackCardId: anchorCard.id,
  };

  const bossBeat = beats[7];
  bossBeat.bossEnemyId = "test-final-boss";
  bossBeat.completionObjective = {
    type: "specificEnemyDefeated",
    enemyId: "test-final-boss",
  };
  bossBeat.encounterPolicy = { mode: "boss-only" };

  const terminalBeat = beats[8];
  const firstEndingCard = makeCard("ending-home", terminalBeat.id, "ending");
  const secondEndingCard = makeCard("ending-away", terminalBeat.id, "ending");
  cards.splice(
    cards.findIndex(({ id }) => id === "completion-phase-9"),
    1,
    firstEndingCard,
    secondEndingCard,
  );
  terminalBeat.completionObjective = { type: "anchorResolved" };
  terminalBeat.anchor = {
    variants: [
      {
        cardId: firstEndingCard.id,
        requirements: [{ type: "endingSelected", endingId: "home" }],
        weight: 1,
      },
      {
        cardId: secondEndingCard.id,
        requirements: [{ type: "endingSelected", endingId: "away" }],
        weight: 1,
      },
    ],
    fallbackCardId: firstEndingCard.id,
  };

  return {
    arc: {
      id: "validator-arc",
      title: "Validator Arc",
      beatIds: [...PHASE_IDS],
      beats,
      transitionBeatIds: ["phase-4", "phase-8"],
      endingBeatId: terminalBeat.id,
      finalBossId: "test-final-boss",
      endings: [
        {
          id: "home",
          title: "Home",
          terminalCardIds: [firstEndingCard.id],
        },
        {
          id: "away",
          title: "Away",
          terminalCardIds: [secondEndingCard.id],
        },
      ],
    },
    cards,
  };
}

test("validates an arbitrary ordered nine-phase arc and derives its authored budgets", () => {
  const { arc, cards } = validFixture();
  assert.equal(arc.beats.some(({ id }) => ["finale", "finalImage"].includes(id)), false);
  assert.deepEqual(validateArcDefinition(arc, cards, {
    enemies: [{ id: "test-final-boss" }],
  }), {
    valid: true,
    errors: [],
    arcId: "validator-arc",
    totals: { minimum: 9, target: 18, maximum: 27 },
    cardCount: 10,
  });
});

test("keeps the existing Ember Crown content valid without canonical beat checks", () => {
  const result = validateArcDefinition(EMBER_CROWN_ARC, EMBER_CROWN_CARDS, {
    enemies: EMBER_CROWN_ENEMIES,
    items,
    contentCountRange: { minimum: 45, maximum: 60 },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.totals, { minimum: 30, target: 35, maximum: 40 });
});

test("rejects invalid authored order, identifiers, names, budgets, and anchors", () => {
  const { arc, cards } = validFixture();
  [arc.beats[0], arc.beats[1]] = [arc.beats[1], arc.beats[0]];
  arc.beats[1].name = arc.beats[0].name;
  arc.beats.find(({ id }) => id === "phase-1").budget.target = 4;
  arc.beats.find(({ id }) => id === "phase-2").budget.minimum = -1;
  arc.beats.find(({ id }) => id === "phase-4").anchor.fallbackCardId = null;
  assert.throws(
    () => validateArcDefinition(arc, cards),
    (error) =>
      error instanceof ArcValidationError &&
      /beatIds must match the ordered beats exactly/.test(error.message) &&
      /Duplicate beat name/.test(error.message) &&
      /target greater than maximum/.test(error.message) &&
      /minimum budget must be a non-negative integer/.test(error.message) &&
      /fallbackCardId/.test(error.message),
  );
});

test("rejects completion gaps and malformed metadata-driven terminal content", () => {
  const { arc, cards } = validFixture();
  const completionCard = cards.find(({ id }) => id === "completion-phase-5");
  completionCard.story.role = "ambient";
  completionCard.story.completionTags = [];
  const bossBeat = arc.beats.find(({ id }) => id === "phase-8");
  bossBeat.bossEnemyId = null;
  bossBeat.completionObjective = {
    type: "storyTagResolved",
    tag: "phase-8-complete",
  };
  delete arc.finalBossId;
  arc.endings.find(({ id }) => id === "away").terminalCardIds = [];
  arc.endingBeatId = "missing-phase";
  assert.throws(
    () => validateArcDefinition(arc, cards),
    (error) =>
      error instanceof ArcValidationError &&
      /phase-5 has no possible completion-card candidate/.test(error.message) &&
      /Boss-only beat phase-8 must identify its boss/.test(error.message) &&
      /Ending away has no terminal card variant/.test(error.message) &&
      /terminal beat references unknown beat missing-phase/.test(error.message),
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
