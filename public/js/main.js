import { CARDS } from "./data/cards.js";
import { ENEMIES, ENEMY_BY_ID } from "./data/enemies.js";
import { ITEMS, ITEM_BY_ID } from "./data/items.js";
import * as Engine from "./game/engine.js";
import { resourceChanges } from "./game/effects.js";
import { getDerivedStats } from "./game/equipment.js";
import { xpThreshold } from "./game/progression.js";
import { normalizeState } from "./game/state.js";
import { clearState, loadState, saveState } from "./storage.js";
import { createFeedbackController, diffHud, hudSnapshot } from "./ui/feedback.js";
import { createInventoryDrawer } from "./ui/inventory-drawer.js";
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
const enemyById = normalizeLookup(ENEMY_BY_ID);
const allowedArtIds = new Set([
  "player",
  ...CARDS.map(({ artId }) => artId),
  ...ENEMIES.map(({ artId }) => artId),
  ...ITEMS.map(({ artId }) => artId),
].filter((artId) => typeof artId === "string"));
const renderer = createRenderer({ itemById, enemyById, allowedArtIds });
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

function isBlocked() {
  return (
    inputLocked ||
    drawerPaused ||
    swipeController?.isCommitting === true ||
    Boolean(document.getElementById("confirm-dialog")?.open)
  );
}

function updateControlLocks() {
  const blocked = isBlocked();
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
    elements.card.dataset.swipeState = "entering";
    globalThis.setTimeout(() => {
      if (elements.card.dataset.swipeState === "entering") elements.card.dataset.swipeState = "idle";
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
  if (inputLocked || drawerPaused) return;
  inputLocked = true;
  updateControlLocks();
  const previousState = state;
  const beforeHud = hudSnapshot(state);

  try {
    const resolution = Engine.resolveChoice(state, direction, undefined, {
      expectedToken: currentCard?.resolutionToken,
    });
    if (resolution.ignored) return;

    state = resolution.state;
    currentCard = resolution.card;
    const terminalRestart = ["gameOver", "victory"].includes(previousState.mode);
    const computedChanges = terminalRestart ? {} : diffHud(beforeHud, hudSnapshot(state));
    const changes = terminalRestart ? {} : { ...computedChanges, ...(resolution.changes ?? {}) };
    if (state.player.level > previousState.player.level && changes.xp < 0) changes.xp = computedChanges.xp;
    saveState(state);
    showModeFeedback(previousState, state);
    await prepareNextCard();
    feedback.show(
      resolution.resultText || resolution.resolvedCard?.resultText || "The Prism Road answers your choice.",
      changes,
      feedbackKind(changes, state.mode, resolution.feedbackTone),
    );
  } finally {
    inputLocked = false;
    swipeController.resetForNextCard();
    elements.card.dataset.swipeState = "entering";
    updateControlLocks();
    restoreCommitFocus();
  }
}

swipeController = createSwipeController({
  card: elements.card,
  isInputLocked: isBlocked,
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

elements.leftButton.addEventListener("click", () => void swipeController.commit("left"));
elements.rightButton.addEventListener("click", () => void swipeController.commit("right"));

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.repeat || isBlocked()) return;
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
  void swipeController.commit(direction);
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
}

document.getElementById("new-run").addEventListener("click", () => void beginFreshRun());
document.getElementById("reset-data").addEventListener("click", () => void beginFreshRun({ resetMeta: true }));

renderAll({ announceEntry: true });
saveState(state);
