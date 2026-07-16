import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  getNextCard,
  resolveChoice,
  restartGame,
  useInventoryItem,
} from "../public/js/game/engine.js";
import { createInitialState, normalizeState } from "../public/js/game/state.js";

const noEffects = { label: "Wait", resultText: "You wait.", effects: [] };
const basic = {
  id: "basic",
  category: "travel",
  speaker: "Road",
  title: "Fork",
  text: "Two ways onward.",
  baseWeight: 10,
  cooldown: 0,
  oncePerRun: false,
  requirements: [],
  tags: ["peaceful"],
  left: noEffects,
  right: { label: "Find coin", resultText: "Coin glints.", effects: [{ type: "modifyGold", amount: 2 }] },
};
const noAdvance = { ...basic, id: "pause", baseWeight: 0, advanceJourney: false };
const forced = { ...basic, id: "forced", baseWeight: 0, advanceJourney: false };
const fallback = { ...basic, id: "fallback", baseWeight: 0, tags: ["fallback"] };
const levelUp = {
  ...basic,
  id: "level-up",
  category: "levelUp",
  baseWeight: 0,
  advanceJourney: false,
};
const death = { ...basic, id: "death", category: "gameOver", baseWeight: 0, advanceJourney: false };
const victory = { ...basic, id: "victory", category: "victory", baseWeight: 0, advanceJourney: false };
const bossIntro = {
  ...basic,
  id: "boss-intro",
  category: "encounter",
  baseWeight: 0,
  advanceJourney: false,
};
const boss = {
  id: "boss",
  name: "Boss",
  isBoss: true,
  minLevel: 1,
  maxHp: 20,
  attack: 5,
  defense: 1,
  xpReward: 20,
  goldMin: 1,
  goldMax: 1,
  intentWeights: { attack: 1 },
  dropChance: 0,
  dropTable: [],
};
const regularEnemy = { ...boss, id: "foe", name: "Foe", isBoss: false, maxHp: 8 };
const testItems = [
  {
    id: "xp-salt",
    name: "XP Salt",
    description: "Sharp insight.",
    type: "consumable",
    sellValue: 1,
    statModifiers: {},
    useEffects: [{ type: "addXp", amount: 2 }],
  },
  {
    id: "thorn",
    name: "Thorn",
    description: "It bites.",
    type: "consumable",
    sellValue: 1,
    statModifiers: {},
    useEffects: [{ type: "modifyHp", amount: -2 }],
  },
  {
    id: "blade",
    name: "Blade",
    description: "A saleable blade.",
    type: "equipment",
    slot: "weapon",
    sellValue: 7,
    statModifiers: { attack: 2 },
  },
];
const testCards = [basic, noAdvance, forced, fallback, levelUp, death, victory, bossIntro];
const content = {
  cards: testCards,
  cardById: Object.fromEntries(testCards.map((entry) => [entry.id, entry])),
  fallbackCard: fallback,
  enemies: [regularEnemy, boss],
  items: testItems,
};

test("death outranks victory, current cards, and forced cards; victory outranks forced cards", () => {
  let state = createInitialState({ seed: 40 });
  state = {
    ...state,
    player: { ...state.player, hp: 0 },
    run: { ...state.run, bossDefeated: true, forcedCardQueue: ["forced"] },
    currentCardId: "basic",
    currentCardData: basic,
    currentCardToken: "old",
  };
  let next = getNextCard(state, content);
  assert.equal(next.card.id, "death");
  assert.equal(next.state.meta.deathCount, 1);
  next = getNextCard(next.state, content);
  assert.equal(next.state.meta.deathCount, 1);

  state = createInitialState({ seed: 41 });
  state = { ...state, run: { ...state.run, bossDefeated: true, forcedCardQueue: ["forced"] } };
  next = getNextCard(state, content);
  assert.equal(next.card.id, "victory");
  assert.equal(next.state.meta.victoryCount, 1);
});

test("forced queue precedes active combat, which precedes boss and world selection", () => {
  let state = createInitialState({ seed: 42 });
  state = {
    ...state,
    mode: "combat",
    encounter: { enemyId: "foe", hp: 8, lastIntent: null, currentIntent: "attack", round: 1 },
    run: { ...state.run, forcedCardQueue: ["forced"] },
  };
  let next = getNextCard(state, content);
  assert.equal(next.card.id, "forced");

  state = { ...state, run: { ...state.run, forcedCardQueue: [] } };
  next = getNextCard(state, content);
  assert.match(next.card.id, /^combat:foe:/);

  state = { ...createInitialState({ seed: 43 }), journeyStep: 20 };
  next = getNextCard(state, content);
  assert.equal(next.card.id, "boss-intro");
  assert.equal(next.state.run.bossQueued, true);
});

test("choice resolution is atomic, advances world steps, and rejects a stale token", () => {
  const game = createGame({ seed: 44, content });
  assert.equal(game.card.id, "basic");
  const resolved = resolveChoice(game.state, "right", content, {
    expectedToken: game.card.resolutionToken,
  });
  assert.equal(resolved.state.player.gold, 12);
  assert.equal(resolved.state.decisionCount, 1);
  assert.equal(resolved.state.journeyStep, 1);
  assert.equal(resolved.changes.gold, 2);

  const duplicate = resolveChoice(resolved.state, "right", content, {
    expectedToken: game.card.resolutionToken,
  });
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "stale-resolution");
  assert.equal(duplicate.state.player.gold, 12);
});

test("cards opting out do not advance journey and boss intro always starts its boss", () => {
  let state = createInitialState({ seed: 45 });
  state = { ...state, run: { ...state.run, forcedCardQueue: ["pause"] } };
  let next = getNextCard(state, content);
  let resolved = resolveChoice(next.state, "left", content, { expectedToken: next.card.resolutionToken });
  assert.equal(resolved.state.journeyStep, 0);

  state = { ...createInitialState({ seed: 46 }), journeyStep: 20 };
  next = getNextCard(state, content);
  resolved = resolveChoice(next.state, "left", content, { expectedToken: next.card.resolutionToken });
  assert.equal(resolved.state.mode, "combat");
  assert.equal(resolved.state.encounter.enemyId, "boss");
});

test("loot decisions keep or sell equipment without silent loss", () => {
  let state = createInitialState({ seed: 47 });
  state = { ...state, run: { ...state.run, forcedCardQueue: [{ cardId: "loot", itemId: "blade" }] } };
  let next = getNextCard(state, content);
  assert.equal(next.state.mode, "loot");
  let resolved = resolveChoice(next.state, "right", content, { expectedToken: next.card.resolutionToken });
  assert.ok(resolved.state.player.inventory.includes("blade"));

  state = { ...createInitialState({ seed: 48 }), run: { ...createInitialState({ seed: 48 }).run, forcedCardQueue: [{ cardId: "loot", itemId: "blade" }] } };
  next = getNextCard(state, content);
  resolved = resolveChoice(next.state, "left", content, { expectedToken: next.card.resolutionToken });
  assert.equal(resolved.state.player.gold, 17);
});

test("boss loot resolves as a reward card before the victory screen", () => {
  const droppingBoss = {
    ...boss,
    id: "dropping-boss",
    maxHp: 1,
    xpReward: 0,
    dropChance: 1,
    dropTable: [{ itemId: "blade", weight: 1 }],
  };
  const bossContent = { ...content, enemies: [regularEnemy, droppingBoss] };
  const base = createInitialState({ seed: 59 });
  const fighting = {
    ...base,
    mode: "combat",
    encounter: {
      enemyId: droppingBoss.id,
      hp: 1,
      lastIntent: null,
      currentIntent: "attack",
      round: 1,
    },
  };

  const combatCard = getNextCard(fighting, bossContent);
  const defeated = resolveChoice(combatCard.state, "right", bossContent, {
    expectedToken: combatCard.card.resolutionToken,
  });
  assert.equal(defeated.card.category, "loot");
  assert.equal(defeated.state.run.bossVictoryPending, true);
  assert.equal(defeated.state.run.bossDefeated, false);

  const kept = resolveChoice(defeated.state, "right", bossContent, {
    expectedToken: defeated.card.resolutionToken,
  });
  assert.equal(kept.card.id, "victory");
  assert.equal(kept.state.mode, "victory");
  assert.ok(kept.state.player.inventory.includes("blade"));
});

test("consumable loot exposes declarative effects for an exact choice preview", () => {
  const base = createInitialState({ seed: 57 });
  const state = {
    ...base,
    run: { ...base.run, forcedCardQueue: [{ cardId: "loot", itemId: "xp-salt" }] },
  };
  const next = getNextCard(state, content);
  assert.deepEqual(next.card.left.effects, [{ type: "addXp", amount: 2 }]);
  const used = resolveChoice(next.state, "left", content, {
    expectedToken: next.card.resolutionToken,
  });
  assert.equal(used.state.player.xp, 2);
});

test("inventory use interrupts for forced level-up, resumes the card, and honors death priority", () => {
  let game = createGame({ seed: 49, content });
  game.state = {
    ...game.state,
    player: { ...game.state.player, xp: 19, inventory: ["xp-salt"] },
  };
  const used = useInventoryItem(game.state, "xp-salt", content);
  assert.equal(used.used, true);
  assert.equal(used.card.id, "level-up");
  assert.equal(used.state.decisionCount, 0);
  const leveled = resolveChoice(used.state, "left", content, { expectedToken: used.card.resolutionToken });
  assert.equal(leveled.card.id, "basic");

  game = createGame({ seed: 50, content });
  game.state = {
    ...game.state,
    player: { ...game.state.player, hp: 1, inventory: ["thorn"] },
  };
  const died = useInventoryItem(game.state, "thorn", content);
  assert.equal(died.state.mode, "gameOver");
  assert.equal(died.card.id, "death");
});

test("restarting preserves meta discoveries and can reuse an explicit seed", () => {
  const state = {
    ...createInitialState({ seed: 51 }),
    meta: { ...createInitialState({ seed: 51 }).meta, deathCount: 4, discoveredEnemyIds: ["foe"] },
  };
  const restarted = restartGame(state, { seed: 99, content });
  assert.equal(restarted.state.runSeed, 99);
  assert.equal(restarted.state.meta.deathCount, 4);
  assert.deepEqual(restarted.state.meta.discoveredEnemyIds, ["foe"]);
  assert.equal(restarted.state.journeyStep, 0);
});

test("save normalization preserves forced-card mode over a paused encounter and combat pacing", () => {
  let state = createInitialState({ seed: 52 });
  state = {
    ...state,
    mode: "levelUp",
    currentCardId: "level-up",
    currentCardData: levelUp,
    currentCardToken: "0:level-up",
    encounter: { enemyId: "foe", hp: 8, lastIntent: "attack", currentIntent: "opening", round: 2 },
    run: { ...state.run, lastCombatTurn: 7 },
  };
  const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.mode, "levelUp");
  assert.equal(loaded.encounter.enemyId, "foe");
  assert.equal(loaded.run.lastCombatTurn, 7);
  assert.equal(getNextCard(loaded, content).card.id, "level-up");
});

test("serializing and normalizing a run does not change its future sequence", () => {
  const game = createGame({ seed: 53, content });
  const first = resolveChoice(game.state, "left", content, {
    expectedToken: game.card.resolutionToken,
  });
  const loaded = normalizeState(JSON.parse(JSON.stringify(first.state)));
  const originalFuture = resolveChoice(first.state, "right", content, {
    expectedToken: first.card.resolutionToken,
  });
  const loadedCard = getNextCard(loaded, content);
  const loadedFuture = resolveChoice(loadedCard.state, "right", content, {
    expectedToken: loadedCard.card.resolutionToken,
  });
  assert.equal(loadedFuture.card.id, originalFuture.card.id);
  assert.equal(loadedFuture.state.rngState, originalFuture.state.rngState);
  assert.equal(loadedFuture.state.player.gold, originalFuture.state.player.gold);
  assert.equal(loadedFuture.state.journeyStep, originalFuture.state.journeyStep);
});

test("malformed saved cards and forced payloads recover to a playable card", () => {
  const base = createInitialState({ seed: 54 });
  const loaded = normalizeState({
    ...base,
    currentCardId: "garbled",
    currentCardToken: "0:garbled",
    currentCardData: {},
    run: {
      ...base.run,
      forcedCardQueue: [{ card: { id: "also-garbled" } }],
    },
  });
  assert.equal(loaded.currentCardData, null);
  const recovered = getNextCard(loaded, content);
  assert.ok(recovered.card.left.label);
  assert.ok(recovered.card.right.label);
  const resolved = resolveChoice(recovered.state, "left", content, {
    expectedToken: recovered.card.resolutionToken,
  });
  assert.equal(resolved.ignored, undefined);

  const badEffects = normalizeState({
    ...base,
    currentCardId: "bad-effects",
    currentCardToken: "0:bad-effects",
    currentCardData: {
      ...basic,
      id: "bad-effects",
      left: { ...basic.left, effects: {} },
    },
  });
  assert.equal(badEffects.currentCardData, null);
  assert.doesNotThrow(() => getNextCard(badEffects, content));

  const badCombinator = normalizeState({
    ...base,
    currentCardId: "bad-combinator",
    currentCardToken: "0:bad-combinator",
    currentCardData: {
      ...basic,
      id: "bad-combinator",
      requirements: [{ type: "any", requirements: {} }],
    },
  });
  assert.doesNotThrow(() => getNextCard(badCombinator, content));
});

test("unavailable or already-resolved persisted cards recover without a soft lock", () => {
  const blocked = {
    ...basic,
    id: "blocked-save",
    baseWeight: 0,
    left: { ...basic.left, requirements: [{ type: "minGold", value: 999 }] },
    right: { ...basic.right, requirements: [{ type: "minGold", value: 999 }] },
  };
  const blockedContent = {
    ...content,
    cards: [...content.cards, blocked],
    cardById: { ...content.cardById, [blocked.id]: blocked },
  };
  const base = createInitialState({ seed: 61 });

  const blockedCurrent = getNextCard({
    ...base,
    currentCardId: blocked.id,
    currentCardData: blocked,
    currentCardToken: `0:${blocked.id}`,
  }, blockedContent);
  assert.notEqual(blockedCurrent.card.id, blocked.id);

  const blockedForced = getNextCard({
    ...base,
    run: { ...base.run, forcedCardQueue: [{ card: blocked }] },
  }, blockedContent);
  assert.notEqual(blockedForced.card.id, blocked.id);

  const stale = getNextCard({
    ...base,
    currentCardId: basic.id,
    currentCardData: basic,
    currentCardToken: `0:${basic.id}`,
    lastResolvedToken: `0:${basic.id}`,
  }, blockedContent);
  const resolved = resolveChoice(stale.state, "left", blockedContent, {
    expectedToken: stale.card.resolutionToken,
  });
  assert.equal(resolved.ignored, undefined);

  const staleDeath = getNextCard({
    ...base,
    mode: "gameOver",
    player: { ...base.player, hp: 0 },
    currentCardId: death.id,
    currentCardData: death,
    currentCardToken: `0:${death.id}`,
    lastResolvedToken: `0:${death.id}`,
  }, blockedContent);
  const restarted = resolveChoice(staleDeath.state, "right", blockedContent, {
    expectedToken: staleDeath.card.resolutionToken,
  });
  assert.equal(restarted.ignored, undefined);
  assert.equal(restarted.state.mode, "exploration");
});

test("inventory changes invalidate a current card whose requirements no longer pass", () => {
  const gated = {
    ...basic,
    id: "salt-trader",
    baseWeight: 0,
    requirements: [{ type: "itemOwned", itemId: "xp-salt" }],
  };
  const gatedContent = {
    ...content,
    cards: [...content.cards, gated],
    cardById: { ...content.cardById, [gated.id]: gated },
  };
  const base = createInitialState({ seed: 55 });
  const state = {
    ...base,
    currentCardId: gated.id,
    currentCardData: gated,
    currentCardToken: `0:${gated.id}`,
    player: { ...base.player, inventory: ["xp-salt"] },
  };
  const used = useInventoryItem(state, "xp-salt", gatedContent);
  assert.equal(used.used, true);
  assert.equal(used.state.player.inventory.includes("xp-salt"), false);
  assert.notEqual(used.card.id, gated.id);
});

test("a level-up interruption does not resume a card invalidated by the used item", () => {
  const gated = {
    ...basic,
    id: "salt-trader-resume",
    baseWeight: 0,
    requirements: [{ type: "itemOwned", itemId: "xp-salt" }],
  };
  const gatedContent = {
    ...content,
    cards: [...content.cards, gated],
    cardById: { ...content.cardById, [gated.id]: gated },
  };
  const base = createInitialState({ seed: 58 });
  const state = {
    ...base,
    currentCardId: gated.id,
    currentCardData: gated,
    currentCardToken: `0:${gated.id}`,
    player: { ...base.player, xp: 19, inventory: ["xp-salt"] },
  };

  const used = useInventoryItem(state, "xp-salt", gatedContent);
  assert.equal(used.card.id, "level-up");
  const leveled = resolveChoice(used.state, "left", gatedContent, {
    expectedToken: used.card.resolutionToken,
  });
  assert.notEqual(leveled.card.id, gated.id);
  assert.equal(leveled.state.player.inventory.includes("xp-salt"), false);
});

test("an unknown saved enemy is cleared before exploration resumes", () => {
  const base = createInitialState({ seed: 56 });
  const loaded = normalizeState({
    ...base,
    mode: "combat",
    encounter: {
      enemyId: "removed-enemy",
      hp: 10,
      lastIntent: null,
      currentIntent: "attack",
      round: 1,
    },
  });
  const recovered = getNextCard(loaded, content);
  assert.equal(recovered.state.encounter, null);
  assert.equal(recovered.state.mode, "exploration");
  assert.ok(recovered.card);
});

test("an invalid saved enemy intent defaults safely to attack", () => {
  const base = createInitialState({ seed: 60 });
  const loaded = normalizeState({
    ...base,
    mode: "combat",
    encounter: {
      enemyId: "foe",
      hp: 8,
      lastIntent: "not-an-intent",
      currentIntent: "",
      round: 1,
    },
  });
  assert.equal(loaded.encounter.currentIntent, "attack");
  assert.equal(loaded.encounter.lastIntent, null);
  assert.doesNotThrow(() => getNextCard(loaded, content));
});
