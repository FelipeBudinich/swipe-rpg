import { DEEP_SOUTH_STORY } from "../data/deep-south.js";
import { planDirection } from "./direction-plan.js";

/**
 * Shared direction availability for the engine, renderer, keyboard, and
 * pointer input. The returned object is the canonical direction plan.
 */
export function getDirectionAvailability(
  state,
  card,
  direction,
  story = DEEP_SOUTH_STORY,
) {
  return planDirection(state, card, direction, story);
}

export function canChooseDirection(
  state,
  card,
  direction,
  story = DEEP_SOUTH_STORY,
) {
  return planDirection(state, card, direction, story).available;
}

export { planDirection };
