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
    /import \{ createArrowKeyHandler \} from "\.\/ui\/directional-input\.js";/u,
  );
  assert.doesNotMatch(source, /createChoiceClickHandler/u);
  assert.match(source, /const handleArrowKey = createArrowKeyHandler\(\{/u);
  assert.match(source, /isDirectionAvailable: \(direction\) =>/u);
  assert.match(source, /onChoose: commitNewChoice/u);
  assert.match(source, /onBlocked: announceUnavailableDirection/u);
  assert.match(source, /document\.addEventListener\("keydown"/u);
  assert.doesNotMatch(source, /key\.toLowerCase|["']a["']|["']d["']/u);
});

test("swipes and arrow keys share canonical direction availability", () => {
  assert.match(
    source,
    /import \{ getDirectionAvailability \} from "\.\/game\/choice-availability\.js";/u,
  );
  assert.match(
    source,
    /canCommit: \(direction\) =>\s*getDirectionAvailability\(state, currentCard, direction\)\.available/u,
  );
  assert.match(
    source,
    /isDirectionAvailable: \(direction\) =>\s*getDirectionAvailability\(state, currentCard, direction\)\.available/u,
  );
  assert.doesNotMatch(source, /choice\.disabled|choiceForDirection/u);
});

test("two-sided face art joins the allowlist and only the front commits in flip mode", () => {
  assert.match(source, /Object\.values\(card\.faces \?\? \{\}\)/u);
  assert.match(source, /\.map\(\(face\) => face\.artId\)/u);
  assert.match(source, /function getCardCommitMode\(direction\)/u);
  assert.match(
    source,
    /const canTurnPhotograph = currentCard\?\.introFace === "front"/u,
  );
  assert.match(
    source,
    /return horizontal && canTurnPhotograph \? "flip" : "exit"/u,
  );
  assert.doesNotMatch(
    source,
    /currentCard\?\.introFace === "reverse"/u,
  );
  assert.match(source, /getCommitMode: getCardCommitMode/u);
  assert.match(source, /onCommitSettled: \(mode\) =>/u);
});

test("main has no directional-button input or lock path", () => {
  assert.doesNotMatch(
    source,
    /createChoiceClickHandler|handleChoiceClick|elements\.choiceControls|elements\.choiceButtons|button\.disabled\s*=|button\[data-direction\]|addEventListener\("click",\s*handleChoice/u,
  );
  assert.match(source, /elements\.choiceFeedbackContinue\.disabled/u);
  assert.match(source, /elements\.terminalRestart\.disabled/u);
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

test("flip commits let the controller finish presentation before resetting controls", () => {
  const body = functionSource("commitChoice", "dismissCurrentFeedback");
  assert.match(body, /async function commitChoice\(direction, \{ mode = "exit" \} = \{\}\)/u);
  assert.match(body, /if \(mode !== "flip"\) swipeController\.resetForNextCard\(\)/u);
  assert.match(body, /if \(mode !== "flip"\) renderer\.focusPrimarySurface\(\)/u);
  assert.match(body, /onCommitSettled: \(mode\) =>/u);
  assert.match(body, /if \(mode !== "flip"\) return/u);
});

test("startup normalizes, prepares, persists, renders, and focuses the restored surface", () => {
  assert.match(source, /loadState\(\{/u);
  assert.match(source, /Engine\.getNextCard\(state\)/u);
  assert.match(
    source,
    /renderAll\(\);\s*saveState\(state\);\s*renderer\.focusPrimarySurface\(\);/u,
  );
});
