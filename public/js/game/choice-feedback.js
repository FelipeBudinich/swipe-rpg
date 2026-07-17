import { RESOURCE_KEYS, normalizeResourceEffects } from "./effects.js";

export const CHOICE_FEEDBACK_VERSION = 1;

export const CHOICE_FEEDBACK_TONES = Object.freeze([
  "neutral",
  "reward",
  "damage",
  "danger",
]);

export const FEEDBACK_ART_BY_TONE = Object.freeze({
  neutral: "result-neutral",
  reward: "result-reward",
  damage: "result-damage",
  danger: "result-danger",
});

export const CHOICE_FEEDBACK_CHANGE_FIELDS = RESOURCE_KEYS;

export const CHOICE_FEEDBACK_CHANGE_LABELS = Object.freeze({
  eldritchLore: "Eldritch Lore",
  crew: "Crew",
  sanity: "Sanity",
});

const TONE_SET = new Set(CHOICE_FEEDBACK_TONES);
const DIRECTION_SET = new Set(["up", "down", "left", "right"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeChoiceFeedbackChanges(changes) {
  return { ...normalizeResourceEffects(changes) };
}

export function normalizeChoiceFeedbackTone(tone) {
  return TONE_SET.has(tone) ? tone : null;
}

export function classifyChoiceFeedbackTone(changes, explicitTone) {
  const authored = normalizeChoiceFeedbackTone(explicitTone);
  if (authored) return authored;

  const normalized = normalizeChoiceFeedbackChanges(changes);
  if (Number(normalized.sanity) < 0) return "damage";
  if (Number(normalized.crew) < 0 || Number(normalized.eldritchLore) < 0) {
    return "danger";
  }
  if (Object.values(normalized).some((delta) => delta > 0)) return "reward";
  return "neutral";
}

export function choiceFeedbackId(sourceCardToken) {
  return nonemptyString(sourceCardToken) ? `choice-feedback:${sourceCardToken}` : null;
}

export function createPendingFeedback({
  sourceCardId,
  sourceCardToken,
  sourceDeckId,
  direction,
  destinationDeckId,
  resultText,
  tone,
  changes,
} = {}) {
  const id = choiceFeedbackId(sourceCardToken);
  if (
    !id ||
    !nonemptyString(sourceCardId) ||
    !nonemptyString(sourceDeckId) ||
    !DIRECTION_SET.has(direction) ||
    !nonemptyString(destinationDeckId) ||
    !nonemptyString(resultText)
  ) {
    return null;
  }

  const normalizedChanges = normalizeChoiceFeedbackChanges(changes);
  return {
    version: CHOICE_FEEDBACK_VERSION,
    id,
    sourceCardId,
    sourceCardToken,
    sourceDeckId,
    direction,
    resultText: resultText.trim(),
    tone: classifyChoiceFeedbackTone(normalizedChanges, tone),
    changes: normalizedChanges,
    destinationDeckId,
  };
}

export const createPendingChoiceFeedback = createPendingFeedback;

export function normalizePendingFeedback(value, state) {
  if (!isPlainObject(value)) return null;
  if (
    value.version !== CHOICE_FEEDBACK_VERSION ||
    value.id !== choiceFeedbackId(value.sourceCardToken) ||
    !nonemptyString(value.sourceCardId) ||
    !nonemptyString(value.sourceDeckId) ||
    !DIRECTION_SET.has(value.direction) ||
    !nonemptyString(value.destinationDeckId) ||
    value.destinationDeckId !== state?.currentDeckId ||
    state?.currentCardId !== null ||
    !nonemptyString(value.resultText) ||
    !normalizeChoiceFeedbackTone(value.tone) ||
    !isPlainObject(value.changes)
  ) {
    return null;
  }

  const entries = Object.entries(value.changes);
  if (
    entries.some(
      ([key, delta]) =>
        !RESOURCE_KEYS.includes(key) ||
        typeof delta !== "number" ||
        !Number.isFinite(delta) ||
        delta === 0,
    )
  ) {
    return null;
  }

  return {
    version: CHOICE_FEEDBACK_VERSION,
    id: value.id,
    sourceCardId: value.sourceCardId,
    sourceCardToken: value.sourceCardToken,
    sourceDeckId: value.sourceDeckId,
    direction: value.direction,
    resultText: value.resultText,
    tone: value.tone,
    changes: normalizeChoiceFeedbackChanges(value.changes),
    destinationDeckId: value.destinationDeckId,
  };
}

export const normalizePendingChoiceFeedback = normalizePendingFeedback;

export function formatFeedbackChange(key, delta) {
  const label = CHOICE_FEEDBACK_CHANGE_LABELS[key] ?? key;
  const signed = delta > 0 ? `+${delta}` : String(delta);
  return `${signed} ${label}`;
}
