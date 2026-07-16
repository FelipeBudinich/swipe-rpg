import {
  DEFAULT_BEAT_BUDGETS,
  EXPECTED_STORY_BUDGET_TOTALS,
  STORY_BEAT_IDS,
} from "./constants.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const asList = (value) => (Array.isArray(value) ? value : []);

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

function currentBeatFrom(state, arc) {
  const beats = asList(arc?.beats);
  const id = state?.story?.currentBeatId;
  if (typeof id === "string") {
    const byId = beats.find((beat) => beat?.id === id);
    if (byId) return byId;
  }
  const index = Math.trunc(Number(state?.story?.currentBeatIndex));
  return Number.isInteger(index) && index >= 0 ? beats[index] ?? null : null;
}

/** Normalize the canonical budget while tolerating min/max aliases at boundaries. */
export function normalizeBeatBudget(beat) {
  const source = beat?.budget ?? beat ?? {};
  const defaults = DEFAULT_BEAT_BUDGETS[beat?.id] ?? {};
  return {
    minimum: finiteNonNegative(
      source.minimum ?? source.min,
      finiteNonNegative(defaults.minimum),
    ),
    target: finiteNonNegative(source.target, finiteNonNegative(defaults.target)),
    maximum: finiteNonNegative(
      source.maximum ?? source.max,
      finiteNonNegative(defaults.maximum),
    ),
  };
}

/**
 * Resolve a budget from either a beat definition or a state plus its arc.
 * This flexible boundary keeps UI/tests small without persisting content in a save.
 */
export function getBeatBudget(stateOrBeat, arc) {
  const beat = stateOrBeat?.story ? currentBeatFrom(stateOrBeat, arc) : stateOrBeat;
  return normalizeBeatBudget(beat);
}

function storyTags(state) {
  return new Set(asList(state?.story?.resolvedStoryTags));
}

function storyFacts(state) {
  const facts = state?.story?.facts;
  return facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {};
}

function enemyWasDefeated(state, enemyId) {
  const defeated = state?.run?.enemiesDefeated ?? {};
  return Array.isArray(defeated)
    ? defeated.includes(enemyId)
    : defeated[enemyId] === true || Number(defeated[enemyId] ?? 0) > 0;
}

function builtInObjectiveSatisfied(state, objective, options) {
  if (objective === true) return true;
  if (!objective) return false;
  if (typeof objective === "string") return storyTags(state).has(objective);
  if (Array.isArray(objective)) {
    return objective.every((entry) => builtInObjectiveSatisfied(state, entry, options));
  }
  if (typeof objective !== "object") return false;

  const facts = storyFacts(state);
  const key = objective.key ?? objective.fact;
  const tag = objective.tag ?? objective.value;
  switch (objective.type) {
    case "all":
      return asList(objective.objectives ?? objective.requirements ?? objective.value).every(
        (entry) => builtInObjectiveSatisfied(state, entry, options),
      );
    case "any":
      return asList(objective.objectives ?? objective.requirements ?? objective.value).some(
        (entry) => builtInObjectiveSatisfied(state, entry, options),
      );
    case "not":
      return !builtInObjectiveSatisfied(
        state,
        objective.objective ?? objective.requirement ?? objective.value,
        options,
      );
    case "storyTag":
    case "storyTagResolved":
    case "tagResolved":
      return typeof tag === "string" && storyTags(state).has(tag);
    case "storyFact":
    case "storyFactExists":
      return typeof key === "string" && hasOwn(facts, key);
    case "storyFactAbsent":
      return typeof key === "string" && !hasOwn(facts, key);
    case "storyFactEquals":
      return typeof key === "string" && facts[key] === objective.value;
    case "storyCounterMinimum":
    case "storyFactMinimum":
      return (
        typeof key === "string" &&
        Number(facts[key] ?? 0) >= Number(objective.minimum ?? objective.min ?? objective.value ?? 0)
      );
    case "anchorResolved": {
      const anchorId = objective.cardId ?? objective.anchorId ?? state?.story?.selectedAnchorIdByBeat?.[
        objective.beatId ?? state?.story?.currentBeatId
      ];
      return typeof anchorId === "string" && asList(state?.story?.resolvedAnchorIds).includes(anchorId);
    }
    case "enemyDefeated":
    case "specificEnemyDefeated":
      return enemyWasDefeated(state, objective.enemyId ?? objective.id);
    case "endingSelected":
      return objective.endingId
        ? state?.story?.endingId === objective.endingId
        : typeof state?.story?.endingId === "string";
    case "minimumCardsResolvedInBeat":
      return (
        finiteNonNegative(state?.story?.cardsResolvedInBeat) >=
        finiteNonNegative(objective.minimum ?? objective.min ?? objective.value)
      );
    case "minimumTotalWorldCards":
      return (
        finiteNonNegative(state?.story?.totalWorldCardsResolved) >=
        finiteNonNegative(objective.minimum ?? objective.min ?? objective.value)
      );
    default:
      return false;
  }
}

/** Evaluate a beat objective without embedding card-specific behavior. */
export function isBeatObjectiveSatisfied(state, beat, options = {}) {
  const objective = beat?.completionObjective ?? beat?.objective;
  const evaluator =
    typeof options === "function"
      ? options
      : options.evaluateRequirements ?? options.requirementsMet;

  if (typeof evaluator === "function") {
    const requirements = objective?.requirements ?? objective;
    try {
      if (evaluator(requirements, state, options?.context ?? {})) return true;
    } catch {
      // A malformed injected evaluator must not accidentally complete a beat.
    }
  }
  return builtInObjectiveSatisfied(state, objective, options);
}

export function hasPendingBeatLocalStoryCard(state, beat) {
  const beatId = beat?.id ?? state?.story?.currentBeatId;
  const queues = [state?.run?.forcedCardQueue, state?.story?.forcedCardQueue];
  for (const queue of queues) {
    if (
      asList(queue).some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          (entry.originBeatId === beatId || entry.beatId === beatId) &&
          entry.beatLocal !== false,
      )
    ) {
      return true;
    }
  }

  const pendingIds = state?.story?.pendingBeatLocalCardIds;
  if (Array.isArray(pendingIds) && pendingIds.length > 0) return true;
  return false;
}

export function hasActiveRequiredStoryCombat(state, beat) {
  const beatId = beat?.id ?? state?.story?.currentBeatId;
  if (state?.encounter) {
    const origin = state.encounter.originBeatId ?? state.encounter.beatId;
    return !origin || origin === beatId;
  }
  if (state?.mode === "combat") return true;

  const story = state?.story ?? {};
  if (story.requiredEncounterBeatId === beatId || story.requiredCombatBeatId === beatId) {
    return true;
  }
  const required = story.requiredCombatByBeat?.[beatId] ?? story.requiredEncounterByBeat?.[beatId];
  if (required && !["resolved", "defeated", "complete"].includes(required)) return true;

  // Mandatory combat rewards and level-ups resolve before narrative advancement.
  if (
    ["combatReward", "loot", "levelUp"].includes(state?.mode) &&
    story.combatRewardBeatId === beatId
  ) {
    return true;
  }
  return false;
}

function selectedAnchorIsResolved(state, beat) {
  if (!beat?.anchor && !beat?.anchorFamily) return true;
  const selected = state?.story?.selectedAnchorIdByBeat?.[beat.id];
  return typeof selected === "string" && asList(state?.story?.resolvedAnchorIds).includes(selected);
}

/** The four hybrid-progression invariants are all required. */
export function canAdvanceBeat(state, beat, options = {}) {
  if (!beat || state?.story?.currentBeatId !== beat.id) return false;
  const { minimum } = normalizeBeatBudget(beat);
  if (finiteNonNegative(state?.story?.cardsResolvedInBeat) < minimum) return false;
  if (!isBeatObjectiveSatisfied(state, beat, options)) return false;
  if (!selectedAnchorIsResolved(state, beat)) return false;
  if (hasPendingBeatLocalStoryCard(state, beat)) return false;
  if (hasActiveRequiredStoryCombat(state, beat)) return false;
  return true;
}

/**
 * At maximum minus one the next world card must complete the beat; at maximum
 * the selector must never return another ambient card.
 */
export function shouldForceBeatCompletion(state, beat, options = {}) {
  const { maximum } = normalizeBeatBudget(beat);
  const resolved = finiteNonNegative(state?.story?.cardsResolvedInBeat);
  return !canAdvanceBeat(state, beat, options) && resolved >= Math.max(0, maximum - 1);
}

export function getBeatPacing(state, beat, options = {}) {
  const budget = normalizeBeatBudget(beat);
  const resolved = finiteNonNegative(state?.story?.cardsResolvedInBeat);
  const forceCompletion = shouldForceBeatCompletion(state, beat, options);
  const atMaximum = resolved >= budget.maximum;
  const atTarget = resolved >= budget.target;
  const beforeMinimum = resolved < budget.minimum;
  const targetSpan = Math.max(1, budget.target - budget.minimum);
  const approach = Math.max(0, Math.min(1, (resolved - budget.minimum) / targetSpan));

  return {
    ...budget,
    resolved,
    beforeMinimum,
    atTarget,
    atMaximum,
    forceCompletion,
    approach,
    completionWeightMultiplier: forceCompletion ? 1000 : atTarget ? 12 : 1 + approach * 4,
    ambientWeightMultiplier: atMaximum ? 0 : atTarget ? 0.45 : 1,
  };
}

/** Derived narrative progress in the closed interval [0, 1]. */
export function calculateStoryProgress(state, arc) {
  const beats = asList(arc?.beats);
  if (
    state?.story?.completed === true ||
    state?.story?.status === "completed" ||
    state?.story?.status === "complete"
  ) {
    return 1;
  }
  if (beats.length === 0) return 0;

  const completed = new Set(asList(state?.story?.completedBeatIds));
  const totalTarget = beats.reduce(
    (total, beat) => total + normalizeBeatBudget(beat).target,
    0,
  );
  const denominator = totalTarget > 0 ? totalTarget : EXPECTED_STORY_BUDGET_TOTALS.target;
  let earned = 0;

  for (const beat of beats) {
    if (completed.has(beat.id)) earned += normalizeBeatBudget(beat).target;
  }

  const current = currentBeatFrom(state, arc);
  if (current && !completed.has(current.id)) {
    const target = normalizeBeatBudget(current).target;
    earned += Math.min(target, finiteNonNegative(state?.story?.cardsResolvedInBeat));
  }

  // Even a resolved Final Image remains visually below 100 until completeArc.
  return Math.max(0, Math.min(0.999, earned / denominator));
}

export function calculateStoryProgressPercent(state, arc) {
  return calculateStoryProgress(state, arc) * 100;
}

export function getStoryBudgetTotals(arc) {
  return asList(arc?.beats).reduce(
    (totals, beat) => {
      const budget = normalizeBeatBudget(beat);
      totals.minimum += budget.minimum;
      totals.target += budget.target;
      totals.maximum += budget.maximum;
      return totals;
    },
    { minimum: 0, target: 0, maximum: 0 },
  );
}

export function isKnownStoryBeatId(beatId) {
  return STORY_BEAT_IDS.includes(beatId);
}
