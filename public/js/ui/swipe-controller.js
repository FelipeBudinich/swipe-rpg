const COMMIT_RATIO = 0.28;
const FLICK_VELOCITY = 0.65;
const FLICK_MIN_DISTANCE = 34;

function waitForExit(element) {
  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reducedMotion) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener("transitionend", onEnd);
      globalThis.clearTimeout(timeoutId);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === element && event.propertyName === "transform") finish();
    };
    const timeoutId = globalThis.setTimeout(finish, 360);
    element.addEventListener("transitionend", onEnd);
  });
}

export function createSwipeController({
  card,
  onCommit,
  onCommitStart = () => {},
  onPreview = () => {},
  isInputLocked = () => false,
  canCommit = () => true,
  onBlocked = () => {},
  onError = (error) => globalThis.console?.error(error),
}) {
  if (!card) throw new Error("A draggable card element is required");

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let latestX = 0;
  let latestY = 0;
  let latestTime = 0;
  let previousX = 0;
  let previousTime = 0;
  let cardWidth = 1;
  let frameId = 0;
  let committing = false;
  let destroyed = false;

  const clearVariables = () => {
    card.style.removeProperty("--card-x");
    card.style.removeProperty("--card-y");
    card.style.removeProperty("--card-rotation");
    card.style.removeProperty("--choice-left-opacity");
    card.style.removeProperty("--choice-right-opacity");
  };

  const applyDrag = () => {
    frameId = 0;
    if (pointerId === null) return;
    const dx = latestX - startX;
    const dy = Math.max(-20, Math.min(20, (latestY - startY) * 0.18));
    const width = cardWidth;
    const strength = Math.min(1, Math.abs(dx) / (width * COMMIT_RATIO));
    const rotation = Math.max(-7, Math.min(7, (dx / width) * 10));

    card.style.setProperty("--card-x", `${dx}px`);
    card.style.setProperty("--card-y", `${dy}px`);
    card.style.setProperty("--card-rotation", `${rotation}deg`);
    card.style.setProperty("--choice-left-opacity", dx < 0 ? String(strength) : "0");
    card.style.setProperty("--choice-right-opacity", dx > 0 ? String(strength) : "0");
    card.dataset.previewDirection = dx < -3 ? "left" : dx > 3 ? "right" : "none";
    onPreview(dx < -3 ? "left" : dx > 3 ? "right" : null, strength);
  };

  const requestDragFrame = () => {
    if (!frameId) frameId = globalThis.requestAnimationFrame(applyDrag);
  };

  const resetToCenter = () => {
    if (frameId) globalThis.cancelAnimationFrame(frameId);
    frameId = 0;
    pointerId = null;
    card.dataset.swipeState = "idle";
    clearVariables();
    card.dataset.previewDirection = "none";
    onPreview(null, 0);
  };

  const commit = async (direction) => {
    if (destroyed || committing || isInputLocked()) return false;
    if (direction !== "left" && direction !== "right") return false;
    if (!canCommit(direction)) {
      resetToCenter();
      onBlocked(direction);
      return false;
    }

    committing = true;
    onCommitStart(direction);
    pointerId = null;
    if (frameId) globalThis.cancelAnimationFrame(frameId);
    frameId = 0;
    card.dataset.swipeState = "committing";
    const exitDistance = Math.max(globalThis.innerWidth || 0, card.getBoundingClientRect().width * 1.7) + 80;
    card.style.setProperty("--card-x", `${direction === "left" ? -exitDistance : exitDistance}px`);
    card.style.setProperty("--card-y", "-12px");
    card.style.setProperty("--card-rotation", `${direction === "left" ? -7 : 7}deg`);
    card.dataset.previewDirection = direction;
    card.style.setProperty("--choice-left-opacity", direction === "left" ? "1" : "0");
    card.style.setProperty("--choice-right-opacity", direction === "right" ? "1" : "0");
    onPreview(direction, 1);

    await waitForExit(card);
    if (destroyed) return false;
    try {
      await onCommit(direction);
      return true;
    } catch (error) {
      committing = false;
      resetToCenter();
      onError(error);
      return false;
    }
  };

  const onPointerDown = (event) => {
    if (destroyed || committing || isInputLocked() || event.button > 0) return;
    pointerId = event.pointerId;
    startX = latestX = previousX = event.clientX;
    startY = latestY = event.clientY;
    startTime = latestTime = previousTime = event.timeStamp;
    cardWidth = Math.max(1, card.offsetWidth || card.getBoundingClientRect().width);
    card.dataset.swipeState = "dragging";
    card.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== pointerId || committing) return;
    previousX = latestX;
    previousTime = latestTime;
    latestX = event.clientX;
    latestY = event.clientY;
    latestTime = event.timeStamp;
    requestDragFrame();
    event.preventDefault();
  };

  const finishPointer = (event, allowCommit) => {
    if (event.pointerId !== pointerId || committing) return;
    latestX = event.clientX;
    latestY = event.clientY;
    latestTime = event.timeStamp;
    const dx = latestX - startX;
    const elapsed = Math.max(1, latestTime - previousTime);
    const recentVelocity = (latestX - previousX) / elapsed;
    const overallVelocity = dx / Math.max(1, latestTime - startTime);
    const velocity = Math.abs(recentVelocity) > Math.abs(overallVelocity) ? recentVelocity : overallVelocity;
    const threshold = Math.max(64, cardWidth * COMMIT_RATIO);
    const crossedDistance = Math.abs(dx) >= threshold;
    const deliberateFlick = Math.abs(dx) >= FLICK_MIN_DISTANCE && Math.abs(velocity) >= FLICK_VELOCITY;

    if (!card.hasPointerCapture || card.hasPointerCapture(event.pointerId)) {
      card.releasePointerCapture?.(event.pointerId);
    }
    pointerId = null;
    if (allowCommit && (crossedDistance || deliberateFlick)) {
      void commit(dx < 0 ? "left" : "right").then((didCommit) => {
        if (!didCommit && !committing) resetToCenter();
      });
    } else {
      resetToCenter();
    }
    event.preventDefault();
  };

  const onPointerUp = (event) => finishPointer(event, true);
  const onPointerCancel = (event) => finishPointer(event, false);
  const preventDrag = (event) => event.preventDefault();

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerCancel);
  card.addEventListener("lostpointercapture", (event) => {
    if (event.pointerId === pointerId && !committing) resetToCenter();
  });
  card.addEventListener("dragstart", preventDrag);

  return {
    commit,
    resetForNextCard() {
      committing = false;
      resetToCenter();
    },
    cancel() {
      if (!committing) resetToCenter();
    },
    get isCommitting() {
      return committing;
    },
    destroy() {
      destroyed = true;
      if (frameId) globalThis.cancelAnimationFrame(frameId);
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", onPointerUp);
      card.removeEventListener("pointercancel", onPointerCancel);
      card.removeEventListener("dragstart", preventDrag);
    },
  };
}
