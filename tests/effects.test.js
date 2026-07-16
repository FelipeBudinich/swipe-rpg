import test from "node:test";
import assert from "node:assert/strict";

import { applyEffect, applyEffects, resourceChanges } from "../public/js/game/effects.js";
import { createInitialState } from "../public/js/game/state.js";

const items = [
  { id: "ward", type: "equipment", slot: "charm", statModifiers: { maxHp: 5, maxMp: 2 } },
  { id: "tonic", type: "consumable", slot: null, statModifiers: {} },
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

test("flags, inventory, queue, journey, discovery, and run statistics execute centrally", () => {
  const before = createInitialState({ seed: 4 });
  const after = applyEffects(
    before,
    [
      { type: "setFlag", flag: "bell", value: true },
      { type: "queueCard", cardId: "bell-answer" },
      { type: "addItem", itemId: "tonic", count: 2 },
      { type: "removeItem", itemId: "tonic", count: 1 },
      { type: "modifyJourneyStep", amount: 3 },
      { type: "recordDiscovery", discoveryId: "hidden-star" },
      { type: "setRunStat", stat: "omens", operation: "increment", amount: 2 },
      { type: "clearFlag", flag: "bell" },
    ],
    { items },
  );
  assert.deepEqual(after.player.inventory, ["tonic"]);
  assert.deepEqual(after.run.forcedCardQueue, ["bell-answer"]);
  assert.equal(after.journeyStep, 3);
  assert.equal(after.run.stats.omens, 2);
  assert.equal("bell" in after.run.flags, false);
  assert.ok(after.meta.discoveredCardIds.includes("hidden-star"));
  assert.deepEqual(resourceChanges(before, after, items), { journeyStep: 3 });
});

test("encounter and base-stat effects remain declarative and deterministic", () => {
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
      { type: "startEncounter", enemyId: enemy.id },
    ],
    { items, enemies: [enemy] },
  );
  assert.equal(state.player.baseStats.maxHp, 20);
  assert.equal(state.player.hp, 20);
  assert.equal(state.mode, "combat");
  assert.equal(state.encounter.enemyId, enemy.id);
  assert.equal(state.encounter.currentIntent, "opening");
});
