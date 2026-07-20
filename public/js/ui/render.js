import { FEEDBACK_ART_BY_TONE } from "../game/choice-feedback.js";
import { artSourceForId } from "../data/art-assets.js";
import {
  CHOICE_COST_KEYS,
  CHOICE_COST_LABELS,
  getDirectionAvailability,
  normalizeChoiceCosts,
} from "../game/choice-availability.js";

export const DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);

export { FEEDBACK_ART_BY_TONE };

const FEEDBACK_TITLE_BY_TONE = Object.freeze({
  neutral: "Your Choice",
  reward: "Discovery",
  damage: "The Cost",
  danger: "Consequence",
});

const RESOURCE_FIELDS = Object.freeze(["eldritchLore", "crew", "sanity"]);
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

function finiteDelta(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
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
  const safeFallback = SAFE_ART_ID.test(fallbackId) ? fallbackId : DEFAULT_ART_ID;
  const candidate =
    typeof artId === "string" &&
    SAFE_ART_ID.test(artId) &&
    allowlist.has(artId)
      ? artId
      : safeFallback;
  return artSourceForId(candidate);
}

export function deriveDeckHud(state, story) {
  const decks = Array.isArray(story?.decks) ? story.decks : [];
  const feedback = state?.pendingFeedback;
  const deckId =
    typeof feedback?.sourceDeckId === "string"
      ? feedback.sourceDeckId
      : state?.currentDeckId;
  const deck =
    decks.find(({ id }) => id === deckId) ??
    decks[0] ??
    { id: "it-begins-here", title: "It begins here", type: "intro" };
  const plotDecks = decks.filter(({ type }) => type === "plot");
  const chapterNumber =
    Number.isInteger(deck.plotStep) && deck.plotStep > 0
      ? deck.plotStep
      : Math.max(1, plotDecks.findIndex(({ id }) => id === deck.id) + 1);
  const deckCards = Array.isArray(deck.cards) ? deck.cards : [];
  const cardIds = new Set(
    deckCards
      .map((card) => typeof card === "string" ? card : card?.id)
      .filter((id) => typeof id === "string"),
  );
  const drawPile = Array.isArray(state?.drawStateByDeck?.[deck.id]?.drawPile)
    ? state.drawStateByDeck[deck.id].drawPile
    : [];
  const currentCardBelongsToDeck =
    !feedback &&
    state?.currentDeckId === deck.id &&
    cardIds.has(state?.currentCardId);
  const feedbackSourceBelongsToDeck =
    Boolean(feedback) &&
    feedback.sourceDeckId === deck.id &&
    cardIds.has(feedback.sourceCardId);
  const cardsLeft =
    deck.type === "intro"
      ? Math.max(0, deckCards.length - Math.max(0, Number(state?.introCardIndex) || 0))
      : drawPile.length +
        (currentCardBelongsToDeck || feedbackSourceBelongsToDeck ? 1 : 0);
  const cardsLeftLabel = `${cardsLeft} ${cardsLeft === 1 ? "card" : "cards"} left in deck`;
  const deckLabel =
    deck.type === "intro"
      ? `${deck.title} - ${cardsLeftLabel}`
      : `${deck.title}, Chapter ${chapterNumber} - ${cardsLeftLabel}`;
  const cardSpeakerLabel =
    deck.type === "intro"
      ? `${deck.title} - ${cardsLeftLabel}`
      : `Chapter ${chapterNumber}, ${deck.title} - ${cardsLeftLabel}`;
  return {
    storyTitle: String(story?.title ?? "Deep South"),
    deck,
    deckLabel,
    cardSpeakerLabel,
    isIntro: deck.type === "intro",
    chapterNumber: deck.type === "plot" ? chapterNumber : null,
    cardsLeft,
    cardsLeftLabel,
  };
}

export function choiceForDirection(_state, card, direction) {
  if (!DIRECTIONS.includes(direction)) return null;
  return card?.choices?.[direction] ?? null;
}

export function affectedResources(choice) {
  const effects =
    choice?.effects && typeof choice.effects === "object" ? choice.effects : {};
  const costs = normalizeChoiceCosts(choice?.costs);
  return RESOURCE_FIELDS.filter(
    (resource) =>
      finiteDelta(effects[resource]) !== 0 || Number(costs[resource] ?? 0) > 0,
  );
}

export function choiceDetail(choice) {
  const effects =
    choice?.effects && typeof choice.effects === "object" ? choice.effects : {};
  const costs = normalizeChoiceCosts(choice?.costs);
  const costDetail = CHOICE_COST_KEYS.flatMap((resource) => {
    const cost = Number(costs[resource] ?? 0);
    return cost ? [`Costs ${cost} ${CHOICE_COST_LABELS[resource]}`] : [];
  });
  const effectDetail = RESOURCE_FIELDS.flatMap((resource) => {
    const delta = finiteDelta(effects[resource]);
    return delta
      ? [`${delta > 0 ? "+" : ""}${delta} ${RESOURCE_LABELS[resource]}`]
      : [];
  });
  return [...costDetail, ...effectDetail].join(" · ");
}

export function deriveChoicePresentation(state, card, direction) {
  const availability = getDirectionAvailability(state, card, direction);
  const choice = availability.choice;
  const label = choice ? String(choice.label ?? "Continue") : "No option";
  const detail = choice
    ? availability.available
      ? choiceDetail(choice)
      : availability.requirementText
    : "";
  const directionLabel = `${direction[0].toUpperCase()}${direction.slice(1)}`;
  return {
    ...availability,
    label,
    detail,
    affects: choice ? affectedResources(choice) : [],
    ariaLabel: `${directionLabel}: ${label}${
      detail
        ? `. ${detail}`
        : choice
          ? ""
          : `. ${availability.requirementText}`
    }`,
  };
}

export function cardAnnouncement(state, card, contextLabel = null) {
  const speakerLabel =
    contextLabel ?? (card?.speaker ? String(card.speaker) : "");
  const parts = [
    speakerLabel,
    String(card?.title ?? "The southern sea"),
    String(card?.text ?? "The expedition waits."),
    card?.detail ? String(card.detail) : "",
  ];
  for (const direction of DIRECTIONS) {
    const presentation = deriveChoicePresentation(state, card, direction);
    parts.push(presentation.ariaLabel.replace(/[.!?]+$/, ""));
  }
  return parts.filter(Boolean).map(punctuationSafeSentence).join(" ");
}

function feedbackValue(resource, delta) {
  return `${delta > 0 ? "+" : ""}${delta} ${RESOURCE_LABELS[resource]}`;
}

function feedbackAnnouncement(resource, delta) {
  return `${RESOURCE_LABELS[resource]} ${delta > 0 ? "plus" : "minus"} ${Math.abs(delta)}`;
}

export function deriveFeedbackPresentation(feedback) {
  if (
    !feedback ||
    typeof feedback.id !== "string" ||
    !feedback.id.trim() ||
    typeof feedback.resultText !== "string" ||
    !feedback.resultText.trim()
  ) {
    return null;
  }
  const changes = Object.fromEntries(
    RESOURCE_FIELDS.map((resource) => [
      resource,
      finiteDelta(feedback.changes?.[resource]),
    ]),
  );
  const tone = Object.hasOwn(FEEDBACK_ART_BY_TONE, feedback.tone)
    ? feedback.tone
    : "neutral";
  const rows = RESOURCE_FIELDS.flatMap((resource) => {
    const delta = changes[resource];
    return delta
      ? [{
          key: resource,
          label: RESOURCE_LABELS[resource],
          value: feedbackValue(resource, delta),
          direction: delta > 0 ? "gain" : "loss",
          announcement: feedbackAnnouncement(resource, delta),
        }]
      : [];
  });
  const title = FEEDBACK_TITLE_BY_TONE[tone];
  const text = feedback.resultText.trim();
  return {
    id: feedback.id,
    tone,
    title,
    text,
    artId: FEEDBACK_ART_BY_TONE[tone],
    rows,
    announcement: `${title}. ${punctuationSafeSentence(text)}${
      rows.length
        ? ` ${rows.map(({ announcement }) => announcement).join(". ")}.`
        : ""
    } Continue.`,
  };
}

export function deriveLossPresentation(state) {
  if (state?.status !== "lost") return null;
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
  story = { id: "deep-south", title: "Deep South", decks: [] },
  allowedArtIds = new Set(),
} = {}) {
  const elements = {
    app: byId("app"),
    playerHud: byId("player-hud"),
    storyTitle: byId("story-title"),
    deckTitle: byId("hud-deck-title"),
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
    choiceFeedbackCard: byId("choice-feedback-card"),
    choiceFeedbackKicker: byId("choice-feedback-kicker"),
    choiceFeedbackTitle: byId("choice-feedback-title"),
    choiceFeedbackText: byId("choice-feedback-text"),
    choiceFeedbackArt: byId("choice-feedback-art"),
    choiceFeedbackChanges: byId("choice-feedback-changes"),
    choiceFeedbackControls: byId("choice-feedback-controls"),
    choiceFeedbackContinue: byId("choice-feedback-continue"),
    terminal: byId("terminal-summary"),
    terminalTitle: byId("terminal-title"),
    terminalCopy: byId("terminal-copy"),
    terminalStats: byId("terminal-stats"),
    terminalRestart: byId("terminal-restart"),
    choiceOverlays: {},
    choiceOverlayLabels: {},
    choiceOverlayDetails: {},
  };

  for (const direction of DIRECTIONS) {
    elements.choiceOverlays[direction] = byId(`choice-${direction}-overlay`);
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
    elements.deckTitle.textContent = hud.deckLabel;
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
    elements.resourceRow.setAttribute("aria-label", `Expedition resources. ${values}.`);
    elements.playerHud.setAttribute(
      "aria-label",
      `${hud.storyTitle}. ${hud.deckLabel}. ${values}.`,
    );
    return hud;
  };

  const setChoicePreview = (state, card, direction) => {
    const overlayLabel = elements.choiceOverlayLabels[direction];
    const overlayDetail = elements.choiceOverlayDetails[direction];
    const presentation = deriveChoicePresentation(state, card, direction);
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
    const introFace =
      card?.introFace === "front" || card?.introFace === "reverse"
        ? card.introFace
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
    elements.card.dataset.cardId = String(card?.id ?? "deep-south-card");
    elements.card.dataset.deckType = hud.isIntro ? "intro" : "plot";
    if (introFace) elements.card.dataset.introFace = introFace;
    else delete elements.card.dataset.introFace;
    for (const direction of DIRECTIONS) {
      setChoicePreview(state, card, direction);
    }
    const announcement = cardAnnouncement(state, card, hud.cardSpeakerLabel);
    elements.card.setAttribute("aria-label", announcement);
    const announcementKey = `${String(state.currentCardToken ?? card?.id ?? "card")}:${
      state.introSkipPending ? "skip" : "normal"
    }:${introFace ?? "single"}`;
    if (lastAnnouncementKey !== announcementKey) {
      lastAnnouncementKey = announcementKey;
      elements.cardLive.textContent = announcement;
    }
  };

  const setInteractiveSurface = () => {
    elements.card.hidden = false;
    elements.cardBackdrop.hidden = false;
    elements.choiceFeedbackCard.hidden = true;
    elements.choiceFeedbackControls.hidden = true;
    elements.terminal.hidden = true;
    elements.card.removeAttribute("inert");
    elements.card.tabIndex = 0;
    elements.choiceFeedbackContinue.disabled = true;
    elements.terminalRestart.disabled = true;
    elements.cardStack.setAttribute("aria-label", "Current story card");
    lastSpecialAnnouncementKey = null;
  };

  const setFeedbackSurface = () => {
    activeCard = null;
    lastAnnouncementKey = null;
    clearPreviewTargets();
    elements.card.hidden = true;
    elements.cardBackdrop.hidden = false;
    elements.choiceFeedbackCard.hidden = false;
    elements.choiceFeedbackControls.hidden = false;
    elements.terminal.hidden = true;
    elements.card.setAttribute("inert", "");
    elements.card.tabIndex = -1;
    elements.choiceFeedbackContinue.disabled = false;
    elements.terminalRestart.disabled = true;
    elements.cardStack.setAttribute("aria-label", "Choice outcome");
  };

  const setTerminalSurface = () => {
    activeCard = null;
    lastAnnouncementKey = null;
    clearPreviewTargets();
    elements.card.hidden = true;
    elements.cardBackdrop.hidden = true;
    elements.choiceFeedbackCard.hidden = true;
    elements.choiceFeedbackControls.hidden = true;
    elements.terminal.hidden = false;
    elements.card.setAttribute("inert", "");
    elements.card.tabIndex = -1;
    elements.choiceFeedbackContinue.disabled = true;
    elements.terminalRestart.disabled = false;
    elements.cardStack.setAttribute("aria-label", "Expedition lost");
  };

  const renderFeedback = (presentation) => {
    setFeedbackSurface();
    elements.choiceFeedbackCard.dataset.tone = presentation.tone;
    elements.choiceFeedbackKicker.textContent = "Outcome";
    elements.choiceFeedbackTitle.textContent = presentation.title;
    elements.choiceFeedbackText.textContent = presentation.text;
    elements.choiceFeedbackArt.src = resolveArtSource(
      presentation.artId,
      allowedArtIds,
      FEEDBACK_ART_BY_TONE[presentation.tone],
    );
    elements.choiceFeedbackArt.alt = "";
    elements.choiceFeedbackChanges.replaceChildren();
    elements.choiceFeedbackChanges.hidden = presentation.rows.length === 0;
    for (const row of presentation.rows) {
      const group = document.createElement("div");
      group.className = "choice-feedback-change-row";
      const term = document.createElement("dt");
      term.className = "choice-feedback-change-label";
      term.textContent = row.label;
      const value = document.createElement("dd");
      value.className = "choice-feedback-change-value";
      value.dataset.direction = row.direction;
      value.textContent = row.value;
      group.append(term, value);
      elements.choiceFeedbackChanges.append(group);
    }
    elements.choiceFeedbackContinue.setAttribute(
      "aria-label",
      presentation.rows.length
        ? "Continue after reviewing the outcome and resource changes"
        : "Continue after reviewing the outcome",
    );
    const announcementKey = `feedback:${presentation.id}`;
    if (lastSpecialAnnouncementKey !== announcementKey) {
      lastSpecialAnnouncementKey = announcementKey;
      elements.cardLive.textContent = presentation.announcement;
    }
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
      group.className = "rounded-lg bg-[#091923] px-2 py-2";
      const term = document.createElement("dt");
      term.className =
        "text-[0.58rem] font-black uppercase tracking-wider text-[#87a1aa]";
      term.textContent = stat.label;
      const value = document.createElement("dd");
      value.className = "mt-0.5 text-sm font-black text-[#fff6e6]";
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
      elements.app.dataset.mode =
        state.status === "lost" ? "lost" : hud.isIntro ? "intro" : "plot";

      const feedback = deriveFeedbackPresentation(state.pendingFeedback);
      if (feedback) {
        renderFeedback(feedback);
        return;
      }

      const loss = deriveLossPresentation(state);
      if (loss) {
        renderLoss(loss);
        return;
      }

      setInteractiveSurface();
      renderCard(state, card);
    },
    focusPrimarySurface() {
      if (!elements.choiceFeedbackCard.hidden) {
        elements.choiceFeedbackContinue.focus();
      } else if (!elements.terminal.hidden) {
        elements.terminalRestart.focus();
      } else {
        elements.card.focus();
      }
    },
    previewChoice(direction) {
      const choice = choiceForDirection(currentState, activeCard, direction);
      clearPreviewTargets();
      if (!getDirectionAvailability(currentState, activeCard, direction).available) {
        return;
      }
      for (const resource of affectedResources(choice)) {
        resourceTargets[resource].dataset.previewed = "true";
      }
    },
  };
}
