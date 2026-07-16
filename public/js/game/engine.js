import { cards, cardById, fallbackCard } from "../data/cards.js";
import { enemies } from "../data/enemies.js";
import { items } from "../data/items.js";
import { normalizeSeed } from "../rng.js";
import { beginEncounter, getCombatCard, resolveCombatChoice } from "./combat.js";
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
import { selectExplorationCard } from "./selector.js";
import { BOSS_JOURNEY_STEP, createInitialState } from "./state.js";

export const DEFAULT_CONTENT = Object.freeze({ cards, cardById, fallbackCard, enemies, items });

const TERMINAL_CARDS = Object.freeze({
  death: {
    id: "death",
    category: "gameOver",
    speaker: "The Last Lantern",
    title: "Your Light Goes Out",
    text: "The road keeps the names and relics you discovered.",
    advanceJourney: false,
    left: { label: "Walk a new road", resultText: "A new lantern kindles.", effects: [] },
    right: { label: "Retry this road", resultText: "The same stars return.", effects: [] },
  },
  victory: {
    id: "victory",
    category: "victory",
    speaker: "The Open Gate",
    title: "Dawn Beyond the Ruins",
    text: "The final gate opens and the caravan crosses into dawn.",
    advanceJourney: false,
    left: { label: "Begin another journey", resultText: "A new road waits.", effects: [] },
    right: { label: "Trace the same stars", resultText: "The old stars return.", effects: [] },
  },
  levelUp: {
    id: "level-up",
    category: "levelUp",
    speaker: "The Road Within",
    title: "Choose What Grows",
    text: "Hard-won experience gathers into a new shape.",
    advanceJourney: false,
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
  },
  bossIntro: {
    id: "boss-intro",
    category: "encounter",
    speaker: "The Last Gate",
    title: "The Gatekeeper",
    text: "A great shadow bars the road. It cannot be left behind.",
    advanceJourney: false,
    left: { label: "Steady your breath", resultText: "You face the gatekeeper.", effects: [] },
    right: { label: "Raise your blade", resultText: "You face the gatekeeper.", effects: [] },
  },
});

function normalizeContent(content = DEFAULT_CONTENT) {
  const contentCards = content.cards ?? content.CARDS ?? cards;
  const contentEnemies = content.enemies ?? content.ENEMIES ?? enemies;
  const contentItems = content.items ?? content.ITEMS ?? items;
  const suppliedCardMap = content.cardById ?? content.CARD_BY_ID;
  const map =
    suppliedCardMap instanceof Map
      ? Object.fromEntries(suppliedCardMap)
      : suppliedCardMap ?? Object.fromEntries(contentCards.map((card) => [card.id, card]));
  return {
    cards: contentCards,
    cardById: map,
    fallbackCard:
      content.fallbackCard ?? contentCards.find((card) => card.tags?.includes("fallback")) ?? fallbackCard,
    enemies: contentEnemies,
    items: contentItems,
  };
}

function normalizeDirection(direction) {
  if (["left", "a", "ArrowLeft", -1].includes(direction)) return "left";
  if (["right", "d", "ArrowRight", 1].includes(direction)) return "right";
  return null;
}

function addUnique(list, id) {
  return list.includes(id) ? list : [...list, id];
}

function isPlayableCard(card) {
  const validChoice = (choice) =>
    Boolean(
      choice &&
      typeof choice.label === "string" &&
      (choice.effects === undefined || Array.isArray(choice.effects))
    );
  return Boolean(
    card &&
    typeof card.id === "string" &&
    validChoice(card.left) &&
    validChoice(card.right)
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
  const token = `${state.decisionCount}:${card.id}`;
  const withMode = withModeForCard(state, card);
  return {
    ...withMode,
    currentCardId: card.id,
    currentCardData: card,
    currentCardToken: token,
    currentCardSource: source,
  };
}

function clearCurrentCard(state, resolvedToken) {
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

function recordTerminal(state, terminal) {
  const isDeath = terminal === "death";
  const marker = isDeath ? "deathRecorded" : "victoryRecorded";
  const counter = isDeath ? "deathCount" : "victoryCount";
  if (state.run[marker]) {
    return { ...state, mode: isDeath ? "gameOver" : "victory", encounter: null };
  }
  return {
    ...state,
    mode: isDeath ? "gameOver" : "victory",
    encounter: null,
    run: { ...state.run, [marker]: true },
    meta: {
      ...state.meta,
      [counter]: Number(state.meta[counter] ?? 0) + 1,
      bestLevel: Math.max(Number(state.meta.bestLevel ?? 1), state.player.level),
      bestJourneyStep: Math.max(Number(state.meta.bestJourneyStep ?? 0), state.journeyStep),
    },
  };
}

function buildLootCard(item, { victoryAfter = false } = {}) {
  const equipment = item?.type === "equipment";
  return {
    id: `loot:${item?.id ?? "unknown"}`,
    category: "loot",
    speaker: "Victory Spoils",
    title: item?.name ?? "Unknown Relic",
    text: item?.description ?? "Something gleams among the fallen fragments.",
    artId: item?.artId ?? "item-unknown",
    itemId: item?.id ?? null,
    victoryAfter,
    advanceJourney: false,
    left: equipment
      ? {
          label: `Sell · +${item.sellValue ?? 0} gold`,
          resultText: `The relic joins a passing trader's pack for ${item.sellValue ?? 0} gold.`,
          preview: [{ resource: "gold", delta: item.sellValue ?? 0 }],
          effects: [],
        }
      : {
          label: "Use now",
          resultText: `${item?.name ?? "The item"} is used at once.`,
          preview: [],
          // Loot resolution owns execution, but exposing the declarative
          // effects lets the renderer announce exact HP/MP/XP tradeoffs.
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

function cardFromQueueEntry(entry, content) {
  if (isPlayableCard(entry?.card)) return entry.card;
  const cardId = typeof entry === "string" ? entry : entry?.cardId ?? entry?.id;
  if (cardId === "loot") {
    return buildLootCard(createItemMap(content.items).get(entry.itemId), {
      victoryAfter: entry.victoryAfter === true,
    });
  }
  return (
    content.cardById[cardId] ??
    (cardId === "level-up" ? TERMINAL_CARDS.levelUp : null) ??
    (cardId === "boss-intro" ? TERMINAL_CARDS.bossIntro : null)
  );
}

export function getCurrentCard(state, contentInput = DEFAULT_CONTENT) {
  if (!state?.currentCardId) return null;
  const content = normalizeContent(contentInput);
  let card;
  if (state.currentCardId.startsWith("combat:") && state.encounter) {
    card = getCombatCard(state, content.enemies, content.items);
  } else if (state.currentCardId.startsWith("loot:")) {
    const itemId = state.currentCardData?.itemId ?? state.currentCardId.slice(5);
    card = state.currentCardData ?? buildLootCard(createItemMap(content.items).get(itemId), {
      victoryAfter: state.run.bossVictoryPending === true,
    });
  } else {
    const savedCard = isPlayableCard(state.currentCardData) && state.currentCardData.id === state.currentCardId
      ? state.currentCardData
      : null;
    card = savedCard ?? content.cardById[state.currentCardId] ?? TERMINAL_CARDS[state.currentCardId];
  }
  return isPlayableCard(card) ? decorateCard(card, state, content) : null;
}

/**
 * Produce the next card using the documented priority. The function is
 * idempotent while a non-terminal current card is awaiting resolution.
 */
export function getNextCard(state, contentInput = DEFAULT_CONTENT) {
  const content = normalizeContent(contentInput);
  let working = clampPlayerResources(state, content.items);

  // Terminal rules outrank even a card that was previously on screen.
  if (working.player.hp <= 0) {
    working = recordTerminal(working, "death");
    const card = content.cardById.death ?? TERMINAL_CARDS.death;
    if (
      working.currentCardId !== card.id ||
      working.currentCardToken === working.lastResolvedToken
    ) {
      working = putCurrentCard(clearCurrentCard(working, null), card, "death");
    }
    return { state: working, card: getCurrentCard(working, content), source: "death" };
  }
  if (working.run.bossDefeated) {
    working = recordTerminal(working, "victory");
    const card = content.cardById.victory ?? TERMINAL_CARDS.victory;
    if (
      working.currentCardId !== card.id ||
      working.currentCardToken === working.lastResolvedToken
    ) {
      working = putCurrentCard(clearCurrentCard(working, null), card, "victory");
    }
    return { state: working, card: getCurrentCard(working, content), source: "victory" };
  }

  const current = getCurrentCard(working, content);
  if (
    current &&
    working.currentCardToken !== working.lastResolvedToken &&
    requirementsMet(current.requirements, working, { items: content.items }) &&
    cardHasAvailableChoice(current, working, { items: content.items })
  ) {
    return { state: working, card: current, source: working.currentCardSource ?? "current" };
  }
  if (current) working = clearCurrentCard(working, null);

  // Invalid stale queue entries are discarded without consuming a decision or
  // random number, allowing the next valid forced card to proceed.
  while ((working.run.forcedCardQueue ?? []).length > 0) {
    const [entry, ...rest] = working.run.forcedCardQueue;
    working = { ...working, run: { ...working.run, forcedCardQueue: rest } };
    const forced = cardFromQueueEntry(entry, content);
    if (!forced) continue;
    const forcedModeState = withModeForCard(working, forced);
    if (
      !requirementsMet(forced.requirements, forcedModeState, { items: content.items }) ||
      !cardHasAvailableChoice(forced, forcedModeState, { items: content.items })
    ) {
      continue;
    }
    working = putCurrentCard(working, forced, "forced");
    return { state: working, card: getCurrentCard(working, content), source: "forced" };
  }

  // A corrupted save must not replay the boss forever if its pending reward
  // card disappeared. Normal runs clear this marker when that loot resolves.
  if (working.run.bossVictoryPending) {
    working = {
      ...working,
      run: { ...working.run, bossVictoryPending: false, bossDefeated: true },
    };
    return getNextCard(working, content);
  }

  if (working.encounter) {
    working = { ...working, mode: "combat" };
    const combatCard = getCombatCard(working, content.enemies, content.items);
    if (combatCard) {
      working = putCurrentCard(working, combatCard, "combat");
      return { state: working, card: getCurrentCard(working, content), source: "combat" };
    }
    // Removed or corrupted enemy IDs must not leave a ghost encounter that
    // suppresses world pacing forever.
    working = { ...working, encounter: null, mode: "exploration" };
  }

  if (working.journeyStep >= BOSS_JOURNEY_STEP && !working.run.bossDefeated) {
    working = { ...working, mode: "exploration", run: { ...working.run, bossQueued: true } };
    const bossIntro = content.cardById["boss-intro"] ?? TERMINAL_CARDS.bossIntro;
    working = putCurrentCard(working, bossIntro, "boss");
    return { state: working, card: getCurrentCard(working, content), source: "boss" };
  }

  working = { ...working, mode: "exploration" };
  const selected = selectExplorationCard(working, content.cards, {
    fallbackCard: content.fallbackCard,
    items: content.items,
  });
  working = putCurrentCard(selected.state, selected.card, selected.source);
  return { state: working, card: getCurrentCard(working, content), source: selected.source };
}

export function createGame(options = {}) {
  const content = normalizeContent(options.content ?? DEFAULT_CONTENT);
  return getNextCard(createInitialState({ seed: options.seed, meta: options.meta }), content);
}

export const newGame = createGame;

export function restartGame(state, options = {}) {
  const seed = normalizeSeed(options.seed ?? `${Date.now()}:${state.runSeed}:${state.decisionCount}`);
  return createGame({ seed, meta: state.meta, content: options.content ?? DEFAULT_CONTENT });
}

function resolveLoot(state, card, direction, content) {
  const item = createItemMap(content.items).get(card.itemId);
  if (!item) return { state, resultText: "The strange object crumbles before it can be claimed." };

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

  return {
    state: addInventoryItem(state, item.id),
    resultText: card.right.resultText,
  };
}

function markResolved(state, card) {
  const isDynamic = card.id.startsWith("combat:") || card.id.startsWith("loot:");
  return {
    ...state,
    run: {
      ...state.run,
      resolvedCardIds: isDynamic
        ? state.run.resolvedCardIds ?? []
        : addUnique(state.run.resolvedCardIds ?? [], card.id),
      resolvedOnceCards: card.oncePerRun
        ? addUnique(state.run.resolvedOnceCards ?? [], card.id)
        : state.run.resolvedOnceCards,
    },
    meta: {
      ...state.meta,
      discoveredCardIds: isDynamic
        ? state.meta.discoveredCardIds ?? []
        : addUnique(state.meta.discoveredCardIds ?? [], card.id),
    },
  };
}

function shouldAdvanceJourney(card, mode) {
  if (mode !== "exploration") return false;
  if (["boss-intro", "death", "victory", "level-up"].includes(card.id)) return false;
  return card.advanceJourney !== false && card.advancesJourney !== false;
}

function feedbackTone({ after, before, resolvedCard, combatResult }) {
  if (after.mode === "gameOver") return "death";
  if (after.mode === "victory" || after.run.bossDefeated) return "victory";
  if (resolvedCard.category === "levelUp") return "level-up";
  if (resolvedCard.category === "loot") return "loot";
  if (combatResult?.enemyDefeated) return "reward";
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

/** Atomically resolve one visible card and immediately prepare its successor. */
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

  // Death/victory cards restart while preserving meta discovery. Right repeats
  // the run seed; left creates a fresh seed unless a test/UI supplies one.
  if (["gameOver", "victory"].includes(resolvedMode)) {
    const selectedSeed =
      options.seed ??
      (direction === "right"
        ? prepared.runSeed
        : normalizeSeed(`${Date.now()}:${prepared.runSeed}:${prepared.meta.deathCount}:${prepared.meta.victoryCount}`));
    const restarted = restartGame(prepared, { seed: selectedSeed, content });
    return {
      ...restarted,
      resolvedCard: current,
      resultText: choice.resultText,
      changes: resourceChanges(before, restarted.state, content.items),
      feedbackTone: resolvedMode === "victory" ? "victory" : "death",
    };
  }

  let working = clearCurrentCard(prepared, token);
  working = { ...working, decisionCount: working.decisionCount + 1 };
  if (shouldAdvanceJourney(current, resolvedMode)) {
    working = { ...working, journeyStep: working.journeyStep + 1 };
  }
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
    const lootResult = resolveLoot(working, current, direction, content);
    working = lootResult.state;
    resultText = lootResult.resultText;
    if (current.victoryAfter === true) {
      working = {
        ...working,
        run: {
          ...working.run,
          bossVictoryPending: false,
          bossDefeated: true,
        },
      };
    }
  } else {
    working = applyEffects(working, choice.effects, content);

    if (current.id === "boss-intro" && !working.encounter && !working.run.bossDefeated) {
      const boss = content.enemies.find((enemy) => enemy.isBoss) ?? content.enemies.find((enemy) => enemy.id === "ashen-wyrm");
      working = beginEncounter(working, boss, content.enemies);
    }

    if (current.category === "encounter" || working.encounter) {
      working = { ...working, run: { ...working.run, turnsSinceEncounter: 0 } };
    } else {
      working = {
        ...working,
        run: {
          ...working.run,
          turnsSinceEncounter: Number(working.run.turnsSinceEncounter ?? 0) + 1,
        },
      };
    }
  }

  working = clampPlayerResources(working, content.items);
  working = {
    ...working,
    meta: {
      ...working.meta,
      bestLevel: Math.max(Number(working.meta.bestLevel ?? 1), working.player.level),
      bestJourneyStep: Math.max(Number(working.meta.bestJourneyStep ?? 0), working.journeyStep),
    },
  };

  const next = getNextCard(working, content);
  return {
    state: next.state,
    card: next.card,
    resolvedCard: current,
    resultText,
    changes: resourceChanges(before, next.state, content.items),
    feedbackTone: feedbackTone({ after: next.state, before, resolvedCard: current, combatResult }),
    combat: combatResult,
  };
}

/** Inventory mutations use the same pure result shape as card resolution. */
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
    ["gameOver", "victory"].includes(state.mode) ||
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
    // A world card interrupted by an inventory-triggered level-up returns
    // immediately after the new forced cards; no decision or journey step is
    // consumed. Combat cards are derived again from the unchanged encounter.
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
    nextState = clearCurrentCard(nextState, null);
  }

  const prepared = getNextCard(nextState, content);
  return {
    state: prepared.state,
    card: prepared.card,
    used: true,
    changes: resourceChanges(state, prepared.state, content.items),
    resultText: `${item.name} takes effect.`,
  };
}
