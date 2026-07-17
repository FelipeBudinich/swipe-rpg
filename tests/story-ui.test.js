import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/input.css", import.meta.url),
  "utf8",
);

function elementSourceById(source, id) {
  const idMatch = [...source.matchAll(/\bid=(["'])([^"']+)\1/g)].find(
    (match) => match[2] === id,
  );
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

function openingTagById(source, id) {
  const element = elementSourceById(source, id);
  return element.slice(0, element.indexOf(">") + 1);
}

test("document identity and application heading are Deep South", () => {
  assert.match(html, /<title>Deep South<\/title>/);
  assert.match(
    html,
    /<meta name="description" content="Deep South, a swipe-driven maritime cosmic-horror story\.">/,
  );
  assert.equal(elementSourceById(html, "story-title").replace(/<[^>]+>/g, "").trim(), "Deep South");
  assert.match(elementSourceById(html, "hud-deck-title"), /Intro — It begins here/);
  assert.match(openingTagById(html, "player-hud"), /aria-label="Deep South expedition status"/);
});

test("HUD contains only the canonical deck label and three expedition resources", () => {
  const hud = elementSourceById(html, "player-hud");
  const row = elementSourceById(hud, "player-resource-row");
  const sections = [...row.matchAll(/<section\b[^>]*\bid="([^"]+-hud)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(sections, [
    "eldritch-lore-hud",
    "crew-hud",
    "sanity-hud",
  ]);
  for (const [id, resource, label, initialValue] of [
    ["eldritch-lore-hud", "eldritchLore", "Eldritch Lore", "0"],
    ["crew-hud", "crew", "Crew", "0"],
    ["sanity-hud", "sanity", "Sanity", "3"],
  ]) {
    const section = elementSourceById(row, id);
    assert.match(openingTagById(row, id), new RegExp(`data-resource="${resource}"`));
    assert.match(section, new RegExp(label));
    assert.match(section, new RegExp(`>${initialValue}<`));
  }
  assert.equal((hud.match(/<progress\b/g) ?? []).length, 0);
});

test("retired story and resource presentation is absent from production HTML", () => {
  const retiredPhrases = [
    ["The", "Ember", "Crown"].join(" "),
    ["Save", "the", "Cat"].join(" "),
    ["Opening", "Image"].join(" "),
    ["Catal", "yst"].join(""),
    ["Mid", "point"].join(""),
    ["Fin", "ale"].join(""),
  ];
  for (const phrase of retiredPhrases) {
    assert.equal(html.includes(phrase), false, `Unexpected retired phrase: ${phrase}`);
  }
  const retiredIds = [
    ["hud", "level"].join("-"),
    ["hud", "xp"].join("-"),
    ["hud", "hp"].join("-"),
    ["hud", "mp"].join("-"),
    ["hud", "story", "progress"].join("-"),
    ["hud", "beat", "name"].join("-"),
    ["hud", "beat", "number"].join("-"),
  ];
  for (const id of retiredIds) {
    assert.equal(html.includes(`id="${id}"`), false);
  }
});

test("decision card has four directional overlays and text-safe accessible copy targets", () => {
  const card = elementSourceById(html, "card");
  assert.match(openingTagById(html, "card"), /aria-describedby="card-text card-detail"/);
  for (const direction of ["up", "down", "left", "right"]) {
    assert.match(card, new RegExp(`id="choice-${direction}-overlay"`));
    assert.match(card, new RegExp(`id="choice-${direction}-overlay-label"`));
  }
  assert.match(card, /id="card-title"/);
  assert.match(card, /id="card-text"/);
  assert.match(card, /id="card-detail"/);
  assert.doesNotMatch(card, /reward|combat|enemy/i);
});

test("all four accessible directional buttons use their matching arrow shortcut", () => {
  const controls = elementSourceById(html, "choice-controls");
  assert.match(openingTagById(html, "choice-controls"), /role="group"/);
  assert.match(openingTagById(html, "choice-controls"), /aria-label="Story actions"/);
  const ids = [...controls.matchAll(/<button\b[^>]*\bid="(choice-(?:up|down|left|right))"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(ids, [
    "choice-up",
    "choice-down",
    "choice-left",
    "choice-right",
  ]);
  for (const [direction, key] of [
    ["up", "ArrowUp"],
    ["down", "ArrowDown"],
    ["left", "ArrowLeft"],
    ["right", "ArrowRight"],
  ]) {
    const button = openingTagById(controls, `choice-${direction}`);
    assert.match(button, new RegExp(`data-direction="${direction}"`));
    assert.match(button, new RegExp(`aria-keyshortcuts="${key}"`));
    assert.match(controls, new RegExp(`id="choice-${direction}-label"`));
    assert.match(controls, new RegExp(`id="choice-${direction}-detail"`));
  }
});

test("intro starts with explicit up and left guidance without showing invalid actions", () => {
  const hint = elementSourceById(html, "direction-hint");
  assert.match(hint, /Up: keep reading · Left: skip introduction/);
  assert.match(openingTagById(html, "choice-controls"), /data-layout="intro"/);
  assert.doesNotMatch(openingTagById(html, "choice-up"), /\shidden(?:\s|>)/);
  assert.doesNotMatch(openingTagById(html, "choice-left"), /\shidden(?:\s|>)/);
  assert.match(openingTagById(html, "choice-down"), /\shidden(?:\s|>)/);
  assert.match(openingTagById(html, "choice-right"), /\shidden(?:\s|>)/);
});

test("persistent outcome card remains separate from decisions and has one Continue action", () => {
  const stack = elementSourceById(html, "card-stack");
  const feedback = elementSourceById(stack, "choice-feedback-card");
  const feedbackControls = elementSourceById(html, "choice-feedback-controls");
  assert.match(openingTagById(stack, "choice-feedback-card"), /role="region"/);
  assert.match(
    openingTagById(stack, "choice-feedback-card"),
    /aria-describedby="choice-feedback-text choice-feedback-changes"/,
  );
  assert.match(feedback, /id="choice-feedback-art"/);
  assert.match(feedback, /id="choice-feedback-text"/);
  assert.match(feedback, /id="choice-feedback-changes"/);
  assert.match(feedbackControls, /id="choice-feedback-continue"/);
  assert.equal((feedbackControls.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    feedbackControls,
    /id="choice-(?:up|down|left|right)"/,
  );
});

test("loss surface is cosmic-horror specific and offers Begin Again", () => {
  const terminal = elementSourceById(html, "terminal-summary");
  assert.match(terminal, /Expedition lost/);
  assert.match(terminal, /Deep South/);
  assert.match(terminal, /The sea remembers/);
  assert.match(terminal, /id="terminal-stats"/);
  assert.match(terminal, /id="terminal-restart"/);
  assert.match(terminal, />Begin Again<\/button>/);
});

test("removed inventory and chapter-transition surfaces are not present", () => {
  for (const id of [
    "inventory-open",
    "inventory-drawer",
    "inventory-content",
    "story-transition",
    "story-transition-continue",
    "confirm-dialog",
  ]) {
    assert.equal(html.includes(`id="${id}"`), false);
  }
});

test("HTML contains no duplicate IDs", () => {
  const ids = [...html.matchAll(/\bid=(["'])([^"']+)\1/g)].map(
    (match) => match[2],
  );
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
  );
});

test("CSS supports four-axis previews and a responsive two-column action grid", () => {
  for (const direction of ["up", "down", "left", "right"]) {
    assert.match(
      css,
      new RegExp(`--choice-${direction}-opacity:\\s*0`),
    );
    assert.match(
      css,
      new RegExp(`#choice-${direction}-overlay\\s*\\{[^}]*opacity:\\s*var\\(--choice-${direction}-opacity\\)`, "s"),
    );
  }
  assert.match(css, /\.choice-button\s*\{[^}]*min-height:\s*3\.25rem;/s);
  assert.match(
    css,
    /#card\[data-deck-type="intro"\] #card-text\s*\{[^}]*white-space:\s*pre-line;/s,
  );
  assert.match(css, /#choice-controls\[data-layout="intro"\]\s*\{/);
  assert.match(css, /@media \(max-width:\s*359px\)/);
  assert.match(css, /@media \(max-height:\s*650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("narrow and short viewport rules preserve resources, choices, and feedback", () => {
  const narrow = css.slice(
    css.indexOf("@media (max-width: 359px)"),
    css.indexOf("@media (max-height: 650px)"),
  );
  const short = css.slice(
    css.indexOf("@media (max-height: 650px)"),
    css.indexOf("@keyframes card-enter"),
  );
  assert.match(narrow, /#player-resource-row/);
  assert.match(narrow, /\.choice-button/);
  assert.doesNotMatch(narrow, /display:\s*none|visibility:\s*hidden/);
  assert.match(short, /#choice-controls/);
  assert.match(short, /\.choice-button\s*\{[^}]*min-height:\s*2\.75rem;/s);
  assert.match(short, /#choice-feedback-controls/);
  assert.match(short, /#choice-feedback-changes/);
  assert.doesNotMatch(short, /display:\s*none|visibility:\s*hidden/);
});
