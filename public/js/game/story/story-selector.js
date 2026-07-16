import { weightedChoice } from "../../rng.js";
import { getBeatPacing } from "./beat-progress.js";

const asList = (value) => (Array.isArray(value) ? value : []);

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

function choiceIsAvailable(card, state, options) {
  if (typeof options?.cardHasAvailableChoice !== "function") return true;
  try {
    return Boolean(options.cardHasAvailableChoice(card, state, options.context ?? {}));
  } catch {
    return false;
  }
}

function effectStartsEncounter(effect) {
  return ["startEncounter", "startStoryEncounter"].includes(effect?.type);
}

export function isStoryEncounterCard(card) {
  if (!card) return false;
  if (card.category === "encounter" || asList(card.tags).includes("encounter")) return true;
  return [card.left, card.right].some((choice) =>
    asList(choice?.effects).some(effectStartsEncounter),
  );
}

export function getStoryEncounterKind(card) {
  const explicit = card?.story?.encounterType ?? card?.encounterType;
  if (["random", "scripted", "boss"].includes(explicit)) return explicit;
  if (card?.story?.boss === true || asList(card?.tags).includes("boss")) return "boss";
  if (card?.story?.scriptedEncounter === true || card?.story?.role === "anchor") {
    return "scripted";
  }
  return "random";
}

function randomEncounterCount(state, beatId) {
  const story = state?.story ?? {};
  return Number(
    state?.run?.randomEncountersByBeat?.[beatId] ??
    story.randomEncounterCountByBeat?.[beatId] ??
      story.randomEncountersByBeat?.[beatId] ??
      story.encounterCountByBeat?.[beatId] ??
      0,
  );
}

function enemyIdFromCard(card) {
  if (typeof card?.story?.enemyId === "string") return card.story.enemyId;
  if (typeof card?.enemyId === "string") return card.enemyId;
  for (const choice of [card?.left, card?.right]) {
    const effect = asList(choice?.effects).find(effectStartsEncounter);
    if (typeof effect?.enemyId === "string") return effect.enemyId;
  }
  return null;
}

function findEnemy(enemyId, options) {
  const enemies = options?.enemies ?? options?.enemyById;
  if (enemies instanceof Map) return enemies.get(enemyId) ?? null;
  if (Array.isArray(enemies)) return enemies.find(({ id }) => id === enemyId) ?? null;
  if (enemies && typeof enemies === "object") return enemies[enemyId] ?? null;
  return null;
}

export function isEnemyEligibleForEncounterPolicy(enemy, beat) {
  if (!enemy) return true;
  const policy = beat?.encounterPolicy ?? {};
  const allowedTags = asList(policy.allowedEnemyTags);
  if (allowedTags.length === 0) return true;
  const enemyTags = new Set([
    ...asList(enemy.tags),
    ...asList(enemy.story?.enemyTags),
  ]);
  return allowedTags.some((tag) => enemyTags.has(tag));
}

export function isEncounterAllowedByPolicy(state, card, beat, options = {}) {
  if (!isStoryEncounterCard(card)) return true;
  const policy = beat?.encounterPolicy ?? { mode: "random" };
  const mode = policy.mode ?? "random";
  const kind = getStoryEncounterKind(card);
  if (mode === "none") return false;
  if (mode === "scripted-only" && kind !== "scripted") return false;
  if (mode === "boss-only" && kind !== "boss") return false;

  const resolved = Number(state?.story?.cardsResolvedInBeat ?? 0);
  const minimumBefore = Math.max(0, Number(policy.minimumCardsBeforeEncounter ?? 0));
  if (kind === "random" && resolved < minimumBefore) return false;

  const maximumRandom = policy.maximumRandomEncounters;
  if (
    kind === "random" &&
    maximumRandom !== null &&
    maximumRandom !== undefined &&
    randomEncounterCount(state, beat?.id) >= Math.max(0, Number(maximumRandom))
  ) {
    return false;
  }

  const enemyId = enemyIdFromCard(card);
  const enemy = enemyId ? findEnemy(enemyId, options) : null;
  return isEnemyEligibleForEncounterPolicy(enemy, beat);
}

export function encounterPolicyWeightMultiplier(state, card, beat) {
  if (!isStoryEncounterCard(card)) return 1;
  const kind = getStoryEncounterKind(card);
  if (kind !== "random") return 1;
  const multiplier = Number(beat?.encounterPolicy?.weightMultiplier ?? 1);
  return Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 0;
}

export function isStoryCompletionCandidate(card, beat) {
  const story = card?.story;
  const declaredForBeat = [
    ...asList(beat?.completionCardIds),
    ...(typeof beat?.completionCardId === "string" ? [beat.completionCardId] : []),
  ];
  const explicitForBeat =
    asList(story?.completionBeatIds ?? story?.completionForBeatIds).includes(beat?.id) ||
    Object.prototype.hasOwnProperty.call(story?.completionTagsByBeat ?? {}, beat?.id);
  if (beat && declaredForBeat.length > 0) {
    return declaredForBeat.includes(card?.id) || explicitForBeat;
  }
  return Boolean(
    story &&
      (story.role === "completion" ||
        story.completionCandidate === true ||
        asList(story.completionTags).length > 0),
  );
}

function beatWeightFor(card, beat) {
  const raw = card?.story?.beatWeights?.[beat?.id];
  if (raw !== undefined) return Number(raw);
  return asList(card?.story?.beatIds).includes(beat?.id) ? 1 : 0;
}

function cardBelongsToArc(card, arcId) {
  const arcIds = card?.story?.arcIds;
  return !Array.isArray(arcIds) || arcIds.length === 0 || arcIds.includes(arcId);
}

function isOffCooldown(card, state) {
  const seen = state?.run?.lastSeenTurnByCardId?.[card.id];
  if (!Number.isFinite(Number(seen))) return true;
  const turn = Number(state?.story?.totalWorldCardsResolved ?? state?.decisionCount ?? 0);
  return turn - Number(seen) > Math.max(0, Number(card.cooldown ?? 0));
}

function passesStoryFactModifiers(state, modifier, options) {
  return requirementsPass(
    modifier.requirements ?? modifier.requirement,
    state,
    options,
  );
}

export function calculateStoryCardWeight(state, card, beat, options = {}) {
  let weight = Math.max(0, Number(card?.baseWeight ?? 0));
  const beatWeight = beatWeightFor(card, beat);
  if (!Number.isFinite(beatWeight) || beatWeight <= 0) return 0;
  weight *= beatWeight;
  weight *= encounterPolicyWeightMultiplier(state, card, beat);

  for (const modifier of asList(card?.story?.factWeightModifiers)) {
    if (!passesStoryFactModifiers(state, modifier, options)) continue;
    const multiplier = Number(modifier.multiplier ?? modifier.weightMultiplier ?? 1);
    if (Number.isFinite(multiplier) && multiplier >= 0) weight *= multiplier;
  }

  const pacing = getBeatPacing(state, beat, options);
  if (isStoryCompletionCandidate(card, beat)) weight *= pacing.completionWeightMultiplier;
  else weight *= pacing.ambientWeightMultiplier;

  if (card?.story?.role === "entry") {
    weight *= pacing.resolved === 0 ? 25 : 0.1;
  }
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/** Build the ordinary story pool; anchors are surfaced only by arc-engine. */
export function getEligibleStoryCards(state, cards, beat, options = {}) {
  if (!beat || !state?.story) return [];
  const recent = new Set(asList(state?.run?.recentCardIds).slice(-4));
  const pacing = getBeatPacing(state, beat, options);
  const arcId = state.story.arcId;

  let eligible = asList(cards).filter((card) => {
    const story = card?.story;
    if (!story || typeof card.id !== "string") return false;
    if (typeof story.countsTowardStory !== "boolean") return false;
    if (["anchor", "ending"].includes(story.role)) return false;
    if (!cardBelongsToArc(card, arcId)) return false;
    if (beatWeightFor(card, beat) <= 0) return false;
    if (!requirementsPass(card.requirements, state, options)) return false;
    if (!choiceIsAvailable(card, state, options)) return false;
    if (card.oncePerRun && asList(state.run?.resolvedOnceCards).includes(card.id)) return false;
    if (!isOffCooldown(card, state)) return false;
    if (recent.has(card.id)) return false;
    if (!isEncounterAllowedByPolicy(state, card, beat, options)) return false;

    const completion = isStoryCompletionCandidate(card, beat);
    const requiredFirst =
      story.requiredAsFirstCard === true ||
      story.requiredFirst === true ||
      (story.role === "entry" && story.required === true);
    // A completion card may fill the final minimum slot: eligibility is
    // evaluated before resolution, while the invariant is evaluated after it.
    if (
      completion &&
      pacing.resolved < Math.max(0, pacing.minimum - 1) &&
      !requiredFirst
    ) {
      return false;
    }
    if (story.role === "entry" && pacing.resolved > 0 && story.repeatableEntry !== true) return false;
    if ((pacing.forceCompletion || pacing.atMaximum) && !completion) return false;
    return calculateStoryCardWeight(state, card, beat, options) > 0;
  });

  // If the data marks one or more first cards as required, optional cards must
  // not race them in the weighted pool.
  if (pacing.resolved === 0) {
    const requiredEntries = eligible.filter(
      (card) =>
        card.story?.requiredAsFirstCard === true ||
        card.story?.requiredFirst === true ||
        (card.story?.role === "entry" && card.story?.required === true),
    );
    if (requiredEntries.length > 0) eligible = requiredEntries;
  }
  return eligible;
}

function recordSelection(state, card, rngState) {
  const turn = Number(state?.story?.totalWorldCardsResolved ?? state?.decisionCount ?? 0);
  return {
    ...state,
    rngState,
    run: {
      ...state.run,
      recentCardIds: [...asList(state.run?.recentCardIds), card.id].slice(-4),
      lastSeenTurnByCardId: {
        ...(state.run?.lastSeenTurnByCardId ?? {}),
        [card.id]: turn,
      },
    },
  };
}

export function selectStoryCard(state, cards, beat, options = {}) {
  const eligible = getEligibleStoryCards(state, cards, beat, options);
  if (eligible.length === 0) {
    const fallback = options.fallbackCard ?? null;
    return {
      card: fallback,
      state: fallback ? recordSelection(state, fallback, state.rngState) : state,
      candidates: [],
      source: fallback ? "fallback" : "none",
    };
  }

  const weighted = weightedChoice(state.rngState, eligible, (card) =>
    calculateStoryCardWeight(state, card, beat, options),
  );
  const card = weighted.value;
  if (!card) return { card: null, state, candidates: eligible, source: "none" };
  return {
    card,
    state: recordSelection(state, card, weighted.state),
    candidates: eligible,
    source: "weighted",
  };
}
