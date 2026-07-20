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

function openingTagById(source, id) {
  const match = new RegExp(
    `<[a-z][^>]*\\bid="${id}"[^>]*>`,
    "iu",
  ).exec(source);
  assert.ok(match, `Expected #${id}`);
  return match[0];
}

test("document identity and top HUD remain intentionally compact", () => {
  assert.match(html, /<title>Deep South<\/title>/u);
  assert.equal((html.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(
    html,
    /<h1 id="story-title"[^>]*>Deep South<\/h1>/u,
  );
  assert.doesNotMatch(html, /\bid="hud-deck-title"/u);
  for (const id of [
    "eldritch-lore-hud",
    "crew-hud",
    "sanity-hud",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`, "u"));
  }
});

test("the card is the sole four-arrow interaction surface", () => {
  const card = openingTagById(html, "card");
  assert.match(card, /\btabindex="0"/u);
  assert.match(
    card,
    /\baria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/u,
  );
  assert.match(card, /\bdata-card-face="front"/u);
  assert.doesNotMatch(card, /data-intro-face/u);
  assert.doesNotMatch(
    html,
    /id="choice-controls"|button[^>]+data-direction/u,
  );
});

test("persistent Location, Map, and Log tabs own three matching panels", () => {
  for (const id of [
    "view-navigation",
    "view-tablist",
    "view-location-tab",
    "view-map-tab",
    "view-log-tab",
    "chapter-map-panel",
    "chapter-map-route",
    "effect-log-panel",
    "effect-log-list",
    "effect-log-restart",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`, "u"));
  }
  assert.equal((html.match(/\brole="tab"/gu) ?? []).length, 3);
  assert.equal((html.match(/\brole="tabpanel"/gu) ?? []).length, 3);
  assert.match(
    openingTagById(html, "card-stack"),
    /role="tabpanel"[^>]*aria-labelledby="view-location-tab"[^>]*data-view-panel="location"/u,
  );
  assert.match(
    openingTagById(html, "view-location-tab"),
    /aria-selected="true"[^>]*tabindex="0"/u,
  );
  for (const id of ["chapter-map-panel", "effect-log-panel"]) {
    const panel = openingTagById(html, id);
    assert.match(panel, /\bhidden\b/u);
    assert.match(panel, /\binert\b/u);
  }
  assert.match(
    html,
    /id="skip-to-current-location"[^>]*href="#card-stack"[^>]*>[\s\S]*?Skip to the current location/u,
  );
});

test("markup retains the four transient preview labels and details", () => {
  assert.match(
    openingTagById(html, "choice-preview-feedback"),
    /\baria-hidden="true"/u,
  );
  for (const direction of ["up", "down", "left", "right"]) {
    assert.match(html, new RegExp(
      `id="choice-${direction}-overlay"[^>]+aria-hidden="true"`,
      "u",
    ));
    assert.match(
      html,
      new RegExp(`id="choice-${direction}-overlay-label"`, "u"),
    );
    assert.match(
      html,
      new RegExp(`id="choice-${direction}-overlay-detail"`, "u"),
    );
  }
});

test("persistent outcome markup and hidden acknowledgement controls are absent", () => {
  for (const id of [
    "choice-feedback-card",
    "choice-feedback-kicker",
    "choice-feedback-art",
    "choice-feedback-title",
    "choice-feedback-text",
    "choice-feedback-changes",
    "choice-feedback-controls",
    "choice-feedback-continue",
  ]) {
    assert.doesNotMatch(html, new RegExp(`\\bid="${id}"`, "u"));
  }
  assert.doesNotMatch(html, />\s*Continue\s*</u);
});

test("terminal loss surface and Begin Again remain available", () => {
  assert.match(
    openingTagById(html, "terminal-summary"),
    /\bhidden\b/u,
  );
  assert.match(html, /\bid="terminal-title"/u);
  assert.match(html, /\bid="terminal-copy"/u);
  assert.match(html, /\bid="terminal-stats"/u);
  assert.match(
    html,
    /<button[^>]*id="terminal-restart"[^>]*>Begin Again<\/button>/su,
  );
});

test("first photograph and reverse artwork preload locally", () => {
  assert.match(
    html,
    /href="\/assets\/art\/intro-01-fathers-photograph\.png"/u,
  );
  assert.match(
    html,
    /href="\/assets\/art\/intro-01-chiloe-map\.png"/u,
  );
  assert.doesNotMatch(html, /https?:\/\//u);
});

test("source CSS keeps transient previews and generic back detail only", () => {
  assert.match(css, /\.choice-preview-feedback/u);
  assert.match(css, /\.choice-overlay-detail/u);
  assert.match(
    css,
    /#card\[data-card-face="back"\] #card-detail:not\(\[hidden\]\)/u,
  );
  assert.doesNotMatch(css, /data-intro-face/u);
  assert.doesNotMatch(css, /\.choice-feedback-card/u);
  assert.doesNotMatch(css, /#choice-feedback-/u);
  assert.doesNotMatch(css, /@keyframes choice-feedback-enter/u);
  for (const selector of [
    ".view-navigation",
    ".view-tab",
    ".utility-panel",
    ".chapter-map-route",
    ".chapter-map-node",
    ".effect-log-entry",
  ]) {
    assert.match(
      css,
      new RegExp(selector.replace(".", "\\."), "u"),
    );
  }
});

test("short and narrow viewport rules retain card and terminal surfaces", () => {
  assert.match(css, /@media \(max-width: 359px\)/u);
  assert.match(css, /@media \(max-height: 650px\)/u);
  assert.match(
    css,
    /#card,\s*\.terminal-summary,\s*\.utility-panel\s*\{\s*min-height: 12\.5rem/u,
  );
  assert.doesNotMatch(css, /choice-feedback/u);
});

test("HTML IDs remain globally unique", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map(
    (match) => match[1],
  );
  assert.equal(new Set(ids).size, ids.length);
});
