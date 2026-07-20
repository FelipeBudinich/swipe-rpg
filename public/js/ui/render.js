import { artSourceForId } from "../data/art-assets.js";
import { DEEP_SOUTH_STORY } from "../data/deep-south.js";
import {
  effectAffectedResources,
  formatCardEffect,
} from "../game/card-effects.js";
import {
  DIRECTIONS,
  planDirection,
} from "../game/direction-plan.js";
import { normalizeEffectLog } from "../game/run-log.js";

export { DIRECTIONS };

const RESOURCE_FIELDS = Object.freeze([
  "eldritchLore",
  "crew",
  "sanity",
]);
const RESOURCE_LABELS = Object.freeze({
  eldritchLore: "Eldritch Lore",
  crew: "Crew",
  sanity: "Sanity",
});
const SAFE_ART_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_ART_ID = "deep-south-it-begins-here";

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
}

function finiteResourceValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function punctuationSafeSentence(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /[.!?][”"']?$/.test(text) ? text : `${text}.`;
}

export function resolveArtSource(
  artId,
  allowedArtIds,
  fallbackId = DEFAULT_ART_ID,
) {
  const allowlist =
    allowedArtIds instanceof Set ? allowedArtIds : new Set(allowedArtIds ?? []);
  const safeFallback = SAFE_ART_ID.test(fallbackId)
    ? fallbackId
    : DEFAULT_ART_ID;
  const candidate =
    typeof artId === "string" &&
    SAFE_ART_ID.test(artId) &&
    allowlist.has(artId)
      ? artId
      : safeFallback;
  return artSourceForId(candidate);
}

export function deriveDeckHud(state, story = DEEP_SOUTH_STORY) {
  const decks = Array.isArray(story?.decks) ? story.decks : [];
  const deck =
    decks.find(({ id }) => id === state?.currentDeckId) ??
    decks[0] ??
    { id: "it-begins-here", title: "It begins here", type: "intro" };
  const plotDecks = decks.filter(({ type }) => type === "plot");
  const chapterNumber =
    Number.isInteger(deck.plotStep) && deck.plotStep > 0
      ? deck.plotStep
      : Math.max(1, plotDecks.findIndex(({ id }) => id === deck.id) + 1);
  const deckCards = Array.isArray(deck.cards) ? deck.cards : [];
  const defaultUnlockedIds = deckCards
    .filter((card) => card?.initiallyAvailable !== false)
    .map((card) => typeof card === "string" ? card : card?.id)
    .filter(Boolean);
  const unlockedIds =
    deck.type === "plot"
      ? new Set(
          state?.unlockedCardIdsByDeck?.[deck.id] ??
            defaultUnlockedIds,
        )
      : new Set(deckCards.map((card) => card?.id).filter(Boolean));
  const cardIds = new Set(
    deckCards
      .map((card) => typeof card === "string" ? card : card?.id)
      .filter((id) => typeof id === "string" && unlockedIds.has(id)),
  );
  const drawPile = new Set(
    (Array.isArray(state?.drawStateByDeck?.[deck.id]?.drawPile)
      ? state.drawStateByDeck[deck.id].drawPile
      : [])
      .map((card) => typeof card === "string" ? card : card?.id)
      .filter(
        (id) =>
          typeof id === "string" &&
          id.trim() &&
          cardIds.has(id),
      ),
  );
  const activeCardId =
    state?.currentDeckId === deck.id && cardIds.has(state?.currentCardId)
      ? state.currentCardId
      : null;
  const cardsLeft =
    deck.type === "intro"
      ? Math.max(
          0,
          deckCards.length -
            Math.max(0, Number(state?.introCardIndex) || 0),
        )
      : drawPile.size +
        (activeCardId && !drawPile.has(activeCardId) ? 1 : 0);
  const cardsLeftLabel =
    `${cardsLeft} ${cardsLeft === 1 ? "card" : "cards"} left in deck`;
  const cardSpeakerLabel =
    deck.type === "intro"
      ? `${deck.title} - ${cardsLeftLabel}`
      : `Chapter ${chapterNumber}, ${deck.title} - ${cardsLeftLabel}`;
  return {
    storyTitle: String(story?.title ?? "Deep South"),
    deck,
    cardSpeakerLabel,
    isIntro: deck.type === "intro",
    chapterNumber: deck.type === "plot" ? chapterNumber : null,
    cardsLeft,
    cardsLeftLabel,
  };
}

function storyDecks(story) {
  return Array.isArray(story?.decks) ? story.decks : [];
}

function deckStageLabel(deck, story) {
  if (deck?.type === "intro") return "Prologue";
  const plotDecks = storyDecks(story).filter(({ type }) => type === "plot");
  const fallback = plotDecks.findIndex(({ id }) => id === deck?.id) + 1;
  const step = Number.isInteger(deck?.plotStep) && deck.plotStep > 0
    ? deck.plotStep
    : fallback;
  return `Chapter ${step}`;
}

function cardAndDeckById(cardId, story) {
  for (const deck of storyDecks(story)) {
    const card = (deck.cards ?? []).find(({ id }) => id === cardId);
    if (card) return { card, deck };
  }
  return { card: null, deck: null };
}

export function deriveChapterMapPresentation(
  state,
  currentCard,
  story = DEEP_SOUTH_STORY,
) {
  const decks = storyDecks(story);
  const currentIndex = Math.max(
    0,
    decks.findIndex(({ id }) => id === state?.currentDeckId),
  );
  const currentDeck = decks[currentIndex] ?? null;
  const authored = cardAndDeckById(state?.currentCardId, story).card;
  const authoredFace = new Set(state?.revealedCardIds ?? []).has(authored?.id)
    ? authored?.faces?.back
    : authored?.faces?.front;
  const currentCardTitle = String(
    currentCard?.title ?? authoredFace?.title ?? "",
  );
  const currentLabel = currentDeck?.type === "intro"
    ? "Current location: It begins here"
    : `Current location: ${deckStageLabel(currentDeck, story)}, ${String(currentDeck?.title ?? "Unknown")}`;

  return {
    currentDeckId: currentDeck?.id ?? null,
    currentLabel,
    currentCardTitle,
    nodes: decks.map((deck, index) => ({
      id: deck.id,
      title: String(deck.title ?? deck.id),
      stageLabel: deckStageLabel(deck, story),
      position:
        index < currentIndex
          ? "before"
          : index === currentIndex
            ? "current"
            : "after",
      current: index === currentIndex,
    })),
  };
}

const DIRECTION_LABELS = Object.freeze({
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
});

export function deriveEffectLogPresentation(
  state,
  story = DEEP_SOUTH_STORY,
) {
  const normalized = normalizeEffectLog(state?.effectLog, story);
  return normalized
    .map((entry, index) => {
      const { card, deck } = cardAndDeckById(entry.cardId, story);
      const title = entry.kind === "reveal"
        ? card?.faces?.back?.title
        : card?.faces?.front?.title;
      const chapterLabel = deck?.type === "intro"
        ? "It begins here"
        : `${deckStageLabel(deck, story)}, ${String(deck?.title ?? "Unknown")}`;
      return {
        id: entry.id,
        sequence: index + 1,
        kind: entry.kind,
        kindLabel: entry.kind === "reveal" ? "Card revealed" : "Arrival effect",
        direction: entry.direction,
        directionLabel: DIRECTION_LABELS[entry.direction],
        cardId: entry.cardId,
        cardTitle: String(title ?? entry.cardId),
        chapterLabel,
        detail: formatCardEffect(entry.effect, story),
      };
    })
    .reverse();
}

export function choiceForDirection(
  state,
  card,
  direction,
  story = DEEP_SOUTH_STORY,
) {
  if (!DIRECTIONS.includes(direction)) return null;
  const plan = planDirection(state, card, direction, story);
  return plan.available ? plan : null;
}

export function affectedResources(choiceOrEffect, story = DEEP_SOUTH_STORY) {
  if (Array.isArray(choiceOrEffect?.affectedResources)) {
    return [...choiceOrEffect.affectedResources];
  }
  return effectAffectedResources(
    choiceOrEffect?.effect ?? choiceOrEffect,
    story,
  );
}

export function choiceDetail(choiceOrEffect, story = DEEP_SOUTH_STORY) {
  if (typeof choiceOrEffect?.detail === "string") {
    return choiceOrEffect.detail;
  }
  return formatCardEffect(
    choiceOrEffect?.effect ?? choiceOrEffect,
    story,
  );
}

export function deriveChoicePresentation(
  state,
  card,
  direction,
  story = DEEP_SOUTH_STORY,
) {
  const plan = planDirection(state, card, direction, story);
  const label = String(plan.label ?? "No option");
  const detail = plan.available
    ? String(plan.detail ?? "")
    : String(plan.requirementText ?? "");
  const directionLabel =
    `${direction[0].toUpperCase()}${direction.slice(1)}`;
  return {
    ...plan,
    label,
    detail,
    affects: [...(plan.affectedResources ?? [])],
    ariaLabel: `${directionLabel}: ${label}${
      detail ? `. ${detail}` : ""
    }`,
  };
}

export function cardAnnouncement(
  state,
  card,
  contextLabel = null,
  story = DEEP_SOUTH_STORY,
) {
  const speakerLabel =
    contextLabel ?? (card?.speaker ? String(card.speaker) : "");
  const parts = [
    speakerLabel,
    String(card?.title ?? "The southern sea"),
    String(card?.text ?? "The expedition waits."),
    card?.detail ? String(card.detail) : "",
  ];
  for (const direction of DIRECTIONS) {
    const presentation = deriveChoicePresentation(
      state,
      card,
      direction,
      story,
    );
    if (
      !presentation.available &&
      (card?.cardFace === "back" ||
        state?.introSkipPending === true) &&
      (direction === "left" || direction === "right")
    ) {
      continue;
    }
    parts.push(presentation.ariaLabel.replace(/[.!?]+$/, ""));
  }
  return parts
    .filter(Boolean)
    .map(punctuationSafeSentence)
    .join(" ");
}

export function deriveLossPresentation(state) {
  if (state?.status !== "lost" || state?.terminalPending) return null;
  const resources = state.resources ?? {};
  return {
    title: "The sea remembers",
    copy:
      "Reason fractures beneath the weight of what the expedition has witnessed.",
    restartLabel: "Begin Again",
    stats: RESOURCE_FIELDS.map((resource) => ({
      key: resource,
      label: RESOURCE_LABELS[resource],
      value: String(finiteResourceValue(resources[resource])),
    })),
    announcement:
      "Expedition lost. Deep South. The sea remembers. Reason fractures beneath the weight of what the expedition has witnessed. Begin Again.",
  };
}

export function createRenderer({
  story = DEEP_SOUTH_STORY,
  allowedArtIds = new Set(),
} = {}) {
  const elements = {
    app: byId("app"),
    playerHud: byId("player-hud"),
    storyTitle: byId("story-title"),
    resourceRow: byId("player-resource-row"),
    eldritchLoreHud: byId("eldritch-lore-hud"),
    eldritchLore: byId("hud-eldritch-lore"),
    crewHud: byId("crew-hud"),
    crew: byId("hud-crew"),
    sanityHud: byId("sanity-hud"),
    sanity: byId("hud-sanity"),
    cardStack: byId("card-stack"),
    cardBackdrop: byId("card-backdrop"),
    card: byId("card"),
    cardArt: byId("card-art"),
    cardArtLabel: byId("card-art-label"),
    speaker: byId("card-speaker"),
    title: byId("card-title"),
    text: byId("card-text"),
    detail: byId("card-detail"),
    cardLive: byId("card-live"),
    terminal: byId("terminal-summary"),
    terminalTitle: byId("terminal-title"),
    terminalCopy: byId("terminal-copy"),
    terminalStats: byId("terminal-stats"),
    terminalRestart: byId("terminal-restart"),
    mapPanel: byId("chapter-map-panel"),
    mapCurrent: byId("chapter-map-current"),
    mapRoute: byId("chapter-map-route"),
    logPanel: byId("effect-log-panel"),
    logSummary: byId("effect-log-summary"),
    logEmpty: byId("effect-log-empty"),
    logList: byId("effect-log-list"),
    logRestart: byId("effect-log-restart"),
    logRestartWarning: byId("effect-log-restart-warning"),
    choiceOverlays: {},
    choiceOverlayLabels: {},
    choiceOverlayDetails: {},
  };

  for (const direction of DIRECTIONS) {
    elements.choiceOverlays[direction] = byId(
      `choice-${direction}-overlay`,
    );
    elements.choiceOverlayLabels[direction] = byId(
      `choice-${direction}-overlay-label`,
    );
    elements.choiceOverlayDetails[direction] = byId(
      `choice-${direction}-overlay-detail`,
    );
  }

  const resourceElements = {
    eldritchLore: elements.eldritchLore,
    crew: elements.crew,
    sanity: elements.sanity,
  };
  const resourceTargets = {
    eldritchLore: elements.eldritchLoreHud,
    crew: elements.crewHud,
    sanity: elements.sanityHud,
  };

  let activeCard = null;
  let currentState = null;
  let lastAnnouncementKey = null;
  let lastSpecialAnnouncementKey = null;

  const clearPreviewTargets = () => {
    for (const target of Object.values(resourceTargets)) {
      delete target.dataset.previewed;
    }
  };

  const renderHud = (state) => {
    const hud = deriveDeckHud(state, story);
    const resources = state.resources ?? {};
    elements.storyTitle.textContent = hud.storyTitle;
    for (const resource of RESOURCE_FIELDS) {
      const value = finiteResourceValue(resources[resource]);
      resourceElements[resource].textContent = String(value);
      resourceTargets[resource].setAttribute(
        "aria-label",
        `${RESOURCE_LABELS[resource]}: ${value}`,
      );
    }
    const values = RESOURCE_FIELDS.map(
      (resource) =>
        `${RESOURCE_LABELS[resource]} ${finiteResourceValue(resources[resource])}`,
    ).join(". ");
    elements.resourceRow.setAttribute(
      "aria-label",
      `Expedition resources. ${values}.`,
    );
    elements.playerHud.setAttribute(
      "aria-label",
      `${hud.storyTitle}. Expedition resources. ${values}.`,
    );
    return hud;
  };

  const renderChapterMap = (state, card) => {
    const presentation = deriveChapterMapPresentation(state, card, story);
    elements.mapCurrent.textContent = presentation.currentLabel;
    const nodes = presentation.nodes.map((node) => {
      const item = document.createElement("li");
      item.className = "chapter-map-node";
      item.dataset.position = node.position;
      if (node.current) item.setAttribute("aria-current", "location");

      const marker = document.createElement("span");
      marker.className = "chapter-map-marker";
      marker.setAttribute("aria-hidden", "true");

      const copy = document.createElement("div");
      copy.className = "chapter-map-copy";
      const stage = document.createElement("span");
      stage.className = "chapter-map-stage";
      stage.textContent = node.stageLabel;
      const name = document.createElement("strong");
      name.className = "chapter-map-name";
      name.textContent = node.title;
      copy.append(stage, name);
      if (node.current && presentation.currentCardTitle) {
        const currentTitle = document.createElement("span");
        currentTitle.className = "chapter-map-current-card";
        currentTitle.textContent = presentation.currentCardTitle;
        copy.append(currentTitle);
      }
      item.append(marker, copy);
      return item;
    });
    elements.mapRoute.replaceChildren(...nodes);
  };

  const renderEffectLog = (state) => {
    const entries = deriveEffectLogPresentation(state, story);
    elements.logSummary.textContent = entries.length === 0
      ? "No effects recorded"
      : `${entries.length} ${entries.length === 1 ? "effect" : "effects"} recorded`;
    elements.logEmpty.hidden = entries.length > 0;
    elements.logList.hidden = entries.length === 0;
    const children = entries.map((entry) => {
      const item = document.createElement("li");
      item.className = "effect-log-entry";
      item.dataset.effectKind = entry.kind;

      const meta = document.createElement("div");
      meta.className = "effect-log-meta";
      const kind = document.createElement("span");
      kind.className = "effect-log-kind";
      kind.textContent = entry.kindLabel;
      const sequence = document.createElement("span");
      sequence.className = "effect-log-sequence";
      sequence.textContent = `Effect ${entry.sequence}`;
      meta.append(kind, sequence);

      const title = document.createElement("h3");
      title.className = "effect-log-card-title";
      title.textContent = entry.cardTitle;
      const location = document.createElement("p");
      location.className = "effect-log-location";
      location.textContent = `${entry.chapterLabel} · ${entry.directionLabel}`;
      const detail = document.createElement("p");
      detail.className = "effect-log-detail";
      detail.textContent = entry.detail;
      item.append(meta, title, location, detail);
      return item;
    });
    elements.logList.replaceChildren(...children);
  };

  const setChoicePreview = (state, card, direction) => {
    const overlayLabel = elements.choiceOverlayLabels[direction];
    const overlayDetail = elements.choiceOverlayDetails[direction];
    const presentation = deriveChoicePresentation(
      state,
      card,
      direction,
      story,
    );
    overlayLabel.textContent = presentation.label;
    const previewDetail = String(presentation.detail ?? "").trim();
    overlayDetail.textContent = previewDetail;
    overlayDetail.hidden = !previewDetail;
  };

  const renderCard = (state, card) => {
    activeCard = card;
    const title = String(card?.title ?? "The southern sea");
    const text = String(card?.text ?? "The expedition waits.");
    const detail = String(card?.detail ?? "").trim();
    const artLabel = String(card?.artLabel ?? "").trim();
    const face =
      card?.cardFace === "front" || card?.cardFace === "back"
        ? card.cardFace
        : null;
    const hud = deriveDeckHud(state, story);
    elements.speaker.textContent = hud.cardSpeakerLabel;
    elements.title.textContent = title;
    elements.text.textContent = text;
    elements.detail.textContent = detail;
    elements.detail.hidden = !detail;
    elements.cardArt.src = resolveArtSource(
      card?.artId,
      allowedArtIds,
      story.decks?.[0]?.artId ?? DEFAULT_ART_ID,
    );
    elements.cardArt.alt = String(card?.artAlt ?? "");
    elements.cardArt.draggable = false;
    elements.cardArtLabel.textContent = artLabel;
    elements.cardArtLabel.hidden = !artLabel;
    elements.card.dataset.cardId = String(
      card?.id ?? "deep-south-card",
    );
    elements.card.dataset.deckType = hud.isIntro ? "intro" : "plot";
    if (face) elements.card.dataset.cardFace = face;
    else delete elements.card.dataset.cardFace;
    for (const direction of DIRECTIONS) {
      setChoicePreview(state, card, direction);
    }
    const announcement = cardAnnouncement(
      state,
      card,
      hud.cardSpeakerLabel,
      story,
    );
    elements.card.setAttribute("aria-label", announcement);
    const announcementKey =
      `${String(state.currentCardToken ?? card?.id ?? "card")}:` +
      `${state.introSkipPending ? "skip" : "normal"}:${face ?? "control"}`;
    if (lastAnnouncementKey !== announcementKey) {
      lastAnnouncementKey = announcementKey;
      elements.cardLive.textContent = announcement;
    }
  };

  const setInteractiveSurface = () => {
    elements.card.hidden = false;
    elements.cardBackdrop.hidden = false;
    elements.terminal.hidden = true;
    elements.card.removeAttribute("inert");
    elements.card.tabIndex = 0;
    elements.terminalRestart.disabled = true;
    elements.cardStack.setAttribute("aria-label", "Current story card");
    lastSpecialAnnouncementKey = null;
  };

  const setTerminalSurface = () => {
    activeCard = null;
    lastAnnouncementKey = null;
    clearPreviewTargets();
    elements.card.hidden = true;
    elements.cardBackdrop.hidden = true;
    elements.terminal.hidden = false;
    elements.card.setAttribute("inert", "");
    elements.card.tabIndex = -1;
    elements.terminalRestart.disabled = false;
    elements.cardStack.setAttribute("aria-label", "Expedition lost");
  };

  const renderLoss = (presentation) => {
    setTerminalSurface();
    elements.terminalTitle.textContent = presentation.title;
    elements.terminalCopy.textContent = presentation.copy;
    elements.terminalRestart.textContent = presentation.restartLabel;
    elements.terminalRestart.setAttribute(
      "aria-label",
      `${presentation.restartLabel}: restart Deep South`,
    );
    elements.terminalStats.replaceChildren();
    for (const stat of presentation.stats) {
      const group = document.createElement("div");
      group.className =
        "rounded-lg bg-[#091923] px-2 py-2";
      const term = document.createElement("dt");
      term.className =
        "text-[0.58rem] font-black uppercase tracking-wider text-[#87a1aa]";
      term.textContent = stat.label;
      const value = document.createElement("dd");
      value.className =
        "mt-0.5 text-sm font-black text-[#fff6e6]";
      value.textContent = stat.value;
      group.append(term, value);
      elements.terminalStats.append(group);
    }
    const announcementKey = "terminal:lost";
    if (lastSpecialAnnouncementKey !== announcementKey) {
      lastSpecialAnnouncementKey = announcementKey;
      elements.cardLive.textContent = presentation.announcement;
    }
  };

  return {
    elements,
    render(state, card) {
      currentState = state;
      elements.app.setAttribute("aria-busy", "false");
      elements.card.setAttribute("aria-busy", "false");
      const hud = renderHud(state);
      renderChapterMap(state, card);
      renderEffectLog(state);
      elements.app.dataset.mode =
        state.status === "lost" && !state.terminalPending
          ? "lost"
          : hud.isIntro
            ? "intro"
            : "plot";

      const loss = deriveLossPresentation(state);
      if (loss) {
        renderLoss(loss);
        return;
      }

      setInteractiveSurface();
      renderCard(state, card);
    },
    focusPrimarySurface() {
      if (!elements.terminal.hidden) {
        elements.terminalRestart.focus();
      } else {
        elements.card.focus();
      }
    },
    previewChoice(direction) {
      const plan = planDirection(
        currentState,
        activeCard,
        direction,
        story,
      );
      clearPreviewTargets();
      if (!plan.available) return;
      for (const resource of plan.affectedResources ?? []) {
        resourceTargets[resource].dataset.previewed = "true";
      }
    },
    clearPreview() {
      clearPreviewTargets();
    },
  };
}
