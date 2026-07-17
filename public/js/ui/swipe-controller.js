const COMMIT_RATIO = 0.28;
const FLICK_VELOCITY = 0.65;
const FLICK_MIN_DISTANCE = 34;
const DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);

function directionFromDelta(dx, dy, deadZone = 3) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= deadZone) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function axisValue(direction, x, y) {
  return direction === "left" || direction === "right" ? x : y;
}

function directionSign(direction) {
  return direction === "left" || direction === "up" ? -1 : 1;
}

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
  let previousY = 0;
  let previousTime = 0;
  let cardWidth = 1;
  let cardHeight = 1;
  let frameId = 0;
  let committing = false;
  let destroyed = false;

  const clearVariables = () => {
    card.style.removeProperty("--card-x");
    card.style.removeProperty("--card-y");
    card.style.removeProperty("--card-rotation");
    card.style.removeProperty("--choice-up-opacity");
    card.style.removeProperty("--choice-down-opacity");
    card.style.removeProperty("--choice-left-opacity");
    card.style.removeProperty("--choice-right-opacity");
  };

  const applyDrag = () => {
    frameId = 0;
    if (pointerId === null) return;
    const dx = latestX - startX;
    const dy = latestY - startY;
    const direction = directionFromDelta(dx, dy);
    const previewDirection =
      direction && canCommit(direction) ? direction : null;
    const horizontal = direction === "left" || direction === "right";
    const primaryDistance = horizontal ? dx : dy;
    const primarySize = horizontal ? cardWidth : cardHeight;
    const strength = direction
      ? Math.min(1, Math.abs(primaryDistance) / (primarySize * COMMIT_RATIO))
      : 0;
    const renderedX = horizontal ? dx : Math.max(-20, Math.min(20, dx * 0.18));
    const renderedY = horizontal ? Math.max(-20, Math.min(20, dy * 0.18)) : dy;
    const rotation = horizontal
      ? Math.max(-7, Math.min(7, (dx / cardWidth) * 10))
      : Math.max(-2, Math.min(2, (dx / cardWidth) * 3));

    card.style.setProperty("--card-x", `${renderedX}px`);
    card.style.setProperty("--card-y", `${renderedY}px`);
    card.style.setProperty("--card-rotation", `${rotation}deg`);
    for (const candidate of DIRECTIONS) {
      card.style.setProperty(
        `--choice-${candidate}-opacity`,
        candidate === previewDirection ? String(strength) : "0",
      );
    }
    card.dataset.previewDirection = previewDirection ?? "none";
    onPreview(previewDirection, previewDirection ? strength : 0);
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

  const releaseCommittedCard = () => {
    if (!committing) return;
    committing = false;
    if (card.dataset.swipeState === "committing") {
      resetToCenter();
      return;
    }
    pointerId = null;
    clearVariables();
    card.dataset.previewDirection = "none";
    onPreview(null, 0);
  };

  const commit = async (direction) => {
    if (destroyed || committing || isInputLocked()) return false;
    if (!DIRECTIONS.includes(direction)) return false;
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
    const bounds = card.getBoundingClientRect();
    const horizontal = direction === "left" || direction === "right";
    const viewportSize = horizontal
      ? globalThis.innerWidth || 0
      : globalThis.innerHeight || 0;
    const cardSize = horizontal ? bounds.width : bounds.height;
    const exitDistance = Math.max(viewportSize, cardSize * 1.7) + 80;
    const signedExit = directionSign(direction) * exitDistance;
    card.style.setProperty("--card-x", `${horizontal ? signedExit : 0}px`);
    card.style.setProperty("--card-y", `${horizontal ? -12 : signedExit}px`);
    card.style.setProperty(
      "--card-rotation",
      `${direction === "left" ? -7 : direction === "right" ? 7 : 0}deg`,
    );
    card.dataset.previewDirection = direction;
    for (const candidate of DIRECTIONS) {
      card.style.setProperty(
        `--choice-${candidate}-opacity`,
        candidate === direction ? "1" : "0",
      );
    }
    onPreview(direction, 1);

    await waitForExit(card);
    if (destroyed || !committing) {
      committing = false;
      return false;
    }
    try {
      const result = await onCommit(direction);
      if (destroyed) return false;
      releaseCommittedCard();
      return result !== false;
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
    startY = latestY = previousY = event.clientY;
    startTime = latestTime = previousTime = event.timeStamp;
    const bounds = card.getBoundingClientRect();
    cardWidth = Math.max(1, card.offsetWidth || bounds.width);
    cardHeight = Math.max(1, card.offsetHeight || bounds.height);
    card.dataset.swipeState = "dragging";
    card.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== pointerId || committing) return;
    previousX = latestX;
    previousY = latestY;
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
    const dy = latestY - startY;
    const direction = directionFromDelta(dx, dy, 0);
    if (!direction) {
      resetToCenter();
      event.preventDefault();
      return;
    }
    const overallDistance = axisValue(direction, dx, dy);
    const recentDistance = axisValue(
      direction,
      latestX - previousX,
      latestY - previousY,
    );
    const elapsed = Math.max(1, latestTime - previousTime);
    const recentVelocity = recentDistance / elapsed;
    const overallVelocity = overallDistance / Math.max(1, latestTime - startTime);
    const velocity = Math.abs(recentVelocity) > Math.abs(overallVelocity) ? recentVelocity : overallVelocity;
    const primarySize =
      direction === "left" || direction === "right" ? cardWidth : cardHeight;
    const threshold = Math.max(64, primarySize * COMMIT_RATIO);
    const crossedDistance = Math.abs(overallDistance) >= threshold;
    const deliberateFlick =
      Math.abs(overallDistance) >= FLICK_MIN_DISTANCE &&
      Math.abs(velocity) >= FLICK_VELOCITY;

    if (!card.hasPointerCapture || card.hasPointerCapture(event.pointerId)) {
      card.releasePointerCapture?.(event.pointerId);
    }
    pointerId = null;
    if (allowCommit && (crossedDistance || deliberateFlick)) {
      void commit(direction).then((didCommit) => {
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
  const onLostPointerCapture = (event) => {
    if (event.pointerId === pointerId && !committing) resetToCenter();
  };

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerCancel);
  card.addEventListener("lostpointercapture", onLostPointerCapture);
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
      releaseCommittedCard();
      pointerId = null;
      if (frameId) globalThis.cancelAnimationFrame(frameId);
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", onPointerUp);
      card.removeEventListener("pointercancel", onPointerCancel);
      card.removeEventListener("lostpointercapture", onLostPointerCapture);
      card.removeEventListener("dragstart", preventDrag);
    },
  };
}
