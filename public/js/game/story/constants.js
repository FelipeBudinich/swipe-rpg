/**
 * Canonical Save the Cat beat identifiers used by every story arc.
 *
 * The identifiers are implementation details; the exact display names are
 * deliberately kept alongside them so validators can reject reordered or
 * renamed structural beats.
 */
export const STORY_BEATS = Object.freeze([
  Object.freeze({ id: "openingImage", name: "Opening Image", act: "Act I" }),
  Object.freeze({ id: "themeStated", name: "Theme Stated", act: "Act I" }),
  Object.freeze({ id: "setup", name: "Setup", act: "Act I" }),
  Object.freeze({ id: "catalyst", name: "Catalyst", act: "Act I" }),
  Object.freeze({ id: "debate", name: "Debate", act: "Act I" }),
  Object.freeze({ id: "breakIntoTwo", name: "Break into Two", act: "Act I" }),
  Object.freeze({ id: "bStory", name: "B Story", act: "Act II-A" }),
  Object.freeze({ id: "funAndGames", name: "Fun and Games", act: "Act II-A" }),
  Object.freeze({ id: "midpoint", name: "Midpoint", act: "Act II-A" }),
  Object.freeze({ id: "badGuysCloseIn", name: "Bad Guys Close In", act: "Act II-B" }),
  Object.freeze({ id: "allIsLost", name: "All Is Lost", act: "Act II-B" }),
  Object.freeze({
    id: "darkNightOfTheSoul",
    name: "Dark Night of the Soul",
    act: "Act II-B",
  }),
  Object.freeze({ id: "breakIntoThree", name: "Break into Three", act: "Act III" }),
  Object.freeze({ id: "finale", name: "Finale", act: "Act III" }),
  Object.freeze({ id: "finalImage", name: "Final Image", act: "Act III" }),
]);

export const STORY_BEAT_IDS = Object.freeze(STORY_BEATS.map(({ id }) => id));
export const STORY_BEAT_NAMES = Object.freeze(STORY_BEATS.map(({ name }) => name));

export const DEFAULT_BEAT_BUDGETS = Object.freeze({
  openingImage: Object.freeze({ minimum: 1, target: 1, maximum: 1 }),
  themeStated: Object.freeze({ minimum: 1, target: 1, maximum: 2 }),
  setup: Object.freeze({ minimum: 3, target: 4, maximum: 4 }),
  catalyst: Object.freeze({ minimum: 1, target: 1, maximum: 1 }),
  debate: Object.freeze({ minimum: 2, target: 3, maximum: 3 }),
  breakIntoTwo: Object.freeze({ minimum: 1, target: 1, maximum: 1 }),
  bStory: Object.freeze({ minimum: 2, target: 2, maximum: 2 }),
  funAndGames: Object.freeze({ minimum: 5, target: 6, maximum: 7 }),
  midpoint: Object.freeze({ minimum: 2, target: 2, maximum: 2 }),
  badGuysCloseIn: Object.freeze({ minimum: 4, target: 5, maximum: 6 }),
  allIsLost: Object.freeze({ minimum: 1, target: 1, maximum: 1 }),
  darkNightOfTheSoul: Object.freeze({ minimum: 2, target: 2, maximum: 3 }),
  breakIntoThree: Object.freeze({ minimum: 1, target: 1, maximum: 1 }),
  finale: Object.freeze({ minimum: 3, target: 4, maximum: 5 }),
  finalImage: Object.freeze({ minimum: 1, target: 1, maximum: 1 }),
});

export const EXPECTED_STORY_BUDGET_TOTALS = Object.freeze({
  minimum: 30,
  target: 35,
  maximum: 40,
});

export const MAJOR_ANCHOR_BEAT_IDS = Object.freeze([
  "catalyst",
  "breakIntoTwo",
  "midpoint",
  "allIsLost",
  "breakIntoThree",
  "finale",
  "finalImage",
]);

export const MAJOR_INTERSTITIAL_BEAT_IDS = Object.freeze([
  "breakIntoTwo",
  "midpoint",
  "allIsLost",
  "breakIntoThree",
  "finale",
]);

export const STORY_CARD_ROLES = Object.freeze([
  "entry",
  "ambient",
  "completion",
  "anchor",
  "ending",
]);

export const ENCOUNTER_POLICY_MODES = Object.freeze([
  "none",
  "random",
  "scripted-only",
  "boss-only",
]);

export const STORY_CHECKPOINT_IDS = Object.freeze(
  Object.fromEntries(
    STORY_BEATS.map(({ id }, index) => [
      id,
      `${String(index + 1).padStart(2, "0")}-${id
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase()}`,
    ]),
  ),
);
