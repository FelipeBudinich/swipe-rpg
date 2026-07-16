import { weightedChoice } from "../rng.js";
import { cardHasAvailableChoice, requirementsMet } from "./requirements.js";
import { getDerivedStats } from "./equipment.js";

export const BUILT_IN_FALLBACK_CARD = Object.freeze({
  id: "fallback-travel",
  category: "travel",
  speaker: "The Road Atlas",
  title: "An Unmarked Mile",
  text: "The path runs quiet between weathered stones.",
  artId: "scene-road",
  baseWeight: 0,
  cooldown: 0,
  oncePerRun: false,
  tags: ["travel", "peaceful", "fallback"],
  requirements: [],
  left: { label: "Keep low", resultText: "You pass the mile without incident.", effects: [] },
  right: { label: "Watch the horizon", resultText: "The horizon stays clear.", effects: [] },
});

export function isEncounterCard(card) {
  return card?.category === "encounter" || card?.tags?.includes("encounter");
}

export function isRecoveryCard(card) {
  return card?.category === "recovery" || card?.tags?.includes("recovery");
}

export function isSelectableStorylet(card) {
  if (!card || typeof card.id !== "string") return false;
  if (Number(card.baseWeight ?? 0) <= 0) return false;
  if (card.forcedOnly || card.system) return false;
  if (["levelUp", "gameOver", "victory", "combat", "combatReward", "loot"].includes(card.category)) return false;
  if (["death", "victory", "level-up", "boss-intro"].includes(card.id)) return false;
  // Authored fallback content is reserved for the deterministic fallback path.
  if (card.tags?.includes("fallback")) return false;
  return true;
}

function isOffCooldown(card, state) {
  const lastSeen = state.run.lastSeenTurnByCardId?.[card.id];
  if (!Number.isFinite(Number(lastSeen))) return true;
  const elapsed = state.decisionCount - Number(lastSeen);
  return elapsed > Math.max(0, Number(card.cooldown ?? 0));
}

function hasActiveFlagTag(card, state) {
  return (card.tags ?? []).some((tag) => {
    if (!tag.startsWith("flag:")) return false;
    const key = tag.slice(5);
    return Boolean(state.run.flags?.[key]);
  });
}

export function effectiveWeight(card, state, context = {}) {
  let weight = Math.max(0, Number(card.baseWeight ?? 0));
  const turns = Math.max(0, Number(state.run.turnsSinceEncounter ?? 0));
  const derived = context.derivedStats ?? getDerivedStats(state, context.items);
  const hpPercent = derived.maxHp > 0 ? state.player.hp / derived.maxHp : 1;

  if (isEncounterCard(card)) {
    weight *= 1 + turns * 0.45;
    const defeatedCount = Object.values(state.run.enemiesDefeated ?? {}).reduce(
      (total, value) => total + (Number(value) || 0),
      0,
    );
    const justFinishedCombat =
      turns === 0 &&
      (defeatedCount > 0 ||
        (state.run.lastCombatTurn !== null &&
          state.run.lastCombatTurn !== undefined &&
          Number.isFinite(Number(state.run.lastCombatTurn)) &&
          state.decisionCount - Number(state.run.lastCombatTurn) <= 1));
    if (justFinishedCombat) {
      weight *= 0.12;
    }
    if (turns >= 5) weight *= 30;
  }

  if (isRecoveryCard(card) && hpPercent < 0.5) {
    // Helpful, but intentionally not an automatic rescue.
    weight *= 1 + (0.5 - hpPercent) * 3;
  }
  if (hasActiveFlagTag(card, state)) weight *= 2.25;
  if (card.tags?.includes("active-flag")) weight *= 1.35;
  return weight;
}

export function getEligibleCards(state, cardDefinitions, context = {}) {
  const recent = new Set((state.run.recentCardIds ?? []).slice(-4));
  const firstWorldCard = Number(state.story?.totalWorldCardsResolved ?? 0) === 0;

  let eligible = (cardDefinitions ?? []).filter((card) => {
    if (!isSelectableStorylet(card)) return false;
    if (!requirementsMet(card.requirements, state, context)) return false;
    if (card.oncePerRun && state.run.resolvedOnceCards?.includes(card.id)) return false;
    if (!isOffCooldown(card, state)) return false;
    if (recent.has(card.id)) return false;
    if (firstWorldCard && isEncounterCard(card)) return false;
    if (!cardHasAvailableChoice(card, state, context)) return false;
    if (Number.isFinite(Number(card.minLevel)) && state.player.level < Number(card.minLevel)) {
      return false;
    }
    return true;
  });

  // Five peaceful resolutions put an eligible encounter at the head of the
  // pacing queue. If none is eligible, normal content remains available.
  if (Number(state.run.turnsSinceEncounter ?? 0) >= 5) {
    const encounters = eligible.filter(isEncounterCard);
    if (encounters.length > 0) eligible = encounters;
  }
  return eligible;
}

function recordSelection(state, card, rngState = state.rngState) {
  return {
    ...state,
    rngState,
    run: {
      ...state.run,
      recentCardIds: [...(state.run.recentCardIds ?? []), card.id].slice(-4),
      lastSeenTurnByCardId: {
        ...(state.run.lastSeenTurnByCardId ?? {}),
        [card.id]: state.decisionCount,
      },
    },
  };
}

/** Select, pace, and record one world card with seeded weighted randomness. */
export function selectExplorationCard(state, cardDefinitions, options = {}) {
  const context = { items: options.items, derivedStats: options.derivedStats };
  const eligible = getEligibleCards(state, cardDefinitions, context);
  if (eligible.length === 0) {
    const fallback =
      options.fallbackCard ??
      (cardDefinitions ?? []).find((card) => card.tags?.includes("fallback")) ??
      BUILT_IN_FALLBACK_CARD;
    return {
      card: fallback,
      state: recordSelection(state, fallback),
      candidates: [],
      source: "fallback",
    };
  }

  const weighted = eligible.map((card) => ({
    card,
    weight: effectiveWeight(card, state, context),
  }));
  const selected = weightedChoice(state.rngState, weighted);
  const card = selected.value?.card;
  if (!card) {
    const fallback = options.fallbackCard ?? BUILT_IN_FALLBACK_CARD;
    return {
      card: fallback,
      state: recordSelection(state, fallback),
      candidates: eligible,
      source: "fallback",
    };
  }

  return {
    card,
    state: recordSelection(state, card, selected.state),
    candidates: eligible,
    source: "weighted",
  };
}

export const selectCard = selectExplorationCard;
