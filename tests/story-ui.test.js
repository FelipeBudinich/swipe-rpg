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

function directChildIds(source) {
  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const ids = [];
  let depth = 0;
  for (const match of source.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
    const token = match[0];
    const tagName = match[1].toLowerCase();
    if (token.startsWith("</")) {
      depth -= 1;
      continue;
    }
    if (depth === 1) {
      const id = /\bid=(["'])([^"']+)\1/u.exec(token)?.[2];
      if (id) ids.push(id);
    }
    if (!voidElements.has(tagName) && !token.endsWith("/>")) depth += 1;
  }
  return ids;
}

function elementSourceByPreviewBadge(source, direction) {
  const attribute = `data-preview-badge="${direction}"`;
  const attributeIndex = source.indexOf(attribute);
  assert.ok(attributeIndex >= 0, `Expected ${attribute} to exist`);
  const tagStart = source.lastIndexOf("<", attributeIndex);
  const tagMatch = /^<([a-z][\w-]*)\b/i.exec(source.slice(tagStart));
  assert.ok(tagMatch, `Expected ${attribute} to belong to an element`);
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
  assert.fail(`Expected ${attribute} to have a closing </${tagName}>`);
}

test("document identity uses one visible Deep South h1 and a wrapping chapter h2", () => {
  assert.match(html, /<title>Deep South<\/title>/);
  assert.match(
    html,
    /<meta name="description" content="Deep South, a swipe-driven maritime cosmic-horror story\.">/,
  );
  const storyTitle = elementSourceById(html, "story-title");
  const deckTitle = elementSourceById(html, "hud-deck-title");
  assert.match(openingTagById(html, "story-title"), /^<h1\b/u);
  assert.equal(storyTitle.replace(/<[^>]+>/g, "").trim(), "Deep South");
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(openingTagById(html, "hud-deck-title"), /^<h2\b/u);
  assert.match(deckTitle, /It begins here - 8 cards left in deck/u);
  assert.doesNotMatch(openingTagById(html, "hud-deck-title"), /\btruncate\b/u);
  assert.doesNotMatch(html, /Plot Step \d+ of \d+/u);
  assert.match(openingTagById(html, "player-hud"), /aria-label="Deep South expedition status"/);
});

test("HUD contains only the canonical deck label and three expedition resources", () => {
  const hud = elementSourceById(html, "player-hud");
  const row = elementSourceById(hud, "player-resource-row");
  assert.ok(
    hud.indexOf('id="story-hud"') < hud.indexOf('id="player-resource-row"'),
    "Story information must remain before expedition resources",
  );
  assert.doesNotMatch(openingTagById(row, "player-resource-row"), /\bmt-/u);
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
    if (id === "eldritch-lore-hud") {
      assert.doesNotMatch(section, /\btruncate\b/u);
    }
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

test("decision card separates full-card gradients from art-frame preview badges", () => {
  const card = elementSourceById(html, "card");
  const artFrameStart = card.indexOf('<figure class="card-art-frame ');
  const artFrameEnd = card.indexOf("</figure>", artFrameStart);
  const artFrame = card.slice(artFrameStart, artFrameEnd + "</figure>".length);
  assert.match(openingTagById(html, "card"), /aria-describedby="card-text card-detail"/);
  assert.match(openingTagById(html, "card"), /data-intro-face="front"/);
  assert.deepEqual(
    directChildIds(card).slice(0, 4),
    [
      "choice-up-overlay",
      "choice-down-overlay",
      "choice-left-overlay",
      "choice-right-overlay",
    ],
  );
  for (const direction of ["up", "down", "left", "right"]) {
    const overlay = elementSourceById(card, `choice-${direction}-overlay`);
    assert.match(openingTagById(overlay, `choice-${direction}-overlay`), /class="choice-overlay"/);
    assert.match(openingTagById(overlay, `choice-${direction}-overlay`), /aria-hidden="true"/);
    assert.doesNotMatch(overlay, /\bchoice-overlay-badge\b/u);
    assert.doesNotMatch(artFrame, new RegExp(`id="choice-${direction}-overlay"`));
    assert.doesNotMatch(
      openingTagById(overlay, `choice-${direction}-overlay`),
      /\b(?:top-0|bottom-0|left-0|right-0|inset-[xy]-0|h-1\/2|w-1\/2|items-start|items-end|justify-start|justify-end|bg-gradient-to-[btlr])\b/u,
    );
    assert.equal(
      (html.match(new RegExp(`id="choice-${direction}-overlay"`, "g")) ?? []).length,
      1,
    );
    assert.equal(
      (html.match(new RegExp(`id="choice-${direction}-overlay-label"`, "g")) ?? []).length,
      1,
    );
  }
  const previewFeedback = elementSourceById(
    artFrame,
    "choice-preview-feedback",
  );
  assert.match(
    openingTagById(previewFeedback, "choice-preview-feedback"),
    /class="choice-preview-feedback"/u,
  );
  assert.match(
    openingTagById(previewFeedback, "choice-preview-feedback"),
    /aria-hidden="true"/u,
  );
  assert.doesNotMatch(
    openingTagById(previewFeedback, "choice-preview-feedback"),
    /\b(?:aria-describedby|aria-live|role)=/u,
  );
  assert.ok(
    artFrame.indexOf('id="choice-preview-feedback"') <
      artFrame.indexOf('id="card-art"'),
    "Transient feedback must precede the artwork",
  );
  assert.deepEqual(directChildIds(artFrame).slice(0, 2), [
    "choice-preview-feedback",
    "card-art",
  ]);
  for (const direction of ["up", "down", "left", "right"]) {
    const badge = elementSourceByPreviewBadge(previewFeedback, direction);
    const overlayLabelId = `choice-${direction}-overlay-label`;
    const overlayDetailId = `choice-${direction}-overlay-detail`;
    assert.match(
      openingTagById(badge, overlayDetailId),
      /class="choice-overlay-detail"/u,
    );
    assert.match(
      openingTagById(badge, overlayDetailId),
      /\shidden(?:\s|>)/u,
    );
    assert.ok(
      badge.indexOf(`id="${overlayLabelId}"`) <
        badge.indexOf(`id="${overlayDetailId}"`),
      `${overlayDetailId} must follow its label`,
    );
    for (const id of [overlayLabelId, overlayDetailId]) {
      assert.equal(
        (html.match(new RegExp(`id="${id}"`, "g")) ?? []).length,
        1,
        `Expected #${id} exactly once`,
      );
    }
    const button = elementSourceById(
      elementSourceById(html, "choice-controls"),
      `choice-${direction}`,
    );
    const buttonDetailId = `choice-${direction}-detail`;
    assert.match(button, new RegExp(`id="${buttonDetailId}"`));
    assert.equal(
      (html.match(new RegExp(`id="${buttonDetailId}"`, "g")) ?? []).length,
      1,
      `Expected #${buttonDetailId} exactly once`,
    );
  }
  assert.match(card, /id="card-title"/);
  assert.match(card, /id="card-text"/);
  assert.match(card, /id="card-detail"/);
  assert.match(card, /id="card-art-label"/);
  assert.match(openingTagById(card, "card-art-label"), /aria-hidden="true"/);
  assert.match(openingTagById(card, "card-art-label"), /\shidden(?:\s|>)/);
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
  assert.equal(
    (controls.match(/class="choice-detail"/g) ?? []).length,
    4,
    "Every direction reserves a detail slot",
  );
});

test("the first Intro face starts with four stable accessible controls", () => {
  for (const direction of ["up", "down", "left", "right"]) {
    const button = openingTagById(html, `choice-${direction}`);
    assert.doesNotMatch(button, /\shidden(?:\s|>)/);
    assert.doesNotMatch(button, /\sdisabled(?:\s|>)/);
  }
  assert.match(elementSourceById(html, "choice-down"), /Skip toward Castro/u);
  for (const direction of ["left", "right"]) {
    assert.match(
      elementSourceById(html, `choice-${direction}`),
      /Turn the photograph over/u,
    );
  }
});

test("both first-card PNG faces are preloaded locally without scripts or remote URLs", () => {
  const preloads = [...html.matchAll(
    /<link rel="preload" as="image" href="([^"]+)" type="image\/png">/g,
  )].map((match) => match[1]);
  assert.deepEqual(preloads, [
    "/assets/art/intro-01-fathers-photograph.png",
    "/assets/art/intro-01-chiloe-map.png",
  ]);
  assert.ok(preloads.every((source) => source.startsWith("/assets/art/")));
});

test("the visible direction reminder/footer and its placeholder are removed", () => {
  assert.equal(html.includes('id="direction-hint"'), false);
  assert.equal(css.includes("#direction-hint"), false);
  assert.doesNotMatch(
    html,
    /Left: skip introduction|Swipe to choose|cards remaining/iu,
  );
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
  assert.match(
    css,
    /#player-hud\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*clamp\(11\.5rem,\s*44%,\s*14rem\);[^}]*align-items:\s*stretch;[^}]*gap:\s*0\.375rem;/s,
  );
  assert.match(
    css,
    /#story-hud,\s*#player-resource-row\s*\{[^}]*min-width:\s*0;/s,
  );
  assert.match(
    css,
    /#story-hud\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*justify-content:\s*center;/s,
  );
  assert.match(
    css,
    /#player-resource-row\s*\{[^}]*align-self:\s*stretch;[^}]*margin-top:\s*0;/s,
  );
  assert.match(
    css,
    /\.choice-overlay\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*20;[^}]*inset:\s*0;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transition:\s*opacity 40ms linear;/s,
  );
  const overlayRule = /\.choice-overlay\s*\{([^}]*)\}/s.exec(css)?.[1] ?? "";
  assert.doesNotMatch(
    overlayRule,
    /\b(?:display|align-items|justify-content|padding)\s*:/u,
  );
  assert.match(
    css,
    /\.choice-preview-feedback\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*right:\s*0;[^}]*left:\s*0;[^}]*z-index:\s*30;[^}]*display:\s*grid;[^}]*place-items:\s*start center;[^}]*padding:\s*0\.625rem 1rem 0;[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    css,
    /\.choice-overlay-badge\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*display:\s*inline-grid;[^}]*grid-area:\s*1 \/ 1;[^}]*justify-items:\s*center;[^}]*row-gap:\s*0\.25rem;[^}]*max-width:\s*calc\(100% - 2rem\);[^}]*opacity:\s*0;[^}]*text-align:\s*center;[^}]*pointer-events:\s*none;[^}]*transition:\s*opacity 40ms linear;/s,
  );
  assert.match(
    css,
    /\.choice-overlay-label-line\s*\{[^}]*display:\s*block;[^}]*max-width:\s*100%;/s,
  );
  assert.match(
    css,
    /\.choice-overlay-detail\s*\{[^}]*display:\s*-webkit-box;[^}]*overflow:\s*hidden;[^}]*max-width:\s*100%;[^}]*-webkit-box-orient:\s*vertical;[^}]*-webkit-line-clamp:\s*2;[^}]*font-size:\s*0\.62rem;[^}]*font-weight:\s*750;[^}]*letter-spacing:\s*0\.02em;[^}]*line-height:\s*1\.15;[^}]*text-transform:\s*none;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
  );
  assert.match(
    css,
    /\.choice-overlay-badge\[data-preview-badge="up"\]\s+\.choice-overlay-detail,\s*\.choice-overlay-badge\[data-preview-badge="left"\]\s+\.choice-overlay-detail\s*\{[^}]*color:\s*#b4dfd9;/s,
  );
  assert.match(
    css,
    /\.choice-overlay-badge\[data-preview-badge="down"\]\s+\.choice-overlay-detail,\s*\.choice-overlay-badge\[data-preview-badge="right"\]\s+\.choice-overlay-detail\s*\{[^}]*color:\s*#dec6df;/s,
  );
  for (const direction of ["up", "down", "left", "right"]) {
    assert.match(
      css,
      new RegExp(`--choice-${direction}-opacity:\\s*0`),
    );
    assert.match(
      css,
      new RegExp(`#choice-${direction}-overlay\\s*\\{[^}]*opacity:\\s*var\\(--choice-${direction}-opacity\\)`, "s"),
    );
    assert.match(
      css,
      new RegExp(`\\.choice-overlay-badge\\[data-preview-badge="${direction}"\\]\\s*\\{[^}]*opacity:\\s*var\\(--choice-${direction}-opacity\\)`, "s"),
    );
    assert.match(
      css,
      new RegExp(`#choice-${direction}-overlay::before\\s*\\{[^}]*inset:`, "s"),
    );
  }
  assert.match(
    css,
    /\.choice-button\s*\{[^}]*display:\s*grid;[^}]*height:\s*4\.875rem;[^}]*min-height:\s*4\.875rem;[^}]*grid-template-rows:\s*auto 1\.8rem 1\.35rem;/s,
  );
  assert.match(
    css,
    /\.choice-label\s*\{[^}]*height:\s*1\.8rem;[^}]*min-height:\s*1\.8rem;/s,
  );
  assert.match(
    css,
    /\.choice-detail\s*\{[^}]*height:\s*1\.35rem;[^}]*min-height:\s*1\.35rem;/s,
  );
  assert.match(
    css,
    /#card\[data-deck-type="intro"\] #card-text\s*\{[^}]*white-space:\s*pre-line;/s,
  );
  assert.match(css, /--card-flip-rotation:\s*0deg/u);
  assert.match(
    css,
    /rotateY\(var\(--card-flip-rotation\)\)/u,
  );
  assert.match(css, /#card\[data-swipe-state\^="flipping-"\]/u);
  assert.match(css, /#card\[data-swipe-state="flipping-swap"\]/u);
  assert.match(css, /#card\[data-swipe-state="flipping-in"\]/u);
  assert.match(
    css,
    /#card\[data-intro-face="reverse"\] #card-detail:not\(\[hidden\]\)/u,
  );
  assert.match(
    openingTagById(html, "choice-controls"),
    /\bgrid-cols-2\b/u,
  );
  assert.doesNotMatch(css, /#choice-controls\[data-layout="intro"\]/u);
  assert.match(
    css,
    /\.choice-button:disabled\s*\{[^}]*background:\s*#27333a;[^}]*opacity:\s*0\.72;/s,
  );
  assert.match(css, /\.choice-button\[data-direction\]:disabled:hover\s*\{/u);
  assert.match(css, /\.choice-button:disabled:active\s*\{[^}]*transform:\s*none;/s);
  assert.ok(
    css.indexOf(".choice-button:disabled .choice-detail") >
      css.indexOf(
        '.choice-button[data-direction="right"] .choice-detail',
      ),
    "Disabled detail color must override direction-specific colors",
  );
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
  assert.match(
    short,
    /\.choice-button\s*\{[^}]*height:\s*4\.5rem;[^}]*min-height:\s*4\.5rem;/s,
  );
  assert.match(short, /#choice-feedback-controls/);
  assert.match(short, /#choice-feedback-changes/);
  assert.doesNotMatch(
    short,
    /#player-resource-row\s*\{[^}]*margin-top:/s,
  );
  assert.doesNotMatch(short, /display:\s*none|visibility:\s*hidden/);
});
