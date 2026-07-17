import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { diffHud } from "../public/js/ui/feedback.js";
import {
  FEEDBACK_ART_BY_TONE,
  affectedResources,
  cardAnnouncement,
  choiceDetail,
  deriveChoiceFeedbackPresentation,
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

test("choice feedback presentation maps fixed tones to local art and signed resource rows", () => {
  assert.deepEqual(FEEDBACK_ART_BY_TONE, {
    neutral: "result-neutral",
    reward: "result-reward",
    recovery: "result-recovery",
    damage: "result-damage",
    danger: "result-danger",
  });

  const expectedTitles = {
    neutral: "Your Choice",
    reward: "Reward",
    recovery: "Recovery",
    damage: "The Cost",
    danger: "Consequence",
  };
  for (const [tone, artId] of Object.entries(FEEDBACK_ART_BY_TONE)) {
    const presentation = deriveChoiceFeedbackPresentation({
      id: `feedback:${tone}`,
      tone,
      resultText: "The road answers.",
      changes: {},
    });
    assert.equal(presentation.tone, tone);
    assert.equal(presentation.title, expectedTitles[tone]);
    assert.equal(presentation.artId, artId);
    assert.deepEqual(presentation.rows, []);
    assert.equal(presentation.announcement, `${expectedTitles[tone]}. The road answers. Continue.`);
  }

  const presentation = deriveChoiceFeedbackPresentation({
    id: "feedback:structured",
    tone: "damage",
    resultText: "The ward breaks",
    changes: {
      level: 1,
      xp: 8,
      hp: -4,
      mp: 2,
      gold: -5,
      attack: 1,
      defense: 1,
      maxHp: 6,
      maxMp: 3,
      inventory: 1,
      decisionCount: 99,
      malformed: Number.NaN,
    },
  });

  assert.deepEqual(
    presentation.rows.map(({ key, label, value, direction }) => ({ key, label, value, direction })),
    [
      { key: "level", label: "Level", value: "+1 Level", direction: "gain" },
      { key: "xp", label: "XP", value: "+8 XP", direction: "gain" },
      { key: "hp", label: "HP", value: "-4 HP", direction: "loss" },
      { key: "mp", label: "MP", value: "+2 MP", direction: "gain" },
      { key: "gold", label: "Gold", value: "-5 Gold", direction: "loss" },
      { key: "attack", label: "Attack", value: "+1 Attack", direction: "gain" },
      { key: "defense", label: "Defense", value: "+1 Defense", direction: "gain" },
      { key: "maxHp", label: "Max HP", value: "+6 Max HP", direction: "gain" },
      { key: "maxMp", label: "Max MP", value: "+3 Max MP", direction: "gain" },
      { key: "inventory", label: "Items", value: "+1 Item", direction: "gain" },
    ],
  );
  assert.match(presentation.announcement, /HP minus 4/);
  assert.match(presentation.announcement, /Item plus 1/);
  assert.equal(
    deriveChoiceFeedbackPresentation({
      id: "feedback:unknown-tone",
      tone: "injected-class",
      resultText: "Safe text",
      changes: { inventory: 2 },
    }).artId,
    "result-neutral",
  );
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
  assert.match(previewSource, /clearPreviewTargets\(\)/);
  assert.match(previewSource, /target\.dataset\.previewed = "true"/);
  assert.match(previewSource, /const affected = new Set\(affectedResources\(choice\)\)/);
  assert.doesNotMatch(previewSource, /textContent|choiceDetail|resourcePreview/);

  const clearStart = source.indexOf("const clearPreviewTargets =");
  const clearEnd = source.indexOf("const renderCombatCardStatus =", clearStart);
  const clearSource = source.slice(clearStart, clearEnd);
  assert.match(clearSource, /delete target\.dataset\.previewed/);
});

test("renderer switches between interactive, special, and feedback controls safely", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  const interactiveStart = source.indexOf("const setInteractiveSurface =");
  const specialStart = source.indexOf("const setSpecialSurface =", interactiveStart);
  const feedbackStart = source.indexOf("const setFeedbackSurface =", specialStart);
  const announceStart = source.indexOf("const announceSpecial =", feedbackStart);
  const interactiveSource = source.slice(interactiveStart, specialStart);
  const specialSource = source.slice(specialStart, feedbackStart);
  const feedbackSource = source.slice(feedbackStart, announceStart);

  assert.ok(
    interactiveStart >= 0 &&
      specialStart > interactiveStart &&
      feedbackStart > specialStart &&
      announceStart > feedbackStart,
  );
  assert.match(interactiveSource, /elements\.choiceControls\.hidden\s*=\s*false/);
  assert.match(interactiveSource, /elements\.choiceFeedbackControls\.hidden\s*=\s*true/);
  assert.match(interactiveSource, /elements\.card\.removeAttribute\("inert"\)/);
  assert.match(specialSource, /elements\.choiceControls\.hidden\s*=\s*true/);
  assert.match(specialSource, /elements\.choiceFeedbackControls\.hidden\s*=\s*true/);
  assert.match(feedbackSource, /elements\.card\.hidden\s*=\s*true/);
  assert.match(feedbackSource, /elements\.card\.setAttribute\("inert", ""\)/);
  assert.match(feedbackSource, /elements\.card\.tabIndex\s*=\s*-1/);
  assert.match(feedbackSource, /elements\.choiceControls\.hidden\s*=\s*true/);
  assert.match(feedbackSource, /elements\.choiceFeedbackCard\.hidden\s*=\s*false/);
  assert.match(feedbackSource, /elements\.choiceFeedbackControls\.hidden\s*=\s*false/);
  assert.match(feedbackSource, /elements\.leftButton\.disabled\s*=\s*true/);
  assert.match(feedbackSource, /elements\.rightButton\.disabled\s*=\s*true/);
  assert.match(feedbackSource, /elements\.inventoryOpen\.disabled\s*=\s*true/);
  assert.match(feedbackSource, /elements\.choiceFeedbackContinue\.disabled\s*=\s*false/);
  assert.match(feedbackSource, /clearPreviewTargets\(\)/);
  assert.match(source, /setSpecialSurface\("transition", `Story transition:/);
  assert.match(source, /setSpecialSurface\("terminal", presentation\.kind/);
  assert.match(source, /setInteractiveSurface\(\);\s*renderCard\(/);
  assert.doesNotMatch(interactiveSource, /choiceHelp|choice-help/);
  assert.doesNotMatch(specialSource, /choiceHelp|choice-help/);
});

test("renderer prioritizes terminal, transition, feedback, then the interactive card", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  const renderStart = source.indexOf("render(state, card,");
  const focusStart = source.indexOf("focusPrimarySurface()", renderStart);
  const renderSource = source.slice(renderStart, focusStart);
  const terminalIndex = renderSource.indexOf("const terminal =");
  const transitionIndex = renderSource.indexOf("const transition =");
  const feedbackIndex = renderSource.indexOf("const choiceFeedback =");
  const interactiveIndex = renderSource.indexOf("setInteractiveSurface()");

  assert.ok(terminalIndex >= 0);
  assert.ok(transitionIndex > terminalIndex);
  assert.ok(feedbackIndex > transitionIndex);
  assert.ok(interactiveIndex > feedbackIndex);
  assert.match(renderSource.slice(terminalIndex, transitionIndex), /renderTerminal\(terminal\);\s*return;/);
  assert.match(renderSource.slice(transitionIndex, feedbackIndex), /renderTransition\(transition\);\s*return;/);
  assert.match(
    renderSource.slice(feedbackIndex, interactiveIndex),
    /renderChoiceFeedback\(choiceFeedback\);\s*return;/,
  );
  assert.ok(renderSource.indexOf("renderCard(", interactiveIndex) > interactiveIndex);
});

test("feedback renderer builds semantic rows with text-safe DOM operations and fixed local art", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  for (const [binding, id] of Object.entries({
    choiceFeedbackCard: "choice-feedback-card",
    choiceFeedbackKicker: "choice-feedback-kicker",
    choiceFeedbackTitle: "choice-feedback-title",
    choiceFeedbackText: "choice-feedback-text",
    choiceFeedbackArt: "choice-feedback-art",
    choiceFeedbackChanges: "choice-feedback-changes",
    choiceFeedbackControls: "choice-feedback-controls",
    choiceFeedbackContinue: "choice-feedback-continue",
  })) {
    assert.match(source, new RegExp(`${binding}: byId\\("${id}"\\)`));
  }

  const renderStart = source.indexOf("const renderChoiceFeedback =");
  const renderEnd = source.indexOf("\n  return {", renderStart);
  const renderSource = source.slice(renderStart, renderEnd);
  assert.match(renderSource, /choiceFeedbackTitle\.textContent = presentation\.title/);
  assert.match(renderSource, /choiceFeedbackText\.textContent = presentation\.text/);
  assert.match(renderSource, /choiceFeedbackChanges\.replaceChildren\(\)/);
  assert.match(renderSource, /document\.createElement\("dt"\)/);
  assert.match(renderSource, /document\.createElement\("dd"\)/);
  assert.match(renderSource, /term\.textContent = row\.label/);
  assert.match(renderSource, /value\.textContent = row\.value/);
  assert.match(renderSource, /resolveArtSource\(\s*presentation\.artId,\s*allowedArtIds,\s*"result-neutral"/);
  assert.doesNotMatch(renderSource, /\.innerHTML\s*=|insertAdjacentHTML|src\s*=\s*presentation\.tone/);
});

test("focus follows transition, terminal, feedback Continue, then the normal card", async () => {
  const source = await readFile(new URL("../public/js/ui/render.js", import.meta.url), "utf8");
  const focusStart = source.indexOf("focusPrimarySurface()");
  const focusEnd = source.indexOf("renderInventory(", focusStart);
  const focusSource = source.slice(focusStart, focusEnd);

  const transitionIndex = focusSource.indexOf("elements.transitionContinue.focus()");
  const terminalIndex = focusSource.indexOf("elements.terminalRestart.focus()");
  const feedbackIndex = focusSource.indexOf("elements.choiceFeedbackContinue.focus()");
  const cardIndex = focusSource.indexOf("elements.card.focus()");
  assert.ok(transitionIndex >= 0);
  assert.ok(terminalIndex > transitionIndex);
  assert.ok(feedbackIndex > terminalIndex);
  assert.ok(cardIndex > feedbackIndex);
});

test("feedback Continue uses its narrow dismissal path and direction shortcuts stay blocked", async () => {
  const source = await readFile(new URL("../public/js/main.js", import.meta.url), "utf8");
  const dismissStart = source.indexOf("async function dismissCurrentChoiceFeedback()");
  const dismissEnd = source.indexOf("async function restartFromTerminal()", dismissStart);
  const dismissSource = source.slice(dismissStart, dismissEnd);
  assert.ok(dismissStart >= 0 && dismissEnd > dismissStart);
  assert.match(dismissSource, /state\.pendingChoiceFeedback/);
  assert.match(dismissSource, /feedbackDismissalActive/);
  assert.match(dismissSource, /confirm-dialog/);
  assert.match(dismissSource, /Engine\.dismissChoiceFeedback\(state, \{ expectedFeedbackId \}\)/);
  assert.match(dismissSource, /saveState\(state\)/);
  assert.match(dismissSource, /swipeController\.resetForNextCard\(\)/);
  assert.match(dismissSource, /prepareNextCard\(\)/);
  assert.match(dismissSource, /renderer\.focusPrimarySurface\(\)/);
  assert.doesNotMatch(dismissSource, /swipeController\.commit|commitNewChoice|decisionCount/);

  const keyStart = source.indexOf('document.addEventListener("keydown"');
  const keyEnd = source.indexOf('document.getElementById("inventory-content")', keyStart);
  const keySource = source.slice(keyStart, keyEnd);
  assert.match(keySource, /isNewInputBlocked\(\)/);
  assert.match(source, /feedbackActive: Boolean\(state\.pendingChoiceFeedback\)/);
  assert.doesNotMatch(keySource, /dismissCurrentChoiceFeedback/);
  assert.equal(
    (source.match(/choiceFeedbackContinue\.addEventListener\("click"/g) ?? []).length,
    1,
  );
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
