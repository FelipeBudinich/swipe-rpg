import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EMBER_CROWN_ARC } from "../public/js/data/arcs/ember-crown.js";
import { EMBER_CROWN_CARDS as cards } from "../public/js/data/cards/ember-crown-cards.js";
import { EMBER_CROWN_ENEMIES as enemies } from "../public/js/data/ember-crown-enemies.js";
import { items } from "../public/js/data/items.js";
import { cardHasAvailableChoice, requirementsMet } from "../public/js/game/requirements.js";
import { createInitialState } from "../public/js/game/state.js";
import {
  getEligibleStoryCards,
  isStoryEncounterCard,
} from "../public/js/game/story/story-selector.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function uniqueIds(definitions) {
  return new Set(definitions.map(({ id }) => id)).size === definitions.length;
}

function nestedTypes(definitions, key) {
  return new Set(
    definitions.flatMap((card) =>
      key === "requirements"
        ? [
            ...(card.requirements ?? []),
            ...(card.left?.requirements ?? []),
            ...(card.right?.requirements ?? []),
          ].map(({ type }) => type)
        : [...(card.left?.effects ?? []), ...(card.right?.effects ?? [])].map(({ type }) => type),
    ),
  );
}

function assertImmutableDataOnly(value, path = "content") {
  assert.notEqual(typeof value, "function", `${path} contains executable content`);
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
  for (const [key, nested] of Object.entries(value)) {
    assertImmutableDataOnly(nested, `${path}.${key}`);
  }
}

test("The Ember Crown content meets the complete arc breadth and identity constraints", () => {
  assert.equal(EMBER_CROWN_ARC.title, "The Ember Crown");
  assert.ok(cards.length >= 45 && cards.length <= 60);
  assert.ok(cards.filter((card) => Object.keys(card.story.beatWeights).length > 1).length >= 10);
  assert.ok(enemies.filter((enemy) => !enemy.isBoss && !enemy.isMidboss && !enemy.isFinalBoss).length >= 6);
  assert.equal(enemies.filter((enemy) => enemy.isMidboss).length, 1);
  assert.equal(enemies.filter((enemy) => enemy.isFinalBoss).length, 1);
  assert.ok(items.filter((item) => item.type === "equipment").length >= 12);
  assert.deepEqual(
    new Set(items.filter((item) => item.type === "equipment").map((item) => item.slot)),
    new Set(["weapon", "armor", "charm"]),
  );
  assert.ok(items.some((item) => item.useEffects?.some((effect) => effect.type === "heal")));
  assert.ok(items.some((item) => item.useEffects?.some((effect) => effect.type === "restoreMp")));
  assert.ok(items.some((item) => (item.useEffects?.length ?? 0) > 1));
  assert.ok(uniqueIds(cards));
  assert.ok(uniqueIds(enemies));
  assert.ok(uniqueIds(items));
});

test("content exercises the story-specific declarative requirements and effects", () => {
  const requirementTypes = nestedTypes(cards, "requirements");
  const effectTypes = nestedTypes(cards, "effects");

  for (const type of [
    "minMp",
    "minGold",
    "itemOwned",
    "specificEnemyDefeated",
    "storyFactEquals",
    "storyFactExists",
  ]) {
    assert.ok(requirementTypes.has(type), `missing requirement content: ${type}`);
  }

  for (const type of [
    "modifyMp",
    "modifyGold",
    "addXp",
    "heal",
    "restoreMp",
    "setStoryFact",
    "incrementStoryCounter",
    "startStoryEncounter",
    "addItem",
    "removeSpecificNonKeyItem",
    "queueBeatCard",
    "applyBoundedHpLoss",
    "setFinalPlan",
    "selectEnding",
  ]) {
    assert.ok(effectTypes.has(type), `missing effect content: ${type}`);
  }

  assert.equal(requirementTypes.has("journeyStep"), false);
  assert.equal(effectTypes.has("modifyJourneyStep"), false);
  assert.equal(effectTypes.has("advanceBeat"), false);
  assert.ok(cards.every((card) => typeof card.story.countsTowardStory === "boolean"));
});

test("content definitions are deeply immutable data with no callbacks", () => {
  assertImmutableDataOnly(cards, "cards");
  assertImmutableDataOnly(enemies, "enemies");
  assertImmutableDataOnly(items, "items");
  assertImmutableDataOnly(EMBER_CROWN_ARC, "arc");
});

test("every authored art reference resolves to a local SVG", () => {
  const artIds = new Set([
    "player",
    ...cards.map(({ artId }) => artId),
    ...enemies.map(({ artId }) => artId),
    ...items.map(({ artId }) => artId),
  ]);

  for (const artId of artIds) {
    assert.equal(typeof artId, "string");
    assert.ok(
      existsSync(join(root, "public", "assets", "art", `${artId}.svg`)),
      `missing local SVG: ${artId}`,
    );
  }
});

test("Opening Image deterministically exposes its required first card and no encounter", () => {
  const state = createInitialState({ seed: 2 });
  const beat = EMBER_CROWN_ARC.beats[0];
  const eligible = getEligibleStoryCards(state, cards, beat, {
    evaluateRequirements: requirementsMet,
    cardHasAvailableChoice,
    context: { items },
    enemies,
  });

  assert.deepEqual(eligible.map(({ id }) => id), ["opening-hearthvale-oath"]);
  assert.equal(eligible.some(isStoryEncounterCard), false);
  assert.equal(beat.encounterPolicy.mode, "none");
});
