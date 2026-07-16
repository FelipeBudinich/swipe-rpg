import test from "node:test";
import assert from "node:assert/strict";

import {
  beginEncounter,
  combatActions,
  ordinaryDamage,
  resolveCombatAction,
  rollIntent,
  selectEnemy,
  techniqueDamage,
} from "../public/js/game/combat.js";
import { createInitialState } from "../public/js/game/state.js";

const enemy = {
  id: "test-fiend",
  name: "Test Fiend",
  minLevel: 1,
  minJourneyStep: 0,
  maxHp: 12,
  attack: 7,
  defense: 2,
  xpReward: 25,
  goldMin: 4,
  goldMax: 4,
  intentWeights: { attack: 2, opening: 2, charge: 2, hesitate: 2 },
  dropChance: 1,
  dropTable: [{ itemId: "test-drop", weight: 1 }],
};

test("ordinary and technique damage always respect their minimums", () => {
  for (let seed = 1; seed < 100; seed += 1) {
    assert.ok(ordinaryDamage(seed, 1, 999).damage >= 1);
    assert.ok(techniqueDamage(seed, 1, 999).damage >= 2);
  }
});

test("insufficient MP replaces Technique with Focus and Break with Brace", () => {
  let state = createInitialState({ seed: 10 });
  state = {
    ...state,
    mode: "combat",
    player: { ...state.player, mp: 1 },
    encounter: { enemyId: enemy.id, hp: enemy.maxHp, lastIntent: null, currentIntent: "opening", round: 1 },
  };
  assert.equal(combatActions(state, [enemy]).right.action, "focus");
  state = { ...state, encounter: { ...state.encounter, currentIntent: "charge" } };
  assert.equal(combatActions(state, [enemy]).right.action, "brace");
});

test("a lethal player hit ends combat before enemy retaliation", () => {
  let state = createInitialState({ seed: 11 });
  state = {
    ...state,
    mode: "combat",
    player: { ...state.player, hp: 9 },
    encounter: { enemyId: enemy.id, hp: 1, lastIntent: null, currentIntent: "attack", round: 1 },
  };
  const resolved = resolveCombatAction(state, "strike", [enemy], []);
  assert.equal(resolved.enemyDefeated, true);
  assert.equal(resolved.enemyDamage, 0);
  assert.equal(resolved.state.player.hp, 9);
  assert.equal(resolved.state.encounter, null);
  assert.equal(resolved.state.player.gold, 14);
  assert.equal(resolved.state.run.enemiesDefeated[enemy.id], 1);
  assert.ok(resolved.state.meta.discoveredEnemyIds.includes(enemy.id));
  assert.deepEqual(resolved.state.run.forcedCardQueue, ["level-up", { cardId: "loot", itemId: "test-drop" }]);
});

test("a boss drop queues a reward card before victory", () => {
  const boss = { ...enemy, id: "test-boss", name: "Test Boss", isBoss: true };
  let state = createInitialState({ seed: 111 });
  state = {
    ...state,
    mode: "combat",
    encounter: { enemyId: boss.id, hp: 1, lastIntent: null, currentIntent: "attack", round: 1 },
  };
  const resolved = resolveCombatAction(state, "strike", [boss], []);
  assert.equal(resolved.state.run.bossDefeated, false);
  assert.equal(resolved.state.run.bossVictoryPending, true);
  assert.equal(resolved.state.player.inventory.includes("test-drop"), false);
  assert.ok(
    resolved.state.run.forcedCardQueue.some(
      (entry) => entry?.cardId === "loot" && entry?.itemId === "test-drop" && entry?.victoryAfter,
    ),
  );
});

test("combat rolls are deterministic and a repeated charge is prohibited", () => {
  const initial = beginEncounter(createInitialState({ seed: 12 }), enemy, [enemy]);
  const first = resolveCombatAction(initial, "strike", [enemy], []);
  const replay = resolveCombatAction(initial, "strike", [enemy], []);
  assert.deepEqual(first, replay);

  for (let seed = 1; seed < 100; seed += 1) {
    assert.notEqual(rollIntent(seed, enemy, "charge").intent, "charge");
  }
});

test("enemy selection respects level and journey depth", () => {
  const late = { ...enemy, id: "late", minLevel: 3, minJourneyStep: 8 };
  const early = { ...enemy, id: "early", minLevel: 1, minJourneyStep: 0 };
  const state = createInitialState({ seed: 13 });
  assert.equal(selectEnemy(state, [late, early]).enemy.id, "early");
});

test("incoming lethal damage transitions immediately to game over", () => {
  let state = createInitialState({ seed: 14 });
  state = {
    ...state,
    mode: "combat",
    player: { ...state.player, hp: 1 },
    encounter: { enemyId: enemy.id, hp: 12, lastIntent: null, currentIntent: "attack", round: 1 },
  };
  const resolved = resolveCombatAction(state, "strike", [enemy], []);
  assert.equal(resolved.state.player.hp, 0);
  assert.equal(resolved.state.mode, "gameOver");
  assert.equal(resolved.state.encounter, null);
});
