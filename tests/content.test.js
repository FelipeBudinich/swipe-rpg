import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { cards } from "../public/js/data/cards.js";
import { enemies } from "../public/js/data/enemies.js";
import { items } from "../public/js/data/items.js";
import { getEligibleCards, isEncounterCard } from "../public/js/game/selector.js";
import { createInitialState } from "../public/js/game/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function uniqueIds(definitions) {
  return new Set(definitions.map(({ id }) => id)).size === definitions.length;
}

function nestedTypes(definitions, key) {
  return new Set(
    definitions.flatMap((card) =>
      key === "requirements"
        ? [
            ...(card.requirements ?? []),
            ...(card.left?.requirements ?? []),
            ...(card.right?.requirements ?? []),
          ].map(({ type }) => type)
        : [...(card.left?.effects ?? []), ...(card.right?.effects ?? [])].map(({ type }) => type),
    ),
  );
}

function assertImmutableDataOnly(value, path = "content") {
  assert.notEqual(typeof value, "function", `${path} contains executable content`);
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
  for (const [key, nested] of Object.entries(value)) {
    assertImmutableDataOnly(nested, `${path}.${key}`);
  }
}

test("authored content meets the vertical-slice breadth and identity constraints", () => {
  assert.ok(cards.filter((card) => card.baseWeight > 0).length >= 30);
  assert.equal(enemies.filter((enemy) => !enemy.isBoss).length, 6);
  assert.equal(enemies.filter((enemy) => enemy.isBoss).length, 1);
  assert.ok(items.filter((item) => item.type === "equipment").length >= 12);
  assert.deepEqual(
    new Set(items.filter((item) => item.type === "equipment").map((item) => item.slot)),
    new Set(["weapon", "armor", "charm"]),
  );
  assert.ok(items.some((item) => item.useEffects?.some((effect) => effect.type === "heal")));
  assert.ok(items.some((item) => item.useEffects?.some((effect) => effect.type === "restoreMp")));
  assert.ok(items.some((item) => (item.useEffects?.length ?? 0) > 1));
  assert.ok(uniqueIds(cards));
  assert.ok(uniqueIds(enemies));
  assert.ok(uniqueIds(items));
});

test("content exercises every required declarative requirement and effect family", () => {
  const requirementTypes = nestedTypes(cards, "requirements");
  const effectTypes = nestedTypes(cards, "effects");

  for (const type of [
    "minLevel",
    "maxLevel",
    "minHpPercent",
    "maxHpPercent",
    "minMp",
    "minGold",
    "journeyStep",
    "flagEquals",
    "flagAbsent",
    "equipmentSlot",
    "itemOwned",
    "enemyDefeated",
    "cardNotResolved",
    "mode",
  ]) {
    assert.ok(requirementTypes.has(type), `missing requirement content: ${type}`);
  }

  for (const type of [
    "modifyHp",
    "modifyMp",
    "modifyGold",
    "addXp",
    "heal",
    "healPercent",
    "restoreMp",
    "setFlag",
    "clearFlag",
    "startEncounter",
    "addItem",
    "removeItem",
    "queueCard",
    "modifyJourneyStep",
    "recordDiscovery",
    "setRunStat",
  ]) {
    assert.ok(effectTypes.has(type), `missing effect content: ${type}`);
  }
});

test("content definitions are deeply immutable data with no callbacks", () => {
  assertImmutableDataOnly(cards, "cards");
  assertImmutableDataOnly(enemies, "enemies");
  assertImmutableDataOnly(items, "items");
});

test("every authored art reference resolves to a local SVG", () => {
  const artIds = new Set([
    "player",
    ...cards.map(({ artId }) => artId),
    ...enemies.map(({ artId }) => artId),
    ...items.map(({ artId }) => artId),
  ]);

  for (const artId of artIds) {
    assert.equal(typeof artId, "string");
    assert.ok(
      existsSync(join(root, "public", "assets", "art", `${artId}.svg`)),
      `missing local SVG: ${artId}`,
    );
  }
});

test("five peaceful cards still force an eligible encounter for a late level-one run", () => {
  const base = createInitialState({ seed: 2 });
  const state = {
    ...base,
    journeyStep: 18,
    decisionCount: 18,
    run: { ...base.run, turnsSinceEncounter: 5 },
  };
  const eligible = getEligibleCards(state, cards, { items });

  assert.ok(eligible.length > 0);
  assert.ok(eligible.every(isEncounterCard));
  assert.ok(eligible.some((card) => card.id === "encounter-prism-wisp"));
});
