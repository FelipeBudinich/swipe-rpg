export function hasBlockingSurface({
  drawerPaused = false,
  storyTransitionActive = false,
  terminalActive = false,
  confirmationOpen = false,
} = {}) {
  return Boolean(
    drawerPaused ||
    storyTransitionActive ||
    terminalActive ||
    confirmationOpen
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
