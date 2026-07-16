import {
  deriveStoryHud,
  deriveTerminalPresentation,
  deriveTransitionPresentation,
} from "./story-transition.js";

const RESOURCE_EFFECTS = {
  modifyHp: "hp",
  heal: "hp",
  healPercent: "hp",
  damage: "hp",
  modifyMp: "mp",
  restoreMp: "mp",
  modifyGold: "gold",
  addGold: "gold",
  spendGold: "gold",
  addXp: "xp",
  boundedHpLoss: "hp",
  applyBoundedHpLoss: "hp",
};

const RESOURCE_LABELS = {
  hp: "HP",
  mp: "MP",
  xp: "XP",
  gold: "gold",
  story: "story progress",
  enemyHp: "enemy HP",
  defense: "defense",
  attack: "attack",
  item: "item",
  inventory: "inventory",
};

const SAFE_ART_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveArtSource(artId, allowedArtIds, fallbackId = "player") {
  const allowlist = allowedArtIds instanceof Set ? allowedArtIds : new Set(allowedArtIds ?? []);
  const candidate =
    typeof artId === "string" && SAFE_ART_ID.test(artId) && allowlist.has(artId)
      ? artId
      : fallbackId;
  const safeId =
    typeof candidate === "string" && SAFE_ART_ID.test(candidate) &&
    (allowlist.has(candidate) || candidate === "player")
      ? candidate
      : "player";
  return `/assets/art/${safeId}.svg`;
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
}

function clampPercent(value, maximum) {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maximum) * 100));
}

function setBar(element, value, maximum) {
  const percent = clampPercent(value, maximum);
  element.style.setProperty("--bar-fill", `${percent}%`);
  element.value = Math.max(0, value);
  element.max = Math.max(1, maximum);
  element.textContent = `${Math.max(0, value)} of ${Math.max(1, maximum)}`;
  element.setAttribute("aria-valuenow", String(Math.max(0, value)));
  element.setAttribute("aria-valuemax", String(Math.max(1, maximum)));
}

function lookupById(source, id) {
  if (!id) return null;
  if (source instanceof Map) return source.get(id) ?? null;
  return source && typeof source === "object" ? source[id] ?? null : null;
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function deriveCombatCardStatus(state, card, enemyDefinitions = {}) {
  const encounter = state?.encounter;
  if (state?.mode !== "combat" || card?.category !== "combat" || !encounter) {
    return {
      visible: false,
      enemyName: "",
      hp: 0,
      maxHp: 1,
      progressLabel: "",
    };
  }

  const enemy = lookupById(enemyDefinitions, encounter.enemyId) ?? encounter.enemy ?? {};
  const hp = finiteNonNegative(encounter.hp);
  const maxHp = Math.max(
    1,
    finiteNonNegative(encounter.maxHp ?? enemy.maxHp, Math.max(1, hp)),
  );
  const enemyName = String(card.speaker ?? enemy.name ?? encounter.enemyName ?? "Unknown foe");
  return {
    visible: true,
    enemyName,
    hp,
    maxHp,
    progressLabel: `${enemyName} HP: ${hp} of ${maxHp}`,
  };
}

export function deriveRewardSummary(card, itemDefinitions = {}) {
  if (card?.category !== "combatReward") {
    return { visible: false, rows: [], announcement: "", itemName: "" };
  }

  const reward = card.reward && typeof card.reward === "object" ? card.reward : {};
  const xpAwarded = finiteNonNegative(reward.xpAwarded);
  const goldAwarded = finiteNonNegative(reward.goldAwarded);
  const rows = [
    { key: "xp", label: "Experience", value: `+${xpAwarded} XP`, detail: "" },
  ];
  if (goldAwarded > 0) {
    rows.push({ key: "gold", label: "Gold", value: `+${goldAwarded}`, detail: "" });
  }

  let itemName = "";
  if (typeof reward.itemId === "string" && reward.itemId) {
    const item = lookupById(itemDefinitions, reward.itemId);
    itemName = item?.name ? String(item.name) : "Item unavailable";
    rows.push({
      key: "item",
      label: "Item",
      value: itemName,
      detail: item?.rarity ? titleCase(item.rarity) : item ? "" : "Reward data unavailable",
    });
  }

  const announcement = rows
    .map((row) => `${row.label}: ${row.value}${row.detail ? `. ${row.detail}` : ""}`)
    .join(". ");
  return { visible: true, rows, announcement, itemName };
}

export function cardAnnouncement(card, {
  combatStatus = { visible: false },
  rewardSummary = { visible: false, rows: [] },
} = {}) {
  const speaker = String(card?.speaker ?? card?.source ?? "The Ember Crown");
  const title = String(card?.title ?? "The road waits");
  const text = String(card?.text ?? "Choose how the Warden proceeds.");
  const parts = [speaker];
  if (combatStatus.visible) parts.push(`${combatStatus.hp} of ${combatStatus.maxHp} HP`);
  parts.push(title, text);
  if (rewardSummary.visible) {
    for (const row of rewardSummary.rows) {
      parts.push(`${row.label}: ${row.value}${row.detail ? `. ${row.detail}` : ""}`);
    }
  }
  const itemContext = rewardSummary.itemName && rewardSummary.itemName !== "Item unavailable"
    ? ` ${rewardSummary.itemName}`
    : "";
  const action = (direction) => {
    const label = String(card?.[direction]?.label ?? "Continue");
    if (!itemContext || label.toLowerCase().includes(rewardSummary.itemName.toLowerCase())) return label;
    return `${label}${itemContext}`;
  };
  parts.push(`Left: ${action("left")}`, `Right: ${action("right")}`);
  return `${parts.filter(Boolean).join(". ")}.`;
}

function effectAmount(effect) {
  return Number(effect.amount ?? effect.value ?? 0);
}

export function affectedResources(choice) {
  const resources = new Set(
    Array.isArray(choice?.affectedResources) ? choice.affectedResources : [],
  );
  if (Array.isArray(choice?.preview)) {
    for (const entry of choice.preview) {
      const resource = typeof entry === "string" ? entry : entry?.resource;
      if (resource) resources.add(resource === "maxHp" ? "hp" : resource === "maxMp" ? "mp" : resource);
    }
  } else if (choice?.preview && typeof choice.preview === "object") {
    for (const [resource, value] of Object.entries(choice.preview)) {
      if (value === 0 || value === false || value === null || value === undefined) continue;
      resources.add(resource === "maxHp" ? "hp" : resource === "maxMp" ? "mp" : resource);
    }
  }
  for (const effect of Array.isArray(choice?.effects) ? choice.effects : []) {
    if (!effect || typeof effect !== "object") continue;
    const resource = RESOURCE_EFFECTS[effect.type];
    if (resource) resources.add(resource);
  }
  if (choice?.cost?.resource) resources.add(choice.cost.resource);
  return [...resources];
}

function effectSummary(effect) {
  if (!effect || typeof effect !== "object") return "";
  const amount = effectAmount(effect);
  const signed = amount > 0 ? `+${amount}` : String(amount);
  switch (effect.type) {
    case "modifyHp": return `${signed} HP`;
    case "damage": return `-${Math.abs(amount)} HP`;
    case "heal": return `+${Math.abs(amount)} HP`;
    case "healPercent": {
      const percent = Math.abs(Number(effect.percent ?? amount));
      return `heal ${percent <= 1 ? Math.round(percent * 100) : percent}%`;
    }
    case "modifyMp": return `${signed} MP`;
    case "restoreMp": return `+${Math.abs(amount)} MP`;
    case "modifyGold": return `${signed} gold`;
    case "addGold": return `+${Math.abs(amount)} gold`;
    case "spendGold": return `-${Math.abs(amount)} gold`;
    case "addXp": return `+${Math.abs(amount)} XP`;
    case "boundedHpLoss":
    case "applyBoundedHpLoss": return `-${Math.abs(amount)} HP, but not below ${Math.max(1, Number(effect.floor ?? effect.minimumHp ?? 1))}`;
    case "addItem": return "gain item";
    case "removeItem": return "lose item";
    case "startEncounter": return "combat risk";
    case "startStoryEncounter": return "story encounter";
    case "queueCard": return "story continues";
    case "queueStoryCard": return "story continues";
    case "selectEnding":
    case "selectFinalEnding": return "decide the Crown's fate";
    default: return "";
  }
}

export function choiceDetail(choice) {
  if (!choice) return "";
  if (choice.detail) return choice.detail;
  if (choice.previewText) return choice.previewText;
  if (typeof choice.preview === "string") return choice.preview;
  if (Array.isArray(choice.preview)) {
    const labels = choice.preview.map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      if (entry.label) return entry.label;
      const resource = RESOURCE_LABELS[entry.resource] ?? entry.resource;
      const delta = Number(entry.delta);
      return Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${delta} ${resource}` : resource;
    }).filter(Boolean);
    if (labels.length) return labels.slice(0, 3).join(" · ");
  }
  if (choice.preview && !Array.isArray(choice.preview) && typeof choice.preview === "object") {
    const labels = Object.entries(choice.preview).map(([resource, value]) => {
      if (typeof value === "string") return value;
      if (typeof value === "number") return `${value > 0 ? "+" : ""}${value} ${RESOURCE_LABELS[resource] ?? resource}`;
      return value ? RESOURCE_LABELS[resource] ?? resource : "";
    }).filter(Boolean);
    if (labels.length) return labels.slice(0, 3).join(" · ");
  }
  const summaries = (Array.isArray(choice.effects) ? choice.effects : []).map(effectSummary).filter(Boolean);
  if (choice.cost?.amount) summaries.unshift(`-${choice.cost.amount} ${RESOURCE_LABELS[choice.cost.resource] ?? choice.cost.resource}`);
  return [...new Set(summaries)].slice(0, 3).join(" · ");
}

function itemStats(item) {
  const labels = { attack: "ATK", defense: "DEF", maxHp: "max HP", maxMp: "max MP" };
  return Object.entries(item?.statModifiers ?? {})
    .filter(([, value]) => value)
    .map(([stat, value]) => `${value > 0 ? "+" : ""}${value} ${labels[stat] ?? stat}`)
    .join(" · ");
}

function cardResourceSummary(card) {
  const affected = [...new Set([
    ...affectedResources(card?.left),
    ...affectedResources(card?.right),
  ])];
  return affected.length
    ? `Choices may affect ${affected.map((resource) => RESOURCE_LABELS[resource] ?? resource).join(", ")}.`
    : "Choices shape the story.";
}

function createItemRow(item, action, equippedItem = null, allowedArtIds = new Set()) {
  const row = document.createElement("article");
  row.className = "grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[#36505d] bg-[#091923] p-2";

  const art = document.createElement("img");
  art.className = "h-12 w-12 rounded-lg bg-[#183442] object-contain p-1";
  art.src = resolveArtSource(item.artId, allowedArtIds, "item-charm");
  art.alt = "";
  art.draggable = false;

  const copy = document.createElement("div");
  copy.className = "min-w-0";
  const name = document.createElement("h3");
  name.className = "truncate text-xs font-black text-[#fff6e6]";
  name.textContent = item.name;
  const description = document.createElement("p");
  description.className = "mt-0.5 text-[0.66rem] leading-snug text-[#b9cbd0]";
  description.textContent = item.description;
  const stats = document.createElement("p");
  stats.className = "mt-1 text-[0.62rem] font-bold text-[#ffd77d]";
  const comparison = equippedItem && item.type === "equipment"
    ? [...new Set([
      ...Object.keys(equippedItem.statModifiers ?? {}),
      ...Object.keys(item.statModifiers ?? {}),
    ])].map((stat) => {
      const labels = { attack: "ATK", defense: "DEF", maxHp: "max HP", maxMp: "max MP" };
      const diff = Number(item.statModifiers?.[stat] ?? 0) - Number(equippedItem.statModifiers?.[stat] ?? 0);
      return diff ? `${diff > 0 ? "+" : ""}${diff} ${labels[stat] ?? stat}` : "";
    }).filter(Boolean).join(" · ")
    : "";
  stats.textContent = comparison || itemStats(item) || item.rarity || "Consumable";
  copy.append(name, description, stats);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "min-h-11 min-w-11 rounded-lg border border-[#4e9b93] bg-[#123c40] px-2 text-xs font-black text-[#d8fff7] hover:bg-[#175157] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#79d4c5] disabled:opacity-50";
  button.dataset.inventoryAction = action;
  button.dataset.itemId = item.id;
  button.textContent = action === "equip" ? "Equip" : "Use";
  button.setAttribute("aria-label", `${button.textContent} ${item.name}`);

  row.append(art, copy, button);
  return row;
}

export function createRenderer({
  itemById = {},
  enemyById = {},
  allowedArtIds = new Set(),
  arcById = {},
  calculateStoryProgress,
} = {}) {
  const elements = {
    app: byId("app"),
    level: byId("hud-level"),
    levelXpHud: byId("level-xp-hud"),
    xp: byId("hud-xp"),
    xpBar: byId("hud-xp-bar"),
    hp: byId("hud-hp"),
    hpBar: byId("hud-hp-bar"),
    mp: byId("hud-mp"),
    mpBar: byId("hud-mp-bar"),
    arcTitle: byId("arc-title"),
    beatName: byId("hud-beat-name"),
    beatNumber: byId("hud-beat-number"),
    storyProgress: byId("hud-story-progress"),
    inventoryOpen: byId("inventory-open"),
    cardStack: byId("card-stack"),
    cardBackdrop: byId("card-backdrop"),
    card: byId("card"),
    cardArt: byId("card-art"),
    speaker: byId("card-speaker"),
    title: byId("card-title"),
    text: byId("card-text"),
    detail: byId("card-detail"),
    resourcePreview: byId("card-resource-preview"),
    combatStatus: byId("card-combat-status"),
    cardEnemyHp: byId("card-enemy-hp"),
    cardEnemyHpBar: byId("card-enemy-hp-bar"),
    rewardSummary: byId("card-reward-summary"),
    leftOverlay: byId("choice-left-overlay"),
    rightOverlay: byId("choice-right-overlay"),
    leftOverlayLabel: document.getElementById("choice-left-overlay-label"),
    rightOverlayLabel: document.getElementById("choice-right-overlay-label"),
    leftButton: byId("choice-left"),
    rightButton: byId("choice-right"),
    leftLabel: byId("choice-left-label"),
    rightLabel: byId("choice-right-label"),
    leftDetail: byId("choice-left-detail"),
    rightDetail: byId("choice-right-detail"),
    cardLive: byId("card-live"),
    choiceControls: byId("choice-controls"),
    choiceHelp: byId("choice-help"),
    transition: byId("story-transition"),
    transitionBeat: byId("story-transition-beat"),
    transitionTitle: byId("story-transition-title"),
    transitionSentence: byId("story-transition-sentence"),
    transitionContinue: byId("story-transition-continue"),
    terminal: byId("terminal-summary"),
    terminalKicker: byId("terminal-kicker"),
    terminalArcTitle: byId("terminal-arc-title"),
    terminalTitle: byId("terminal-title"),
    terminalCopy: byId("terminal-copy"),
    terminalStats: byId("terminal-stats"),
    terminalDiscoveries: byId("terminal-discoveries"),
    terminalDiscoveryList: byId("terminal-discovery-list"),
    terminalRestart: byId("terminal-restart"),
    inventory: byId("inventory-content"),
    inventoryGold: byId("inventory-gold"),
    inventoryStats: document.getElementById("inventory-stats"),
    inventoryCount: document.getElementById("inventory-count"),
    equipped: {
      weapon: byId("equipped-weapon"),
      armor: byId("equipped-armor"),
      charm: byId("equipped-charm"),
    },
  };

  let activeCard = null;
  let currentState = null;
  let lastSpecialAnnouncement = null;
  let lastCardAnnouncementKey = null;

  const previewTargets = {
    hp: elements.hp.closest("[data-resource]"),
    mp: elements.mp.closest("[data-resource]"),
    xp: elements.levelXpHud,
    gold: elements.inventoryOpen,
    enemyHp: elements.combatStatus,
    inventory: elements.inventoryOpen,
  };

  const renderCombatCardStatus = (state, card) => {
    const presentation = deriveCombatCardStatus(state, card, enemyById);
    elements.combatStatus.hidden = !presentation.visible;
    elements.cardEnemyHp.textContent = presentation.visible
      ? `${presentation.hp} / ${presentation.maxHp}`
      : "";
    if (!presentation.visible) {
      elements.combatStatus.removeAttribute("aria-label");
      elements.cardEnemyHpBar.removeAttribute("aria-label");
      setBar(elements.cardEnemyHpBar, 0, 1);
      return presentation;
    }
    elements.combatStatus.setAttribute("aria-label", presentation.progressLabel);
    setBar(elements.cardEnemyHpBar, presentation.hp, presentation.maxHp);
    elements.cardEnemyHpBar.setAttribute("aria-label", presentation.progressLabel);
    return presentation;
  };

  const renderRewardSummary = (state, card) => {
    const presentation = state?.mode === "combatReward"
      ? deriveRewardSummary(card, itemById)
      : { visible: false, rows: [], announcement: "", itemName: "" };
    elements.rewardSummary.replaceChildren();
    elements.rewardSummary.hidden = !presentation.visible;
    if (!presentation.visible) return presentation;

    for (const row of presentation.rows) {
      const group = document.createElement("div");
      group.className = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3";
      const term = document.createElement("dt");
      term.className = "text-[0.65rem] font-black uppercase tracking-wider text-[#70584f]";
      term.textContent = row.label;
      const value = document.createElement("dd");
      value.className = "text-right text-xs font-black text-[#142630]";
      value.textContent = row.value;
      group.append(term, value);
      if (row.detail) {
        const detail = document.createElement("dd");
        detail.className = "col-start-2 text-right text-[0.62rem] font-bold text-[#70584f]";
        detail.textContent = row.detail;
        group.append(detail);
      }
      elements.rewardSummary.append(group);
    }
    return presentation;
  };

  const setChoice = (direction, choice) => {
    const button = direction === "left" ? elements.leftButton : elements.rightButton;
    const label = direction === "left" ? elements.leftLabel : elements.rightLabel;
    const detail = direction === "left" ? elements.leftDetail : elements.rightDetail;
    const overlayLabel = direction === "left" ? elements.leftOverlayLabel : elements.rightOverlayLabel;
    const resources = affectedResources(choice);
    const detailText = choice?.disabled ? choice.disabledReason || "Unavailable" : choiceDetail(choice);
    label.textContent = choice?.label ?? "Continue";
    detail.textContent = detailText;
    if (overlayLabel) overlayLabel.textContent = choice?.label ?? "Continue";
    button.disabled = choice?.disabled === true;
    button.dataset.affects = resources.join(" ");
    const rewardItem = activeCard?.category === "combatReward"
      ? lookupById(itemById, activeCard.reward?.itemId)
      : null;
    const itemContext = rewardItem?.name ? `. Item: ${rewardItem.name}` : "";
    button.setAttribute("aria-label", `${direction === "left" ? "Left" : "Right"}: ${choice?.label ?? "Continue"}${detailText ? `. ${detailText}` : ""}${itemContext}`);
  };

  const renderCard = (card, combatStatus, rewardSummary) => {
    activeCard = card;
    const title = card?.title ?? "The road waits";
    const text = card?.text ?? "Choose how the Warden proceeds.";
    elements.speaker.textContent = card?.speaker ?? card?.source ?? "The Ember Crown";
    elements.title.textContent = title;
    elements.title.hidden = !card?.title;
    elements.text.textContent = text;
    elements.detail.textContent = card?.detail ?? card?.riskText ?? "";
    elements.detail.hidden = !elements.detail.textContent;
    elements.cardArt.src = resolveArtSource(card?.artId, allowedArtIds);
    elements.cardArt.alt = card?.artAlt ?? "";
    elements.cardArt.draggable = false;
    elements.card.dataset.cardId = card?.id ?? "fallback";
    elements.card.dataset.mode = currentState?.mode ?? "exploration";
    setChoice("left", card?.left);
    setChoice("right", card?.right);
    const isReward = rewardSummary.visible;
    elements.resourcePreview.textContent = isReward ? "" : cardResourceSummary(card);
    elements.resourcePreview.hidden = isReward;
    const announcement = cardAnnouncement(card, { combatStatus, rewardSummary });
    elements.card.setAttribute("aria-label", announcement);
    const announcementKey = `${String(currentState?.runSeed ?? "run")}:${String(card?.resolutionToken ?? card?.id ?? "fallback")}`;
    if (lastCardAnnouncementKey !== announcementKey) {
      lastCardAnnouncementKey = announcementKey;
      elements.cardLive.textContent = announcement;
    }
  };

  const renderHud = (state, derivedStats, xpNeeded, storyProgress) => {
    const progressCalculator = Number.isFinite(Number(storyProgress))
      ? () => Number(storyProgress)
      : calculateStoryProgress;
    const storyHud = deriveStoryHud(state, { arcById, calculateStoryProgress: progressCalculator });
    elements.level.textContent = String(state.player.level);
    elements.xp.textContent = `${state.player.xp}/${xpNeeded}`;
    elements.hp.textContent = `${state.player.hp}/${derivedStats.maxHp}`;
    elements.mp.textContent = `${state.player.mp}/${derivedStats.maxMp}`;
    elements.arcTitle.textContent = storyHud.arcTitle;
    elements.beatName.textContent = storyHud.beatName;
    elements.beatNumber.textContent = `${storyHud.beatNumber} / ${storyHud.beatCount}`;
    setBar(elements.xpBar, state.player.xp, xpNeeded);
    setBar(elements.hpBar, state.player.hp, derivedStats.maxHp);
    setBar(elements.mpBar, state.player.mp, derivedStats.maxMp);
    setBar(elements.storyProgress, storyHud.progressPercent, 100);
    elements.storyProgress.textContent = `${Math.round(storyHud.progressPercent)} percent`;
    elements.storyProgress.setAttribute("aria-label", storyHud.progressLabel);
    elements.hpBar.setAttribute("aria-label", `HP ${state.player.hp} of ${derivedStats.maxHp}`);
    elements.mpBar.setAttribute("aria-label", `MP ${state.player.mp} of ${derivedStats.maxMp}`);
    elements.xpBar.setAttribute("aria-label", `XP ${state.player.xp} of ${xpNeeded}`);
    return storyHud;
  };

  const setInteractiveSurface = () => {
    elements.card.hidden = false;
    elements.cardBackdrop.hidden = false;
    elements.choiceControls.hidden = false;
    elements.choiceHelp.hidden = false;
    elements.transition.hidden = true;
    elements.terminal.hidden = true;
    elements.card.removeAttribute("inert");
    elements.card.tabIndex = 0;
    elements.cardStack.setAttribute("aria-label", "Current decision");
    lastSpecialAnnouncement = null;
  };

  const setSpecialSurface = (surface, label) => {
    activeCard = null;
    lastCardAnnouncementKey = null;
    elements.card.hidden = true;
    elements.cardBackdrop.hidden = true;
    elements.choiceControls.hidden = true;
    elements.choiceHelp.hidden = true;
    elements.card.setAttribute("inert", "");
    elements.card.tabIndex = -1;
    elements.transition.hidden = surface !== "transition";
    elements.terminal.hidden = surface !== "terminal";
    elements.leftButton.disabled = true;
    elements.rightButton.disabled = true;
    elements.cardStack.setAttribute("aria-label", label);
  };

  const announceSpecial = (key, message) => {
    if (lastSpecialAnnouncement === key) return;
    lastSpecialAnnouncement = key;
    elements.cardLive.textContent = message;
  };

  const renderTransition = (presentation) => {
    setSpecialSurface("transition", `Story transition: ${presentation.beatName}`);
    elements.transitionBeat.textContent = `Beat ${presentation.beatNumber} · ${presentation.beatName}`;
    elements.transitionTitle.textContent = presentation.subtitle;
    elements.transitionSentence.textContent = presentation.text;
    elements.transitionContinue.disabled = false;
    elements.transitionContinue.setAttribute("aria-label", `Continue to ${presentation.beatName}`);
    announceSpecial(`transition:${presentation.beatId}`, presentation.announcement);
  };

  const renderTerminal = (presentation) => {
    setSpecialSurface("terminal", presentation.kind === "death" ? "Arc ended" : "Arc complete");
    elements.terminal.dataset.kind = presentation.kind;
    elements.terminalKicker.textContent = presentation.kicker;
    elements.terminalArcTitle.textContent = presentation.arcTitle;
    elements.terminalTitle.textContent = presentation.title;
    elements.terminalCopy.textContent = presentation.copy;
    elements.terminalRestart.textContent = presentation.restartLabel;
    elements.terminalRestart.setAttribute("aria-label", `${presentation.restartLabel}: ${presentation.arcTitle}`);
    elements.terminalRestart.disabled = false;

    elements.terminalStats.replaceChildren();
    for (const stat of presentation.stats) {
      const group = document.createElement("div");
      group.className = stat.wide
        ? "col-span-2 rounded-lg bg-[#091923] px-2 py-2"
        : "rounded-lg bg-[#091923] px-2 py-2";
      const term = document.createElement("dt");
      term.className = "text-[0.58rem] font-black uppercase tracking-wider text-[#87a1aa]";
      term.textContent = stat.label;
      const value = document.createElement("dd");
      value.className = "mt-0.5 text-sm font-black text-[#fff6e6]";
      value.textContent = stat.value;
      group.append(term, value);
      elements.terminalStats.append(group);
    }

    elements.terminalDiscoveryList.replaceChildren();
    elements.terminalDiscoveries.hidden = presentation.discoveries.length === 0;
    for (const discovery of presentation.discoveries) {
      const item = document.createElement("li");
      item.textContent = discovery;
      elements.terminalDiscoveryList.append(item);
    }
    announceSpecial(
      `terminal:${presentation.kind}:${presentation.title}`,
      `${presentation.kicker}. ${presentation.arcTitle}. ${presentation.title}. ${presentation.copy}`,
    );
  };

  return {
    elements,
    render(state, card, { derivedStats, xpNeeded, storyProgress } = {}) {
      currentState = state;
      elements.app.setAttribute("aria-busy", "false");
      elements.card.setAttribute("aria-busy", "false");
      elements.app.dataset.mode = state.mode;
      const safeDerivedStats = derivedStats ?? state.player?.baseStats ?? {
        maxHp: Math.max(1, Number(state.player?.hp ?? 1)),
        maxMp: Math.max(0, Number(state.player?.mp ?? 0)),
      };
      renderHud(state, safeDerivedStats, xpNeeded ?? 1, storyProgress);
      const combatStatus = renderCombatCardStatus(state, card);
      const rewardSummary = renderRewardSummary(state, card);
      const terminal = deriveTerminalPresentation(state, {
        arcById,
        enemyById,
        calculateStoryProgress: Number.isFinite(Number(storyProgress))
          ? () => Number(storyProgress)
          : calculateStoryProgress,
      });
      if (terminal) {
        renderTerminal(terminal);
        return;
      }
      const transition = deriveTransitionPresentation(state, { arcById });
      if (transition) {
        renderTransition(transition);
        return;
      }
      setInteractiveSurface();
      renderCard(card, combatStatus, rewardSummary);
    },
    focusPrimarySurface() {
      if (!elements.transition.hidden) elements.transitionContinue.focus();
      else if (!elements.terminal.hidden) elements.terminalRestart.focus();
      else elements.card.focus();
    },
    renderInventory(state, { derivedStats } = {}) {
      currentState = state;
      elements.inventoryGold.textContent = String(state.player.gold);
      if (derivedStats && elements.inventoryStats) {
        elements.inventoryStats.textContent = `Attack ${derivedStats.attack} · Defense ${derivedStats.defense} · Max HP ${derivedStats.maxHp} · Max MP ${derivedStats.maxMp}`;
      }
      for (const slot of ["weapon", "armor", "charm"]) {
        const item = itemById[state.player.equipment?.[slot]];
        elements.equipped[slot].textContent = `${slot[0].toUpperCase()}${slot.slice(1)} — ${item ? `${item.name} (${itemStats(item)})` : "Empty"}`;
      }
      elements.inventory.replaceChildren();
      const ids = state.player.inventory ?? [];
      if (elements.inventoryCount) elements.inventoryCount.textContent = `${ids.length} item${ids.length === 1 ? "" : "s"}`;
      if (!ids.length) {
        const empty = document.createElement("p");
        empty.className = "rounded-xl border border-dashed border-[#567481] p-4 text-center text-xs font-semibold text-[#9bb3ba]";
        empty.textContent = "Your satchel is empty. The road will change that.";
        elements.inventory.append(empty);
        return;
      }
      for (const itemId of ids) {
        const item = itemById[itemId];
        if (!item) continue;
        const action = item.type === "equipment" ? "equip" : "use";
        const equippedItem = item.slot ? itemById[state.player.equipment?.[item.slot]] : null;
        elements.inventory.append(createItemRow(item, action, equippedItem, allowedArtIds));
      }
    },
    previewChoice(direction) {
      const choice = direction === "left" ? activeCard?.left : direction === "right" ? activeCard?.right : null;
      const affected = new Set(affectedResources(choice));
      for (const target of new Set(Object.values(previewTargets))) {
        if (target) delete target.dataset.previewed;
      }
      for (const resource of affected) {
        const target = previewTargets[resource];
        if (target && !target.hidden) target.dataset.previewed = "true";
      }
      const detailText = choice ? choiceDetail(choice) : "";
      const rewardPreviewIsEmpty = activeCard?.category === "combatReward" && !detailText;
      const previewText = choice
        ? detailText || `${choice.label} changes the story ahead.`
        : cardResourceSummary(activeCard);
      elements.resourcePreview.textContent = rewardPreviewIsEmpty ? "" : previewText;
      elements.resourcePreview.hidden = rewardPreviewIsEmpty;
    },
  };
}
