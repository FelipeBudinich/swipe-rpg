import { fileURLToPath } from "node:url";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  createGame,
  dismissChoiceFeedback,
  getPlotStep,
  resolveChoice,
} from "../public/js/game/engine.js";
import { canChooseDirection } from "../public/js/game/choice-availability.js";

const MAX_DECISIONS = 96;

function selectDirection(state, card, decisionCount) {
  const deck = DEEP_SOUTH_STORY.decks.find(
    ({ id }) => id === state.currentDeckId,
  );
  if (deck?.type === "intro") return "up";
  const step = getPlotStep(state.currentDeckId);
  const cycle = ["left", "right", "up", "down"];
  const preferred =
    step < 8 ? "down" : cycle[decisionCount % cycle.length];
  return [preferred, ...cycle.filter((direction) => direction !== preferred)]
    .find((direction) => canChooseDirection(state, card, direction)) ?? null;
}

export function simulateRun(seed, maxDecisions = MAX_DECISIONS) {
  let { state, card } = createGame({ seed });
  const transcript = [];
  const visitedDeckIds = new Set([state.currentDeckId]);
  let stallReason = null;

  while (
    state.decisionCount < maxDecisions &&
    !(state.status === "lost" && !state.pendingFeedback)
  ) {
    if (state.pendingFeedback) {
      const decisionCount = state.decisionCount;
      transcript.push({
        type: "feedback",
        sourceCardId: state.pendingFeedback.sourceCardId,
        direction: state.pendingFeedback.direction,
        destinationDeckId: state.pendingFeedback.destinationDeckId,
      });
      const dismissed = dismissChoiceFeedback(state, {
        expectedFeedbackId: state.pendingFeedback.id,
      });
      if (dismissed.ignored) {
        stallReason = dismissed.reason ?? "feedback-dismissal-ignored";
        break;
      }
      state = dismissed.state;
      card = dismissed.card;
      if (state.decisionCount !== decisionCount) {
        stallReason = "feedback-counted-as-decision";
        break;
      }
      visitedDeckIds.add(state.currentDeckId);
      continue;
    }

    if (!card) {
      stallReason = "no-card";
      break;
    }
    const direction = selectDirection(state, card, state.decisionCount);
    if (!direction) {
      stallReason = "no-available-choice";
      break;
    }
    const wasIntro =
      DEEP_SOUTH_STORY.decks.find(({ id }) => id === state.currentDeckId)?.type ===
      "intro";
    const beforeDecisionCount = state.decisionCount;
    const result = resolveChoice(state, direction, {
      expectedToken: card.resolutionToken,
    });
    if (result.ignored) {
      stallReason = result.reason ?? "choice-ignored";
      break;
    }
    transcript.push({
      type: "decision",
      cardId: card.id,
      deckId: state.currentDeckId,
      direction,
      resources: result.state.resources,
    });
    state = result.state;
    card = result.card;
    visitedDeckIds.add(state.currentDeckId);

    const expectedIncrement = wasIntro ? 0 : 1;
    if (state.decisionCount !== beforeDecisionCount + expectedIncrement) {
      stallReason = "unexpected-decision-count";
      break;
    }
  }

  return {
    state,
    card,
    transcript,
    visitedDeckIds: [...visitedDeckIds],
    stallReason,
  };
}

export function auditSeeds(count = 128, maxDecisions = MAX_DECISIONS) {
  const runs = Array.from({ length: count }, (_, index) =>
    simulateRun(index + 1, maxDecisions),
  );
  return {
    runs,
    lost: runs.filter(
      ({ state }) => state.status === "lost" && !state.pendingFeedback,
    ),
    active: runs.filter(({ state }) => state.status === "playing"),
    stalled: runs.filter(({ stallReason }) => Boolean(stallReason)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = Math.max(
    1,
    Number.parseInt(process.argv[2] ?? "128", 10) || 128,
  );
  const audit = auditSeeds(count);
  const evidenceRun = simulateRun(2, MAX_DECISIONS);
  const deterministic =
    JSON.stringify(simulateRun(2, MAX_DECISIONS).transcript) ===
    JSON.stringify(evidenceRun.transcript);
  const summary = {
    seeds: count,
    lost: audit.lost.length,
    activeAtLimit: audit.active.length,
    stalled: audit.stalled.length,
    deterministic,
    seed2VisitedDecks: evidenceRun.visitedDeckIds,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (audit.stalled.length > 0 || !deterministic) process.exitCode = 1;
}
