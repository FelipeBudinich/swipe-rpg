import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../public/js/game/state.js";
import {
  cardHasAvailableChoice,
  choiceIsAvailable,
  evaluateRequirement,
  requirementsMet,
} from "../public/js/game/requirements.js";

const fixtureItems = [
  { id: "key-blade", type: "equipment", slot: "weapon", statModifiers: { maxHp: 10 } },
  { id: "potion", type: "consumable", slot: null, statModifiers: {} },
];

function richState() {
  const state = createInitialState({ seed: 1 });
  return {
    ...state,
    mode: "exploration",
    story: {
      ...state.story,
      currentBeatId: "funAndGames",
      currentBeatIndex: 7,
      cardsResolvedInBeat: 3,
      cardsResolvedByBeat: { setup: 4, funAndGames: 3 },
      totalWorldCardsResolved: 16,
      completedBeatIds: ["openingImage", "themeStated", "setup"],
      resolvedStoryTags: ["mountain-gate-located"],
      facts: { trustedSerin: true, shrinesRestored: 2 },
      selectedAnchorIdByBeat: { midpoint: "midpoint-serins-counterseal" },
      resolvedAnchorIds: ["catalyst-core-theft"],
      endingId: "crown-of-dawn",
      endingTitle: "Crown of Dawn",
    },
    player: {
      ...state.player,
      level: 3,
      hp: 20,
      mp: 4,
      gold: 7,
      equipment: { ...state.player.equipment, weapon: "key-blade" },
      inventory: ["potion"],
    },
    run: {
      ...state.run,
      flags: { oath: "kept" },
      enemiesDefeated: { wisp: 2 },
      resolvedCardIds: ["old-card"],
    },
  };
}

test("central requirement evaluator supports resources, story state, ownership, and history gates", () => {
  const state = richState();
  const context = { items: fixtureItems };
  assert.equal(
    requirementsMet(
      [
        { type: "minLevel", value: 2 },
        { type: "maxLevel", value: 4 },
        { type: "minHpPercent", value: 0.49 },
        { type: "maxHpPercent", value: 0.51 },
        { type: "minMp", value: 4 },
        { type: "minGold", value: 7 },
        { type: "currentArcId", value: "ember-crown" },
        { type: "currentBeatId", value: "funAndGames" },
        { type: "completedBeat", beatId: "setup" },
        { type: "beatNotCompleted", beatId: "finale" },
        { type: "minimumCardsResolvedInBeat", value: 3 },
        { type: "minimumCardsResolvedInBeat", beatId: "setup", value: 4 },
        { type: "minimumTotalWorldCards", value: 16 },
        { type: "storyFactExists", key: "trustedSerin" },
        { type: "storyFactAbsent", key: "serinCaptured" },
        { type: "storyFactEquals", key: "trustedSerin", value: true },
        { type: "storyCounterMinimum", key: "shrinesRestored", value: 2 },
        { type: "storyTagResolved", tag: "mountain-gate-located" },
        { type: "anchorSelected", beatId: "midpoint", cardId: "midpoint-serins-counterseal" },
        { type: "anchorResolved", cardId: "catalyst-core-theft" },
        { type: "endingSelected", endingId: "crown-of-dawn" },
        { type: "flagEquals", flag: "oath", value: "kept" },
        { type: "flagAbsent", flag: "lost" },
        { type: "equipmentSlot", slot: "weapon", itemId: "key-blade" },
        { type: "itemOwned", itemId: "potion" },
        { type: "enemyDefeated", enemyId: "wisp" },
        { type: "cardNotResolved", cardId: "new-card" },
        { type: "mode", value: "exploration" },
      ],
      state,
      context,
    ),
    true,
  );
  assert.equal(evaluateRequirement({ type: "cardNotResolved", cardId: "old-card" }, state), false);
  assert.equal(evaluateRequirement({ type: "flagAbsent", flag: "oath" }, state), false);
  assert.equal(evaluateRequirement({ type: "currentBeatId", value: "finale" }, state), false);
  assert.equal(evaluateRequirement({ type: "storyFactAbsent", key: "trustedSerin" }, state), false);
  assert.equal(evaluateRequirement({ type: "anchorResolved", cardId: "not-resolved" }, state), false);
  assert.equal(evaluateRequirement({ type: "unknown-rule" }, state), false);
});

test("choice availability rejects unaffordable costs while retaining a valid alternative", () => {
  const state = { ...richState(), player: { ...richState().player, gold: 2, mp: 1 } };
  const costly = { effects: [{ type: "modifyGold", amount: -3 }] };
  const magic = { effects: [{ type: "modifyMp", amount: -2 }] };
  const safe = { effects: [{ type: "modifyHp", amount: -3 }] };
  assert.equal(choiceIsAvailable(costly, state), false);
  assert.equal(
    choiceIsAvailable({ effects: [{ type: "modifyGold", amount: -3, floor: 0 }] }, state),
    true,
  );
  assert.equal(choiceIsAvailable(magic, state), false);
  assert.equal(choiceIsAvailable(safe, state), true);
  assert.equal(cardHasAvailableChoice({ left: costly, right: safe }, state), true);
});

test("any/all/not compositions remain declarative", () => {
  const state = richState();
  assert.equal(
    evaluateRequirement(
      {
        type: "all",
        requirements: [
          { type: "any", requirements: [{ type: "minGold", value: 99 }, { type: "minMp", value: 2 }] },
          { type: "not", requirement: { type: "mode", value: "combat" } },
        ],
      },
      state,
    ),
    true,
  );
  assert.equal(
    evaluateRequirement({ type: "any", requirements: {} }, state),
    false,
  );
  assert.equal(requirementsMet(42, state), false);
  assert.doesNotThrow(() => choiceIsAvailable({ effects: [null, "bad"] }, state));
});
