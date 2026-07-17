import {
  ENCOUNTER_POLICY_MODES,
  STORY_CARD_ROLES,
} from "./constants.js";
import { getStoryBudgetTotals } from "./beat-progress.js";

const asList = (value) => (Array.isArray(value) ? value : []);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const isNonemptyString = (value) => typeof value === "string" && value.trim().length > 0;

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

function duplicateNames(entries, key = "name") {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of asList(entries)) {
    const name = entry?.[key];
    if (!isNonemptyString(name)) continue;
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return [...duplicates];
}

function declaredBeatBudget(beat) {
  const source = beat?.budget;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  return {
    minimum: hasOwn(source, "minimum") ? source.minimum : source.min,
    target: source.target,
    maximum: hasOwn(source, "maximum") ? source.maximum : source.max,
  };
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

const ENDING_CARD_ID_FIELDS = Object.freeze([
  "cardId",
  "endingCardId",
  "terminalCardId",
  "finalImageCardId",
]);
const ENDING_CARD_IDS_FIELDS = Object.freeze([
  "cardIds",
  "endingCardIds",
  "terminalCardIds",
  "finalImageCardIds",
]);

function terminalCardIdsFrom(value) {
  if (isNonemptyString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(terminalCardIdsFrom);
  if (!value || typeof value !== "object") return [];
  return [
    ...ENDING_CARD_ID_FIELDS.flatMap((field) =>
      isNonemptyString(value[field]) ? [value[field]] : []
    ),
    ...ENDING_CARD_IDS_FIELDS.flatMap((field) =>
      asList(value[field]).filter(isNonemptyString)
    ),
  ];
}

function endingVariantEntries(arc) {
  return asList(arc?.beats).flatMap((beat) =>
    Object.entries(
      beat?.endingVariants &&
      typeof beat.endingVariants === "object" &&
      !Array.isArray(beat.endingVariants)
        ? beat.endingVariants
        : {},
    ).map(([endingId, value]) => ({ beatId: beat?.id, endingId, value }))
  );
}

function terminalCardIdsForEnding(arc, ending) {
  return [
    ...terminalCardIdsFrom(ending),
    ...endingVariantEntries(arc)
      .filter(({ endingId }) => endingId === ending?.id)
      .flatMap(({ value }) => terminalCardIdsFrom(value)),
  ];
}

function terminalCardIdsForArc(arc) {
  return [
    ...asList(arc?.endings).flatMap((ending) => terminalCardIdsForEnding(arc, ending)),
    ...asList(arc?.beats).flatMap((beat) =>
      terminalCardIdsFrom({
        terminalCardId: beat?.terminalCardId,
        terminalCardIds: beat?.terminalCardIds,
      })
    ),
  ];
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
      "terminalCardIds",
    ]) {
      references.push(...asList(beat?.[field]));
    }
    for (const field of [
      "entryCardId",
      "completionCardId",
      "aftermathCardId",
      "terminalCardId",
    ]) {
      if (typeof beat?.[field] === "string") references.push(beat[field]);
    }
  }
  for (const ending of asList(arc?.endings)) {
    references.push(...terminalCardIdsFrom(ending));
  }
  for (const { value } of endingVariantEntries(arc)) {
    references.push(...terminalCardIdsFrom(value));
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

function hasRequirementType(value, type) {
  let found = false;
  walkRequirements(value, (requirement) => {
    if (requirement.type === type) found = true;
  });
  return found;
}

function enemyIdsFromRequirements(value) {
  const enemyIds = [];
  walkRequirements(value, (requirement) => {
    if (["enemyDefeated", "specificEnemyDefeated"].includes(requirement.type)) {
      const enemyId = requirement.enemyId ?? requirement.id;
      if (isNonemptyString(enemyId)) enemyIds.push(enemyId);
    }
  });
  return [...new Set(enemyIds)];
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

  for (const beatId of asList(arc?.transitionBeatIds)) {
    if (!beatIds.has(beatId)) errors.push(`Arc transition references unknown beat ${beatId}.`);
  }
  for (const sequence of asList(arc?.forcedSequences)) {
    if (isNonemptyString(sequence?.beatId) && !beatIds.has(sequence.beatId)) {
      errors.push(
        `Forced sequence ${sequence?.id ?? "unknown"} references unknown beat ${sequence.beatId}.`,
      );
    }
  }
  for (const { beatId, endingId } of endingVariantEntries(arc)) {
    if (!endingIds.has(endingId)) {
      errors.push(`Beat ${beatId} defines a terminal variant for unknown ending ${endingId}.`);
    }
  }
  const terminalBeatId = arc?.terminalBeatId ?? arc?.endingBeatId;
  if (terminalBeatId !== undefined && !beatIds.has(terminalBeatId)) {
    errors.push(`Arc terminal beat references unknown beat ${String(terminalBeatId)}.`);
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
    for (const [field, enemyId] of [
      ["bossEnemyId", beat?.bossEnemyId ?? beat?.boss?.enemyId],
      ["midbossEnemyId", beat?.midbossEnemyId],
      ["enemyId", beat?.enemyId],
    ]) {
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
  if (!isNonemptyString(arc.id)) errors.push("Arc ID is required.");
  const beats = asList(arc.beats);
  const beatObjects = beats.filter(
    (beat) => beat && typeof beat === "object" && !Array.isArray(beat),
  );
  const cardList = asList(cards);

  const siblingArcs = asList(options.arcs);
  const matchingArcCount = siblingArcs.filter(({ id }) => id === arc.id).length;
  if (matchingArcCount > 1) errors.push(`Duplicate arc ID: ${arc.id}`);
  for (const duplicate of duplicateIds(beats)) errors.push(`Duplicate beat ID: ${duplicate}`);
  for (const duplicate of duplicateNames(beats)) errors.push(`Duplicate beat name: ${duplicate}`);
  for (const duplicate of duplicateIds(cardList)) errors.push(`Duplicate card ID: ${duplicate}`);
  for (const duplicate of duplicateIds(arc.endings)) errors.push(`Duplicate ending ID: ${duplicate}`);
  for (const duplicate of duplicateNames(arc.endings, "title")) {
    errors.push(`Duplicate ending title: ${duplicate}`);
  }
  for (const duplicate of duplicateIds(arc.forcedSequences)) {
    errors.push(`Duplicate forced sequence ID: ${duplicate}`);
  }

  if (!Array.isArray(arc.beats) || beats.length === 0) {
    errors.push("Arc must define at least one ordered beat.");
  }
  beats.forEach((beat, index) => {
    const position = index + 1;
    if (!beat || typeof beat !== "object" || Array.isArray(beat)) {
      errors.push(`Beat ${position} must be an object.`);
      return;
    }
    if (!isNonemptyString(beat.id)) {
      errors.push(`Beat ${position} must define a non-empty ID.`);
    }
    if (!isNonemptyString(beat.name)) {
      errors.push(`Beat ${beat.id ?? position} must define a non-empty name.`);
    }
    if (hasOwn(beat, "act") && !isNonemptyString(beat.act)) {
      errors.push(`Beat ${beat.id ?? position} act must be a non-empty string when provided.`);
    }

    const budget = declaredBeatBudget(beat);
    if (!budget) {
      errors.push(`Beat ${beat.id ?? position} must define a budget object.`);
    }
    for (const key of ["minimum", "target", "maximum"]) {
      if (!Number.isInteger(budget?.[key]) || budget[key] < 0) {
        errors.push(`Beat ${beat.id ?? position} ${key} budget must be a non-negative integer.`);
      }
    }
    if (
      Number.isInteger(budget?.minimum) &&
      Number.isInteger(budget?.target) &&
      budget.minimum > budget.target
    ) {
      errors.push(`Beat ${beat.id ?? position} has minimum greater than target.`);
    }
    if (
      Number.isInteger(budget?.target) &&
      Number.isInteger(budget?.maximum) &&
      budget.target > budget.maximum
    ) {
      errors.push(`Beat ${beat.id ?? position} has target greater than maximum.`);
    }

    const anchor = anchorFor(beat);
    if (anchor) {
      const fallbackCardId = anchor.fallbackCardId ?? anchor.fallback?.cardId;
      if (!isNonemptyString(fallbackCardId)) {
        errors.push(`Anchor family ${beat.id} must define an unconditional fallbackCardId.`);
      }
      if (!Array.isArray(anchor.variants)) {
        errors.push(`Anchor family ${beat.id} must define a variants array.`);
      }
      for (const variant of asList(anchor.variants)) {
        if (!isNonemptyString(variant?.cardId)) {
          errors.push(`Anchor family ${beat.id} has a variant without a cardId.`);
        }
        if (!Number.isFinite(Number(variant?.weight ?? 1)) || Number(variant?.weight ?? 1) <= 0) {
          errors.push(`Anchor variant ${variant?.cardId ?? "unknown"} has a non-positive weight.`);
        }
      }
    } else if (!beat.completionObjective && !beat.objective) {
      errors.push(`Beat ${beat.id} must define a completion objective.`);
    }

    const policyMode = beat.encounterPolicy?.mode;
    if (policyMode && !ENCOUNTER_POLICY_MODES.includes(policyMode)) {
      errors.push(`Beat ${beat.id} has invalid encounter policy mode ${policyMode}.`);
    }
  });

  if (hasOwn(arc, "beatIds")) {
    if (!Array.isArray(arc.beatIds)) {
      errors.push("Arc beatIds must be an array when provided.");
    } else if (
      arc.beatIds.length !== beats.length ||
      arc.beatIds.some((beatId, index) => beatId !== beats[index]?.id)
    ) {
      errors.push("Arc beatIds must match the ordered beats exactly.");
    }
  }
  if (
    hasOwn(arc, "terminalBeatId") &&
    hasOwn(arc, "endingBeatId") &&
    arc.terminalBeatId !== arc.endingBeatId
  ) {
    errors.push("Arc terminalBeatId and endingBeatId must identify the same beat.");
  }

  const anchorReferences = new Map();
  const cardById = new Map(cardList.map((card) => [card?.id, card]));
  const terminalCardIds = new Set(terminalCardIdsForArc(arc));
  const terminalBeatId = arc.terminalBeatId ?? arc.endingBeatId;
  for (const beat of beatObjects) {
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
    if (!isNonemptyString(card?.id)) {
      errors.push("Every story card must define a non-empty ID.");
    }
    if (anchorReferences.has(card?.id) && !card?.story) {
      errors.push(`Anchor card ${card.id} must define story metadata.`);
    }
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
      const permittedRole = terminalCardIds.has(card.id) ? ["anchor", "ending"] : ["anchor"];
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

  if (isNonemptyString(terminalBeatId)) {
    for (const cardId of terminalCardIds) {
      const card = cardById.get(cardId);
      if (card && !beatHasCard(card, terminalBeatId)) {
        errors.push(`Terminal card ${cardId} does not belong to beat ${terminalBeatId}.`);
      }
    }
  }

  const bossOnlyBeats = beatObjects.filter(
    ({ encounterPolicy }) => encounterPolicy?.mode === "boss-only",
  );
  for (const beat of bossOnlyBeats) {
    const objectiveBossIds = enemyIdsFromRequirements(
      beat?.completionObjective ?? beat?.objective,
    );
    const bossId =
      beat?.bossEnemyId ??
      beat?.boss?.enemyId ??
      (objectiveBossIds.length === 1 ? objectiveBossIds[0] : null) ??
      (bossOnlyBeats.length === 1 ? arc.finalBossEnemyId ?? arc.finalBossId : null);
    if (!isNonemptyString(bossId)) {
      errors.push(`Boss-only beat ${beat.id} must identify its boss.`);
    }
  }

  if (hasOwn(arc, "endings") && !Array.isArray(arc.endings)) {
    errors.push("Arc endings must be an array when provided.");
  }
  const endings = asList(arc.endings);
  endings.forEach((ending, index) => {
    if (!isNonemptyString(ending?.id)) {
      errors.push(`Ending ${index + 1} must define a non-empty ID.`);
    }
    if (!isNonemptyString(ending?.title)) {
      errors.push(`Ending ${ending?.id ?? index + 1} must define a non-empty title.`);
    }
  });

  const endingSelectionRequired =
    beatObjects.some((beat) =>
      hasRequirementType(beat?.completionObjective ?? beat?.objective, "endingSelected") ||
      asList(anchorFor(beat)?.variants).some((variant) =>
        hasRequirementType(variant?.requirements, "endingSelected")
      )
    ) ||
    cardList.some((card) =>
      [card?.requirements, card?.left?.requirements, card?.right?.requirements].some(
        (requirements) => hasRequirementType(requirements, "endingSelected"),
      ) ||
      [card?.left, card?.right].some((choice) =>
        asList(choice?.effects).some((effect) =>
          ["selectEnding", "selectFinalEnding"].includes(effect?.type)
        )
      )
    );
  if (endingSelectionRequired && endings.length === 0) {
    errors.push("Arc content selects an ending but the arc defines no endings.");
  }

  if (endings.length > 0 || endingVariantEntries(arc).length > 0) {
    for (const ending of endings) {
      if (terminalCardIdsForEnding(arc, ending).length === 0) {
        errors.push(`Ending ${ending.id} has no terminal card variant.`);
      }
    }
  }
  for (const cardId of terminalCardIds) {
    const card = cardById.get(cardId);
    if (card && card?.story?.role !== "ending") {
      errors.push(`Terminal card ${cardId} must use the ending story role.`);
    }
  }

  const contentCountRange =
    options.contentCountRange ??
    arc.contentCountRange ??
    (options.enforceContentCount && typeof options.enforceContentCount === "object"
      ? options.enforceContentCount
      : null);
  if (contentCountRange) {
    const minimum = contentCountRange.minimum ?? contentCountRange.min;
    const maximum = contentCountRange.maximum ?? contentCountRange.max;
    if (!Number.isInteger(minimum) || minimum < 0) {
      errors.push("Story card-count minimum must be a non-negative integer.");
    }
    if (!Number.isInteger(maximum) || maximum < 0) {
      errors.push("Story card-count maximum must be a non-negative integer.");
    }
    if (Number.isInteger(minimum) && Number.isInteger(maximum) && minimum > maximum) {
      errors.push("Story card-count minimum must not exceed its maximum.");
    } else if (
      Number.isInteger(minimum) &&
      Number.isInteger(maximum) &&
      (cardList.length < minimum || cardList.length > maximum)
    ) {
      errors.push(
        `Authored story card count must be between ${minimum} and ${maximum}; found ${cardList.length}.`,
      );
    }
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
