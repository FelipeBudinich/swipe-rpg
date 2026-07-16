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
  maxHp: 12,
  attack: 7,
  defense: 2,
  xpReward: 25,
  goldMin: 4,
  goldMax: 4,
  intentWeights: { attack: 2, opening: 2, charge: 2, hesitate: 2 },
  dropChance: 1,
  dropTable: [{ itemId: "test-drop", weight: 1 }],
  story: { arcIds: ["ember-crown"], enemyTags: ["weak", "tutorial"] },
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
  assert.equal(resolved.state.player.gold, 10);
  assert.equal(resolved.state.player.xp, 0);
  assert.equal(resolved.state.run.enemiesDefeated[enemy.id], 1);
  assert.ok(resolved.state.meta.discoveredEnemyIds.includes(enemy.id));
  assert.equal(resolved.state.run.goldEarned, 0);
  assert.equal(resolved.state.run.itemsFound, 0);
  assert.ok(!resolved.state.meta.discoveredItemIds.includes("test-drop"));
  assert.deepEqual(resolved.state.run.forcedCardQueue, [
    {
      cardId: "combat-reward",
      rewardId: "test-fiend:0",
      enemyId: "test-fiend",
      originBeatId: "openingImage",
      xpAwarded: 25,
      goldAwarded: 4,
      itemId: "test-drop",
    },
  ]);
  assert.match(resolved.resultText, /spoils of battle are ready/i);
});

test("final boss defeat records concrete facts without entering victory", () => {
  const boss = {
    ...enemy,
    id: "test-final-boss",
    name: "Test Final Boss",
    isBoss: true,
    isFinalBoss: true,
    dropChance: 0,
    dropTable: [],
    story: {
      arcIds: ["ember-crown"],
      enemyTags: ["final-boss"],
      onDefeatFacts: { malrecDefeated: true, cinderTitanSealed: true },
    },
  };
  let state = createInitialState({ seed: 111 });
  state = {
    ...state,
    mode: "combat",
    story: { ...state.story, currentBeatId: "finale", currentBeatIndex: 13 },
    encounter: {
      enemyId: boss.id,
      hp: 1,
      lastIntent: null,
      currentIntent: "attack",
      round: 1,
      originBeatId: "finale",
      kind: "required",
    },
  };
  const resolved = resolveCombatAction(state, "strike", [boss], []);
  assert.equal(resolved.enemyDefeated, true);
  assert.equal(resolved.state.mode, "exploration");
  assert.notEqual(resolved.state.mode, "victory");
  assert.equal(resolved.state.story.facts.malrecDefeated, true);
  assert.equal(resolved.state.story.facts.cinderTitanSealed, true);
  assert.deepEqual(resolved.state.run.forcedCardQueue, [
    {
      cardId: "combat-reward",
      rewardId: "test-final-boss:0",
      enemyId: "test-final-boss",
      originBeatId: "finale",
      xpAwarded: 25,
      goldAwarded: 4,
      itemId: null,
    },
  ]);
  assert.equal(resolved.state.story.endingId, null);
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

test("enemy selection respects level and the current beat's allowed enemy tags", () => {
  const elite = {
    ...enemy,
    id: "elite",
    minLevel: 1,
    story: { arcIds: ["ember-crown"], enemyTags: ["elite"] },
  };
  const weak = {
    ...enemy,
    id: "weak",
    minLevel: 1,
    story: { arcIds: ["ember-crown"], enemyTags: ["weak", "tutorial"] },
  };
  const overLevel = {
    ...weak,
    id: "over-level",
    minLevel: 3,
  };
  const state = createInitialState({ seed: 13 });
  const selected = selectEnemy(state, [elite, overLevel, weak], {
    encounterPolicy: { allowedEnemyTags: ["weak", "tutorial"] },
  });
  assert.equal(selected.enemy.id, "weak");
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
  assert.equal(resolved.state.run.deathCause, enemy.id);
  assert.equal(resolved.state.story.currentBeatId, "openingImage");
});
