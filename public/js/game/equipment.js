import { items as DEFAULT_ITEMS } from "../data/items.js";

const STAT_KEYS = Object.freeze(["attack", "defense", "maxHp", "maxMp"]);

export function getItemId(itemOrId) {
  if (typeof itemOrId === "string") return itemOrId;
  return itemOrId && typeof itemOrId.id === "string" ? itemOrId.id : null;
}

export function createItemMap(itemDefinitions = DEFAULT_ITEMS) {
  if (itemDefinitions instanceof Map) return itemDefinitions;
  if (!Array.isArray(itemDefinitions) && itemDefinitions && typeof itemDefinitions === "object") {
    return new Map(Object.entries(itemDefinitions));
  }
  return new Map((itemDefinitions ?? []).map((item) => [item.id, item]));
}

export function findItem(itemOrId, itemDefinitions = DEFAULT_ITEMS) {
  if (itemOrId && typeof itemOrId === "object" && itemOrId.statModifiers) return itemOrId;
  return createItemMap(itemDefinitions).get(getItemId(itemOrId)) ?? null;
}

/** Calculate equipment bonuses without changing base stats or state. */
export function getDerivedStats(state, itemDefinitions = DEFAULT_ITEMS) {
  const base = state?.player?.baseStats ?? {};
  const derived = {
    attack: Number(base.attack) || 0,
    defense: Number(base.defense) || 0,
    maxHp: Number(base.maxHp) || 1,
    maxMp: Number(base.maxMp) || 0,
  };
  const itemMap = createItemMap(itemDefinitions);

  for (const equipped of Object.values(state?.player?.equipment ?? {})) {
    const item =
      equipped && typeof equipped === "object" ? equipped : itemMap.get(getItemId(equipped));
    if (!item) continue;
    for (const stat of STAT_KEYS) {
      const modifier = Number(item.statModifiers?.[stat]);
      if (Number.isFinite(modifier)) derived[stat] += modifier;
    }
  }

  derived.attack = Math.max(0, derived.attack);
  derived.defense = Math.max(0, derived.defense);
  derived.maxHp = Math.max(1, derived.maxHp);
  derived.maxMp = Math.max(0, derived.maxMp);
  return derived;
}

export function clampPlayerResources(state, itemDefinitions = DEFAULT_ITEMS) {
  const derived = getDerivedStats(state, itemDefinitions);
  return {
    ...state,
    player: {
      ...state.player,
      hp: Math.max(0, Math.min(derived.maxHp, Number(state.player.hp) || 0)),
      mp: Math.max(0, Math.min(derived.maxMp, Number(state.player.mp) || 0)),
    },
  };
}

export function inventoryHasItem(state, itemId) {
  return (state?.player?.inventory ?? []).some((entry) => getItemId(entry) === itemId);
}

export function addInventoryItem(state, itemOrId, count = 1) {
  const id = getItemId(itemOrId);
  if (!id || count <= 0) return state;
  const additions = Array.from({ length: Math.max(0, Math.trunc(count)) }, () => id);
  return {
    ...state,
    player: {
      ...state.player,
      inventory: [...(state.player.inventory ?? []), ...additions],
    },
  };
}

export function removeInventoryItem(state, itemId, count = 1) {
  let remaining = Math.max(0, Math.trunc(count));
  if (!itemId || remaining === 0) return state;
  const inventory = [];
  for (const entry of state.player.inventory ?? []) {
    if (remaining > 0 && getItemId(entry) === itemId) {
      remaining -= 1;
    } else {
      inventory.push(entry);
    }
  }
  return { ...state, player: { ...state.player, inventory } };
}

/**
 * Equip one inventory item. The replaced item goes back to inventory, and
 * shrinking maxima clamp HP/MP without increases granting free healing.
 */
export function equipItem(state, itemId, itemDefinitions = DEFAULT_ITEMS) {
  const item = findItem(itemId, itemDefinitions);
  if (!item || item.type !== "equipment" || !item.slot || !inventoryHasItem(state, itemId)) {
    return state;
  }

  const oldItemId = getItemId(state.player.equipment?.[item.slot]);
  let inventory = [...(state.player.inventory ?? [])];
  const newIndex = inventory.findIndex((entry) => getItemId(entry) === itemId);
  inventory.splice(newIndex, 1);
  if (oldItemId) inventory.push(oldItemId);

  const equipped = {
    ...state,
    player: {
      ...state.player,
      inventory,
      equipment: { ...state.player.equipment, [item.slot]: itemId },
    },
  };
  return clampPlayerResources(equipped, itemDefinitions);
}

export function unequipItem(state, slot, itemDefinitions = DEFAULT_ITEMS) {
  const oldItemId = getItemId(state?.player?.equipment?.[slot]);
  if (!oldItemId) return state;
  const updated = {
    ...state,
    player: {
      ...state.player,
      inventory: [...(state.player.inventory ?? []), oldItemId],
      equipment: { ...state.player.equipment, [slot]: null },
    },
  };
  return clampPlayerResources(updated, itemDefinitions);
}

export function getItemStatDifference(state, itemId, itemDefinitions = DEFAULT_ITEMS) {
  const item = findItem(itemId, itemDefinitions);
  if (!item || item.type !== "equipment" || !item.slot) return null;
  const itemMap = createItemMap(itemDefinitions);
  const current = itemMap.get(getItemId(state.player.equipment?.[item.slot]));
  return Object.fromEntries(
    STAT_KEYS.map((stat) => [
      stat,
      Number(item.statModifiers?.[stat] ?? 0) - Number(current?.statModifiers?.[stat] ?? 0),
    ]),
  );
}
