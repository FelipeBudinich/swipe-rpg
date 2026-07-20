import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  join(root, "public", "js", "main.js"),
  "utf8",
);

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const resolvedStart =
    asyncStart >= 0 && (start < 0 || asyncStart < start)
      ? asyncStart
      : start;
  const markers = nextName
    ? [
        source.indexOf(`function ${nextName}`, resolvedStart + 1),
        source.indexOf(`async function ${nextName}`, resolvedStart + 1),
      ].filter((index) => index > resolvedStart)
    : [];
  const end = markers.length > 0 ? Math.min(...markers) : source.length;
  assert.ok(resolvedStart >= 0, `${name} is missing`);
  return source.slice(resolvedStart, end);
}

test("main wires the canonical story, state, planner, renderer, and swipe controller", () => {
  assert.match(source, /DEEP_SOUTH_STORY/u);
  assert.match(source, /normalizeState/u);
  assert.match(source, /planDirection/u);
  assert.match(source, /createRenderer/u);
  assert.match(source, /createSwipeController/u);
  assert.match(source, /createViewTabs/u);
  assert.doesNotMatch(
    source,
    /inventory|equipment|combat|storyTransition|checkpoint|progression/ui,
  );
});

test("swipe and keyboard availability both consume canonical plans", () => {
  assert.match(
    source,
    /canCommit: \(direction\) =>\s*planDirection\(state, currentCard, direction\)\.available/u,
  );
  assert.match(
    source,
    /isDirectionAvailable: \(direction\) =>\s*planDirection\(state, currentCard, direction\)\.available/u,
  );
  assert.match(
    source,
    /const availability = planDirection\(\s*state,\s*currentCard,\s*direction/u,
  );
  assert.doesNotMatch(source, /choice\.disabled|choiceForDirection/u);
});

test("commit mode is derived from flip plans and never treats a back as flippable", () => {
  const body = functionSource("getCardCommitMode", "commitChoice");
  assert.match(
    body,
    /planDirection\(state, currentCard, direction\)\.mode === "flip"/u,
  );
  assert.match(body, /\? "flip"\s*: "exit"/u);
  assert.doesNotMatch(body, /cardFace === "back"|introFace/u);
  assert.match(source, /getCommitMode: getCardCommitMode/u);
});

test("successful resolution saves and renders its immediate returned card", () => {
  const body = functionSource("commitChoice", "commitNewChoice");
  assert.match(body, /Engine\.resolveChoice/u);
  assert.match(body, /state = resolution\.state/u);
  assert.match(body, /currentCard = resolution\.card/u);
  assert.match(body, /saveState\(state\)/u);
  assert.match(body, /renderAll\(\)/u);
  assert.doesNotMatch(
    body,
    /dismiss|Continue|expectedFeedbackId|pendingFeedback/u,
  );
});

test("flip commits retain controller settlement while navigation resets and refocuses", () => {
  const body = functionSource("commitChoice", "commitNewChoice");
  assert.match(
    body,
    /async function commitChoice\(direction, \{ mode = "exit" \} = \{\}\)/u,
  );
  assert.match(
    body,
    /if \(mode !== "flip"\) swipeController\.resetForNextCard\(\)/u,
  );
  assert.match(
    body,
    /if \(mode !== "flip"\) renderer\.focusPrimarySurface\(\)/u,
  );
  assert.match(source, /onCommitSettled: \(mode\) =>/u);
});

test("main contains no outcome surface, dismissal API, or directional buttons", () => {
  assert.doesNotMatch(
    source,
    /pendingFeedback|dismissChoiceFeedback|continueFromFeedback|choiceFeedbackContinue|FEEDBACK_ART_BY_TONE|createPendingFeedback|renderFeedback/u,
  );
  assert.doesNotMatch(
    source,
    /createChoiceClickHandler|handleChoiceClick|choiceControls|choiceButtons|button\[data-direction\]/u,
  );
  assert.match(source, /elements\.terminalRestart\.disabled/u);
});

test("keyboard arrows use one tested adapter and blocked feedback is concise", () => {
  assert.match(
    source,
    /import \{ createArrowKeyHandler \} from "\.\/ui\/directional-input\.js";/u,
  );
  assert.match(source, /document\.addEventListener\("keydown"/u);
  assert.match(source, /onChoose: commitNewChoice/u);
  assert.match(source, /onBlocked: announceUnavailableDirection/u);
  assert.match(source, /isEditableTarget: isUiControlTarget/u);
  assert.match(source, /\["button", "a", "input", "textarea", "select"\]/u);
  assert.doesNotMatch(
    source,
    /key\.toLowerCase|event\.key\s*===\s*["'][ad]["']/u,
  );
});

test("secondary views reset card presentation and block only story input", () => {
  assert.match(source, /secondaryViewActive:\s*viewTabs\?\.activeView !== "location"/u);
  assert.match(source, /swipeController\.resetForNextCard\(\)/u);
  assert.match(source, /renderer\.clearPreview\(\)/u);
  assert.match(source, /onCommitStart: updateControlLocks/u);
  assert.match(
    source,
    /viewTabs\?\.setDisabled\(\s*inputLocked \|\| swipeController\?\.isCommitting === true/u,
  );
  assert.match(source, /map: elements\.mapPanel/u);
  assert.match(source, /log: elements\.logPanel/u);
});

test("Log restart uses the unconditional engine path with timed confirmation", () => {
  assert.match(source, /Engine\.restartRun\(state, \{ seed: randomSeed\(\) \}\)/u);
  assert.match(source, /Engine\.restartGame\(state, \{ seed: randomSeed\(\) \}\)/u);
  assert.match(source, /Confirm Restart/u);
  assert.match(source, /5000/u);
  assert.match(source, /viewTabs\.activate\("location"\)/u);
  assert.doesNotMatch(source, /effectLog\s*=|effectLog\.push/u);
});

test("startup normalizes, prepares, persists, renders, and focuses", () => {
  assert.match(source, /loadState\(\{/u);
  assert.match(source, /Engine\.getNextCard\(state\)/u);
  assert.match(
    source,
    /renderAll\(\);\s*saveState\(state\);\s*renderer\.focusPrimarySurface\(\);/u,
  );
});
