import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEBUG_CHECKPOINTS,
  isDebugCheckpointUiEnabled,
} from "../public/js/ui/debug-checkpoint-ui.js";
import {
  deriveStoryHud,
  deriveTerminalPresentation,
  deriveTransitionPresentation,
  isStoryTransitionActive,
  STORY_BEAT_NAMES,
} from "../public/js/ui/story-transition.js";

const beatIds = [
  "openingImage",
  "themeStated",
  "setup",
  "catalyst",
  "debate",
  "breakIntoTwo",
  "bStory",
  "funAndGames",
  "midpoint",
  "badGuysCloseIn",
  "allIsLost",
  "darkNightOfTheSoul",
  "breakIntoThree",
  "finale",
  "finalImage",
];
const targets = [1, 1, 4, 1, 3, 1, 2, 6, 2, 5, 1, 2, 1, 4, 1];
const arc = {
  id: "ember-crown",
  title: "The Ember Crown",
  beats: beatIds.map((id, index) => ({
    id,
    name: STORY_BEAT_NAMES[index],
    budget: { target: targets[index] },
    ...(id === "midpoint"
      ? { interstitial: { subtitle: "The Iron Gate", text: "Steel wings bar the path to the Crown." } }
      : {}),
  })),
  endings: [
    { id: "crown-of-dawn", title: "Crown of Dawn" },
    { id: "unbound-flame", title: "The Unbound Flame" },
  ],
};
const arcById = { [arc.id]: arc };

function elementSourceById(source, id) {
  const idMatch = [...source.matchAll(/\bid=(["'])([^"']+)\1/g)]
    .find((match) => match[2] === id);
  assert.ok(idMatch, `Expected #${id} to exist`);
  const tagStart = source.lastIndexOf("<", idMatch.index);
  const tagMatch = /^<([a-z][\w-]*)\b/i.exec(source.slice(tagStart));
  assert.ok(tagMatch, `Expected #${id} to belong to an element`);
  const tagName = tagMatch[1];
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  let depth = 0;
  for (const match of source.slice(tagStart).matchAll(tagPattern)) {
    const tokenStart = tagStart + match.index;
    const token = match[0];
    if (token.startsWith("</")) depth -= 1;
    else if (!token.endsWith("/>")) depth += 1;
    if (depth === 0) return source.slice(tagStart, tokenStart + token.length);
  }
  assert.fail(`Expected #${id} to have a closing </${tagName}>`);
}

function cssBlock(source, marker) {
  const markerStart = source.indexOf(marker);
  assert.ok(markerStart >= 0, `Expected CSS marker ${marker}`);
  const braceStart = source.indexOf("{", markerStart);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(markerStart, index + 1);
  }
  assert.fail(`Expected CSS block ${marker} to close`);
}

function storyState(overrides = {}) {
  return {
    mode: "exploration",
    player: { level: 4, hp: 20, mp: 7, xp: 3, gold: 18 },
    run: { enemiesDefeated: { ashWolf: 2, sentinel: 1 }, itemsFound: 4 },
    story: {
      arcId: arc.id,
      status: "active",
      currentBeatId: "funAndGames",
      currentBeatIndex: 7,
      cardsResolvedInBeat: 3,
      totalWorldCardsResolved: 16,
      completedBeatIds: beatIds.slice(0, 7),
      pendingInterstitialBeatId: null,
      endingId: null,
      completed: false,
      ...overrides,
    },
  };
}

test("story HUD shows exact beat identity and target-weighted narrative progress in every mode", () => {
  const state = storyState();
  const exploration = deriveStoryHud(state, { arcById });
  const combat = deriveStoryHud({ ...state, mode: "combat" }, { arcById });

  assert.equal(exploration.beatNumber, 8);
  assert.equal(exploration.beatCount, 15);
  assert.equal(exploration.beatName, "Fun and Games");
  assert.equal(exploration.arcTitle, "The Ember Crown");
  assert.ok(Math.abs(exploration.progressPercent - (16 / 35) * 100) < 0.001);
  assert.equal(
    exploration.progressLabel,
    "The Ember Crown. Beat 8 of 15: Fun and Games. Story progress: 46 percent.",
  );
  assert.deepEqual(combat, exploration);
  assert.equal(Object.hasOwn(exploration, "journeyStep"), false);
});

test("story progress remains below complete until the Final Image resolves", () => {
  const beforeFinalImage = storyState({
    currentBeatId: "finalImage",
    currentBeatIndex: 14,
    cardsResolvedInBeat: 1,
    completedBeatIds: beatIds.slice(0, 14),
    totalWorldCardsResolved: 35,
  });
  const completed = storyState({
    status: "completed",
    completed: true,
    currentBeatId: "finalImage",
    currentBeatIndex: 14,
    cardsResolvedInBeat: 1,
    completedBeatIds: beatIds,
    totalWorldCardsResolved: 35,
  });

  assert.equal(deriveStoryHud(beforeFinalImage, { arcById }).progressPercent, 99);
  assert.equal(deriveStoryHud(completed, { arcById }).progressPercent, 100);
});

test("major-beat transition presentation uses canonical arc-authored copy", () => {
  const state = storyState({
    currentBeatId: "midpoint",
    currentBeatIndex: 8,
    pendingInterstitialBeatId: "midpoint",
  });
  state.mode = "storyTransition";

  const transition = deriveTransitionPresentation(state, { arcById });
  assert.deepEqual(transition, {
    arcTitle: "The Ember Crown",
    beatId: "midpoint",
    beatName: "Midpoint",
    beatNumber: 9,
    subtitle: "The Iron Gate",
    text: "Steel wings bar the path to the Crown.",
    announcement: "Midpoint. The Iron Gate. Steel wings bar the path to the Crown.",
  });
  assert.equal(isStoryTransitionActive(state), true);
  assert.equal(isStoryTransitionActive(storyState()), false);
  assert.equal(deriveTransitionPresentation(storyState(), { arcById }), null);
});

test("a pending beat transition cannot cover a priority combat-reward card", () => {
  const state = storyState({
    pendingInterstitialBeatId: "midpoint",
  });
  state.mode = "combatReward";
  state.currentCardData = {
    category: "combatReward",
    id: "combat-reward:iron-wyvern:37",
  };

  assert.equal(isStoryTransitionActive(state), false);
  assert.equal(deriveTransitionPresentation(state, { arcById }), null);

  const restoredCardBeforeModeRepair = { ...state, mode: "exploration" };
  assert.equal(isStoryTransitionActive(restoredCardBeforeModeRepair), false);
  assert.equal(deriveTransitionPresentation(restoredCardBeforeModeRepair, { arcById }), null);
});

test("victory presentation includes the ending and required run statistics", () => {
  const state = storyState({
    status: "completed",
    completed: true,
    currentBeatId: "finalImage",
    currentBeatIndex: 14,
    completedBeatIds: beatIds,
    totalWorldCardsResolved: 35,
    endingId: "crown-of-dawn",
    endingTitle: "Crown of Dawn",
    endingSummary: "The renewed wards warm every Hearthvale roof.",
    newDiscoveries: [{ id: "iron-wyvern", name: "Iron Wyvern" }],
  });
  state.mode = "victory";
  state.run.newEndingDiscovered = true;

  const presentation = deriveTerminalPresentation(state, { arcById });
  assert.equal(presentation.kind, "victory");
  assert.equal(presentation.arcTitle, "The Ember Crown");
  assert.equal(presentation.title, "Crown of Dawn");
  assert.equal(presentation.restartLabel, "Begin Another Arc");
  assert.deepEqual(
    presentation.stats.map(({ label }) => label),
    ["Final level", "World decisions", "Enemies defeated", "Items discovered", "Beat completion", "Story progress"],
  );
  assert.deepEqual(presentation.discoveries, ["Iron Wyvern", "Ending: Crown of Dawn"]);
});

test("death presentation names the reached beat, story progress, cause, and restart action", () => {
  const state = storyState({ deathCause: "Malrec's cinder bolt" });
  state.mode = "gameOver";
  const presentation = deriveTerminalPresentation(state, { arcById });

  assert.equal(presentation.kind, "death");
  assert.equal(presentation.restartLabel, "Restart Arc");
  assert.equal(presentation.copy, "Malrec's cinder bolt");
  assert.equal(presentation.stats.find(({ label }) => label === "Beat reached").value, "8 / 15 · Fun and Games");
  assert.equal(presentation.stats.find(({ label }) => label === "Final level").value, "4");
  assert.equal(presentation.stats.find(({ label }) => label === "Cause of death").value, "Malrec's cinder bolt");
});

test("debug checkpoint controls require both a local host and explicit URL opt-in", () => {
  assert.equal(isDebugCheckpointUiEnabled({ hostname: "localhost", search: "?debug-checkpoints=1" }), true);
  assert.equal(isDebugCheckpointUiEnabled({ hostname: "127.0.0.1", search: "?debug-checkpoints=1" }), true);
  assert.equal(isDebugCheckpointUiEnabled({ hostname: "game.example", search: "?debug-checkpoints=1" }), false);
  assert.equal(isDebugCheckpointUiEnabled({ hostname: "localhost", search: "" }), false);
  assert.equal(DEBUG_CHECKPOINTS.length, 15);
  assert.equal(DEBUG_CHECKPOINTS[0].id, "01-opening-image");
  assert.equal(DEBUG_CHECKPOINTS[14].id, "15-final-image");
});

test("document exposes the compact story, progression, combat, reward, and Pack surfaces", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const id of [
    "arc-title",
    "hud-beat-number",
    "hud-beat-name",
    "hud-story-progress",
    "player-resource-row",
    "level-xp-hud",
    "hud-level",
    "hud-xp",
    "hud-xp-delta",
    "hud-xp-bar",
    "hp-hud",
    "hud-hp",
    "hud-hp-delta",
    "hud-hp-bar",
    "mp-hud",
    "hud-mp",
    "hud-mp-delta",
    "hud-mp-bar",
    "inventory-open",
    "inventory-gold",
    "card-combat-status",
    "card-enemy-hp",
    "card-enemy-hp-bar",
    "card-reward-summary",
    "story-transition",
    "story-transition-continue",
    "terminal-summary",
    "terminal-restart",
    "debug-checkpoints",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  for (const removedId of [
    "arc-kicker",
    "hud-gold",
    "hud-gold-delta",
    "enemy-hud",
    "enemy-name",
    "enemy-hp",
    "enemy-hp-bar",
    "enemy-intent",
  ]) {
    assert.doesNotMatch(html, new RegExp(`id=["']${removedId}["']`));
  }

  const storyHudStart = html.indexOf('id="story-hud"');
  const storyHudEnd = html.indexOf("</section>", storyHudStart);
  const arcTitle = html.indexOf('id="arc-title"');
  const packButton = html.indexOf('id="inventory-open"');
  assert.ok(storyHudStart >= 0 && storyHudEnd > storyHudStart);
  assert.ok(arcTitle > storyHudStart && arcTitle < storyHudEnd);
  assert.ok(packButton > storyHudStart && packButton < storyHudEnd);

  const progressionStart = html.indexOf('id="level-xp-hud"');
  const progressionEnd = html.indexOf("</section>", progressionStart);
  assert.ok(html.indexOf('id="hud-level"') > progressionStart);
  assert.ok(html.indexOf('id="hud-level"') < progressionEnd);
  assert.ok(html.indexOf('id="hud-xp"') > progressionStart);
  assert.ok(html.indexOf('id="hud-xp"') < progressionEnd);

  const drawerStart = html.indexOf('id="inventory-drawer"');
  const drawerEnd = html.indexOf("</dialog>", drawerStart);
  const wallet = html.indexOf('id="inventory-gold"');
  assert.ok(wallet > drawerStart && wallet < drawerEnd);
  assert.match(html, /<button\s+id="inventory-open"/);
  assert.match(html, /id="inventory-open"[\s\S]*?data-resource="gold"/);
  assert.match(html, /id="level-xp-hud"[\s\S]*?aria-label="Level 1\. Experience 0 of 20\."/);
  assert.match(html, /id="inventory-wallet"[\s\S]*?aria-label="Gold"/);
  assert.match(html, /id="card-reward-summary"[\s\S]*?aria-label="Battle rewards"[\s\S]*?hidden/);
  assert.doesNotMatch(html, /hud-journey|>Depth</);
  assert.doesNotMatch(html, /on(?:click|load|error|submit)=/i);
});

test("document keeps Level and XP, HP, and MP in one weighted resource row", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const row = elementSourceById(html, "player-resource-row");
  const rowOpeningTag = row.slice(0, row.indexOf(">") + 1);
  const sectionIds = [...row.matchAll(/<section\b[^>]*\bid=(["'])([^"']+)\1[^>]*>/gi)]
    .map((match) => match[2]);

  assert.deepEqual(sectionIds, ["level-xp-hud", "hp-hud", "mp-hud"]);
  assert.equal((row.match(/<section\b/gi) ?? []).length, 3);
  assert.ok(rowOpeningTag.includes("grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]"));

  const expectedSections = [
    ["level-xp-hud", "xp", ["hud-level", "hud-xp", "hud-xp-delta", "hud-xp-bar"]],
    ["hp-hud", "hp", ["hud-hp", "hud-hp-delta", "hud-hp-bar"]],
    ["mp-hud", "mp", ["hud-mp", "hud-mp-delta", "hud-mp-bar"]],
  ];
  for (const [sectionId, resource, childIds] of expectedSections) {
    const section = elementSourceById(row, sectionId);
    const openingTag = section.slice(0, section.indexOf(">") + 1);
    assert.match(openingTag, new RegExp(`\\bdata-resource=(["'])${resource}\\1`));
    assert.match(openingTag, /\bclass=(["'])[^"']*\bmin-w-0\b[^"']*\1/);
    for (const childId of childIds) assert.match(section, new RegExp(`\\bid=(["'])${childId}\\1`));
  }

  const ids = [...html.matchAll(/\bid=(["'])([^"']+)\1/g)].map((match) => match[2]);
  const preservedIds = [
    "hud-level",
    "hud-xp",
    "hud-xp-delta",
    "hud-xp-bar",
    "hud-hp",
    "hud-hp-delta",
    "hud-hp-bar",
    "hud-mp",
    "hud-mp-delta",
    "hud-mp-bar",
  ];
  for (const id of preservedIds) {
    assert.equal(ids.filter((candidate) => candidate === id).length, 1, `Expected one #${id}`);
  }
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  assert.deepEqual(duplicates, []);
  assert.equal((html.match(/\bdata-resource=(["'])xp\1/g) ?? []).length, 1);
  assert.doesNotMatch(html, /\bdata-resource=(["'])level\1/);
  assert.doesNotMatch(html, /\bid=(["'])level-hud\1/);
});

test("short-height CSS compacts one resource row without hiding its values or meters", async () => {
  const css = await readFile(new URL("../src/input.css", import.meta.url), "utf8");
  const shortHeight = cssBlock(css, "@media (max-height: 650px)");

  assert.match(shortHeight, /#player-resource-row\s*\{/);
  assert.match(shortHeight, /#player-resource-row\s*>\s*section\s*\{/);
  assert.match(shortHeight, /#player-resource-row\s*>\s*section\s*>\s*div\s*\{/);
  assert.doesNotMatch(css, /#level-xp-hud\s*>\s*dl/);

  const hiddenSelectors = [...shortHeight.matchAll(/([^{}]+)\{[^{}]*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)[^{}]*\}/gi)]
    .map((match) => match[1]);
  for (const id of [
    "player-resource-row",
    "level-xp-hud",
    "hud-level",
    "hud-xp",
    "hud-xp-bar",
    "hp-hud",
    "hud-hp",
    "hud-hp-bar",
    "mp-hud",
    "hud-mp",
    "hud-mp-bar",
  ]) {
    assert.ok(hiddenSelectors.every((selector) => !selector.includes(`#${id}`)), `#${id} must remain visible`);
  }
});
