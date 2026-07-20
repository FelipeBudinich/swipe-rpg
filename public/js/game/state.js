import {
  DEEP_SOUTH_DECKS,
  DEEP_SOUTH_STORY_ID,
} from "../data/deep-south.js";
import { normalizeSeed } from "../rng.js";
import { normalizePendingFeedback } from "./choice-feedback.js";
import {
  createDrawStateByDeck,
  normalizeDrawStateByDeck,
} from "./deck-draw.js";
import { normalizeResources } from "./effects.js";
import { getPlotDestinationDeckId } from "./plot-navigation.js";

export const SAVE_VERSION = 4;
export const STORY_ID = DEEP_SOUTH_STORY_ID;
export const INITIAL_RESOURCES = Object.freeze({
  eldritchLore: 0,
  crew: 0,
  sanity: 3,
});
export const INTRO_CARD_FACES = Object.freeze(["front", "reverse"]);
export const INITIAL_DISCOVERIES = Object.freeze({
  fatherDiaryReverse: false,
});
export const RUN_STATUSES = Object.freeze(["playing", "lost"]);

const COMPATIBLE_PREVIOUS_SAVE_VERSION = 3;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function cloneSerializable(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function configuredDecks(options = {}) {
  const supplied = options?.decks ?? options?.story?.decks;
  return Array.isArray(supplied) && supplied.length > 0 ? supplied : DEEP_SOUTH_DECKS;
}

function introDeck(decks) {
  return decks.find((deck) => deck?.type === "intro") ?? decks[0] ?? null;
}

function validDeckIds(decks) {
  return new Set(
    decks
      .map((deck) => deck?.id)
      .filter(nonemptyString),
  );
}

function cardIdsForDeck(deck) {
  return new Set(
    (Array.isArray(deck?.cards) ? deck.cards : [])
      .map((card) => typeof card === "string" ? card : card?.id)
      .filter(nonemptyString),
  );
}

function introIndex(value, deck) {
  const maximum = Math.max(0, (Array.isArray(deck?.cards) ? deck.cards.length : 0) - 1);
  return Math.min(maximum, nonNegativeInteger(value));
}

function normalizedDiscoveries(value) {
  const source = asRecord(value);
  return {
    fatherDiaryReverse: source.fatherDiaryReverse === true,
  };
}

function normalizedPersistedResources(value) {
  const source = asRecord(value);
  const repaired = Object.fromEntries(
    Object.entries(INITIAL_RESOURCES).map(([key, fallback]) => {
      const raw = source[key];
      const number =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim().length > 0
            ? Number(raw)
            : Number.NaN;
      return [key, Number.isFinite(number) ? number : fallback];
    }),
  );
  return normalizeResources(repaired);
}

function hasIncompatibleLegacyState(raw) {
  const player = asRecord(raw?.player);
  const resources = asRecord(raw?.resources);
  return Boolean(
    Object.prototype.hasOwnProperty.call(raw, "version") ||
    Object.prototype.hasOwnProperty.call(raw, "story") ||
    Object.prototype.hasOwnProperty.call(raw, "player") ||
    Object.prototype.hasOwnProperty.call(raw, "run") ||
    Object.prototype.hasOwnProperty.call(raw, "mode") ||
    Object.prototype.hasOwnProperty.call(raw, "encounter") ||
    Object.prototype.hasOwnProperty.call(raw, "meta") ||
    Object.prototype.hasOwnProperty.call(raw, "journeyStep") ||
    Object.prototype.hasOwnProperty.call(raw, "arcId") ||
    Object.prototype.hasOwnProperty.call(raw, "currentBeatId") ||
    Object.prototype.hasOwnProperty.call(raw, "currentBeatIndex") ||
    Object.prototype.hasOwnProperty.call(raw, "currentCardData") ||
    Object.prototype.hasOwnProperty.call(raw, "currentCardSource") ||
    Object.prototype.hasOwnProperty.call(raw, "pendingChoiceFeedback") ||
    Object.prototype.hasOwnProperty.call(raw, "gold") ||
    Object.prototype.hasOwnProperty.call(raw, "inventory") ||
    Object.prototype.hasOwnProperty.call(raw, "xp") ||
    Object.prototype.hasOwnProperty.call(raw, "hp") ||
    Object.prototype.hasOwnProperty.call(raw, "mp") ||
    Object.prototype.hasOwnProperty.call(raw, "level") ||
    Object.prototype.hasOwnProperty.call(player, "xp") ||
    Object.prototype.hasOwnProperty.call(player, "hp") ||
    Object.prototype.hasOwnProperty.call(player, "mp") ||
    Object.prototype.hasOwnProperty.call(player, "level") ||
    Object.prototype.hasOwnProperty.call(resources, "xp") ||
    Object.prototype.hasOwnProperty.call(resources, "hp") ||
    Object.prototype.hasOwnProperty.call(resources, "mp") ||
    Object.prototype.hasOwnProperty.call(resources, "level")
  );
}

function normalizedFreshSeed(raw, options) {
  return normalizeSeed(options?.seed ?? raw?.runSeed ?? Date.now());
}

/** Create a fresh, serializable Deep South run. */
export function createInitialState(options = {}) {
  const normalizedOptions =
    options && typeof options === "object" ? options : { seed: options };
  const decks = configuredDecks(normalizedOptions);
  const firstDeck = introDeck(decks);
  const seed = normalizeSeed(normalizedOptions.seed ?? Date.now());

  return {
    saveVersion: SAVE_VERSION,
    storyId: STORY_ID,
    status: "playing",
    currentDeckId: firstDeck?.id ?? "it-begins-here",
    introCardIndex: 0,
    introSkipPending: false,
    introCardFace: "front",
    discoveries: { ...INITIAL_DISCOVERIES },
    currentCardId: null,
    currentCardToken: null,
    lastResolvedToken: null,
    decisionCount: 0,
    runSeed: seed,
    rngState: seed,
    drawStateByDeck: createDrawStateByDeck(decks),
    resources: { ...INITIAL_RESOURCES },
    pendingFeedback: null,
  };
}

/**
 * Defensively normalize persisted Deep South state.
 *
 * Version 3 Deep South saves have the same plot/deck contract and migrate
 * losslessly with the new Intro fields defaulted. Earlier story schemas and
 * mixed old/new payloads remain intentionally incompatible.
 */
export function normalizeState(raw, options = {}) {
  const source = asRecord(raw);
  const normalizedOptions = asRecord(options);
  const decks = configuredDecks(normalizedOptions);
  const compatibleSaveVersion =
    source.saveVersion === SAVE_VERSION ||
    source.saveVersion === COMPATIBLE_PREVIOUS_SAVE_VERSION;
  if (
    !compatibleSaveVersion ||
    source.storyId !== STORY_ID ||
    hasIncompatibleLegacyState(source)
  ) {
    return createInitialState({
      seed: normalizedFreshSeed(source, normalizedOptions),
      decks,
    });
  }

  const fallback = createInitialState({
    seed: normalizedFreshSeed(source, normalizedOptions),
    decks,
  });
  const allowedDeckIds = validDeckIds(decks);
  const firstDeck = introDeck(decks);
  const currentDeckId = allowedDeckIds.has(source.currentDeckId)
    ? source.currentDeckId
    : fallback.currentDeckId;
  const currentDeck = decks.find((deck) => deck?.id === currentDeckId) ?? firstDeck;
  const resources = normalizedPersistedResources(source.resources);
  const status = resources.sanity <= 0 ? "lost" : "playing";
  const allowedCurrentCardIds = cardIdsForDeck(currentDeck);
  const currentCardId =
    currentDeck?.type === "plot" &&
    status === "playing" &&
    allowedCurrentCardIds.has(source.currentCardId)
      ? source.currentCardId
      : null;
  const currentCardToken =
    currentCardId && nonemptyString(source.currentCardToken)
      ? source.currentCardToken
      : null;
  const isCurrentSave = source.saveVersion === SAVE_VERSION;
  const discoveries = isCurrentSave
    ? normalizedDiscoveries(source.discoveries)
    : { ...fallback.discoveries };
  const introCardFace =
    discoveries.fatherDiaryReverse === true
      ? "reverse"
      : "front";

  const normalized = {
    ...fallback,
    status,
    currentDeckId,
    introCardIndex: introIndex(source.introCardIndex, firstDeck),
    introSkipPending:
      currentDeck?.type === "intro" &&
      status === "playing" &&
      source.introSkipPending === true,
    introCardFace,
    discoveries,
    currentCardId,
    currentCardToken,
    lastResolvedToken: nonemptyString(source.lastResolvedToken)
      ? source.lastResolvedToken
      : null,
    decisionCount: nonNegativeInteger(source.decisionCount),
    runSeed: normalizeSeed(source.runSeed ?? fallback.runSeed),
    rngState: normalizeSeed(source.rngState ?? source.runSeed ?? fallback.rngState),
    drawStateByDeck: normalizeDrawStateByDeck(source.drawStateByDeck, decks),
    resources,
    pendingFeedback: null,
  };

  normalized.pendingFeedback = normalizePendingFeedback(
    source.pendingFeedback,
    normalized,
  );
  if (normalized.pendingFeedback) {
    const sourceDeck = decks.find(
      (deck) => deck?.id === normalized.pendingFeedback.sourceDeckId,
    );
    if (
      sourceDeck?.type !== "plot" ||
      !cardIdsForDeck(sourceDeck).has(normalized.pendingFeedback.sourceCardId) ||
      normalized.pendingFeedback.destinationDeckId !==
        getPlotDestinationDeckId(
          decks,
          normalized.pendingFeedback.sourceDeckId,
          normalized.pendingFeedback.direction,
        )
    ) {
      normalized.pendingFeedback = null;
    }
  }
  if (
    normalized.status === "playing" &&
    !normalized.pendingFeedback &&
    (!normalized.currentCardToken ||
      normalized.lastResolvedToken === normalized.currentCardToken)
  ) {
    normalized.lastResolvedToken = null;
  }
  return normalized;
}

export function cloneState(state) {
  return cloneSerializable(state);
}
