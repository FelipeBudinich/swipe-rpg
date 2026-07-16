import assert from "node:assert/strict";
import test from "node:test";

import { EMBER_CROWN_BEAT_IDS } from "../public/js/data/arcs/ember-crown.js";
import {
  auditSeeds,
  shouldDismissStoryTransition,
  simulateRun,
  simulateStructuralRun,
} from "../scripts/audit-runs.mjs";

function decisionTurns(run) {
  return run.transcript.filter(({ kind }) => kind === "decision");
}

function visitedBeatIds(run) {
  const ordered = [];
  for (const { beatId } of decisionTurns(run)) {
    if (typeof beatId === "string" && ordered.at(-1) !== beatId) ordered.push(beatId);
  }
  return ordered;
}

function indexOfCard(run, predicate) {
  return decisionTurns(run).findIndex((turn) => predicate(turn.cardId, turn));
}

function lastIndexOfCard(run, predicate) {
  return decisionTurns(run).findLastIndex((turn) => predicate(turn.cardId, turn));
}

function assertRewardTranscript(turn, enemyId) {
  assert.equal(turn.enemyId, enemyId);
  assert.equal(typeof turn.rewardId, "string");
  assert.ok(turn.rewardId.length > 0);
  assert.ok(Number.isFinite(turn.xpAwarded));
  assert.ok(Number.isFinite(turn.goldAwarded));
  assert.ok(turn.itemId === null || typeof turn.itemId === "string");
}

function assertCompleteStructuralRun(run, { endingId, finalImageCardId }) {
  assert.equal(run.stallReason, null);
  assert.equal(run.state.mode, "victory");
  assert.equal(run.state.story.status, "completed");
  assert.equal(run.state.story.completed, true);
  assert.equal(run.state.story.endingId, endingId);
  assert.deepEqual(run.state.story.completedBeatIds, EMBER_CROWN_BEAT_IDS);
  assert.deepEqual(visitedBeatIds(run), EMBER_CROWN_BEAT_IDS);
  assert.ok(run.state.story.totalWorldCardsResolved >= 30);
  assert.ok(run.state.story.totalWorldCardsResolved <= 40);
  assert.equal(run.state.meta.victoryCount, 1);

  const turns = decisionTurns(run);
  assert.equal(
    turns.some(({ cardId, source }) =>
      cardId === "story-safe-fallback" || source === "safe-fallback"),
    false,
  );

  const midpointIntro = indexOfCard(run, (id) =>
    ["midpoint-sun-shard-challenge", "midpoint-serins-counterseal"].includes(id),
  );
  const wyvernCombat = lastIndexOfCard(run, (id) => id.startsWith("combat:iron-wyvern:"));
  const wyvernRewards = turns.filter(({ mode, enemyId }) =>
    mode === "combatReward" && enemyId === "iron-wyvern");
  const wyvernReward = indexOfCard(run, (id, turn) =>
    turn.mode === "combatReward" &&
    turn.enemyId === "iron-wyvern" &&
    id.startsWith("combat-reward:"));
  const midpointAftermath = indexOfCard(run, (id) => id === "midpoint-wyvern-aftermath");
  assert.ok(midpointIntro >= 0);
  assert.ok(wyvernCombat > midpointIntro);
  assert.equal(wyvernRewards.length, 1);
  assertRewardTranscript(wyvernRewards[0], "iron-wyvern");
  assert.ok(wyvernReward > wyvernCombat);
  assert.ok(midpointAftermath > wyvernReward);
  assert.ok(Number(run.state.run.enemiesDefeated["iron-wyvern"] ?? 0) > 0);

  const malrecIntro = indexOfCard(run, (id) =>
    ["finale-malrec-infiltration", "finale-malrec-confrontation"].includes(id),
  );
  const malrecCombat = lastIndexOfCard(run, (id) => id.startsWith("combat:malrec-crown-bound:"));
  const malrecRewards = turns.filter(({ mode, enemyId }) =>
    mode === "combatReward" && enemyId === "malrec-crown-bound");
  const malrecReward = indexOfCard(run, (id, turn) =>
    turn.mode === "combatReward" &&
    turn.enemyId === "malrec-crown-bound" &&
    id.startsWith("combat-reward:"));
  const crownChoice = indexOfCard(run, (id) => id === "finale-fate-of-the-crown");
  const finalImage = indexOfCard(run, (id) => id === finalImageCardId);
  assert.ok(malrecIntro >= 0);
  assert.ok(malrecCombat > malrecIntro);
  assert.equal(malrecRewards.length, 1);
  assertRewardTranscript(malrecRewards[0], "malrec-crown-bound");
  assert.ok(malrecReward > malrecCombat);
  assert.ok(crownChoice > malrecReward);
  assert.ok(finalImage > crownChoice);
  assert.equal(turns.at(-1).cardId, finalImageCardId);
  assert.ok(Number(run.state.run.enemiesDefeated["malrec-crown-bound"] ?? 0) > 0);
}

test("audit transition handling preserves priority reward surfaces", () => {
  const state = {
    mode: "combatReward",
    story: { pendingInterstitialBeatId: "midpoint" },
    currentCardData: { category: "combatReward" },
  };
  const reward = { category: "combatReward" };
  assert.equal(shouldDismissStoryTransition(state, reward), false);
  assert.equal(
    shouldDismissStoryTransition(
      { ...state, mode: "storyTransition", currentCardData: null },
      { category: "story" },
    ),
    true,
  );
});

test("ordinary seeded play is deterministic and reaches only death or survival", () => {
  const first = simulateRun(1);
  const replay = simulateRun(1);
  assert.deepEqual(replay.state, first.state);
  assert.deepEqual(replay.transcript, first.transcript);
  assert.equal(replay.stallReason, null);
  assert.ok(["victory", "gameOver"].includes(first.state.mode));
});

test("a broad ordinary seed audit has victories, deaths, and no soft locks", () => {
  const audit = auditSeeds(64);
  assert.equal(audit.stalled.length, 0);
  assert.equal(audit.victories.length + audit.deaths.length, audit.runs.length);
  assert.ok(audit.victories.length > 0);
  assert.ok(audit.deaths.length > 0);
  for (const run of audit.runs) assert.equal(run.stallReason, null);
  for (const run of audit.victories) {
    assert.ok(run.state.story.totalWorldCardsResolved >= 30);
    assert.ok(run.state.story.totalWorldCardsResolved <= 40);
  }
});

test("boosted structural runs traverse all beats and reach both ending-specific Final Images", () => {
  const crown = simulateStructuralRun(101, "crown-of-dawn");
  const unbound = simulateStructuralRun(202, "unbound-flame");

  assertCompleteStructuralRun(crown, {
    endingId: "crown-of-dawn",
    finalImageCardId: "final-image-crown-of-dawn",
  });
  assertCompleteStructuralRun(unbound, {
    endingId: "unbound-flame",
    finalImageCardId: "final-image-unbound-flame",
  });

  const replay = simulateStructuralRun(101, "crown-of-dawn");
  assert.deepEqual(replay.state, crown.state);
  assert.deepEqual(replay.transcript, crown.transcript);
});
