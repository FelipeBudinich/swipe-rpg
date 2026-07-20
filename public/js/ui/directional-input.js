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
 * Availability is injected so the same domain predicate can govern swipes
 * and keyboard arrows without this module knowing game state.
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
