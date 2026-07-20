import {
  applyResourceEffects,
  normalizeResourceEffects,
  normalizeResources,
  RESOURCE_KEYS,
} from "./effects.js";
import { normalizeDeckDrawState } from "./deck-draw.js";

export const KNOWN_DISCOVERY_IDS = Object.freeze([
  "fatherDiaryReverse",
]);

const RESOURCE_LABELS = Object.freeze({
  eldritchLore: "Eldritch Lore",
  crew: "Crew",
  sanity: "Sanity",
});

const AFFORDABILITY_RESOURCE_IDS = Object.freeze([
  "crew",
  "eldritchLore",
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function storyDecks(story) {
  return Array.isArray(story?.decks) ? story.decks : [];
}

function cardId(value) {
  const id = typeof value === "string" ? value : value?.id;
  return nonemptyString(id) ? id : null;
}

function authoredCardIds(deck) {
  return (Array.isArray(deck?.cards) ? deck.cards : [])
    .map(cardId)
    .filter(Boolean);
}

function initiallyAvailableCardIds(deck) {
  return (Array.isArray(deck?.cards) ? deck.cards : [])
    .filter((card) => card?.initiallyAvailable !== false)
    .map(cardId)
    .filter(Boolean);
}

function uniqueStrings(value, allowed = null) {
  const seen = new Set();
  const values = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!nonemptyString(entry) || seen.has(entry)) continue;
    if (allowed && !allowed.has(entry)) continue;
    seen.add(entry);
    values.push(entry);
  }
  return values;
}

export function createInitialUnlockedCardIdsByDeck(story) {
  return Object.fromEntries(
    storyDecks(story)
      .filter((deck) => deck?.type === "plot" && nonemptyString(deck.id))
      .map((deck) => [deck.id, initiallyAvailableCardIds(deck)]),
  );
}

export function normalizeUnlockedCardIdsByDeck(
  value,
  story,
  { unlockAll = false } = {},
) {
  const source = asRecord(value);
  return Object.fromEntries(
    storyDecks(story)
      .filter((deck) => deck?.type === "plot" && nonemptyString(deck.id))
      .map((deck) => {
        const initialIds = initiallyAvailableCardIds(deck);
        const allowedIds = authoredCardIds(deck);
        const requested = new Set(
          unlockAll
            ? allowedIds
            : [...initialIds, ...uniqueStrings(source[deck.id])],
        );
        return [
          deck.id,
          allowedIds.filter((id) => requested.has(id)),
        ];
      }),
  );
}

export function unlockedCardsForDeck(state, deck) {
  const unlockedIds = new Set(
    Array.isArray(state?.unlockedCardIdsByDeck?.[deck?.id])
      ? state.unlockedCardIdsByDeck[deck.id]
      : initiallyAvailableCardIds(deck),
  );
  return (Array.isArray(deck?.cards) ? deck.cards : []).filter(
    (card) => unlockedIds.has(cardId(card)),
  );
}

export function normalizeRevealedCardIds(value, story) {
  const allowedIds = new Set(
    storyDecks(story).flatMap((deck) =>
      (Array.isArray(deck?.cards) ? deck.cards : [])
        .filter((card) => card?.faces?.front && card?.faces?.back)
        .map(cardId)
        .filter(Boolean),
    ),
  );
  return uniqueStrings(value, allowedIds);
}

function normalizedAddCards(value, story) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const deckById = new Map(
    storyDecks(story)
      .filter((deck) => nonemptyString(deck?.id))
      .map((deck) => [deck.id, deck]),
  );
  const requestedByDeck = new Map();

  for (const rawAddition of value) {
    const addition = asRecord(rawAddition);
    const deck = deckById.get(addition.deckId);
    if (!deck || deck.type !== "plot" || !Array.isArray(addition.cardIds)) {
      return null;
    }
    const allowedIds = new Set(authoredCardIds(deck));
    const requestedIds = uniqueStrings(addition.cardIds);
    if (
      requestedIds.length !== addition.cardIds.length ||
      requestedIds.some((id) => !allowedIds.has(id))
    ) {
      return null;
    }
    const accumulated = requestedByDeck.get(deck.id) ?? new Set();
    for (const id of requestedIds) accumulated.add(id);
    requestedByDeck.set(deck.id, accumulated);
  }

  return storyDecks(story).flatMap((deck) => {
    const requested = requestedByDeck.get(deck.id);
    if (!requested) return [];
    return [{
      deckId: deck.id,
      cardIds: authoredCardIds(deck).filter((id) => requested.has(id)),
    }];
  });
}

/**
 * Normalize the only executable card-effect shape.
 *
 * Unknown fields are ignored. Malformed or cross-deck card additions reject
 * the complete effect so execution can remain atomic.
 */
export function normalizeCardEffect(value, story) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = asRecord(value);
  const resources = normalizeResourceEffects(source.resources);
  const addCards = normalizedAddCards(source.addCards, story);
  if (addCards === null) return null;
  const discoveries = uniqueStrings(
    source.discoveries,
    new Set(KNOWN_DISCOVERY_IDS),
  );

  return {
    ...(Object.keys(resources).length > 0 ? { resources: { ...resources } } : {}),
    ...(addCards.length > 0 ? { addCards } : {}),
    ...(discoveries.length > 0 ? { discoveries } : {}),
  };
}

export function effectAdditionsForState(effect, state, story) {
  const normalized = normalizeCardEffect(effect, story);
  if (!normalized) return {};
  const unlocked = normalizeUnlockedCardIdsByDeck(
    state?.unlockedCardIdsByDeck,
    story,
  );
  return Object.fromEntries(
    (normalized.addCards ?? []).flatMap(({ deckId, cardIds }) => {
      const current = new Set(unlocked[deckId] ?? []);
      const additions = cardIds.filter((id) => !current.has(id));
      return additions.length > 0 ? [[deckId, additions]] : [];
    }),
  );
}

export function effectForState(effect, state, story) {
  const normalized = normalizeCardEffect(effect, story);
  if (normalized === null) return null;
  const additions = effectAdditionsForState(normalized, state, story);
  const discoveries = (normalized.discoveries ?? []).filter(
    (id) => state?.discoveries?.[id] !== true,
  );
  return {
    ...(normalized.resources ? { resources: normalized.resources } : {}),
    ...(Object.keys(additions).length > 0
      ? {
          addCards: Object.entries(additions).map(([deckId, cardIds]) => ({
            deckId,
            cardIds,
          })),
        }
      : {}),
    ...(discoveries.length > 0 ? { discoveries } : {}),
  };
}

export function effectAffectedResources(effect, story) {
  const normalized = normalizeCardEffect(effect, story);
  return RESOURCE_KEYS.filter(
    (resource) => Number(normalized?.resources?.[resource] ?? 0) !== 0,
  );
}

function formatRequirement(resources) {
  const requirements = AFFORDABILITY_RESOURCE_IDS.flatMap((resource) => {
    const delta = Number(resources?.[resource] ?? 0);
    return delta < 0
      ? [`${Math.abs(delta)} ${RESOURCE_LABELS[resource]}`]
      : [];
  });
  return requirements.length > 0
    ? `Requires ${requirements.join(" and ")}.`
    : "";
}

export function getEffectAvailability(state, effect, story) {
  const normalized = normalizeCardEffect(effect, story);
  if (effect !== null && normalized === null) {
    return {
      available: false,
      reason: "invalid-effect",
      requirementText: "This card effect is invalid.",
      shortfalls: {},
    };
  }
  const resources = normalizeResources(state?.resources);
  const shortfalls = Object.fromEntries(
    AFFORDABILITY_RESOURCE_IDS.flatMap((resource) => {
      const required = Math.abs(
        Math.min(0, Number(normalized?.resources?.[resource] ?? 0)),
      );
      const shortfall = Math.max(0, required - resources[resource]);
      return shortfall > 0 ? [[resource, shortfall]] : [];
    }),
  );
  const available = Object.keys(shortfalls).length === 0;
  return {
    available,
    reason: available ? null : "insufficient-resources",
    requirementText: available
      ? formatRequirement(normalized?.resources)
      : formatRequirement(normalized?.resources),
    shortfalls,
  };
}

function chapterLabel(deck, story) {
  const plotDecks = storyDecks(story).filter((candidate) => candidate?.type === "plot");
  const fallbackStep = plotDecks.findIndex((candidate) => candidate?.id === deck?.id) + 1;
  const step =
    Number.isInteger(deck?.plotStep) && deck.plotStep > 0
      ? deck.plotStep
      : fallbackStep;
  return `Chapter ${step}, ${String(deck?.title ?? deck?.id ?? "Unknown")}`;
}

export function formatCardEffect(effect, story) {
  const normalized = normalizeCardEffect(effect, story);
  if (!normalized) return "";

  const resourceDetails = RESOURCE_KEYS.flatMap((resource) => {
    const delta = Number(normalized.resources?.[resource] ?? 0);
    return delta
      ? [`${delta > 0 ? "+" : ""}${delta} ${RESOURCE_LABELS[resource]}`]
      : [];
  });
  const additionDetails = (normalized.addCards ?? []).flatMap(
    ({ deckId, cardIds }) => {
      const deck = storyDecks(story).find((candidate) => candidate?.id === deckId);
      if (!deck || cardIds.length === 0) return [];
      return [
        `Adds ${cardIds.length} ${cardIds.length === 1 ? "card" : "cards"} to ${chapterLabel(deck, story)}`,
      ];
    },
  );
  const discoveryDetails =
    (normalized.discoveries ?? []).length === 0
      ? []
      : [
          (normalized.discoveries ?? []).length === 1
            ? "Discovery recorded"
            : `${normalized.discoveries.length} discoveries recorded`,
        ];
  return [
    ...discoveryDetails,
    ...resourceDetails,
    ...additionDetails,
  ].join(" · ");
}

/**
 * Apply a normalized effect atomically, including deterministic card unlocks.
 */
export function applyCardEffect(state, effect, story) {
  const normalized = normalizeCardEffect(effect, story);
  if (effect !== null && normalized === null) {
    return {
      state,
      valid: false,
      changes: {},
      addedCardsByDeck: {},
    };
  }
  if (normalized === null) {
    return {
      state,
      valid: true,
      changes: {},
      addedCardsByDeck: {},
    };
  }

  const additions = effectAdditionsForState(normalized, state, story);
  const unlockedBefore = normalizeUnlockedCardIdsByDeck(
    state?.unlockedCardIdsByDeck,
    story,
  );
  const unlockedAfter = { ...unlockedBefore };
  const drawStateByDeck = { ...(state?.drawStateByDeck ?? {}) };

  for (const [deckId, cardIds] of Object.entries(additions)) {
    const deck = storyDecks(story).find((candidate) => candidate?.id === deckId);
    const currentUnlocked = unlockedBefore[deckId] ?? [];
    const requested = new Set([...currentUnlocked, ...cardIds]);
    const authoredOrder = authoredCardIds(deck);
    unlockedAfter[deckId] = authoredOrder.filter((id) => requested.has(id));

    const availableCards = (deck?.cards ?? []).filter((card) =>
      requested.has(cardId(card)),
    );
    const drawState = normalizeDeckDrawState(
      drawStateByDeck[deckId],
      availableCards,
    );
    const untouchedDeck =
      drawState.drawPile.length === 0 &&
      drawState.discardPile.length === 0 &&
      !drawState.lastResolvedCardId &&
      state?.currentDeckId !== deckId;
    if (!untouchedDeck) {
      const occupied = new Set([
        ...drawState.drawPile,
        ...drawState.discardPile,
        state?.currentDeckId === deckId ? state?.currentCardId : null,
      ]);
      drawStateByDeck[deckId] = {
        ...drawState,
        drawPile: [
          ...drawState.drawPile,
          ...cardIds.filter((id) => !occupied.has(id)),
        ],
      };
    } else {
      drawStateByDeck[deckId] = drawState;
    }
  }

  const resourceResult = applyResourceEffects(
    {
      ...state,
      unlockedCardIdsByDeck: unlockedAfter,
      drawStateByDeck,
    },
    normalized.resources,
  );
  const discoveries = {
    ...(state?.discoveries ?? {}),
    ...Object.fromEntries(
      (normalized.discoveries ?? []).map((id) => [id, true]),
    ),
  };

  return {
    state: {
      ...resourceResult.state,
      discoveries,
    },
    valid: true,
    changes: resourceResult.changes,
    addedCardsByDeck: additions,
  };
}
