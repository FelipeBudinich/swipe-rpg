import { EMBER_CROWN_ARC } from "./data/arcs/ember-crown.js";
import {
  EMBER_CROWN_CARDS,
} from "./data/cards/ember-crown-cards.js";
import {
  EMBER_CROWN_ENEMIES,
  EMBER_CROWN_ENEMY_BY_ID,
} from "./data/ember-crown-enemies.js";
import { ITEMS, ITEM_BY_ID } from "./data/items.js";
import * as Engine from "./game/engine.js";
import { resourceChanges } from "./game/effects.js";
import { getDerivedStats } from "./game/equipment.js";
import { xpThreshold } from "./game/progression.js";
import { normalizeState } from "./game/state.js";
import {
  createStoryCheckpoint,
  getCheckpointIdForBeat,
  restoreStoryCheckpoint,
} from "./game/story/story-checkpoints.js";
import { validateArcDefinition } from "./game/story/arc-validator.js";
import { clearState, loadState, saveState } from "./storage.js";
import { createDebugCheckpointControls } from "./ui/debug-checkpoint-ui.js";
import { createFeedbackController, diffHud, hudSnapshot } from "./ui/feedback.js";
import { createInventoryDrawer } from "./ui/inventory-drawer.js";
import {
  isActiveCommitResolutionBlocked as activeCommitResolutionIsBlocked,
  isNewInputBlocked as newInputIsBlocked,
} from "./ui/interaction-lock.js";
import { createRenderer } from "./ui/render.js";
import { isStoryTransitionActive } from "./ui/story-transition.js";
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

function stateFrom(result) {
  return result?.state ?? result;
}

function cardFrom(result, fallback = null) {
  return result?.card ?? fallback;
}

function feedbackKind(changes, mode, engineTone = "") {
  if (["danger", "death"].includes(engineTone)) return "danger";
  if (["reward", "loot", "level-up", "victory"].includes(engineTone)) return "reward";
  if (mode === "gameOver") return "danger";
  if (mode === "victory") return "reward";
  if ((changes.hp ?? 0) < 0) return "damage";
  if ((changes.hp ?? 0) > 0 || (changes.mp ?? 0) > 0) return "recovery";
  if ((changes.gold ?? 0) > 0 || (changes.xp ?? 0) > 0) return "reward";
  return "normal";
}

function normalizeLookup(lookup) {
  return lookup instanceof Map ? Object.fromEntries(lookup) : lookup;
}

const itemById = normalizeLookup(ITEM_BY_ID);
const enemyById = normalizeLookup(EMBER_CROWN_ENEMY_BY_ID);
const arcById = { [EMBER_CROWN_ARC.id]: EMBER_CROWN_ARC };
const localDevelopmentHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
  globalThis.location.hostname,
);
if (localDevelopmentHost) {
  validateArcDefinition(EMBER_CROWN_ARC, EMBER_CROWN_CARDS, {
    enemies: EMBER_CROWN_ENEMIES,
    items: ITEMS,
    enforceContentCount: true,
  });
}
const allowedArtIds = new Set([
  "player",
  ...EMBER_CROWN_CARDS.map(({ artId }) => artId),
  ...EMBER_CROWN_ENEMIES.map(({ artId }) => artId),
  ...ITEMS.map(({ artId }) => artId),
].filter((artId) => typeof artId === "string"));
const renderer = createRenderer({
  itemById,
  enemyById,
  allowedArtIds,
  arcById,
  calculateStoryProgress: Engine.calculateStoryProgress,
});
const { elements } = renderer;

const feedback = createFeedbackController({
  resultElement: document.getElementById("result-live"),
  resourceElements: {
    hp: document.getElementById("hud-hp"),
    mp: document.getElementById("hud-mp"),
    xp: document.getElementById("hud-xp"),
    gold: document.getElementById("hud-gold"),
  },
});

const initialSeed = randomSeed();
const initialGame = Engine.createGame({ seed: initialSeed });
let state = loadState({
  createFallback: () => initialGame.state,
  normalize: (raw, fallback) => normalizeState(raw, { seed: fallback.runSeed }),
});
let selected = Engine.getNextCard(state);
state = selected.state;
let currentCard = selected.card;
let inputLocked = false;
let drawerPaused = false;
let drawerController;
let swipeController;
let commitFocusTarget = null;
let cardEntryGeneration = 0;

function interactionLockState() {
  return {
    inputLocked,
    controllerCommitting: swipeController?.isCommitting === true,
    drawerPaused,
    storyTransitionActive: isStoryTransitionActive(state),
    terminalActive: ["gameOver", "victory"].includes(state.mode),
    confirmationOpen: Boolean(document.getElementById("confirm-dialog")?.open),
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
  elements.leftButton.disabled = blocked || currentCard?.left?.disabled === true;
  elements.rightButton.disabled = blocked || currentCard?.right?.disabled === true;
  document.getElementById("inventory-open").disabled = blocked;
}

function beginCommitLock() {
  const active = document.activeElement;
  commitFocusTarget = [
    elements.card,
    elements.leftButton,
    elements.rightButton,
    document.getElementById("inventory-open"),
  ].includes(active)
    ? active
    : null;
  updateControlLocks();
}

function restoreCommitFocus() {
  const target = commitFocusTarget;
  commitFocusTarget = null;
  if (elements.card.hidden || elements.card.hasAttribute("inert")) {
    renderer.focusPrimarySurface();
    return;
  }
  if (!target?.isConnected) return;
  if (target instanceof HTMLButtonElement && target.disabled) elements.card.focus();
  else target.focus();
}

function renderAll({ announceEntry = false } = {}) {
  const derivedStats = getDerivedStats(state, ITEMS);
  renderer.render(state, currentCard, {
    derivedStats,
    xpNeeded: xpThreshold(state.player.level),
  });
  if (drawerController?.isOpen) renderer.renderInventory(state, { derivedStats });
  updateControlLocks();

  if (announceEntry) {
    const generation = ++cardEntryGeneration;
    elements.card.dataset.swipeState = "entering";
    globalThis.setTimeout(() => {
      if (
        generation === cardEntryGeneration &&
        elements.card.dataset.swipeState === "entering"
      ) {
        elements.card.dataset.swipeState = "idle";
      }
    }, 200);
  }
}

function showModeFeedback(previousState, nextState) {
  let effect = "";
  if (nextState.mode === "gameOver") effect = "death";
  else if (nextState.mode === "victory") effect = "victory";
  else if (nextState.mode === "levelUp") effect = "level-up";
  else if ((nextState.player.inventory?.length ?? 0) > (previousState.player.inventory?.length ?? 0)) effect = "item";
  if (!effect) return;
  elements.app.dataset.feedback = effect;
  globalThis.setTimeout(() => {
    if (elements.app.dataset.feedback === effect) delete elements.app.dataset.feedback;
  }, 700);
}

async function prepareNextCard() {
  renderAll({ announceEntry: true });
  try {
    await Promise.race([
      elements.cardArt.decode?.() ?? Promise.resolve(),
      new Promise((resolve) => globalThis.setTimeout(resolve, 80)),
    ]);
  } catch {
    // The card remains fully readable if a decorative SVG cannot decode.
  }
}

async function commitChoice(direction) {
  if (isActiveCommitResolutionBlocked()) return false;
  inputLocked = true;

  try {
    updateControlLocks();
    const previousState = state;
    const beforeHud = hudSnapshot(state);
    const resolution = Engine.resolveChoice(state, direction, undefined, {
      expectedToken: currentCard?.resolutionToken,
    });
    if (resolution.ignored) return false;

    state = resolution.state;
    currentCard = resolution.card;
    if (
      !currentCard &&
      !isStoryTransitionActive(state) &&
      !["gameOver", "victory"].includes(state.mode)
    ) {
      console.error(
        "The engine resolved a choice without producing a card or a valid special surface; attempting one recovery.",
      );
      const recovered = Engine.getNextCard(state);
      state = recovered.state;
      currentCard = recovered.card;
      if (
        !currentCard &&
        !isStoryTransitionActive(state) &&
        !["gameOver", "victory"].includes(state.mode)
      ) {
        throw new Error("The engine could not recover a successor card or special surface.");
      }
    }
    const terminalRestart = ["gameOver", "victory"].includes(previousState.mode);
    const computedChanges = terminalRestart ? {} : diffHud(beforeHud, hudSnapshot(state));
    const changes = terminalRestart ? {} : { ...computedChanges, ...(resolution.changes ?? {}) };
    if (state.player.level > previousState.player.level && changes.xp < 0) changes.xp = computedChanges.xp;
    saveState(state);
    showModeFeedback(previousState, state);
    await prepareNextCard();
    feedback.show(
      resolution.resultText || resolution.resolvedCard?.resultText || "The Ember Crown answers your choice.",
      changes,
      feedbackKind(changes, state.mode, resolution.feedbackTone),
    );
    return true;
  } finally {
    inputLocked = false;
    const preserveEntering = elements.card.dataset.swipeState === "entering";
    swipeController.resetForNextCard();
    if (preserveEntering) elements.card.dataset.swipeState = "entering";
    updateControlLocks();
    restoreCommitFocus();
  }
}

swipeController = createSwipeController({
  card: elements.card,
  isInputLocked: isNewInputBlocked,
  canCommit: (direction) => Boolean(currentCard?.[direction]) && currentCard[direction].disabled !== true,
  onBlocked: (direction) => {
    const choice = currentCard?.[direction];
    feedback.show(choice?.disabledReason || `${choice?.label || "That choice"} is unavailable right now.`, {}, "danger");
  },
  onPreview: (direction) => renderer.previewChoice(direction),
  onCommitStart: beginCommitLock,
  onCommit: commitChoice,
  onError: (error) => {
    updateControlLocks();
    feedback.show("The road shivered. Your choice was not lost—try again.", {}, "danger");
    console.error(error);
  },
});

drawerController = createInventoryDrawer({
  drawer: document.getElementById("inventory-drawer"),
  panel: document.querySelector("#inventory-drawer > div"),
  openButton: document.getElementById("inventory-open"),
  closeButton: document.getElementById("inventory-close"),
  onOpen() {
    drawerPaused = true;
    swipeController.cancel();
    renderer.renderInventory(state, { derivedStats: getDerivedStats(state, ITEMS) });
    updateControlLocks();
  },
  onClose() {
    drawerPaused = false;
    updateControlLocks();
  },
});

function commitNewChoice(direction) {
  if (isNewInputBlocked()) return;
  void swipeController.commit(direction);
}

elements.leftButton.addEventListener("click", () => commitNewChoice("left"));
elements.rightButton.addEventListener("click", () => commitNewChoice("right"));

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.repeat || isNewInputBlocked()) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  const direction = event.key === "ArrowLeft" || key === "a"
    ? "left"
    : event.key === "ArrowRight" || key === "d"
      ? "right"
      : null;
  if (!direction) return;
  event.preventDefault();
  commitNewChoice(direction);
});

document.getElementById("inventory-content").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-inventory-action]");
  if (!button || inputLocked) return;
  const actionButtonsBefore = [...document.querySelectorAll("#inventory-content button[data-inventory-action]")];
  const actionIndex = actionButtonsBefore.indexOf(button);
  const itemId = button.dataset.itemId;
  const item = itemById[itemId];
  if (!item) return;

  inputLocked = true;
  button.disabled = true;
  const previousState = state;
  const before = hudSnapshot(state);
  let message;
  let closeDrawerAfterUnlock = false;

  try {
    if (button.dataset.inventoryAction === "equip") {
      const outcome = Engine.equipInventoryItem(state, itemId);
      state = outcome.state;
      const refreshed = Engine.getNextCard(state);
      state = refreshed.state;
      currentCard = refreshed.card;
      message = outcome.equipped ? `${item.name} is now equipped.` : `${item.name} cannot be equipped.`;
    } else {
      const outcome = Engine.useInventoryItem(state, itemId);
      state = stateFrom(outcome);
      currentCard = cardFrom(outcome, currentCard);
      message = outcome.resultText || (outcome.used ? `${item.name} takes effect.` : `${item.name} cannot be used now.`);
    }

    const changes = { ...diffHud(before, hudSnapshot(state)), ...resourceChanges(previousState, state, ITEMS) };
    saveState(state);
    showModeFeedback(previousState, state);
    renderAll();
    feedback.show(message, changes, button.dataset.inventoryAction === "equip" ? "reward" : feedbackKind(changes, state.mode));
    if (state.mode === "gameOver" || state.mode === "victory") {
      closeDrawerAfterUnlock = true;
    } else {
      const actionButtonsAfter = [...document.querySelectorAll("#inventory-content button[data-inventory-action]")];
      const sameAction = actionButtonsAfter.find(
        (candidate) =>
          candidate.dataset.inventoryAction === button.dataset.inventoryAction &&
          candidate.dataset.itemId === itemId,
      );
      const nextAtPosition = actionButtonsAfter[Math.min(Math.max(0, actionIndex), actionButtonsAfter.length - 1)];
      (sameAction ?? nextAtPosition ?? document.getElementById("inventory-close")).focus();
    }
  } finally {
    inputLocked = false;
    updateControlLocks();
    if (closeDrawerAfterUnlock) drawerController.close();
  }
});

const confirmDialog = document.getElementById("confirm-dialog");
let confirmationResolve = null;

function finishConfirmation(accepted) {
  if (!confirmationResolve) return;
  const resolve = confirmationResolve;
  confirmationResolve = null;
  confirmDialog.close();
  resolve(accepted);
}

document.getElementById("confirm-cancel").addEventListener("click", () => finishConfirmation(false));
document.getElementById("confirm-accept").addEventListener("click", () => finishConfirmation(true));
confirmDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishConfirmation(false);
});

function confirmAction({ title, message, acceptLabel }) {
  if (confirmationResolve) return Promise.resolve(false);
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-accept").textContent = acceptLabel;
  confirmDialog.showModal();
  updateControlLocks();
  return new Promise((resolve) => {
    confirmationResolve = (accepted) => {
      updateControlLocks();
      resolve(accepted);
    };
  });
}

async function beginFreshRun({ resetMeta = false } = {}) {
  const accepted = await confirmAction({
    title: resetMeta ? "Reset every discovery?" : "Begin a new journey?",
    message: resetMeta
      ? "This erases the active run, best records, and every discovery on this device."
      : "This ends the active run. Enemy and item discoveries remain in your records.",
    acceptLabel: resetMeta ? "Reset all" : "New run",
  });
  if (!accepted) return;

  if (resetMeta) clearState();
  const restarted = resetMeta
    ? Engine.createGame({ seed: randomSeed() })
    : Engine.restartGame(state, { seed: randomSeed() });
  state = restarted.state;
  currentCard = restarted.card;
  saveState(state);
  drawerController.close();
  feedback.clear();
  swipeController.resetForNextCard();
  renderAll({ announceEntry: true });
  renderer.focusPrimarySurface();
}

async function dismissCurrentTransition() {
  if (inputLocked || !isStoryTransitionActive(state)) return;
  inputLocked = true;
  updateControlLocks();
  try {
    const next = Engine.dismissStoryTransition(state);
    state = next.state;
    currentCard = next.card;
    saveState(state);
    swipeController.resetForNextCard();
    renderAll({ announceEntry: true });
    renderer.focusPrimarySurface();
  } finally {
    inputLocked = false;
    updateControlLocks();
  }
}

async function restartFromTerminal() {
  if (inputLocked || !["gameOver", "victory"].includes(state.mode)) return;
  inputLocked = true;
  updateControlLocks();
  try {
    const restarted = Engine.restartGame(state, { seed: randomSeed() });
    state = restarted.state;
    currentCard = restarted.card;
    saveState(state);
    drawerController.close();
    feedback.clear();
    swipeController.resetForNextCard();
    renderAll({ announceEntry: true });
    renderer.focusPrimarySurface();
  } finally {
    inputLocked = false;
    updateControlLocks();
  }
}

const DEBUG_CHECKPOINT_KEY_PREFIX = "jrpg-story-checkpoint-v1:";
const debugCheckpoints = createDebugCheckpointControls({
  onSave(checkpointId) {
    if (getCheckpointIdForBeat(state.story?.currentBeatId) !== checkpointId) {
      throw new RangeError("Select the checkpoint matching the current story beat.");
    }
    const checkpoint = createStoryCheckpoint(state, checkpointId);
    globalThis.localStorage.setItem(
      `${DEBUG_CHECKPOINT_KEY_PREFIX}${checkpointId}`,
      JSON.stringify(checkpoint),
    );
  },
  onRestore(checkpointId) {
    const serialized = globalThis.localStorage.getItem(
      `${DEBUG_CHECKPOINT_KEY_PREFIX}${checkpointId}`,
    );
    if (!serialized) throw new RangeError("That local checkpoint has not been saved.");
    const checkpoint = JSON.parse(serialized);
    const restored = restoreStoryCheckpoint(checkpoint, state);
    const normalized = normalizeState(restored, {
      seed: restored.runSeed,
      arcId: EMBER_CROWN_ARC.id,
    });
    const next = Engine.getNextCard(normalized);
    state = next.state;
    currentCard = next.card;
    saveState(state);
    drawerController.close();
    feedback.clear();
    swipeController.resetForNextCard();
    renderAll({ announceEntry: true });
    renderer.focusPrimarySurface();
  },
});

document.getElementById("new-run").addEventListener("click", () => void beginFreshRun());
document.getElementById("reset-data").addEventListener("click", () => void beginFreshRun({ resetMeta: true }));
elements.transitionContinue.addEventListener("click", () => void dismissCurrentTransition());
elements.terminalRestart.addEventListener("click", () => void restartFromTerminal());

renderAll({ announceEntry: true });
saveState(state);
renderer.focusPrimarySurface();
