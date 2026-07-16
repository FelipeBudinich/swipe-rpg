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
  modifyJourney: "journey",
  modifyJourneyStep: "journey",
};

const RESOURCE_LABELS = {
  hp: "HP",
  mp: "MP",
  xp: "XP",
  gold: "gold",
  journey: "journey depth",
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
    case "addItem": return "gain item";
    case "removeItem": return "lose item";
    case "startEncounter": return "combat risk";
    case "queueCard": return "story continues";
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
    : "Choices shape the journey.";
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

export function createRenderer({ itemById = {}, enemyById = {}, allowedArtIds = new Set() } = {}) {
  const elements = {
    app: byId("app"),
    level: byId("hud-level"),
    xp: byId("hud-xp"),
    xpBar: byId("hud-xp-bar"),
    hp: byId("hud-hp"),
    hpBar: byId("hud-hp-bar"),
    mp: byId("hud-mp"),
    mpBar: byId("hud-mp-bar"),
    gold: byId("hud-gold"),
    journey: byId("hud-journey"),
    enemyHud: byId("enemy-hud"),
    enemyName: byId("enemy-name"),
    enemyHp: byId("enemy-hp"),
    enemyHpBar: byId("enemy-hp-bar"),
    enemyIntent: byId("enemy-intent"),
    card: byId("card"),
    cardArt: byId("card-art"),
    speaker: byId("card-speaker"),
    title: byId("card-title"),
    text: byId("card-text"),
    detail: byId("card-detail"),
    resourcePreview: byId("card-resource-preview"),
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
    inventory: byId("inventory-content"),
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
    button.setAttribute("aria-label", `${direction === "left" ? "Left" : "Right"}: ${choice?.label ?? "Continue"}${detailText ? `. ${detailText}` : ""}`);
  };

  const renderCard = (card) => {
    activeCard = card;
    const title = card?.title ?? "The road waits";
    const text = card?.text ?? "Choose how the caravan proceeds.";
    elements.speaker.textContent = card?.speaker ?? card?.source ?? "The Lumen Road";
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
    elements.card.setAttribute("aria-label", `${elements.speaker.textContent}. ${title}. ${text}`);
    setChoice("left", card?.left);
    setChoice("right", card?.right);
    elements.resourcePreview.textContent = cardResourceSummary(card);
    elements.cardLive.textContent = `${title}. ${text}. Left: ${card?.left?.label ?? "Continue"}. Right: ${card?.right?.label ?? "Continue"}.`;
  };

  const renderHud = (state, derivedStats, xpNeeded) => {
    elements.level.textContent = String(state.player.level);
    elements.xp.textContent = `${state.player.xp}/${xpNeeded}`;
    elements.hp.textContent = `${state.player.hp}/${derivedStats.maxHp}`;
    elements.mp.textContent = `${state.player.mp}/${derivedStats.maxMp}`;
    elements.gold.textContent = String(state.player.gold);
    elements.journey.textContent = `${state.journeyStep}/20`;
    setBar(elements.xpBar, state.player.xp, xpNeeded);
    setBar(elements.hpBar, state.player.hp, derivedStats.maxHp);
    setBar(elements.mpBar, state.player.mp, derivedStats.maxMp);
    elements.hpBar.setAttribute("aria-label", `HP ${state.player.hp} of ${derivedStats.maxHp}`);
    elements.mpBar.setAttribute("aria-label", `MP ${state.player.mp} of ${derivedStats.maxMp}`);
    elements.xpBar.setAttribute("aria-label", `XP ${state.player.xp} of ${xpNeeded}`);
  };

  const renderEnemy = (state) => {
    const encounter = state.encounter;
    if (!encounter || state.mode !== "combat") {
      elements.enemyHud.hidden = true;
      return;
    }
    const enemy = enemyById[encounter.enemyId] ?? encounter.enemy ?? {};
    const maximum = encounter.maxHp ?? enemy.maxHp ?? Math.max(1, encounter.hp);
    elements.enemyHud.hidden = false;
    elements.enemyName.textContent = enemy.name ?? encounter.enemyName ?? "Unknown foe";
    elements.enemyHp.textContent = `${encounter.hp}/${maximum}`;
    elements.enemyIntent.textContent = encounter.intentText ?? encounter.currentIntent ?? "Watching";
    setBar(elements.enemyHpBar, encounter.hp, maximum);
    elements.enemyHpBar.setAttribute("aria-label", `${elements.enemyName.textContent} HP ${encounter.hp} of ${maximum}`);
  };

  return {
    elements,
    render(state, card, { derivedStats, xpNeeded }) {
      currentState = state;
      elements.app.setAttribute("aria-busy", "false");
      elements.card.setAttribute("aria-busy", "false");
      elements.app.dataset.mode = state.mode;
      renderHud(state, derivedStats, xpNeeded);
      renderEnemy(state);
      renderCard(card);
    },
    renderInventory(state, { derivedStats } = {}) {
      currentState = state;
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
      for (const resource of ["hp", "mp", "xp", "gold", "journey", "enemyHp"]) {
        const valueNode = resource === "enemyHp" ? elements.enemyHud : byId(`hud-${resource}`);
        const node = valueNode.closest("[data-resource]") ?? valueNode;
        node.toggleAttribute("data-previewed", affected.has(resource));
      }
      elements.resourcePreview.textContent = choice
        ? choiceDetail(choice) || `${choice.label} changes the road ahead.`
        : cardResourceSummary(activeCard);
    },
  };
}
