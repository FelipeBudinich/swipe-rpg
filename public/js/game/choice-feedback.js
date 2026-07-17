import { resourceChanges } from "./effects.js";

export const CHOICE_FEEDBACK_VERSION = 1;

export const CHOICE_FEEDBACK_TONES = Object.freeze([
  "neutral",
  "reward",
  "recovery",
  "damage",
  "danger",
]);

export const FEEDBACK_ART_BY_TONE = Object.freeze({
  neutral: "result-neutral",
  reward: "result-reward",
  recovery: "result-recovery",
  damage: "result-damage",
  danger: "result-danger",
});

export const CHOICE_FEEDBACK_CHANGE_FIELDS = Object.freeze([
  "level",
  "xp",
  "hp",
  "mp",
  "gold",
  "attack",
  "defense",
  "maxHp",
  "maxMp",
  "inventory",
]);

export const CHOICE_FEEDBACK_CHANGE_LABELS = Object.freeze({
  level: "Level",
  xp: "XP",
  hp: "HP",
  mp: "MP",
  gold: "Gold",
  attack: "Attack",
  defense: "Defense",
  maxHp: "Max HP",
  maxMp: "Max MP",
  inventory: "Items",
});

const CHANGE_FIELD_SET = new Set(CHOICE_FEEDBACK_CHANGE_FIELDS);
const TONE_SET = new Set(CHOICE_FEEDBACK_TONES);
const SUPPRESSED_SUCCESSOR_MODES = new Set([
  "combatReward",
  "levelUp",
  "loot",
  "storyTransition",
  "gameOver",
  "victory",
]);
const SUPPRESSED_SUCCESSOR_CATEGORIES = new Set([
  "combatReward",
  "levelUp",
  "loot",
  "gameOver",
  "victory",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function addCardId(ids, value) {
  if (typeof value === "string" && value) ids.add(value);
}

function terminalStoryPhase(arc) {
  const phases = asList(arc?.storyPhases ?? arc?.beats);
  const configuredId = arc?.terminalPhaseId ?? arc?.endingPhaseId ?? arc?.finalPhaseId;
  return (
    phases.find((phase) => phase?.id === configuredId) ??
    phases.find((phase) =>
      phase?.terminal === true ||
      phase?.isEnding === true ||
      phase?.role === "ending"
    ) ??
    phases.at(-1) ??
    null
  );
}

function terminalStoryCardIds(arc) {
  const ids = new Set();
  for (const ending of asList(arc?.endings)) {
    addCardId(ids, ending?.finalImageCardId);
    for (const id of asList(ending?.finalImageCardIds)) addCardId(ids, id);
    addCardId(ids, ending?.cardId);
    for (const id of asList(ending?.cardIds)) addCardId(ids, id);
  }

  const finalPhase = terminalStoryPhase(arc);
  for (const id of asList(finalPhase?.completionCardIds)) addCardId(ids, id);
  addCardId(ids, finalPhase?.anchor?.fallbackCardId);
  for (const variant of asList(finalPhase?.anchor?.variants)) addCardId(ids, variant?.cardId);
  for (const [id, value] of Object.entries(finalPhase?.endingVariants ?? {})) {
    addCardId(ids, id);
    addCardId(ids, value);
    addCardId(ids, value?.cardId);
  }
  return ids;
}

/** Identify a terminal story card from phase position, role, or explicit metadata. */
export function isTerminalStoryCard(card, state, arc) {
  const finalPhase = terminalStoryPhase(arc);
  if (finalPhase?.id && state?.story?.currentBeatId === finalPhase.id) return true;
  if (card?.story?.role === "ending") return true;
  return isNonemptyString(card?.id) && terminalStoryCardIds(arc).has(card.id);
}

export const isFinalImageCard = isTerminalStoryCard;

/** Copy only supported, finite, nonzero resource deltas. */
export function normalizeChoiceFeedbackChanges(changes) {
  if (!isPlainObject(changes)) return {};
  return Object.fromEntries(
    CHOICE_FEEDBACK_CHANGE_FIELDS.flatMap((field) => {
      const value = changes[field];
      return typeof value === "number" && Number.isFinite(value) && value !== 0
        ? [[field, value]]
        : [];
    }),
  );
}

/** Combine the existing resource diff with the feedback-only inventory count. */
export function deriveChoiceFeedbackChanges(beforeState, afterState, itemDefinitions) {
  const inventory =
    (Array.isArray(afterState?.player?.inventory) ? afterState.player.inventory.length : 0) -
    (Array.isArray(beforeState?.player?.inventory) ? beforeState.player.inventory.length : 0);
  return normalizeChoiceFeedbackChanges({
    ...resourceChanges(beforeState, afterState, itemDefinitions),
    inventory,
  });
}

export function normalizeChoiceFeedbackTone(tone) {
  return TONE_SET.has(tone) ? tone : null;
}

/** Classify tone deterministically, honoring a recognized explicit tone first. */
export function classifyChoiceFeedbackTone(changes, explicitTone) {
  const authored = normalizeChoiceFeedbackTone(explicitTone);
  if (authored) return authored;

  const normalized = normalizeChoiceFeedbackChanges(changes);
  if (Number(normalized.hp) < 0) return "damage";
  if (Object.values(normalized).some((delta) => delta < 0)) return "danger";
  if (Number(normalized.hp) > 0 || Number(normalized.mp) > 0) return "recovery";
  if (
    ["xp", "gold", "level", "attack", "defense", "maxHp", "maxMp", "inventory"].some(
      (field) => Number(normalized[field]) > 0,
    )
  ) {
    return "reward";
  }
  return "neutral";
}

function isPreparedSuccessor(nextState, nextCard) {
  return Boolean(
    isNonemptyString(nextState?.currentCardId) &&
      isNonemptyString(nextState?.currentCardToken) &&
      isNonemptyString(nextCard?.id) &&
      nextCard.id === nextState.currentCardId &&
      nextCard.left &&
      typeof nextCard.left === "object" &&
      nextCard.right &&
      typeof nextCard.right === "object",
  );
}

export function feedbackSuccessorIsSuppressed(state, card, arc) {
  return Boolean(
    SUPPRESSED_SUCCESSOR_MODES.has(state?.mode) ||
      SUPPRESSED_SUCCESSOR_CATEGORIES.has(card?.category) ||
      isTerminalStoryCard(card, state, arc) ||
      state?.story?.completed === true ||
      state?.story?.status === "completed",
  );
}

/** Decide whether a resolved world choice merits the persistent feedback surface. */
export function shouldCreateChoiceFeedback({
  beforeState,
  resolvedMode,
  resolvedCard,
  resultText,
  nextState,
  nextCard,
  arc,
} = {}) {
  return Boolean(
    resolvedMode === "exploration" &&
      resolvedCard?.story?.countsTowardStory === true &&
      typeof resultText === "string" &&
      resultText.trim() &&
      !isTerminalStoryCard(resolvedCard, beforeState, arc) &&
      isPreparedSuccessor(nextState, nextCard) &&
      !feedbackSuccessorIsSuppressed(nextState, nextCard, arc),
  );
}

export function choiceFeedbackId(sourceResolutionToken) {
  return isNonemptyString(sourceResolutionToken)
    ? `choice-feedback:${sourceResolutionToken}`
    : null;
}

/**
 * Create the persisted presentation payload without mutating state or using RNG.
 * Returns null when required successor identity is unavailable.
 */
export function createPendingChoiceFeedback({
  sourceCard,
  sourceCardId = sourceCard?.id,
  sourceToken,
  sourceResolutionToken = sourceToken,
  resultText,
  tone,
  changes,
  nextState,
} = {}) {
  const id = choiceFeedbackId(sourceResolutionToken);
  if (
    !id ||
    typeof sourceCardId !== "string" ||
    typeof resultText !== "string" ||
    !resultText.trim() ||
    !isNonemptyString(nextState?.currentCardId) ||
    !isNonemptyString(nextState?.currentCardToken)
  ) {
    return null;
  }

  const normalizedChanges = normalizeChoiceFeedbackChanges(changes);
  return {
    version: CHOICE_FEEDBACK_VERSION,
    id,
    sourceCardId,
    sourceResolutionToken,
    resultText,
    tone: classifyChoiceFeedbackTone(normalizedChanges, tone),
    changes: normalizedChanges,
    nextCardId: nextState.currentCardId,
    nextCardToken: nextState.currentCardToken,
  };
}

function hasValidPersistedChanges(value) {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([field, delta]) =>
        CHANGE_FIELD_SET.has(field) && typeof delta === "number" && Number.isFinite(delta),
    )
  );
}

/**
 * Normalize untrusted optional feedback against its already-persisted successor.
 *
 * The second argument accepts `{ state, card, arc }`; passing the state object
 * directly is also supported for state-normalization call sites.
 */
export function normalizePendingChoiceFeedback(value, context = {}) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;

  const state = context?.state ?? context;
  const card = context?.card ?? context?.currentCard ?? state?.currentCardData ?? null;
  const arc = context?.arc ?? null;
  if (feedbackSuccessorIsSuppressed(state, card, arc)) return null;

  if (
    value.version !== CHOICE_FEEDBACK_VERSION ||
    !isNonemptyString(value.id) ||
    typeof value.sourceCardId !== "string" ||
    typeof value.sourceResolutionToken !== "string" ||
    typeof value.resultText !== "string" ||
    !normalizeChoiceFeedbackTone(value.tone) ||
    !hasValidPersistedChanges(value.changes) ||
    typeof value.nextCardId !== "string" ||
    typeof value.nextCardToken !== "string" ||
    value.id !== choiceFeedbackId(value.sourceResolutionToken) ||
    value.nextCardId !== state?.currentCardId ||
    value.nextCardToken !== state?.currentCardToken
  ) {
    return null;
  }

  return {
    version: CHOICE_FEEDBACK_VERSION,
    id: value.id,
    sourceCardId: value.sourceCardId,
    sourceResolutionToken: value.sourceResolutionToken,
    resultText: value.resultText,
    tone: value.tone,
    changes: normalizeChoiceFeedbackChanges(value.changes),
    nextCardId: value.nextCardId,
    nextCardToken: value.nextCardToken,
  };
}
