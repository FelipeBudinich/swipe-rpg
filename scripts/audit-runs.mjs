import { fileURLToPath } from "node:url";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  createGame,
  getPlotStep,
  planDirection,
  resolveChoice,
} from "../public/js/game/engine.js";
import { formatCardEffect } from "../public/js/game/card-effects.js";

const MAX_DECISIONS = 160;

function plotRevealIsUseful(plan, decisionCount) {
  const resources = plan.effect?.resources ?? {};
  const addsCards = (plan.effect?.addCards ?? []).length > 0;
  const sanityDelta = Number(resources.sanity ?? 0);
  return (
    addsCards ||
    sanityDelta > 0 ||
    (sanityDelta === 0 && decisionCount % 3 === 0)
  );
}

function selectDirection(state, card) {
  if (state.terminalPending) return "down";

  const deck = DEEP_SOUTH_STORY.decks.find(
    ({ id }) => id === state.currentDeckId,
  );
  if (deck?.type === "intro") {
    const reveal = planDirection(state, card, "left");
    return reveal.available ? "left" : "down";
  }

  if (card.cardFace === "back") return "up";

  const left = planDirection(state, card, "left");
  if (
    left.available &&
    plotRevealIsUseful(left, state.decisionCount)
  ) {
    return state.decisionCount % 2 === 0 ? "left" : "right";
  }
  return planDirection(state, card, "up").available
    ? "up"
    : planDirection(state, card, "down").available
      ? "down"
      : null;
}

export function simulateRun(seed, maxDecisions = MAX_DECISIONS) {
  let { state, card } = createGame({ seed });
  const transcript = [];
  const visitedDeckIds = new Set([state.currentDeckId]);
  const appliedRevealCardIds = new Set();
  let stallReason = null;

  while (
    state.decisionCount < maxDecisions &&
    !(state.status === "lost" && !state.terminalPending)
  ) {
    if (!card) {
      stallReason = "no-card";
      break;
    }
    const direction = selectDirection(state, card);
    if (!direction) {
      stallReason = "no-available-direction";
      break;
    }
    const plan = planDirection(state, card, direction);
    if (!plan.available) {
      stallReason =
        card.cardFace === "back" &&
        (direction === "left" || direction === "right")
          ? "horizontal-action-on-back"
          : plan.reason ?? "unavailable-direction";
      break;
    }

    const beforeState = state;
    const beforeCard = card;
    const beforeDecisionCount = state.decisionCount;
    const wasPlot = getPlotStep(state.currentDeckId) !== null;
    const result = resolveChoice(state, direction, {
      expectedToken: card.resolutionToken,
    });
    if (result.ignored) {
      stallReason = result.reason ?? "resolution-ignored";
      break;
    }

    state = result.state;
    card = result.card;
    visitedDeckIds.add(state.currentDeckId);
    const effectLogIds = state.effectLog.map(({ id }) => id);
    if (new Set(effectLogIds).size !== effectLogIds.length) {
      stallReason = "duplicate-effect-log-entry";
      break;
    }
    if (
      state.effectLog.some(({ effect }) =>
        !formatCardEffect(effect, DEEP_SOUTH_STORY))
    ) {
      stallReason = "empty-effect-log-entry";
      break;
    }
    const expectedIncrement =
      wasPlot && (plan.mode === "flip" || plan.mode === "navigate")
        ? 1
        : 0;
    if (state.decisionCount !== beforeDecisionCount + expectedIncrement) {
      stallReason = "unexpected-decision-count";
      break;
    }

    if (plan.mode === "flip") {
      if (appliedRevealCardIds.has(beforeCard.id)) {
        stallReason = "duplicate-reveal-reward";
        break;
      }
      appliedRevealCardIds.add(beforeCard.id);
      transcript.push({
        type: "flip",
        cardId: beforeCard.id,
        deckId: beforeState.currentDeckId,
        direction,
        face: card?.cardFace ?? null,
        resources: state.resources,
        addedCardsByDeck: result.addedCardsByDeck,
      });
    } else if (plan.mode === "navigate") {
      transcript.push({
        type: "navigate",
        fromCardId: beforeCard.id,
        toCardId: card?.id ?? null,
        direction,
        resources: state.resources,
        addedCardsByDeck: result.addedCardsByDeck,
      });
    } else {
      transcript.push({
        type: "terminal",
        fromCardId: beforeCard.id,
        direction,
      });
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
      ({ state }) => state.status === "lost" && !state.terminalPending,
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
