import { applyResourceEffects, normalizeResources } from "./effects.js";

export const CHOICE_COST_KEYS = Object.freeze([
  "crew",
  "eldritchLore",
]);

export const CHOICE_COST_LABELS = Object.freeze({
  crew: "Crew",
  eldritchLore: "Eldritch Lore",
});

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function normalizeChoiceCosts(value) {
  const source = asRecord(value);
  return Object.fromEntries(
    CHOICE_COST_KEYS.flatMap((key) => {
      const cost = positiveInteger(source[key]);
      return cost > 0 ? [[key, cost]] : [];
    }),
  );
}

function formatCosts(costs, prefix) {
  const entries = CHOICE_COST_KEYS
    .filter((key) => Number(costs[key]) > 0)
    .map((key) => `${costs[key]} ${CHOICE_COST_LABELS[key]}`);
  if (entries.length === 0) return "";
  return `${prefix} ${entries.join(" and ")}.`;
}

export function getChoiceAvailability(state, choice) {
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    return {
      available: false,
      reason: "choice-unavailable",
      requirementText: "No action is available in this direction.",
      costs: {},
      shortfalls: {},
    };
  }

  const costs = normalizeChoiceCosts(choice.costs);
  const resources = normalizeResources(state?.resources);
  const shortfalls = Object.fromEntries(
    CHOICE_COST_KEYS.flatMap((key) => {
      const shortfall = Math.max(0, Number(costs[key] ?? 0) - resources[key]);
      return shortfall > 0 ? [[key, shortfall]] : [];
    }),
  );
  const available = Object.keys(shortfalls).length === 0;
  return {
    available,
    reason: available ? null : "insufficient-resources",
    requirementText: formatCosts(
      costs,
      available ? "Costs" : "Requires",
    ),
    costs,
    shortfalls,
  };
}

export function getDirectionAvailability(state, card, direction) {
  const choice = card?.choices?.[direction];
  return {
    direction,
    choice: choice ?? null,
    ...getChoiceAvailability(state, choice),
  };
}

export function canChooseDirection(state, card, direction) {
  return getDirectionAvailability(state, card, direction).available;
}

/**
 * Deduct an available choice's explicit Crew/Lore costs exactly once.
 * Sanity and unknown keys are never treated as affordability costs.
 */
export function applyChoiceCosts(state, choice) {
  const availability = getChoiceAvailability(state, choice);
  if (!availability.available) {
    return {
      state,
      changes: {},
      ...availability,
    };
  }
  const costEffects = Object.fromEntries(
    Object.entries(availability.costs).map(([key, cost]) => [key, -cost]),
  );
  const applied = applyResourceEffects(state, costEffects);
  return {
    ...applied,
    ...availability,
  };
}
