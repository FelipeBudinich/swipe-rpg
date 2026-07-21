import {
  DEEP_SOUTH_INTRO_SKIP_CONFIRMATION,
  DEEP_SOUTH_STORY,
} from "../data/deep-south.js";
import {
  effectAffectedResources,
  effectForState,
  formatCardEffect,
  getEffectAvailability,
  normalizeCardEffect,
  unlockedCardsForDeck,
} from "./card-effects.js";
import {
  discardToDeck,
  normalizeDeckDrawState,
  planDrawFromDeck,
} from "./deck-draw.js";

export const DIRECTIONS = Object.freeze([
  "up",
  "down",
  "left",
  "right",
]);

const HORIZONTAL_DIRECTIONS = new Set(["left", "right"]);
const VERTICAL_DIRECTIONS = new Set(["up", "down"]);

function decksOf(story) {
  return Array.isArray(story?.decks) ? story.decks : [];
}

function deckById(story, deckId) {
  return decksOf(story).find((deck) => deck?.id === deckId) ?? null;
}

function cardById(story, id) {
  if (typeof id !== "string") return null;
  for (const deck of decksOf(story)) {
    const card = (deck.cards ?? []).find((candidate) => candidate?.id === id);
    if (card) return card;
  }
  return null;
}

function plotDecks(story) {
  return decksOf(story).filter((deck) => deck?.type === "plot");
}

function plotStep(deck, story) {
  const fallback = plotDecks(story).findIndex(
    (candidate) => candidate?.id === deck?.id,
  ) + 1;
  return Number.isInteger(deck?.plotStep) && deck.plotStep > 0
    ? deck.plotStep
    : fallback;
}

function faceForCard(state, card) {
  return new Set(state?.revealedCardIds ?? []).has(card?.id)
    ? "back"
    : "front";
}

function unavailable(direction, reason, requirementText) {
  return {
    available: false,
    reason,
    requirementText,
    direction,
    mode: null,
    label: "No option",
    effect: null,
    detail: "",
    affectedResources: [],
    sourceCardId: null,
    destinationDeckId: null,
    destinationCardId: null,
    nextDrawState: null,
    nextRngState: null,
  };
}

function plannedEffect(state, rawEffect, story) {
  const normalized = normalizeCardEffect(rawEffect, story);
  if (rawEffect !== null && normalized === null) {
    return {
      valid: false,
      effect: null,
      detail: "",
      affectedResources: [],
    };
  }
  const effect = effectForState(normalized, state, story);
  return {
    valid: true,
    effect,
    detail: formatCardEffect(effect, story),
    affectedResources: effectAffectedResources(effect, story),
  };
}

function planReveal(state, authoredCard, direction, story) {
  if (!authoredCard?.faces?.back) {
    return unavailable(
      direction,
      "missing-back-face",
      "This card has no reverse face.",
    );
  }
  if (faceForCard(state, authoredCard) === "back") {
    return unavailable(
      direction,
      "card-already-revealed",
      "This card has already been revealed.",
    );
  }

  const planned = plannedEffect(
    state,
    authoredCard.faces.back.effect,
    story,
  );
  if (!planned.valid || (authoredCard.type === "plot" && !planned.effect)) {
    return unavailable(
      direction,
      "invalid-effect",
      "This card cannot be revealed.",
    );
  }
  const availability = getEffectAvailability(state, planned.effect, story);

  return {
    ...availability,
    direction,
    mode: "flip",
    label:
      typeof authoredCard.turnLabel === "string" && authoredCard.turnLabel.trim()
        ? authoredCard.turnLabel.trim()
        : "Turn the card over",
    effect: planned.effect,
    detail: planned.detail,
    affectedResources: planned.affectedResources,
    sourceCardId: authoredCard.id,
    destinationDeckId: authoredCard.deckId,
    destinationCardId: authoredCard.id,
    nextDrawState: state?.drawStateByDeck ?? {},
    nextRngState: state?.rngState,
  };
}

function navigationLabel(direction, sourceDeck, destinationDeck, story) {
  if (direction === "up") {
    return `Return to Chapter ${plotStep(destinationDeck, story)}, ${destinationDeck.title}`;
  }
  if (sourceDeck.id === destinationDeck.id) {
    return sourceDeck === plotDecks(story).at(-1)
      ? `Continue through Chapter ${plotStep(destinationDeck, story)}, ${destinationDeck.title}`
      : `Continue in Chapter ${plotStep(destinationDeck, story)}, ${destinationDeck.title}`;
  }
  return `Continue to Chapter ${plotStep(destinationDeck, story)}, ${destinationDeck.title}`;
}

function planPlotNavigation(state, authoredCard, direction, story) {
  const sourceDeck = deckById(story, state?.currentDeckId);
  const orderedPlotDecks = plotDecks(story);
  const sourceIndex = orderedPlotDecks.findIndex(
    (deck) => deck?.id === sourceDeck?.id,
  );
  if (!sourceDeck || sourceIndex < 0) {
    return unavailable(
      direction,
      "invalid-source-deck",
      "This route has no valid source chapter.",
    );
  }
  if (direction === "up" && sourceIndex === 0) {
    return unavailable(
      direction,
      "no-previous-chapter",
      "Castro has no previous plot chapter.",
    );
  }

  const sourceCards = unlockedCardsForDeck(state, sourceDeck);
  const sourceDrawState = normalizeDeckDrawState(
    state?.drawStateByDeck?.[sourceDeck.id],
    sourceCards,
  );
  const discardedSource = discardToDeck(
    sourceDrawState,
    authoredCard.id,
    sourceCards,
  );
  let destinationDeck;
  if (direction === "up") {
    destinationDeck = orderedPlotDecks[sourceIndex - 1] ?? null;
  } else if (direction === "down" && sourceDrawState.drawPile.length > 0) {
    destinationDeck = sourceDeck;
  } else if (direction === "down") {
    destinationDeck =
      orderedPlotDecks[sourceIndex + 1] ??
      orderedPlotDecks[sourceIndex] ??
      null;
  } else {
    return unavailable(
      direction,
      "invalid-direction",
      "That direction cannot navigate this chapter.",
    );
  }
  if (!destinationDeck) {
    return unavailable(
      direction,
      "invalid-destination",
      "This route has no destination chapter.",
    );
  }

  const nextDrawState = {
    ...(state?.drawStateByDeck ?? {}),
    [sourceDeck.id]: discardedSource,
  };
  const destinationCards = unlockedCardsForDeck(state, destinationDeck);
  const destinationDrawState =
    destinationDeck.id === sourceDeck.id
      ? discardedSource
      : state?.drawStateByDeck?.[destinationDeck.id];
  const drawPlan = planDrawFromDeck({
    drawState: destinationDrawState,
    cards: destinationCards,
    rngState: state?.rngState,
    avoidCardId:
      destinationDeck.id === sourceDeck.id ? authoredCard.id : undefined,
  });
  const destinationCard = cardById(story, drawPlan.cardId);
  if (!destinationCard) {
    return unavailable(
      direction,
      "no-destination-card",
      "No destination card is available.",
    );
  }
  nextDrawState[destinationDeck.id] = drawPlan.nextDrawState;

  const entry = plannedEffect(state, destinationCard.entryEffect, story);
  return {
    available: true,
    reason: null,
    requirementText: "",
    direction,
    mode: "navigate",
    label: navigationLabel(direction, sourceDeck, destinationDeck, story),
    effect: entry.valid ? entry.effect : null,
    detail: entry.valid ? entry.detail : "",
    affectedResources: entry.valid ? entry.affectedResources : [],
    sourceCardId: authoredCard.id,
    destinationDeckId: destinationDeck.id,
    destinationCardId: destinationCard.id,
    nextDrawState,
    nextRngState: drawPlan.nextRngState,
  };
}

function planFirstPlotCard(state, direction, story) {
  const destinationDeck = plotDecks(story)[0];
  if (!destinationDeck) {
    return unavailable(
      direction,
      "invalid-destination",
      "Castro is unavailable.",
    );
  }
  const destinationCards = unlockedCardsForDeck(state, destinationDeck);
  const drawPlan = planDrawFromDeck({
    drawState: state?.drawStateByDeck?.[destinationDeck.id],
    cards: destinationCards,
    rngState: state?.rngState,
  });
  const destinationCard = cardById(story, drawPlan.cardId);
  if (!destinationCard) {
    return unavailable(
      direction,
      "no-destination-card",
      "No Castro card is available.",
    );
  }
  const entry = plannedEffect(state, destinationCard.entryEffect, story);
  return {
    available: true,
    reason: null,
    requirementText: "",
    direction,
    mode: "navigate",
    label: "Enter Castro",
    effect: entry.valid ? entry.effect : null,
    detail: entry.valid ? entry.detail : "",
    affectedResources: entry.valid ? entry.affectedResources : [],
    sourceCardId: state?.currentCardId ?? null,
    destinationDeckId: destinationDeck.id,
    destinationCardId: destinationCard.id,
    nextDrawState: {
      ...(state?.drawStateByDeck ?? {}),
      [destinationDeck.id]: drawPlan.nextDrawState,
    },
    nextRngState: drawPlan.nextRngState,
  };
}

function introCardAt(state, story, offset = 0) {
  const introDeck = decksOf(story).find((deck) => deck?.type === "intro");
  const index = Math.max(0, Number(state?.introCardIndex) || 0) + offset;
  return {
    deck: introDeck,
    index,
    card: introDeck?.cards?.[index] ?? null,
  };
}

function planIntroNavigation(state, currentCard, direction, story) {
  const current = introCardAt(state, story);
  if (state?.introSkipPending) {
    if (direction === "down") {
      return {
        available: true,
        reason: null,
        requirementText: "",
        direction,
        mode: "navigate",
        label: "Keep reading",
        effect: null,
        detail: "",
        affectedResources: [],
        sourceCardId: DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.id,
        destinationDeckId: current.deck?.id ?? null,
        destinationCardId: current.card?.id ?? null,
        nextDrawState: state?.drawStateByDeck ?? {},
        nextRngState: state?.rngState,
      };
    }
    return planFirstPlotCard(state, direction, story);
  }

  if (direction === "up") {
    return {
      available: true,
      reason: null,
      requirementText: "",
      direction,
      mode: "navigate",
      label: "Skip toward Castro",
      effect: null,
      detail: "",
      affectedResources: [],
      sourceCardId: currentCard?.id ?? null,
      destinationDeckId: current.deck?.id ?? null,
      destinationCardId: DEEP_SOUTH_INTRO_SKIP_CONFIRMATION.id,
      nextDrawState: state?.drawStateByDeck ?? {},
      nextRngState: state?.rngState,
    };
  }

  const next = introCardAt(state, story, 1);
  if (!next.card) {
    return {
      ...planFirstPlotCard(state, direction, story),
      label: "Keep reading",
    };
  }
  const entry = plannedEffect(state, next.card.entryEffect, story);
  return {
    available: true,
    reason: null,
    requirementText: "",
    direction,
    mode: "navigate",
    label: "Keep reading",
    effect: entry.valid ? entry.effect : null,
    detail: entry.valid ? entry.detail : "",
    affectedResources: entry.valid ? entry.affectedResources : [],
    sourceCardId: currentCard?.id ?? null,
    destinationDeckId: next.deck?.id ?? null,
    destinationCardId: next.card.id,
    nextDrawState: state?.drawStateByDeck ?? {},
    nextRngState: state?.rngState,
  };
}

export function planDirection(
  state,
  currentCard,
  direction,
  story = DEEP_SOUTH_STORY,
) {
  if (!DIRECTIONS.includes(direction)) {
    return unavailable(
      direction,
      "invalid-direction",
      "That direction is invalid.",
    );
  }

  if (state?.terminalPending) {
    return VERTICAL_DIRECTIONS.has(direction)
      ? {
          available: true,
          reason: null,
          requirementText: "",
          direction,
          mode: "terminal",
          label: "Face the ending",
          effect: null,
          detail: "",
          affectedResources: [],
          sourceCardId: currentCard?.id ?? null,
          destinationDeckId: null,
          destinationCardId: null,
          nextDrawState: state?.drawStateByDeck ?? {},
          nextRngState: state?.rngState,
        }
      : unavailable(
          direction,
          "terminal-pending",
          "Only Up or Down can conclude the expedition.",
        );
  }

  const deck = deckById(story, state?.currentDeckId);
  if (state?.introSkipPending) {
    if (!VERTICAL_DIRECTIONS.has(direction)) {
      return unavailable(
        direction,
        "intro-direction-ignored",
        "The skip confirmation uses only Up and Down.",
      );
    }
    return planIntroNavigation(state, currentCard, direction, story);
  }

  const authoredCard = cardById(story, currentCard?.id ?? state?.currentCardId);
  if (!authoredCard) {
    return unavailable(
      direction,
      "no-card",
      "No story card is active.",
    );
  }
  if (HORIZONTAL_DIRECTIONS.has(direction)) {
    return planReveal(state, authoredCard, direction, story);
  }
  if (deck?.type === "intro") {
    return planIntroNavigation(state, authoredCard, direction, story);
  }
  if (deck?.type === "plot") {
    return planPlotNavigation(state, authoredCard, direction, story);
  }
  return unavailable(
    direction,
    "invalid-source-deck",
    "No route is available.",
  );
}
