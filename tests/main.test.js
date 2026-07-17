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

test("keyboard input maps exactly the four arrow keys", () => {
  for (const [key, direction] of [
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ]) {
    assert.match(source, new RegExp(`${key}: "${direction}"`, "u"));
  }
  assert.doesNotMatch(source, /key\.toLowerCase|["']a["']|["']d["']/u);
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
