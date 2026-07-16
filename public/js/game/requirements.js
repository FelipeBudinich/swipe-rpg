import { getDerivedStats, getItemId } from "./equipment.js";

function numberValue(requirement, fallback = 0) {
  const value = Number(requirement?.value ?? requirement?.amount ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function evaluateRequirement(requirement, state, context = {}) {
  if (!requirement) return true;
  if (Array.isArray(requirement)) return requirementsMet(requirement, state, context);
  if (typeof requirement !== "object") return false;

  const player = state.player;
  const run = state.run;
  const derived = context.derivedStats ?? getDerivedStats(state, context.items);
  const hpPercent = derived.maxHp > 0 ? player.hp / derived.maxHp : 0;
  const requiredPercent = (value) => {
    const numeric = numberValue(value);
    return numeric > 1 ? numeric / 100 : numeric;
  };

  switch (requirement.type) {
    case "all": {
      const nested = requirement.requirements ?? requirement.value;
      return Array.isArray(nested) && requirementsMet(nested, state, context);
    }
    case "any": {
      const nested = requirement.requirements ?? requirement.value;
      return Array.isArray(nested) && nested.some((entry) =>
        evaluateRequirement(entry, state, context),
      );
    }
    case "not": {
      const nested = requirement.requirement ?? requirement.value;
      return Boolean(nested && typeof nested === "object") &&
        !evaluateRequirement(nested, state, context);
    }
    case "minLevel":
      return player.level >= numberValue(requirement);
    case "maxLevel":
      return player.level <= numberValue(requirement);
    case "minHpPercent":
      return hpPercent >= requiredPercent(requirement);
    case "maxHpPercent":
      return hpPercent <= requiredPercent(requirement);
    case "minMp":
      return player.mp >= numberValue(requirement);
    case "maxMp":
      return player.mp <= numberValue(requirement);
    case "minGold":
      return player.gold >= numberValue(requirement);
    case "maxGold":
      return player.gold <= numberValue(requirement);
    case "journeyStep": {
      const min = Number.isFinite(Number(requirement.min)) ? Number(requirement.min) : -Infinity;
      const max = Number.isFinite(Number(requirement.max)) ? Number(requirement.max) : Infinity;
      return state.journeyStep >= min && state.journeyStep <= max;
    }
    case "minJourneyStep":
      return state.journeyStep >= numberValue(requirement);
    case "maxJourneyStep":
      return state.journeyStep <= numberValue(requirement);
    case "flagEquals":
      return run.flags?.[requirement.flag ?? requirement.key] === requirement.value;
    case "flagAbsent":
      return !Object.prototype.hasOwnProperty.call(
        run.flags ?? {},
        requirement.flag ?? requirement.key,
      );
    case "equipmentSlot": {
      const equipped = getItemId(player.equipment?.[requirement.slot]);
      return requirement.itemId ? equipped === requirement.itemId : Boolean(equipped);
    }
    case "itemOwned": {
      const target = requirement.itemId ?? requirement.id;
      return (
        (player.inventory ?? []).some((entry) => getItemId(entry) === target) ||
        Object.values(player.equipment ?? {}).some((entry) => getItemId(entry) === target)
      );
    }
    case "enemyDefeated": {
      const defeated = run.enemiesDefeated ?? {};
      const id = requirement.enemyId ?? requirement.id;
      return Array.isArray(defeated)
        ? defeated.includes(id)
        : Number(defeated[id] ?? 0) > 0 || defeated[id] === true;
    }
    case "cardNotResolved": {
      const id = requirement.cardId ?? requirement.id;
      return ![...(run.resolvedCardIds ?? []), ...(run.resolvedOnceCards ?? [])].includes(id);
    }
    case "cardResolved": {
      const id = requirement.cardId ?? requirement.id;
      return [...(run.resolvedCardIds ?? []), ...(run.resolvedOnceCards ?? [])].includes(id);
    }
    case "mode":
      return state.mode === requirement.value;
    case "runStat": {
      const actual = Number(run.stats?.[requirement.stat] ?? 0);
      if (Number.isFinite(Number(requirement.min)) && actual < Number(requirement.min)) return false;
      if (Number.isFinite(Number(requirement.max)) && actual > Number(requirement.max)) return false;
      if (Object.prototype.hasOwnProperty.call(requirement, "value")) {
        return run.stats?.[requirement.stat] === requirement.value;
      }
      return true;
    }
    default:
      // Unknown declarative rules fail closed instead of accidentally
      // revealing content intended to remain gated.
      return false;
  }
}

export function requirementsMet(requirements, state, context = {}) {
  if (!requirements) return true;
  if (!Array.isArray(requirements)) {
    if (typeof requirements !== "object") return false;
    // A small shorthand is useful for fixtures and hand-authored additions.
    if (requirements.type) return evaluateRequirement(requirements, state, context);
    return Object.entries(requirements).every(([type, value]) =>
      evaluateRequirement({ type, value }, state, context),
    );
  }
  return requirements.every((requirement) => evaluateRequirement(requirement, state, context));
}

export function choiceIsAffordable(choice, state) {
  let gold = Number(state.player.gold) || 0;
  let mp = Number(state.player.mp) || 0;

  for (const effect of Array.isArray(choice?.effects) ? choice.effects : []) {
    if (!effect || typeof effect !== "object") continue;
    const amount = Number(effect.amount) || 0;
    if (effect.type === "modifyGold") {
      const hasExplicitFloor = Number.isFinite(Number(effect.floor));
      if (amount < 0 && !effect.allowDebt && !hasExplicitFloor && gold + amount < 0) return false;
      gold = hasExplicitFloor ? Math.max(Number(effect.floor), gold + amount) : gold + amount;
    }
    if (effect.type === "modifyMp") {
      if (amount < 0 && mp + amount < 0) return false;
      mp += amount;
    }
  }
  return true;
}

export function choiceIsAvailable(choice, state, context = {}) {
  return Boolean(choice) && requirementsMet(choice.requirements, state, context) && choiceIsAffordable(choice, state);
}

export function cardHasAvailableChoice(card, state, context = {}) {
  return choiceIsAvailable(card?.left, state, context) || choiceIsAvailable(card?.right, state, context);
}

export const evaluateRequirements = requirementsMet;
