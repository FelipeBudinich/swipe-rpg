export const ARROW_DIRECTION_BY_KEY = Object.freeze({
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
});

export function directionForArrowKey(key) {
  return ARROW_DIRECTION_BY_KEY[key] ?? null;
}

/**
 * Build the one keyboard path used by the application.
 *
 * Availability is injected so the same domain predicate can govern buttons,
 * swipes, and keyboard arrows without this module knowing game state.
 */
export function createArrowKeyHandler({
  isInputBlocked = () => false,
  isEditableTarget = () => false,
  isDirectionAvailable = () => true,
  onChoose = () => {},
  onBlocked = () => {},
} = {}) {
  return (event) => {
    if (
      !event ||
      event.defaultPrevented ||
      event.repeat ||
      isInputBlocked() ||
      isEditableTarget(event.target)
    ) {
      return false;
    }

    const direction = directionForArrowKey(event.key);
    if (!direction) return false;
    event.preventDefault?.();

    if (!isDirectionAvailable(direction)) {
      onBlocked(direction);
      return false;
    }
    onChoose(direction);
    return true;
  };
}

/**
 * Build the delegated click path for the persistent four-button grid.
 *
 * Native-disabled buttons do not dispatch ordinary clicks, and the explicit
 * guards also protect synthetic/stale events before they can reach gameplay.
 */
export function createChoiceClickHandler({
  container,
  isInputBlocked = () => false,
  isDirectionAvailable = () => true,
  onChoose = () => {},
  onBlocked = () => {},
} = {}) {
  return (event) => {
    const button = event?.target?.closest?.("button[data-direction]") ?? null;
    if (
      !button ||
      button.disabled ||
      !container?.contains?.(button) ||
      isInputBlocked()
    ) {
      return false;
    }

    const direction = button.dataset?.direction;
    if (!isDirectionAvailable(direction)) {
      onBlocked(direction);
      return false;
    }
    onChoose(direction);
    return true;
  };
}
