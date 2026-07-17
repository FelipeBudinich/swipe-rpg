import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { diffHud } from "../public/js/ui/feedback.js";
import {
  affectedResources,
  cardAnnouncement,
  choiceDetail,
  deriveCombatCardStatus,
  deriveRewardSummary,
  resolveArtSource,
} from "../public/js/ui/render.js";

test("malformed persisted choice metadata cannot crash resource previews", () => {
  const malformed = {
    label: "Continue",
    affectedResources: {},
    effects: [null, "bad"],
  };

  assert.doesNotThrow(() => affectedResources(malformed));
  assert.deepEqual(affectedResources(malformed), []);
  assert.doesNotThrow(() => choiceDetail(malformed));
});

test("resource detection and choice details remain available without a card-level summary", () => {
  const resources = affectedResources({
    preview: [
      { resource: "enemyHp", label: "7–10 damage" },
      { resource: "maxHp", delta: 6 },
      { resource: "maxMp", delta: 4 },
    ],
    effects: [
      { type: "modifyHp", amount: -3 },
      { type: "modifyMp", amount: -3 },
      { type: "addXp", amount: 8 },
      { type: "addGold", amount: 12 },
    ],
  });

  assert.deepEqual(new Set(resources), new Set(["enemyHp", "hp", "mp", "xp", "gold"]));
  assert.equal(choiceDetail({ effects: [{ type: "modifyMp", amount: -3 }] }), "-3 MP");
  assert.equal(choiceDetail({ effects: [{ type: "heal", amount: 6 }] }), "+6 HP");
  assert.equal(choiceDetail({ effects: [{ type: "addGold", amount: 8 }] }), "+8 gold");
  assert.equal(choiceDetail({ detail: "Sell · +12 gold" }), "Sell · +12 gold");
  assert.equal(choiceDetail({ detail: "Use now" }), "Use now");
  assert.equal(
    choiceDetail({ preview: [{ resource: "enemyHp", label: "7–10 damage" }] }),
    "7–10 damage",
  );
});

test("art sources resolve only through the bundled local allowlist", () => {
  const allowed = new Set(["player", "scene-road"]);
  assert.equal(resolveArtSource("scene-road", allowed), "/assets/art/scene-road.svg");
  assert.equal(resolveArtSource("../../server", allowed), "/assets/art/player.svg");
  assert.equal(resolveArtSource("https://example.com/tracker", allowed), "/assets/art/player.svg");
  assert.equal(resolveArtSource("unknown-art", allowed), "/assets/art/player.svg");
});

test("combat-card status derives the enemy name and a text-equivalent HP meter", () => {
  const card = {
    id: "combat:ash-wolf:2",
    category: "combat",
    speaker: "Ash Wolf",
    title: "Attack",
    text: "A direct attack is coming.",
    left: { label: "Guard" },
    right: { label: "Strike" },
  };
  const state = {
    mode: "combat",
    encounter: { enemyId: "ash-wolf", hp: 8, maxHp: 20 },
  };

  assert.deepEqual(deriveCombatCardStatus(state, card, {}), {
    visible: true,
    enemyName: "Ash Wolf",
    hp: 8,
    maxHp: 20,
    progressLabel: "Ash Wolf HP: 8 of 20",
  });
  assert.equal(deriveCombatCardStatus({ ...state, mode: "combatReward" }, card, {}).visible, false);
  assert.equal(deriveCombatCardStatus(state, { ...card, category: "story" }, {}).visible, false);

  const announcement = cardAnnouncement(card, {
    combatStatus: deriveCombatCardStatus(state, card, {}),
  });
  for (const text of [
    "Ash Wolf",
    "8 of 20 HP",
    "Attack",
    "A direct attack is coming.",
    "Left: Guard",
    "Right: Strike",
  ]) {
    assert.match(announcement, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("battle-reward summary always shows XP and conditionally shows gold and item metadata", () => {
  const noSpoils = deriveRewardSummary({
    category: "combatReward",
    reward: { xpAwarded: 0, goldAwarded: 0, itemId: null },
  });
  assert.deepEqual(noSpoils.rows, [
    { key: "xp", label: "Experience", value: "+0 XP", detail: "" },
  ]);

  const withItem = deriveRewardSummary({
    category: "combatReward",
    reward: { xpAwarded: 18, goldAwarded: 7, itemId: "iron-fang" },
  }, {
    "iron-fang": { id: "iron-fang", name: "Iron Fang", rarity: "uncommon" },
  });
  assert.deepEqual(withItem.rows, [
    { key: "xp", label: "Experience", value: "+18 XP", detail: "" },
    { key: "gold", label: "Gold", value: "+7", detail: "" },
    { key: "item", label: "Item", value: "Iron Fang", detail: "Uncommon" },
  ]);
  assert.match(withItem.announcement, /Experience: \+18 XP/);
  assert.match(withItem.announcement, /Gold: \+7/);
  assert.match(withItem.announcement, /Item: Iron Fang\. Uncommon/);

  const unavailable = deriveRewardSummary({
    category: "combatReward",
    reward: { xpAwarded: 5, goldAwarded: 2, itemId: "removed-item" },
  }, {});
  assert.deepEqual(unavailable.rows.at(-1), {
    key: "item",
    label: "Item",
    value: "Item unavailable",
    detail: "Reward data unavailable",
  });
  assert.equal(deriveRewardSummary({ category: "story" }).visible, false);
});

test("battle-reward announcement includes structured rows and item-aware actions", () => {
  const card = {
    category: "combatReward",
    speaker: "Ash Wolf defeated",
    title: "Battle Rewards",
    text: "The spoils of battle are yours.",
    reward: { xpAwarded: 12, goldAwarded: 7, itemId: "iron-fang" },
    left: { label: "Sell · +9 gold" },
    right: { label: "Keep" },
  };
  const rewardSummary = deriveRewardSummary(card, {
    "iron-fang": { name: "Iron Fang", rarity: "uncommon" },
  });
  const announcement = cardAnnouncement(card, { rewardSummary });

  assert.match(announcement, /Experience: \+12 XP/);
  assert.match(announcement, /Gold: \+7/);
  assert.match(announcement, /Item: Iron Fang\. Uncommon/);
  assert.match(announcement, /Left: Sell · \+9 gold Iron Fang/);
  assert.match(announcement, /Right: Keep Iron Fang/);
});

test("renderer source uses explicit preview targets and text-safe reward rendering", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  assert.match(source, /hp: elements\.hpHud/);
  assert.match(source, /mp: elements\.mpHud/);
  assert.match(source, /level: elements\.levelXpHud/);
  assert.match(source, /xp: elements\.levelXpHud/);
  assert.match(source, /gold: elements\.inventoryOpen/);
  assert.match(source, /enemyHp: elements\.combatStatus/);
  assert.match(source, /inventory: elements\.inventoryOpen/);
  assert.match(source, /target\.dataset\.previewed = "true"/);
  assert.doesNotMatch(source, /byId\(`hud-\$\{resource\}`\)/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML/);
  assert.match(source, /rewardSummary\.replaceChildren\(\)/);
  assert.match(source, /lastCardAnnouncementKey/);
  assert.match(source, /card\?\.resolutionToken/);
  assert.doesNotMatch(source, /choiceHelp|choice-help/);
  assert.doesNotMatch(
    source,
    /card-resource-preview|resourcePreview|cardResourceSummary|Choices may affect|Choices shape the story|changes the story ahead/,
  );

  const setChoiceStart = source.indexOf("const setChoice =");
  const renderCardStart = source.indexOf("const renderCard =", setChoiceStart);
  const renderHudStart = source.indexOf("const renderHud =", renderCardStart);
  const setChoiceSource = source.slice(setChoiceStart, renderCardStart);
  const renderCardSource = source.slice(renderCardStart, renderHudStart);
  assert.match(setChoiceSource, /const resources = affectedResources\(choice\)/);
  assert.match(setChoiceSource, /choiceDetail\(choice\)/);
  assert.match(setChoiceSource, /detail\.textContent = detailText/);
  assert.match(setChoiceSource, /button\.dataset\.affects = resources\.join\(" "\)/);
  assert.match(renderCardSource, /elements\.detail\.textContent = card\?\.detail \?\? card\?\.riskText \?\? ""/);

  const previewStart = source.indexOf("previewChoice(direction)");
  const previewEnd = source.indexOf("\n    },\n  };", previewStart);
  const previewSource = source.slice(previewStart, previewEnd);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.match(previewSource, /delete target\.dataset\.previewed/);
  assert.match(previewSource, /target\.dataset\.previewed = "true"/);
  assert.match(previewSource, /const affected = new Set\(affectedResources\(choice\)\)/);
  assert.doesNotMatch(previewSource, /textContent|choiceDetail|resourcePreview/);
});

test("renderer shows the action row only on interactive cards", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  const interactiveStart = source.indexOf("const setInteractiveSurface =");
  const specialStart = source.indexOf("const setSpecialSurface =", interactiveStart);
  const announceStart = source.indexOf("const announceSpecial =", specialStart);
  const interactiveSource = source.slice(interactiveStart, specialStart);
  const specialSource = source.slice(specialStart, announceStart);

  assert.ok(interactiveStart >= 0 && specialStart > interactiveStart && announceStart > specialStart);
  assert.match(interactiveSource, /elements\.choiceControls\.hidden\s*=\s*false/);
  assert.match(specialSource, /elements\.choiceControls\.hidden\s*=\s*true/);
  assert.match(source, /setSpecialSurface\("transition", `Story transition:/);
  assert.match(source, /setSpecialSurface\("terminal", presentation\.kind/);
  assert.match(source, /setInteractiveSurface\(\);\s*renderCard\(/);
  assert.doesNotMatch(interactiveSource, /choiceHelp|choice-help/);
  assert.doesNotMatch(specialSource, /choiceHelp|choice-help/);
});

test("HUD renderer updates every preserved value, meter, and accessible label", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  assert.match(source, /storyHeading: byId\("story-heading"\)/);
  const start = source.indexOf("const renderHud =");
  const end = source.indexOf("const setInteractiveSurface", start);
  assert.ok(start >= 0 && end > start);
  const renderHud = source.slice(start, end);

  for (const binding of ["level", "xp", "hp", "mp"]) {
    assert.match(renderHud, new RegExp(`elements\\.${binding}\\.textContent\\s*=`));
  }
  for (const meter of ["xpBar", "hpBar", "mpBar"]) {
    assert.match(renderHud, new RegExp(`setBar\\(elements\\.${meter},`));
  }
  assert.match(renderHud, /elements\.levelXpHud\.setAttribute\("aria-label", `Level \$\{state\.player\.level\}\. Experience/);
  assert.match(renderHud, /elements\.hpHud\.setAttribute\("aria-label", `Health/);
  assert.match(renderHud, /elements\.mpHud\.setAttribute\("aria-label", `Magic points/);
  assert.match(renderHud, /elements\.xpBar\.setAttribute\("aria-label", `Experience:/);
  assert.match(renderHud, /elements\.hpBar\.setAttribute\("aria-label", `Health:/);
  assert.match(renderHud, /elements\.mpBar\.setAttribute\("aria-label", `Magic points:/);
  assert.match(renderHud, /elements\.arcTitle\.textContent\s*=\s*storyHud\.arcTitle/);
  assert.match(renderHud, /elements\.beatName\.textContent\s*=\s*storyHud\.beatName/);
  assert.match(
    renderHud,
    /elements\.storyHeading\.setAttribute\(\s*"aria-label",\s*`\$\{storyHud\.arcTitle\} - \$\{storyHud\.beatName\}`,\s*\)/,
  );
  assert.match(renderHud, /elements\.storyProgress\.setAttribute\("aria-label", storyHud\.progressLabel\)/);

  const setBarStart = source.indexOf("function setBar(");
  const setBarEnd = source.indexOf("function lookupById", setBarStart);
  const setBarSource = source.slice(setBarStart, setBarEnd);
  assert.match(setBarSource, /element\.value\s*=/);
  assert.match(setBarSource, /element\.max\s*=/);
  assert.match(setBarSource, /element\.textContent\s*=/);
  assert.match(setBarSource, /"aria-valuenow"/);
  assert.match(setBarSource, /"aria-valuemax"/);
});

test("HUD diffs retain a level-only signal when experience wraps to zero", () => {
  const before = { level: 1, hp: 30, mp: 10, xp: 0, gold: 10 };
  const after = { level: 2, hp: 30, mp: 10, xp: 0, gold: 10 };
  assert.deepEqual(diffHud(before, after), {
    hp: 0,
    mp: 0,
    xp: 0,
    gold: 0,
    level: 1,
  });
});
