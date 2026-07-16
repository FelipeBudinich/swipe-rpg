import { getDerivedStats } from "./equipment.js";

export function xpThreshold(level) {
  return 20 + (Math.max(1, Math.trunc(Number(level) || 1)) - 1) * 15;
}

export const getXpThreshold = xpThreshold;

/** Add XP, increase level immediately, and queue one decision per level gained. */
export function grantXp(state, amount) {
  let xp = Math.max(0, Number(state.player.xp) || 0) + Math.max(0, Number(amount) || 0);
  let level = Math.max(1, Math.trunc(Number(state.player.level) || 1));
  const queued = [];

  while (xp >= xpThreshold(level)) {
    xp -= xpThreshold(level);
    level += 1;
    queued.push("level-up");
  }

  return {
    ...state,
    player: { ...state.player, xp, level },
    run: {
      ...state.run,
      forcedCardQueue: [...(state.run.forcedCardQueue ?? []), ...queued],
    },
    meta: {
      ...state.meta,
      bestLevel: Math.max(Number(state.meta?.bestLevel) || 1, level),
    },
  };
}

export const addXp = grantXp;

/** Apply one of the two authored level-up specializations. */
export function applyLevelUpChoice(state, direction, itemDefinitions) {
  const choice = direction === "left" || direction === "vigor" ? "vigor" : "arcana";
  let player;

  if (choice === "vigor") {
    player = {
      ...state.player,
      baseStats: {
        ...state.player.baseStats,
        maxHp: state.player.baseStats.maxHp + 6,
        defense: state.player.baseStats.defense + 1,
      },
      hp: state.player.hp + 6,
    };
  } else {
    player = {
      ...state.player,
      baseStats: {
        ...state.player.baseStats,
        maxMp: state.player.baseStats.maxMp + 4,
        attack: state.player.baseStats.attack + 1,
      },
      mp: state.player.mp + 4,
    };
  }

  const updated = { ...state, player };
  const after = getDerivedStats(updated, itemDefinitions);
  return {
    ...updated,
    player: {
      ...updated.player,
      hp: Math.max(0, Math.min(after.maxHp, updated.player.hp)),
      mp: Math.max(0, Math.min(after.maxMp, updated.player.mp)),
    },
    run: {
      ...updated.run,
      stats: {
        ...(updated.run.stats ?? {}),
        vigorChoices: (updated.run.stats?.vigorChoices ?? 0) + (choice === "vigor" ? 1 : 0),
        arcanaChoices: (updated.run.stats?.arcanaChoices ?? 0) + (choice === "arcana" ? 1 : 0),
      },
    },
  };
}
