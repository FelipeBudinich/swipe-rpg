import {
  DEEP_SOUTH_CARDS,
  DEEP_SOUTH_CARD_BY_ID,
  DEEP_SOUTH_INTRO_CARDS,
  DEEP_SOUTH_PLOT_CARDS,
  DEEP_SOUTH_PLOT_CARDS_BY_DECK,
} from "./cards/deep-south-cards.js";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const DEEP_SOUTH_STORY_ID = "deep-south";
export const DEEP_SOUTH_TITLE = "Deep South";

export const DEEP_SOUTH_INTRO_SKIP_CONFIRMATION = deepFreeze({
  id: "deep-south-intro-skip-confirmation",
  type: "intro-confirmation",
  title: "Skip the logbook?",
  text: "Swipe left again to skip to Castro.\nSwipe up to keep reading.",
  artId: "deep-south-it-begins-here",
  choices: {
    left: { label: "Skip to Castro" },
    up: { label: "Keep reading" },
  },
});

const deck = (id, title, type, cards, plotStep = null) => ({
  id,
  title,
  type,
  ...(type === "plot" ? { plotStep } : {}),
  artId: `deep-south-${id}`,
  cards,
});

export const DEEP_SOUTH_DECKS = deepFreeze([
  deck(
    "it-begins-here",
    "It begins here",
    "intro",
    DEEP_SOUTH_INTRO_CARDS,
  ),
  deck("castro", "Castro", "plot", DEEP_SOUTH_PLOT_CARDS_BY_DECK.castro, 1),
  deck(
    "investigate-church",
    "Investigate Church",
    "plot",
    DEEP_SOUTH_PLOT_CARDS_BY_DECK["investigate-church"],
    2,
  ),
  deck(
    "gather-crew",
    "Gather Crew",
    "plot",
    DEEP_SOUTH_PLOT_CARDS_BY_DECK["gather-crew"],
    3,
  ),
  deck("navigate", "Navigate", "plot", DEEP_SOUTH_PLOT_CARDS_BY_DECK.navigate, 4),
  deck(
    "rest-at-desolate-beach",
    "Rest at desolate beach",
    "plot",
    DEEP_SOUTH_PLOT_CARDS_BY_DECK["rest-at-desolate-beach"],
    5,
  ),
  deck(
    "reach-the-coordinates",
    "Reach the coordinates",
    "plot",
    DEEP_SOUTH_PLOT_CARDS_BY_DECK["reach-the-coordinates"],
    6,
  ),
  deck(
    "explore-rlyeh",
    "Explore R'lyeh",
    "plot",
    DEEP_SOUTH_PLOT_CARDS_BY_DECK["explore-rlyeh"],
    7,
  ),
  deck(
    "gather-evidence",
    "Gather Evidence",
    "plot",
    DEEP_SOUTH_PLOT_CARDS_BY_DECK["gather-evidence"],
    8,
  ),
]);

export const DEEP_SOUTH_DECK_IDS = deepFreeze(
  DEEP_SOUTH_DECKS.map(({ id }) => id),
);

export const DEEP_SOUTH_PLOT_DECKS = deepFreeze(
  DEEP_SOUTH_DECKS.filter(({ type }) => type === "plot"),
);

export const DEEP_SOUTH_DECK_BY_ID = deepFreeze(
  Object.fromEntries(DEEP_SOUTH_DECKS.map((definition) => [definition.id, definition])),
);

export const DEEP_SOUTH_STORY = deepFreeze({
  id: DEEP_SOUTH_STORY_ID,
  title: DEEP_SOUTH_TITLE,
  decks: DEEP_SOUTH_DECKS,
});

export {
  DEEP_SOUTH_CARDS,
  DEEP_SOUTH_CARD_BY_ID,
  DEEP_SOUTH_INTRO_CARDS,
  DEEP_SOUTH_PLOT_CARDS,
  DEEP_SOUTH_PLOT_CARDS_BY_DECK,
};

export const deepSouthStory = DEEP_SOUTH_STORY;
export const deepSouthDecks = DEEP_SOUTH_DECKS;
export const deepSouthDeckById = DEEP_SOUTH_DECK_BY_ID;
