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
  const story = state.story ?? {};
  const storyFacts = story.facts ?? {};
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
    case "minimumGold":
      return player.gold >= numberValue(requirement);
    case "maxGold":
      return player.gold <= numberValue(requirement);
    case "currentArc":
    case "currentArcId":
    case "arcId":
      return story.arcId === (requirement.arcId ?? requirement.id ?? requirement.value);
    case "currentBeat":
    case "currentBeatId":
    case "beatId":
      return story.currentBeatId === (requirement.beatId ?? requirement.id ?? requirement.value);
    case "completedBeat":
    case "beatCompleted":
      return (story.completedBeatIds ?? []).includes(
        requirement.beatId ?? requirement.id ?? requirement.value,
      );
    case "beatNotCompleted":
      return !(story.completedBeatIds ?? []).includes(
        requirement.beatId ?? requirement.id ?? requirement.value,
      );
    case "minimumCardsResolvedInBeat":
    case "minCardsResolvedInBeat":
    case "minCardsInBeat": {
      const beatId = requirement.beatId ?? story.currentBeatId;
      const actual =
        beatId === story.currentBeatId
          ? Number(story.cardsResolvedInBeat ?? 0)
          : Number(story.cardsResolvedByBeat?.[beatId] ?? 0);
      return actual >= numberValue(requirement);
    }
    case "minimumTotalWorldCards":
    case "minTotalWorldCards":
      return Number(story.totalWorldCardsResolved ?? 0) >= numberValue(requirement);
    case "storyFactExists":
      return Object.prototype.hasOwnProperty.call(
        storyFacts,
        requirement.key ?? requirement.fact ?? requirement.id,
      );
    case "storyFactAbsent":
      return !Object.prototype.hasOwnProperty.call(
        storyFacts,
        requirement.key ?? requirement.fact ?? requirement.id,
      );
    case "storyFactEquals": {
      const key = requirement.key ?? requirement.fact ?? requirement.id;
      return storyFacts[key] === requirement.value;
    }
    case "storyCounterMinimum":
    case "minimumStoryCounter": {
      const key = requirement.key ?? requirement.counter ?? requirement.id;
      return Number(storyFacts[key] ?? 0) >= numberValue(requirement);
    }
    case "storyTagResolved":
      return (story.resolvedStoryTags ?? []).includes(
        requirement.tag ?? requirement.storyTag ?? requirement.id ?? requirement.value,
      );
    case "anchorSelected": {
      const beatId = requirement.beatId ?? story.currentBeatId;
      const selected = story.selectedAnchorIdByBeat?.[beatId];
      const expected = requirement.cardId ?? requirement.anchorId ?? requirement.id ?? requirement.value;
      return expected === undefined ? Boolean(selected) : selected === expected;
    }
    case "anchorResolved": {
      const expected = requirement.cardId ?? requirement.anchorId ?? requirement.id ?? requirement.value;
      if (expected !== undefined) return (story.resolvedAnchorIds ?? []).includes(expected);
      const selected = story.selectedAnchorIdByBeat?.[requirement.beatId ?? story.currentBeatId];
      return Boolean(selected && (story.resolvedAnchorIds ?? []).includes(selected));
    }
    case "endingSelected": {
      const expected = requirement.endingId ?? requirement.id ?? requirement.value;
      return expected === undefined ? Boolean(story.endingId) : story.endingId === expected;
    }
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
    case "enemyDefeated":
    case "specificEnemyDefeated": {
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
    const amount = Number(effect.amount ?? effect.value) || 0;
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
