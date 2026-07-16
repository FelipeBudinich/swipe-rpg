import assert from "node:assert/strict";
import test from "node:test";

import { auditSeeds, simulateRun } from "../scripts/audit-runs.mjs";

test("a fixed ordinary run reaches the mandatory boss and victory deterministically", () => {
  const first = simulateRun(1);
  const replay = simulateRun(1);

  assert.deepEqual(replay.state, first.state);
  assert.deepEqual(replay.transcript, first.transcript);
  assert.equal(first.state.mode, "victory");
  assert.ok(first.state.journeyStep >= 20);
  assert.equal(first.state.run.bossDefeated, true);
  assert.equal(first.state.meta.victoryCount, 1);
  assert.ok(first.state.player.inventory.includes("prism-seed"));
  assert.ok(first.transcript.some((turn) => turn.cardId === "boss-intro"));
  assert.ok(first.transcript.some((turn) => turn.cardId.startsWith("combat:ashen-wyrm:")));
});

test("a broad deterministic seed audit has no soft locks", () => {
  const audit = auditSeeds(64);

  assert.equal(audit.stalled.length, 0);
  assert.ok(audit.victories.length > 0);
  assert.ok(audit.deaths.length > 0);
});
