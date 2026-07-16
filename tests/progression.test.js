import test from "node:test";
import assert from "node:assert/strict";

import { applyLevelUpChoice, grantXp, xpThreshold } from "../public/js/game/progression.js";
import { createInitialState } from "../public/js/game/state.js";

test("XP threshold follows the documented linear curve", () => {
  assert.equal(xpThreshold(1), 20);
  assert.equal(xpThreshold(2), 35);
  assert.equal(xpThreshold(3), 50);
});
test("one XP grant can queue multiple independent level-up decisions", () => {
  const state = grantXp(createInitialState({ seed: 20 }), 110);
  assert.equal(state.player.level, 4);
  assert.equal(state.player.xp, 5);
  assert.deepEqual(state.run.forcedCardQueue, ["level-up", "level-up", "level-up"]);
  assert.equal(state.meta.bestLevel, 4);
});

test("Vigor increases base HP/defense and recovers exactly six HP", () => {
  let state = createInitialState({ seed: 21 });
  state = { ...state, player: { ...state.player, hp: 10 } };
  const next = applyLevelUpChoice(state, "left", []);
  assert.equal(next.player.baseStats.maxHp, 36);
  assert.equal(next.player.baseStats.defense, 3);
  assert.equal(next.player.hp, 16);
  assert.equal(next.player.baseStats.attack, 5);
});

test("Arcana increases base MP/attack and clamps recovery to the new maximum", () => {
  let state = createInitialState({ seed: 22 });
  state = { ...state, player: { ...state.player, mp: 9 } };
  const next = applyLevelUpChoice(state, "right", []);
  assert.equal(next.player.baseStats.maxMp, 14);
  assert.equal(next.player.baseStats.attack, 6);
  assert.equal(next.player.mp, 13);
  assert.equal(next.player.baseStats.defense, 2);
});
