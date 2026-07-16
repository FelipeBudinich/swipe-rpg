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

export function getCheckpointIdForBeat(beatOrId) {
  const beatId = typeof beatOrId === "string" ? beatOrId : beatOrId?.id;
  if (STORY_CHECKPOINT_IDS[beatId]) return STORY_CHECKPOINT_IDS[beatId];
  if (Object.values(STORY_CHECKPOINT_IDS).includes(beatId)) return beatId;
  return null;
}

export function getBeatIdForCheckpoint(checkpointId) {
  return (
    Object.entries(STORY_CHECKPOINT_IDS).find(([, id]) => id === checkpointId)?.[0] ??
    null
  );
}

/** Capture a deterministic, JSON-safe run snapshot including RNG state. */
export function createStoryCheckpoint(state, beatOrCheckpointId = state?.story?.currentBeatId) {
  if (!state?.story || state.rngState === undefined || state.rngState === null) {
    throw new TypeError("A story checkpoint requires story state and an RNG state.");
  }
  const id = getCheckpointIdForBeat(beatOrCheckpointId);
  if (!id) throw new RangeError(`Unknown story checkpoint: ${String(beatOrCheckpointId)}`);
  const beatId = getBeatIdForCheckpoint(id);
  const snapshot = withoutTransientState(state);
  if (!snapshot) throw new TypeError("Story state is not serializable.");

  return {
    checkpointVersion: STORY_CHECKPOINT_VERSION,
    id,
    beatId,
    arcId: state.story.arcId ?? null,
    rngState: snapshot.rngState,
    snapshot,
  };
}

/**
 * Restore the complete run while retaining the caller's current global meta.
 * Debug snapshots can therefore never roll discoveries or records backward.
 */
export function restoreStoryCheckpoint(checkpoint, currentState = {}) {
  if (
    !checkpoint ||
    checkpoint.checkpointVersion !== STORY_CHECKPOINT_VERSION ||
    !STORY_BEAT_IDS.includes(checkpoint.beatId) ||
    getCheckpointIdForBeat(checkpoint.beatId) !== checkpoint.id
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
