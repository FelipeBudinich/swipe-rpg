export const RESOURCE_KEYS = Object.freeze([
  "eldritchLore",
  "crew",
  "sanity",
]);

const RESOURCE_KEY_SET = new Set(RESOURCE_KEYS);

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

export function normalizeResourceEffects(effects) {
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) {
    return Object.freeze({});
  }

  return Object.freeze(
    Object.fromEntries(
      RESOURCE_KEYS.flatMap((key) => {
        if (!Object.prototype.hasOwnProperty.call(effects, key)) return [];
        const value = finiteInteger(effects[key]);
        return value === 0 ? [] : [[key, value]];
      }),
    ),
  );
}

export function normalizeResources(resources) {
  const source =
    resources && typeof resources === "object" && !Array.isArray(resources)
      ? resources
      : {};
  return {
    eldritchLore: Math.max(0, finiteInteger(source.eldritchLore)),
    crew: Math.max(0, finiteInteger(source.crew)),
    sanity: Math.max(0, finiteInteger(source.sanity)),
  };
}

/**
 * Apply one card's resource object and report the actual deltas after clamping.
 * Unknown fields are ignored, so authored content cannot mutate state outside
 * the three-resource contract.
 */
export function applyResourceEffects(state, effects) {
  const before = normalizeResources(state?.resources);
  const requested = normalizeResourceEffects(effects);
  const resources = { ...before };

  for (const key of RESOURCE_KEYS) {
    resources[key] = Math.max(0, before[key] + finiteInteger(requested[key]));
  }

  const nextState = {
    ...state,
    resources,
    status: resources.sanity <= 0 ? "lost" : state?.status ?? "playing",
  };

  return {
    state: nextState,
    changes: resourceChanges({ resources: before }, nextState),
  };
}

export function resourceChanges(before, after) {
  const previous = normalizeResources(before?.resources);
  const next = normalizeResources(after?.resources);
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const delta = next[key] - previous[key];
      return delta === 0 ? [] : [[key, delta]];
    }),
  );
}

export function isResourceKey(value) {
  return RESOURCE_KEY_SET.has(value);
}

// Retain the established central-effect naming for callers while using the
// new data shape directly.
export function applyEffects(state, effects) {
  return applyResourceEffects(state, effects).state;
}

export const executeEffects = applyEffects;
