import {
  DEEP_SOUTH_INTRO_SKIP_CONFIRMATION,
  DEEP_SOUTH_STORY,
} from "../data/deep-south.js";
import { normalizeSeed } from "../rng.js";
import {
  applyCardEffect,
  formatCardEffect,
  unlockedCardsForDeck,
} from "./card-effects.js";
import { drawFromDeck } from "./deck-draw.js";
import {
  DIRECTIONS,
  planDirection,
} from "./direction-plan.js";
import { createInitialState } from "./state.js";

export { DIRECTIONS, planDirection };

export const INTRO_SKIP_CARD = DEEP_SOUTH_INTRO_SKIP_CONFIRMATION;

function decksOf(story = DEEP_SOUTH_STORY) {
  return Array.isArray(story?.decks) ? story.decks : [];
}

export function getIntroDeck(story = DEEP_SOUTH_STORY) {
  return decksOf(story).find((deck) => deck?.type === "intro") ?? null;
}

export function getPlotDecks(story = DEEP_SOUTH_STORY) {
  return decksOf(story).filter((deck) => deck?.type === "plot");
}

export function getDeckById(deckId, story = DEEP_SOUTH_STORY) {
  return decksOf(story).find((deck) => deck?.id === deckId) ?? null;
}

export function getCardById(cardId, story = DEEP_SOUTH_STORY) {
  if (typeof cardId !== "string") return null;
  for (const deck of decksOf(story)) {
    const card = (deck.cards ?? []).find((candidate) => candidate?.id === cardId);
    if (card) return card;
  }
  return null;
}

export function getPlotStep(deckId, story = DEEP_SOUTH_STORY) {
  const deck = getDeckById(deckId, story);
  return deck?.type === "plot" ? Number(deck.plotStep) || null : null;
}

function isRevealed(state, cardId) {
  return new Set(state?.revealedCardIds ?? []).has(cardId);
}

function cardFace(state, card) {
  return isRevealed(state, card?.id) ? "back" : "front";
}

function tokenForCard(state, card, face) {
  if (card?.type === "intro") {
    return `intro:${Number(state?.introCardIndex ?? 0)}:${card.id}:${face}`;
  }
  return `${Number(state?.decisionCount ?? 0)}:${state.currentDeckId}:${card.id}:${face}`;
}

function presentStoryCard(card, token, state, story) {
  if (!card?.faces?.front || !card?.faces?.back) return null;
  const selectedFace = cardFace(state, card);
  const face = card.faces[selectedFace];
  return {
    id: card.id,
    deckId: card.deckId,
    type: card.type,
    title: String(face.title ?? ""),
    text: String(face.text ?? ""),
    artId: String(face.artId ?? ""),
    artAlt: String(face.artAlt ?? ""),
    artLabel: String(face.artLabel ?? ""),
    detail:
      selectedFace === "back"
        ? formatCardEffect(card.faces.back.effect, story)
        : "",
    cardFace: selectedFace,
    resolutionToken: token,
  };
}

function presentControlCard(card, token) {
  if (!card) return null;
  return {
    id: card.id,
    type: card.type,
    title: String(card.title ?? ""),
    text: String(card.text ?? ""),
    artId: String(card.artId ?? ""),
    artAlt: String(card.artAlt ?? ""),
    artLabel: String(card.artLabel ?? ""),
    detail: "",
    resolutionToken: token,
  };
}

function cardBelongsToDeck(cardId, deck) {
  return Boolean((deck?.cards ?? []).some((card) => card?.id === cardId));
}

function cardIsUnlocked(state, cardId, deck) {
  return unlockedCardsForDeck(state, deck).some((card) => card?.id === cardId);
}

function prepareIntro(inputState, story) {
  const intro = getIntroDeck(story);
  if (!intro || intro.cards.length === 0) {
    return { state: inputState, card: null };
  }
  const index = Math.min(
    intro.cards.length - 1,
    Math.max(0, Number(inputState.introCardIndex) || 0),
  );
  const authoredCard = intro.cards[index];
  const selectedFace = cardFace(inputState, authoredCard);
  const skipPending = inputState.introSkipPending === true;
  const token = skipPending
    ? `intro-skip:${index}:${authoredCard.id}:${selectedFace}`
    : tokenForCard(
        { ...inputState, introCardIndex: index, story },
        authoredCard,
        selectedFace,
      );
  const state = {
    ...inputState,
    currentDeckId: intro.id,
    introCardIndex: index,
    currentCardId: skipPending ? INTRO_SKIP_CARD.id : authoredCard.id,
    currentCardToken: token,
  };
  return {
    state,
    card: skipPending
      ? presentControlCard(INTRO_SKIP_CARD, token)
      : presentStoryCard(authoredCard, token, state, story),
  };
}

function preparePlot(inputState, story) {
  const deck = getDeckById(inputState.currentDeckId, story);
  if (!deck || deck.type !== "plot") return { state: inputState, card: null };

  if (
    cardBelongsToDeck(inputState.currentCardId, deck) &&
    cardIsUnlocked(inputState, inputState.currentCardId, deck)
  ) {
    const authoredCard = getCardById(inputState.currentCardId, story);
    const selectedFace = cardFace(inputState, authoredCard);
    const token =
      typeof inputState.currentCardToken === "string" &&
      inputState.currentCardToken
        ? inputState.currentCardToken
        : tokenForCard(
            { ...inputState, story },
            authoredCard,
            selectedFace,
          );
    const state = { ...inputState, currentCardToken: token };
    return {
      state,
      card: presentStoryCard(authoredCard, token, state, story),
    };
  }

  const availableCards = unlockedCardsForDeck(inputState, deck);
  const drawn = drawFromDeck(
    inputState.drawStateByDeck?.[deck.id],
    availableCards,
    inputState.rngState,
  );
  const authoredCard = getCardById(drawn.cardId, story);
  if (!authoredCard) return { state: inputState, card: null };
  const selectedFace = cardFace(inputState, authoredCard);
  const stateForToken = {
    ...inputState,
    currentCardId: authoredCard.id,
    story,
  };
  const token = tokenForCard(stateForToken, authoredCard, selectedFace);
  const state = {
    ...inputState,
    rngState: drawn.rngState,
    drawStateByDeck: {
      ...(inputState.drawStateByDeck ?? {}),
      [deck.id]: drawn.drawState,
    },
    currentCardId: authoredCard.id,
    currentCardToken: token,
  };
  return {
    state,
    card: presentStoryCard(authoredCard, token, state, story),
  };
}

export function getNextCard(inputState, story = DEEP_SOUTH_STORY) {
  if (!inputState) return { state: inputState, card: null, source: "invalid" };
  if (inputState.status === "lost" && !inputState.terminalPending) {
    return { state: inputState, card: null, source: "loss" };
  }
  const deck = getDeckById(inputState.currentDeckId, story);
  const prepared =
    deck?.type === "intro"
      ? prepareIntro(inputState, story)
      : preparePlot(inputState, story);
  return {
    ...prepared,
    source: deck?.type === "intro" ? "intro" : "plot",
  };
}

export function getCurrentCard(state, story = DEEP_SOUTH_STORY) {
  if (!state || (state.status === "lost" && !state.terminalPending)) return null;
  const deck = getDeckById(state.currentDeckId, story);
  if (deck?.type === "intro") {
    const authoredCard = deck.cards?.[state.introCardIndex] ?? null;
    return state.introSkipPending
      ? presentControlCard(INTRO_SKIP_CARD, state.currentCardToken)
      : presentStoryCard(authoredCard, state.currentCardToken, state, story);
  }
  const authoredCard =
    cardBelongsToDeck(state.currentCardId, deck) &&
    cardIsUnlocked(state, state.currentCardId, deck)
      ? getCardById(state.currentCardId, story)
      : null;
  return presentStoryCard(
    authoredCard,
    state.currentCardToken,
    state,
    story,
  );
}

export function createGame({ seed, story = DEEP_SOUTH_STORY } = {}) {
  return getNextCard(
    createInitialState({ seed, decks: decksOf(story) }),
    story,
  );
}

export const newGame = createGame;

function ignored(state, story, reason) {
  return {
    state,
    card: getCurrentCard(state, story),
    ignored: true,
    reason,
    changes: {},
    addedCardsByDeck: {},
  };
}

function withTerminalPending(state) {
  return state.status === "lost"
    ? { ...state, terminalPending: true }
    : state;
}

function resolveReveal(state, card, plan, story) {
  const authoredCard = getCardById(card.id, story);
  if (!authoredCard || card.cardFace !== "front") {
    return ignored(state, story, "card-already-revealed");
  }
  const availability = planDirection(state, card, plan.direction, story);
  if (!availability.available || availability.mode !== "flip") {
    return ignored(state, story, availability.reason);
  }

  const applied = applyCardEffect(state, availability.effect, story);
  if (!applied.valid) return ignored(state, story, "invalid-effect");
  const sourceToken = state.currentCardToken;
  const sourceDeck = getDeckById(state.currentDeckId, story);
  const decisionCount =
    sourceDeck?.type === "plot"
      ? Number(state.decisionCount ?? 0) + 1
      : Number(state.decisionCount ?? 0);
  const revealedCardIds = Array.from(
    new Set([...(state.revealedCardIds ?? []), authoredCard.id]),
  );
  const nextState = withTerminalPending({
    ...applied.state,
    revealedCardIds,
    decisionCount,
    currentCardId: authoredCard.id,
    currentCardToken: null,
    lastResolvedToken: sourceToken,
  });
  const next = getNextCard(nextState, story);
  return {
    ...next,
    ignored: false,
    reason: null,
    resolvedCard: card,
    resultText: String(authoredCard.faces.back.text ?? ""),
    effectDetail: formatCardEffect(availability.effect, story),
    changes: applied.changes,
    addedCardsByDeck: applied.addedCardsByDeck,
  };
}

function applyDestinationEffect(state, effect, story) {
  const applied = applyCardEffect(state, effect, story);
  return applied.valid
    ? {
        ...applied,
        state: withTerminalPending(applied.state),
      }
    : {
        state,
        valid: true,
        changes: {},
        addedCardsByDeck: {},
      };
}

function resolveIntroNavigation(state, card, plan, story) {
  const intro = getIntroDeck(story);
  const sourceToken = state.currentCardToken;

  if (state.introSkipPending && plan.direction === "up") {
    const next = getNextCard(
      {
        ...state,
        introSkipPending: false,
        currentCardId: null,
        currentCardToken: null,
        lastResolvedToken: sourceToken,
      },
      story,
    );
    return {
      ...next,
      ignored: false,
      reason: null,
      resolvedCard: card,
      resultText: "",
      effectDetail: "",
      changes: {},
      addedCardsByDeck: {},
    };
  }

  if (!state.introSkipPending && plan.direction === "down") {
    const next = getNextCard(
      {
        ...state,
        introSkipPending: true,
        currentCardId: null,
        currentCardToken: null,
        lastResolvedToken: sourceToken,
      },
      story,
    );
    return {
      ...next,
      ignored: false,
      reason: null,
      resolvedCard: card,
      resultText: "",
      effectDetail: "",
      changes: {},
      addedCardsByDeck: {},
    };
  }

  const destinationDeck = getDeckById(plan.destinationDeckId, story);
  if (destinationDeck?.type === "intro") {
    const destinationIndex = intro?.cards?.findIndex(
      (candidate) => candidate?.id === plan.destinationCardId,
    );
    if (destinationIndex < 0) {
      return ignored(state, story, "invalid-destination");
    }
    const destinationState = {
      ...state,
      introCardIndex: destinationIndex,
      introSkipPending: false,
      currentCardId: null,
      currentCardToken: null,
      lastResolvedToken: sourceToken,
      drawStateByDeck: plan.nextDrawState,
      rngState: plan.nextRngState,
    };
    const applied = applyDestinationEffect(
      destinationState,
      plan.effect,
      story,
    );
    const next = getNextCard(applied.state, story);
    return {
      ...next,
      ignored: false,
      reason: null,
      resolvedCard: card,
      resultText: "",
      effectDetail: formatCardEffect(plan.effect, story),
      changes: applied.changes,
      addedCardsByDeck: applied.addedCardsByDeck,
    };
  }

  return resolvePlannedDestination(state, card, plan, story, false);
}

function resolvePlannedDestination(
  state,
  card,
  plan,
  story,
  countDecision,
) {
  if (!plan.destinationDeckId || !plan.destinationCardId) {
    return ignored(state, story, "invalid-destination");
  }
  const sourceToken = state.currentCardToken;
  const destinationState = {
    ...state,
    decisionCount: countDecision
      ? Number(state.decisionCount ?? 0) + 1
      : Number(state.decisionCount ?? 0),
    currentDeckId: plan.destinationDeckId,
    introSkipPending: false,
    currentCardId: plan.destinationCardId,
    currentCardToken: null,
    lastResolvedToken: sourceToken,
    drawStateByDeck: plan.nextDrawState,
    rngState: plan.nextRngState,
  };
  const applied = applyDestinationEffect(
    destinationState,
    plan.effect,
    story,
  );
  const next = getNextCard(applied.state, story);
  return {
    ...next,
    ignored: false,
    reason: null,
    resolvedCard: card,
    resultText: "",
    effectDetail: formatCardEffect(plan.effect, story),
    changes: applied.changes,
    addedCardsByDeck: applied.addedCardsByDeck,
  };
}

function resolveNavigation(state, card, plan, story) {
  if (plan.mode === "terminal") {
    const finalState = {
      ...state,
      terminalPending: false,
      currentCardToken: null,
      lastResolvedToken: state.currentCardToken,
    };
    return {
      state: finalState,
      card: null,
      source: "loss",
      ignored: false,
      reason: null,
      resolvedCard: card,
      resultText: "",
      effectDetail: "",
      changes: {},
      addedCardsByDeck: {},
    };
  }
  const deck = getDeckById(state.currentDeckId, story);
  return deck?.type === "intro"
    ? resolveIntroNavigation(state, card, plan, story)
    : resolvePlannedDestination(state, card, plan, story, true);
}

/** Atomically resolve one canonical flip, navigation, or terminal acknowledgement. */
export function resolveChoice(
  inputState,
  inputDirection,
  { expectedToken, story = DEEP_SOUTH_STORY } = {},
) {
  if (
    inputState?.status === "lost" &&
    inputState?.terminalPending !== true
  ) {
    return ignored(inputState, story, "run-lost");
  }
  if (!DIRECTIONS.includes(inputDirection)) {
    return ignored(inputState, story, "invalid-direction");
  }

  const prepared = getNextCard(inputState, story);
  const state = prepared.state;
  const card = prepared.card;
  if (!card) return ignored(inputState, story, "no-card");
  if (expectedToken && expectedToken !== state.currentCardToken) {
    return ignored(inputState, story, "stale-resolution");
  }
  if (state.lastResolvedToken === state.currentCardToken) {
    return ignored(inputState, story, "stale-resolution");
  }

  const plan = planDirection(state, card, inputDirection, story);
  if (!plan.available) return ignored(inputState, story, plan.reason);
  return plan.mode === "flip"
    ? resolveReveal(state, card, plan, story)
    : resolveNavigation(state, card, plan, story);
}

export function restartGame(
  state,
  { seed = state?.runSeed, story = DEEP_SOUTH_STORY } = {},
) {
  if (state?.status !== "lost") {
    return {
      state,
      card: getCurrentCard(state, story),
      ignored: true,
      reason: "run-active",
    };
  }
  return {
    ...createGame({ seed: normalizeSeed(seed), story }),
    ignored: false,
    reason: null,
  };
}
