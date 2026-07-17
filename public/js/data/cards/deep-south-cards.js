const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const outcome = (
  label,
  result,
  { eldritchLore = 0, crew = 0, sanity = 0 } = {},
  costs = null,
) => ({
  label,
  result,
  effects: { eldritchLore, crew, sanity },
  ...(costs ? { costs } : {}),
});

const introCard = (sequence, id, title, text, artId, artAlt) => ({
  id,
  deckId: "it-begins-here",
  type: "intro",
  sequence,
  title,
  text,
  artId,
  artAlt,
});

const plotCard = (deckId, slug, title, text, choices) => ({
  id: `${deckId}-${slug}`,
  deckId,
  type: "plot",
  title,
  text,
  artId: `deep-south-${deckId}`,
  choices,
});

export const DEEP_SOUTH_INTRO_CARDS = deepFreeze([
  {
    id: "intro-fathers-diary",
    deckId: "it-begins-here",
    type: "intro",
    sequence: 0,
    faces: {
      front: {
        title: "My father’s photograph",
        text: "47°9′S, 126°43′W—these coordinates were inscribed above an enigmatic photograph in my father’s diary. The image depicted an indescribable horror.",
        artId: "intro-01-fathers-photograph",
        artAlt:
          "An aged photograph of a colossal tentacled horror rising from a storm-darkened sea.",
      },
      reverse: {
        title: "The map on the reverse",
        text: "On the reverse, another set of coordinates—42°36′S, 73°57′W—beckoned me toward the Deep South.",
        artId: "intro-01-chiloe-map",
        artAlt:
          "A hand-drawn nautical map of Chiloé Island marked with the coordinates 42 degrees 36 minutes south, 73 degrees 57 minutes west.",
        artLabel: "42°36′S, 73°57′W",
        discoveryId: "fatherDiaryReverse",
        firstRevealEffects: { eldritchLore: 1 },
        rewardLabel: "Discovery recorded · +1 Eldritch Lore",
      },
    },
  },
  introCard(
    1,
    "intro-eldritch-lore",
    "Eldritch Lore",
    "To unravel the mystery before me, I will need more than courage. I must gather Eldritch Lore from forbidden sources and whispered warnings to pierce the veil concealing what lies beyond human comprehension.",
    "intro-02-eldritch-lore",
    "Forbidden books, damp journals, and annotated nautical charts arranged on a candlelit desk.",
  ),
  introCard(
    2,
    "intro-crew",
    "Crew",
    "An able Crew—stalwart companions to steady me through the descent—will be indispensable on this journey.",
    "intro-03-crew",
    "Prospective crewmembers waiting beneath the rain at a dim southern harbor.",
  ),
  introCard(
    3,
    "intro-sanity",
    "Sanity",
    "Most vital of all is Sanity, that fragile tether to the waking world. I begin with 3 Sanity. If it falls to 0, the investigation ends before the final truth can be revealed.",
    "intro-04-sanity",
    "A lone investigator clings to a fragile thread of light as shapes gather in the darkness.",
  ),
  introCard(
    4,
    "intro-paths",
    "Paths through the dark",
    "To proceed, I must let fate guide my steps. I may investigate where I stand, press forward into the unknown, or retreat toward familiar ground.",
    "intro-05-paths",
    "A nautical chart presents paths toward local investigation, unknown southern waters, and a distant safe shore.",
  ),
  introCard(
    5,
    "intro-consequences",
    "Consequences",
    "Some places will offer respite; others will test my resolve. The choices I make may cost me members of my Crew or fragments of my Sanity—or reveal Eldritch Lore.",
    "intro-06-consequences",
    "An expedition ship rests in a silent cove beside an abandoned coat, a broken compass, and unnatural markings.",
  ),
  introCard(
    6,
    "intro-locked-trials",
    "Locked trials",
    "Certain trials will remain beyond my reach until I have succeeded in other chapters.",
    "intro-07-locked-trials",
    "A sealed ancient doorway bears several carved locks, only some of which have begun to glow.",
  ),
  introCard(
    7,
    "intro-departure",
    "Departure",
    "There is no certainty on this path—only fate, hope, and the dark truths waiting to be uncovered.",
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
    {
      up: outcome(
        "Return the book",
        "You leave the softened pages intact and retrace your questions through safer streets.",
      ),
      down: outcome(
        "Copy the southern marks",
        "You copy a sequence of bearings that ends far below the usual channels.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Warm the binding",
        "Heat reveals a pencilled warning beneath the salt bloom.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Ask who brought it",
        "The clerk names a deckhand willing to talk after nightfall.",
        { crew: 1 },
      ),
    },
  ),
  plotCard(
    "castro",
    "marks-on-the-pilings",
    "Marks on the pilings",
    "Below the palafitos, low tide exposes spirals cut into wet timber. They continue beneath the mud where no knife could reach.",
    {
      up: outcome(
        "Climb back to the street",
        "You leave the tide to cover the marks and reconsider the first testimony.",
      ),
      down: outcome(
        "Follow them seaward",
        "The carvings align with the channel south when the fog briefly opens.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Make a charcoal rubbing",
        "Your rubbing preserves a pattern shaped like a drowned constellation.",
        { eldritchLore: 1 },
      ),
      right: null,
    },
  ),
  plotCard(
    "castro",
    "empty-berths",
    "Three empty berths",
    "Rain rattles on three vacant moorings. Families have tied black wool where their fishing launches should be.",
    {
      up: outcome(
        "Visit the families",
        "You return inland with names, dates, and a less reckless line of inquiry.",
      ),
      down: outcome(
        "Hire a harbor skiff",
        "A young boatwoman agrees to guide you past the last marked buoy.",
        { crew: 1 },
      ),
      left: outcome(
        "Inspect the mooring ropes",
        "The ropes were cut from below and are glazed with unfamiliar salt.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Wait for the tide",
        "Nothing returns, but a submerged bell answers the harbor bell once.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "castro",
    "bell-inside-the-fog",
    "A bell inside the fog",
    "The cathedral bell rings noon. A deeper bell answers from the channel, though every anchored vessel is visible and still.",
    {
      up: outcome(
        "Walk toward the plaza",
        "You put stone streets between yourself and the unseen bell.",
      ),
      down: outcome(
        "Take a launch into the fog",
        "The echo fixes a southern line that no buoy follows.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Count the intervals",
        "The impossible rhythm repeats nine times, then stops beneath your feet.",
        { sanity: -1 },
      ),
      right: outcome(
        "Find an old ferryman",
        "A ferryman recognizes the rhythm and quietly joins your search.",
        { crew: 1 },
      ),
    },
  ),
  plotCard(
    "castro",
    "sailors-at-closing",
    "Sailors at closing",
    "At a waterside bar, conversation dies when you mention the southern coordinates. One sailor keeps staring at your folded chart.",
    {
      up: outcome(
        "Withdraw the question",
        "You return to the public records before fear closes more doors.",
      ),
      down: outcome(
        "Show the full chart",
        "A former radio operator recognizes a call sign near the final bearing.",
        { crew: 1 },
      ),
      left: outcome(
        "Buy a quiet round",
        "A glass loosens one useful rumor about records hidden by the church.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Follow the watcher",
        "The sailor leads you to a locked shed, then vanishes into the rain.",
      ),
    },
  ),
];

const churchCards = [
  plotCard(
    "investigate-church",
    "restricted-ledger",
    "The restricted ledger",
    "A sacristan guards a parish ledger swollen by damp. Its final entries list baptisms for children never born in Castro.",
    {
      up: outcome(
        "Return to the public nave",
        "You step back among ordinary candles and reconsider the harbor evidence.",
      ),
      down: outcome(
        "Read the sealed entries",
        "The surnames form a route through islands toward your coordinates.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Distract the sacristan",
        "A copied margin links the vanished expedition to a midnight service.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "investigate-church",
    "hymn-below-hearing",
    "The hymn below hearing",
    "A choir rehearses an old hymn. Beneath their voices, a lower verse seems to rise through the floorboards.",
    {
      up: outcome(
        "Leave before the refrain",
        "You return toward the docks while the human melody still holds.",
      ),
      down: outcome(
        "Follow the lower verse",
        "The hidden cadence describes stars sleeping beneath moving water.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Record the melody",
        "On playback, the lower voices speak your coordinates.",
        { sanity: -1 },
      ),
      right: outcome(
        "Question the choirmaster",
        "She admits the forbidden verse appears only during spring tides.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "investigate-church",
    "crypt-behind-the-vestry",
    "The crypt behind the vestry",
    "A warped panel opens onto stone steps slick with brine. The church stands far above the highest tide.",
    {
      up: outcome(
        "Seal the panel",
        "You mark the passage and return to compare safer records.",
      ),
      down: outcome(
        "Descend with a lamp",
        "Below, a sailor's grave bears the expedition's future departure date.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Lower a mirror",
        "The mirror catches green stone where the stair should end.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Send a sailor below",
        "Only the rope returns from the flooded darkness.",
        { eldritchLore: 1 },
        { crew: 1 },
      ),
    },
  ),
  plotCard(
    "investigate-church",
    "shadow-in-stained-glass",
    "A shadow in stained glass",
    "Colored saints tremble across the wall. One shadow moves against the sun and points below a painted southern star.",
    {
      up: outcome(
        "Step into daylight",
        "The shadow releases you, and you return to the trail already proven.",
      ),
      down: outcome(
        "Press the painted star",
        "A hidden drawer yields a chart annotated by three generations of priests.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Trace the shadow",
        "Your finger follows it into a shape your eye refuses to hold.",
        { sanity: -1 },
      ),
      right: outcome(
        "Photograph the window",
        "The image shows a black arch absent from the glass.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "investigate-church",
    "thirteenth-bell",
    "The thirteenth bell",
    "After midnight, twelve strokes pass. A thirteenth rolls up through the nave and shakes salt from the rafters.",
    {
      up: outcome(
        "Wait outside",
        "You retreat to the square and watch who leaves after the forbidden hour.",
      ),
      down: outcome(
        "Open the bell stair",
        "The rope descends through the floor instead of rising to the tower.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Hold the rope still",
        "Something below pulls once, with the weight of a tide.",
        { sanity: -1 },
      ),
      right: outcome(
        "Mark the vibration",
        "Its compass bearing matches the southern chart.",
        { eldritchLore: 1 },
      ),
    },
  ),
];

const crewCards = [
  plotCard(
    "gather-crew",
    "navigator-with-two-compasses",
    "The navigator's two compasses",
    "Elena Quidel carries two compasses: one points north, the other toward whatever she most fears.",
    {
      up: outcome(
        "Ask for harbor advice",
        "She gives you a cautious route back through known channels.",
      ),
      down: outcome(
        "Offer her the southern berth",
        "Elena signs on to learn why both needles share your bearing.",
        { crew: 1 },
      ),
      left: outcome(
        "Test the second compass",
        "Near your chart, its needle spins and settles south.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Hide the coordinates",
        "She refuses the berth but recommends a reliable helmsman.",
      ),
    },
  ),
  plotCard(
    "gather-crew",
    "doctor-of-sleepless-voyages",
    "Doctor of sleepless voyages",
    "Dr. Vera Mancilla treated the vanished crew before departure. She kept their identical nightmare drawings.",
    {
      up: outcome(
        "Study the medical notes",
        "You return to earlier clues with a record of shared symptoms.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Invite her aboard",
        "Vera joins from guilt and packs enough sedative for rough water.",
        { crew: 1 },
      ),
      left: outcome(
        "Compare the drawings",
        "Every sleeper drew the same doorway from a different angle.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Burn the drawings",
        "The paper blackens, but the doorway remains pale in the ash.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "gather-crew",
    "radio-operator-on-static",
    "The operator who answers static",
    "Tomás Barría repairs marine radios and sometimes answers voices hidden between weather channels.",
    {
      up: outcome(
        "Request a transcript",
        "He gives you a recent transmission to compare with Castro's records.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Give him a bunk",
        "Tomás brings his receiver and joins before the static changes its mind.",
        { crew: 1 },
      ),
      left: outcome(
        "Tune the southern band",
        "A submerged voice repeats the Calypso's call sign.",
        { sanity: -1 },
      ),
      right: null,
    },
  ),
  plotCard(
    "gather-crew",
    "diver-with-coral-scars",
    "The diver's coral scars",
    "Retired diver Inés Paillalef bears branching scars from a wreck no harbor registry contains.",
    {
      up: outcome(
        "Ask about the wreck",
        "Her account sends you back to a symbol carved on Castro's pilings.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Offer salvage rights",
        "Inés accepts, insisting that anything singing stays underwater.",
        { crew: 1 },
      ),
      left: outcome(
        "Examine the scars",
        "The branches match the church's map of drowned stars.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Respect her silence",
        "She declines but lends you a pressure lamp.",
      ),
    },
  ),
  plotCard(
    "gather-crew",
    "captain-without-a-ship",
    "The captain without a ship",
    "Captain Oyarzún lost his license after steering toward a coastline visible only to him. He still keeps a packed sea bag.",
    {
      up: outcome(
        "Check his old testimony",
        "His disciplinary file points back to the same impossible church bell.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Return him to command",
        "Oyarzún joins, sober and grim, with a route through the Chonos channels.",
        { crew: 1 },
      ),
      left: outcome(
        "Challenge his story",
        "He sketches the hidden coast without once looking at your chart.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Hire his former mate",
        "The mate accepts, though he refuses to sleep below deck.",
        { crew: 1 },
      ),
    },
  ),
];

const navigateCards = [
  plotCard(
    "navigate",
    "compass-drift",
    "Compass drift",
    "Past the last sheltered channel, every compass leans west while the wake runs straight south.",
    {
      up: outcome(
        "Retrace the last channel",
        "Known headlands return, and the needles briefly agree.",
      ),
      down: outcome(
        "Steer by the drifting needle",
        "The vessel enters a current absent from the chart.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Dismantle a compass",
        "Inside its brass case, the needle is wet with black water.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "navigate",
    "voices-on-the-radio",
    "Voices on the radio",
    "The radio catches the Calypso reporting calm seas. The transmission is dated tomorrow.",
    {
      up: outcome(
        "Answer with your position",
        "Static guides you back toward the last reliable fix.",
      ),
      down: outcome(
        "Follow their bearing",
        "A second voice gives a deeper coordinate beneath the first.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Cut the speaker",
        "Silence steadies the wheel, but the radio operator abandons the set.",
        { crew: -1 },
      ),
      right: outcome(
        "Record the exchange",
        "On playback, your own voice answers from the missing ship.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "navigate",
    "wrong-stars",
    "Stars in the wrong water",
    "Clouds break over an unfamiliar sky. The same stars shine below the hull, too sharp for reflections.",
    {
      up: outcome(
        "Turn toward cloud cover",
        "You seek the last ordinary weather and a familiar latitude.",
      ),
      down: outcome(
        "Navigate by the lower stars",
        "Their pattern fits the drowned chart exactly.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Sound the depth",
        "The lead line never strikes bottom and returns warm.",
        { sanity: -1 },
      ),
      right: outcome(
        "Keep every eye on deck",
        "Shared vigilance carries the crew through the false night.",
      ),
    },
  ),
  plotCard(
    "navigate",
    "chanting-under-black-water",
    "Chanting under black water",
    "The sea turns black and glassy. A measured chant rises through the planks without disturbing the surface.",
    {
      up: outcome(
        "Reverse the engines",
        "The chant fades as you return toward rougher, living water.",
      ),
      down: outcome(
        "Cross the silent patch",
        "Beyond it, a line of stone peaks breaks the horizon.",
      ),
      left: outcome(
        "Drop a hydrophone",
        "Thousands of voices count down in no human language.",
        { eldritchLore: 1, sanity: -1 },
      ),
      right: outcome(
        "Start the deck winch",
        "Mechanical noise breaks the crew's trance before anyone jumps.",
      ),
    },
  ),
  plotCard(
    "navigate",
    "empty-bunk",
    "The empty bunk",
    "At dawn, one bunk is wet and empty. Bare footprints end halfway across the locked engine room.",
    {
      up: outcome(
        "Search the wake",
        "You circle toward the last watch point, finding only a floating cap.",
        { crew: -1 },
      ),
      down: outcome(
        "Keep the engines south",
        "The crew seals the bunk and presses on with one fewer voice.",
        { crew: -1 },
      ),
      left: outcome(
        "Open the bilge",
        "Something knocks back from the wrong side of the hull.",
        { sanity: -1 },
      ),
      right: outcome(
        "Hold a full muster",
        "The missing sailor answers roll call from inside the radio, then falls silent.",
        { sanity: -1 },
      ),
    },
  ),
];

const beachCards = [
  plotCard(
    "rest-at-desolate-beach",
    "footprints-on-black-sand",
    "Footprints on black sand",
    "A narrow beach offers shelter. Three-toed footprints emerge from the surf and stop beside your fresh camp.",
    {
      up: outcome(
        "Return to the anchored boat",
        "You abandon the beach and retrace the safer approach.",
      ),
      down: outcome(
        "Follow the prints inland",
        "They end at a stone marker aimed toward the coordinates.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Cast the clearest print",
        "The plaster sets around a shape larger beneath the sand.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Erase the trail",
        "By morning, the prints have returned around every sleeping bag.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "rest-at-desolate-beach",
    "monolith-at-low-tide",
    "The low-tide monolith",
    "As the tide withdraws, a green-black monolith rises beyond the rocks. It casts no reflection in the pools.",
    {
      up: outcome(
        "Wait above the tide line",
        "You watch the stone sink and carry its bearing back to the ship.",
      ),
      down: outcome(
        "Wade to the monolith",
        "Its submerged face holds a route cut in concentric channels.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Sketch from shore",
        "Your drawing captures an extra side the monolith never showed.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Chip the edge",
        "The fragment is warm and pulses once in your hand.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "rest-at-desolate-beach",
    "shared-nightmare",
    "One dream, many sleepers",
    "Everyone dreams of descending wet stairs beneath a sleeping city. At dawn, sand fills each bunk.",
    {
      up: outcome(
        "Break camp early",
        "Work and daylight pull the expedition back toward familiar concerns.",
      ),
      down: outcome(
        "Compare every account",
        "The shared details form a usable map of the first corridors.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Let one sleeper continue",
        "The dreamer wakes screaming with a new coordinate.",
        { eldritchLore: 1, sanity: -1 },
      ),
      right: null,
    },
  ),
  plotCard(
    "rest-at-desolate-beach",
    "unfamiliar-constellation",
    "The unfamiliar constellation",
    "Nine pale stars appear over the beach. Your navigator insists that patch of sky should be empty.",
    {
      up: outcome(
        "Shelter under canvas",
        "You wait for clouds and return to the last trustworthy bearings.",
      ),
      down: outcome(
        "Set a course beneath them",
        "The constellation points beyond the moving coordinates.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Photograph the sky",
        "The photograph shows the stars below the horizon.",
        { sanity: -1 },
      ),
      right: outcome(
        "Mark their rising times",
        "They rise in the order carved on Castro's pilings.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "rest-at-desolate-beach",
    "incorrect-shadows",
    "The campfire's wrong shadows",
    "The fire burns clean, yet every shadow leans toward the sea. One shadow belongs to nobody in camp.",
    {
      up: outcome(
        "Douse the fire",
        "Darkness restores the ordinary direction of the moonlit rocks.",
      ),
      down: outcome(
        "Walk where the shadows point",
        "A buried stair appears beneath a crust of black sand.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Count the silhouettes",
        "The extra shadow raises an arm when you reach it.",
        { sanity: -1 },
      ),
      right: outcome(
        "Move the whole camp",
        "The crew relocates before the stranger's shadow can stand.",
      ),
    },
  ),
];

const coordinatesCards = [
  plotCard(
    "reach-the-coordinates",
    "moving-fix",
    "The moving fix",
    "Your calculated position shifts six nautical miles while every instrument remains steady.",
    {
      up: outcome(
        "Return to the prior fix",
        "You retrace the sounding line and recover one stable reference.",
      ),
      down: outcome(
        "Chase the new position",
        "The moving point leads toward a seam in the horizon.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Average every reading",
        "The mean position matches the logbook's erased coordinate.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "reach-the-coordinates",
    "sea-withdraws",
    "The sea withdraws",
    "Water races away from the hull in every direction, exposing a plain of glistening stone far below.",
    {
      up: outcome(
        "Turn before the return",
        "You flee toward deeper water as the horizon gathers itself.",
      ),
      down: outcome(
        "Hold above the stone plain",
        "Channels below form the same sigil found under Castro.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Lower a camera",
        "The lens returns scratched from within.",
        { sanity: -1 },
      ),
      right: outcome(
        "Cut a fouled line",
        "The line pulls a sailor overboard before it parts.",
        { crew: -1 },
      ),
    },
  ),
  plotCard(
    "reach-the-coordinates",
    "stones-break-surface",
    "Stones break the surface",
    "Cyclopean blocks rise through the foam, each too broad for the ship's searchlight to cross.",
    {
      up: outcome(
        "Back away from the wall",
        "You regain open water and reconsider the safest landing.",
      ),
      down: outcome(
        "Enter the stone channel",
        "The impossible masonry opens toward a drowned harbor.",
      ),
      left: outcome(
        "Measure one joint",
        "The seam is narrower inside than outside.",
        { eldritchLore: 1, sanity: -1 },
      ),
      right: outcome(
        "Tie off to the stone",
        "A mooring ring turns beneath your rope like a waking eye.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "reach-the-coordinates",
    "transmission-below",
    "Transmission from below",
    "The radio receives a weather report from two hundred meters beneath the keel. It predicts green rain.",
    {
      up: outcome(
        "Broadcast toward Chiloé",
        "Your repeated call finds a faint northern reply.",
      ),
      down: outcome(
        "Answer the submerged station",
        "It returns docking instructions in the Calypso captain's voice.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Triangulate the signal",
        "The source moves beneath the ship without turning.",
        { sanity: -1 },
      ),
      right: outcome(
        "Pull the radio fuse",
        "The dead speaker finishes the report anyway.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "reach-the-coordinates",
    "harbor-without-distance",
    "A harbor without distance",
    "Stone arches seem both a cable away and beyond the horizon. The deck tilts although the sea is flat.",
    {
      up: outcome(
        "Follow the wake backward",
        "Your own wake provides the only honest line away.",
      ),
      down: outcome(
        "Cross beneath the nearest arch",
        "Distance folds, and the vessel arrives inside the black harbor.",
        { sanity: -1 },
      ),
      left: outcome(
        "Close one eye",
        "The arches settle into a route visible only in halves.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Let the navigator steer",
        "She guides by sound while the crew keeps their eyes down.",
      ),
    },
  ),
];

const rlyehCards = [
  plotCard(
    "explore-rlyeh",
    "corridor-without-corners",
    "The corridor without corners",
    "A green-stone passage bends continuously yet returns you to the same wet threshold.",
    {
      up: outcome(
        "Follow your chalk marks",
        "The oldest mark leads back toward the landing place.",
      ),
      down: outcome(
        "Walk against the curve",
        "The passage unfolds into a chamber beneath the city.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Measure the walls",
        "Opposite walls are farther apart than the corridor is wide.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Send one scout",
        "The scout returns from ahead, older and alone.",
        { crew: -1, sanity: -1 },
      ),
    },
  ),
  plotCard(
    "explore-rlyeh",
    "bas-relief-of-tides",
    "The bas-relief of tides",
    "A wall carving shows coastlines kneeling before shapes that rise whenever the moon forgets its path.",
    {
      up: outcome(
        "Copy only the coastline",
        "You take a safe fragment of the relief back toward the entrance.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Read the complete sequence",
        "The final panel depicts your expedition arriving exactly now.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Rub the central figure",
        "The paper grows damp around a vast blank shape.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Break the final panel",
        "Stone dust whispers each crew member's name.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "explore-rlyeh",
    "door-to-the-wrong-shore",
    "Door to the wrong shore",
    "A stone door opens onto Castro at noon, but the harbor beyond is empty and millions of years older.",
    {
      up: outcome(
        "Close the false doorway",
        "You retreat through the passage you can still remember.",
      ),
      down: outcome(
        "Step across the threshold",
        "A second step returns you deeper inside the city.",
        { sanity: -1 },
      ),
      left: outcome(
        "Call into false Castro",
        "Your answer comes from beneath the church floor.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Photograph the harbor",
        "The image preserves towers hidden behind familiar palafitos.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "explore-rlyeh",
    "watch-stops-twice",
    "The watch stops twice",
    "Your watch stops at 03:17. Minutes later it stops again at the same instant, though everyone has kept walking.",
    {
      up: outcome(
        "Reverse your route",
        "Footsteps retraced in order restore a single present.",
      ),
      down: outcome(
        "Continue past the repeated minute",
        "You emerge with an hour missing and a new chamber mapped.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Compare every watch",
        "One crew member's watch is counting backward toward birth.",
        { sanity: -1 },
      ),
      right: null,
    },
  ),
  plotCard(
    "explore-rlyeh",
    "breathing-below",
    "Breathing below",
    "Every corridor rises and falls with a slow breath. Dust lifts from the floor before each exhalation.",
    {
      up: outcome(
        "Move between breaths",
        "You retreat toward open air while the stone rests.",
      ),
      down: outcome(
        "Descend toward the lungs",
        "The rhythm reveals a shaft concealed between two impossible walls.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Place a hand on stone",
        "A dream larger than weather notices your warmth.",
        { sanity: -1 },
      ),
      right: outcome(
        "Mark the breathing cycle",
        "The measured pauses offer a route the crew can cross together.",
        { eldritchLore: 1 },
      ),
    },
  ),
];

const evidenceCards = [
  plotCard(
    "gather-evidence",
    "changing-photographs",
    "Photographs that change",
    "Fresh prints show the expedition beside a blank wall. As they dry, a doorway opens behind each figure.",
    {
      up: outcome(
        "Carry the stable negatives",
        "You take the least altered proof back toward earlier ground.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Wait for the print to settle",
        "The doorway widens until something looks out through the paper.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Fix the prints in salt",
        "Salt arrests one impossible frame without erasing it.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Burn the moving prints",
        "The smoke forms the same doorway above the flame.",
        { sanity: -1 },
      ),
    },
  ),
  plotCard(
    "gather-evidence",
    "rubbing-that-continues",
    "The rubbing that continues",
    "Your charcoal rubbing extends beyond the stone inscription and across the bare deck beneath it.",
    {
      up: outcome(
        "Roll up the first section",
        "You preserve the legible fragment and retrace your path.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Let the pattern finish",
        "It draws a map through rooms the expedition has not entered.",
        { eldritchLore: 1 },
      ),
      left: outcome(
        "Cut around the new lines",
        "The severed paper keeps drawing in your pack.",
        { sanity: -1 },
      ),
      right: outcome(
        "Ask everyone to copy it",
        "No two copies agree, but their overlap reveals one coordinate.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "gather-evidence",
    "warm-stone-sample",
    "The warm stone sample",
    "A fist-sized chip of green stone beats softly inside its padded case.",
    {
      up: outcome(
        "Seal it for the voyage",
        "Layers of canvas quiet the sample enough to carry north.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Match its pulse",
        "The rhythm points toward a deeper chamber still gathering itself.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Test a shaving",
        "Under the lens, metallic cells arrange into a coastline.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Give it to a crewmate",
        "The carrier walks away smiling and does not return.",
        { crew: -1 },
      ),
    },
  ),
  plotCard(
    "gather-evidence",
    "crew-testimony",
    "Testimony under oath",
    "The survivors record what they saw. Their voices agree, but each remembers a different number of companions.",
    {
      up: outcome(
        "Preserve the common account",
        "The shared details make a credible record for the return route.",
        { eldritchLore: 1 },
      ),
      down: outcome(
        "Ask who is missing",
        "Every witness names you, then corrects themselves at once.",
        { sanity: -1 },
      ),
      left: outcome(
        "Record each version alone",
        "Contradictions outline the shape that memory refuses to hold.",
        { eldritchLore: 1 },
      ),
    },
  ),
  plotCard(
    "gather-evidence",
    "map-redraws-itself",
    "The map redraws itself",
    "Your expedition map erases the route home and sketches new streets through the sleeping city.",
    {
      up: outcome(
        "Restore the northern route",
        "You redraw the known channels from memory and move toward them.",
      ),
      down: outcome(
        "Follow the newest street",
        "The line reaches the map's edge and continues across your hand.",
        { eldritchLore: 1, sanity: -1 },
      ),
      left: outcome(
        "Trace the vanished route",
        "Pressure marks preserve a path back toward the previous chambers.",
        { eldritchLore: 1 },
      ),
      right: outcome(
        "Fold the city inward",
        "The paper resists, then becomes an ordinary map for one breath.",
      ),
    },
  ),
];

export const DEEP_SOUTH_PLOT_CARDS_BY_DECK = deepFreeze({
  castro: castroCards,
  "investigate-church": churchCards,
  "gather-crew": crewCards,
  navigate: navigateCards,
  "rest-at-desolate-beach": beachCards,
  "reach-the-coordinates": coordinatesCards,
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

export const deepSouthCards = DEEP_SOUTH_CARDS;
export const deepSouthCardById = DEEP_SOUTH_CARD_BY_ID;
