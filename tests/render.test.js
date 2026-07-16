import assert from "node:assert/strict";
import test from "node:test";

import { affectedResources, choiceDetail, resolveArtSource } from "../public/js/ui/render.js";

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

test("art sources resolve only through the bundled local allowlist", () => {
  const allowed = new Set(["player", "scene-road"]);
  assert.equal(resolveArtSource("scene-road", allowed), "/assets/art/scene-road.svg");
  assert.equal(resolveArtSource("../../server", allowed), "/assets/art/player.svg");
  assert.equal(resolveArtSource("https://example.com/tracker", allowed), "/assets/art/player.svg");
  assert.equal(resolveArtSource("unknown-art", allowed), "/assets/art/player.svg");
});
