const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const EMBER_CROWN_BEAT_IDS = Object.freeze([
  "openingImage",
  "themeStated",
  "setup",
  "catalyst",
  "debate",
  "breakIntoTwo",
  "bStory",
  "funAndGames",
  "midpoint",
  "badGuysCloseIn",
  "allIsLost",
  "darkNightOfTheSoul",
  "breakIntoThree",
  "finale",
  "finalImage",
]);

const beats = [
  {
    id: "openingImage",
    name: "Opening Image",
    act: "Act I",
    budget: { min: 1, target: 1, max: 1 },
    completionObjective: { type: "storyTagResolved", tag: "opening-established" },
    completionCardIds: ["opening-hearthvale-oath"],
    encounterPolicy: {
      mode: "none",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "themeStated",
    name: "Theme Stated",
    act: "Act I",
    budget: { min: 1, target: 1, max: 2 },
    completionObjective: { type: "storyTagResolved", tag: "theme-stated" },
    completionCardIds: ["theme-bread-oven", "theme-serins-lantern"],
    encounterPolicy: {
      mode: "none",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "setup",
    name: "Setup",
    act: "Act I",
    budget: { min: 3, target: 4, max: 4 },
    completionObjective: { type: "storyTagResolved", tag: "setup-complete" },
    completionCardIds: ["setup-crown-lesson"],
    encounterPolicy: {
      mode: "random",
      weightMultiplier: 0.45,
      allowedEnemyTags: ["weak", "tutorial"],
      maximumRandomEncounters: 1,
      minimumCardsBeforeEncounter: 1,
    },
  },
  {
    id: "catalyst",
    name: "Catalyst",
    act: "Act I",
    budget: { min: 1, target: 1, max: 1 },
    completionObjective: { type: "anchorResolved" },
    anchor: {
      minimumCardsBeforeAnchor: 0,
      requiredAsFirstCard: true,
      variants: [
        {
          cardId: "catalyst-evacuation-bells",
          requirements: [{ type: "storyFactEquals", key: "helpedEvacuation", value: true }],
          weight: 1,
        },
        {
          cardId: "catalyst-watchtower-fall",
          requirements: [{ type: "storyFactEquals", key: "keptCeremonyWatch", value: true }],
          weight: 1,
        },
      ],
      fallbackCardId: "catalyst-core-theft",
    },
    encounterPolicy: {
      mode: "scripted-only",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "debate",
    name: "Debate",
    act: "Act I",
    budget: { min: 2, target: 3, max: 3 },
    completionObjective: { type: "storyTagResolved", tag: "pursuit-committed" },
    completionCardIds: [
      "debate-serins-map",
      "debate-survivors-first",
      "debate-supply-cart",
    ],
    encounterPolicy: {
      mode: "random",
      weightMultiplier: 0.5,
      allowedEnemyTags: ["weak", "frontier"],
      maximumRandomEncounters: 1,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "breakIntoTwo",
    name: "Break into Two",
    act: "Act I",
    budget: { min: 1, target: 1, max: 1 },
    completionObjective: { type: "anchorResolved" },
    anchor: {
      minimumCardsBeforeAnchor: 0,
      requiredAsFirstCard: true,
      variants: [
        {
          cardId: "break-two-serins-path",
          requirements: [{ type: "storyFactEquals", key: "trustedSerinRoute", value: true }],
          weight: 1,
        },
        {
          cardId: "break-two-warden-road",
          requirements: [{ type: "storyFactEquals", key: "pursuedImmediately", value: true }],
          weight: 1,
        },
      ],
      fallbackCardId: "break-two-warden-road",
    },
    encounterPolicy: {
      mode: "scripted-only",
      weightMultiplier: 0,
      allowedEnemyTags: ["frontier"],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
    interstitial: {
      subtitle: "Beyond the Warm Fields",
      text: "Hearthvale's last lantern sinks behind the ridge as the true pursuit begins.",
    },
  },
  {
    id: "bStory",
    name: "B Story",
    act: "Act II-A",
    budget: { min: 2, target: 2, max: 2 },
    completionObjective: { type: "storyTagResolved", tag: "serin-bond-introduced" },
    completionCardIds: ["b-story-order-doubt", "b-story-shared-watch"],
    encounterPolicy: {
      mode: "none",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "funAndGames",
    name: "Fun and Games",
    act: "Act II-A",
    budget: { min: 5, target: 6, max: 7 },
    completionObjective: { type: "storyTagResolved", tag: "mountain-gate-located" },
    completionCardIds: ["fun-wayfinder-spire"],
    encounterPolicy: {
      mode: "random",
      weightMultiplier: 1,
      allowedEnemyTags: ["weak", "frontier", "ruin", "beast", "treasure-guardian"],
      maximumRandomEncounters: 3,
      minimumCardsBeforeEncounter: 1,
    },
  },
  {
    id: "midpoint",
    name: "Midpoint",
    act: "Act II-A",
    budget: { min: 2, target: 2, max: 2 },
    completionObjective: {
      type: "all",
      requirements: [
        { type: "specificEnemyDefeated", enemyId: "iron-wyvern" },
        { type: "storyTagResolved", tag: "midpoint-revelation" },
      ],
    },
    completionCardIds: ["midpoint-wyvern-aftermath"],
    anchor: {
      minimumCardsBeforeAnchor: 0,
      requiredAsFirstCard: true,
      variants: [
        {
          cardId: "midpoint-sun-shard-challenge",
          requirements: [{ type: "storyFactEquals", key: "recoveredSunShard", value: true }],
          weight: 1,
        },
        {
          cardId: "midpoint-serins-counterseal",
          requirements: [{ type: "storyFactEquals", key: "trustedSerin", value: true }],
          weight: 1,
        },
      ],
      fallbackCardId: "midpoint-serins-counterseal",
    },
    encounterPolicy: {
      mode: "boss-only",
      weightMultiplier: 0,
      allowedEnemyTags: ["midboss"],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
    interstitial: {
      subtitle: "The Gate That Hunts",
      text: "Steel wings wake above the pass, guarding a truth Malrec failed to bury.",
    },
  },
  {
    id: "badGuysCloseIn",
    name: "Bad Guys Close In",
    act: "Act II-B",
    budget: { min: 4, target: 5, max: 6 },
    completionObjective: { type: "storyTagResolved", tag: "citadel-reached" },
    completionCardIds: ["bad-citadel-threshold"],
    encounterPolicy: {
      mode: "random",
      weightMultiplier: 1.35,
      allowedEnemyTags: ["frontier", "ruin", "elite", "cinder-host"],
      maximumRandomEncounters: 3,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "allIsLost",
    name: "All Is Lost",
    act: "Act II-B",
    budget: { min: 1, target: 1, max: 1 },
    completionObjective: { type: "anchorResolved" },
    anchor: {
      minimumCardsBeforeAnchor: 0,
      requiredAsFirstCard: true,
      variants: [
        {
          cardId: "all-lost-serin-taken",
          requirements: [{ type: "storyFactEquals", key: "trustedSerin", value: true }],
          weight: 1,
        },
        {
          cardId: "all-lost-shard-cracked",
          requirements: [{ type: "storyFactEquals", key: "recoveredSunShard", value: true }],
          weight: 1,
        },
        {
          cardId: "all-lost-supplies-burned",
          requirements: [{ type: "minGold", value: 8 }],
          weight: 1,
        },
      ],
      fallbackCardId: "all-lost-wounded-retreat",
    },
    encounterPolicy: {
      mode: "scripted-only",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
    interstitial: {
      subtitle: "Ash over Every Road",
      text: "The mountain closes its fist, and the victory at the gate suddenly feels very far away.",
    },
  },
  {
    id: "darkNightOfTheSoul",
    name: "Dark Night of the Soul",
    act: "Act II-B",
    budget: { min: 2, target: 2, max: 3 },
    completionObjective: { type: "storyTagResolved", tag: "renewed-purpose" },
    completionCardIds: ["dark-night-carry-the-fire", "dark-night-name-the-cost"],
    encounterPolicy: {
      mode: "none",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
  },
  {
    id: "breakIntoThree",
    name: "Break into Three",
    act: "Act III",
    budget: { min: 1, target: 1, max: 1 },
    completionObjective: {
      type: "all",
      requirements: [
        { type: "anchorResolved" },
        { type: "storyFactExists", key: "finalPlan" },
      ],
    },
    anchor: {
      minimumCardsBeforeAnchor: 0,
      requiredAsFirstCard: true,
      variants: [
        {
          cardId: "break-three-rescue-and-infiltrate",
          requirements: [{ type: "storyFactEquals", key: "serinCaptured", value: true }],
          weight: 1,
        },
        {
          cardId: "break-three-counterseal-plan",
          requirements: [{ type: "storyFactEquals", key: "trustedSerin", value: true }],
          weight: 1,
        },
        {
          cardId: "break-three-shard-path",
          requirements: [{ type: "storyFactEquals", key: "learnedCrownTruth", value: true }],
          weight: 1,
        },
      ],
      fallbackCardId: "break-three-shard-path",
    },
    encounterPolicy: {
      mode: "scripted-only",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
    interstitial: {
      subtitle: "Three Sparks, One Door",
      text: "Hard truth, shared trust, and one chosen purpose become a path through the citadel.",
    },
  },
  {
    id: "finale",
    name: "Finale",
    act: "Act III",
    budget: { min: 3, target: 4, max: 5 },
    completionObjective: {
      type: "all",
      requirements: [
        { type: "specificEnemyDefeated", enemyId: "malrec-crown-bound" },
        { type: "endingSelected" },
      ],
    },
    completionCardIds: ["finale-fate-of-the-crown"],
    anchor: {
      minimumCardsBeforeAnchor: 2,
      requiredAsFirstCard: false,
      variants: [
        {
          cardId: "finale-malrec-infiltration",
          requirements: [{ type: "storyFactEquals", key: "finalPlan", value: "infiltrateCitadel" }],
          weight: 1,
        },
        {
          cardId: "finale-malrec-confrontation",
          requirements: [{ type: "storyFactEquals", key: "finalPlan", value: "confrontMalrec" }],
          weight: 1,
        },
      ],
      fallbackCardId: "finale-malrec-confrontation",
    },
    encounterPolicy: {
      mode: "boss-only",
      weightMultiplier: 0,
      allowedEnemyTags: ["final-boss"],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
    interstitial: {
      subtitle: "The Crown-Bound Citadel",
      text: "Above the waking Titan, one last bearer waits inside a ring of living flame.",
    },
  },
  {
    id: "finalImage",
    name: "Final Image",
    act: "Act III",
    budget: { min: 1, target: 1, max: 1 },
    completionObjective: { type: "anchorResolved" },
    anchor: {
      minimumCardsBeforeAnchor: 0,
      requiredAsFirstCard: true,
      variants: [
        {
          cardId: "final-image-crown-of-dawn",
          requirements: [{ type: "endingSelected", endingId: "crown-of-dawn" }],
          weight: 1,
        },
        {
          cardId: "final-image-unbound-flame",
          requirements: [{ type: "endingSelected", endingId: "unbound-flame" }],
          weight: 1,
        },
      ],
      fallbackCardId: "final-image-crown-of-dawn",
    },
    encounterPolicy: {
      mode: "none",
      weightMultiplier: 0,
      allowedEnemyTags: [],
      maximumRandomEncounters: 0,
      minimumCardsBeforeEncounter: 0,
    },
  },
];

export const EMBER_CROWN_ARC = deepFreeze({
  id: "ember-crown",
  title: "The Ember Crown",
  theme: "Power becomes heroic only when it is carried for others.",
  premise:
    "A newly sworn Warden pursues the fallen champion Malrec before the stolen Ember Crown can wake the Cinder Titan beneath the mountain.",
  beatIds: EMBER_CROWN_BEAT_IDS,
  beats,
  transitionBeatIds: ["breakIntoTwo", "midpoint", "allIsLost", "breakIntoThree", "finale"],
  midbossId: "iron-wyvern",
  finalBossId: "malrec-crown-bound",
  forcedSequences: [
    {
      id: "sun-vault-sequence",
      beatId: "funAndGames",
      cardIds: ["fun-sun-vault-door", "fun-sun-vault-heart"],
    },
    {
      id: "countermarch-sequence",
      beatId: "badGuysCloseIn",
      cardIds: ["bad-signal-fire", "bad-countermarch"],
    },
  ],
  endings: [
    {
      id: "crown-of-dawn",
      title: "Crown of Dawn",
      finalImageCardIds: ["final-image-crown-of-dawn"],
    },
    {
      id: "unbound-flame",
      title: "The Unbound Flame",
      finalImageCardIds: ["final-image-unbound-flame"],
    },
  ],
});

export const emberCrownArc = EMBER_CROWN_ARC;
