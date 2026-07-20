export function hasBlockingSurface({
  terminalActive = false,
  confirmationOpen = false,
  secondaryViewActive = false,
} = {}) {
  return Boolean(
    terminalActive || confirmationOpen || secondaryViewActive
  );
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
