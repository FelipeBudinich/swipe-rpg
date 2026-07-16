import { fileURLToPath } from "node:url";

import { itemById, items } from "../public/js/data/items.js";
import {
  createGame,
  equipInventoryItem,
  getNextCard,
  resolveChoice,
  useInventoryItem,
} from "../public/js/game/engine.js";
import { getDerivedStats } from "../public/js/game/equipment.js";

const MAX_DECISIONS = 240;

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
      (heals && state.player.hp <= stats.maxHp * 0.62) ||
      (restoresMp && !heals && state.player.mp <= stats.maxMp * 0.3);
    if (shouldUse) state = useInventoryItem(state, item.id).state;
  }

  return getNextCard(state).state;
}

function explorationScore(choice, state) {
  if (!choice || choice.disabled) return -Infinity;
  const stats = getDerivedStats(state, items);
  const missingHp = Math.max(0, stats.maxHp - state.player.hp);
  const missingMp = Math.max(0, stats.maxMp - state.player.mp);
  let score = 0;

  for (const effect of choice.effects ?? []) {
    const amount = Number(effect.amount ?? effect.value ?? 0);
    switch (effect.type) {
      case "heal":
        score += Math.min(missingHp, Math.max(0, amount)) * 5;
        break;
      case "healPercent": {
        const fraction = Number(effect.percent ?? effect.value ?? 0);
        score += Math.min(missingHp, Math.ceil(stats.maxHp * fraction)) * 5;
        break;
      }
      case "modifyHp":
        score += amount >= 0 ? Math.min(missingHp, amount) * 5 : amount * 8;
        if (state.player.hp + amount <= 0) score -= 1_000;
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
        score += 2;
        break;
      case "startEncounter":
        score += state.player.hp >= stats.maxHp * 0.65 ? 3 : -18;
        break;
      case "modifyJourneyStep":
        score += amount * 0.25;
        break;
      default:
        break;
    }
  }

  return score;
}

function chooseDirection(card, state) {
  if (card.category === "levelUp") return "left";
  if (card.id === "boss-intro") return "right";

  if (card.category === "loot") {
    const item = itemById[card.itemId];
    if (item?.type === "consumable") {
      const stats = getDerivedStats(state, items);
      const usefulNow =
        item.useEffects?.some((effect) => effect.type === "heal") &&
        state.player.hp < stats.maxHp;
      return usefulNow ? "left" : "right";
    }
    return "right";
  }

  if (card.category === "combat") {
    const intent = state.encounter?.currentIntent;
    if (intent === "opening") return card.right.disabled ? "left" : "right";
    if (intent === "charge") return "right";
    if (intent === "hesitate") {
      return state.player.mp < 3 && state.encounter.hp > 7 ? "left" : "right";
    }
    const strikeMax = Number(card.right?.estimate?.max ?? 0);
    return state.encounter.hp <= strikeMax ? "right" : "left";
  }

  const left = explorationScore(card.left, state);
  const right = explorationScore(card.right, state);
  return right > left ? "right" : "left";
}

export function simulateRun(seed, maxDecisions = MAX_DECISIONS) {
  let { state, card } = createGame({ seed });
  const transcript = [];

  while (state.mode !== "victory" && state.mode !== "gameOver" && state.decisionCount < maxDecisions) {
    state = prepareInventory(state);
    ({ card } = getNextCard(state));
    if (!card) break;
    const direction = chooseDirection(card, state);
    transcript.push({
      decision: state.decisionCount + 1,
      journeyStep: state.journeyStep,
      mode: state.mode,
      cardId: card.id,
      direction,
      hp: state.player.hp,
      mp: state.player.mp,
    });
    const result = resolveChoice(state, direction, { expectedToken: card.resolutionToken });
    if (result.ignored) break;
    state = result.state;
    card = result.card;
  }

  return { state, card, transcript };
}

export function auditSeeds(count = 128) {
  const runs = Array.from({ length: count }, (_, index) => simulateRun(index + 1));
  const victories = runs.filter((run) => run.state.mode === "victory");
  const deaths = runs.filter((run) => run.state.mode === "gameOver");
  const stalled = runs.filter((run) => !["victory", "gameOver"].includes(run.state.mode));
  return { runs, victories, deaths, stalled };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = Math.max(1, Number.parseInt(process.argv[2] ?? "128", 10) || 128);
  const audit = auditSeeds(count);
  const winner = audit.victories[0];
  const summary = {
    seeds: count,
    victories: audit.victories.length,
    deaths: audit.deaths.length,
    stalled: audit.stalled.length,
    firstWinningSeed: winner?.state.runSeed ?? null,
    winningDecisions: winner?.state.decisionCount ?? null,
    winningJourneyStep: winner?.state.journeyStep ?? null,
    winningLevel: winner?.state.player.level ?? null,
  };
  console.log(JSON.stringify(summary, null, 2));
}
