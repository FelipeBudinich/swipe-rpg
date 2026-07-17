import { normalizeSeed } from "../rng.js";
import { normalizePendingChoiceFeedback } from "./choice-feedback.js";
import { STORY_BEAT_IDS as DEFAULT_STORY_BEAT_IDS } from "./story/constants.js";

export const SAVE_VERSION = 2;
export const DEFAULT_ARC_ID = "ember-crown";
export const STORY_BEAT_IDS = DEFAULT_STORY_BEAT_IDS;
export const EQUIPMENT_SLOTS = Object.freeze(["weapon", "armor", "charm"]);

export const INITIAL_BASE_STATS = Object.freeze({
  attack: 5,
  defense: 2,
  maxHp: 30,
  maxMp: 10,
});

const asFinite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const asInteger = (value, fallback = 0) => Math.trunc(asFinite(value, fallback));
const asNonNegativeInteger = (value, fallback = 0) => Math.max(0, asInteger(value, fallback));
const asArray = (value) => (Array.isArray(value) ? [...value] : []);
const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
const VALID_ENEMY_INTENTS = new Set(["attack", "opening", "charge", "hesitate"]);
const VALID_MODES = new Set([
  "exploration",
  "combat",
  "combatReward",
  "loot",
  "levelUp",
  "storyTransition",
  "gameOver",
  "victory",
]);

function uniqueStrings(value) {
  return [...new Set(asArray(value).filter((entry) => typeof entry === "string"))];
}

function orderedStoryPhaseIds(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const supplied = source.storyPhaseIds ?? source.beatIds;
  if (!Array.isArray(supplied)) return STORY_BEAT_IDS;
  const normalized = uniqueStrings(supplied).filter((id) => id.length > 0);
  return normalized.length > 0 ? normalized : STORY_BEAT_IDS;
}

function stringRecord(value) {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter(([, entry]) => typeof entry === "string"),
  );
}

function integerRecord(value) {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, entry]) => [key, asNonNegativeInteger(entry)]),
  );
}

function recordForIds(value, ids, normalizeValue = (entry) => entry) {
  const allowed = new Set(ids);
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .filter(([key]) => allowed.has(key))
      .map(([key, entry]) => [key, normalizeValue(entry)]),
  );
}

function isCardPayload(value, expectedId) {
  const validChoice = (choice) =>
    Boolean(
      choice &&
      typeof choice === "object" &&
      !Array.isArray(choice) &&
      typeof choice.label === "string" &&
      (choice.effects === undefined || Array.isArray(choice.effects)) &&
      (choice.requirements === undefined ||
        (choice.requirements && typeof choice.requirements === "object"))
    );
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    (!expectedId || value.id === expectedId) &&
    validChoice(value.left) &&
    validChoice(value.right)
  );
}

export function createMeta(overrides = {}, options = {}) {
  const source = asRecord(overrides);
  const storyPhaseIds = orderedStoryPhaseIds(options);
  const requestedIndex = Math.min(
    storyPhaseIds.length - 1,
    asNonNegativeInteger(source.furthestBeatIndex),
  );
  const requestedId =
    typeof source.furthestBeatId === "string" && storyPhaseIds.includes(source.furthestBeatId)
      ? source.furthestBeatId
      : storyPhaseIds[requestedIndex];
  const alignedIndex = storyPhaseIds.indexOf(requestedId);
  return {
    bestLevel: Math.max(1, asInteger(source.bestLevel, 1)),
    furthestBeatIndex: alignedIndex >= 0 ? alignedIndex : requestedIndex,
    furthestBeatId: requestedId ?? storyPhaseIds[0],
    bestStoryProgress: Math.max(0, Math.min(100, asFinite(source.bestStoryProgress, 0))),
    bestWorldCardsResolved: asNonNegativeInteger(source.bestWorldCardsResolved),
    deathCount: asNonNegativeInteger(source.deathCount),
    victoryCount: asNonNegativeInteger(source.victoryCount),
    discoveredEnemyIds: uniqueStrings(source.discoveredEnemyIds),
    discoveredItemIds: uniqueStrings(source.discoveredItemIds),
    discoveredCardIds: uniqueStrings(source.discoveredCardIds),
    discoveredEndingIds: uniqueStrings(source.discoveredEndingIds),
    completedArcIds: uniqueStrings(source.completedArcIds),
  };
}

export function createStoryState(arcId = DEFAULT_ARC_ID, options = {}) {
  const storyPhaseIds = orderedStoryPhaseIds(options);
  const firstPhaseId = storyPhaseIds[0];
  return {
    arcId,
    status: "active",
    currentBeatId: firstPhaseId,
    currentBeatIndex: 0,
    cardsResolvedInBeat: 0,
    cardsResolvedByBeat: { [firstPhaseId]: 0 },
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
  };
}

/** Create the canonical serializable run state. */
export function createInitialState(options = {}) {
  const normalizedOptions =
    typeof options === "object" && options !== null ? options : { seed: options };
  const storyPhaseIds = orderedStoryPhaseIds(normalizedOptions);
  const seed = normalizeSeed(normalizedOptions.seed ?? Date.now());
  const arcId = typeof normalizedOptions.arcId === "string" ? normalizedOptions.arcId : DEFAULT_ARC_ID;

  return {
    version: SAVE_VERSION,
    mode: "exploration",
    runSeed: seed,
    rngState: seed,
    decisionCount: 0,
    currentCardId: null,
    currentCardData: null,
    currentCardToken: null,
    currentCardSource: null,
    lastResolvedToken: null,
    pendingChoiceFeedback: null,
    story: createStoryState(arcId, { storyPhaseIds }),
    player: {
      level: 1,
      xp: 0,
      hp: 30,
      mp: 10,
      gold: 10,
      baseStats: { ...INITIAL_BASE_STATS },
      equipment: { weapon: null, armor: null, charm: null },
      inventory: [],
    },
    encounter: null,
    run: {
      flags: {},
      forcedCardQueue: [],
      recentCardIds: [],
      lastSeenTurnByCardId: {},
      resolvedOnceCards: [],
      resolvedCardIds: [],
      turnsSinceEncounter: 0,
      lastCombatTurn: null,
      randomEncountersByBeat: {},
      enemiesDefeated: {},
      goldEarned: 0,
      itemsFound: 0,
      deathRecorded: false,
      victoryRecorded: false,
      deathCause: null,
      stats: {},
    },
    meta: createMeta(normalizedOptions.meta, { storyPhaseIds }),
  };
}

function normalizeStory(rawStory, fallback, storyPhaseIds) {
  const story = asRecord(rawStory);
  const currentBeatIndex = Math.min(
    storyPhaseIds.length - 1,
    asNonNegativeInteger(story.currentBeatIndex),
  );
  const expectedBeatId = storyPhaseIds[currentBeatIndex];
  const currentBeatId = storyPhaseIds.includes(story.currentBeatId)
    ? story.currentBeatId
    : expectedBeatId;
  const alignedIndex = storyPhaseIds.indexOf(currentBeatId);
  const status = ["active", "completed", "failed"].includes(story.status)
    ? story.status
    : fallback.status;
  const pendingInterstitialBeatId = storyPhaseIds.includes(story.pendingInterstitialBeatId)
    ? story.pendingInterstitialBeatId
    : null;
  return {
    arcId: typeof story.arcId === "string" ? story.arcId : fallback.arcId,
    status,
    currentBeatId,
    currentBeatIndex: alignedIndex,
    cardsResolvedInBeat: asNonNegativeInteger(story.cardsResolvedInBeat),
    cardsResolvedByBeat: recordForIds(
      story.cardsResolvedByBeat,
      storyPhaseIds,
      asNonNegativeInteger,
    ),
    totalWorldCardsResolved: asNonNegativeInteger(story.totalWorldCardsResolved),
    completedBeatIds: uniqueStrings(story.completedBeatIds).filter((id) => storyPhaseIds.includes(id)),
    resolvedStoryTags: uniqueStrings(story.resolvedStoryTags),
    facts: asRecord(story.facts),
    selectedAnchorIdByBeat: recordForIds(
      stringRecord(story.selectedAnchorIdByBeat),
      storyPhaseIds,
    ),
    resolvedAnchorIds: uniqueStrings(story.resolvedAnchorIds),
    pendingInterstitialBeatId,
    shownInterstitialBeatIds: uniqueStrings(story.shownInterstitialBeatIds)
      .filter((id) => storyPhaseIds.includes(id)),
    endingId: typeof story.endingId === "string" ? story.endingId : null,
    endingTitle: typeof story.endingTitle === "string" ? story.endingTitle : null,
    completed: Boolean(story.completed || status === "completed"),
  };
}

/**
 * Defensively normalize untrusted persisted data.
 *
 * Version-one journey saves intentionally retain only valid meta progression;
 * physical depth is never guessed into a narrative beat.
 */
export function normalizeState(raw, options = {}) {
  const storyPhaseIds = orderedStoryPhaseIds(options);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createInitialState({ ...asRecord(options), storyPhaseIds });
  }

  const seed = normalizeSeed(raw.runSeed ?? options.seed ?? Date.now());
  if (Number(raw.version) !== SAVE_VERSION || !raw.story) {
    return createInitialState({
      seed: options.seed ?? seed,
      arcId: options.arcId ?? DEFAULT_ARC_ID,
      meta: createMeta(raw.meta, { storyPhaseIds }),
      storyPhaseIds,
    });
  }

  const fallback = createInitialState({
    seed,
    arcId: raw.story?.arcId,
    meta: raw.meta,
    storyPhaseIds,
  });
  const player = asRecord(raw.player);
  const baseStats = asRecord(player.baseStats);
  const equipment = asRecord(player.equipment);
  const run = asRecord(raw.run);
  const encounter = asRecord(raw.encounter);

  const normalized = {
    ...fallback,
    version: SAVE_VERSION,
    mode: VALID_MODES.has(raw.mode) ? raw.mode : fallback.mode,
    runSeed: seed,
    rngState: normalizeSeed(raw.rngState ?? seed),
    decisionCount: asNonNegativeInteger(raw.decisionCount),
    currentCardId: typeof raw.currentCardId === "string" ? raw.currentCardId : null,
    currentCardData: isCardPayload(raw.currentCardData, raw.currentCardId)
      ? structuredCloneSafe(raw.currentCardData)
      : null,
    currentCardToken: typeof raw.currentCardToken === "string" ? raw.currentCardToken : null,
    currentCardSource: typeof raw.currentCardSource === "string" ? raw.currentCardSource : null,
    lastResolvedToken: typeof raw.lastResolvedToken === "string" ? raw.lastResolvedToken : null,
    story: normalizeStory(raw.story, fallback.story, storyPhaseIds),
    player: {
      level: Math.max(1, asInteger(player.level, fallback.player.level)),
      xp: asNonNegativeInteger(player.xp),
      hp: Math.max(0, asFinite(player.hp, fallback.player.hp)),
      mp: Math.max(0, asFinite(player.mp, fallback.player.mp)),
      gold: Math.max(0, asFinite(player.gold, fallback.player.gold)),
      baseStats: {
        attack: Math.max(0, asFinite(baseStats.attack, INITIAL_BASE_STATS.attack)),
        defense: Math.max(0, asFinite(baseStats.defense, INITIAL_BASE_STATS.defense)),
        maxHp: Math.max(1, asFinite(baseStats.maxHp, INITIAL_BASE_STATS.maxHp)),
        maxMp: Math.max(0, asFinite(baseStats.maxMp, INITIAL_BASE_STATS.maxMp)),
      },
      equipment: Object.fromEntries(
        EQUIPMENT_SLOTS.map((slot) => [
          slot,
          typeof equipment[slot] === "string" ? equipment[slot] : null,
        ]),
      ),
      inventory: asArray(player.inventory).filter(
        (item) => typeof item === "string" || (item && typeof item === "object"),
      ),
    },
    encounter:
      raw.encounter && typeof raw.encounter === "object" && typeof encounter.enemyId === "string"
        ? {
            enemyId: encounter.enemyId,
            hp: Math.max(0, asFinite(encounter.hp, 1)),
            lastIntent: VALID_ENEMY_INTENTS.has(encounter.lastIntent) ? encounter.lastIntent : null,
            currentIntent: VALID_ENEMY_INTENTS.has(encounter.currentIntent)
              ? encounter.currentIntent
              : "attack",
            round: Math.max(1, asInteger(encounter.round, 1)),
            originBeatId: storyPhaseIds.includes(encounter.originBeatId)
              ? encounter.originBeatId
              : fallback.story.currentBeatId,
            kind: typeof encounter.kind === "string" ? encounter.kind : "random",
            phase: Math.max(1, asInteger(encounter.phase, 1)),
          }
        : null,
    run: {
      flags: asRecord(run.flags),
      forcedCardQueue: asArray(run.forcedCardQueue).filter(
        (entry) => typeof entry === "string" || (entry && typeof entry === "object"),
      ),
      recentCardIds: asArray(run.recentCardIds)
        .filter((entry) => typeof entry === "string")
        .slice(-4),
      lastSeenTurnByCardId: asRecord(run.lastSeenTurnByCardId),
      resolvedOnceCards: uniqueStrings(run.resolvedOnceCards),
      resolvedCardIds: uniqueStrings(run.resolvedCardIds),
      turnsSinceEncounter: asNonNegativeInteger(run.turnsSinceEncounter),
      lastCombatTurn:
        run.lastCombatTurn !== null && run.lastCombatTurn !== undefined && Number.isFinite(Number(run.lastCombatTurn))
          ? asNonNegativeInteger(run.lastCombatTurn)
          : null,
      randomEncountersByBeat: recordForIds(
        run.randomEncountersByBeat,
        storyPhaseIds,
        asNonNegativeInteger,
      ),
      enemiesDefeated: integerRecord(run.enemiesDefeated),
      goldEarned: asNonNegativeInteger(run.goldEarned),
      itemsFound: asNonNegativeInteger(run.itemsFound),
      deathRecorded: Boolean(run.deathRecorded),
      victoryRecorded: Boolean(run.victoryRecorded),
      deathCause: typeof run.deathCause === "string" ? run.deathCause : null,
      stats: asRecord(run.stats),
    },
    meta: createMeta(raw.meta, { storyPhaseIds }),
  };

  if (
    normalized.encounter &&
    !["gameOver", "victory", "storyTransition"].includes(normalized.mode) &&
    (!normalized.currentCardId || normalized.currentCardId.startsWith("combat:"))
  ) {
    normalized.mode = "combat";
  }
  if (normalized.story.pendingInterstitialBeatId && normalized.mode === "exploration") {
    normalized.mode = "storyTransition";
  }
  normalized.pendingChoiceFeedback = normalizePendingChoiceFeedback(
    raw.pendingChoiceFeedback,
    {
      state: normalized,
      card: normalized.currentCardData,
    },
  );
  return normalized;
}

function structuredCloneSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function cloneState(state) {
  return structuredCloneSafe(state);
}
