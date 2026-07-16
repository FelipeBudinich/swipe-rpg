import test from "node:test";
import assert from "node:assert/strict";

import {
  equipItem,
  getDerivedStats,
  getItemStatDifference,
  unequipItem,
} from "../public/js/game/equipment.js";
import { createInitialState } from "../public/js/game/state.js";

const definitions = [
  {
    id: "great-sword",
    type: "equipment",
    slot: "weapon",
    statModifiers: { attack: 4, maxHp: 5 },
  },
  {
    id: "sage-wand",
    type: "equipment",
    slot: "weapon",
    statModifiers: { attack: 1, maxMp: 6 },
  },
  {
    id: "plate",
    type: "equipment",
    slot: "armor",
    statModifiers: { defense: 3, maxHp: 10 },
  },
];

test("derived equipment stats are pure and never written into base stats", () => {
  let state = createInitialState({ seed: 30 });
  state = {
    ...state,
    player: {
      ...state.player,
      equipment: { weapon: "great-sword", armor: "plate", charm: null },
    },
  };
  assert.deepEqual(getDerivedStats(state, definitions), {
    attack: 9,
    defense: 5,
    maxHp: 45,
    maxMp: 10,
  });
  assert.deepEqual(state.player.baseStats, { attack: 5, defense: 2, maxHp: 30, maxMp: 10 });
});
test("equipping removes the item and returns the replaced item to inventory", () => {
  let state = createInitialState({ seed: 31 });
  state = {
    ...state,
    player: {
      ...state.player,
      inventory: ["sage-wand"],
      equipment: { ...state.player.equipment, weapon: "great-sword" },
    },
  };
  const next = equipItem(state, "sage-wand", definitions);
  assert.equal(next.player.equipment.weapon, "sage-wand");
  assert.deepEqual(next.player.inventory, ["great-sword"]);
  assert.deepEqual(state.player.inventory, ["sage-wand"]);
  assert.deepEqual(getItemStatDifference(state, "sage-wand", definitions), {
    attack: -3,
    defense: 0,
    maxHp: -5,
    maxMp: 6,
  });
});

test("maximum decreases clamp HP/MP, while maximum increases do not heal", () => {
  let state = createInitialState({ seed: 32 });
  state = {
    ...state,
    player: {
      ...state.player,
      hp: 35,
      mp: 15,
      inventory: ["sage-wand"],
      equipment: { ...state.player.equipment, weapon: "great-sword" },
    },
  };
  const replaced = equipItem(state, "sage-wand", definitions);
  assert.equal(replaced.player.hp, 30);
  assert.equal(replaced.player.mp, 15);

  const unequipped = unequipItem(replaced, "weapon", definitions);
  assert.equal(unequipped.player.mp, 10);

  const low = {
    ...createInitialState({ seed: 33 }),
    player: { ...createInitialState({ seed: 33 }).player, hp: 7, inventory: ["great-sword"] },
  };
  assert.equal(equipItem(low, "great-sword", definitions).player.hp, 7);
});
