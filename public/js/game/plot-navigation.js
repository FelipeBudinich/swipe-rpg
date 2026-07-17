export const PLOT_DIRECTIONS = Object.freeze([
  "up",
  "down",
  "left",
  "right",
]);

const PLOT_DIRECTION_SET = new Set(PLOT_DIRECTIONS);

/**
 * Derive one plot destination from the canonical ordered deck list.
 *
 * Both live resolution and persisted-feedback validation use this helper so a
 * save payload cannot encode a route the engine itself would never produce.
 */
export function getPlotDestinationDeckId(decks, currentDeckId, direction) {
  const plotDecks = (Array.isArray(decks) ? decks : []).filter(
    (deck) => deck?.type === "plot",
  );
  const index = plotDecks.findIndex((deck) => deck?.id === currentDeckId);
  if (index < 0 || !PLOT_DIRECTION_SET.has(direction)) return null;
  if (direction === "up") return plotDecks[Math.max(0, index - 1)]?.id ?? null;
  if (direction === "down") {
    return plotDecks[Math.min(plotDecks.length - 1, index + 1)]?.id ?? null;
  }
  return plotDecks[index]?.id ?? null;
}
