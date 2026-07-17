import {
  DEEP_SOUTH_INTRO_SKIP_CONFIRMATION,
  DEEP_SOUTH_STORY,
} from "../data/deep-south.js";
import { normalizeSeed } from "../rng.js";
import { createPendingFeedback } from "./choice-feedback.js";
import { discardToDeck, drawFromDeck } from "./deck-draw.js";
import { applyResourceEffects } from "./effects.js";
import { createInitialState } from "./state.js";

export const DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);

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

export function getDestinationDeckId(
  currentDeckId,
  direction,
  story = DEEP_SOUTH_STORY,
) {
  const plotDecks = getPlotDecks(story);
  const index = plotDecks.findIndex((deck) => deck.id === currentDeckId);
  if (index < 0 || !DIRECTIONS.includes(direction)) return null;
  if (direction === "up") return plotDecks[Math.max(0, index - 1)].id;
  if (direction === "down") {
    return plotDecks[Math.min(plotDecks.length - 1, index + 1)].id;
  }
  return currentDeckId;
}

function tokenForIntro(index, cardId) {
  return `intro:${index}:${cardId}`;
}

function tokenForPlot(state, cardId) {
  return `${Number(state?.decisionCount ?? 0)}:${state.currentDeckId}:${cardId}`;
}

function presentCard(card, token) {
  return card ? { ...card, resolutionToken: token } : null;
}

function presentIntroCard(card, token) {
  return card
    ? {
        ...card,
        resolutionToken: token,
        choices: {
          up: { label: "Keep reading", result: "", effects: {} },
          left: { label: "Skip toward Castro", result: "", effects: {} },
        },
      }
    : null;
}

function cardBelongsToDeck(cardId, deck) {
  return Boolean((deck?.cards ?? []).some((card) => card?.id === cardId));
}

function prepareIntro(inputState, story) {
  const intro = getIntroDeck(story);
  if (!intro || intro.cards.length === 0) return { state: inputState, card: null };
  const index = Math.min(
    intro.cards.length - 1,
    Math.max(0, Number(inputState.introCardIndex) || 0),
  );
  const card = intro.cards[index];
  const skipPending = inputState.introSkipPending === true;
  const token = skipPending
    ? `intro-skip:${index}:${card.id}`
    : tokenForIntro(index, card.id);
  const state = {
    ...inputState,
    currentDeckId: intro.id,
    introCardIndex: index,
    currentCardId: card.id,
    currentCardToken: token,
  };
  return {
    state,
    card: skipPending
      ? presentCard(INTRO_SKIP_CARD, token)
      : presentIntroCard(card, token),
  };
}

function preparePlot(inputState, story) {
  const deck = getDeckById(inputState.currentDeckId, story);
  if (!deck || deck.type !== "plot") return { state: inputState, card: null };

  if (cardBelongsToDeck(inputState.currentCardId, deck)) {
    const card = getCardById(inputState.currentCardId, story);
    const token =
      typeof inputState.currentCardToken === "string" && inputState.currentCardToken
        ? inputState.currentCardToken
        : tokenForPlot(inputState, card.id);
    const state = { ...inputState, currentCardToken: token };
    return { state, card: presentCard(card, token) };
  }

  const drawn = drawFromDeck(
    inputState.drawStateByDeck?.[deck.id],
    deck.cards,
    inputState.rngState,
  );
  const card = getCardById(drawn.cardId, story);
  if (!card) return { state: inputState, card: null };
  const token = tokenForPlot(inputState, card.id);
  const state = {
    ...inputState,
    rngState: drawn.rngState,
    drawStateByDeck: {
      ...(inputState.drawStateByDeck ?? {}),
      [deck.id]: drawn.drawState,
    },
    currentCardId: card.id,
    currentCardToken: token,
  };
  return { state, card: presentCard(card, token) };
}

/**
 * Prepare only the surface allowed by persisted state. A pending outcome never
 * draws the destination card; that draw belongs to explicit acknowledgement.
 */
export function getNextCard(inputState, story = DEEP_SOUTH_STORY) {
  if (!inputState || inputState.pendingFeedback) {
    return { state: inputState, card: null, source: "feedback" };
  }
  if (inputState.status === "lost") {
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
  if (!state || state.pendingFeedback || state.status === "lost") return null;
  const deck = getDeckById(state.currentDeckId, story);
  if (deck?.type === "intro") {
    const card = state.introSkipPending
      ? INTRO_SKIP_CARD
      : deck.cards?.[state.introCardIndex] ?? null;
    return state.introSkipPending
      ? presentCard(card, state.currentCardToken)
      : presentIntroCard(card, state.currentCardToken);
  }
  const card = cardBelongsToDeck(state.currentCardId, deck)
    ? getCardById(state.currentCardId, story)
    : null;
  return presentCard(card, state.currentCardToken);
}

export function createGame({ seed, story = DEEP_SOUTH_STORY } = {}) {
  return getNextCard(createInitialState({ seed, decks: decksOf(story) }), story);
}

export const newGame = createGame;

function enterCastro(state, story) {
  const firstPlotDeck = getPlotDecks(story)[0];
  if (!firstPlotDeck) return { state, card: null, source: "plot" };
  return getNextCard(
    {
      ...state,
      currentDeckId: firstPlotDeck.id,
      introSkipPending: false,
      currentCardId: null,
      currentCardToken: null,
    },
    story,
  );
}

function ignored(state, story, reason) {
  return {
    state,
    card: getCurrentCard(state, story),
    ignored: true,
    reason,
    changes: {},
  };
}

function resolveIntro(state, direction, story) {
  const intro = getIntroDeck(story);
  const index = Math.min(
    Math.max(0, Number(state.introCardIndex) || 0),
    Math.max(0, (intro?.cards?.length ?? 1) - 1),
  );

  if (state.introSkipPending) {
    if (direction === "left") {
      return {
        ...enterCastro(state, story),
        ignored: false,
        resultText: "",
        changes: {},
      };
    }
    if (direction === "up") {
      const next = getNextCard(
        {
          ...state,
          introSkipPending: false,
          currentCardToken: null,
        },
        story,
      );
      return { ...next, ignored: false, resultText: "", changes: {} };
    }
    return ignored(state, story, "intro-direction-ignored");
  }

  if (direction === "left") {
    const next = getNextCard(
      {
        ...state,
        introSkipPending: true,
        currentCardToken: null,
      },
      story,
    );
    return { ...next, ignored: false, resultText: "", changes: {} };
  }
  if (direction !== "up") return ignored(state, story, "intro-direction-ignored");

  if (index >= intro.cards.length - 1) {
    return {
      ...enterCastro(state, story),
      ignored: false,
      resultText: "",
      changes: {},
    };
  }

  const next = getNextCard(
    {
      ...state,
      introCardIndex: index + 1,
      currentCardId: null,
      currentCardToken: null,
    },
    story,
  );
  return { ...next, ignored: false, resultText: "", changes: {} };
}

function resolvePlot(state, card, direction, story) {
  const sourceDeck = getDeckById(state.currentDeckId, story);
  const choice = card?.choices?.[direction];
  if (!sourceDeck || sourceDeck.type !== "plot" || !choice) {
    return ignored(state, story, "choice-unavailable");
  }

  const destinationDeckId = getDestinationDeckId(sourceDeck.id, direction, story);
  if (!destinationDeckId) return ignored(state, story, "invalid-destination");

  const applied = applyResourceEffects(state, choice.effects);
  const decisionCount = Number(state.decisionCount ?? 0) + 1;
  const sourceToken = state.currentCardToken;
  const sourceDrawState = discardToDeck(
    applied.state.drawStateByDeck?.[sourceDeck.id],
    card.id,
    sourceDeck.cards,
  );
  const resolved = {
    ...applied.state,
    decisionCount,
    currentDeckId: destinationDeckId,
    currentCardId: null,
    currentCardToken: null,
    lastResolvedToken: sourceToken,
    drawStateByDeck: {
      ...(applied.state.drawStateByDeck ?? {}),
      [sourceDeck.id]: sourceDrawState,
    },
  };
  const pendingFeedback = createPendingFeedback({
    sourceCardId: card.id,
    sourceCardToken: sourceToken,
    sourceDeckId: sourceDeck.id,
    direction,
    destinationDeckId,
    resultText: choice.result,
    tone: choice.tone,
    changes: applied.changes,
  });
  if (!pendingFeedback) {
    return ignored(state, story, "invalid-feedback");
  }

  return {
    state: { ...resolved, pendingFeedback },
    card: null,
    ignored: false,
    reason: null,
    resolvedCard: card,
    resultText: choice.result,
    changes: applied.changes,
  };
}

/** Atomically resolve one Intro navigation or four-direction plot choice. */
export function resolveChoice(
  inputState,
  inputDirection,
  { expectedToken, story = DEEP_SOUTH_STORY } = {},
) {
  if (inputState?.pendingFeedback) {
    return ignored(inputState, story, "feedback-pending");
  }
  if (inputState?.status === "lost") return ignored(inputState, story, "run-lost");
  if (!DIRECTIONS.includes(inputDirection)) {
    return ignored(inputState, story, "invalid-direction");
  }

  const prepared = getNextCard(inputState, story);
  const state = prepared.state;
  const card = prepared.card;
  if (!card) return ignored(state, story, "no-card");
  if (expectedToken && expectedToken !== state.currentCardToken) {
    return ignored(state, story, "stale-resolution");
  }
  if (state.lastResolvedToken === state.currentCardToken) {
    return ignored(state, story, "stale-resolution");
  }

  const deck = getDeckById(state.currentDeckId, story);
  return deck?.type === "intro"
    ? resolveIntro(state, inputDirection, story)
    : resolvePlot(state, card, inputDirection, story);
}

export function dismissChoiceFeedback(
  state,
  { expectedFeedbackId, story = DEEP_SOUTH_STORY } = {},
) {
  const feedback = state?.pendingFeedback;
  if (!feedback) {
    return {
      state,
      card: getCurrentCard(state, story),
      ignored: true,
      reason: "no-feedback",
    };
  }
  if (expectedFeedbackId && expectedFeedbackId !== feedback.id) {
    return {
      state,
      card: null,
      ignored: true,
      reason: "stale-feedback",
    };
  }

  const dismissed = { ...state, pendingFeedback: null };
  const next =
    dismissed.status === "lost"
      ? { state: dismissed, card: null, source: "loss" }
      : getNextCard(dismissed, story);
  return { ...next, ignored: false, reason: null };
}

export const continueFromFeedback = dismissChoiceFeedback;

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
  return { ...createGame({ seed: normalizeSeed(seed), story }), ignored: false, reason: null };
}
