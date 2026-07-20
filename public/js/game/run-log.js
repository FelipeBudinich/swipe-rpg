import {
  formatCardEffect,
  normalizeCardEffect,
} from "./card-effects.js";

export const EFFECT_LOG_KINDS = Object.freeze([
  "reveal",
  "entry",
]);
export const EFFECT_LOG_MAX_ENTRIES = 2048;

const EFFECT_LOG_DIRECTIONS = new Set([
  "up",
  "down",
  "left",
  "right",
]);
const EFFECT_LOG_KIND_SET = new Set(EFFECT_LOG_KINDS);

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalCardIds(story) {
  return new Set(
    (Array.isArray(story?.decks) ? story.decks : []).flatMap((deck) =>
      (Array.isArray(deck?.cards) ? deck.cards : [])
        .map((card) => typeof card === "string" ? card : card?.id)
        .filter(nonemptyString),
    ),
  );
}

function normalizeEntry(value, story, allowedCardIds = canonicalCardIds(story)) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (
    !nonemptyString(value.id) ||
    !EFFECT_LOG_KIND_SET.has(value.kind) ||
    !EFFECT_LOG_DIRECTIONS.has(value.direction) ||
    !nonemptyString(value.cardId) ||
    !allowedCardIds.has(value.cardId)
  ) {
    return null;
  }

  const effect = normalizeCardEffect(value.effect, story);
  if (!effect || !formatCardEffect(effect, story)) return null;

  return {
    id: value.id.trim(),
    kind: value.kind,
    cardId: value.cardId,
    direction: value.direction,
    effect,
  };
}

export function effectLogEntryId(kind, sourceToken) {
  return EFFECT_LOG_KIND_SET.has(kind) && nonemptyString(sourceToken)
    ? `effect:${kind}:${sourceToken}`
    : "";
}

export function normalizeEffectLog(value, story) {
  if (!Array.isArray(value)) return [];
  const allowedCardIds = canonicalCardIds(story);
  const seenIds = new Set();
  const entries = [];

  for (const candidate of value) {
    const entry = normalizeEntry(candidate, story, allowedCardIds);
    if (!entry || seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    entries.push(entry);
  }

  return entries.slice(-EFFECT_LOG_MAX_ENTRIES);
}

export function appendEffectLog(state, entry, story) {
  const normalizedEntry = normalizeEntry(entry, story);
  if (!normalizedEntry) return { state, entry: null };

  const current = normalizeEffectLog(state?.effectLog, story);
  if (current.some(({ id }) => id === normalizedEntry.id)) {
    return { state, entry: null };
  }

  const effectLog = [...current, normalizedEntry].slice(
    -EFFECT_LOG_MAX_ENTRIES,
  );
  return {
    state: { ...state, effectLog },
    entry: normalizedEntry,
  };
}
