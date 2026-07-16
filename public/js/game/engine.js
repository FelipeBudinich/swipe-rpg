import { EMBER_CROWN_ARC } from "../data/arcs/ember-crown.js";
import { EMBER_CROWN_CARDS } from "../data/cards/ember-crown-cards.js";
import { EMBER_CROWN_ENEMIES } from "../data/ember-crown-enemies.js";
import { items } from "../data/items.js";
import { normalizeSeed } from "../rng.js";
import { getCombatCard, resolveCombatChoice } from "./combat.js";
import { applyEffects, resourceChanges } from "./effects.js";
import {
  addInventoryItem,
  clampPlayerResources,
  createItemMap,
  equipItem,
  findItem,
  inventoryHasItem,
  removeInventoryItem,
} from "./equipment.js";
import { applyLevelUpChoice } from "./progression.js";
import { cardHasAvailableChoice, choiceIsAvailable, requirementsMet } from "./requirements.js";
import {
  advanceBeat,
  calculateStoryProgress,
  calculateStoryProgressPercent,
  canAdvanceBeat,
  dismissBeatInterstitial,
  getCurrentArc,
  getCurrentBeat,
  recordStoryCardResolution,
  selectAnchorVariant,
} from "./story/arc-engine.js";
import { getBeatBudget } from "./story/beat-progress.js";
import {
  getEligibleStoryCards,
  selectStoryCard,
} from "./story/story-selector.js";
import { createInitialState } from "./state.js";

const SAFE_STORY_FALLBACK = Object.freeze({
  id: "story-safe-fallback",
  category: "story",
  speaker: "The Storykeeper",
  title: "A Road Through the Ash",
  text: "The Warden finds the one remaining path and carries the pursuit forward.",
  artId: "scene-road",
  baseWeight: 0,
  cooldown: 0,
  oncePerRun: false,
  requirements: [],
  tags: ["fallback"],
  safeStoryFallback: true,
  story: {
    arcIds: ["ember-crown"],
    beatWeights: Object.fromEntries(EMBER_CROWN_ARC.beats.map(({ id }) => [id, 1])),
    role: "completion",
    completionTags: [],
    countsTowardStory: true,
  },
  left: {
    label: "Take the remaining road",
    resultText: "The pursuit continues along the last open road.",
    effects: [],
  },
  right: {
    label: "Mark the way behind",
    resultText: "You leave a clear sign, then continue the pursuit.",
    effects: [],
  },
});

export const TERMINAL_CARDS = Object.freeze({
  death: Object.freeze({
    id: "death",
    category: "gameOver",
    speaker: "The Last Ember",
    title: "The Ember Fades",
    text: "The road remembers how far the Warden carried the flame.",
    story: { countsTowardStory: false },
    left: { label: "Begin a new arc", resultText: "A new ember catches.", effects: [] },
    right: { label: "Retry this seed", resultText: "The same sparks return.", effects: [] },
  }),
  victory: Object.freeze({
    id: "victory",
    category: "victory",
    speaker: "Hearthvale",
    title: "The Story Is Complete",
    text: "The final image settles into the memory of the valley.",
    story: { countsTowardStory: false },
    left: { label: "Begin another arc", resultText: "Another fire waits.", effects: [] },
    right: { label: "Replay this seed", resultText: "The known stars return.", effects: [] },
  }),
  levelUp: Object.freeze({
    id: "level-up",
    category: "levelUp",
    speaker: "The Fire Within",
    title: "Choose What Grows",
    text: "Hard-won experience gathers into a new shape.",
    story: { countsTowardStory: false },
    left: {
      label: "Vigor",
      resultText: "Your stance roots deeper.",
      preview: [
        { resource: "maxHp", label: "+6 max HP" },
        { resource: "defense", delta: 1 },
        { resource: "hp", label: "Recover 6 HP" },
      ],
      effects: [],
    },
    right: {
      label: "Arcana",
      resultText: "Spelllight sharpens at your fingertips.",
      preview: [
        { resource: "maxMp", label: "+4 max MP" },
        { resource: "attack", delta: 1 },
        { resource: "mp", label: "Recover 4 MP" },
      ],
      effects: [],
    },
  }),
});

const defaultCardById = Object.freeze(
  Object.fromEntries(EMBER_CROWN_CARDS.map((card) => [card.id, card])),
);

export const DEFAULT_CONTENT = Object.freeze({
  cards: EMBER_CROWN_CARDS,
  cardById: defaultCardById,
  fallbackCard: SAFE_STORY_FALLBACK,
  enemies: EMBER_CROWN_ENEMIES,
  items,
  arcs: [EMBER_CROWN_ARC],
  arcById: Object.freeze({ [EMBER_CROWN_ARC.id]: EMBER_CROWN_ARC }),
});

function normalizeCollection(value, fallback) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && typeof value.id === "string") return [value];
  if (value && typeof value === "object") return Object.values(value);
  return fallback;
}

function normalizeContent(content = DEFAULT_CONTENT) {
  const contentCards = normalizeCollection(content.cards ?? content.CARDS, DEFAULT_CONTENT.cards);
  const contentEnemies = normalizeCollection(
    content.enemies ?? content.ENEMIES,
    DEFAULT_CONTENT.enemies,
  );
  const contentItems = normalizeCollection(content.items ?? content.ITEMS, DEFAULT_CONTENT.items);
  const arcs = normalizeCollection(
    content.arcs ?? content.arcById ?? content.arc,
    DEFAULT_CONTENT.arcs,
  );
  const suppliedCardMap = content.cardById ?? content.CARD_BY_ID;
  const cardMap =
    suppliedCardMap instanceof Map
      ? Object.fromEntries(suppliedCardMap)
      : suppliedCardMap ?? Object.fromEntries(contentCards.map((card) => [card.id, card]));
  return {
    cards: contentCards,
    cardById: cardMap,
    fallbackCard: content.fallbackCard ?? SAFE_STORY_FALLBACK,
    enemies: contentEnemies,
    items: contentItems,
    arcs,
    arcById: Object.fromEntries(arcs.map((arc) => [arc.id, arc])),
  };
}

function normalizeDirection(direction) {
  if (["left", "a", "ArrowLeft", -1].includes(direction)) return "left";
  if (["right", "d", "ArrowRight", 1].includes(direction)) return "right";
  return null;
}

function addUnique(list, value) {
  return list.includes(value) ? list : [...list, value];
}

function isPlayableCard(card) {
  const validChoice = (choice) =>
    Boolean(
      choice &&
        typeof choice.label === "string" &&
        (choice.effects === undefined || Array.isArray(choice.effects)),
    );
  return Boolean(
    card && typeof card.id === "string" && validChoice(card.left) && validChoice(card.right),
  );
}

function withModeForCard(state, card) {
  let mode = "exploration";
  if (card?.id === "level-up" || card?.category === "levelUp") mode = "levelUp";
  if (card?.id === "death" || card?.category === "gameOver") mode = "gameOver";
  if (card?.id === "victory" || card?.category === "victory") mode = "victory";
  if (card?.category === "loot") mode = "loot";
  if (card?.category === "combat") mode = "combat";
  return { ...state, mode };
}

function putCurrentCard(state, card, source) {
  const withMode = withModeForCard(state, card);
  return {
    ...withMode,
    currentCardId: card.id,
    currentCardData: card,
    currentCardToken: `${state.decisionCount}:${card.id}`,
    currentCardSource: source,
  };
}

function clearCurrentCard(state, resolvedToken = null) {
  return {
    ...state,
    currentCardId: null,
    currentCardData: null,
    currentCardToken: null,
    currentCardSource: null,
    lastResolvedToken: resolvedToken,
  };
}

function decorateCard(card, state, content) {
  if (!card) return null;
  const decorateChoice = (choice) => {
    if (!choice) return choice;
    const disabled = !choiceIsAvailable(choice, state, { items: content.items });
    return {
      ...choice,
      disabled,
      disabledReason: disabled ? "You lack the required resource." : null,
    };
  };
  return {
    ...card,
    left: decorateChoice(card.left),
    right: decorateChoice(card.right),
    resolutionToken: state.currentCardToken,
  };
}

function countDefeated(enemiesDefeated) {
  return Object.values(enemiesDefeated ?? {}).reduce(
    (total, count) => total + Math.max(0, Number(count) || 0),
    0,
  );
}

function updateMetaProgress(state, content) {
  const arc = getCurrentArc(state, content.arcs);
  const beatIndex = Math.max(0, Number(state.story?.currentBeatIndex ?? 0));
  return {
    ...state,
    meta: {
      ...state.meta,
      bestLevel: Math.max(Number(state.meta.bestLevel ?? 1), state.player.level),
      furthestBeatIndex: Math.max(Number(state.meta.furthestBeatIndex ?? 0), beatIndex),
      furthestBeatId:
        beatIndex >= Number(state.meta.furthestBeatIndex ?? 0)
          ? state.story?.currentBeatId ?? state.meta.furthestBeatId
          : state.meta.furthestBeatId,
      bestStoryProgress: Math.max(
        Number(state.meta.bestStoryProgress ?? 0),
        arc ? calculateStoryProgressPercent(state, arc) : 0,
      ),
      bestWorldCardsResolved: Math.max(
        Number(state.meta.bestWorldCardsResolved ?? 0),
        Number(state.story?.totalWorldCardsResolved ?? 0),
      ),
    },
  };
}

function recordTerminal(state, terminal, content) {
  const death = terminal === "death";
  const marker = death ? "deathRecorded" : "victoryRecorded";
  const counter = death ? "deathCount" : "victoryCount";
  let working = updateMetaProgress(state, content);
  if (!working.run[marker]) {
    working = {
      ...working,
      run: {
        ...working.run,
        [marker]: true,
        ...(death && !working.run.deathCause ? { deathCause: "The Warden fell in battle." } : {}),
        finalRunRecord: {
          beatId: working.story?.currentBeatId ?? null,
          beatIndex: working.story?.currentBeatIndex ?? 0,
          level: working.player.level,
          worldCardsResolved: working.story?.totalWorldCardsResolved ?? 0,
          enemiesDefeated: countDefeated(working.run.enemiesDefeated),
          cause: death ? working.run.deathCause ?? "The Warden fell in battle." : null,
        },
      },
      story: death
        ? { ...working.story, status: "failed", pendingInterstitialBeatId: null }
        : working.story,
      meta: {
        ...working.meta,
        [counter]: Number(working.meta[counter] ?? 0) + 1,
        ...(!death
          ? {
              completedArcIds: addUnique(
                working.meta.completedArcIds ?? [],
                working.story?.arcId,
              ),
            }
          : {}),
      },
    };
  }
  return { ...working, mode: death ? "gameOver" : "victory", encounter: null };
}

function buildLootCard(item) {
  const equipment = item?.type === "equipment";
  return {
    id: `loot:${item?.id ?? "unknown"}`,
    category: "loot",
    speaker: "Victory Spoils",
    title: item?.name ?? "Unknown Relic",
    text: item?.description ?? "Something gleams among the cooling ash.",
    artId: item?.artId ?? "item-unknown",
    itemId: item?.id ?? null,
    story: { countsTowardStory: false },
    left: equipment
      ? {
          label: `Sell · +${item.sellValue ?? 0} gold`,
          resultText: `The relic is traded for ${item.sellValue ?? 0} gold.`,
          preview: [{ resource: "gold", delta: item.sellValue ?? 0 }],
          effects: [],
        }
      : {
          label: "Use now",
          resultText: `${item?.name ?? "The item"} is used at once.`,
          preview: [],
          effects: item?.useEffects ?? item?.effects ?? [],
        },
    right: {
      label: "Keep",
      resultText: `${item?.name ?? "The item"} is packed safely away.`,
      preview: [{ resource: "inventory", label: "Keep" }],
      effects: [],
    },
  };
}

function queueCard(entry, content) {
  if (isPlayableCard(entry?.card)) return entry.card;
  const cardId = typeof entry === "string" ? entry : entry?.cardId ?? entry?.id;
  if (cardId === "loot") return buildLootCard(createItemMap(content.items).get(entry.itemId));
  if (cardId === "level-up") return TERMINAL_CARDS.levelUp;
  return content.cardById[cardId] ?? TERMINAL_CARDS[cardId] ?? null;
}

function withQueueOrigin(card, entry) {
  if (!card || !entry || typeof entry !== "object" || !entry.originBeatId) return card;
  return {
    ...card,
    originBeatId: entry.originBeatId,
    story: { ...(card.story ?? {}), originBeatId: entry.originBeatId },
  };
}

function isRewardEntry(entry, content) {
  const card = queueCard(entry, content);
  return Boolean(card && ["loot", "levelUp"].includes(card.category));
}

function takeQueueEntry(state, content, predicate = () => true) {
  const queue = [...(state.run.forcedCardQueue ?? [])];
  const index = queue.findIndex((entry) => predicate(entry, content));
  if (index < 0) return { state, entry: null };
  const [entry] = queue.splice(index, 1);
  return { state: { ...state, run: { ...state.run, forcedCardQueue: queue } }, entry };
}

function presentQueueEntry(state, entry, content, source) {
  const card = withQueueOrigin(queueCard(entry, content), entry);
  if (!isPlayableCard(card)) return null;
  const candidateState = withModeForCard(state, card);
  if (
    !requirementsMet(card.requirements, candidateState, { items: content.items }) ||
    !cardHasAvailableChoice(card, candidateState, { items: content.items })
  ) {
    return null;
  }
  const presented = putCurrentCard(state, card, source);
  return { state: presented, card: getCurrentCard(presented, content), source };
}

export function getCurrentCard(state, contentInput = DEFAULT_CONTENT) {
  if (!state?.currentCardId) return null;
  const content = normalizeContent(contentInput);
  let card = null;
  if (state.currentCardId.startsWith("combat:") && state.encounter) {
    card = getCombatCard(state, content.enemies, content.items);
  } else if (state.currentCardId.startsWith("loot:")) {
    const itemId = state.currentCardData?.itemId ?? state.currentCardId.slice(5);
    card = state.currentCardData ?? buildLootCard(createItemMap(content.items).get(itemId));
  } else {
    const saved =
      isPlayableCard(state.currentCardData) && state.currentCardData.id === state.currentCardId
        ? state.currentCardData
        : null;
    card =
      saved ??
      content.cardById[state.currentCardId] ??
      (state.currentCardId === "level-up" ? TERMINAL_CARDS.levelUp : null) ??
      TERMINAL_CARDS[state.currentCardId];
  }
  return isPlayableCard(card) ? decorateCard(card, state, content) : null;
}

function currentCardIsUsable(state, card, content) {
  return Boolean(
    card &&
      state.currentCardToken !== state.lastResolvedToken &&
      requirementsMet(card.requirements, state, { items: content.items }) &&
      cardHasAvailableChoice(card, state, { items: content.items }),
  );
}

function recordStoryPresentation(state, card) {
  const turn = Number(state.story?.totalWorldCardsResolved ?? state.decisionCount ?? 0);
  return {
    ...state,
    run: {
      ...state.run,
      recentCardIds: [...(state.run.recentCardIds ?? []), card.id].slice(-4),
      lastSeenTurnByCardId: {
        ...(state.run.lastSeenTurnByCardId ?? {}),
        [card.id]: turn,
      },
    },
  };
}

function anchorCardIds(beat) {
  return [
    ...(beat?.anchor?.variants ?? []).map(({ cardId }) => cardId),
    beat?.anchor?.fallbackCardId,
  ].filter((id) => typeof id === "string");
}

function shouldSurfaceAnchor(state, beat, content, ordinaryCandidates) {
  if (!beat?.anchor) return false;
  const selected = state.story.selectedAnchorIdByBeat?.[beat.id];
  if (selected && !(state.story.resolvedAnchorIds ?? []).includes(selected)) return true;
  if (selected) return false;

  const resolved = Number(state.story.cardsResolvedInBeat ?? 0);
  const configuredMinimum = Number(beat.anchor.minimumCardsBeforeAnchor);
  if (Number.isFinite(configuredMinimum)) {
    return resolved >= Math.max(0, configuredMinimum);
  }
  const requiredFirst = anchorCardIds(beat).some((id) => {
    const story = content.cardById[id]?.story;
    return story?.requiredAsFirstCard === true || story?.requiredFirst === true;
  });
  if ((requiredFirst || beat.anchor.requiredAsFirstCard === true) && resolved === 0) return true;
  if (ordinaryCandidates.length === 0) return true;

  // The anchor itself can satisfy the last minimum slot. This reserves one
  // target slot for an authored aftermath/resolution card when the beat has one.
  const budget = getBeatBudget(beat);
  return resolved >= Math.max(0, budget.minimum - 1);
}

function prepareAnchor(state, arc, beat, content) {
  const selected = selectAnchorVariant(state, arc, beat, {
    evaluateRequirements: requirementsMet,
    context: { items: content.items },
  });
  const card = content.cardById[selected.cardId];
  if (
    !isPlayableCard(card) ||
    !requirementsMet(card.requirements, selected.state, { items: content.items }) ||
    !cardHasAvailableChoice(card, selected.state, { items: content.items })
  ) {
    return null;
  }
  const recorded = recordStoryPresentation(selected.state, card);
  const presented = putCurrentCard(recorded, card, "anchor");
  return { state: presented, card: getCurrentCard(presented, content), source: "anchor" };
}

function prepareStoryCard(state, content) {
  const arc = getCurrentArc(state, content.arcs);
  const beat = getCurrentBeat(state, arc);
  if (!arc || !beat) return null;
  const selectorOptions = {
    evaluateRequirements: requirementsMet,
    cardHasAvailableChoice,
    context: { items: content.items },
    enemies: content.enemies,
  };
  if (Number(state.story.cardsResolvedInBeat ?? 0) === 0) {
    const requiredEntry = (beat.completionCardIds ?? [])
      .map((id) => content.cardById[id])
      .find(
        (card) =>
          card?.story?.role === "entry" &&
          requirementsMet(card.requirements, state, { items: content.items }) &&
          cardHasAvailableChoice(card, state, { items: content.items }),
      );
    if (requiredEntry) {
      const recorded = recordStoryPresentation(state, requiredEntry);
      const presented = putCurrentCard(recorded, requiredEntry, "entry");
      return { state: presented, card: getCurrentCard(presented, content), source: "entry" };
    }
  }
  const ordinaryCandidates = getEligibleStoryCards(
    state,
    content.cards,
    beat,
    selectorOptions,
  );
  if (shouldSurfaceAnchor(state, beat, content, ordinaryCandidates)) {
    const anchor = prepareAnchor(state, arc, beat, content);
    if (anchor) return anchor;
  }

  const selected = selectStoryCard(state, content.cards, beat, selectorOptions);
  if (selected.card) {
    const presented = putCurrentCard(selected.state, selected.card, selected.source);
    return {
      state: presented,
      card: getCurrentCard(presented, content),
      source: selected.source,
    };
  }

  if (beat.anchor) {
    const anchor = prepareAnchor(state, arc, beat, content);
    if (anchor) return anchor;
  }
  const fallback = { ...content.fallbackCard, safeStoryFallback: true };
  const recorded = recordStoryPresentation(state, fallback);
  const presented = putCurrentCard(recorded, fallback, "safe-fallback");
  return {
    state: presented,
    card: getCurrentCard(presented, content),
    source: "safe-fallback",
  };
}

/** Resolve central next-state priority without consuming a player decision. */
export function getNextCard(inputState, contentInput = DEFAULT_CONTENT) {
  const content = normalizeContent(contentInput);
  let working = clampPlayerResources(inputState, content.items);

  if (working.player.hp <= 0) {
    working = recordTerminal(working, "death", content);
    const card = TERMINAL_CARDS.death;
    if (working.currentCardId !== card.id || working.currentCardToken === working.lastResolvedToken) {
      working = putCurrentCard(clearCurrentCard(working), card, "death");
    }
    return { state: working, card: getCurrentCard(working, content), source: "death" };
  }

  let current = getCurrentCard(working, content);
  if (
    working.story?.pendingInterstitialBeatId &&
    current &&
    !["combat", "loot", "levelUp"].includes(current.category)
  ) {
    working = clearCurrentCard(working);
    current = null;
  }
  if (currentCardIsUsable(working, current, content)) {
    return { state: working, card: current, source: working.currentCardSource ?? "current" };
  }
  if (current) working = clearCurrentCard(working);

  if (working.encounter) {
    const combatCard = getCombatCard(working, content.enemies, content.items);
    if (combatCard) {
      working = putCurrentCard({ ...working, mode: "combat" }, combatCard, "combat");
      return { state: working, card: getCurrentCard(working, content), source: "combat" };
    }
    working = { ...working, encounter: null, mode: "exploration" };
  }

  // Reward and level-up entries may have been appended behind a beat-local
  // aftermath; pull them forward without disturbing the relative reward order.
  while ((working.run.forcedCardQueue ?? []).some((entry) => isRewardEntry(entry, content))) {
    const taken = takeQueueEntry(working, content, isRewardEntry);
    working = taken.state;
    const presented = presentQueueEntry(working, taken.entry, content, "reward");
    if (presented) return presented;
  }

  if (working.story?.completed === true || working.story?.status === "completed") {
    working = recordTerminal(working, "victory", content);
    const card = TERMINAL_CARDS.victory;
    if (working.currentCardId !== card.id || working.currentCardToken === working.lastResolvedToken) {
      working = putCurrentCard(clearCurrentCard(working), card, "victory");
    }
    return { state: working, card: getCurrentCard(working, content), source: "victory" };
  }

  if (working.story?.pendingInterstitialBeatId) {
    return {
      state: { ...working, mode: "storyTransition" },
      card: null,
      source: "story-transition",
    };
  }

  while ((working.run.forcedCardQueue ?? []).length > 0) {
    const taken = takeQueueEntry(working, content);
    working = taken.state;
    const entry = taken.entry;
    if (
      entry &&
      typeof entry === "object" &&
      entry.beatLocal === true &&
      entry.originBeatId !== working.story?.currentBeatId
    ) {
      continue;
    }
    const presented = presentQueueEntry(working, entry, content, "forced");
    if (presented) return presented;
  }

  const arc = getCurrentArc(working, content.arcs);
  const beat = getCurrentBeat(working, arc);
  if (
    arc &&
    beat &&
    canAdvanceBeat(working, beat, {
      evaluateRequirements: requirementsMet,
      context: { items: content.items },
    })
  ) {
    const advanced = advanceBeat(working, arc, {
      evaluateRequirements: requirementsMet,
      context: { items: content.items },
    });
    if (advanced !== working) return getNextCard(updateMetaProgress(advanced, content), content);
  }

  const prepared = prepareStoryCard({ ...working, mode: "exploration" }, content);
  if (prepared) return prepared;
  const fallback = putCurrentCard(working, SAFE_STORY_FALLBACK, "safe-fallback");
  return { state: fallback, card: getCurrentCard(fallback, content), source: "safe-fallback" };
}

export function createGame(options = {}) {
  const content = normalizeContent(options.content ?? DEFAULT_CONTENT);
  const arcId = options.arcId ?? content.arcs[0]?.id ?? EMBER_CROWN_ARC.id;
  return getNextCard(
    createInitialState({ seed: options.seed, meta: options.meta, arcId }),
    content,
  );
}

export const newGame = createGame;

export function restartGame(state, options = {}) {
  const seed = normalizeSeed(
    options.seed ?? `${Date.now()}:${state.runSeed}:${state.decisionCount}`,
  );
  return createGame({
    seed,
    meta: state.meta,
    arcId: options.arcId ?? state.story?.arcId,
    content: options.content ?? DEFAULT_CONTENT,
  });
}

function resolveLoot(state, card, direction, content) {
  const item = createItemMap(content.items).get(card.itemId);
  if (!item) {
    return { state, resultText: "The strange object crumbles before it can be claimed." };
  }
  if (direction === "left" && item.type === "equipment") {
    const value = Math.max(0, Number(item.sellValue ?? 0));
    return {
      state: {
        ...state,
        player: { ...state.player, gold: state.player.gold + value },
        run: {
          ...state.run,
          goldEarned: Number(state.run.goldEarned ?? 0) + value,
        },
      },
      resultText: card.left.resultText,
    };
  }
  if (direction === "left" && item.type === "consumable") {
    return {
      state: applyEffects(state, item.useEffects ?? item.effects, content),
      resultText: card.left.resultText,
    };
  }
  return { state: addInventoryItem(state, item.id), resultText: card.right.resultText };
}

function markResolved(state, card) {
  const dynamic = card.id.startsWith("combat:") || card.id.startsWith("loot:");
  return {
    ...state,
    run: {
      ...state.run,
      resolvedCardIds: dynamic
        ? state.run.resolvedCardIds ?? []
        : addUnique(state.run.resolvedCardIds ?? [], card.id),
      resolvedOnceCards: card.oncePerRun
        ? addUnique(state.run.resolvedOnceCards ?? [], card.id)
        : state.run.resolvedOnceCards,
    },
    meta: {
      ...state.meta,
      discoveredCardIds: dynamic
        ? state.meta.discoveredCardIds ?? []
        : addUnique(state.meta.discoveredCardIds ?? [], card.id),
    },
  };
}

function feedbackTone({ after, before, card, combat }) {
  if (after.mode === "gameOver") return "death";
  if (after.mode === "victory" || after.story?.completed) return "victory";
  if (card.category === "levelUp") return "level-up";
  if (card.category === "loot") return "loot";
  if (combat?.enemyDefeated) return "reward";
  if (after.player.hp < before.player.hp) return "danger";
  return "neutral";
}

function splitContentAndOptions(contentInput, options) {
  if (
    contentInput &&
    !contentInput.cards &&
    (Object.prototype.hasOwnProperty.call(contentInput, "expectedToken") ||
      Object.prototype.hasOwnProperty.call(contentInput, "content"))
  ) {
    return {
      content: normalizeContent(contentInput.content ?? DEFAULT_CONTENT),
      options: contentInput,
    };
  }
  return { content: normalizeContent(contentInput ?? DEFAULT_CONTENT), options: options ?? {} };
}

/** Atomically resolve one binary decision and prepare its deterministic successor. */
export function resolveChoice(
  inputState,
  inputDirection,
  contentInput = DEFAULT_CONTENT,
  inputOptions = {},
) {
  const { content, options } = splitContentAndOptions(contentInput, inputOptions);
  const direction = normalizeDirection(inputDirection);
  if (!direction) {
    return {
      state: inputState,
      card: getCurrentCard(inputState, content),
      ignored: true,
      reason: "invalid-direction",
      changes: {},
    };
  }

  let prepared = inputState;
  let current = getCurrentCard(prepared, content);
  if (!current) {
    const next = getNextCard(prepared, content);
    prepared = next.state;
    current = next.card;
  }
  if (!current) {
    return { state: prepared, card: null, ignored: true, reason: "no-card", changes: {} };
  }

  const token = prepared.currentCardToken;
  if (
    (options.expectedToken && options.expectedToken !== token) ||
    (token && prepared.lastResolvedToken === token)
  ) {
    return {
      state: prepared,
      card: current,
      ignored: true,
      reason: "stale-resolution",
      changes: {},
    };
  }
  const choice = current[direction];
  if (!choice || !choiceIsAvailable(choice, prepared, { items: content.items })) {
    return {
      state: prepared,
      card: current,
      ignored: true,
      reason: "choice-unavailable",
      changes: {},
    };
  }

  const before = prepared;
  const resolvedMode = prepared.mode;
  if (["gameOver", "victory"].includes(resolvedMode)) {
    const selectedSeed =
      options.seed ??
      (direction === "right"
        ? prepared.runSeed
        : normalizeSeed(
            `${Date.now()}:${prepared.runSeed}:${prepared.meta.deathCount}:${prepared.meta.victoryCount}`,
          ));
    const restarted = restartGame(prepared, { seed: selectedSeed, content });
    return {
      ...restarted,
      resolvedCard: current,
      resultText: choice.resultText,
      changes: {},
      feedbackTone: resolvedMode === "victory" ? "victory" : "death",
    };
  }

  let working = clearCurrentCard(prepared, token);
  working = { ...working, decisionCount: working.decisionCount + 1 };
  working = markResolved(working, current);
  let resultText = choice.resultText ?? "";
  let combatResult = null;

  if (resolvedMode === "combat") {
    combatResult = resolveCombatChoice(working, direction, content.enemies, content.items);
    working = combatResult.state;
    resultText = combatResult.resultText ?? resultText;
  } else if (resolvedMode === "levelUp" || current.id === "level-up") {
    working = applyLevelUpChoice(working, direction, content.items);
  } else if (resolvedMode === "loot" || current.category === "loot") {
    const loot = resolveLoot(working, current, direction, content);
    working = loot.state;
    resultText = loot.resultText;
  } else {
    working = applyEffects(working, choice.effects, { ...content, currentCard: current });
    working = recordStoryCardResolution(working, current, choice);
    if (current.safeStoryFallback) {
      const arc = getCurrentArc(working, content.arcs);
      const beat = getCurrentBeat(working, arc);
      const atMaximum =
        beat && Number(working.story.cardsResolvedInBeat ?? 0) >= getBeatBudget(beat).maximum;
      if (arc && atMaximum) working = advanceBeat(working, arc, { force: true });
    } else {
      const arc = getCurrentArc(working, content.arcs);
      const beat = getCurrentBeat(working, arc);
      if (
        arc &&
        beat &&
        canAdvanceBeat(working, beat, {
          evaluateRequirements: requirementsMet,
          context: { items: content.items },
        })
      ) {
        working = advanceBeat(working, arc, {
          evaluateRequirements: requirementsMet,
          context: { items: content.items },
        });
      }
    }
  }

  working = updateMetaProgress(clampPlayerResources(working, content.items), content);
  const next = getNextCard(working, content);
  return {
    state: next.state,
    card: next.card,
    resolvedCard: current,
    resultText,
    changes: resourceChanges(before, next.state, content.items),
    feedbackTone: feedbackTone({ after: next.state, before, card: current, combat: combatResult }),
    combat: combatResult,
  };
}

export function dismissStoryTransition(state, contentInput = DEFAULT_CONTENT) {
  const content = normalizeContent(contentInput);
  const dismissed = updateMetaProgress(dismissBeatInterstitial(state), content);
  return getNextCard(dismissed, content);
}

export const dismissInterstitial = dismissStoryTransition;

export function equipInventoryItem(state, itemId, contentInput = DEFAULT_CONTENT) {
  const content = normalizeContent(contentInput);
  const nextState = equipItem(state, itemId, content.items);
  return {
    state: nextState,
    equipped: nextState !== state,
    changes: resourceChanges(state, nextState, content.items),
  };
}

export function useInventoryItem(state, itemId, contentInput = DEFAULT_CONTENT) {
  const content = normalizeContent(contentInput);
  const item = findItem(itemId, content.items);
  if (
    ["gameOver", "victory", "storyTransition"].includes(state.mode) ||
    !item ||
    item.type !== "consumable" ||
    !inventoryHasItem(state, itemId)
  ) {
    return {
      state,
      card: getCurrentCard(state, content),
      used: false,
      changes: {},
      resultText: "That item cannot be used.",
    };
  }

  const withoutItem = removeInventoryItem(state, itemId, 1);
  let nextState = applyEffects(withoutItem, item.useEffects ?? item.effects, content);
  const newlyForced =
    (nextState.run.forcedCardQueue?.length ?? 0) >
    (state.run.forcedCardQueue?.length ?? 0);
  if (nextState.player.hp <= 0 || newlyForced) {
    if (nextState.player.hp > 0 && nextState.currentCardData && nextState.mode !== "combat") {
      nextState = {
        ...nextState,
        run: {
          ...nextState.run,
          forcedCardQueue: [
            ...(nextState.run.forcedCardQueue ?? []),
            { card: nextState.currentCardData, resume: true },
          ],
        },
      };
    }
    nextState = clearCurrentCard(nextState);
  }
  const prepared = getNextCard(updateMetaProgress(nextState, content), content);
  return {
    state: prepared.state,
    card: prepared.card,
    used: true,
    changes: resourceChanges(state, prepared.state, content.items),
    resultText: `${item.name} takes effect.`,
  };
}

export { calculateStoryProgress, calculateStoryProgressPercent };
