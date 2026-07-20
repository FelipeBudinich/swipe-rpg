import {
  DEEP_SOUTH_DECKS,
  DEEP_SOUTH_STORY_ID,
} from "../data/deep-south.js";
import { normalizeSeed } from "../rng.js";
import {
  createInitialUnlockedCardIdsByDeck,
  KNOWN_DISCOVERY_IDS,
  normalizeRevealedCardIds,
  normalizeUnlockedCardIdsByDeck,
} from "./card-effects.js";
import {
  createDrawStateByDeck,
  normalizeDrawStateByDeck,
} from "./deck-draw.js";
import { normalizeResources } from "./effects.js";
import { normalizeEffectLog } from "./run-log.js";

export const SAVE_VERSION = 5;
export const STORY_ID = DEEP_SOUTH_STORY_ID;
export const INITIAL_RESOURCES = Object.freeze({
  eldritchLore: 0,
  crew: 0,
  sanity: 3,
});
export const CARD_FACES = Object.freeze(["front", "back"]);
export const INITIAL_DISCOVERIES = Object.freeze(
  Object.fromEntries(KNOWN_DISCOVERY_IDS.map((id) => [id, false])),
);
export const RUN_STATUSES = Object.freeze(["playing", "lost"]);

const COMPATIBLE_PREVIOUS_SAVE_VERSION = 4;

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
  return Array.isArray(supplied) && supplied.length > 0
    ? supplied
    : DEEP_SOUTH_DECKS;
}

function configuredStory(options = {}) {
  return {
    id: STORY_ID,
    decks: configuredDecks(options),
  };
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
  const maximum = Math.max(
    0,
    (Array.isArray(deck?.cards) ? deck.cards.length : 0) - 1,
  );
  return Math.min(maximum, nonNegativeInteger(value));
}

function normalizedDiscoveries(value) {
  const source = asRecord(value);
  return Object.fromEntries(
    KNOWN_DISCOVERY_IDS.map((id) => [id, source[id] === true]),
  );
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
    Object.hasOwn(raw, "version") ||
    Object.hasOwn(raw, "story") ||
    Object.hasOwn(raw, "player") ||
    Object.hasOwn(raw, "run") ||
    Object.hasOwn(raw, "mode") ||
    Object.hasOwn(raw, "encounter") ||
    Object.hasOwn(raw, "meta") ||
    Object.hasOwn(raw, "journeyStep") ||
    Object.hasOwn(raw, "arcId") ||
    Object.hasOwn(raw, "currentBeatId") ||
    Object.hasOwn(raw, "currentBeatIndex") ||
    Object.hasOwn(raw, "currentCardData") ||
    Object.hasOwn(raw, "currentCardSource") ||
    Object.hasOwn(raw, "pendingChoiceFeedback") ||
    Object.hasOwn(raw, "gold") ||
    Object.hasOwn(raw, "inventory") ||
    Object.hasOwn(raw, "xp") ||
    Object.hasOwn(raw, "hp") ||
    Object.hasOwn(raw, "mp") ||
    Object.hasOwn(raw, "level") ||
    Object.hasOwn(player, "xp") ||
    Object.hasOwn(player, "hp") ||
    Object.hasOwn(player, "mp") ||
    Object.hasOwn(player, "level") ||
    Object.hasOwn(resources, "xp") ||
    Object.hasOwn(resources, "hp") ||
    Object.hasOwn(resources, "mp") ||
    Object.hasOwn(resources, "level")
  );
}

function normalizedFreshSeed(raw, options) {
  return normalizeSeed(options?.seed ?? raw?.runSeed ?? Date.now());
}

/** Create a fresh, serializable Deep South run. */
export function createInitialState(options = {}) {
  const normalizedOptions =
    options && typeof options === "object" ? options : { seed: options };
  const story = configuredStory(normalizedOptions);
  const decks = story.decks;
  const firstDeck = introDeck(decks);
  const seed = normalizeSeed(normalizedOptions.seed ?? Date.now());
  const unlockedCardIdsByDeck =
    createInitialUnlockedCardIdsByDeck(story);

  return {
    saveVersion: SAVE_VERSION,
    storyId: STORY_ID,
    status: "playing",
    terminalPending: false,
    currentDeckId: firstDeck?.id ?? "it-begins-here",
    introCardIndex: 0,
    introSkipPending: false,
    discoveries: { ...INITIAL_DISCOVERIES },
    revealedCardIds: [],
    unlockedCardIdsByDeck,
    currentCardId: null,
    currentCardToken: null,
    lastResolvedToken: null,
    decisionCount: 0,
    effectLog: [],
    runSeed: seed,
    rngState: seed,
    drawStateByDeck: createDrawStateByDeck(
      decks,
      unlockedCardIdsByDeck,
    ),
    resources: { ...INITIAL_RESOURCES },
  };
}

/**
 * Defensively normalize a version-5 run or migrate a compatible version-4
 * Deep South save without replaying already-applied outcome effects.
 */
export function normalizeState(raw, options = {}) {
  const source = asRecord(raw);
  const normalizedOptions = asRecord(options);
  const story = configuredStory(normalizedOptions);
  const decks = story.decks;
  const isCurrentSave = source.saveVersion === SAVE_VERSION;
  const isVersionFour =
    source.saveVersion === COMPATIBLE_PREVIOUS_SAVE_VERSION;

  if (
    (!isCurrentSave && !isVersionFour) ||
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
  const currentDeck =
    decks.find((deck) => deck?.id === currentDeckId) ?? firstDeck;
  const resources = normalizedPersistedResources(source.resources);
  const status = resources.sanity <= 0 ? "lost" : "playing";
  const discoveries = normalizedDiscoveries(source.discoveries);
  const normalizedRevealedCardIds = isVersionFour
    ? normalizeRevealedCardIds(
        discoveries.fatherDiaryReverse === true ||
          source.introCardFace === "reverse"
          ? ["intro-fathers-diary"]
          : [],
        story,
      )
    : normalizeRevealedCardIds(source.revealedCardIds, story);
  const revealedCardIds =
    discoveries.fatherDiaryReverse === true &&
    !normalizedRevealedCardIds.includes("intro-fathers-diary")
      ? normalizeRevealedCardIds(
          [...normalizedRevealedCardIds, "intro-fathers-diary"],
          story,
        )
      : normalizedRevealedCardIds;
  const unlockedCardIdsByDeck = normalizeUnlockedCardIdsByDeck(
    source.unlockedCardIdsByDeck,
    story,
    { unlockAll: isVersionFour },
  );
  const hasVersionFourOutcome =
    isVersionFour &&
    source.pendingFeedback &&
    typeof source.pendingFeedback === "object";
  const terminalPending =
    status === "lost" &&
    (isCurrentSave
      ? source.terminalPending === true
      : Boolean(hasVersionFourOutcome));
  const allowedCurrentCardIds = cardIdsForDeck(currentDeck);
  const unlockedCurrentCardIds = new Set(
    unlockedCardIdsByDeck[currentDeck?.id] ?? [],
  );
  const currentCardId =
    currentDeck?.type === "plot" &&
    !hasVersionFourOutcome &&
    (status === "playing" || terminalPending) &&
    allowedCurrentCardIds.has(source.currentCardId) &&
    unlockedCurrentCardIds.has(source.currentCardId)
      ? source.currentCardId
      : null;
  const currentFace =
    currentCardId && revealedCardIds.includes(currentCardId)
      ? "back"
      : "front";
  const currentCardToken =
    isCurrentSave &&
    currentCardId &&
    nonemptyString(source.currentCardToken) &&
    source.currentCardToken.endsWith(`:${currentCardId}:${currentFace}`)
      ? source.currentCardToken
      : null;

  const normalized = {
    ...fallback,
    status,
    terminalPending,
    currentDeckId,
    introCardIndex: introIndex(source.introCardIndex, firstDeck),
    introSkipPending:
      currentDeck?.type === "intro" &&
      status === "playing" &&
      source.introSkipPending === true,
    discoveries,
    revealedCardIds,
    unlockedCardIdsByDeck,
    currentCardId,
    currentCardToken,
    lastResolvedToken:
      isCurrentSave && nonemptyString(source.lastResolvedToken)
        ? source.lastResolvedToken
        : null,
    decisionCount: nonNegativeInteger(source.decisionCount),
    effectLog: isVersionFour
      ? []
      : normalizeEffectLog(source.effectLog, story),
    runSeed: normalizeSeed(source.runSeed ?? fallback.runSeed),
    rngState: normalizeSeed(
      source.rngState ?? source.runSeed ?? fallback.rngState,
    ),
    drawStateByDeck: normalizeDrawStateByDeck(
      source.drawStateByDeck,
      decks,
      unlockedCardIdsByDeck,
    ),
    resources,
  };

  if (
    normalized.status === "playing" &&
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
