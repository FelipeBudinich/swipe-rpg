import { normalizeSeed } from "../rng.js";

export const SAVE_VERSION = 1;
export const BOSS_JOURNEY_STEP = 20;
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

function uniqueStrings(value) {
  return [...new Set(asArray(value).filter((entry) => typeof entry === "string"))];
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

export function createMeta(overrides = {}) {
  const source = asRecord(overrides);
  return {
    bestLevel: Math.max(1, asInteger(source.bestLevel, 1)),
    bestJourneyStep: asNonNegativeInteger(source.bestJourneyStep),
    deathCount: asNonNegativeInteger(source.deathCount),
    victoryCount: asNonNegativeInteger(source.victoryCount),
    discoveredEnemyIds: uniqueStrings(source.discoveredEnemyIds),
    discoveredItemIds: uniqueStrings(source.discoveredItemIds),
    discoveredCardIds: uniqueStrings(source.discoveredCardIds),
  };
}

/**
 * Create the canonical serializable run state.
 *
 * Accepts either `{ seed, meta }` or a seed directly for small test fixtures.
 */
export function createInitialState(options = {}) {
  const normalizedOptions =
    typeof options === "object" && options !== null ? options : { seed: options };
  const seed = normalizeSeed(normalizedOptions.seed ?? Date.now());

  return {
    version: SAVE_VERSION,
    mode: "exploration",
    runSeed: seed,
    rngState: seed,
    decisionCount: 0,
    journeyStep: 0,
    currentCardId: null,
    currentCardData: null,
    currentCardToken: null,
    currentCardSource: null,
    lastResolvedToken: null,
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
      enemiesDefeated: {},
      goldEarned: 0,
      itemsFound: 0,
      bossQueued: false,
      bossVictoryPending: false,
      bossDefeated: false,
      deathRecorded: false,
      victoryRecorded: false,
      stats: {},
    },
    meta: createMeta(normalizedOptions.meta),
  };
}

/**
 * Defensively normalize untrusted persisted data. It deliberately preserves
 * unknown flags/stats and queue payloads, while rebuilding every required
 * structural field and rejecting non-finite numeric values.
 */
export function normalizeState(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createInitialState(options);
  }

  const seed = normalizeSeed(raw.runSeed ?? options.seed ?? Date.now());
  const fallback = createInitialState({ seed, meta: raw.meta });
  const player = asRecord(raw.player);
  const baseStats = asRecord(player.baseStats);
  const equipment = asRecord(player.equipment);
  const run = asRecord(raw.run);
  const encounter = asRecord(raw.encounter);
  const allowedModes = new Set(["exploration", "combat", "loot", "levelUp", "gameOver", "victory"]);

  const normalized = {
    ...fallback,
    version: SAVE_VERSION,
    mode: allowedModes.has(raw.mode) ? raw.mode : fallback.mode,
    runSeed: seed,
    rngState: normalizeSeed(raw.rngState ?? seed),
    decisionCount: asNonNegativeInteger(raw.decisionCount),
    journeyStep: asNonNegativeInteger(raw.journeyStep),
    currentCardId: typeof raw.currentCardId === "string" ? raw.currentCardId : null,
    currentCardData: isCardPayload(raw.currentCardData, raw.currentCardId)
      ? structuredCloneSafe(raw.currentCardData)
      : null,
    currentCardToken: typeof raw.currentCardToken === "string" ? raw.currentCardToken : null,
    currentCardSource: typeof raw.currentCardSource === "string" ? raw.currentCardSource : null,
    lastResolvedToken: typeof raw.lastResolvedToken === "string" ? raw.lastResolvedToken : null,
    player: {
      level: Math.max(1, asInteger(player.level, fallback.player.level)),
      xp: asNonNegativeInteger(player.xp),
      // Upper bounds require item definitions, so they are applied by the
      // equipment/engine layer after load. Lower bounds are safe here.
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
        run.lastCombatTurn !== null &&
        run.lastCombatTurn !== undefined &&
        Number.isFinite(Number(run.lastCombatTurn))
          ? asNonNegativeInteger(run.lastCombatTurn)
          : null,
      enemiesDefeated: asRecord(run.enemiesDefeated),
      goldEarned: asNonNegativeInteger(run.goldEarned),
      itemsFound: asNonNegativeInteger(run.itemsFound),
      bossQueued: Boolean(run.bossQueued),
      bossVictoryPending: Boolean(run.bossVictoryPending),
      bossDefeated: Boolean(run.bossDefeated),
      deathRecorded: Boolean(run.deathRecorded),
      victoryRecorded: Boolean(run.victoryRecorded),
      stats: asRecord(run.stats),
    },
    meta: createMeta(raw.meta),
  };

  // Combat is authoritative unless a higher-priority forced card was already
  // persisted on top of the paused encounter.
  if (
    normalized.encounter &&
    !["gameOver", "victory"].includes(normalized.mode) &&
    (!normalized.currentCardId || normalized.currentCardId.startsWith("combat:"))
  ) {
    normalized.mode = "combat";
  }
  return normalized;
}

function structuredCloneSafe(value) {
  // Current card payloads contain only declarative JSON-like data.
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function cloneState(state) {
  return structuredCloneSafe(state);
}
