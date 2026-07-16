import {
  DEFAULT_BEAT_BUDGETS,
  ENCOUNTER_POLICY_MODES,
  EXPECTED_STORY_BUDGET_TOTALS,
  MAJOR_ANCHOR_BEAT_IDS,
  STORY_BEATS,
  STORY_CARD_ROLES,
} from "./constants.js";
import { getStoryBudgetTotals, normalizeBeatBudget } from "./beat-progress.js";

const asList = (value) => (Array.isArray(value) ? value : []);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

export class ArcValidationError extends Error {
  constructor(errors) {
    const messages = asList(errors).map((error) =>
      typeof error === "string" ? error : error.message,
    );
    super(`Invalid story arc:\n- ${messages.join("\n- ")}`);
    this.name = "ArcValidationError";
    this.errors = messages;
  }
}

function idsFrom(value) {
  if (!value) return new Set();
  if (value instanceof Map) return new Set(value.keys());
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => (typeof entry === "string" ? entry : entry?.id)).filter(Boolean));
  }
  if (typeof value === "object") return new Set(Object.keys(value));
  return new Set();
}

function duplicateIds(entries) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of asList(entries)) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function beatHasCard(card, beatId) {
  const weights = card?.story?.beatWeights ?? {};
  return Number(weights[beatId]) > 0 || asList(card?.story?.beatIds).includes(beatId);
}

function completionTagsForObjective(objective) {
  if (!objective) return [];
  if (typeof objective === "string") return [objective];
  if (Array.isArray(objective)) return objective.flatMap(completionTagsForObjective);
  if (typeof objective !== "object") return [];
  if (["storyTag", "storyTagResolved", "tagResolved"].includes(objective.type)) {
    return [objective.tag ?? objective.value].filter((tag) => typeof tag === "string");
  }
  return asList(objective.objectives ?? objective.requirements).flatMap(completionTagsForObjective);
}

function isCompletionCandidate(card, beat) {
  if (!beatHasCard(card, beat.id)) return false;
  if (["completion", "entry"].includes(card?.story?.role)) return true;
  const tags = asList(card?.story?.completionTags);
  const objectiveTags = completionTagsForObjective(beat.completionObjective ?? beat.objective);
  return tags.length > 0 && (objectiveTags.length === 0 || tags.some((tag) => objectiveTags.includes(tag)));
}

function anchorFor(beat) {
  return beat?.anchor ?? beat?.anchorFamily ?? null;
}

function anchorCardIds(beat) {
  const anchor = anchorFor(beat);
  return [
    ...asList(anchor?.variants).map(({ cardId }) => cardId),
    anchor?.fallbackCardId ?? anchor?.fallback?.cardId,
  ].filter((id) => typeof id === "string");
}

function referencedCardIds(arc) {
  const references = [];
  for (const beat of asList(arc?.beats)) {
    references.push(...anchorCardIds(beat));
    for (const field of [
      "cardIds",
      "entryCardIds",
      "completionCardIds",
      "forcedCardIds",
      "sequenceCardIds",
    ]) {
      references.push(...asList(beat?.[field]));
    }
    for (const field of ["entryCardId", "completionCardId", "aftermathCardId"]) {
      if (typeof beat?.[field] === "string") references.push(beat[field]);
    }
  }
  for (const ending of asList(arc?.endings)) {
    if (typeof ending?.finalImageCardId === "string") references.push(ending.finalImageCardId);
    references.push(...asList(ending?.finalImageCardIds));
  }
  for (const sequence of asList(arc?.forcedSequences)) {
    references.push(...asList(sequence?.cardIds));
  }
  return references;
}

function walkEffects(card, visitor) {
  for (const choice of [card?.left, card?.right]) {
    for (const effect of asList(choice?.effects)) visitor(effect, card);
  }
}

function walkRequirements(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value) && typeof value.type === "string") visitor(value);
  for (const nested of Object.values(value)) walkRequirements(nested, visitor, seen);
}

const ABSTRACT_SCORE = /^(morality|karma|alignment|good|evil|virtue|cruelty|loyalty[-_ ]?score)$/i;

function hasAbstractScoreReference(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => hasAbstractScoreReference(entry, seen));
  for (const [key, nested] of Object.entries(value)) {
    if (["key", "fact", "flag", "stat", "counter"].includes(key) && ABSTRACT_SCORE.test(String(nested))) {
      return true;
    }
    if (key === "type" && ABSTRACT_SCORE.test(String(nested))) return true;
    if (hasAbstractScoreReference(nested, seen)) return true;
  }
  return false;
}

function hasFunctionValue(value, seen = new Set()) {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((nested) => hasFunctionValue(nested, seen));
}

function collectRegistryErrors(arc, cards, options, errors) {
  const knownCards = idsFrom(cards);
  const knownEnemies = idsFrom(options.enemies ?? options.enemyIds);
  const knownItems = idsFrom(options.items ?? options.itemIds);
  const endingIds = idsFrom(arc?.endings);
  const beatIds = idsFrom(arc?.beats);

  for (const cardId of referencedCardIds(arc)) {
    if (!knownCards.has(cardId)) errors.push(`Unknown card ID: ${cardId}`);
  }

  for (const card of asList(cards)) {
    for (const beatId of Object.keys(card?.story?.beatWeights ?? {})) {
      if (!beatIds.has(beatId)) errors.push(`Card ${card.id} references unknown beat ${beatId}.`);
    }
    for (const beatId of asList(card?.story?.beatIds)) {
      if (!beatIds.has(beatId)) errors.push(`Card ${card.id} references unknown beat ${beatId}.`);
    }

    walkEffects(card, (effect) => {
      const cardId = effect?.cardId ?? (effect?.type === "queueCard" ? effect?.id : null);
      if (typeof cardId === "string" && !knownCards.has(cardId)) {
        errors.push(`Card ${card.id} queues unknown card ${cardId}.`);
      }
      const enemyId = effect?.enemyId;
      if (knownEnemies.size > 0 && typeof enemyId === "string" && !knownEnemies.has(enemyId)) {
        errors.push(`Card ${card.id} references unknown enemy ${enemyId}.`);
      }
      const itemId = effect?.itemId;
      if (knownItems.size > 0 && typeof itemId === "string" && !knownItems.has(itemId)) {
        errors.push(`Card ${card.id} references unknown item ${itemId}.`);
      }
      const endingId = effect?.endingId ?? (effect?.type === "selectFinalEnding" ? effect?.value : null);
      if (typeof endingId === "string" && !endingIds.has(endingId)) {
        errors.push(`Card ${card.id} references unknown ending ${endingId}.`);
      }
      const effectBeatId = effect?.beatId ?? effect?.originBeatId;
      if (typeof effectBeatId === "string" && !beatIds.has(effectBeatId)) {
        errors.push(`Card ${card.id} effect references unknown beat ${effectBeatId}.`);
      }
    });
    const inspectRequirement = (requirement) => {
      const requirementBeatId = [
        "currentBeat",
        "currentBeatId",
        "beatId",
        "completedBeat",
        "beatCompleted",
        "beatNotCompleted",
      ].includes(requirement.type)
        ? requirement.beatId ?? requirement.id ?? requirement.value
        : requirement.beatId;
      if (typeof requirementBeatId === "string" && !beatIds.has(requirementBeatId)) {
        errors.push(`Card ${card.id} requirement references unknown beat ${requirementBeatId}.`);
      }
      if (["enemyDefeated", "specificEnemyDefeated"].includes(requirement.type)) {
        const enemyId = requirement.enemyId ?? requirement.id;
        if (knownEnemies.size > 0 && !knownEnemies.has(enemyId)) {
          errors.push(`Card ${card.id} requirement references unknown enemy ${enemyId}.`);
        }
      }
      if (["itemOwned", "equipmentSlot"].includes(requirement.type)) {
        const itemId = requirement.itemId ?? requirement.id;
        if (knownItems.size > 0 && itemId && !knownItems.has(itemId)) {
          errors.push(`Card ${card.id} requirement references unknown item ${itemId}.`);
        }
      }
      if (requirement.type === "endingSelected") {
        const endingId = requirement.endingId ?? requirement.id ?? requirement.value;
        if (endingId && !endingIds.has(endingId)) {
          errors.push(`Card ${card.id} requirement references unknown ending ${endingId}.`);
        }
      }
    };
    walkRequirements(card.requirements, inspectRequirement);
    walkRequirements(card.left?.requirements, inspectRequirement);
    walkRequirements(card.right?.requirements, inspectRequirement);
  }

  for (const beat of asList(arc?.beats)) {
    for (const field of ["bossEnemyId", "midbossEnemyId", "enemyId"]) {
      const enemyId = beat?.[field];
      if (knownEnemies.size > 0 && typeof enemyId === "string" && !knownEnemies.has(enemyId)) {
        errors.push(`Beat ${beat.id} references unknown enemy ${enemyId}.`);
      }
    }
    walkRequirements(beat.completionObjective ?? beat.objective, (requirement) => {
      if (["enemyDefeated", "specificEnemyDefeated"].includes(requirement.type)) {
        const enemyId = requirement.enemyId ?? requirement.id;
        if (knownEnemies.size > 0 && !knownEnemies.has(enemyId)) {
          errors.push(`Beat ${beat.id} objective references unknown enemy ${enemyId}.`);
        }
      }
      if (requirement.type === "endingSelected") {
        const endingId = requirement.endingId ?? requirement.id ?? requirement.value;
        if (endingId && !endingIds.has(endingId)) {
          errors.push(`Beat ${beat.id} objective references unknown ending ${endingId}.`);
        }
      }
    });
    for (const variant of asList(anchorFor(beat)?.variants)) {
      walkRequirements(variant.requirements, (requirement) => {
        if (requirement.type === "endingSelected") {
          const endingId = requirement.endingId ?? requirement.id ?? requirement.value;
          if (endingId && !endingIds.has(endingId)) {
            errors.push(`Anchor ${beat.id} references unknown ending ${endingId}.`);
          }
        }
      });
    }
  }

  for (const [field, enemyId] of [
    ["midbossId", arc?.midbossId],
    ["finalBossId", arc?.finalBossId ?? arc?.finalBossEnemyId],
  ]) {
    if (knownEnemies.size > 0 && typeof enemyId === "string" && !knownEnemies.has(enemyId)) {
      errors.push(`Arc ${field} references unknown enemy ${enemyId}.`);
    }
  }
}

export function collectArcValidationErrors(arc, cards, options = {}) {
  const errors = [];
  if (!arc || typeof arc !== "object" || Array.isArray(arc)) return ["Arc must be an object."];
  if (typeof arc.id !== "string" || arc.id.length === 0) errors.push("Arc ID is required.");
  const beats = asList(arc.beats);
  const cardList = asList(cards);

  const siblingArcs = asList(options.arcs);
  const matchingArcCount = siblingArcs.filter(({ id }) => id === arc.id).length;
  if (matchingArcCount > 1) errors.push(`Duplicate arc ID: ${arc.id}`);
  for (const duplicate of duplicateIds(beats)) errors.push(`Duplicate beat ID: ${duplicate}`);
  for (const duplicate of duplicateIds(cardList)) errors.push(`Duplicate card ID: ${duplicate}`);
  for (const duplicate of duplicateIds(arc.endings)) errors.push(`Duplicate ending ID: ${duplicate}`);

  if (beats.length !== STORY_BEATS.length) {
    errors.push(`Arc must define exactly ${STORY_BEATS.length} beats; found ${beats.length}.`);
  }
  STORY_BEATS.forEach((expected, index) => {
    const actual = beats[index];
    if (!actual) {
      errors.push(`Missing beat ${expected.id} at position ${index + 1}.`);
      return;
    }
    if (actual.id !== expected.id) {
      errors.push(`Beat ${index + 1} must be ${expected.id}; found ${String(actual.id)}.`);
    }
    if (actual.name !== expected.name) {
      errors.push(`Beat ${expected.id} must display the exact name “${expected.name}”.`);
    }
    if (actual.act !== expected.act) {
      errors.push(`Beat ${expected.id} must belong to ${expected.act}.`);
    }

    const budget = normalizeBeatBudget(actual);
    const expectedBudget = DEFAULT_BEAT_BUDGETS[expected.id];
    for (const key of ["minimum", "target", "maximum"]) {
      if (budget[key] !== expectedBudget[key]) {
        errors.push(
          `Beat ${actual.id} ${key} budget must equal ${expectedBudget[key]}; found ${budget[key]}.`,
        );
      }
    }
    if (budget.minimum > budget.target) {
      errors.push(`Beat ${actual.id} has minimum greater than target.`);
    }
    if (budget.target > budget.maximum) {
      errors.push(`Beat ${actual.id} has target greater than maximum.`);
    }
    for (const key of ["minimum", "target", "maximum"]) {
      if (!Number.isInteger(budget[key]) || budget[key] < 0) {
        errors.push(`Beat ${actual.id} ${key} budget must be a non-negative integer.`);
      }
    }

    const anchor = anchorFor(actual);
    const major = MAJOR_ANCHOR_BEAT_IDS.includes(actual.id);
    if (major && !anchor) errors.push(`Major beat ${actual.id} must define an anchor family.`);
    if (!major && anchor) errors.push(`Non-major beat ${actual.id} must not define a mandatory anchor.`);
    if (anchor) {
      const fallbackCardId = anchor.fallbackCardId ?? anchor.fallback?.cardId;
      if (typeof fallbackCardId !== "string") {
        errors.push(`Anchor family ${actual.id} must define an unconditional fallbackCardId.`);
      }
      if (!Array.isArray(anchor.variants)) {
        errors.push(`Anchor family ${actual.id} must define a variants array.`);
      }
      for (const variant of asList(anchor.variants)) {
        if (!Number.isFinite(Number(variant?.weight ?? 1)) || Number(variant?.weight ?? 1) <= 0) {
          errors.push(`Anchor variant ${variant?.cardId ?? "unknown"} has a non-positive weight.`);
        }
      }
    } else if (
      !actual.completionObjective &&
      !actual.objective
    ) {
      errors.push(`Beat ${actual.id} must define a completion objective.`);
    }

    const policyMode = actual.encounterPolicy?.mode;
    if (policyMode && !ENCOUNTER_POLICY_MODES.includes(policyMode)) {
      errors.push(`Beat ${actual.id} has invalid encounter policy mode ${policyMode}.`);
    }
  });

  const totals = getStoryBudgetTotals(arc);
  for (const key of ["minimum", "target", "maximum"]) {
    if (totals[key] !== EXPECTED_STORY_BUDGET_TOTALS[key]) {
      errors.push(
        `Story ${key} budget total must equal ${EXPECTED_STORY_BUDGET_TOTALS[key]}; found ${totals[key]}.`,
      );
    }
  }

  const anchorReferences = new Map();
  const cardById = new Map(cardList.map((card) => [card?.id, card]));
  for (const beat of beats) {
    for (const cardId of anchorCardIds(beat)) anchorReferences.set(cardId, beat.id);
    if (!anchorFor(beat) && !cardList.some((card) => isCompletionCandidate(card, beat))) {
      errors.push(`Beat ${beat.id} has no possible completion-card candidate.`);
    }
    const fallbackId = anchorFor(beat)?.fallbackCardId ?? anchorFor(beat)?.fallback?.cardId;
    const fallbackCard = cardById.get(fallbackId);
    if (fallbackCard && asList(fallbackCard.requirements).length > 0) {
      errors.push(`Anchor fallback ${fallbackId} must be unconditional.`);
    }
  }

  for (const card of cardList) {
    if (!card?.story) continue;
    if (!STORY_CARD_ROLES.includes(card.story.role)) {
      errors.push(`Story card ${card.id} has invalid role ${String(card.story.role)}.`);
    }
    if (typeof card.story.countsTowardStory !== "boolean") {
      errors.push(`Story card ${card.id} must explicitly declare countsTowardStory.`);
    }
    for (const [beatId, weight] of Object.entries(card.story.beatWeights ?? {})) {
      if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) {
        errors.push(`Story card ${card.id} has a non-positive weight for ${beatId}.`);
      }
    }
    if (anchorReferences.has(card.id)) {
      const permittedRole = anchorReferences.get(card.id) === "finalImage" ? ["anchor", "ending"] : ["anchor"];
      if (!permittedRole.includes(card.story.role)) {
        errors.push(`Anchor card ${card.id} is included as ordinary ${card.story.role ?? "ambient"} content.`);
      }
    }
    if (card.story.role === "anchor" && !anchorReferences.has(card.id)) {
      errors.push(`Anchor card ${card.id} is not referenced by an anchor family.`);
    }
    if (hasFunctionValue(card)) errors.push(`Story card ${card.id} contains a function callback.`);
    if (hasAbstractScoreReference(card)) {
      errors.push(`Story card ${card.id} references an abstract morality or alignment score.`);
    }
    walkEffects(card, (effect) => {
      if (effect?.type === "advanceBeat") {
        errors.push(`Story card ${card.id} attempts to advance the beat directly.`);
      }
    });
  }

  const finale = beats.find(({ id }) => id === "finale");
  const finaleBossId =
    finale?.bossEnemyId ??
    finale?.boss?.enemyId ??
    arc.finalBossEnemyId ??
    arc.finalBossId ??
    arc.finale?.bossEnemyId;
  if (typeof finaleBossId !== "string") errors.push("Finale definition must identify its final boss.");

  const endingIds = idsFrom(arc.endings);
  const finalImage = beats.find(({ id }) => id === "finalImage");
  const endingVariantIds = new Set([
    ...asList(arc.endings).flatMap((ending) => [
      ending?.finalImageCardId,
      ...asList(ending?.finalImageCardIds),
    ]),
    ...Object.keys(finalImage?.endingVariants ?? {}),
  ].filter(Boolean));
  if (endingIds.size === 0 || endingVariantIds.size === 0) {
    errors.push("Final Image must define ending-specific variants.");
  }
  for (const endingId of endingIds) {
    const ending = asList(arc.endings).find(({ id }) => id === endingId);
    const hasVariant =
      Boolean(ending?.finalImageCardId) ||
      asList(ending?.finalImageCardIds).length > 0 ||
      hasOwn(finalImage?.endingVariants, endingId);
    if (!hasVariant) errors.push(`Ending ${endingId} has no Final Image variant.`);
  }

  if (options.enforceContentCount === true && (cardList.length < 45 || cardList.length > 60)) {
    errors.push(`Authored story card count must be between 45 and 60; found ${cardList.length}.`);
  }
  if (hasFunctionValue(arc)) errors.push("Arc definition contains a function callback.");
  if (hasAbstractScoreReference(arc)) {
    errors.push("Arc definition references an abstract morality or alignment score.");
  }
  collectRegistryErrors(arc, cardList, options, errors);
  return [...new Set(errors)];
}

export function validateArcDefinition(arc, cards, options = {}) {
  const errors = collectArcValidationErrors(arc, cards, options);
  if (errors.length > 0) {
    if (options.throwOnError === false) {
      return { valid: false, errors, arcId: arc?.id ?? null };
    }
    throw new ArcValidationError(errors);
  }
  return {
    valid: true,
    errors: [],
    arcId: arc.id,
    totals: getStoryBudgetTotals(arc),
    cardCount: asList(cards).length,
  };
}

export function validateArcDefinitions(arcs, cardsByArc = {}, options = {}) {
  const arcList = asList(arcs);
  const duplicates = duplicateIds(arcList);
  if (duplicates.length > 0) {
    throw new ArcValidationError(duplicates.map((id) => `Duplicate arc ID: ${id}`));
  }
  return arcList.map((arc) =>
    validateArcDefinition(
      arc,
      cardsByArc instanceof Map ? cardsByArc.get(arc.id) : cardsByArc[arc.id] ?? options.cards,
      { ...options, arcs: arcList },
    ),
  );
}
