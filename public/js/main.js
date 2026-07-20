import { DEEP_SOUTH_STORY } from "./data/deep-south.js";
import * as Engine from "./game/engine.js";
import { normalizeState } from "./game/state.js";
import { planDirection } from "./game/direction-plan.js";
import { loadState, saveState } from "./storage.js";
import {
  createFeedbackController,
  diffHud,
  hudSnapshot,
} from "./ui/feedback.js";
import { createArrowKeyHandler } from "./ui/directional-input.js";
import {
  isActiveCommitResolutionBlocked as activeCommitResolutionIsBlocked,
  isNewInputBlocked as newInputIsBlocked,
} from "./ui/interaction-lock.js";
import { createRenderer } from "./ui/render.js";
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
  ...(deck.cards ?? []).flatMap((card) => [
    ...Object.values(card.faces ?? {}).map((face) => face.artId),
  ]),
]);
const allowedArtIds = new Set(
  authoredArtIds.filter(
    (artId) => typeof artId === "string" && artId,
  ),
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
let swipeController;

function interactionLockState() {
  return {
    inputLocked,
    controllerCommitting: swipeController?.isCommitting === true,
    terminalActive: state.status === "lost" && !state.terminalPending,
  };
}

function isNewInputBlocked() {
  return newInputIsBlocked(interactionLockState());
}

function isActiveCommitResolutionBlocked() {
  return activeCommitResolutionIsBlocked(interactionLockState());
}

function updateControlLocks() {
  elements.terminalRestart.disabled = Boolean(
    state.status !== "lost" || state.terminalPending || inputLocked,
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
    // Story copy and drag/keyboard input remain usable when decorative art
    // cannot decode.
  }
}

function getCardCommitMode(direction) {
  return planDirection(state, currentCard, direction).mode === "flip"
    ? "flip"
    : "exit";
}

async function commitChoice(direction, { mode = "exit" } = {}) {
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
    if (resolution.effectDetail) {
      feedback.showTransient(resolution.effectDetail, changes);
    } else {
      feedback.pulseChanges(changes);
    }
    await settleCardArt();
    return true;
  } catch (error) {
    feedback.announce("The southern sea shifted. Try that action again.");
    console.error(error);
    return false;
  } finally {
    inputLocked = false;
    if (mode !== "flip") swipeController.resetForNextCard();
    updateControlLocks();
    if (mode !== "flip") renderer.focusPrimarySurface();
  }
}

swipeController = createSwipeController({
  card: elements.card,
  isInputLocked: isNewInputBlocked,
  getCommitMode: getCardCommitMode,
  canCommit: (direction) =>
    planDirection(state, currentCard, direction).available,
  onBlocked: announceUnavailableDirection,
  onPreview: (direction) => renderer.previewChoice(direction),
  onCommit: commitChoice,
  onCommitSettled: (mode) => {
    if (mode !== "flip") return;
    updateControlLocks();
    renderer.focusPrimarySurface();
  },
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
  const availability = planDirection(
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
    planDirection(state, currentCard, direction).available,
  onChoose: commitNewChoice,
  onBlocked: announceUnavailableDirection,
});

document.addEventListener("keydown", (event) => {
  handleArrowKey(event);
});

async function restartLostRun() {
  if (inputLocked || state.status !== "lost" || state.terminalPending) return;
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

elements.terminalRestart.addEventListener("click", () => {
  void restartLostRun();
});

renderAll();
saveState(state);
renderer.focusPrimarySurface();
