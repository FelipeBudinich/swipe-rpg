const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const resources = (deltas) => ({ resources: deltas });
const addCards = (deckId, ...cardIds) => ({
  addCards: [{ deckId, cardIds }],
});

const PLOT_ART_ALT_BY_DECK = Object.freeze({
  castro:
    "Rain-darkened docks, palafitos, and harbor streets in Castro.",
  "investigate-church":
    "A candlelit Chiloé church marked by brine, hidden passages, and forbidden records.",
  "gather-crew":
    "Weathered southern sailors and specialists gathered beside expedition gear.",
  navigate:
    "An expedition vessel crossing black southern water beneath an unnatural sky.",
  "rest-at-desolate-beach":
    "A desolate black-sand beach where the expedition camps beside impossible traces.",
  "reach-the-coordinates":
    "The expedition ship approaching cyclopean stone formations at the moving coordinates.",
  "explore-rlyeh":
    "Green-black corridors and impossible architecture inside the drowned city.",
  "gather-evidence":
    "Photographs, rubbings, testimony, and stone samples gathered from the impossible city.",
});

const storyCard = ({
  id,
  deckId,
  type,
  sequence,
  front,
  back,
  entryEffect,
  initiallyAvailable = true,
  turnLabel,
}) => ({
  id,
  deckId,
  type,
  ...(Number.isInteger(sequence) ? { sequence } : {}),
  initiallyAvailable,
  ...(turnLabel ? { turnLabel } : {}),
  faces: { front, back },
  entryEffect,
});

const introCard = (
  sequence,
  id,
  frontTitle,
  frontText,
  backTitle,
  backText,
  artId,
  artAlt,
  backEffect = null,
  extra = {},
) =>
  storyCard({
    id,
    deckId: "it-begins-here",
    type: "intro",
    sequence,
    front: {
      title: frontTitle,
      text: frontText,
      artId,
      artAlt,
    },
    back: {
      title: backTitle,
      text: backText,
      artId,
      artAlt,
      effect: backEffect,
      ...(extra.back ?? {}),
    },
    entryEffect: null,
    ...(extra.card ?? {}),
  });

const plotCard = (
  deckId,
  slug,
  frontTitle,
  frontText,
  backTitle,
  backText,
  backEffect,
  entryEffect,
  { initiallyAvailable = true } = {},
) => {
  const artId = `deep-south-${deckId}`;
  const artAlt = PLOT_ART_ALT_BY_DECK[deckId];
  return storyCard({
    id: `${deckId}-${slug}`,
    deckId,
    type: "plot",
    initiallyAvailable,
    front: {
      title: frontTitle,
      text: frontText,
      artId,
      artAlt,
    },
    back: {
      title: backTitle,
      text: backText,
      artId,
      artAlt,
      effect: backEffect,
    },
    entryEffect,
  });
};

const fathersDiaryCard = storyCard({
  id: "intro-fathers-diary",
  deckId: "it-begins-here",
  type: "intro",
  sequence: 0,
  initiallyAvailable: true,
  turnLabel: "Turn the photograph over",
  front: {
    title: "My father’s photograph",
    text: "47°9′S, 126°43′W—these coordinates were inscribed above an enigmatic photograph in my father’s diary. The image depicted an indescribable horror.",
    artId: "intro-01-fathers-photograph",
    artAlt:
      "An aged photograph of a colossal tentacled horror rising from a storm-darkened sea.",
  },
  back: {
    title: "The map on the reverse",
    text: "On the reverse, another set of coordinates—42°36′S, 73°57′W—beckoned me toward the Deep South.",
    artId: "intro-01-chiloe-map",
    artAlt:
      "A hand-drawn nautical map of Chiloé Island marked with the coordinates 42 degrees 36 minutes south, 73 degrees 57 minutes west.",
    artLabel: "42°36′S, 73°57′W",
    effect: {
      resources: { eldritchLore: 1 },
      discoveries: ["fatherDiaryReverse"],
    },
  },
  entryEffect: null,
});

export const DEEP_SOUTH_INTRO_CARDS = deepFreeze([
  fathersDiaryCard,
  introCard(
    1,
    "intro-eldritch-lore",
    "Eldritch Lore",
    "To unravel the mystery before me, I will need more than courage. I must gather Eldritch Lore from forbidden sources and whispered warnings to pierce the veil concealing what lies beyond human comprehension.",
    "Knowledge has a price",
    "Eldritch Lore exposes patterns ordinary reason protects us from seeing. It can open a path, but every answer brings the Deep South closer.",
    "intro-02-eldritch-lore",
    "Forbidden books, damp journals, and annotated nautical charts arranged on a candlelit desk.",
  ),
  introCard(
    2,
    "intro-crew",
    "Crew",
    "An able Crew—stalwart companions to steady me through the descent—will be indispensable on this journey.",
    "No one sails alone",
    "Crew can be spent to survive discoveries no investigator could face alone. Losing the last sailor does not end the search, but it leaves every task harder.",
    "intro-03-crew",
    "Prospective crewmembers waiting beneath the rain at a dim southern harbor.",
  ),
  introCard(
    3,
    "intro-sanity",
    "Sanity",
    "Most vital of all is Sanity, that fragile tether to the waking world. I begin with 3 Sanity. If it falls to 0, the investigation ends before the final truth can be revealed.",
    "The fragile tether",
    "Sanity measures how much of the waking world remains intact. At zero, the final revealed truth must be faced before the expedition ends.",
    "intro-04-sanity",
    "A lone investigator clings to a fragile thread of light as shapes gather in the darkness.",
  ),
  introCard(
    4,
    "intro-paths",
    "Paths through the dark",
    "To proceed, I must let fate guide my steps. I may investigate where I stand, press forward into the unknown, or retreat toward familiar ground.",
    "Every route has a destination",
    "Up retreats toward a previous chapter. Down exhausts the current chapter before pressing farther south. The exact destination is chosen before the preview appears.",
    "intro-05-paths",
    "A nautical chart presents paths toward local investigation, unknown southern waters, and a distant safe shore.",
  ),
  introCard(
    5,
    "intro-consequences",
    "Consequences",
    "Some places will offer respite; others will test my resolve. The choices I make may cost me members of my Crew or fragments of my Sanity—or reveal Eldritch Lore.",
    "The reverse records the result",
    "Turning a card applies the effect shown in its preview. The reverse keeps the consequence visible, and the card cannot be turned back.",
    "intro-06-consequences",
    "An expedition ship rests in a silent cove beside an abandoned coat, a broken compass, and unnatural markings.",
  ),
  introCard(
    6,
    "intro-locked-trials",
    "Locked trials",
    "Certain trials will remain beyond my reach until I have succeeded in other chapters.",
    "Clues unlock new cards",
    "Some reverses and destination effects add authored cards to a chapter. Newly unlocked cards join that chapter's remaining deterministic draw pile.",
    "intro-07-locked-trials",
    "A sealed ancient doorway bears several carved locks, only some of which have begun to glow.",
  ),
  introCard(
    7,
    "intro-departure",
    "Departure",
    "There is no certainty on this path—only fate, hope, and the dark truths waiting to be uncovered.",
    "South from Chiloé",
    "Castro is the first plot chapter. From there, every revealed back and every chosen route remains part of this run until Sanity finally breaks.",
    "intro-08-departure",
    "A small vessel leaves the lights of Chiloé and sails toward a wall of darkness over the southern sea.",
  ),
]);

const castroCards = [
  plotCard(
    "castro",
    "logbook-under-rain",
    "The rain-black logbook",
    "A dock clerk dries the missing cutter's logbook beneath a weak stove. Whole pages have dissolved into blue veins.",
    "Warm the binding",
    "Heat reveals a pencilled warning beneath the salt bloom.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "castro",
    "marks-on-the-pilings",
    "Marks on the pilings",
    "Below the palafitos, low tide exposes spirals cut into wet timber. They continue beneath the mud where no knife could reach.",
    "Make a charcoal rubbing",
    "Your rubbing preserves a pattern shaped like a drowned constellation and identifies a flooded stair behind the church vestry.",
    addCards(
      "investigate-church",
      "investigate-church-crypt-behind-the-vestry",
    ),
    null,
  ),
  plotCard(
    "castro",
    "empty-berths",
    "Three empty berths",
    "Rain rattles on three vacant moorings. Families have tied black wool where their fishing launches should be.",
    "Inspect the mooring ropes",
    "The ropes were cut from below and are glazed with unfamiliar salt.",
    resources({ eldritchLore: 1, sanity: -1 }),
    resources({ crew: 1 }),
  ),
  plotCard(
    "castro",
    "bell-inside-the-fog",
    "A bell inside the fog",
    "The cathedral bell rings noon. A deeper bell answers from the channel, though every anchored vessel is visible and still.",
    "Find an old ferryman",
    "A ferryman recognizes the rhythm and quietly joins your search in exchange for the truth you already gathered.",
    resources({ crew: 1, eldritchLore: -1 }),
    null,
  ),
  plotCard(
    "castro",
    "sailors-at-closing",
    "Sailors at closing",
    "At a waterside bar, conversation dies when you mention the southern coordinates. One sailor keeps staring at your folded chart.",
    "Buy a quiet round",
    "A glass loosens one useful rumor about a restricted parish ledger hidden by the church.",
    addCards(
      "investigate-church",
      "investigate-church-restricted-ledger",
    ),
    null,
  ),
];

const churchCards = [
  plotCard(
    "investigate-church",
    "restricted-ledger",
    "The restricted ledger",
    "A sacristan guards a parish ledger swollen by damp. Its final entries list baptisms for children never born in Castro.",
    "Distract the sacristan",
    "A copied margin links the vanished expedition to a midnight service.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
    { initiallyAvailable: false },
  ),
  plotCard(
    "investigate-church",
    "hymn-below-hearing",
    "The hymn below hearing",
    "A choir rehearses an old hymn. Beneath their voices, a lower verse seems to rise through the floorboards.",
    "Question the choirmaster",
    "She admits the forbidden verse appears only during spring tides and writes down its final cadence.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "investigate-church",
    "crypt-behind-the-vestry",
    "The crypt behind the vestry",
    "A warped panel opens onto stone steps slick with brine. The church stands far above the highest tide.",
    "Send a sailor below",
    "Only the rope returns from the flooded darkness, tied around a tablet of green stone.",
    resources({ eldritchLore: 1, crew: -1 }),
    null,
    { initiallyAvailable: false },
  ),
  plotCard(
    "investigate-church",
    "shadow-in-stained-glass",
    "A shadow in stained glass",
    "Colored saints tremble across the wall. One shadow moves against the sun and points below a painted southern star.",
    "Photograph the window",
    "The image shows a black arch absent from the glass.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "investigate-church",
    "thirteenth-bell",
    "The thirteenth bell",
    "After midnight, twelve strokes pass. A thirteenth rolls up through the nave and shakes salt from the rafters.",
    "Mark the vibration",
    "Its compass bearing matches a disgraced captain's account of a hidden coast.",
    addCards("gather-crew", "gather-crew-captain-without-a-ship"),
    null,
  ),
];

const crewCards = [
  plotCard(
    "gather-crew",
    "navigator-with-two-compasses",
    "The navigator's two compasses",
    "Elena Quidel carries two compasses: one points north, the other toward whatever she most fears.",
    "Test the second compass",
    "Near your chart, its needle spins south and leaks black water into the brass case.",
    addCards("navigate", "navigate-compass-drift"),
    null,
  ),
  plotCard(
    "gather-crew",
    "doctor-of-sleepless-voyages",
    "Doctor of sleepless voyages",
    "Dr. Vera Mancilla treated the vanished crew before departure. She kept their identical nightmare drawings.",
    "Compare the drawings",
    "Every sleeper drew the same doorway from a different angle.",
    resources({ eldritchLore: 1, sanity: -1 }),
    resources({ crew: 1 }),
  ),
  plotCard(
    "gather-crew",
    "radio-operator-on-static",
    "The operator who answers static",
    "Tomás Barría repairs marine radios and sometimes answers voices hidden between weather channels.",
    "Tune the southern band",
    "A submerged voice repeats the Calypso's call sign.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "gather-crew",
    "diver-with-coral-scars",
    "The diver's coral scars",
    "Retired diver Inés Paillalef bears branching scars from a wreck no harbor registry contains.",
    "Examine the scars",
    "The branches match the church's map of drowned stars.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "gather-crew",
    "captain-without-a-ship",
    "The captain without a ship",
    "Captain Oyarzún lost his license after steering toward a coastline visible only to him. He still keeps a packed sea bag.",
    "Hire his former mate",
    "The mate joins with a route through the Chonos channels, but demands the forbidden chart as payment.",
    resources({ crew: 1, eldritchLore: -1 }),
    null,
    { initiallyAvailable: false },
  ),
];

const navigateCards = [
  plotCard(
    "navigate",
    "compass-drift",
    "Compass drift",
    "Past the last sheltered channel, every compass leans west while the wake runs straight south.",
    "Dismantle a compass",
    "Inside its brass case, the needle is wet with black water.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
    { initiallyAvailable: false },
  ),
  plotCard(
    "navigate",
    "voices-on-the-radio",
    "Voices on the radio",
    "The radio catches the Calypso reporting calm seas. The transmission is dated tomorrow.",
    "Record the exchange",
    "On playback, your own voice answers from the missing ship.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "navigate",
    "wrong-stars",
    "Stars in the wrong water",
    "Clouds break over an unfamiliar sky. The same stars shine below the hull, too sharp for reflections.",
    "Sound the depth",
    "The lead line never strikes bottom and returns warm.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "navigate",
    "chanting-under-black-water",
    "Chanting under black water",
    "The sea turns black and glassy. A measured chant rises through the planks without disturbing the surface.",
    "Drop a hydrophone",
    "Thousands of voices count down in no human language.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "navigate",
    "empty-bunk",
    "The empty bunk",
    "At dawn, one bunk is wet and empty. Bare footprints end halfway across the locked engine room.",
    "Hold a full muster",
    "The missing sailor answers from inside the radio; the remaining crew are steadied by knowing who is gone.",
    resources({ sanity: 1, crew: -1 }),
    null,
  ),
];

const beachCards = [
  plotCard(
    "rest-at-desolate-beach",
    "footprints-on-black-sand",
    "Footprints on black sand",
    "A narrow beach offers shelter. Three-toed footprints emerge from the surf and stop beside your fresh camp.",
    "Cast the clearest print",
    "The plaster sets around a shape larger beneath the sand.",
    resources({ eldritchLore: 1, sanity: -1 }),
    resources({ sanity: 1 }),
  ),
  plotCard(
    "rest-at-desolate-beach",
    "monolith-at-low-tide",
    "The low-tide monolith",
    "As the tide withdraws, a green-black monolith rises beyond the rocks. It casts no reflection in the pools.",
    "Sketch from shore",
    "Your drawing captures an extra side the monolith never showed.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "rest-at-desolate-beach",
    "shared-nightmare",
    "One dream, many sleepers",
    "Everyone dreams of descending wet stairs beneath a sleeping city. At dawn, sand fills each bunk.",
    "Let one sleeper continue",
    "The dreamer wakes screaming with a new coordinate.",
    resources({ eldritchLore: 1, sanity: -1 }),
    addCards(
      "rest-at-desolate-beach",
      "rest-at-desolate-beach-unfamiliar-constellation",
    ),
  ),
  plotCard(
    "rest-at-desolate-beach",
    "unfamiliar-constellation",
    "The unfamiliar constellation",
    "Nine pale stars appear over the beach. Your navigator insists that patch of sky should be empty.",
    "Mark their rising times",
    "They rise in the order carved on Castro's pilings.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
    { initiallyAvailable: false },
  ),
  plotCard(
    "rest-at-desolate-beach",
    "incorrect-shadows",
    "The campfire's wrong shadows",
    "The fire burns clean, yet every shadow leans toward the sea. One shadow belongs to nobody in camp.",
    "Move the whole camp",
    "The crew relocates before the stranger's shadow can stand, sacrificing a hard-won clue for one clear night.",
    resources({ sanity: 1, eldritchLore: -1 }),
    null,
  ),
];

const coordinateCards = [
  plotCard(
    "reach-the-coordinates",
    "moving-fix",
    "The moving fix",
    "Your calculated position shifts six nautical miles while every instrument remains steady.",
    "Average every reading",
    "The mean position matches an erased coordinate and exposes a signal moving beneath the ship.",
    addCards(
      "reach-the-coordinates",
      "reach-the-coordinates-transmission-below",
    ),
    null,
  ),
  plotCard(
    "reach-the-coordinates",
    "sea-withdraws",
    "The sea withdraws",
    "Water races away from the hull in every direction, exposing a plain of glistening stone far below.",
    "Lower a camera",
    "The lens returns scratched from within.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "reach-the-coordinates",
    "stones-break-surface",
    "Stones break the surface",
    "Cyclopean blocks rise through the foam, each too broad for the ship's searchlight to cross.",
    "Measure one joint",
    "The seam is narrower inside than outside, and a sailor disappears while holding the far end.",
    resources({ eldritchLore: 1, crew: -1 }),
    null,
  ),
  plotCard(
    "reach-the-coordinates",
    "transmission-below",
    "Transmission from below",
    "The radio receives a weather report from two hundred meters beneath the keel. It predicts green rain.",
    "Triangulate the signal",
    "The source moves beneath the ship without turning.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
    { initiallyAvailable: false },
  ),
  plotCard(
    "reach-the-coordinates",
    "harbor-without-distance",
    "A harbor without distance",
    "Stone arches seem both a cable away and beyond the horizon. The deck tilts although the sea is flat.",
    "Close one eye",
    "The arches settle into a route visible only in halves.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
];

const rlyehCards = [
  plotCard(
    "explore-rlyeh",
    "corridor-without-corners",
    "The corridor without corners",
    "A green-stone passage bends continuously yet returns you to the same wet threshold.",
    "Measure the walls",
    "Opposite walls are farther apart than the corridor is wide.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "explore-rlyeh",
    "bas-relief-of-tides",
    "The bas-relief of tides",
    "A wall carving shows coastlines kneeling before shapes that rise whenever the moon forgets its path.",
    "Rub the central figure",
    "The paper grows damp around a vast blank shape.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "explore-rlyeh",
    "door-to-the-wrong-shore",
    "Door to the wrong shore",
    "A stone door opens onto Castro at noon, but the harbor beyond is empty and millions of years older.",
    "Photograph the harbor",
    "The image preserves towers hidden behind familiar palafitos and begins changing as it dries.",
    addCards(
      "gather-evidence",
      "gather-evidence-changing-photographs",
    ),
    null,
  ),
  plotCard(
    "explore-rlyeh",
    "watch-stops-twice",
    "The watch stops twice",
    "Your watch stops at 03:17. Minutes later it stops again at the same instant, though everyone has kept walking.",
    "Compare every watch",
    "One crew member's watch is counting backward toward birth.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "explore-rlyeh",
    "breathing-below",
    "Breathing below",
    "Every corridor rises and falls with a slow breath. Dust lifts from the floor before each exhalation.",
    "Mark the breathing cycle",
    "The measured pauses reveal a route the crew can cross together.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
];

const evidenceCards = [
  plotCard(
    "gather-evidence",
    "changing-photographs",
    "Photographs that change",
    "Fresh prints show the expedition beside a blank wall. As they dry, a doorway opens behind each figure.",
    "Fix the prints in salt",
    "Salt arrests one impossible frame without erasing it.",
    resources({ eldritchLore: 1, sanity: -1 }),
    resources({ eldritchLore: 1 }),
    { initiallyAvailable: false },
  ),
  plotCard(
    "gather-evidence",
    "rubbing-that-continues",
    "The rubbing that continues",
    "Your charcoal rubbing extends beyond the stone inscription and across the bare deck beneath it.",
    "Ask everyone to copy it",
    "No two copies agree, but their overlap exposes a map redrawing itself.",
    addCards("gather-evidence", "gather-evidence-map-redraws-itself"),
    null,
  ),
  plotCard(
    "gather-evidence",
    "warm-stone-sample",
    "The warm stone sample",
    "A fist-sized chip of green stone beats softly inside its padded case.",
    "Test a shaving",
    "Under the lens, metallic cells arrange into a coastline while the assistant holding the slide vanishes.",
    resources({ eldritchLore: 1, crew: -1 }),
    null,
  ),
  plotCard(
    "gather-evidence",
    "crew-testimony",
    "Testimony under oath",
    "The survivors record what they saw. Their voices agree, but each remembers a different number of companions.",
    "Record each version alone",
    "Contradictions outline the shape that memory refuses to hold.",
    resources({ eldritchLore: 1, sanity: -1 }),
    null,
  ),
  plotCard(
    "gather-evidence",
    "map-redraws-itself",
    "The map redraws itself",
    "Your expedition map erases the route home and sketches new streets through the sleeping city.",
    "Trace the vanished route",
    "Pressure marks preserve a path back toward the previous chambers.",
    resources({ eldritchLore: 1, sanity: -1 }),
    resources({ sanity: -1 }),
    { initiallyAvailable: false },
  ),
];

export const DEEP_SOUTH_PLOT_CARDS_BY_DECK = deepFreeze({
  castro: castroCards,
  "investigate-church": churchCards,
  "gather-crew": crewCards,
  navigate: navigateCards,
  "rest-at-desolate-beach": beachCards,
  "reach-the-coordinates": coordinateCards,
  "explore-rlyeh": rlyehCards,
  "gather-evidence": evidenceCards,
});

export const DEEP_SOUTH_PLOT_CARDS = deepFreeze(
  Object.values(DEEP_SOUTH_PLOT_CARDS_BY_DECK).flat(),
);

export const DEEP_SOUTH_CARDS = deepFreeze([
  ...DEEP_SOUTH_INTRO_CARDS,
  ...DEEP_SOUTH_PLOT_CARDS,
]);

export const DEEP_SOUTH_CARD_BY_ID = deepFreeze(
  Object.fromEntries(DEEP_SOUTH_CARDS.map((card) => [card.id, card])),
);

export const INTRO_CARDS = DEEP_SOUTH_INTRO_CARDS;
export const PLOT_CARDS = DEEP_SOUTH_PLOT_CARDS;
export const ALL_CARDS = DEEP_SOUTH_CARDS;
