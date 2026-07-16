import { enemies as DEFAULT_ENEMIES } from "../data/enemies.js";
import { items as DEFAULT_ITEMS } from "../data/items.js";
import { randomFloat, randomInt, weightedChoice } from "../rng.js";
import { getDerivedStats } from "./equipment.js";
import { requirementsMet } from "./requirements.js";

export const INTENTS = Object.freeze(["attack", "opening", "charge", "hesitate"]);

const INTENT_TEXT = Object.freeze({
  attack: "A direct attack is coming.",
  opening: "Its guard opens for a heartbeat.",
  charge: "It gathers strength for a crushing blow.",
  hesitate: "It falters and watches your stance.",
});

export function enemyMap(enemyDefinitions = DEFAULT_ENEMIES) {
  if (enemyDefinitions instanceof Map) return enemyDefinitions;
  if (!Array.isArray(enemyDefinitions) && enemyDefinitions && typeof enemyDefinitions === "object") {
    return new Map(Object.entries(enemyDefinitions));
  }
  return new Map((enemyDefinitions ?? []).map((enemy) => [enemy.id, enemy]));
}

export function getEnemy(state, enemyDefinitions = DEFAULT_ENEMIES) {
  return enemyMap(enemyDefinitions).get(state?.encounter?.enemyId) ?? null;
}

export function ordinaryDamage(rngState, attackerAttack, defenderDefense) {
  const roll = randomInt(rngState, -1, 2);
  return {
    damage: Math.max(1, Number(attackerAttack) + roll.value - Number(defenderDefense)),
    state: roll.state,
    variance: roll.value,
  };
}

export function techniqueDamage(rngState, attackerAttack, defenderDefense) {
  const roll = randomInt(rngState, 0, 2);
  return {
    damage: Math.max(
      2,
      Math.floor(Number(attackerAttack) * 1.6) + roll.value - Number(defenderDefense),
    ),
    state: roll.state,
    variance: roll.value,
  };
}

export function damageEstimate(attackerAttack, defenderDefense, multiplier = 1) {
  const attack = Math.floor(Number(attackerAttack) * multiplier);
  return {
    min: Math.max(1, attack - 1 - Number(defenderDefense)),
    max: Math.max(1, attack + 2 - Number(defenderDefense)),
  };
}

export function rollIntent(rngState, enemy, lastIntent = null, options = {}) {
  const weights = options.weights ?? enemy?.intentWeights ?? { attack: 1 };
  const entries = INTENTS.map((intent) => ({
    intent,
    // A charge can never directly follow another charge. This hard stop is
    // clearer to players than merely hoping weighted randomness relents.
    weight: intent === "charge" && lastIntent === "charge" ? 0 : Number(weights[intent] ?? 0),
  }));
  if (!entries.some((entry) => entry.weight > 0)) entries[0].weight = 1;
  const result = weightedChoice(rngState, entries);
  return { intent: result.value?.intent ?? "attack", state: result.state };
}

/** Return the authored combat phase active at the supplied enemy HP. */
export function getEnemyPhase(enemy, hp) {
  const phases = Array.isArray(enemy?.phases) ? enemy.phases : [];
  if (phases.length === 0) return null;
  const percent = Number(enemy.maxHp) > 0 ? Number(hp) / Number(enemy.maxHp) : 0;
  return (
    phases.find((phase) =>
      Number.isFinite(Number(phase.atOrBelowHpPercent))
        ? percent <= Number(phase.atOrBelowHpPercent)
        : Number.isFinite(Number(phase.aboveHpPercent))
          ? percent > Number(phase.aboveHpPercent)
          : false,
    ) ?? phases[0]
  );
}

function combatProfile(state, enemy, hp = state.encounter?.hp ?? enemy.maxHp) {
  const phase = getEnemyPhase(enemy, hp);
  let weights = { ...(phase?.intentWeights ?? enemy.intentWeights ?? { attack: 1 }) };
  let attackModifier = Number(phase?.attackModifier ?? 0);
  const labels = [];

  const enragedThreshold = Number(enemy.intentProfile?.enragedBelowHpPercent);
  if (
    Number.isFinite(enragedThreshold) &&
    Number(enemy.maxHp) > 0 &&
    Number(hp) / Number(enemy.maxHp) <= enragedThreshold
  ) {
    weights = { ...(enemy.intentProfile?.enragedWeights ?? weights) };
  }

  for (const modifier of enemy.storyFactModifiers ?? []) {
    if (!requirementsMet(modifier.requirements, state)) continue;
    attackModifier += Number(modifier.attackModifier ?? 0);
    weights.charge = Math.max(0, Number(weights.charge ?? 0) + Number(modifier.chargeWeightModifier ?? 0));
    weights.opening = Math.max(0, Number(weights.opening ?? 0) + Number(modifier.openingWeightModifier ?? 0));
    if (modifier.label) labels.push(modifier.label);
  }
  return { phase, weights, attackModifier, labels };
}

export function selectEnemy(state, enemyDefinitions = DEFAULT_ENEMIES, options = {}) {
  const definitions = Array.isArray(enemyDefinitions)
    ? enemyDefinitions
    : [...enemyMap(enemyDefinitions).values()];
  const bossOnly = Boolean(options.boss);
  const level = state.player.level;
  const arcId = options.arcId ?? state.story?.arcId;
  const policy = options.encounterPolicy ?? options.policy;
  const allowedTags = new Set(options.allowedEnemyTags ?? policy?.allowedEnemyTags ?? []);

  let eligible = definitions.filter((enemy) => {
    if (options.enemyId && enemy.id !== options.enemyId) return false;
    if (options.midboss && !enemy.isMidboss) return false;
    if (options.finalBoss && !enemy.isFinalBoss) return false;
    if (!options.midboss && !options.finalBoss && bossOnly !== Boolean(enemy.isBoss)) return false;
    if (!bossOnly && !options.midboss && !options.finalBoss && (enemy.isMidboss || enemy.isFinalBoss)) {
      return false;
    }
    if (Number(enemy.minLevel ?? 1) > level) return false;
    if (Number.isFinite(Number(enemy.maxLevel)) && level > Number(enemy.maxLevel)) return false;
    const enemyArcIds = enemy.story?.arcIds;
    if (Array.isArray(enemyArcIds) && arcId && !enemyArcIds.includes(arcId)) return false;
    const enemyTags = enemy.story?.enemyTags ?? [];
    if (allowedTags.size > 0 && !enemyTags.some((tag) => allowedTags.has(tag))) return false;
    return true;
  });

  // Content mistakes must not soft-lock combat. Fall back to the weakest
  // regular enemy (or the configured boss) deterministically.
  if (eligible.length === 0) {
    eligible = definitions
      .filter((enemy) => {
        if (options.enemyId) return enemy.id === options.enemyId;
        if (options.midboss) return Boolean(enemy.isMidboss);
        if (options.finalBoss) return Boolean(enemy.isFinalBoss);
        return bossOnly === Boolean(enemy.isBoss) && !(enemy.isMidboss || enemy.isFinalBoss);
      })
      .sort((a, b) => Number(a.minLevel ?? 1) - Number(b.minLevel ?? 1));
  }
  if (eligible.length === 0) return { state, enemy: null };

  const weighted = eligible.map((enemy) => {
    const levelDistance = Math.abs(level - Number(enemy.minLevel ?? level));
    return { enemy, weight: Number(enemy.baseWeight ?? 5) / (1 + levelDistance * 0.35) };
  });
  const selected = weightedChoice(state.rngState, weighted);
  return {
    state: { ...state, rngState: selected.state },
    enemy: selected.value?.enemy ?? eligible[0],
  };
}

/** Begin combat and roll the first visible intent. */
export function beginEncounter(
  state,
  enemyOrId = null,
  enemyDefinitions = DEFAULT_ENEMIES,
  options = {},
) {
  const definitions = enemyMap(enemyDefinitions);
  let working = state;
  let enemy =
    typeof enemyOrId === "object" && enemyOrId
      ? enemyOrId
      : definitions.get(enemyOrId) ?? null;

  if (!enemy) {
    const selected = selectEnemy(working, enemyDefinitions, options);
    working = selected.state;
    enemy = selected.enemy;
  }
  if (!enemy) return state;

  let intent;
  const profile = combatProfile(working, enemy, enemy.maxHp);
  if (working.run.flags?.ambushOpening) {
    intent = { intent: "opening", state: working.rngState };
  } else if (enemy.intentProfile?.openingMove) {
    intent = { intent: enemy.intentProfile.openingMove, state: working.rngState };
  } else {
    intent = rollIntent(working.rngState, enemy, null, { weights: profile.weights });
  }

  const flags = { ...(working.run.flags ?? {}) };
  delete flags.ambushOpening;
  const originBeatId = options.originBeatId ?? working.story?.currentBeatId ?? null;
  const kind = options.kind ?? (enemy.isBoss ? "required" : "random");
  const randomEncountersByBeat = { ...(working.run.randomEncountersByBeat ?? {}) };
  if (kind === "random" && originBeatId) {
    randomEncountersByBeat[originBeatId] = Number(randomEncountersByBeat[originBeatId] ?? 0) + 1;
  }
  return {
    ...working,
    rngState: intent.state,
    mode: "combat",
    encounter: {
      enemyId: enemy.id,
      hp: enemy.maxHp,
      lastIntent: null,
      currentIntent: intent.intent,
      round: 1,
      originBeatId,
      kind,
      phase: profile.phase ? Math.max(1, (enemy.phases ?? []).indexOf(profile.phase) + 1) : 1,
    },
    run: {
      ...working.run,
      flags,
      randomEncountersByBeat,
    },
  };
}

export const startEncounter = beginEncounter;

export function combatActions(state, enemyDefinitions = DEFAULT_ENEMIES, itemDefinitions = DEFAULT_ITEMS) {
  const enemy = getEnemy(state, enemyDefinitions);
  if (!enemy || !state.encounter) return null;
  const stats = getDerivedStats(state, itemDefinitions);
  const estimate = damageEstimate(stats.attack, enemy.defense);
  const strike = {
    action: "strike",
    label: "Strike",
    cost: null,
    estimate,
    preview: [{ resource: "enemyHp", label: `${estimate.min}–${estimate.max} damage` }],
  };
  const focus = {
    action: "focus",
    label: "Focus · +2 MP",
    cost: null,
    preview: [{ resource: "mp", delta: 2 }],
  };

  switch (state.encounter.currentIntent) {
    case "opening": {
      const techniqueEstimate = damageEstimate(stats.attack, enemy.defense, 1.6);
      return {
        left: strike,
        right:
          state.player.mp >= 3
            ? {
                action: "technique",
                label: "Technique · −3 MP",
                cost: { resource: "mp", amount: 3 },
                estimate: techniqueEstimate,
                preview: [
                  { resource: "mp", delta: -3 },
                  {
                    resource: "enemyHp",
                    label: `${techniqueEstimate.min}–${techniqueEstimate.max} damage`,
                  },
                ],
              }
            : focus,
      };
    }
    case "charge":
      return {
        left: {
          action: "evade",
          label: "Evade · 65%",
          cost: null,
          preview: [{ resource: "hp", label: "65% avoid" }],
        },
        right:
          state.player.mp >= 2
            ? {
                action: "break",
                label: "Break · −2 MP",
                cost: { resource: "mp", amount: 2 },
                estimate,
                preview: [
                  { resource: "mp", delta: -2 },
                  { resource: "enemyHp", label: `${estimate.min}–${estimate.max} damage` },
                ],
              }
            : {
                action: "brace",
                label: "Brace",
                cost: null,
                preview: [{ resource: "hp", label: "Greatly reduced damage" }],
              },
      };
    case "hesitate":
      return { left: focus, right: strike };
    case "attack":
    default:
      return {
        left: {
          action: "guard",
          label: "Guard · +1 MP",
          cost: null,
          preview: [
            { resource: "hp", label: "60% less damage" },
            { resource: "mp", delta: 1 },
          ],
        },
        right: strike,
      };
  }
}

export function getCombatCard(
  state,
  enemyDefinitions = DEFAULT_ENEMIES,
  itemDefinitions = DEFAULT_ITEMS,
) {
  const enemy = getEnemy(state, enemyDefinitions);
  const actions = combatActions(state, enemyDefinitions, itemDefinitions);
  if (!enemy || !actions) return null;
  const profile = combatProfile(state, enemy);
  const phaseName = profile.phase?.id
    ? profile.phase.id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
  return {
    id: `combat:${enemy.id}:${state.encounter.round}`,
    category: "combat",
    speaker: enemy.name,
    title: `${phaseName ? `${phaseName} · ` : ""}${state.encounter.currentIntent[0].toUpperCase()}${state.encounter.currentIntent.slice(1)}`,
    text: `${profile.phase?.announcement ? `${profile.phase.announcement} ` : ""}${INTENT_TEXT[state.encounter.currentIntent] ?? INTENT_TEXT.attack}`,
    artId: enemy.artId,
    story: { countsTowardStory: false },
    enemyIntent: state.encounter.currentIntent,
    left: { ...actions.left, resultText: "" },
    right: { ...actions.right, resultText: "" },
  };
}

function enemyIncomingDamage(rngState, enemy, defense, intent, attackModifier = 0) {
  const baseAttack = Math.max(0, Number(enemy.attack) + Number(attackModifier));
  const attack = intent === "charge" ? Math.floor(baseAttack * 1.5) : baseAttack;
  const roll = ordinaryDamage(rngState, attack, defense);
  return roll;
}

function addUnique(list, value) {
  return list.includes(value) ? list : [...list, value];
}

function rollDrop(rngState, enemy) {
  if (!enemy.dropTable?.length || Number(enemy.dropChance ?? 0) <= 0) {
    return { itemId: null, state: rngState };
  }
  const chance = randomFloat(rngState);
  if (chance.value >= Number(enemy.dropChance)) return { itemId: null, state: chance.state };
  const selected = weightedChoice(chance.state, enemy.dropTable, (entry) => entry.weight ?? 1);
  return { itemId: selected.value?.itemId ?? null, state: selected.state };
}

function finishEnemy(state, enemy) {
  let working = state;
  const goldRoll = randomInt(working.rngState, enemy.goldMin ?? 0, enemy.goldMax ?? 0);
  working = { ...working, rngState: goldRoll.state };
  const drop = rollDrop(working.rngState, enemy);
  working = { ...working, rngState: drop.state };
  const xpAwarded = Math.max(0, Number(enemy.xpReward ?? 0));

  const defeated = { ...(working.run.enemiesDefeated ?? {}) };
  defeated[enemy.id] = Number(defeated[enemy.id] ?? 0) + 1;
  const queue = [...(working.run.forcedCardQueue ?? [])];
  const rewardId = `${enemy.id}:${working.decisionCount}`;
  queue.push({
    cardId: "combat-reward",
    rewardId,
    enemyId: enemy.id,
    originBeatId: working.encounter?.originBeatId ?? working.story?.currentBeatId ?? null,
    xpAwarded,
    goldAwarded: goldRoll.value,
    itemId: drop.itemId,
  });
  const defeatFacts = enemy.story?.onDefeatFacts ?? {};

  return {
    state: {
      ...working,
      mode: "exploration",
      encounter: null,
      story: {
        ...working.story,
        facts: { ...(working.story?.facts ?? {}), ...defeatFacts },
      },
      run: {
        ...working.run,
        forcedCardQueue: queue,
        turnsSinceEncounter: 0,
        lastCombatTurn: working.decisionCount,
        enemiesDefeated: defeated,
      },
      meta: {
        ...working.meta,
        discoveredEnemyIds: addUnique(working.meta.discoveredEnemyIds ?? [], enemy.id),
      },
    },
    goldAwarded: goldRoll.value,
    xpAwarded,
    itemDrop: drop.itemId,
    rewardId,
  };
}

/** Resolve exactly one combat action and return a rich deterministic result. */
export function resolveCombatAction(
  state,
  requestedAction,
  enemyDefinitions = DEFAULT_ENEMIES,
  itemDefinitions = DEFAULT_ITEMS,
) {
  const enemy = getEnemy(state, enemyDefinitions);
  if (!enemy || !state.encounter || state.mode !== "combat") {
    return { state, ignored: true, reason: "no-active-encounter" };
  }

  let action = requestedAction;
  if (action === "technique" && state.player.mp < 3) action = "focus";
  if (action === "break" && state.player.mp < 2) action = "brace";
  const valid = new Set(["strike", "technique", "guard", "focus", "evade", "break", "brace"]);
  if (!valid.has(action)) return { state, ignored: true, reason: "unknown-action" };

  const stats = getDerivedStats(state, itemDefinitions);
  let rngState = state.rngState;
  let enemyHp = state.encounter.hp;
  let playerHp = state.player.hp;
  let playerMp = state.player.mp;
  let playerDamage = 0;
  let enemyDamage = 0;
  let evaded = false;

  if (action === "strike" || action === "break") {
    const hit = ordinaryDamage(rngState, stats.attack, enemy.defense);
    rngState = hit.state;
    playerDamage = hit.damage;
  } else if (action === "technique") {
    playerMp -= 3;
    const hit = techniqueDamage(rngState, stats.attack, enemy.defense);
    rngState = hit.state;
    playerDamage = hit.damage;
  }
  if (action === "break") playerMp -= 2;
  if (action === "guard") playerMp = Math.min(stats.maxMp, playerMp + 1);
  if (action === "focus") playerMp = Math.min(stats.maxMp, playerMp + 2);

  enemyHp = Math.max(0, enemyHp - playerDamage);

  // A defeated enemy never gets a final retaliation or another intent roll.
  if (enemyHp <= 0) {
    const finished = finishEnemy(
      {
        ...state,
        rngState,
        player: { ...state.player, hp: playerHp, mp: playerMp },
        encounter: { ...state.encounter, hp: 0 },
      },
      enemy,
    );
    return {
      ...finished,
      action,
      playerDamage,
      enemyDamage: 0,
      enemyDefeated: true,
      evaded: false,
      resultText: `${enemy.name} falls. The spoils of battle are ready.`,
    };
  }

  const intent = state.encounter.currentIntent;
  const previousPhase = state.encounter.phase ?? 1;
  const activeProfile = combatProfile(state, enemy, enemyHp);
  const activePhase = activeProfile.phase
    ? Math.max(1, (enemy.phases ?? []).indexOf(activeProfile.phase) + 1)
    : 1;
  let incomingMultiplier = 1;
  let canRetaliate = intent !== "opening";

  if (action === "evade") {
    const evadeRoll = randomFloat(rngState);
    rngState = evadeRoll.state;
    evaded = evadeRoll.value < 0.65;
    canRetaliate = !evaded;
  }
  if (action === "guard") incomingMultiplier = 0.4;
  if (action === "break") incomingMultiplier = 0.25;
  if (action === "brace") incomingMultiplier = 0.45;
  if (intent === "hesitate") incomingMultiplier *= 0.35;

  if (canRetaliate) {
    const incoming = enemyIncomingDamage(
      rngState,
      enemy,
      stats.defense,
      intent,
      activeProfile.attackModifier,
    );
    rngState = incoming.state;
    enemyDamage = Math.max(1, Math.floor(incoming.damage * incomingMultiplier));
    playerHp = Math.max(0, playerHp - enemyDamage);
  }

  let working = {
    ...state,
    rngState,
    player: { ...state.player, hp: playerHp, mp: Math.max(0, Math.min(stats.maxMp, playerMp)) },
    encounter: { ...state.encounter, hp: enemyHp },
  };

  if (playerHp <= 0) {
    working = {
      ...working,
      mode: "gameOver",
      encounter: null,
      run: { ...working.run, deathCause: enemy.id },
    };
    return {
      state: working,
      action,
      playerDamage,
      enemyDamage,
      enemyDefeated: false,
      evaded,
      resultText: "The blow extinguishes your last strength.",
    };
  }

  const nextIntent = rollIntent(rngState, enemy, intent, { weights: activeProfile.weights });
  working = {
    ...working,
    rngState: nextIntent.state,
    encounter: {
      ...working.encounter,
      lastIntent: intent,
      currentIntent: nextIntent.intent,
      round: working.encounter.round + 1,
      phase: activePhase,
    },
  };

  const actionText = playerDamage > 0 ? `You deal ${playerDamage} damage.` : "You hold your ground.";
  const incomingText = evaded
    ? " The charged blow misses."
    : enemyDamage > 0
      ? ` You take ${enemyDamage} damage.`
      : " The enemy cannot answer.";
  const phaseText =
    activePhase !== previousPhase && activeProfile.phase?.announcement
      ? ` ${activeProfile.phase.announcement}`
      : "";
  const modifierText = activeProfile.labels.length > 0 ? ` ${activeProfile.labels.join(" ")}` : "";
  return {
    state: working,
    action,
    playerDamage,
    enemyDamage,
    enemyDefeated: false,
    evaded,
    resultText: `${actionText}${incomingText}${phaseText}${modifierText}`,
  };
}

export function resolveCombatChoice(
  state,
  direction,
  enemyDefinitions = DEFAULT_ENEMIES,
  itemDefinitions = DEFAULT_ITEMS,
) {
  const choices = combatActions(state, enemyDefinitions, itemDefinitions);
  const action = choices?.[direction]?.action;
  return resolveCombatAction(state, action, enemyDefinitions, itemDefinitions);
}

export function attemptFlee(state, chance = 0.6, enemyDefinitions = DEFAULT_ENEMIES) {
  const enemy = getEnemy(state, enemyDefinitions);
  if (!enemy || enemy.isBoss) return { state, escaped: false };
  const roll = randomFloat(state.rngState);
  if (roll.value >= chance) return { state: { ...state, rngState: roll.state }, escaped: false };
  return {
    state: {
      ...state,
      rngState: roll.state,
      mode: "exploration",
      encounter: null,
      run: { ...state.run, turnsSinceEncounter: 0, lastCombatTurn: state.decisionCount },
    },
    escaped: true,
  };
}

export const calculateDamage = ordinaryDamage;
export const calculateTechniqueDamage = techniqueDamage;
export const getCombatActions = combatActions;
