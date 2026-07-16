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
    journeyStep: 8,
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

test("central requirement evaluator supports numeric, range, flag, ownership, and history gates", () => {
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
        { type: "journeyStep", min: 5, max: 10 },
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
