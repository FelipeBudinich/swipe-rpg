export function hasBlockingSurface({
  terminalActive = false,
  feedbackActive = false,
  confirmationOpen = false,
} = {}) {
  return Boolean(terminalActive || feedbackActive || confirmationOpen);
}

export function isNewInputBlocked(lockState = {}) {
  return Boolean(
    lockState.inputLocked ||
    lockState.controllerCommitting ||
    hasBlockingSurface(lockState)
  );
}

export function isActiveCommitResolutionBlocked(lockState = {}) {
  return Boolean(lockState.inputLocked || hasBlockingSurface(lockState));
}
