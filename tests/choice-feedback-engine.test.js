import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONTENT,
  createGame,
  dismissChoiceFeedback,
  getNextCard,
  resolveChoice,
} from "../public/js/game/engine.js";
import {
  SAVE_VERSION,
  STORY_BEAT_IDS,
  createInitialState,
  normalizeState,
} from "../public/js/game/state.js";
import { loadState, saveState } from "../public/js/storage.js";

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolvePresented(presented, direction = "left", content = DEFAULT_CONTENT) {
  return resolveChoice(presented.state, direction, content, {
    expectedToken: presented.card.resolutionToken,
  });
}

function firstFeedback(seed = 801) {
  const game = createGame({ seed });
  const resolved = resolvePresented(game);
  assert.ok(resolved.state.pendingChoiceFeedback);
  return { game, resolved };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function stateAtBeat(beatId, seed = 1) {
  const index = STORY_BEAT_IDS.indexOf(beatId);
  const base = createInitialState({ seed });
  return {
    ...base,
    player: {
      ...base.player,
      hp: 999,
      mp: 100,
      baseStats: { attack: 150, defense: 100, maxHp: 999, maxMp: 100 },
    },
    story: {
      ...base.story,
      currentBeatId: beatId,
      currentBeatIndex: index,
      cardsResolvedInBeat: 0,
      cardsResolvedByBeat: Object.fromEntries(
        STORY_BEAT_IDS.slice(0, index).map((id) => [id, 1]),
      ),
      completedBeatIds: STORY_BEAT_IDS.slice(0, index),
      facts: {
        learnedCrownTruth: true,
        trustedSerin: true,
        renewedPurpose: "carryTogether",
        finalPlan: "infiltrateCitadel",
      },
    },
  };
}

function combatState({
  seed = 811,
  enemyHp,
  attack = 5,
  playerHp = 30,
} = {}) {
  const enemy = DEFAULT_CONTENT.enemies.find(({ id }) => id === "ember-slime");
  const base = createInitialState({ seed });
  return {
    enemy,
    state: {
      ...base,
      mode: "combat",
      player: {
        ...base.player,
        hp: playerHp,
        baseStats: { ...base.player.baseStats, attack },
      },
      encounter: {
        enemyId: enemy.id,
        hp: enemyHp ?? enemy.maxHp,
        lastIntent: null,
        currentIntent: "attack",
        round: 1,
        originBeatId: base.story.currentBeatId,
        kind: "random",
        phase: 1,
      },
    },
  };
}

test("a real first world choice persists authored feedback over its selected successor", () => {
  const { game, resolved } = firstFeedback(802);
  const feedback = resolved.state.pendingChoiceFeedback;

  assert.equal(game.card.id, "opening-hearthvale-oath");
  assert.equal(feedback.sourceCardId, game.card.id);
  assert.equal(feedback.sourceResolutionToken, game.card.resolutionToken);
  assert.equal(feedback.id, `choice-feedback:${game.card.resolutionToken}`);
  assert.equal(feedback.resultText, game.card.left.resultText);
  assert.deepEqual(feedback.changes, { xp: 2 });
  assert.equal(feedback.nextCardId, resolved.card.id);
  assert.equal(feedback.nextCardId, resolved.state.currentCardId);
  assert.equal(feedback.nextCardToken, resolved.card.resolutionToken);
  assert.equal(feedback.nextCardToken, resolved.state.currentCardToken);
  assert.equal(resolved.state.currentCardData.id, resolved.card.id);
  assert.notEqual(resolved.state.rngState, game.state.rngState);
});

test("feedback dismissal reveals the exact successor without changing deterministic state", () => {
  const { resolved } = firstFeedback(803);
  const before = resolved.state;
  const feedbackId = before.pendingChoiceFeedback.id;
  const invariants = {
    currentCardId: before.currentCardId,
    currentCardToken: before.currentCardToken,
    currentCardData: before.currentCardData,
    rngState: before.rngState,
    decisionCount: before.decisionCount,
    storyTotal: before.story.totalWorldCardsResolved,
    recentCardIds: before.run.recentCardIds,
    lastSeenTurnByCardId: before.run.lastSeenTurnByCardId,
    resolvedCardIds: before.run.resolvedCardIds,
    lastResolvedToken: before.lastResolvedToken,
  };

  const dismissed = dismissChoiceFeedback(before, { expectedFeedbackId: feedbackId });
  assert.equal(dismissed.ignored, false);
  assert.equal(dismissed.reason, null);
  assert.equal(dismissed.state.pendingChoiceFeedback, null);
  assert.equal(dismissed.card.id, invariants.currentCardId);
  assert.equal(dismissed.card.resolutionToken, invariants.currentCardToken);
  assert.equal(dismissed.state.currentCardId, invariants.currentCardId);
  assert.equal(dismissed.state.currentCardToken, invariants.currentCardToken);
  assert.deepEqual(dismissed.state.currentCardData, invariants.currentCardData);
  assert.equal(dismissed.state.rngState, invariants.rngState);
  assert.equal(dismissed.state.decisionCount, invariants.decisionCount);
  assert.equal(dismissed.state.story.totalWorldCardsResolved, invariants.storyTotal);
  assert.deepEqual(dismissed.state.run.recentCardIds, invariants.recentCardIds);
  assert.deepEqual(dismissed.state.run.lastSeenTurnByCardId, invariants.lastSeenTurnByCardId);
  assert.deepEqual(dismissed.state.run.resolvedCardIds, invariants.resolvedCardIds);
  assert.equal(dismissed.state.lastResolvedToken, invariants.lastResolvedToken);
});

test("stale and duplicate feedback dismissal requests are inert", () => {
  const { resolved } = firstFeedback(804);
  const feedbackId = resolved.state.pendingChoiceFeedback.id;

  const stale = dismissChoiceFeedback(resolved.state, {
    expectedFeedbackId: `${feedbackId}:stale`,
  });
  assert.equal(stale.ignored, true);
  assert.equal(stale.reason, "stale-feedback");
  assert.equal(stale.state, resolved.state);

  const dismissed = dismissChoiceFeedback(resolved.state, {
    expectedFeedbackId: feedbackId,
  });
  const duplicate = dismissChoiceFeedback(dismissed.state, {
    expectedFeedbackId: feedbackId,
  });
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "no-feedback");
  assert.equal(duplicate.state, dismissed.state);
});

test("direct choice resolution cannot bypass pending feedback", () => {
  const { resolved } = firstFeedback(805);
  const before = jsonRoundTrip(resolved.state);
  const bypass = resolveChoice(resolved.state, "right", DEFAULT_CONTENT, {
    expectedToken: resolved.state.currentCardToken,
  });

  assert.equal(bypass.ignored, true);
  assert.equal(bypass.reason, "feedback-pending");
  assert.equal(bypass.state, resolved.state);
  assert.deepEqual(bypass.state, before);
  assert.equal(bypass.card.id, resolved.card.id);
});

test("save, reload, and startup preparation preserve feedback and do not duplicate effects", () => {
  const { resolved } = firstFeedback(806);
  const storage = memoryStorage();
  assert.equal(saveState(resolved.state, { storage }), true);

  const loaded = loadState({
    storage,
    createFallback: () => createInitialState({ seed: 999 }),
    normalize: (raw) => normalizeState(raw),
  });
  assert.deepEqual(loaded.pendingChoiceFeedback, resolved.state.pendingChoiceFeedback);
  assert.equal(loaded.currentCardId, resolved.state.currentCardId);
  assert.equal(loaded.currentCardToken, resolved.state.currentCardToken);
  assert.equal(loaded.rngState, resolved.state.rngState);
  assert.equal(loaded.player.xp, resolved.state.player.xp);

  const prepared = getNextCard(loaded);
  assert.equal(prepared.card.id, resolved.card.id);
  assert.equal(prepared.state.currentCardToken, resolved.state.currentCardToken);
  assert.equal(prepared.state.rngState, resolved.state.rngState);
  assert.equal(prepared.state.player.xp, resolved.state.player.xp);
  assert.deepEqual(prepared.state.pendingChoiceFeedback, resolved.state.pendingChoiceFeedback);

  const dismissed = dismissChoiceFeedback(prepared.state, {
    expectedFeedbackId: prepared.state.pendingChoiceFeedback.id,
  });
  assert.equal(dismissed.state.player.xp, 2);
  assert.equal(dismissed.card.id, resolved.card.id);
});

test("malformed feedback is discarded while the valid run and successor survive", () => {
  const { resolved } = firstFeedback(807);
  const malformed = {
    ...jsonRoundTrip(resolved.state),
    pendingChoiceFeedback: {
      ...resolved.state.pendingChoiceFeedback,
      id: "unrelated-feedback",
      changes: { xp: Number.POSITIVE_INFINITY },
    },
  };
  const normalized = normalizeState(malformed);

  assert.equal(normalized.pendingChoiceFeedback, null);
  assert.equal(normalized.currentCardId, resolved.state.currentCardId);
  assert.equal(normalized.currentCardToken, resolved.state.currentCardToken);
  assert.equal(normalized.rngState, resolved.state.rngState);
  assert.equal(normalized.decisionCount, resolved.state.decisionCount);
  assert.equal(normalized.player.xp, resolved.state.player.xp);
  assert.equal(normalized.story.totalWorldCardsResolved, 1);
  assert.equal(getNextCard(normalized).card.id, resolved.card.id);
});

test("existing version-two saves without feedback normalize to null", () => {
  const versionTwo = jsonRoundTrip(createGame({ seed: 808 }).state);
  delete versionTwo.pendingChoiceFeedback;
  assert.equal(versionTwo.version, SAVE_VERSION);

  const normalized = normalizeState(versionTwo);
  assert.equal(normalized.version, SAVE_VERSION);
  assert.equal(normalized.pendingChoiceFeedback, null);
  assert.equal(normalized.currentCardId, versionTwo.currentCardId);
  assert.equal(normalized.currentCardToken, versionTwo.currentCardToken);
});

test("an encounter introduction creates feedback over combat, then reveals that combat card", () => {
  const intro = getNextCard(stateAtBeat("midpoint", 809));
  assert.match(intro.card.id, /^midpoint-/);
  const resolved = resolvePresented(intro);

  assert.equal(resolved.state.mode, "combat");
  assert.equal(resolved.card.category, "combat");
  assert.ok(resolved.state.pendingChoiceFeedback);
  assert.equal(resolved.state.pendingChoiceFeedback.nextCardId, resolved.card.id);
  assert.equal(resolved.state.pendingChoiceFeedback.nextCardToken, resolved.card.resolutionToken);

  const dismissed = dismissChoiceFeedback(resolved.state, {
    expectedFeedbackId: resolved.state.pendingChoiceFeedback.id,
  });
  assert.equal(dismissed.state.mode, "combat");
  assert.equal(dismissed.card.id, resolved.card.id);
  assert.equal(dismissed.card.resolutionToken, resolved.card.resolutionToken);
});

test("nonlethal combat advances immediately without generic feedback", () => {
  const { state } = combatState({ seed: 810 });
  const combat = getNextCard(state);
  const resolved = resolvePresented(combat, "left");

  assert.equal(resolved.combat.enemyDefeated, false);
  assert.equal(resolved.state.mode, "combat");
  assert.equal(resolved.card.category, "combat");
  assert.equal(resolved.state.pendingChoiceFeedback, null);
});

test("lethal combat goes directly to Battle Rewards without generic feedback", () => {
  const { state } = combatState({ seed: 811, enemyHp: 1, attack: 100 });
  const combat = getNextCard(state);
  assert.equal(combat.card.right.action, "strike");
  const defeated = resolvePresented(combat, "right");

  assert.equal(defeated.combat.enemyDefeated, true);
  assert.equal(defeated.state.mode, "combatReward");
  assert.equal(defeated.card.category, "combatReward");
  assert.equal(defeated.state.pendingChoiceFeedback, null);
});

test("resolving Battle Rewards remains immediate and creates no generic feedback", () => {
  const { state } = combatState({ seed: 812, enemyHp: 1, attack: 100 });
  const combat = getNextCard(state);
  const reward = resolvePresented(combat, "right");
  const resolved = resolvePresented(reward, "left");

  assert.equal(reward.card.category, "combatReward");
  assert.equal(resolved.state.pendingChoiceFeedback, null);
  assert.notEqual(resolved.card?.category, "combatReward");
});

test("a world choice crossing the XP threshold goes directly to Level Up", () => {
  const game = createGame({ seed: 813 });
  const nearLevel = {
    ...game.state,
    player: { ...game.state.player, xp: 18 },
  };
  const leveled = resolveChoice(nearLevel, "left", DEFAULT_CONTENT, {
    expectedToken: game.card.resolutionToken,
  });

  assert.equal(leveled.state.player.level, 2);
  assert.equal(leveled.state.mode, "levelUp");
  assert.equal(leveled.card.category, "levelUp");
  assert.equal(leveled.state.pendingChoiceFeedback, null);

  const specialized = resolvePresented(leveled, "left");
  assert.equal(specialized.state.pendingChoiceFeedback, null);
  assert.notEqual(specialized.card?.category, "levelUp");
});

test("a beat-completing world choice goes directly to its story transition", () => {
  const base = stateAtBeat("debate", 814);
  const prepared = getNextCard({
    ...base,
    story: { ...base.story, cardsResolvedInBeat: 1 },
    run: { ...base.run, forcedCardQueue: ["debate-serins-map"] },
  });
  assert.equal(prepared.card.id, "debate-serins-map");
  const resolved = resolvePresented(prepared);

  assert.equal(resolved.state.mode, "storyTransition");
  assert.equal(resolved.card, null);
  assert.equal(resolved.state.story.currentBeatId, "breakIntoTwo");
  assert.equal(resolved.state.story.pendingInterstitialBeatId, "breakIntoTwo");
  assert.equal(resolved.state.pendingChoiceFeedback, null);
});

test("legacy loot resolves without generic feedback", () => {
  const item = DEFAULT_CONTENT.items.find(
    ({ type, sellable, discardable }) =>
      type === "equipment" && sellable !== false && discardable !== false,
  );
  const base = createInitialState({ seed: 815 });
  const loot = getNextCard({
    ...base,
    run: {
      ...base.run,
      forcedCardQueue: [{ cardId: "loot", itemId: item.id }],
    },
  });
  assert.equal(loot.card.category, "loot");

  const resolved = resolvePresented(loot, "right");
  assert.equal(resolved.state.pendingChoiceFeedback, null);
  assert.ok(resolved.state.player.inventory.includes(item.id));
});

test("Final Image resolves directly to victory without generic feedback", () => {
  const base = stateAtBeat("finalImage", 816);
  const finalImage = getNextCard({
    ...base,
    story: {
      ...base.story,
      endingId: "crown-of-dawn",
      endingTitle: "Crown of Dawn",
    },
  });
  assert.equal(finalImage.card.id, "final-image-crown-of-dawn");

  const completed = resolvePresented(finalImage);
  assert.equal(completed.state.mode, "victory");
  assert.equal(completed.card.id, "victory");
  assert.equal(completed.state.pendingChoiceFeedback, null);
});

test("combat death reaches the terminal surface without generic feedback", () => {
  const { state } = combatState({
    seed: 817,
    enemyHp: 100,
    attack: 0,
    playerHp: 1,
  });
  const combat = getNextCard(state);
  const defeated = resolvePresented(combat, "right");

  assert.equal(defeated.state.mode, "gameOver");
  assert.equal(defeated.card.id, "death");
  assert.equal(defeated.state.pendingChoiceFeedback, null);
});
