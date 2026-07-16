import test from "node:test";
import assert from "node:assert/strict";

import { applyEffect, applyEffects, resourceChanges } from "../public/js/game/effects.js";
import { createInitialState } from "../public/js/game/state.js";

const items = [
  { id: "ward", type: "equipment", slot: "charm", statModifiers: { maxHp: 5, maxMp: 2 } },
  { id: "tonic", type: "consumable", slot: null, statModifiers: {} },
  { id: "ember-core", type: "key", keyItem: true, questCritical: true, slot: null, statModifiers: {} },
];

test("HP and MP effects clamp to equipment-derived maxima and zero", () => {
  let state = createInitialState({ seed: 2 });
  state = {
    ...state,
    player: {
      ...state.player,
      hp: 3,
      mp: 1,
      equipment: { ...state.player.equipment, charm: "ward" },
    },
  };
  state = applyEffects(
    state,
    [
      { type: "modifyHp", amount: -99 },
      { type: "modifyMp", amount: -99 },
      { type: "heal", amount: 999 },
      { type: "restoreMp", amount: 999 },
    ],
    { items },
  );
  assert.equal(state.player.hp, 35);
  assert.equal(state.player.mp, 12);

  state = { ...state, player: { ...state.player, hp: 1 } };
  state = applyEffect(state, { type: "healPercent", percent: 0.25 }, { items });
  assert.equal(state.player.hp, 10);
});

test("gold cannot become negative unless debt is explicitly allowed", () => {
  const state = { ...createInitialState({ seed: 3 }), player: { ...createInitialState({ seed: 3 }).player, gold: 2 } };
  const clamped = applyEffect(state, { type: "modifyGold", amount: -9 });
  assert.equal(clamped.player.gold, 0);
  const debt = applyEffect(state, { type: "modifyGold", amount: -9, allowDebt: true, floor: -20 });
  assert.equal(debt.player.gold, -7);
});

test("story facts, counters, tags, beat-local queues, endings, and discoveries execute centrally", () => {
  const before = createInitialState({ seed: 4 });
  const after = applyEffects(
    before,
    [
      { type: "setFlag", flag: "bell", value: true },
      { type: "queueCard", cardId: "bell-answer" },
      { type: "setStoryFact", key: "trustedSerin", value: true },
      { type: "setStoryFact", key: "temporaryFact", value: true },
      { type: "clearStoryFact", key: "temporaryFact" },
      { type: "incrementStoryCounter", key: "villagersRescued", amount: 2 },
      { type: "recordStoryTag", tag: "renewed-purpose" },
      { type: "queueBeatCard", cardId: "midpoint-aftermath" },
      { type: "setFinalPlan", plan: "infiltrateCitadel" },
      { type: "selectEnding", endingId: "crown-of-dawn" },
      { type: "addItem", itemId: "tonic", count: 2 },
      { type: "removeItem", itemId: "tonic", count: 1 },
      { type: "recordDiscovery", discoveryId: "hidden-star" },
      { type: "setRunStat", stat: "omens", operation: "increment", amount: 2 },
      { type: "clearFlag", flag: "bell" },
    ],
    { items },
  );
  assert.deepEqual(after.player.inventory, ["tonic"]);
  assert.deepEqual(after.run.forcedCardQueue, [
    "bell-answer",
    { cardId: "midpoint-aftermath", originBeatId: "openingImage", beatLocal: true },
  ]);
  assert.equal(after.story.facts.trustedSerin, true);
  assert.equal(after.story.facts.temporaryFact, undefined);
  assert.equal(after.story.facts.villagersRescued, 2);
  assert.equal(after.story.facts.finalPlan, "infiltrateCitadel");
  assert.ok(after.story.resolvedStoryTags.includes("renewed-purpose"));
  assert.equal(after.story.endingId, "crown-of-dawn");
  assert.equal(after.story.endingTitle, "Crown of Dawn");
  assert.equal(after.run.newEndingDiscovered, true);
  assert.ok(after.meta.discoveredEndingIds.includes("crown-of-dawn"));
  assert.equal(after.run.stats.omens, 2);
  assert.equal("bell" in after.run.flags, false);
  assert.ok(after.meta.discoveredCardIds.includes("hidden-star"));
  assert.deepEqual(resourceChanges(before, after, items), {});
});

test("scripted setbacks floor HP at one and cannot delete quest-critical items", () => {
  let state = createInitialState({ seed: 5 });
  state = {
    ...state,
    player: { ...state.player, hp: 4, inventory: ["tonic", "ember-core"] },
  };
  state = applyEffects(
    state,
    [
      { type: "applyBoundedHpLoss", amount: 99, minimumHp: 1 },
      { type: "removeSpecificNonKeyItem", itemId: "tonic" },
      { type: "removeSpecificNonKeyItem", itemId: "ember-core" },
    ],
    { items },
  );
  assert.equal(state.player.hp, 1);
  assert.deepEqual(state.player.inventory, ["ember-core"]);
});

test("story encounters retain their originating beat and required sequencing", () => {
  const enemy = {
    id: "effect-foe",
    name: "Effect Foe",
    minLevel: 1,
    maxHp: 9,
    attack: 3,
    defense: 1,
    intentWeights: { opening: 1 },
  };
  let state = createInitialState({ seed: 55 });
  state = applyEffects(
    state,
    [
      { type: "modifyBaseStat", stat: "maxHp", amount: -10 },
      { type: "startStoryEncounter", enemyId: enemy.id, required: true },
    ],
    { items, enemies: [enemy] },
  );
  assert.equal(state.player.baseStats.maxHp, 20);
  assert.equal(state.player.hp, 20);
  assert.equal(state.mode, "combat");
  assert.equal(state.encounter.enemyId, enemy.id);
  assert.equal(state.encounter.currentIntent, "opening");
  assert.equal(state.encounter.originBeatId, "openingImage");
  assert.equal(state.encounter.kind, "required");
});
