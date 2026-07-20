import test from "node:test";
import assert from "node:assert/strict";

import {
  hasBlockingSurface,
  isActiveCommitResolutionBlocked,
  isNewInputBlocked,
} from "../public/js/ui/interaction-lock.js";

test("terminal, confirmation, and secondary-view surfaces block story input", () => {
  assert.equal(hasBlockingSurface({ terminalActive: true }), true);
  assert.equal(hasBlockingSurface({ confirmationOpen: true }), true);
  assert.equal(isNewInputBlocked({ terminalActive: true }), true);
  assert.equal(isNewInputBlocked({ confirmationOpen: true }), true);
  assert.equal(hasBlockingSurface({ secondaryViewActive: true }), true);
  assert.equal(isNewInputBlocked({ secondaryViewActive: true }), true);
  assert.equal(
    isActiveCommitResolutionBlocked({ secondaryViewActive: true }),
    true,
  );
  assert.equal(hasBlockingSurface({ feedbackActive: true }), false);
});

test("an active controller commit blocks a second entry but not its own resolution", () => {
  const lock = {
    controllerCommitting: true,
    inputLocked: false,
    terminalActive: false,
  };
  assert.equal(isNewInputBlocked(lock), true);
  assert.equal(isActiveCommitResolutionBlocked(lock), false);
});

test("the application lock blocks both entry and active resolution", () => {
  const lock = { inputLocked: true };
  assert.equal(isNewInputBlocked(lock), true);
  assert.equal(isActiveCommitResolutionBlocked(lock), true);
});

test("an ordinary playable surface permits new input", () => {
  assert.equal(isNewInputBlocked({}), false);
  assert.equal(isActiveCommitResolutionBlocked({}), false);
});
