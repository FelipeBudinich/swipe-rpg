import test from "node:test";
import assert from "node:assert/strict";

import { EMBER_CROWN_ARC } from "../public/js/data/arcs/ember-crown.js";
import {
  createGame,
  dismissChoiceFeedback,
  dismissStoryTransition,
  getNextCard,
  resolveChoice,
  restartGame,
} from "../public/js/game/engine.js";
import { createInitialState, normalizeState, STORY_BEAT_IDS } from "../public/js/game/state.js";

function boosted(state) {
  return {
    ...state,
    player: {
      ...state.player,
      hp: 999,
      mp: 100,
      baseStats: { attack: 150, defense: 100, maxHp: 999, maxMp: 100 },
    },
  };
}

function stateAtBeat(beatId, seed = 1) {
  const index = STORY_BEAT_IDS.indexOf(beatId);
  const base = createInitialState({ seed });
  return boosted({
    ...base,
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
  });
}

function availableDirection(card, preferred = "left") {
  if (card?.[preferred] && !card[preferred].disabled) return preferred;
  const alternate = preferred === "left" ? "right" : "left";
  if (card?.[alternate] && !card[alternate].disabled) return alternate;
  throw new Error(`No enabled choice on ${card?.id ?? "unknown card"}`);
}

function damagingDirection(card) {
  for (const direction of ["right", "left"]) {
    if (
      ["strike", "technique", "break"].includes(card?.[direction]?.action) &&
      !card[direction].disabled
    ) {
      return direction;
    }
  }
  return availableDirection(card);
}

function resolveVisible(state, card, preferred = "left") {
  return resolveChoice(state, availableDirection(card, preferred), undefined, {
    expectedToken: card.resolutionToken,
  });
}

function acknowledgeChoiceFeedback(result) {
  if (!result.state.pendingChoiceFeedback) return result;
  return dismissChoiceFeedback(result.state, {
    expectedFeedbackId: result.state.pendingChoiceFeedback.id,
  });
}

test("a new arc always opens on the authored Opening Image entry", () => {
  const game = createGame({ seed: 44 });
  assert.equal(game.state.story.currentBeatId, "openingImage");
  assert.equal(game.card.id, "opening-hearthvale-oath");
  assert.equal(game.card.story.countsTowardStory, true);

  const resolved = resolveVisible(game.state, game.card);
  assert.equal(resolved.state.story.currentBeatId, "themeStated");
  assert.equal(resolved.state.story.totalWorldCardsResolved, 1);
  assert.deepEqual(resolved.state.story.completedBeatIds, ["openingImage"]);
});

test("a custom nine-phase arc initializes from its authored phase ordering", () => {
  const phaseIds = Array.from({ length: 9 }, (_, index) => `phase-${index + 1}`);
  const openingCard = {
    id: "nine-phase-opening",
    category: "story",
    speaker: "The Test Keeper",
    title: "A Shorter Road",
    text: "Nine phases begin here.",
    baseWeight: 1,
    cooldown: 0,
    oncePerRun: false,
    requirements: [],
    story: {
      arcIds: ["nine-phase"],
      beatWeights: { "phase-1": 1 },
      role: "entry",
      completionTags: [],
      countsTowardStory: true,
    },
    left: { label: "Begin", resultText: "The road opens.", effects: [] },
    right: { label: "Prepare", resultText: "The road waits.", effects: [] },
  };
  const arc = {
    id: "nine-phase",
    title: "Nine Phase",
    beats: phaseIds.map((id, index) => ({
      id,
      name: `Phase ${index + 1}`,
      budget: { minimum: 1, target: 1, maximum: 1 },
      completionObjective: { type: "storyTagResolved", tag: `complete-${id}` },
      completionCardIds: index === 0 ? [openingCard.id] : [],
      encounterPolicy: { mode: "none" },
    })),
    endings: [],
  };

  const game = createGame({
    seed: 43,
    arcId: arc.id,
    meta: { furthestBeatIndex: 99 },
    content: {
      cards: [openingCard],
      enemies: [],
      items: [],
      arcs: [arc],
    },
  });

  assert.equal(game.state.story.arcId, arc.id);
  assert.equal(game.state.story.currentBeatId, "phase-1");
  assert.equal(game.state.story.currentBeatIndex, 0);
  assert.equal(game.state.meta.furthestBeatId, "phase-9");
  assert.equal(game.state.meta.furthestBeatIndex, 8);
  assert.equal(game.card.id, openingCard.id);
});

test("world decisions are atomic, count once, and reject a stale resolution token", () => {
  const game = createGame({ seed: 45 });
  const token = game.card.resolutionToken;
  const resolved = resolveChoice(game.state, "left", undefined, { expectedToken: token });
  assert.equal(resolved.state.decisionCount, 1);
  assert.equal(resolved.state.story.totalWorldCardsResolved, 1);

  const acknowledged = acknowledgeChoiceFeedback(resolved);
  const duplicate = resolveChoice(acknowledged.state, "left", undefined, { expectedToken: token });
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.reason, "stale-resolution");
  assert.equal(duplicate.state.story.totalWorldCardsResolved, 1);
});

test("death outranks a transition, queued story card, and current card", () => {
  const base = createInitialState({ seed: 46 });
  const state = {
    ...base,
    mode: "storyTransition",
    player: { ...base.player, hp: 0 },
    currentCardId: "opening-hearthvale-oath",
    currentCardToken: "0:opening-hearthvale-oath",
    story: { ...base.story, pendingInterstitialBeatId: "midpoint" },
    run: {
      ...base.run,
      forcedCardQueue: [
        { cardId: "midpoint-wyvern-aftermath", originBeatId: "midpoint", beatLocal: true },
      ],
    },
  };
  const next = getNextCard(state);
  assert.equal(next.state.mode, "gameOver");
  assert.equal(next.card.id, "death");
  assert.equal(next.state.meta.deathCount, 1);
  assert.equal(next.state.story.status, "failed");
  assert.equal(getNextCard(next.state).state.meta.deathCount, 1);
});

test("major interstitials block binary cards until explicitly dismissed", () => {
  const state = {
    ...stateAtBeat("breakIntoTwo", 47),
    mode: "storyTransition",
    story: {
      ...stateAtBeat("breakIntoTwo", 47).story,
      pendingInterstitialBeatId: "breakIntoTwo",
    },
  };
  const waiting = getNextCard(state);
  assert.equal(waiting.card, null);
  assert.equal(waiting.source, "story-transition");

  const continued = dismissStoryTransition(waiting.state);
  assert.equal(continued.state.story.pendingInterstitialBeatId, null);
  assert.ok(continued.state.story.shownInterstitialBeatIds.includes("breakIntoTwo"));
  assert.equal(continued.card.story.role, "anchor");
});

test("Midpoint orders intro, Iron Wyvern, battle rewards, level-up, and aftermath", () => {
  let next = getNextCard(stateAtBeat("midpoint", 48));
  assert.equal(next.card.story.role, "anchor");
  assert.match(next.card.id, /^midpoint-/);

  next = resolveVisible(next.state, next.card);
  assert.ok(next.state.pendingChoiceFeedback);
  next = acknowledgeChoiceFeedback(next);
  assert.equal(next.state.mode, "combat");
  assert.equal(next.state.encounter.enemyId, EMBER_CROWN_ARC.midbossId);
  assert.equal(next.state.story.cardsResolvedInBeat, 1);
  assert.ok(
    next.state.run.forcedCardQueue.some(
      (entry) => entry.cardId === "midpoint-wyvern-aftermath" && entry.beatLocal,
    ),
  );

  const defeated = resolveChoice(next.state, damagingDirection(next.card), undefined, {
    expectedToken: next.card.resolutionToken,
  });
  assert.equal(defeated.state.story.facts.ironWyvernDefeated, true);
  assert.equal(defeated.state.run.enemiesDefeated[EMBER_CROWN_ARC.midbossId], 1);
  assert.equal(defeated.card.category, "combatReward");
  assert.equal(defeated.card.reward.enemyId, EMBER_CROWN_ARC.midbossId);
  assert.equal(defeated.card.reward.itemId, "dawn-compass");

  const rewarded = resolveVisible(defeated.state, defeated.card, "right");
  assert.equal(rewarded.card.category, "levelUp");
  assert.ok(rewarded.state.player.inventory.includes("dawn-compass"));
  const leveled = resolveVisible(rewarded.state, rewarded.card);
  assert.equal(leveled.card.id, "midpoint-wyvern-aftermath");
  assert.equal(leveled.state.story.currentBeatId, "midpoint");

  const aftermath = resolveVisible(leveled.state, leveled.card);
  assert.equal(aftermath.state.story.currentBeatId, "badGuysCloseIn");
  assert.equal(aftermath.state.story.cardsResolvedByBeat.midpoint, 2);
});

test("Finale reserves two preparations, then resolves Malrec before ending choice", () => {
  let next = getNextCard(stateAtBeat("finale", 49));
  const preparations = [];
  for (let index = 0; index < 2; index += 1) {
    assert.notEqual(next.card.story.role, "anchor");
    preparations.push(next.card.id);
    next = resolveVisible(next.state, next.card);
    next = acknowledgeChoiceFeedback(next);
  }
  assert.equal(new Set(preparations).size, 2);
  assert.equal(next.card.story.role, "anchor");
  assert.match(next.card.id, /^finale-malrec-/);

  next = resolveVisible(next.state, next.card);
  assert.ok(next.state.pendingChoiceFeedback);
  next = acknowledgeChoiceFeedback(next);
  assert.equal(next.state.encounter.enemyId, EMBER_CROWN_ARC.finalBossId);
  const bossResult = resolveChoice(next.state, damagingDirection(next.card), undefined, {
    expectedToken: next.card.resolutionToken,
  });
  assert.equal(bossResult.state.story.facts.malrecDefeated, true);
  assert.notEqual(bossResult.state.mode, "victory");
  assert.equal(bossResult.card.category, "combatReward");
  assert.equal(bossResult.card.reward.enemyId, EMBER_CROWN_ARC.finalBossId);

  next = resolveVisible(bossResult.state, bossResult.card);
  while (next.state.mode === "levelUp") {
    next = resolveVisible(next.state, next.card, "left");
  }
  assert.equal(next.card.id, "finale-fate-of-the-crown");
  assert.notEqual(next.state.mode, "victory");

  next = resolveVisible(next.state, next.card, "left");
  assert.equal(next.state.story.endingId, "crown-of-dawn");
  assert.equal(next.state.story.currentBeatId, "finalImage");
  assert.equal(next.card.id, "final-image-crown-of-dawn");
  assert.notEqual(next.state.mode, "victory");

  const completed = resolveVisible(next.state, next.card);
  assert.equal(completed.state.mode, "victory");
  assert.equal(completed.state.story.completed, true);
  assert.equal(completed.state.meta.victoryCount, 1);
  assert.ok(completed.state.meta.discoveredEndingIds.includes("crown-of-dawn"));
});

test("selected anchor survives serialization and does not reroll after facts change", () => {
  const base = stateAtBeat("allIsLost", 50);
  const withFacts = {
    ...base,
    player: { ...base.player, gold: 20 },
    story: { ...base.story, facts: { ...base.story.facts, recoveredSunShard: true } },
  };
  const selected = getNextCard(withFacts);
  const selectedId = selected.state.story.selectedAnchorIdByBeat.allIsLost;
  assert.equal(selected.card.id, selectedId);

  const loaded = normalizeState(JSON.parse(JSON.stringify(selected.state)));
  const changed = {
    ...loaded,
    player: { ...loaded.player, gold: 0 },
    story: { ...loaded.story, facts: {} },
  };
  const replay = getNextCard(changed);
  assert.equal(replay.card.id, selectedId);
  assert.equal(replay.state.rngState, loaded.rngState);
});

test("version-one journey saves preserve only compatible meta and restart at Opening Image", () => {
  const migrated = normalizeState({
    version: 1,
    runSeed: 88,
    journeyStep: 19,
    player: { level: 9, hp: 1 },
    run: { flags: { incompatible: true } },
    meta: {
      bestLevel: 7,
      deathCount: 3,
      discoveredEnemyIds: ["iron-wyvern"],
      discoveredItemIds: ["dawn-compass"],
    },
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.story.currentBeatId, "openingImage");
  assert.equal(migrated.story.totalWorldCardsResolved, 0);
  assert.equal(migrated.player.level, 1);
  assert.deepEqual(migrated.run.flags, {});
  assert.equal(migrated.meta.bestLevel, 7);
  assert.equal(migrated.meta.deathCount, 3);
  assert.deepEqual(migrated.meta.discoveredEnemyIds, ["iron-wyvern"]);
});

test("restart preserves meta discoveries and resets the same arc with an explicit seed", () => {
  const base = createInitialState({ seed: 51 });
  const state = {
    ...base,
    meta: {
      ...base.meta,
      deathCount: 4,
      discoveredEnemyIds: ["iron-wyvern"],
      discoveredEndingIds: ["unbound-flame"],
    },
  };
  const restarted = restartGame(state, { seed: 99 });
  assert.equal(restarted.state.runSeed, 99);
  assert.equal(restarted.state.story.arcId, "ember-crown");
  assert.equal(restarted.state.story.currentBeatId, "openingImage");
  assert.equal(restarted.state.meta.deathCount, 4);
  assert.deepEqual(restarted.state.meta.discoveredEndingIds, ["unbound-flame"]);
});

test("serializing a current story card preserves its future seeded result", () => {
  const game = createGame({ seed: 52 });
  const loaded = normalizeState(JSON.parse(JSON.stringify(game.state)));
  const original = resolveVisible(game.state, game.card);
  const loadedCard = getNextCard(loaded);
  const replay = resolveVisible(loadedCard.state, loadedCard.card);
  assert.equal(replay.card.id, original.card.id);
  assert.equal(replay.state.rngState, original.state.rngState);
  assert.deepEqual(replay.state.story, original.state.story);
});
