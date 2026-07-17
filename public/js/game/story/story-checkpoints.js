import { STORY_BEAT_IDS, STORY_CHECKPOINT_IDS } from "./constants.js";

export const STORY_CHECKPOINT_VERSION = 1;

const TRANSIENT_STATE_KEYS = new Set([
  "animation",
  "animationState",
  "drag",
  "dragState",
  "gesture",
  "gestureState",
  "pointer",
  "pointerState",
  "transitionAnimation",
]);

function cloneSerializable(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function withoutTransientState(state) {
  const cloned = cloneSerializable(state);
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) return null;
  for (const key of TRANSIENT_STATE_KEYS) delete cloned[key];
  if (cloned.ui && typeof cloned.ui === "object") {
    for (const key of TRANSIENT_STATE_KEYS) delete cloned.ui[key];
  }
  return cloned;
}

function storyPhaseIds(source = STORY_BEAT_IDS) {
  const entries = Array.isArray(source)
    ? source
    : Array.isArray(source?.beats)
      ? source.beats
      : Array.isArray(source?.storyPhases)
        ? source.storyPhases
        : STORY_BEAT_IDS;
  const ids = entries
    .map((entry) => typeof entry === "string" ? entry : entry?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

function checkpointIdsFor(source = STORY_BEAT_IDS) {
  const ids = storyPhaseIds(source);
  return Object.fromEntries(ids.map((id, index) => [
    id,
    STORY_CHECKPOINT_IDS[id] ??
      `${String(index + 1).padStart(2, "0")}-${id
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}`,
  ]));
}

export function getCheckpointIdForBeat(beatOrId, phases = STORY_BEAT_IDS) {
  const beatId = typeof beatOrId === "string" ? beatOrId : beatOrId?.id;
  const ids = checkpointIdsFor(phases);
  if (ids[beatId]) return ids[beatId];
  if (Object.values(ids).includes(beatId)) return beatId;
  return null;
}

export function getBeatIdForCheckpoint(checkpointId, phases = STORY_BEAT_IDS) {
  return (
    Object.entries(checkpointIdsFor(phases)).find(([, id]) => id === checkpointId)?.[0] ??
    null
  );
}

/** Capture a deterministic, JSON-safe run snapshot including RNG state. */
export function createStoryCheckpoint(
  state,
  beatOrCheckpointId = state?.story?.currentBeatId,
  { phases = STORY_BEAT_IDS } = {},
) {
  if (!state?.story || state.rngState === undefined || state.rngState === null) {
    throw new TypeError("A story checkpoint requires story state and an RNG state.");
  }
  const phaseIds = storyPhaseIds(phases);
  const id = getCheckpointIdForBeat(beatOrCheckpointId, phaseIds);
  if (!id) throw new RangeError(`Unknown story checkpoint: ${String(beatOrCheckpointId)}`);
  const beatId = getBeatIdForCheckpoint(id, phaseIds);
  const snapshot = withoutTransientState(state);
  if (!snapshot) throw new TypeError("Story state is not serializable.");

  return {
    checkpointVersion: STORY_CHECKPOINT_VERSION,
    id,
    beatId,
    arcId: state.story.arcId ?? null,
    storyPhaseIds: phaseIds,
    rngState: snapshot.rngState,
    snapshot,
  };
}

/**
 * Restore the complete run while retaining the caller's current global meta.
 * Debug snapshots can therefore never roll discoveries or records backward.
 */
export function restoreStoryCheckpoint(checkpoint, currentState = {}) {
  const phaseIds = storyPhaseIds(checkpoint?.storyPhaseIds);
  if (
    !checkpoint ||
    checkpoint.checkpointVersion !== STORY_CHECKPOINT_VERSION ||
    !phaseIds.includes(checkpoint.beatId) ||
    getCheckpointIdForBeat(checkpoint.beatId, phaseIds) !== checkpoint.id
  ) {
    throw new TypeError("Invalid story checkpoint.");
  }
  const restored = withoutTransientState(checkpoint.snapshot);
  if (!restored?.story || restored.rngState === undefined || restored.rngState === null) {
    throw new TypeError("Story checkpoint snapshot is incomplete.");
  }
  const currentMeta = cloneSerializable(currentState?.meta);
  restored.meta = currentMeta ?? cloneSerializable(restored.meta) ?? {};
  return restored;
}

export function isStoryCheckpointDebugEnabled(options = {}) {
  const hostname = String(
    options.hostname ?? options.location?.hostname ?? globalThis.location?.hostname ?? "",
  ).toLowerCase();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  if (!local) return false;

  if (options.optIn === true || options.enabled === true) return true;
  const search = String(options.search ?? options.location?.search ?? globalThis.location?.search ?? "");
  const parameters = new URLSearchParams(search);
  return ["storyDebug", "debug-checkpoints"].some((key) =>
    ["1", "true"].includes(String(parameters.get(key)).toLowerCase()),
  );
}

export const createCheckpoint = createStoryCheckpoint;
export const restoreCheckpoint = restoreStoryCheckpoint;
