import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EMBER_CROWN_ARC,
  EMBER_CROWN_BEAT_IDS,
} from "../public/js/data/arcs/ember-crown.js";
import {
  EMBER_CROWN_CARDS,
  EMBER_CROWN_CARD_BY_ID,
} from "../public/js/data/cards/ember-crown-cards.js";
import {
  EMBER_CROWN_ENEMIES,
  EMBER_CROWN_ENEMY_BY_ID,
} from "../public/js/data/ember-crown-enemies.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_BEAT_NAMES = [
  "Opening Image",
  "Theme Stated",
  "Setup",
  "Catalyst",
  "Debate",
  "Break into Two",
  "B Story",
  "Fun and Games",
  "Midpoint",
  "Bad Guys Close In",
  "All Is Lost",
  "Dark Night of the Soul",
  "Break into Three",
  "Finale",
  "Final Image",
];

function choiceEffects(card) {
  return [...(card.left?.effects ?? []), ...(card.right?.effects ?? [])];
}

function effectExists(card, type, predicate = () => true) {
  return choiceEffects(card).some((effect) => effect.type === type && predicate(effect));
}

function assertDeeplyFrozenData(value, path = "content") {
  assert.notEqual(typeof value, "function", `${path} contains a callback`);
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
  for (const [key, nested] of Object.entries(value)) {
    assertDeeplyFrozenData(nested, `${path}.${key}`);
  }
}

test("The Ember Crown defines the exact ordered Save the Cat beats and budgets", () => {
  assert.equal(EMBER_CROWN_ARC.id, "ember-crown");
  assert.deepEqual(EMBER_CROWN_BEAT_IDS, [
    "openingImage",
    "themeStated",
    "setup",
    "catalyst",
    "debate",
    "breakIntoTwo",
    "bStory",
    "funAndGames",
    "midpoint",
    "badGuysCloseIn",
    "allIsLost",
    "darkNightOfTheSoul",
    "breakIntoThree",
    "finale",
    "finalImage",
  ]);
  assert.deepEqual(EMBER_CROWN_ARC.beats.map(({ id }) => id), EMBER_CROWN_BEAT_IDS);
  assert.deepEqual(EMBER_CROWN_ARC.beats.map(({ name }) => name), EXPECTED_BEAT_NAMES);

  const totals = EMBER_CROWN_ARC.beats.reduce(
    (sum, { budget }) => ({
      min: sum.min + budget.min,
      target: sum.target + budget.target,
      max: sum.max + budget.max,
    }),
    { min: 0, target: 0, max: 0 },
  );
  assert.deepEqual(totals, { min: 30, target: 35, max: 40 });
  for (const { budget } of EMBER_CROWN_ARC.beats) {
    assert.ok(budget.min <= budget.target);
    assert.ok(budget.target <= budget.max);
  }
});

test("authored story content has the required breadth, multi-beat reuse, and data-only schema", () => {
  assert.equal(EMBER_CROWN_CARDS.length, 56);
  assert.ok(EMBER_CROWN_CARDS.length >= 45 && EMBER_CROWN_CARDS.length <= 60);
  assert.equal(new Set(EMBER_CROWN_CARDS.map(({ id }) => id)).size, EMBER_CROWN_CARDS.length);
  assert.ok(
    EMBER_CROWN_CARDS.filter((card) => Object.keys(card.story.beatWeights).length > 1).length >= 10,
  );

  for (const card of EMBER_CROWN_CARDS) {
    assert.deepEqual(card.story.arcIds, ["ember-crown"]);
    assert.equal(typeof card.story.countsTowardStory, "boolean", `${card.id} omits story counting`);
    assert.equal(card.story.countsTowardStory, true);
    assert.ok(["entry", "ambient", "completion", "anchor", "ending"].includes(card.story.role));
    assert.ok(Object.keys(card.story.beatWeights).length > 0);
    assert.ok(Object.values(card.story.beatWeights).every((weight) => weight > 0));
    assert.ok(choiceEffects(card).every((effect) => effect.type !== "advanceBeat"));
  }

  assertDeeplyFrozenData(EMBER_CROWN_CARDS, "emberCrownCards");
  assertDeeplyFrozenData(EMBER_CROWN_ARC, "emberCrownArc");
  assertDeeplyFrozenData(EMBER_CROWN_ENEMIES, "emberCrownEnemies");
});

test("all seven major beats have persisted variant families and unconditional card fallbacks", () => {
  const expected = [
    "catalyst",
    "breakIntoTwo",
    "midpoint",
    "allIsLost",
    "breakIntoThree",
    "finale",
    "finalImage",
  ];
  const anchorBeats = EMBER_CROWN_ARC.beats.filter(({ anchor }) => anchor);
  assert.deepEqual(anchorBeats.map(({ id }) => id), expected);
  assert.ok(anchorBeats.filter(({ anchor }) => anchor.variants.length >= 2).length >= 4);

  for (const beat of anchorBeats) {
    assert.ok(beat.anchor.variants.length >= 2, `${beat.id} needs meaningful variants`);
    assert.equal(typeof beat.anchor.minimumCardsBeforeAnchor, "number");
    assert.equal(typeof beat.anchor.requiredAsFirstCard, "boolean");
    for (const variant of beat.anchor.variants) {
      const card = EMBER_CROWN_CARD_BY_ID[variant.cardId];
      assert.ok(card, `unknown anchor variant ${variant.cardId}`);
      assert.equal(card.story.role, beat.id === "finalImage" ? "ending" : "anchor");
      assert.deepEqual(Object.keys(card.story.beatWeights), [beat.id]);
      assert.equal(card.baseWeight, 0);
    }
    const fallback = EMBER_CROWN_CARD_BY_ID[beat.anchor.fallbackCardId];
    assert.ok(fallback, `unknown fallback ${beat.anchor.fallbackCardId}`);
    assert.deepEqual(fallback.requirements, [], `${beat.id} fallback is not unconditional`);
  }

  assert.equal(EMBER_CROWN_ARC.beats.find(({ id }) => id === "finale").anchor.minimumCardsBeforeAnchor, 2);
  assert.equal(
    EMBER_CROWN_ARC.beats.find(({ id }) => id === "midpoint").anchor.requiredAsFirstCard,
    true,
  );
});

test("forced sequences remain beat-local and cross-beat choices drive later authored variants", () => {
  assert.equal(EMBER_CROWN_ARC.forcedSequences.length, 2);
  for (const sequence of EMBER_CROWN_ARC.forcedSequences) {
    assert.equal(sequence.cardIds.length, 2);
    const [openerId, followupId] = sequence.cardIds;
    const opener = EMBER_CROWN_CARD_BY_ID[openerId];
    const followup = EMBER_CROWN_CARD_BY_ID[followupId];
    assert.ok(opener && followup);
    assert.ok(effectExists(opener, "queueBeatCard", (effect) =>
      effect.cardId === followupId && effect.originatingBeatId === sequence.beatId));
    assert.equal(followup.forcedOnly, true);
    assert.equal(followup.baseWeight, 0);
    assert.ok(Object.hasOwn(followup.story.beatWeights, sequence.beatId));
  }

  assert.ok(effectExists(EMBER_CROWN_CARD_BY_ID["setup-evacuation-cart"], "setStoryFact", ({ key }) =>
    key === "helpedEvacuation"));
  assert.ok(
    EMBER_CROWN_ARC.beats.find(({ id }) => id === "catalyst").anchor.variants.some((variant) =>
      variant.requirements.some(({ key }) => key === "helpedEvacuation")),
  );
  assert.ok(effectExists(EMBER_CROWN_CARD_BY_ID["debate-serins-map"], "setStoryFact", ({ key }) =>
    key === "trustedSerinRoute"));
  assert.ok(
    EMBER_CROWN_ARC.beats.find(({ id }) => id === "breakIntoTwo").anchor.variants.some((variant) =>
      variant.requirements.some(({ key }) => key === "trustedSerinRoute")),
  );
  assert.ok(effectExists(EMBER_CROWN_CARD_BY_ID["fun-pilgrim-bridge"], "setStoryFact", ({ key }) =>
    key === "helpedPilgrims"));
  assert.deepEqual(EMBER_CROWN_CARD_BY_ID["bad-pilgrims-return"].requirements, [
    { type: "storyFactEquals", key: "helpedPilgrims", value: true },
  ]);
  assert.ok(effectExists(EMBER_CROWN_CARD_BY_ID["b-story-order-doubt"], "setStoryFact", ({ key }) =>
    key === "trustedSerin"));
  assert.ok(
    EMBER_CROWN_ARC.beats.find(({ id }) => id === "breakIntoThree").anchor.variants.some((variant) =>
      variant.requirements.some(({ key }) => key === "trustedSerin")),
  );
});

test("Midpoint is a two-card mandatory midboss sequence with a gated aftermath", () => {
  const midpoint = EMBER_CROWN_ARC.beats.find(({ id }) => id === "midpoint");
  assert.deepEqual(midpoint.budget, { min: 2, target: 2, max: 2 });
  assert.equal(midpoint.encounterPolicy.mode, "boss-only");
  assert.equal(EMBER_CROWN_ARC.midbossId, "iron-wyvern");

  const introIds = new Set([
    ...midpoint.anchor.variants.map(({ cardId }) => cardId),
    midpoint.anchor.fallbackCardId,
  ]);
  for (const id of introIds) {
    const card = EMBER_CROWN_CARD_BY_ID[id];
    assert.ok(effectExists(card, "startStoryEncounter", ({ enemyId, required }) =>
      enemyId === "iron-wyvern" && required === true));
    assert.ok(effectExists(card, "queueBeatCard", ({ cardId, originatingBeatId }) =>
      cardId === "midpoint-wyvern-aftermath" && originatingBeatId === "midpoint"));
  }

  const aftermath = EMBER_CROWN_CARD_BY_ID["midpoint-wyvern-aftermath"];
  assert.equal(aftermath.forcedOnly, true);
  assert.deepEqual(aftermath.requirements, [
    { type: "specificEnemyDefeated", enemyId: "iron-wyvern" },
  ]);
  assert.ok(aftermath.story.completionTags.includes("midpoint-revelation"));

  const wyvern = EMBER_CROWN_ENEMY_BY_ID["iron-wyvern"];
  assert.equal(wyvern.isMidboss, true);
  assert.equal(wyvern.dropChance, 1);
  assert.ok(wyvern.xpReward >= 40 && wyvern.goldMin >= 15);
  assert.ok(wyvern.intentProfile.enragedWeights.charge > wyvern.intentWeights.charge);
});

test("All Is Lost variants are concrete recoverable setbacks, never fake defeats", () => {
  const beat = EMBER_CROWN_ARC.beats.find(({ id }) => id === "allIsLost");
  const ids = new Set([
    ...beat.anchor.variants.map(({ cardId }) => cardId),
    beat.anchor.fallbackCardId,
  ]);
  assert.equal(ids.size, 4);

  for (const id of ids) {
    const card = EMBER_CROWN_CARD_BY_ID[id];
    assert.ok(effectExists(card, "setStoryFact", ({ key }) => key === "allIsLostSetback"));
    assert.equal(effectExists(card, "startStoryEncounter"), false);
    for (const effect of choiceEffects(card).filter(({ type }) => type === "applyBoundedHpLoss")) {
      assert.equal(effect.minimumHp, 1);
    }
    for (const effect of choiceEffects(card).filter(({ type }) => type === "removeSpecificNonKeyItem")) {
      assert.equal(effect.questCritical, false);
    }
  }
});

test("Finale has a two-phase boss, ordinary ending choice, and exactly two final images", () => {
  const finale = EMBER_CROWN_ARC.beats.find(({ id }) => id === "finale");
  assert.deepEqual(finale.budget, { min: 3, target: 4, max: 5 });
  assert.equal(finale.anchor.minimumCardsBeforeAnchor, 2);
  assert.equal(EMBER_CROWN_ARC.finalBossId, "malrec-crown-bound");

  for (const { cardId } of finale.anchor.variants) {
    const intro = EMBER_CROWN_CARD_BY_ID[cardId];
    assert.ok(effectExists(intro, "startStoryEncounter", ({ enemyId }) =>
      enemyId === "malrec-crown-bound"));
    assert.ok(effectExists(intro, "queueBeatCard", ({ cardId }) =>
      cardId === "finale-fate-of-the-crown"));
  }

  const boss = EMBER_CROWN_ENEMY_BY_ID["malrec-crown-bound"];
  assert.equal(boss.isFinalBoss, true);
  assert.equal(boss.phases.length, 2);
  assert.equal(boss.phases[0].aboveHpPercent, 0.5);
  assert.equal(boss.phases[1].atOrBelowHpPercent, 0.5);
  assert.ok(boss.storyFactModifiers.some(({ requirements }) =>
    requirements.some(({ key }) => key === "disruptedCinderForges")));

  assert.deepEqual(EMBER_CROWN_ARC.endings.map(({ id }) => id), [
    "crown-of-dawn",
    "unbound-flame",
  ]);
  const resolution = EMBER_CROWN_CARD_BY_ID["finale-fate-of-the-crown"];
  assert.deepEqual(
    [resolution.left, resolution.right].map((choice) =>
      choice.effects.find(({ type }) => type === "selectEnding").endingId),
    ["crown-of-dawn", "unbound-flame"],
  );
  assert.deepEqual(EMBER_CROWN_ARC.endings.map(({ finalImageCardIds }) => finalImageCardIds), [
    ["final-image-crown-of-dawn"],
    ["final-image-unbound-flame"],
  ]);
  assert.notEqual(
    EMBER_CROWN_CARD_BY_ID["final-image-crown-of-dawn"].text,
    EMBER_CROWN_CARD_BY_ID["final-image-unbound-flame"].text,
  );
});

test("encounter policies and enemy pools match the narrative phase", () => {
  const policy = Object.fromEntries(
    EMBER_CROWN_ARC.beats.map((beat) => [beat.id, beat.encounterPolicy]),
  );
  assert.deepEqual(
    EMBER_CROWN_ARC.beats.map(({ encounterPolicy }) => encounterPolicy.mode),
    [
      "none",
      "none",
      "random",
      "scripted-only",
      "random",
      "scripted-only",
      "none",
      "random",
      "boss-only",
      "random",
      "scripted-only",
      "none",
      "scripted-only",
      "boss-only",
      "none",
    ],
  );
  assert.equal(policy.setup.maximumRandomEncounters, 1);
  assert.equal(policy.setup.minimumCardsBeforeEncounter, 1);
  assert.ok(policy.setup.allowedEnemyTags.includes("weak"));
  assert.ok(policy.funAndGames.allowedEnemyTags.length > policy.setup.allowedEnemyTags.length);
  assert.ok(policy.badGuysCloseIn.weightMultiplier > policy.funAndGames.weightMultiplier);

  assert.equal(EMBER_CROWN_ENEMIES.filter((enemy) => !enemy.isBoss).length, 9);
  assert.ok(EMBER_CROWN_ENEMIES.filter((enemy) => !enemy.isBoss).length >= 6);
  assert.equal(EMBER_CROWN_ENEMIES.filter(({ isMidboss }) => isMidboss).length, 1);
  assert.equal(EMBER_CROWN_ENEMIES.filter(({ isFinalBoss }) => isFinalBoss).length, 1);
});

test("all authored art is local and new SVGs contain no executable or external content", () => {
  const artIds = new Set([
    ...EMBER_CROWN_CARDS.map(({ artId }) => artId),
    ...EMBER_CROWN_ENEMIES.map(({ artId }) => artId),
  ]);
  for (const artId of artIds) {
    const path = join(root, "public", "assets", "art", `${artId}.svg`);
    const source = readFileSync(path, "utf8");
    assert.match(source, /^<svg\b/);
    const withoutNamespace = source.replace('xmlns="http://www.w3.org/2000/svg"', "");
    assert.doesNotMatch(
      withoutNamespace,
      /<script\b|\son[a-z]+\s*=|javascript:|(?:href|src)\s*=\s*["'](?:https?:|data:|\/\/)/i,
    );
  }

  for (const artId of ["npc-serin", "enemy-iron-wyvern", "enemy-malrec-crown-bound"]) {
    assert.ok(artIds.has(artId));
  }
});

test("story facts stay concrete and no abstract morality or alignment score is authored", () => {
  const serialized = JSON.stringify({
    arc: EMBER_CROWN_ARC,
    cards: EMBER_CROWN_CARDS,
    enemies: EMBER_CROWN_ENEMIES,
  });
  assert.doesNotMatch(serialized, /"(?:morality|karma|good|evil|virtue|cruelty|loyaltyScore|alignment)"/i);
  assert.doesNotMatch(serialized, /advanceBeat/);
});
