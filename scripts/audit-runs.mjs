import { fileURLToPath } from "node:url";

import { itemById, items } from "../public/js/data/items.js";
import {
  createGame,
  dismissStoryTransition,
  equipInventoryItem,
  getNextCard,
  resolveChoice,
  useInventoryItem,
} from "../public/js/game/engine.js";
import { getDerivedStats } from "../public/js/game/equipment.js";

const MAX_DECISIONS = 320;
const STRUCTURAL_STAT_VALUE = 999;

function equipmentValue(item) {
  const stats = item?.statModifiers ?? {};
  return (
    Number(stats.attack ?? 0) * 3 +
    Number(stats.defense ?? 0) * 3.5 +
    Number(stats.maxHp ?? 0) * 0.45 +
    Number(stats.maxMp ?? 0) * 0.3
  );
}

function prepareInventory(inputState) {
  let state = inputState;

  for (const itemId of [...(state.player.inventory ?? [])]) {
    const item = itemById[typeof itemId === "string" ? itemId : itemId?.id];
    if (!item || item.type !== "equipment") continue;
    const equipped = itemById[state.player.equipment?.[item.slot]];
    if (equipmentValue(item) <= equipmentValue(equipped)) continue;
    state = equipInventoryItem(state, item.id).state;
  }

  const stats = getDerivedStats(state, items);
  for (const itemId of [...(state.player.inventory ?? [])]) {
    const item = itemById[typeof itemId === "string" ? itemId : itemId?.id];
    if (!item || item.type !== "consumable") continue;
    const effects = item.useEffects ?? [];
    const heals = effects.some((effect) => ["heal", "healPercent"].includes(effect.type));
    const restoresMp = effects.some((effect) => effect.type === "restoreMp");
    const shouldUse =
      (heals && state.player.hp <= stats.maxHp * 0.68) ||
      (restoresMp && !heals && state.player.mp <= stats.maxMp * 0.3);
    if (shouldUse) state = useInventoryItem(state, item.id).state;
  }

  return getNextCard(state).state;
}

function numericEffectValue(effect) {
  const value = Number(effect?.amount ?? effect?.value ?? effect?.damage ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function explorationScore(choice, state) {
  if (!choice || choice.disabled) return -Infinity;
  const stats = getDerivedStats(state, items);
  const missingHp = Math.max(0, stats.maxHp - state.player.hp);
  const missingMp = Math.max(0, stats.maxMp - state.player.mp);
  let score = 0;

  for (const effect of choice.effects ?? []) {
    const amount = numericEffectValue(effect);
    switch (effect.type) {
      case "heal":
        score += Math.min(missingHp, Math.max(0, amount)) * 5;
        break;
      case "healPercent": {
        const raw = Number(effect.percent ?? effect.value ?? 0);
        const fraction = raw > 1 ? raw / 100 : raw;
        score += Math.min(missingHp, Math.ceil(stats.maxHp * fraction)) * 5;
        break;
      }
      case "modifyHp":
        score += amount >= 0 ? Math.min(missingHp, amount) * 5 : amount * 8;
        if (state.player.hp + amount <= 0) score -= 1_000;
        break;
      case "boundedHpLoss":
      case "applyBoundedHpLoss":
        score -= Math.abs(amount) * 6;
        break;
      case "restoreMp":
        score += Math.min(missingMp, Math.max(0, amount)) * 1.3;
        break;
      case "modifyMp":
        score += amount >= 0 ? Math.min(missingMp, amount) * 1.3 : amount * 0.8;
        break;
      case "modifyGold":
        score += amount * (amount >= 0 ? 0.45 : 0.65);
        break;
      case "addXp":
        score += amount * 0.9;
        break;
      case "addItem":
        score += 9;
        break;
      case "recordDiscovery":
      case "setFlag":
      case "setStoryFact":
      case "recordStoryTag":
      case "setFinalPlan":
        score += 2;
        break;
      case "startEncounter":
      case "startStoryEncounter":
        score += state.player.hp >= stats.maxHp * 0.68 ? 3 : -18;
        break;
      default:
        break;
    }
  }

  return score;
}

function chooseDirection(card, state, options = {}) {
  if (card.id === "finale-fate-of-the-crown") {
    return options.endingId === "unbound-flame" ? "right" : "left";
  }
  if (card.category === "levelUp") return "left";

  if (card.category === "loot") {
    const item = itemById[card.itemId];
    if (item?.type === "consumable") {
      const stats = getDerivedStats(state, items);
      const usefulNow =
        item.useEffects?.some((effect) => ["heal", "healPercent"].includes(effect.type)) &&
        state.player.hp < stats.maxHp;
      return usefulNow ? "left" : "right";
    }
    return "right";
  }

  if (card.category === "combat") {
    if (options.mode === "structural") return card.left.disabled ? "right" : "left";
    const intent = state.encounter?.currentIntent;
    if (intent === "opening") return card.right.disabled ? "left" : "right";
    if (intent === "charge") return "right";
    if (intent === "hesitate") {
      return state.player.mp < 3 && state.encounter.hp > 7 ? "left" : "right";
    }
    const strikeMax = Number(card.right?.estimate?.max ?? 0);
    return state.encounter.hp <= strikeMax && !card.right.disabled ? "right" : "left";
  }

  const left = explorationScore(card.left, state);
  const right = explorationScore(card.right, state);
  return right > left ? "right" : "left";
}

function boostStructuralState(state) {
  return {
    ...state,
    player: {
      ...state.player,
      hp: STRUCTURAL_STAT_VALUE,
      mp: STRUCTURAL_STAT_VALUE,
      gold: Math.max(STRUCTURAL_STAT_VALUE, Number(state.player.gold ?? 0)),
      baseStats: {
        ...state.player.baseStats,
        attack: STRUCTURAL_STAT_VALUE,
        defense: STRUCTURAL_STAT_VALUE,
        maxHp: STRUCTURAL_STAT_VALUE,
        maxMp: STRUCTURAL_STAT_VALUE,
      },
    },
  };
}

function normalizeSimulationArguments(maxDecisions, options) {
  if (maxDecisions && typeof maxDecisions === "object") {
    return { maxDecisions: MAX_DECISIONS, options: maxDecisions };
  }
  return {
    maxDecisions: Math.max(1, Number(maxDecisions) || MAX_DECISIONS),
    options: options ?? {},
  };
}

/**
 * Deterministically play one arc. Ordinary mode uses only authored resources;
 * structural mode boosts combat stats so the audit can inspect the complete
 * narrative graph independently of roguelite combat survival.
 */
export function simulateRun(seed, maxDecisions = MAX_DECISIONS, inputOptions = {}) {
  const normalized = normalizeSimulationArguments(maxDecisions, inputOptions);
  const options = normalized.options;
  const structural = options.mode === "structural" || options.boosted === true;
  let { state, card } = createGame({ seed });
  const transcript = [];
  let stallReason = null;
  let safetySteps = 0;

  while (
    !["victory", "gameOver"].includes(state.mode) &&
    state.decisionCount < normalized.maxDecisions &&
    safetySteps < normalized.maxDecisions * 4
  ) {
    safetySteps += 1;
    if (state.mode === "storyTransition" || state.story?.pendingInterstitialBeatId) {
      transcript.push({
        kind: "transition",
        decision: state.decisionCount,
        beatId: state.story?.currentBeatId ?? null,
        beatIndex: state.story?.currentBeatIndex ?? null,
        cardId: null,
        source: "story-transition",
      });
      ({ state, card } = dismissStoryTransition(state));
      continue;
    }

    state = structural ? boostStructuralState(state) : prepareInventory(state);
    const next = getNextCard(state);
    state = next.state;
    card = next.card;
    if (state.mode === "storyTransition" || state.story?.pendingInterstitialBeatId) continue;
    if (!card) {
      stallReason = "no-card";
      break;
    }

    const direction = chooseDirection(card, state, {
      ...options,
      mode: structural ? "structural" : "ordinary",
    });
    transcript.push({
      kind: "decision",
      decision: state.decisionCount + 1,
      beatId: state.story?.currentBeatId ?? null,
      beatIndex: state.story?.currentBeatIndex ?? null,
      worldCardsResolved: state.story?.totalWorldCardsResolved ?? 0,
      mode: state.mode,
      cardId: card.id,
      source: state.currentCardSource ?? next.source ?? null,
      enemyId: state.encounter?.enemyId ?? null,
      direction,
      hp: state.player.hp,
      mp: state.player.mp,
    });
    const result = resolveChoice(state, direction, {
      expectedToken: card.resolutionToken,
    });
    if (result.ignored) {
      stallReason = result.reason ?? "ignored-choice";
      break;
    }
    state = result.state;
    card = result.card;
  }

  if (
    !stallReason &&
    !["victory", "gameOver"].includes(state.mode)
  ) {
    stallReason = state.decisionCount >= normalized.maxDecisions ? "decision-limit" : "safety-limit";
  }
  return { state, card, transcript, stallReason, mode: structural ? "structural" : "ordinary" };
}

export function simulateStructuralRun(seed, endingId = "crown-of-dawn", maxDecisions = MAX_DECISIONS) {
  return simulateRun(seed, maxDecisions, { mode: "structural", endingId });
}

export function auditSeeds(count = 128, options = {}) {
  const runs = Array.from({ length: count }, (_, index) =>
    simulateRun(index + 1, options.maxDecisions ?? MAX_DECISIONS, options),
  );
  const victories = runs.filter((run) => run.state.mode === "victory");
  const deaths = runs.filter((run) => run.state.mode === "gameOver");
  const stalled = runs.filter((run) => !["victory", "gameOver"].includes(run.state.mode));
  return { runs, victories, deaths, stalled };
}

export function auditStructuralSeeds(specifications = [
  { seed: 101, endingId: "crown-of-dawn" },
  { seed: 202, endingId: "unbound-flame" },
]) {
  return specifications.map(({ seed, endingId }) => ({
    seed,
    endingId,
    run: simulateStructuralRun(seed, endingId),
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = Math.max(1, Number.parseInt(process.argv[2] ?? "128", 10) || 128);
  const audit = auditSeeds(count);
  const structural = auditStructuralSeeds();
  const summary = {
    seeds: count,
    victories: audit.victories.length,
    deaths: audit.deaths.length,
    stalled: audit.stalled.length,
    structural: structural.map(({ seed, endingId, run }) => ({
      seed,
      endingId,
      result: run.state.mode,
      worldCardsResolved: run.state.story?.totalWorldCardsResolved ?? null,
      finalLevel: run.state.player.level,
      stallReason: run.stallReason,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}
