import { DEEP_SOUTH_STORY } from "./data/deep-south.js";
import * as Engine from "./game/engine.js";
import { normalizeState } from "./game/state.js";
import { getDirectionAvailability } from "./game/choice-availability.js";
import { loadState, saveState } from "./storage.js";
import {
  createFeedbackController,
  diffHud,
  hudSnapshot,
} from "./ui/feedback.js";
import {
  createArrowKeyHandler,
  createChoiceClickHandler,
} from "./ui/directional-input.js";
import {
  isActiveCommitResolutionBlocked as activeCommitResolutionIsBlocked,
  isNewInputBlocked as newInputIsBlocked,
} from "./ui/interaction-lock.js";
import {
  createRenderer,
  FEEDBACK_ART_BY_TONE,
} from "./ui/render.js";
import { createSwipeController } from "./ui/swipe-controller.js";

function randomSeed() {
  try {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] || 0x6d2b79f5;
  } catch {
    return (Date.now() ^ 0xa5a5a5a5) >>> 0;
  }
}

const authoredArtIds = DEEP_SOUTH_STORY.decks.flatMap((deck) => [
  deck.artId,
  ...(deck.cards ?? []).map((card) => card.artId),
]);
const allowedArtIds = new Set(
  [
    ...authoredArtIds,
    ...Object.values(FEEDBACK_ART_BY_TONE),
  ].filter((artId) => typeof artId === "string" && artId),
);
const renderer = createRenderer({
  story: DEEP_SOUTH_STORY,
  allowedArtIds,
});
const { elements } = renderer;
const feedback = createFeedbackController({
  resultElement: document.getElementById("result-live"),
  resourceElements: {
    eldritchLore: elements.eldritchLoreHud,
    crew: elements.crewHud,
    sanity: elements.sanityHud,
  },
});

const initialGame = Engine.createGame({ seed: randomSeed() });
let state = loadState({
  createFallback: () => initialGame.state,
  normalize: (raw, fallback) =>
    normalizeState(raw, {
      seed: fallback.runSeed,
      decks: DEEP_SOUTH_STORY.decks,
    }),
});
let prepared = Engine.getNextCard(state);
state = prepared.state;
let currentCard = prepared.card;
let inputLocked = false;
let feedbackDismissalActive = false;
let swipeController;

function interactionLockState() {
  return {
    inputLocked,
    controllerCommitting: swipeController?.isCommitting === true,
    terminalActive: state.status === "lost" && !state.pendingFeedback,
    feedbackActive: Boolean(state.pendingFeedback),
  };
}

function isNewInputBlocked() {
  return newInputIsBlocked(interactionLockState());
}

function isActiveCommitResolutionBlocked() {
  return activeCommitResolutionIsBlocked(interactionLockState());
}

function updateControlLocks() {
  const blocked = isNewInputBlocked();
  for (const [direction, button] of Object.entries(elements.choiceButtons)) {
    const availability = getDirectionAvailability(
      state,
      currentCard,
      direction,
    );
    button.disabled = blocked || !availability.available;
  }
  elements.choiceFeedbackContinue.disabled = Boolean(
    !state.pendingFeedback || inputLocked || feedbackDismissalActive,
  );
  elements.terminalRestart.disabled = Boolean(
    state.status !== "lost" || state.pendingFeedback || inputLocked,
  );
}

function renderAll() {
  renderer.render(state, currentCard);
  updateControlLocks();
}

async function settleCardArt() {
  if (!currentCard || elements.card.hidden) return;
  try {
    await Promise.race([
      elements.cardArt.decode?.() ?? Promise.resolve(),
      new Promise((resolve) => globalThis.setTimeout(resolve, 80)),
    ]);
  } catch {
    // Card copy and controls remain usable when decorative art cannot decode.
  }
}

async function commitChoice(direction) {
  if (isActiveCommitResolutionBlocked()) return false;
  inputLocked = true;
  updateControlLocks();
  try {
    const beforeHud = hudSnapshot(state);
    const resolution = Engine.resolveChoice(state, direction, {
      expectedToken: currentCard?.resolutionToken,
    });
    if (resolution.ignored) {
      if (!["intro-direction-ignored"].includes(resolution.reason)) {
        feedback.announce("That action is no longer available.");
      }
      return false;
    }

    state = resolution.state;
    currentCard = resolution.card;
    saveState(state);
    renderAll();
    const changes = {
      ...diffHud(beforeHud, hudSnapshot(state)),
      ...(resolution.changes ?? {}),
    };
    if (state.pendingFeedback) feedback.pulseChanges(changes);
    await settleCardArt();
    return true;
  } catch (error) {
    feedback.announce("The southern sea shifted. Try that action again.");
    console.error(error);
    return false;
  } finally {
    inputLocked = false;
    swipeController.resetForNextCard();
    updateControlLocks();
    renderer.focusPrimarySurface();
  }
}

swipeController = createSwipeController({
  card: elements.card,
  isInputLocked: isNewInputBlocked,
  canCommit: (direction) =>
    getDirectionAvailability(state, currentCard, direction).available,
  onBlocked: announceUnavailableDirection,
  onPreview: (direction) => renderer.previewChoice(direction),
  onCommit: commitChoice,
  onError: (error) => {
    updateControlLocks();
    feedback.announce("The southern sea shifted. Try that action again.");
    console.error(error);
  },
});

function commitNewChoice(direction) {
  if (isNewInputBlocked()) return;
  void swipeController.commit(direction);
}

function announceUnavailableDirection(direction) {
  const availability = getDirectionAvailability(
    state,
    currentCard,
    direction,
  );
  feedback.announce(
    availability.requirementText ||
      "That direction has no action on this card.",
  );
}

const handleArrowKey = createArrowKeyHandler({
  isInputBlocked: isNewInputBlocked,
  isEditableTarget: (target) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement,
  isDirectionAvailable: (direction) =>
    getDirectionAvailability(state, currentCard, direction).available,
  onChoose: commitNewChoice,
  onBlocked: announceUnavailableDirection,
});

const handleChoiceClick = createChoiceClickHandler({
  container: elements.choiceControls,
  isInputBlocked: isNewInputBlocked,
  isDirectionAvailable: (direction) =>
    getDirectionAvailability(state, currentCard, direction).available,
  onChoose: commitNewChoice,
  onBlocked: announceUnavailableDirection,
});
elements.choiceControls.addEventListener("click", handleChoiceClick);

document.addEventListener("keydown", (event) => {
  handleArrowKey(event);
});

async function dismissCurrentFeedback() {
  if (!state.pendingFeedback || feedbackDismissalActive || inputLocked) return;
  const expectedFeedbackId = state.pendingFeedback.id;
  feedbackDismissalActive = true;
  inputLocked = true;
  updateControlLocks();
  try {
    const dismissed = Engine.dismissChoiceFeedback(state, {
      expectedFeedbackId,
    });
    if (dismissed.ignored) return;
    state = dismissed.state;
    currentCard = dismissed.card;
    saveState(state);
    swipeController.resetForNextCard();
    renderAll();
    await settleCardArt();
  } finally {
    inputLocked = false;
    feedbackDismissalActive = false;
    updateControlLocks();
    renderer.focusPrimarySurface();
  }
}

async function restartLostRun() {
  if (inputLocked || state.status !== "lost" || state.pendingFeedback) return;
  inputLocked = true;
  updateControlLocks();
  try {
    const restarted = Engine.restartGame(state, { seed: randomSeed() });
    if (restarted.ignored) return;
    state = restarted.state;
    currentCard = restarted.card;
    saveState(state);
    feedback.clear();
    swipeController.resetForNextCard();
    renderAll();
    await settleCardArt();
  } finally {
    inputLocked = false;
    updateControlLocks();
    renderer.focusPrimarySurface();
  }
}

elements.choiceFeedbackContinue.addEventListener("click", () => {
  void dismissCurrentFeedback();
});
elements.terminalRestart.addEventListener("click", () => {
  void restartLostRun();
});

renderAll();
saveState(state);
renderer.focusPrimarySurface();
