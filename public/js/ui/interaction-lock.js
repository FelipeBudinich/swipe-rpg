export function hasBlockingSurface({
  terminalActive = false,
  confirmationOpen = false,
} = {}) {
  return Boolean(terminalActive || confirmationOpen);
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
