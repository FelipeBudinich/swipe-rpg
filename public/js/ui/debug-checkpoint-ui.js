import { STORY_BEAT_NAMES } from "./story-transition.js";

export const DEBUG_CHECKPOINTS = Object.freeze(
  STORY_BEAT_NAMES.map((name, index) => Object.freeze({
    id: `${String(index + 1).padStart(2, "0")}-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
    name,
  })),
);

function isLocalHostname(hostname) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost");
}

export function isDebugCheckpointUiEnabled(locationLike = globalThis.location) {
  if (!isLocalHostname(locationLike?.hostname)) return false;
  try {
    return new URLSearchParams(locationLike?.search ?? "").get("debug-checkpoints") === "1";
  } catch {
    return false;
  }
}

function getElement(documentObject, id) {
  return documentObject?.getElementById?.(id) ?? null;
}

export function createDebugCheckpointControls({
  documentObject = globalThis.document,
  locationLike = globalThis.location,
  checkpoints = DEBUG_CHECKPOINTS,
  onSave,
  onRestore,
} = {}) {
  const container = getElement(documentObject, "debug-checkpoints");
  const select = getElement(documentObject, "debug-checkpoint-select");
  const saveButton = getElement(documentObject, "debug-checkpoint-save");
  const restoreButton = getElement(documentObject, "debug-checkpoint-restore");
  const status = getElement(documentObject, "debug-checkpoint-status");
  const enabled = isDebugCheckpointUiEnabled(locationLike);

  if (!container || !select || !saveButton || !restoreButton || !status || !enabled) {
    if (container) container.hidden = true;
    return Object.freeze({ enabled: false, destroy() {} });
  }

  const normalizedCheckpoints = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter((checkpoint) => typeof checkpoint?.id === "string" && typeof checkpoint?.name === "string");
  select.replaceChildren();
  for (const checkpoint of normalizedCheckpoints) {
    const option = documentObject.createElement("option");
    option.value = checkpoint.id;
    option.textContent = `${checkpoint.id} · ${checkpoint.name}`;
    select.append(option);
  }
  container.hidden = false;

  let busy = false;
  const setBusy = (nextBusy) => {
    busy = nextBusy;
    saveButton.disabled = nextBusy;
    restoreButton.disabled = nextBusy;
    select.disabled = nextBusy;
  };

  const perform = async (action, callback) => {
    if (busy || typeof callback !== "function") return;
    const checkpointId = select.value;
    if (!checkpointId) return;
    setBusy(true);
    status.textContent = `${action} ${checkpointId}…`;
    try {
      await callback(checkpointId);
      status.textContent = `${checkpointId} ${action === "Saving" ? "saved" : "restored"}.`;
    } catch (error) {
      status.textContent = `Could not ${action.toLowerCase()} ${checkpointId}.`;
      console.error("Local checkpoint action failed", error);
    } finally {
      setBusy(false);
    }
  };

  const saveListener = () => void perform("Saving", onSave);
  const restoreListener = () => void perform("Restoring", onRestore);
  saveButton.addEventListener("click", saveListener);
  restoreButton.addEventListener("click", restoreListener);

  return Object.freeze({
    enabled: true,
    announce(message) {
      status.textContent = String(message ?? "");
    },
    destroy() {
      saveButton.removeEventListener("click", saveListener);
      restoreButton.removeEventListener("click", restoreListener);
      container.hidden = true;
    },
  });
}
