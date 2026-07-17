const RESOURCES = Object.freeze(["eldritchLore", "crew", "sanity"]);
const DELTA_ELEMENT_IDS = Object.freeze({
  eldritchLore: "hud-eldritch-lore-delta",
  crew: "hud-crew-delta",
  sanity: "hud-sanity-delta",
});

export function hudSnapshot(state) {
  return Object.fromEntries(
    RESOURCES.map((resource) => [resource, Number(state?.resources?.[resource] ?? 0)]),
  );
}

export function diffHud(before, after) {
  return Object.fromEntries(
    RESOURCES.flatMap((resource) => {
      const delta = Number(after?.[resource] ?? 0) - Number(before?.[resource] ?? 0);
      return delta === 0 ? [] : [[resource, delta]];
    }),
  );
}

export function createFeedbackController({ resultElement, resourceElements = {} }) {
  let announcementGeneration = 0;
  const pulseTimers = new Map();

  const pulse = (resource, delta) => {
    if (!delta) return;
    const valueElement = resourceElements[resource];
    if (!valueElement) return;
    const element = valueElement.closest?.("[data-resource]") ?? valueElement;
    const deltaElement = document.getElementById(DELTA_ELEMENT_IDS[resource]);
    delete element.dataset.changed;
    void element.offsetWidth;
    element.dataset.changed = delta > 0 ? "gain" : "loss";
    if (deltaElement) {
      deltaElement.textContent = `${delta > 0 ? "+" : ""}${delta}`;
      deltaElement.dataset.visible = "true";
    }
    globalThis.clearTimeout(pulseTimers.get(resource));
    pulseTimers.set(
      resource,
      globalThis.setTimeout(() => {
        delete element.dataset.changed;
        if (deltaElement) {
          deltaElement.textContent = "";
          delete deltaElement.dataset.visible;
        }
      }, 900),
    );
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
    for (const resource of RESOURCES) pulse(resource, Number(changes[resource] ?? 0));
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
