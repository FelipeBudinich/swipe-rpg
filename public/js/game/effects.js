import { items as DEFAULT_ITEMS } from "../data/items.js";
import { beginEncounter } from "./combat.js";
import {
  addInventoryItem,
  clampPlayerResources,
  getDerivedStats,
  removeInventoryItem,
} from "./equipment.js";
import { grantXp } from "./progression.js";

const unique = (list, value) => (list.includes(value) ? list : [...list, value]);
const amountOf = (effect) => {
  const amount = Number(effect?.amount ?? effect?.value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

const ENDING_TITLES = Object.freeze({
  "crown-of-dawn": "Crown of Dawn",
  "unbound-flame": "The Unbound Flame",
});

function updateStory(state, updater) {
  return { ...state, story: updater(state.story ?? {}) };
}

/** Execute one declarative effect and return a new state. */
export function applyEffect(state, effect, context = {}) {
  if (!effect || typeof effect !== "object") return state;
  const items = context.items ?? DEFAULT_ITEMS;
  const derived = getDerivedStats(state, items);
  const amount = amountOf(effect);

  switch (effect.type) {
    case "modifyHp":
      return {
        ...state,
        player: { ...state.player, hp: Math.max(0, Math.min(derived.maxHp, state.player.hp + amount)) },
      };
    case "modifyMp":
      return {
        ...state,
        player: { ...state.player, mp: Math.max(0, Math.min(derived.maxMp, state.player.mp + amount)) },
      };
    case "modifyGold": {
      const nextGold = state.player.gold + amount;
      const floor = effect.allowDebt
        ? Number.isFinite(Number(effect.floor))
          ? Number(effect.floor)
          : -Infinity
        : Math.max(0, Number.isFinite(Number(effect.floor)) ? Number(effect.floor) : 0);
      const appliedGold = Math.max(floor, nextGold);
      return {
        ...state,
        player: { ...state.player, gold: appliedGold },
        run: {
          ...state.run,
          goldEarned: Number(state.run.goldEarned ?? 0) + Math.max(0, appliedGold - state.player.gold),
        },
      };
    }
    case "addXp":
      return grantXp(state, amount);
    case "heal":
      return {
        ...state,
        player: {
          ...state.player,
          hp: Math.max(0, Math.min(derived.maxHp, state.player.hp + Math.max(0, amount))),
        },
      };
    case "healPercent":
    case "healPercentage": {
      const rawPercent = Number(effect.percent ?? effect.value ?? amount);
      const percent = rawPercent > 1 ? rawPercent / 100 : rawPercent;
      const healing = Math.max(0, Math.ceil(derived.maxHp * (Number.isFinite(percent) ? percent : 0)));
      return {
        ...state,
        player: { ...state.player, hp: Math.min(derived.maxHp, state.player.hp + healing) },
      };
    }
    case "restoreMp":
      return {
        ...state,
        player: {
          ...state.player,
          mp: Math.max(0, Math.min(derived.maxMp, state.player.mp + Math.max(0, amount))),
        },
      };
    case "setFlag":
      return {
        ...state,
        run: {
          ...state.run,
          flags: {
            ...(state.run.flags ?? {}),
            [effect.flag ?? effect.key]: Object.prototype.hasOwnProperty.call(effect, "value")
              ? effect.value
              : true,
          },
        },
      };
    case "clearFlag": {
      const flags = { ...(state.run.flags ?? {}) };
      delete flags[effect.flag ?? effect.key];
      return { ...state, run: { ...state.run, flags } };
    }
    case "setStoryFact": {
      const key = effect.key ?? effect.fact;
      if (!key) return state;
      return updateStory(state, (story) => ({
        ...story,
        facts: {
          ...(story.facts ?? {}),
          [key]: Object.prototype.hasOwnProperty.call(effect, "value") ? effect.value : true,
        },
      }));
    }
    case "clearStoryFact": {
      const key = effect.key ?? effect.fact;
      if (!key) return state;
      return updateStory(state, (story) => {
        const facts = { ...(story.facts ?? {}) };
        delete facts[key];
        return { ...story, facts };
      });
    }
    case "incrementStoryCounter": {
      const key = effect.key ?? effect.counter;
      if (!key) return state;
      const increment = Number(effect.amount ?? effect.value ?? 1);
      return updateStory(state, (story) => ({
        ...story,
        facts: {
          ...(story.facts ?? {}),
          [key]: Number(story.facts?.[key] ?? 0) + (Number.isFinite(increment) ? increment : 1),
        },
      }));
    }
    case "recordStoryTag": {
      const tag = effect.tag ?? effect.storyTag ?? effect.value;
      if (!tag) return state;
      return updateStory(state, (story) => ({
        ...story,
        resolvedStoryTags: unique(story.resolvedStoryTags ?? [], tag),
      }));
    }
    case "selectEnding":
    case "selectFinalEnding": {
      const endingId = effect.endingId ?? effect.id ?? effect.value;
      if (!endingId) return state;
      const endingTitle =
        effect.endingTitle ?? effect.title ?? ENDING_TITLES[endingId] ?? String(endingId);
      const newlyDiscovered = !(state.meta?.discoveredEndingIds ?? []).includes(endingId);
      return {
        ...updateStory(state, (story) => ({
          ...story,
          endingId,
          endingTitle,
          ...(effect.summary ? { endingSummary: effect.summary } : {}),
        })),
        run: { ...state.run, newEndingDiscovered: newlyDiscovered },
        meta: {
          ...state.meta,
          discoveredEndingIds: unique(state.meta?.discoveredEndingIds ?? [], endingId),
        },
      };
    }
    case "setFinalPlan": {
      const finalPlan = effect.plan ?? effect.value;
      if (!finalPlan) return state;
      return updateStory(state, (story) => ({
        ...story,
        facts: { ...(story.facts ?? {}), finalPlan },
      }));
    }
    case "startEncounter":
      return beginEncounter(state, effect.enemyId ?? null, context.enemies, {
        originBeatId: state.story?.currentBeatId,
        kind: effect.kind ?? "random",
      });
    case "startStoryEncounter":
      return beginEncounter(state, effect.enemyId ?? null, context.enemies, {
        originBeatId:
          effect.originBeatId ?? effect.originatingBeatId ?? effect.beatId ?? state.story?.currentBeatId,
        ...(effect.kind || effect.encounterKind || effect.required || context.currentCard?.story?.role === "anchor"
          ? {
              kind:
                effect.kind ??
                effect.encounterKind ??
                (effect.required || context.currentCard?.story?.role === "anchor"
                  ? "required"
                  : undefined),
            }
          : {}),
      });
    case "addItem": {
      const itemId = effect.itemId ?? effect.id;
      if (!itemId) return state;
      const count = Math.max(1, Math.trunc(effect.count ?? 1));
      const added = addInventoryItem(state, itemId, count);
      return {
        ...added,
        run: { ...added.run, itemsFound: Number(added.run.itemsFound ?? 0) + count },
        meta: {
          ...added.meta,
          discoveredItemIds: unique(added.meta.discoveredItemIds ?? [], itemId),
        },
      };
    }
    case "removeItem":
      return removeInventoryItem(
        state,
        effect.itemId ?? effect.id,
        Math.max(1, Math.trunc(effect.count ?? 1)),
      );
    case "removeDeclaredNonKeyItem":
    case "removeSpecificNonKeyItem": {
      const itemId = effect.itemId ?? effect.id;
      const item = items.find?.((entry) => entry.id === itemId) ?? items.get?.(itemId);
      if (!itemId || !item || item.keyItem || item.questCritical || item.type === "key") return state;
      return removeInventoryItem(state, itemId, Math.max(1, Math.trunc(effect.count ?? 1)));
    }
    case "queueCard":
      return {
        ...state,
        run: {
          ...state.run,
          forcedCardQueue: [
            ...(state.run.forcedCardQueue ?? []),
            effect.itemId
              ? { cardId: effect.cardId ?? effect.id, itemId: effect.itemId }
              : effect.cardId ?? effect.id,
          ],
        },
      };
    case "queueBeatCard": {
      const cardId = effect.cardId ?? effect.id;
      if (!cardId) return state;
      return {
        ...state,
        run: {
          ...state.run,
          forcedCardQueue: [
            ...(state.run.forcedCardQueue ?? []),
            {
              cardId,
              originBeatId:
                effect.originBeatId ??
                effect.originatingBeatId ??
                effect.beatId ??
                state.story?.currentBeatId,
              beatLocal: true,
            },
          ],
        },
      };
    }
    case "boundedHpLoss":
    case "applyBoundedHpLoss": {
      const loss = Math.abs(Number(effect.amount ?? effect.value ?? effect.damage ?? 0));
      const floor = Math.max(1, Number(effect.minimumHp ?? effect.minimumFloor ?? effect.floor ?? 1));
      if (!Number.isFinite(loss)) return state;
      return {
        ...state,
        player: {
          ...state.player,
          hp: Math.min(state.player.hp, Math.max(floor, state.player.hp - loss)),
        },
      };
    }
    case "recordDiscovery": {
      const kind = effect.kind ?? effect.discoveryType ?? "card";
      const id = effect.discoveryId ?? effect.id ?? effect.itemId ?? effect.enemyId;
      if (!id) return state;
      if (kind === "enemy") {
        return {
          ...state,
          meta: {
            ...state.meta,
            discoveredEnemyIds: unique(state.meta.discoveredEnemyIds ?? [], id),
          },
        };
      }
      if (kind === "item") {
        return {
          ...state,
          meta: {
            ...state.meta,
            discoveredItemIds: unique(state.meta.discoveredItemIds ?? [], id),
          },
        };
      }
      return {
        ...state,
        meta: {
          ...state.meta,
          discoveredCardIds: unique(state.meta.discoveredCardIds ?? [], id),
        },
      };
    }
    case "setRunStat": {
      const stat = effect.stat ?? effect.key;
      const previous = Number(state.run.stats?.[stat] ?? 0);
      let value;
      if (effect.operation === "increment" || effect.operation === "add") {
        value = previous + (Number(effect.amount) || 1);
      } else if (effect.operation === "max") {
        value = Math.max(previous, Number(effect.value ?? effect.amount) || 0);
      } else {
        value = Object.prototype.hasOwnProperty.call(effect, "value") ? effect.value : amount;
      }
      return {
        ...state,
        run: { ...state.run, stats: { ...(state.run.stats ?? {}), [stat]: value } },
      };
    }
    case "modifyBaseStat": {
      const stat = effect.stat;
      if (!["attack", "defense", "maxHp", "maxMp"].includes(stat)) return state;
      const minimum = stat === "maxHp" ? 1 : 0;
      const changed = {
        ...state,
        player: {
          ...state.player,
          baseStats: {
            ...state.player.baseStats,
            [stat]: Math.max(minimum, Number(state.player.baseStats[stat] ?? 0) + amount),
          },
        },
      };
      return clampPlayerResources(changed, items);
    }
    default:
      // Unknown effect types are inert. Content remains data-only and a typo
      // cannot execute arbitrary code.
      return state;
  }
}

export function applyEffects(state, effects, context = {}) {
  return (Array.isArray(effects) ? effects : []).reduce(
    (workingState, effect) => applyEffect(workingState, effect, context),
    state,
  );
}

export const executeEffect = applyEffect;
export const executeEffects = applyEffects;

export function resourceChanges(before, after, itemDefinitions = DEFAULT_ITEMS) {
  const beforeStats = getDerivedStats(before, itemDefinitions);
  const afterStats = getDerivedStats(after, itemDefinitions);
  const values = {
    hp: after.player.hp - before.player.hp,
    mp: after.player.mp - before.player.mp,
    gold: after.player.gold - before.player.gold,
    xp: after.player.xp - before.player.xp,
    level: after.player.level - before.player.level,
    attack: afterStats.attack - beforeStats.attack,
    defense: afterStats.defense - beforeStats.defense,
    maxHp: afterStats.maxHp - beforeStats.maxHp,
    maxMp: afterStats.maxMp - beforeStats.maxMp,
  };
  return Object.fromEntries(Object.entries(values).filter(([, delta]) => delta !== 0));
}
