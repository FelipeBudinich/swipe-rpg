import test from "node:test";
import assert from "node:assert/strict";

import {
  attemptFlee,
  resolveCombatAction,
} from "../public/js/game/combat.js";
import {
  buildCombatRewardCard,
  createGame,
  DEFAULT_CONTENT,
  getNextCard,
  resolveChoice,
} from "../public/js/game/engine.js";
import { createInitialState, normalizeState } from "../public/js/game/state.js";
import { nextUint32 } from "../public/js/rng.js";

const rewardEnemy = Object.freeze({
  id: "reward-fiend",
  name: "Reward Fiend",
  artId: "enemy-ash-wolf",
  minLevel: 1,
  maxHp: 12,
  attack: 4,
  defense: 0,
  xpReward: 9,
  goldMin: 3,
  goldMax: 3,
  intentWeights: { attack: 1 },
  dropChance: 0,
  dropTable: [],
  story: {
    arcIds: ["ember-crown"],
    enemyTags: ["weak"],
    onDefeatFacts: { rewardFiendDefeated: true },
  },
});

const rewardBlade = Object.freeze({
  id: "reward-blade",
  name: "Reward Blade",
  description: "A blade used to verify battle rewards.",
  type: "equipment",
  slot: "weapon",
  rarity: "uncommon",
  sellValue: 13,
  statModifiers: { attack: 2 },
  artId: "item-blade",
});

const rewardTonic = Object.freeze({
  id: "reward-tonic",
  name: "Reward Tonic",
  description: "A tonic used to verify battle rewards.",
  type: "consumable",
  slot: null,
  rarity: "common",
  sellValue: 4,
  statModifiers: {},
  useEffects: [{ type: "heal", amount: 7 }],
  artId: "item-tonic",
});

const protectedRelic = Object.freeze({
  id: "protected-relic",
  name: "Protected Relic",
  description: "A quest-critical relic that must never be sold.",
  type: "equipment",
  slot: "charm",
  rarity: "rare",
  questCritical: true,
  sellValue: 999,
  statModifiers: { defense: 1 },
  artId: "item-charm",
});

function contentWith({ enemies = [rewardEnemy], items = [rewardBlade, rewardTonic, protectedRelic] } = {}) {
  return { ...DEFAULT_CONTENT, enemies, items };
}

function combatState(enemy, {
  seed = 701,
  decisionCount = 0,
  enemyHp = 1,
  playerHp = 30,
  attack = 50,
  kind = "random",
  queue = [],
} = {}) {
  const base = createInitialState({ seed });
  return {
    ...base,
    mode: "combat",
    decisionCount,
    player: {
      ...base.player,
      hp: playerHp,
      baseStats: { ...base.player.baseStats, attack },
    },
    encounter: {
      enemyId: enemy.id,
      hp: enemyHp,
      lastIntent: null,
      currentIntent: "attack",
      round: 1,
      originBeatId: base.story.currentBeatId,
      kind,
      phase: 1,
    },
    run: { ...base.run, forcedCardQueue: [...queue] },
  };
}

function rewardEntry(overrides = {}) {
  return {
    cardId: "combat-reward",
    rewardId: "reward-fiend:17",
    enemyId: rewardEnemy.id,
    originBeatId: "openingImage",
    xpAwarded: 6,
    goldAwarded: 4,
    itemId: null,
    ...overrides,
  };
}

function presentReward(entry, {
  state = createInitialState({ seed: 702 }),
  content = contentWith(),
  queue = [entry],
} = {}) {
  const pending = {
    ...state,
    mode: "exploration",
    currentCardId: null,
    currentCardData: null,
    currentCardToken: null,
    currentCardSource: null,
    run: { ...state.run, forcedCardQueue: [...queue] },
  };
  return getNextCard(pending, content);
}

function resolvePresented(presented, direction, content = contentWith()) {
  return resolveChoice(presented.state, direction, content, {
    expectedToken: presented.card.resolutionToken,
  });
}

function defeatThroughEngine(enemy, content, options = {}) {
  const combat = getNextCard(combatState(enemy, options), content);
  assert.equal(combat.card.category, "combat");
  return resolveChoice(combat.state, "right", content, {
    expectedToken: combat.card.resolutionToken,
  });
}

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

test("regular, scripted, midboss, and final-boss defeats each queue exactly one deferred reward", () => {
  const variants = [
    { enemy: { ...rewardEnemy, id: "regular-reward-enemy" }, kind: "random" },
    { enemy: { ...rewardEnemy, id: "scripted-reward-enemy" }, kind: "required" },
    { enemy: { ...rewardEnemy, id: "midboss-reward-enemy", isBoss: true, isMidboss: true }, kind: "required" },
    { enemy: { ...rewardEnemy, id: "final-reward-enemy", isBoss: true, isFinalBoss: true }, kind: "required" },
  ];

  for (const { enemy, kind } of variants) {
    const state = combatState(enemy, { decisionCount: 37, kind });
    const resolved = resolveCombatAction(state, "strike", [enemy], []);
    const rewards = resolved.state.run.forcedCardQueue.filter(
      (entry) => entry?.cardId === "combat-reward",
    );

    assert.equal(resolved.enemyDefeated, true, enemy.id);
    assert.equal(resolved.state.encounter, null, enemy.id);
    assert.equal(rewards.length, 1, enemy.id);
    assert.deepEqual(rewards[0], {
      cardId: "combat-reward",
      rewardId: `${enemy.id}:37`,
      enemyId: enemy.id,
      originBeatId: "openingImage",
      xpAwarded: 9,
      goldAwarded: 3,
      itemId: null,
    });
    assert.ok(
      !resolved.state.run.forcedCardQueue.some(
        (entry) => entry === "level-up" || entry?.cardId === "loot",
      ),
      enemy.id,
    );
    assert.equal(resolved.state.player.xp, 0, enemy.id);
    assert.equal(resolved.state.player.gold, 10, enemy.id);
    assert.equal(resolved.state.run.goldEarned, 0, enemy.id);
    assert.equal(resolved.state.run.itemsFound, 0, enemy.id);
    assert.equal(resolved.state.run.enemiesDefeated[enemy.id], 1, enemy.id);
    assert.ok(resolved.state.meta.discoveredEnemyIds.includes(enemy.id), enemy.id);
    assert.equal(resolved.state.story.facts.rewardFiendDefeated, true, enemy.id);
  }
});

test("no-item, zero-gold, and zero-XP victories still prepare a battle reward", () => {
  const emptyRewardEnemy = {
    ...rewardEnemy,
    id: "empty-reward-enemy",
    xpReward: 0,
    goldMin: 0,
    goldMax: 0,
    dropChance: 0,
    dropTable: [],
  };
  const resolved = resolveCombatAction(
    combatState(emptyRewardEnemy, { decisionCount: 8 }),
    "strike",
    [emptyRewardEnemy],
    [],
  );

  assert.equal(resolved.state.run.forcedCardQueue.length, 1);
  assert.deepEqual(resolved.state.run.forcedCardQueue[0], {
    cardId: "combat-reward",
    rewardId: "empty-reward-enemy:8",
    enemyId: "empty-reward-enemy",
    originBeatId: "openingImage",
    xpAwarded: 0,
    goldAwarded: 0,
    itemId: null,
  });

  const presented = getNextCard(resolved.state, contentWith({ enemies: [emptyRewardEnemy], items: [] }));
  assert.equal(presented.card.category, "combatReward");
  assert.equal(presented.card.reward.xpAwarded, 0);
  assert.equal(presented.card.reward.goldAwarded, 0);
  assert.equal(presented.card.reward.itemId, null);
  assert.equal(presented.card.left.label, "Continue");
  assert.equal(presented.card.right.label, "Continue");
});

test("lethal reward RNG consumes one gold roll and one item-drop roll without rerolling", () => {
  const dropEnemy = {
    ...rewardEnemy,
    id: "deterministic-drop-enemy",
    goldMin: 2,
    goldMax: 9,
    dropChance: 1,
    dropTable: [
      { itemId: rewardBlade.id, weight: 1 },
      { itemId: rewardTonic.id, weight: 2 },
    ],
  };
  const state = combatState(dropEnemy, { seed: 0xabc123, decisionCount: 19 });
  const first = resolveCombatAction(state, "strike", [dropEnemy], [rewardBlade, rewardTonic]);
  const replay = resolveCombatAction(state, "strike", [dropEnemy], [rewardBlade, rewardTonic]);

  // One attack roll, one gold roll, one drop-chance roll, and one weighted
  // item choice consume exactly four xorshift outputs.
  let expectedRngState = state.rngState;
  for (let index = 0; index < 4; index += 1) {
    expectedRngState = nextUint32(expectedRngState).state;
  }
  assert.equal(first.state.rngState, expectedRngState);
  assert.deepEqual(first, replay);
  assert.equal(
    first.state.run.forcedCardQueue.filter((entry) => entry?.cardId === "combat-reward").length,
    1,
  );

  const noDropEnemy = { ...dropEnemy, id: "deterministic-no-drop", dropChance: 0, dropTable: [] };
  const noDropState = combatState(noDropEnemy, { seed: 0xabc123 });
  const noDrop = resolveCombatAction(noDropState, "strike", [noDropEnemy], []);
  let noDropExpected = noDropState.rngState;
  for (let index = 0; index < 2; index += 1) {
    noDropExpected = nextUint32(noDropExpected).state;
  }
  assert.equal(noDrop.state.rngState, noDropExpected);
});

test("enemy XP is captured once and defeat facts/discovery are immediate", () => {
  let xpReads = 0;
  const enemy = { ...rewardEnemy, id: "single-xp-read" };
  Object.defineProperty(enemy, "xpReward", {
    enumerable: true,
    get() {
      xpReads += 1;
      return 12;
    },
  });

  const resolved = resolveCombatAction(combatState(enemy), "strike", [enemy], []);
  assert.equal(xpReads, 1);
  assert.equal(resolved.state.run.forcedCardQueue[0].xpAwarded, 12);
  assert.equal(resolved.state.story.facts.rewardFiendDefeated, true);
  assert.ok(resolved.state.meta.discoveredEnemyIds.includes(enemy.id));
  assert.equal(resolved.state.player.xp, 0);
});

test("death and fleeing an undefeated encounter never queue battle rewards", () => {
  const lethalEnemy = {
    ...rewardEnemy,
    id: "lethal-unrewarded-enemy",
    maxHp: 100,
    attack: 100,
    defense: 0,
  };
  const death = resolveCombatAction(
    combatState(lethalEnemy, { enemyHp: 100, playerHp: 1, attack: 0 }),
    "strike",
    [lethalEnemy],
    [],
  );
  assert.equal(death.state.mode, "gameOver");
  assert.equal(death.enemyDefeated, false);
  assert.deepEqual(death.state.run.forcedCardQueue, []);

  const fled = attemptFlee(combatState(rewardEnemy), 1, [rewardEnemy]);
  assert.equal(fled.escaped, true);
  assert.equal(fled.state.encounter, null);
  assert.deepEqual(fled.state.run.forcedCardQueue, []);
});

test("the reward card has stable serializable metadata and outranks other rewards and transitions", () => {
  const entry = rewardEntry({ itemId: rewardBlade.id });
  const card = buildCombatRewardCard(entry, contentWith());
  assert.equal(card.id, "combat-reward:reward-fiend:17");
  assert.equal(card.category, "combatReward");
  assert.equal(card.speaker, "Reward Fiend defeated");
  assert.equal(card.title, "Battle Rewards");
  assert.deepEqual(card.reward, {
    rewardId: "reward-fiend:17",
    enemyId: rewardEnemy.id,
    originBeatId: "openingImage",
    xpAwarded: 6,
    goldAwarded: 4,
    itemId: rewardBlade.id,
  });
  assert.equal(card.story.countsTowardStory, false);
  assert.doesNotThrow(() => JSON.stringify(card));

  const base = createInitialState({ seed: 703 });
  const transitionState = {
    ...base,
    mode: "storyTransition",
    story: { ...base.story, pendingInterstitialBeatId: "midpoint" },
    run: {
      ...base.run,
      forcedCardQueue: [
        "level-up",
        {
          cardId: "midpoint-wyvern-aftermath",
          originBeatId: "midpoint",
          beatLocal: true,
        },
        entry,
      ],
    },
  };
  const beforeTransition = getNextCard(transitionState, contentWith());
  assert.equal(beforeTransition.card.category, "combatReward");
  assert.equal(beforeTransition.state.mode, "combatReward");
  assert.ok(beforeTransition.state.run.forcedCardQueue.includes("level-up"));

  const completedState = {
    ...base,
    story: { ...base.story, status: "completed", completed: true },
    run: { ...base.run, forcedCardQueue: [entry] },
  };
  const beforeVictory = getNextCard(completedState, contentWith());
  assert.equal(beforeVictory.card.category, "combatReward");
  assert.notEqual(beforeVictory.state.mode, "victory");
});

test("a queued reward preempts and then resumes an already-persisted story card", () => {
  const content = contentWith();
  const initial = createGame({ seed: 704, content });
  const originalCard = initial.card;
  const interrupted = {
    ...initial.state,
    run: {
      ...initial.state.run,
      forcedCardQueue: [rewardEntry({ xpAwarded: 0, goldAwarded: 0 })],
    },
  };

  const reward = getNextCard(interrupted, content);
  assert.equal(reward.card.category, "combatReward");
  assert.equal(reward.state.story.totalWorldCardsResolved, 0);

  const resumed = resolvePresented(reward, "left", content);
  assert.equal(resumed.card.id, originalCard.id);
  assert.equal(resumed.card.category, originalCard.category);
  assert.equal(resumed.state.currentCardSource, initial.state.currentCardSource);
  assert.equal(resumed.state.story.totalWorldCardsResolved, 0);
});

test("either no-item direction grants the same base XP and gold exactly once", () => {
  const content = contentWith();
  const presented = presentReward(rewardEntry(), { content });
  assert.equal(presented.card.left.label, "Continue");
  assert.equal(presented.card.right.label, "Continue");

  const left = resolvePresented(presented, "left", content);
  const right = resolvePresented(presented, "right", content);
  for (const resolved of [left, right]) {
    assert.equal(resolved.state.player.xp, 6);
    assert.equal(resolved.state.player.gold, 14);
    assert.equal(resolved.state.run.goldEarned, 4);
    assert.equal(resolved.state.run.itemsFound, 0);
    assert.deepEqual(resolved.state.player.inventory, []);
    assert.equal(resolved.state.decisionCount, 1);
    assert.equal(resolved.state.story.cardsResolvedInBeat, 0);
    assert.equal(resolved.state.story.totalWorldCardsResolved, 0);
    assert.equal(resolved.feedbackTone, "reward");
  }
});

test("equipment rewards keep or sell on the same card while preserving base rewards and statistics", () => {
  const content = contentWith();
  const presented = presentReward(
    rewardEntry({ xpAwarded: 5, goldAwarded: 7, itemId: rewardBlade.id }),
    { content },
  );
  assert.equal(presented.card.left.label, "Sell · +13 gold");
  assert.equal(presented.card.right.label, "Keep");

  const sold = resolvePresented(presented, "left", content);
  assert.equal(sold.state.player.xp, 5);
  assert.equal(sold.state.player.gold, 30);
  assert.equal(sold.state.run.goldEarned, 20);
  assert.deepEqual(sold.state.player.inventory, []);
  assert.equal(sold.state.run.itemsFound, 1);
  assert.ok(sold.state.meta.discoveredItemIds.includes(rewardBlade.id));

  const kept = resolvePresented(presented, "right", content);
  assert.equal(kept.state.player.xp, 5);
  assert.equal(kept.state.player.gold, 17);
  assert.equal(kept.state.run.goldEarned, 7);
  assert.deepEqual(kept.state.player.inventory, [rewardBlade.id]);
  assert.equal(kept.state.run.itemsFound, 1);
  assert.ok(kept.state.meta.discoveredItemIds.includes(rewardBlade.id));
});

test("consumable rewards use now or keep after granting base XP and gold", () => {
  const content = contentWith();
  const base = createInitialState({ seed: 704 });
  const wounded = { ...base, player: { ...base.player, hp: 3 } };
  const presented = presentReward(
    rewardEntry({ xpAwarded: 4, goldAwarded: 2, itemId: rewardTonic.id }),
    { content, state: wounded },
  );
  assert.equal(presented.card.left.label, "Use now");
  assert.equal(presented.card.right.label, "Keep");

  const used = resolvePresented(presented, "left", content);
  assert.equal(used.state.player.hp, 10);
  assert.equal(used.state.player.xp, 4);
  assert.equal(used.state.player.gold, 12);
  assert.deepEqual(used.state.player.inventory, []);
  assert.equal(used.state.run.itemsFound, 1);
  assert.ok(used.state.meta.discoveredItemIds.includes(rewardTonic.id));

  const kept = resolvePresented(presented, "right", content);
  assert.equal(kept.state.player.hp, 3);
  assert.equal(kept.state.player.xp, 4);
  assert.equal(kept.state.player.gold, 12);
  assert.deepEqual(kept.state.player.inventory, [rewardTonic.id]);
  assert.equal(kept.state.run.itemsFound, 1);
});

test("quest-critical and unknown drops cannot forfeit the known battle rewards", () => {
  const protectedContent = contentWith();
  const protectedPresented = presentReward(
    rewardEntry({ xpAwarded: 3, goldAwarded: 2, itemId: protectedRelic.id }),
    { content: protectedContent },
  );
  assert.equal(protectedPresented.card.left.label, "Keep");
  assert.equal(protectedPresented.card.right.label, "Keep");

  for (const direction of ["left", "right"]) {
    const resolved = resolvePresented(protectedPresented, direction, protectedContent);
    assert.equal(resolved.state.player.xp, 3);
    assert.equal(resolved.state.player.gold, 12);
    assert.deepEqual(resolved.state.player.inventory, [protectedRelic.id]);
    assert.equal(resolved.state.run.goldEarned, 2);
    assert.equal(resolved.state.run.itemsFound, 1);
  }

  const unknownContent = contentWith({ items: [] });
  const unknownPresented = presentReward(
    rewardEntry({ xpAwarded: 3, goldAwarded: 2, itemId: "removed-item" }),
    { content: unknownContent },
  );
  assert.equal(unknownPresented.card.left.label, "Continue");
  assert.equal(unknownPresented.card.right.label, "Continue");
  assert.match(unknownPresented.card.left.detail, /unavailable/i);

  const unknown = resolvePresented(unknownPresented, "left", unknownContent);
  assert.equal(unknown.state.player.xp, 3);
  assert.equal(unknown.state.player.gold, 12);
  assert.deepEqual(unknown.state.player.inventory, []);
  assert.equal(unknown.state.run.itemsFound, 1);
  assert.ok(unknown.state.meta.discoveredItemIds.includes("removed-item"));
  assert.match(unknown.resultText, /cannot be recovered/i);
});

test("reward resolution queues every crossed level after the reward without counting story progress", () => {
  const levelingEnemy = {
    ...rewardEnemy,
    id: "multi-level-enemy",
    xpReward: 110,
    goldMin: 0,
    goldMax: 0,
  };
  const content = contentWith({ enemies: [levelingEnemy], items: [] });
  const defeated = defeatThroughEngine(levelingEnemy, content, { seed: 705 });

  assert.equal(defeated.card.category, "combatReward");
  assert.equal(defeated.state.mode, "combatReward");
  assert.equal(defeated.state.player.level, 1);
  assert.equal(defeated.state.player.xp, 0);
  assert.ok(!defeated.state.run.forcedCardQueue.includes("level-up"));
  assert.equal(defeated.state.decisionCount, 1);

  const rewarded = resolveChoice(defeated.state, "left", content, {
    expectedToken: defeated.card.resolutionToken,
  });
  assert.equal(rewarded.state.player.level, 4);
  assert.equal(rewarded.state.player.xp, 5);
  assert.equal(rewarded.card.category, "levelUp");
  assert.equal(rewarded.state.run.forcedCardQueue.filter((entry) => entry === "level-up").length, 2);
  assert.equal(rewarded.state.decisionCount, 2);
  assert.equal(rewarded.state.story.cardsResolvedInBeat, 0);
  assert.equal(rewarded.state.story.totalWorldCardsResolved, 0);
});

test("replaying the collected reward token is ignored without duplicating resources", () => {
  const content = contentWith();
  const presented = presentReward(
    rewardEntry({ xpAwarded: 5, goldAwarded: 2, itemId: rewardBlade.id }),
    { content },
  );
  const token = presented.card.resolutionToken;
  const collected = resolvePresented(presented, "right", content);
  const snapshot = {
    decisionCount: collected.state.decisionCount,
    xp: collected.state.player.xp,
    gold: collected.state.player.gold,
    inventory: [...collected.state.player.inventory],
    goldEarned: collected.state.run.goldEarned,
    itemsFound: collected.state.run.itemsFound,
  };

  const duplicate = resolveChoice(collected.state, "right", content, { expectedToken: token });
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "stale-resolution");
  assert.deepEqual(
    {
      decisionCount: duplicate.state.decisionCount,
      xp: duplicate.state.player.xp,
      gold: duplicate.state.player.gold,
      inventory: [...duplicate.state.player.inventory],
      goldEarned: duplicate.state.run.goldEarned,
      itemsFound: duplicate.state.run.itemsFound,
    },
    snapshot,
  );
});

test("reload before collection preserves the exact rolled reward and does not consume RNG", () => {
  const enemy = {
    ...rewardEnemy,
    id: "reload-reward-enemy",
    xpReward: 11,
    goldMin: 2,
    goldMax: 8,
    dropChance: 1,
    dropTable: [{ itemId: rewardBlade.id, weight: 1 }],
  };
  const content = contentWith({ enemies: [enemy], items: [rewardBlade] });
  const defeated = defeatThroughEngine(enemy, content, { seed: 706 });
  assert.equal(defeated.card.category, "combatReward");

  const savedPayload = jsonRoundTrip(defeated.card.reward);
  const savedRngState = defeated.state.rngState;
  const savedToken = defeated.state.currentCardToken;
  const loadedState = normalizeState(jsonRoundTrip(defeated.state));
  const restored = getNextCard(loadedState, content);

  assert.equal(restored.state.mode, "combatReward");
  assert.equal(restored.state.currentCardToken, savedToken);
  assert.equal(restored.state.rngState, savedRngState);
  assert.deepEqual(restored.card.reward, savedPayload);
  assert.equal(restored.card.reward.xpAwarded, 11);
  assert.equal(restored.card.reward.itemId, rewardBlade.id);

  const originalCollection = resolveChoice(defeated.state, "right", content, {
    expectedToken: defeated.card.resolutionToken,
  });
  const restoredCollection = resolveChoice(restored.state, "right", content, {
    expectedToken: restored.card.resolutionToken,
  });
  assert.deepEqual(restoredCollection.state.player, originalCollection.state.player);
  assert.equal(restoredCollection.state.run.goldEarned, originalCollection.state.run.goldEarned);
  assert.equal(restoredCollection.state.run.itemsFound, originalCollection.state.run.itemsFound);
  assert.equal(restoredCollection.state.rngState, originalCollection.state.rngState);
});

test("reload after collection cannot restore or grant the reward again", () => {
  const content = contentWith();
  const presented = presentReward(
    rewardEntry({ xpAwarded: 5, goldAwarded: 2, itemId: rewardBlade.id }),
    { content },
  );
  const rewardToken = presented.card.resolutionToken;
  const collected = resolvePresented(presented, "right", content);
  const loaded = normalizeState(jsonRoundTrip(collected.state));
  const restored = getNextCard(loaded, content);

  assert.notEqual(restored.card.category, "combatReward");
  assert.ok(
    !restored.state.run.forcedCardQueue.some((entry) => entry?.cardId === "combat-reward"),
  );
  assert.equal(restored.state.player.xp, 5);
  assert.equal(restored.state.player.gold, 12);
  assert.deepEqual(restored.state.player.inventory, [rewardBlade.id]);
  assert.equal(restored.state.run.goldEarned, 2);
  assert.equal(restored.state.run.itemsFound, 1);

  const duplicate = resolveChoice(restored.state, "left", content, {
    expectedToken: rewardToken,
  });
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "stale-resolution");
  assert.equal(duplicate.state.player.gold, 12);
  assert.equal(duplicate.state.run.itemsFound, 1);
});

test("legacy queued and current loot cards remain loadable and resolvable", () => {
  const content = contentWith({ items: [rewardBlade] });
  const base = createInitialState({ seed: 707 });
  const queued = getNextCard(
    {
      ...base,
      run: {
        ...base.run,
        forcedCardQueue: [{ cardId: "loot", itemId: rewardBlade.id }],
      },
    },
    content,
  );
  assert.equal(queued.state.mode, "loot");
  assert.equal(queued.card.category, "loot");
  assert.equal(queued.card.itemId, rewardBlade.id);

  const kept = resolveChoice(queued.state, "right", content, {
    expectedToken: queued.card.resolutionToken,
  });
  assert.ok(kept.state.player.inventory.includes(rewardBlade.id));

  const restoredCurrent = getNextCard(normalizeState(jsonRoundTrip(queued.state)), content);
  assert.equal(restoredCurrent.state.mode, "loot");
  assert.equal(restoredCurrent.card.id, `loot:${rewardBlade.id}`);
  assert.equal(restoredCurrent.state.currentCardToken, queued.state.currentCardToken);

  const sold = resolveChoice(restoredCurrent.state, "left", content, {
    expectedToken: restoredCurrent.card.resolutionToken,
  });
  assert.equal(sold.state.player.gold, 23);
  assert.equal(sold.state.run.goldEarned, 13);
  assert.ok(!sold.state.player.inventory.includes(rewardBlade.id));
});
