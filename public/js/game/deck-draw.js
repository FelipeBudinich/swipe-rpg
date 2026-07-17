import { normalizeSeed, randomInt } from "../rng.js";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cardId(value) {
  const id = typeof value === "string" ? value : value?.id;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

function uniqueCardIds(cards) {
  const seen = new Set();
  const ids = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const id = cardId(card);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizedPile(value, allowedIds, excludedIds = new Set()) {
  const seen = new Set(excludedIds);
  const pile = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const id = cardId(entry);
    if (!id || (allowedIds && !allowedIds.has(id)) || seen.has(id)) continue;
    seen.add(id);
    pile.push(id);
  }
  return pile;
}

function shuffle(cardIds, rngState) {
  const cards = [...cardIds];
  let state = normalizeSeed(rngState);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const selected = randomInt(state, 0, index);
    state = selected.state;
    [cards[index], cards[selected.value]] = [cards[selected.value], cards[index]];
  }
  return { cards, rngState: state };
}

function avoidFirstRepeat(drawPile, avoidCardId) {
  if (!avoidCardId || drawPile.length < 2 || drawPile[0] !== avoidCardId) {
    return drawPile;
  }
  const alternativeIndex = drawPile.findIndex((id) => id !== avoidCardId);
  if (alternativeIndex <= 0) return drawPile;
  const adjusted = [...drawPile];
  [adjusted[0], adjusted[alternativeIndex]] = [adjusted[alternativeIndex], adjusted[0]];
  return adjusted;
}

export function createDeckDrawState() {
  return {
    drawPile: [],
    discardPile: [],
    lastResolvedCardId: null,
  };
}

export function normalizeDeckDrawState(value, cards) {
  const source = asRecord(value);
  const ids = cards === undefined ? null : uniqueCardIds(cards);
  const allowedIds = ids === null ? null : new Set(ids);
  const drawPile = normalizedPile(source.drawPile, allowedIds);
  const discardPile = normalizedPile(source.discardPile, allowedIds, new Set(drawPile));
  const lastResolvedCardId = cardId(source.lastResolvedCardId);
  return {
    drawPile,
    discardPile,
    lastResolvedCardId:
      lastResolvedCardId && (!allowedIds || allowedIds.has(lastResolvedCardId))
        ? lastResolvedCardId
        : null,
  };
}

export function createDrawStateByDeck(decks) {
  return Object.fromEntries(
    (Array.isArray(decks) ? decks : [])
      .filter((deck) => deck?.type === "plot" && cardId(deck))
      .map((deck) => [deck.id, createDeckDrawState()]),
  );
}

export function normalizeDrawStateByDeck(value, decks) {
  const source = asRecord(value);
  return Object.fromEntries(
    (Array.isArray(decks) ? decks : [])
      .filter((deck) => deck?.type === "plot" && cardId(deck))
      .map((deck) => [
        deck.id,
        normalizeDeckDrawState(source[deck.id], deck.cards),
      ]),
  );
}

/**
 * Record a resolved card in its source deck without mutating either argument.
 */
export function discardToDeck(drawState, resolvedCardId, cards) {
  const normalized = normalizeDeckDrawState(drawState, cards);
  const id = cardId(resolvedCardId);
  const allowedIds = cards === undefined ? null : new Set(uniqueCardIds(cards));
  if (!id || (allowedIds && !allowedIds.has(id))) return normalized;
  return {
    drawPile: normalized.drawPile.filter((entry) => entry !== id),
    discardPile: [
      ...normalized.discardPile.filter((entry) => entry !== id),
      id,
    ],
    lastResolvedCardId: id,
  };
}

/**
 * Draw one card without replacement.
 *
 * A fresh state lazily shuffles every supplied card. Once its draw pile is
 * exhausted, only its discard pile is reshuffled. The returned RNG state is
 * the sole source of randomness and is safe to persist.
 */
export function drawFromDeck(
  drawState,
  cards,
  rngState,
  { avoidCardId } = {},
) {
  const ids = uniqueCardIds(cards);
  let normalized = normalizeDeckDrawState(drawState, ids);
  let nextRngState = normalizeSeed(rngState);
  if (ids.length === 0) {
    return { cardId: null, drawState: normalized, rngState: nextRngState };
  }

  let drawPile = [...normalized.drawPile];
  let discardPile = [...normalized.discardPile];
  if (drawPile.length === 0) {
    const refill = discardPile.length > 0 ? discardPile : ids;
    const shuffled = shuffle(refill, nextRngState);
    drawPile = shuffled.cards;
    nextRngState = shuffled.rngState;
    discardPile = [];
  }

  drawPile = avoidFirstRepeat(
    drawPile,
    cardId(avoidCardId) ?? normalized.lastResolvedCardId,
  );
  const [drawnCardId, ...remaining] = drawPile;
  normalized = {
    drawPile: remaining,
    discardPile,
    lastResolvedCardId: normalized.lastResolvedCardId,
  };
  return {
    cardId: drawnCardId ?? null,
    drawState: normalized,
    rngState: nextRngState,
  };
}
