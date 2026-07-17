const RESOURCES = ["hp", "mp", "xp", "gold"];

export function hudSnapshot(state) {
  return {
    level: state.player.level,
    hp: state.player.hp,
    mp: state.player.mp,
    xp: state.player.xp,
    gold: state.player.gold,
  };
}

export function diffHud(before, after) {
  const changes = Object.fromEntries(
    RESOURCES.map((resource) => [resource, (after[resource] ?? 0) - (before[resource] ?? 0)]),
  );
  changes.level = (after.level ?? 0) - (before.level ?? 0);
  if ((after.level ?? 0) > (before.level ?? 0) && changes.xp < 0) changes.xp = after.xp ?? 0;
  return changes;
}

export function createFeedbackController({ resultElement, resourceElements = {} }) {
  let announcementGeneration = 0;
  const pulseTimers = new Map();

  const pulse = (resource, delta, { showDelta = true } = {}) => {
    if (!delta) return;
    const valueElement = resourceElements[resource];
    if (!valueElement) return;
    const element = valueElement.closest?.("[data-resource]") ?? valueElement;
    const deltaElement = document.getElementById(`hud-${resource}-delta`);
    delete element.dataset.changed;
    void element.offsetWidth;
    element.dataset.changed = delta > 0 ? "gain" : "loss";
    if (deltaElement && showDelta) {
      deltaElement.textContent = `${delta > 0 ? "+" : ""}${delta}`;
      deltaElement.dataset.visible = "true";
    }
    globalThis.clearTimeout(pulseTimers.get(resource));
    pulseTimers.set(resource, globalThis.setTimeout(() => {
      delete element.dataset.changed;
      if (deltaElement && showDelta) {
        deltaElement.textContent = "";
        delete deltaElement.dataset.visible;
      }
    }, 900));
  };

  const announce = (message) => {
    const text = typeof message === "string" ? message : "";
    const generation = ++announcementGeneration;
    if (!text) {
      resultElement.textContent = "";
      return;
    }
    if (resultElement.textContent !== text) {
      resultElement.textContent = text;
      return;
    }
    resultElement.textContent = "";
    globalThis.queueMicrotask(() => {
      if (generation === announcementGeneration) resultElement.textContent = text;
    });
  };

  const pulseChanges = (changes = {}) => {
    for (const resource of RESOURCES) pulse(resource, changes[resource] ?? 0);
    if ((changes.level ?? 0) !== 0 && (changes.xp ?? 0) === 0) {
      pulse("xp", changes.level, { showDelta: false });
    }
  };

  const showTransient = (message, changes = {}) => {
    pulseChanges(changes);
    announce(message);
  };

  return {
    announce,
    pulseChanges,
    showTransient,
    show: showTransient,
    clear() {
      announcementGeneration += 1;
      resultElement.textContent = "";
    },
  };
}
