import { weightedChoice } from "../../rng.js";
import {
  calculateStoryProgress,
  calculateStoryProgressPercent,
  canAdvanceBeat,
  getBeatBudget,
  isBeatObjectiveSatisfied,
  shouldForceBeatCompletion,
} from "./beat-progress.js";

const asList = (value) => (Array.isArray(value) ? value : []);
const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const unique = (values) => [...new Set(asList(values).filter((value) => typeof value === "string"))];

function resolveArcCollection(arcs) {
  if (!arcs) return [];
  if (Array.isArray(arcs)) return arcs;
  if (arcs instanceof Map) return [...arcs.values()];
  if (typeof arcs === "object" && typeof arcs.id === "string") return [arcs];
  if (typeof arcs === "object") return Object.values(arcs);
  return [];
}

export function getCurrentArc(state, arcs) {
  const arcId = state?.story?.arcId;
  return resolveArcCollection(arcs).find((arc) => arc?.id === arcId) ?? null;
}

export function getCurrentBeat(state, arcOrArcs) {
  const arc =
    arcOrArcs?.beats && typeof arcOrArcs?.id === "string"
      ? arcOrArcs
      : getCurrentArc(state, arcOrArcs);
  if (!arc) return null;
  const beats = asList(arc.beats);
  const currentId = state?.story?.currentBeatId;
  const byId = beats.find((beat) => beat?.id === currentId);
  if (byId) return byId;
  const index = Math.trunc(Number(state?.story?.currentBeatIndex));
  return Number.isInteger(index) && index >= 0 ? beats[index] ?? null : null;
}

export function createInitialStoryState(arc, overrides = {}) {
  const firstBeat = asList(arc?.beats)[0];
  const source = asRecord(overrides);
  const initialBeatId = source.currentBeatId ?? firstBeat?.id ?? null;
  const suppliedCounts = asRecord(source.cardsResolvedByBeat);
  return {
    arcId: arc?.id ?? source.arcId ?? null,
    status: "active",
    currentBeatId: initialBeatId,
    currentBeatIndex: 0,
    cardsResolvedInBeat: 0,
    cardsResolvedByBeat: {},
    totalWorldCardsResolved: 0,
    completedBeatIds: [],
    resolvedStoryTags: [],
    facts: {},
    selectedAnchorIdByBeat: {},
    resolvedAnchorIds: [],
    pendingInterstitialBeatId: null,
    shownInterstitialBeatIds: [],
    endingId: null,
    endingTitle: null,
    completed: false,
    ...source,
    // Clone mutable collections even when a fixture supplies them.
    completedBeatIds: unique(source.completedBeatIds),
    resolvedStoryTags: unique(source.resolvedStoryTags),
    facts: { ...asRecord(source.facts) },
    selectedAnchorIdByBeat: { ...asRecord(source.selectedAnchorIdByBeat) },
    resolvedAnchorIds: unique(source.resolvedAnchorIds),
    shownInterstitialBeatIds: unique(source.shownInterstitialBeatIds),
    cardsResolvedByBeat:
      Object.keys(suppliedCounts).length > 0
        ? { ...suppliedCounts }
        : initialBeatId
          ? { [initialBeatId]: Number(source.cardsResolvedInBeat ?? 0) }
          : {},
  };
}

function anchorDefinition(beat) {
  return beat?.anchor ?? beat?.anchorFamily ?? null;
}

function fallbackVariant(beat) {
  const anchor = anchorDefinition(beat);
  const cardId = anchor?.fallbackCardId ?? anchor?.fallback?.cardId;
  return typeof cardId === "string"
    ? {
        ...(anchor?.fallback && typeof anchor.fallback === "object" ? anchor.fallback : {}),
        cardId,
        requirements: [],
        weight: Math.max(1, Number(anchor?.fallback?.weight ?? 1) || 1),
        fallback: true,
      }
    : null;
}

function allAnchorVariants(beat) {
  const anchor = anchorDefinition(beat);
  const variants = asList(anchor?.variants).filter(
    (variant) => variant && typeof variant.cardId === "string",
  );
  const fallback = fallbackVariant(beat);
  if (fallback && !variants.some(({ cardId }) => cardId === fallback.cardId)) {
    return [...variants, fallback];
  }
  return variants;
}

function requirementsPass(requirements, state, options) {
  if (!requirements || (Array.isArray(requirements) && requirements.length === 0)) return true;
  const evaluator =
    typeof options === "function"
      ? options
      : options?.evaluateRequirements ?? options?.requirementsMet;
  if (typeof evaluator !== "function") return false;
  try {
    return Boolean(evaluator(requirements, state, options?.context ?? {}));
  } catch {
    return false;
  }
}

/**
 * Return eligible authored variants. A previously selected variant is always
 * returned even if later resource changes would make its requirements false.
 */
export function getEligibleAnchorVariants(state, arc, beat, options = {}) {
  const currentBeat = beat ?? getCurrentBeat(state, arc);
  if (!currentBeat) return [];
  const variants = allAnchorVariants(currentBeat);
  const selectedId = state?.story?.selectedAnchorIdByBeat?.[currentBeat.id];
  if (typeof selectedId === "string") {
    const selected = variants.find(({ cardId }) => cardId === selectedId);
    return selected ? [{ ...selected, persisted: true }] : [];
  }

  return variants.filter(
    (variant) => !variant.fallback && requirementsPass(variant.requirements, state, options),
  );
}

function rngStateFrom(rng, state) {
  if (typeof rng === "number" || typeof rng === "string") return rng;
  if (rng && typeof rng === "object" && Object.prototype.hasOwnProperty.call(rng, "state")) {
    return rng.state;
  }
  return state?.rngState;
}

/** Select and persist one anchor ID without mutating the supplied state. */
export function selectAnchorVariant(state, arc, beat, rng = state?.rngState, options = {}) {
  let resolvedOptions = options;
  let resolvedRng = rng;
  if (
    rng &&
    typeof rng === "object" &&
    !Object.prototype.hasOwnProperty.call(rng, "state") &&
    (rng.evaluateRequirements || rng.requirementsMet || rng.context)
  ) {
    resolvedOptions = rng;
    resolvedRng = state?.rngState;
  }
  if (typeof rng === "function") {
    resolvedOptions = { ...options, evaluateRequirements: rng };
    resolvedRng = state?.rngState;
  }

  const currentBeat = beat ?? getCurrentBeat(state, arc);
  if (!currentBeat || !anchorDefinition(currentBeat)) {
    return { cardId: null, anchorId: null, variant: null, state, source: "none" };
  }

  const selectedId = state?.story?.selectedAnchorIdByBeat?.[currentBeat.id];
  if (typeof selectedId === "string") {
    const variant = allAnchorVariants(currentBeat).find(({ cardId }) => cardId === selectedId) ?? {
      cardId: selectedId,
      persisted: true,
    };
    return {
      cardId: selectedId,
      anchorId: selectedId,
      variant: { ...variant, persisted: true },
      state,
      rngState: state?.rngState,
      source: "persisted",
    };
  }

  const eligible = getEligibleAnchorVariants(state, arc, currentBeat, resolvedOptions);
  const initialRngState = rngStateFrom(resolvedRng, state);
  const selection = weightedChoice(initialRngState, eligible, (variant) => variant.weight ?? 1);
  const variant = selection.value ?? fallbackVariant(currentBeat);
  if (!variant) {
    return {
      cardId: null,
      anchorId: null,
      variant: null,
      state,
      rngState: state?.rngState,
      source: "none",
    };
  }

  const nextRngState = selection.value ? selection.state : state?.rngState;
  const nextState = {
    ...state,
    ...(nextRngState === undefined ? {} : { rngState: nextRngState }),
    story: {
      ...state.story,
      selectedAnchorIdByBeat: {
        ...(state.story?.selectedAnchorIdByBeat ?? {}),
        [currentBeat.id]: variant.cardId,
      },
    },
  };
  return {
    cardId: variant.cardId,
    anchorId: variant.cardId,
    variant,
    state: nextState,
    rngState: nextRngState,
    source: selection.value ? "weighted" : "fallback",
  };
}

function resolutionTags(card, choice) {
  return unique([
    ...asList(card?.story?.completionTags),
    ...asList(card?.story?.storyTags),
    ...asList(choice?.completionTags),
    ...asList(choice?.storyTags),
  ]);
}

/**
 * Count only explicitly marked world cards and automatically record their
 * declarative completion tags. Combat/loot/level-up cards therefore remain
 * invisible to narrative progress without relying on category heuristics.
 */
export function recordStoryCardResolution(state, card, choice) {
  if (!state?.story || !card?.story) return state;
  const originBeatId = card.story.originBeatId ?? card.originBeatId;
  if (originBeatId && originBeatId !== state.story.currentBeatId) return state;

  const counts = card.story.countsTowardStory === true;
  const role = card.story.role;
  const tags = resolutionTags(card, choice);
  const selectedForCurrentBeat = state.story.selectedAnchorIdByBeat?.[
    state.story.currentBeatId
  ];
  const resolvedAnchor =
    role === "anchor" || role === "ending" || selectedForCurrentBeat === card.id
      ? card.id
      : null;

  return {
    ...state,
    story: {
      ...state.story,
      cardsResolvedInBeat:
        Number(state.story.cardsResolvedInBeat ?? 0) + (counts ? 1 : 0),
      cardsResolvedByBeat: {
        ...(state.story.cardsResolvedByBeat ?? {}),
        [state.story.currentBeatId]:
          Number(state.story.cardsResolvedByBeat?.[state.story.currentBeatId] ?? 0) +
          (counts ? 1 : 0),
      },
      totalWorldCardsResolved:
        Number(state.story.totalWorldCardsResolved ?? 0) + (counts ? 1 : 0),
      resolvedStoryTags: unique([...(state.story.resolvedStoryTags ?? []), ...tags]),
      resolvedAnchorIds: resolvedAnchor
        ? unique([...(state.story.resolvedAnchorIds ?? []), resolvedAnchor])
        : unique(state.story.resolvedAnchorIds),
    },
  };
}

function needsInterstitial(state, beat, arc) {
  if (!beat) return false;
  if (beat.interstitial === false) return false;
  const transitionIds = asList(arc?.transitionBeatIds);
  if (!beat.interstitial && !transitionIds.includes(beat.id)) return false;
  return !asList(state?.story?.shownInterstitialBeatIds).includes(beat.id);
}

export function enterBeat(state, beat, arc) {
  if (!state?.story || !beat) return state;
  const index = asList(arc?.beats).findIndex(({ id }) => id === beat.id);
  const pendingInterstitialBeatId = needsInterstitial(state, beat, arc) ? beat.id : null;
  return {
    ...state,
    ...(pendingInterstitialBeatId ? { mode: "storyTransition" } : {}),
    story: {
      ...state.story,
      status: "active",
      currentBeatId: beat.id,
      currentBeatIndex:
        index >= 0
          ? index
          : Math.max(0, Math.trunc(Number(state.story.currentBeatIndex) || 0)),
      cardsResolvedInBeat: 0,
      cardsResolvedByBeat: {
        ...(state.story.cardsResolvedByBeat ?? {}),
        [beat.id]: Number(state.story.cardsResolvedByBeat?.[beat.id] ?? 0),
      },
      pendingInterstitialBeatId,
    },
  };
}

export function dismissBeatInterstitial(state) {
  const pending = state?.story?.pendingInterstitialBeatId;
  if (typeof pending !== "string") return state;
  return {
    ...state,
    ...(state.mode === "storyTransition" ? { mode: "exploration" } : {}),
    story: {
      ...state.story,
      pendingInterstitialBeatId: null,
      shownInterstitialBeatIds: unique([
        ...(state.story.shownInterstitialBeatIds ?? []),
        pending,
      ]),
    },
  };
}

export function completeArc(state) {
  if (!state?.story) return state;
  return {
    ...state,
    story: {
      ...state.story,
      status: "completed",
      completed: true,
      pendingInterstitialBeatId: null,
    },
  };
}

/** Advance exactly one beat after the central hybrid invariants pass. */
export function advanceBeat(state, arc, options = {}) {
  const current = getCurrentBeat(state, arc);
  if (!current) return state;
  if (!options.force && !canAdvanceBeat(state, current, options)) return state;

  const beats = asList(arc?.beats);
  const currentIndex = beats.findIndex(({ id }) => id === current.id);
  const completedState = {
    ...state,
    story: {
      ...state.story,
      completedBeatIds: unique([...(state.story.completedBeatIds ?? []), current.id]),
    },
  };

  if (currentIndex < 0 || currentIndex >= beats.length - 1) return completeArc(completedState);
  return enterBeat(completedState, beats[currentIndex + 1], arc);
}

export function getEnding(state, arc) {
  return (
    asList(arc?.endings).find(({ id }) => id === state?.story?.endingId) ??
    null
  );
}

export {
  calculateStoryProgress,
  calculateStoryProgressPercent,
  canAdvanceBeat,
  getBeatBudget,
  isBeatObjectiveSatisfied,
  shouldForceBeatCompletion,
};
