import assert from "node:assert/strict";
import test from "node:test";

import { EMBER_CROWN_BEAT_IDS } from "../public/js/data/arcs/ember-crown.js";
import {
  auditSeeds,
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
  const wyvernCombat = indexOfCard(run, (id) => id.startsWith("combat:iron-wyvern:"));
  const midpointAftermath = indexOfCard(run, (id) => id === "midpoint-wyvern-aftermath");
  assert.ok(midpointIntro >= 0);
  assert.ok(wyvernCombat > midpointIntro);
  assert.ok(midpointAftermath > wyvernCombat);
  assert.ok(Number(run.state.run.enemiesDefeated["iron-wyvern"] ?? 0) > 0);

  const malrecIntro = indexOfCard(run, (id) =>
    ["finale-malrec-infiltration", "finale-malrec-confrontation"].includes(id),
  );
  const malrecCombat = indexOfCard(run, (id) => id.startsWith("combat:malrec-crown-bound:"));
  const crownChoice = indexOfCard(run, (id) => id === "finale-fate-of-the-crown");
  const finalImage = indexOfCard(run, (id) => id === finalImageCardId);
  assert.ok(malrecIntro >= 0);
  assert.ok(malrecCombat > malrecIntro);
  assert.ok(crownChoice > malrecCombat);
  assert.ok(finalImage > crownChoice);
  assert.equal(turns.at(-1).cardId, finalImageCardId);
  assert.ok(Number(run.state.run.enemiesDefeated["malrec-crown-bound"] ?? 0) > 0);
}

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
