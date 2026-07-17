import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "public", "js", "main.js"), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = nextName
    ? source.indexOf(`async function ${nextName}`, start + 1)
    : source.length;
  assert.ok(start >= 0, `${name} is missing`);
  assert.ok(end > start, `${name} boundary is missing`);
  return source.slice(start, end);
}

test("main wires one canonical Deep South engine without retired subsystems", () => {
  assert.match(source, /DEEP_SOUTH_STORY/u);
  assert.match(source, /normalizeState/u);
  assert.match(source, /createSwipeController/u);
  assert.doesNotMatch(
    source,
    /inventory|equipment|combat|storyTransition|checkpoint|progression/ui,
  );
});

test("keyboard input uses the tested canonical arrow-key adapter", () => {
  assert.match(
    source,
    /import\s*\{[\s\S]*?createArrowKeyHandler,[\s\S]*?createChoiceClickHandler,[\s\S]*?\}\s*from "\.\/ui\/directional-input\.js";/u,
  );
  assert.match(source, /const handleArrowKey = createArrowKeyHandler\(\{/u);
  assert.match(source, /isDirectionAvailable: \(direction\) =>/u);
  assert.match(source, /onChoose: commitNewChoice/u);
  assert.match(source, /onBlocked: announceUnavailableDirection/u);
  assert.match(source, /document\.addEventListener\("keydown"/u);
  assert.doesNotMatch(source, /key\.toLowerCase|["']a["']|["']d["']/u);
});

test("buttons, swipes, and arrow keys share canonical direction availability", () => {
  assert.match(
    source,
    /import \{ getDirectionAvailability \} from "\.\/game\/choice-availability\.js";/u,
  );
  assert.match(
    source,
    /button\.disabled = blocked \|\| !availability\.available/u,
  );
  assert.match(
    source,
    /canCommit: \(direction\) =>\s*getDirectionAvailability\(state, currentCard, direction\)\.available/u,
  );
  assert.doesNotMatch(source, /choice\.disabled|choiceForDirection/u);
});

test("direction buttons use one guarded group handler rather than active handlers on unavailable slots", () => {
  assert.match(
    source,
    /const handleChoiceClick = createChoiceClickHandler\(\{/u,
  );
  assert.match(
    source,
    /elements\.choiceControls\.addEventListener\("click", handleChoiceClick\)/u,
  );
  assert.doesNotMatch(
    source,
    /button\.addEventListener\("click"/u,
  );
});

test("outcome Continue uses the narrow dismissal API and never commits a direction", () => {
  const dismissal = functionSource(
    "dismissCurrentFeedback",
    "restartLostRun",
  );
  assert.match(dismissal, /Engine\.dismissChoiceFeedback/u);
  assert.doesNotMatch(dismissal, /resolveChoice|swipeController\.commit/u);
  assert.match(dismissal, /expectedFeedbackId/u);
});

test("primary-surface focus occurs after controls unlock", () => {
  for (const [name, next] of [
    ["commitChoice", "dismissCurrentFeedback"],
    ["dismissCurrentFeedback", "restartLostRun"],
    ["restartLostRun", null],
  ]) {
    const body = functionSource(name, next);
    const unlock = body.lastIndexOf("inputLocked = false");
    const focus = body.lastIndexOf("renderer.focusPrimarySurface()");
    assert.ok(unlock >= 0, `${name} never unlocks`);
    assert.ok(focus > unlock, `${name} focuses a disabled primary action`);
  }
});

test("startup normalizes, prepares, persists, renders, and focuses the restored surface", () => {
  assert.match(source, /loadState\(\{/u);
  assert.match(source, /Engine\.getNextCard\(state\)/u);
  assert.match(
    source,
    /renderAll\(\);\s*saveState\(state\);\s*renderer\.focusPrimarySurface\(\);/u,
  );
});
