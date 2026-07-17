import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasBlockingSurface,
  isActiveCommitResolutionBlocked,
  isNewInputBlocked,
} from "../public/js/ui/interaction-lock.js";

const MAIN_SOURCE = readFileSync(new URL("../public/js/main.js", import.meta.url), "utf8");

test("controller commit blocks new input but not its own active resolution", () => {
  const lockState = {
    controllerCommitting: true,
    inputLocked: false,
    drawerPaused: false,
    storyTransitionActive: false,
    terminalActive: false,
    confirmationOpen: false,
  };

  assert.equal(hasBlockingSurface(lockState), false);
  assert.equal(isNewInputBlocked(lockState), true);
  assert.equal(isActiveCommitResolutionBlocked(lockState), false);
});

test("application locks and blocking surfaces stop both entry paths", () => {
  const blockers = [
    "inputLocked",
    "drawerPaused",
    "storyTransitionActive",
    "terminalActive",
    "confirmationOpen",
    "feedbackActive",
  ];

  for (const blocker of blockers) {
    const lockState = { [blocker]: true };
    assert.equal(isNewInputBlocked(lockState), true, `${blocker} blocks new input`);
    assert.equal(
      isActiveCommitResolutionBlocked(lockState),
      true,
      `${blocker} blocks active resolution`,
    );
  }
});

test("pending choice feedback blocks generic input while its dedicated acknowledgement stays separate", () => {
  const lockState = {
    feedbackActive: true,
    controllerCommitting: false,
    inputLocked: false,
  };

  assert.equal(hasBlockingSurface(lockState), true);
  assert.equal(isNewInputBlocked(lockState), true);
  assert.equal(isActiveCommitResolutionBlocked(lockState), true);
});

test("an idle interactive surface permits new input and active resolution", () => {
  assert.equal(isNewInputBlocked({}), false);
  assert.equal(isActiveCommitResolutionBlocked({}), false);
});

test("main commit flow uses the active-resolution guard and guaranteed cleanup", () => {
  const start = MAIN_SOURCE.indexOf("async function commitChoice(direction)");
  const end = MAIN_SOURCE.indexOf("\nswipeController = createSwipeController", start);
  const commitSource = MAIN_SOURCE.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(
    commitSource,
    /if \(isActiveCommitResolutionBlocked\(\)\) return false;/,
  );
  assert.doesNotMatch(commitSource, /if \(isNewInputBlocked\(\)\)/);
  assert.match(commitSource, /inputLocked = true;\s+try \{/);
  assert.match(commitSource, /expectedToken: currentCard\?\.resolutionToken/);
  assert.match(commitSource, /if \(resolution\.ignored\) return false;/);
  assert.match(commitSource, /saveState\(state\)/);
  assert.match(commitSource, /await prepareNextCard\(\)/);
  assert.match(commitSource, /return true;\s+\} finally \{/);
  assert.match(commitSource, /inputLocked = false;/);
  assert.match(commitSource, /swipeController\.resetForNextCard\(\)/);
  assert.match(commitSource, /updateControlLocks\(\)/);
  assert.match(commitSource, /restoreCommitFocus\(\)/);

  const recoveries = [...commitSource.matchAll(/Engine\.getNextCard\(state\)/g)];
  assert.equal(recoveries.length, 1);
  assert.match(commitSource, /without producing a card or a valid special surface/);
  assert.match(commitSource, /const preserveEntering =/);
});

test("button and keyboard routes enter through the guarded controller commit", () => {
  assert.match(
    MAIN_SOURCE,
    /function commitNewChoice\(direction\) \{\s+if \(isNewInputBlocked\(\)\) return;\s+void swipeController\.commit\(direction\);/,
  );
  assert.match(
    MAIN_SOURCE,
    /leftButton\.addEventListener\("click", \(\) => commitNewChoice\("left"\)\)/,
  );
  assert.match(
    MAIN_SOURCE,
    /rightButton\.addEventListener\("click", \(\) => commitNewChoice\("right"\)\)/,
  );
  assert.match(
    MAIN_SOURCE,
    /document\.addEventListener\("keydown",[\s\S]*?commitNewChoice\(direction\);\s+\}\);/,
  );
  assert.doesNotMatch(
    MAIN_SOURCE,
    /getElementById\("inventory-open"\)\.addEventListener\("click"/,
  );
  assert.match(
    MAIN_SOURCE,
    /createInventoryDrawer\(\{[\s\S]*?openButton: document\.getElementById\("inventory-open"\)/,
  );
});

test("choice-feedback Continue uses its dedicated dismissal path, never choice commit routing", () => {
  const start = MAIN_SOURCE.indexOf("async function dismissCurrentChoiceFeedback()");
  const end = MAIN_SOURCE.indexOf("\nasync function restartFromTerminal()", start);
  const dismissalSource = MAIN_SOURCE.slice(start, end);
  const keyStart = MAIN_SOURCE.indexOf('document.addEventListener("keydown"');
  const keyEnd = MAIN_SOURCE.indexOf(
    'document.getElementById("inventory-content").addEventListener',
    keyStart,
  );
  const keySource = MAIN_SOURCE.slice(keyStart, keyEnd);

  assert.ok(start >= 0 && end > start);
  assert.match(dismissalSource, /!state\.pendingChoiceFeedback/);
  assert.match(dismissalSource, /feedbackDismissalActive/);
  assert.match(dismissalSource, /document\.getElementById\("confirm-dialog"\)\?\.open/);
  assert.match(
    dismissalSource,
    /Engine\.dismissChoiceFeedback\(state, \{ expectedFeedbackId \}\)/,
  );
  assert.match(dismissalSource, /saveState\(state\)/);
  assert.match(dismissalSource, /renderer\.focusPrimarySurface\(\)/);
  assert.doesNotMatch(dismissalSource, /resolveChoice|swipeController\.commit|commitNewChoice/);

  const continueBindings =
    MAIN_SOURCE.match(
      /choiceFeedbackContinue\.addEventListener\("click", \(\) => void dismissCurrentChoiceFeedback\(\)\)/g,
    ) ?? [];
  assert.equal(continueBindings.length, 1);
  assert.doesNotMatch(keySource, /dismissCurrentChoiceFeedback|choiceFeedbackContinue/);
});

test("Pack uses the shared commit lock while remaining outside choice routing", () => {
  const lockStart = MAIN_SOURCE.indexOf("function updateControlLocks()");
  const lockEnd = MAIN_SOURCE.indexOf("function beginCommitLock()", lockStart);
  const lockSource = MAIN_SOURCE.slice(lockStart, lockEnd);
  const keyStart = MAIN_SOURCE.indexOf('document.addEventListener("keydown"');
  const keyEnd = MAIN_SOURCE.indexOf(
    'document.getElementById("inventory-content").addEventListener',
    keyStart,
  );
  const keySource = MAIN_SOURCE.slice(keyStart, keyEnd);

  assert.ok(lockStart >= 0 && lockEnd > lockStart);
  assert.match(lockSource, /getElementById\("inventory-open"\)\.disabled = blocked/);
  assert.equal(isNewInputBlocked({ controllerCommitting: true }), true);
  assert.match(keySource, /ArrowLeft[\s\S]*?"left"[\s\S]*?ArrowRight[\s\S]*?"right"/);
  assert.doesNotMatch(keySource, /inventory-open|drawerController|\.open\(/);

  const leftBindings = MAIN_SOURCE.match(/leftButton\.addEventListener\("click"/g) ?? [];
  const rightBindings = MAIN_SOURCE.match(/rightButton\.addEventListener\("click"/g) ?? [];
  assert.equal(leftBindings.length, 1);
  assert.equal(rightBindings.length, 1);
});

test("successor entry uses a generation-guarded bounded timer", () => {
  assert.match(MAIN_SOURCE, /const generation = \+\+cardEntryGeneration;/);
  assert.match(MAIN_SOURCE, /generation === cardEntryGeneration/);
  assert.match(
    MAIN_SOURCE,
    /elements\.card\.dataset\.swipeState = "idle";[\s\S]*?\}, 200\);/,
  );
});

test("main routes gold feedback to the Pack button without removed HUD nodes", () => {
  assert.match(
    MAIN_SOURCE,
    /gold: document\.getElementById\("inventory-open"\)/,
  );
  assert.doesNotMatch(MAIN_SOURCE, /getElementById\("hud-gold"\)/);
  assert.match(MAIN_SOURCE, /if \(drawerController\?\.isOpen\) renderer\.renderInventory\(state/);
  assert.match(
    MAIN_SOURCE,
    /onOpen\(\) \{[\s\S]*?renderer\.renderInventory\(state, \{ derivedStats: getDerivedStats\(state, ITEMS\) \}\)/,
  );
});
