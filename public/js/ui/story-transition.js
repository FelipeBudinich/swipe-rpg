export const STORY_BEAT_NAMES = Object.freeze([
  "Opening Image",
  "Theme Stated",
  "Setup",
  "Catalyst",
  "Debate",
  "Break into Two",
  "B Story",
  "Fun and Games",
  "Midpoint",
  "Bad Guys Close In",
  "All Is Lost",
  "Dark Night of the Soul",
  "Break into Three",
  "Finale",
  "Final Image",
]);

const DEFAULT_ARC = Object.freeze({
  id: "ember-crown",
  title: "The Ember Crown",
  beats: Object.freeze(
    STORY_BEAT_NAMES.map((name, index) => Object.freeze({
      id: [
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
      ][index],
      name,
      budget: { target: 1 },
    })),
  ),
  endings: Object.freeze([]),
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.trunc(finiteNumber(value, fallback)));
}

function recordValue(source, key) {
  if (source instanceof Map) return source.get(key);
  if (Array.isArray(source)) return source.find((entry) => entry?.id === key);
  if (source && typeof source === "object") {
    if (source.id === key && Array.isArray(source.beats)) return source;
    return source[key];
  }
  return null;
}

export function resolveStoryArc(state, arcById = {}) {
  const arcId = state?.story?.arcId ?? DEFAULT_ARC.id;
  const resolved = recordValue(arcById, arcId);
  return resolved && Array.isArray(resolved.beats) ? resolved : DEFAULT_ARC;
}

export function resolveCurrentBeat(state, arc = DEFAULT_ARC) {
  const beats = Array.isArray(arc?.beats) && arc.beats.length ? arc.beats : DEFAULT_ARC.beats;
  const beatId = state?.story?.currentBeatId;
  const byId = typeof beatId === "string"
    ? beats.findIndex((beat) => beat?.id === beatId)
    : -1;
  const requestedIndex = nonNegativeInteger(state?.story?.currentBeatIndex);
  const index = byId >= 0 ? byId : Math.min(requestedIndex, beats.length - 1);
  return { beat: beats[index] ?? beats[0], index, beats };
}

function isStoryComplete(story) {
  return Boolean(
    story?.completed === true ||
    story?.status === "complete" ||
    story?.status === "completed",
  );
}

function fallbackStoryProgress(state, arc) {
  const story = state?.story ?? {};
  if (isStoryComplete(story)) return 100;
  const beats = Array.isArray(arc?.beats) && arc.beats.length ? arc.beats : DEFAULT_ARC.beats;
  const completed = new Set(Array.isArray(story.completedBeatIds) ? story.completedBeatIds : []);
  const targetFor = (beat) => Math.max(1, finiteNumber(beat?.budget?.target, 1));
  const totalTarget = beats.reduce((sum, beat) => sum + targetFor(beat), 0);
  const { beat: currentBeat } = resolveCurrentBeat(state, arc);
  let resolvedWeight = beats.reduce(
    (sum, beat) => sum + (completed.has(beat?.id) ? targetFor(beat) : 0),
    0,
  );
  if (currentBeat && !completed.has(currentBeat.id)) {
    const currentTarget = targetFor(currentBeat);
    const currentCount = nonNegativeInteger(story.cardsResolvedInBeat);
    resolvedWeight += Math.min(currentTarget, currentCount);
  }
  return totalTarget > 0 ? (resolvedWeight / totalTarget) * 100 : 0;
}

function storyProgressPercent(state, arc, calculateStoryProgress) {
  let percent;
  if (typeof calculateStoryProgress === "function") {
    const calculated = finiteNumber(calculateStoryProgress(state, arc), Number.NaN);
    if (Number.isFinite(calculated)) percent = calculated <= 1 ? calculated * 100 : calculated;
  }
  if (!Number.isFinite(percent)) percent = fallbackStoryProgress(state, arc);
  if (!isStoryComplete(state?.story)) percent = Math.min(99, percent);
  return Math.max(0, Math.min(100, percent));
}

const PRIORITY_CARD_MODES = new Set(["combat", "combatReward", "loot", "levelUp"]);

function hasPriorityCardSurface(state) {
  const category = state?.currentCardData?.category ?? state?.currentCard?.category;
  return PRIORITY_CARD_MODES.has(state?.mode) || PRIORITY_CARD_MODES.has(category);
}

export function deriveStoryHud(state, {
  arcById = {},
  calculateStoryProgress,
} = {}) {
  const arc = resolveStoryArc(state, arcById);
  const { beat, index, beats } = resolveCurrentBeat(state, arc);
  const progressPercent = storyProgressPercent(state, arc, calculateStoryProgress);
  const arcTitle = arc.title ?? state?.story?.arcTitle ?? DEFAULT_ARC.title;
  const beatName = beat?.name ?? state?.story?.currentBeatName ?? STORY_BEAT_NAMES[index] ?? STORY_BEAT_NAMES[0];
  const beatNumber = index + 1;
  const beatCount = beats.length;
  return {
    arcId: arc.id ?? state?.story?.arcId ?? DEFAULT_ARC.id,
    arcTitle,
    beatId: beat?.id ?? state?.story?.currentBeatId ?? DEFAULT_ARC.beats[0].id,
    beatName,
    beatNumber,
    beatCount,
    progressPercent,
    progressLabel: `${arcTitle}. Beat ${beatNumber} of ${beatCount}: ${beatName}. Story progress: ${Math.round(progressPercent)} percent.`,
  };
}

export function deriveTransitionPresentation(state, { arcById = {} } = {}) {
  if (hasPriorityCardSurface(state)) return null;
  const story = state?.story ?? {};
  const pendingBeatId = typeof story.pendingInterstitialBeatId === "string"
    ? story.pendingInterstitialBeatId
    : state?.mode === "storyTransition"
      ? story.currentBeatId
      : null;
  if (!pendingBeatId) return null;

  const arc = resolveStoryArc(state, arcById);
  const beats = Array.isArray(arc.beats) ? arc.beats : [];
  const index = beats.findIndex((beat) => beat?.id === pendingBeatId);
  const beat = index >= 0 ? beats[index] : resolveCurrentBeat(state, arc).beat;
  const interstitial = beat?.interstitial ?? {};
  const subtitle = interstitial.subtitle ?? interstitial.chapterSubtitle ?? "The road turns";
  const text = interstitial.text ?? interstitial.sentence ?? "A new chapter of the pursuit begins.";
  const beatName = beat?.name ?? STORY_BEAT_NAMES[Math.max(0, index)] ?? "Story transition";
  return {
    arcTitle: arc.title ?? DEFAULT_ARC.title,
    beatId: beat?.id ?? pendingBeatId,
    beatName,
    beatNumber: (index >= 0 ? index : nonNegativeInteger(story.currentBeatIndex)) + 1,
    subtitle,
    text,
    announcement: `${beatName}. ${subtitle}. ${text}`,
  };
}

export function isStoryTransitionActive(state) {
  if (hasPriorityCardSurface(state)) return false;
  return Boolean(
    state?.mode === "storyTransition" ||
    typeof state?.story?.pendingInterstitialBeatId === "string",
  );
}

function sumDefeated(value) {
  if (Number.isFinite(Number(value))) return nonNegativeInteger(value);
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((sum, count) => sum + nonNegativeInteger(count), 0);
}

function titleFromId(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function discoveryLabels(state) {
  const sources = [
    state?.run?.newDiscoveries,
    state?.run?.newDiscoveryIds,
    state?.story?.newDiscoveries,
    state?.story?.newDiscoveryIds,
  ];
  const labels = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const label = typeof entry === "string"
        ? titleFromId(entry)
        : entry?.name ?? entry?.title ?? titleFromId(entry?.id);
      if (label) labels.push(label);
    }
  }
  if (state?.run?.newEndingDiscovered === true && state?.story?.endingTitle) {
    labels.push(`Ending: ${state.story.endingTitle}`);
  }
  return [...new Set(labels)];
}

function findEnding(arc, endingId) {
  const endings = arc?.endings;
  if (Array.isArray(endings)) return endings.find((ending) => ending?.id === endingId) ?? null;
  return endings && typeof endings === "object" ? endings[endingId] ?? null : null;
}

export function deriveTerminalPresentation(state, options = {}) {
  if (!state || !["gameOver", "victory"].includes(state.mode)) return null;
  const hud = deriveStoryHud(state, options);
  const arc = resolveStoryArc(state, options.arcById);
  const story = state.story ?? {};
  const isVictory = state.mode === "victory";
  const ending = findEnding(arc, story.endingId);
  const endingTitle = story.endingTitle ?? ending?.title ?? titleFromId(story.endingId);
  const completedBeatCount = isStoryComplete(story)
    ? hud.beatCount
    : Math.min(hud.beatCount, Array.isArray(story.completedBeatIds) ? story.completedBeatIds.length : 0);
  const worldDecisions = nonNegativeInteger(story.totalWorldCardsResolved);
  const enemiesDefeated = sumDefeated(state.run?.enemiesDefeated ?? state.run?.stats?.enemiesDefeated);
  const itemsDiscovered = nonNegativeInteger(
    state.run?.itemsDiscovered ?? state.run?.itemsFound ?? state.run?.stats?.itemsDiscovered,
  );
  const rawDeathCause = state.run?.causeOfDeath ?? state.run?.deathCause ?? story.deathCause;
  const deathEnemy = typeof rawDeathCause === "string"
    ? recordValue(options.enemyById, rawDeathCause)
    : null;
  const deathCause = deathEnemy?.name ?? rawDeathCause ?? "Fell during the arc";
  const discoveries = discoveryLabels(state);

  if (!isVictory) {
    return {
      kind: "death",
      kicker: "Arc ended",
      arcTitle: hud.arcTitle,
      title: "The Ember Fades",
      copy: String(deathCause),
      restartLabel: "Restart Arc",
      discoveries,
      stats: [
        { label: "Beat reached", value: `${hud.beatNumber} / ${hud.beatCount} · ${hud.beatName}`, wide: true },
        { label: "Story progress", value: `${Math.round(hud.progressPercent)}%` },
        { label: "Final level", value: String(Math.max(1, nonNegativeInteger(state.player?.level, 1))) },
        { label: "World decisions", value: String(worldDecisions) },
        { label: "Enemies defeated", value: String(enemiesDefeated) },
        { label: "Cause of death", value: String(deathCause), wide: true },
      ],
    };
  }

  return {
    kind: "victory",
    kicker: "Arc complete",
    arcTitle: hud.arcTitle,
    title: endingTitle || "The Ember Crown Restored",
    copy: story.endingSummary ?? ending?.summary ?? "Hearthvale wakes beneath a changed flame.",
    restartLabel: "Begin Another Arc",
    discoveries,
    stats: [
      { label: "Final level", value: String(Math.max(1, nonNegativeInteger(state.player?.level, 1))) },
      { label: "World decisions", value: String(worldDecisions) },
      { label: "Enemies defeated", value: String(enemiesDefeated) },
      { label: "Items discovered", value: String(itemsDiscovered) },
      { label: "Beat completion", value: `${completedBeatCount} / ${hud.beatCount}` },
      { label: "Story progress", value: `${Math.round(hud.progressPercent)}%` },
    ],
  };
}
