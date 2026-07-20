import assert from "node:assert/strict";
import test from "node:test";

import { DEEP_SOUTH_STORY } from "../public/js/data/deep-south.js";
import {
  applyCardEffect,
  createInitialUnlockedCardIdsByDeck,
  effectForState,
  formatCardEffect,
  getEffectAvailability,
  normalizeCardEffect,
} from "../public/js/game/card-effects.js";
import { createInitialState } from "../public/js/game/state.js";

test("one normalizer serves resource, discovery, and card-addition effects", () => {
  assert.deepEqual(
    normalizeCardEffect(
      {
        resources: { eldritchLore: 1, unknown: 9 },
        discoveries: ["fatherDiaryReverse", "unknown-discovery"],
        ignored: true,
      },
      DEEP_SOUTH_STORY,
    ),
    {
      resources: { eldritchLore: 1 },
      discoveries: ["fatherDiaryReverse"],
    },
  );
  assert.equal(normalizeCardEffect(null, DEEP_SOUTH_STORY), null);
});

test("malformed or cross-deck card additions reject the complete effect", () => {
  for (const effect of [
    { addCards: "not-an-array" },
    { addCards: [{ deckId: "missing", cardIds: ["anything"] }] },
    {
      resources: { crew: 1 },
      addCards: [{
        deckId: "castro",
        cardIds: ["navigate-wrong-stars"],
      }],
    },
  ]) {
    assert.equal(normalizeCardEffect(effect, DEEP_SOUTH_STORY), null);
  }
});

test("formatter uses one stable resource and unlock grammar", () => {
  assert.equal(
    formatCardEffect(
      { resources: { eldritchLore: 1, sanity: -1 } },
      DEEP_SOUTH_STORY,
    ),
    "+1 Eldritch Lore · -1 Sanity",
  );
  assert.equal(
    formatCardEffect(
      {
        addCards: [{
          deckId: "gather-evidence",
          cardIds: [
            "gather-evidence-changing-photographs",
            "gather-evidence-map-redraws-itself",
          ],
        }],
      },
      DEEP_SOUTH_STORY,
    ),
    "Adds 2 cards to Chapter 8, Gather Evidence",
  );
  assert.equal(formatCardEffect(null, DEEP_SOUTH_STORY), "");
});

test("Crew and Lore losses gate reveals while Sanity loss never gates", () => {
  const state = createInitialState({ seed: 4 });
  assert.deepEqual(
    getEffectAvailability(
      state,
      { resources: { crew: -1, eldritchLore: 1 } },
      DEEP_SOUTH_STORY,
    ),
    {
      available: false,
      reason: "insufficient-resources",
      requirementText: "Requires 1 Crew.",
      shortfalls: { crew: 1 },
    },
  );
  assert.equal(
    getEffectAvailability(
      { ...state, resources: { ...state.resources, sanity: 0 } },
      { resources: { eldritchLore: 1, sanity: -1 } },
      DEEP_SOUTH_STORY,
    ).available,
    true,
  );
});

test("card additions are deterministic, idempotent, and report only new IDs", () => {
  const state = createInitialState({ seed: 8 });
  const cardId = "investigate-church-restricted-ledger";
  const effect = {
    addCards: [{
      deckId: "investigate-church",
      cardIds: [cardId],
    }],
  };
  assert.equal(
    createInitialUnlockedCardIdsByDeck(DEEP_SOUTH_STORY)[
      "investigate-church"
    ].includes(cardId),
    false,
  );

  const first = applyCardEffect(state, effect, DEEP_SOUTH_STORY);
  assert.equal(first.valid, true);
  assert.deepEqual(first.addedCardsByDeck, {
    "investigate-church": [cardId],
  });
  assert.equal(
    first.state.unlockedCardIdsByDeck["investigate-church"].includes(cardId),
    true,
  );

  const preview = effectForState(effect, first.state, DEEP_SOUTH_STORY);
  assert.deepEqual(preview, {});
  const second = applyCardEffect(first.state, effect, DEEP_SOUTH_STORY);
  assert.deepEqual(second.addedCardsByDeck, {});
  assert.equal(
    second.state.unlockedCardIdsByDeck["investigate-church"].filter(
      (id) => id === cardId,
    ).length,
    1,
  );
});

test("invalid additions execute atomically as no mutation", () => {
  const state = createInitialState({ seed: 9 });
  const effect = {
    resources: { crew: 1 },
    addCards: [{
      deckId: "castro",
      cardIds: ["not-authored"],
    }],
  };
  const applied = applyCardEffect(state, effect, DEEP_SOUTH_STORY);
  assert.equal(applied.valid, false);
  assert.equal(applied.state, state);
  assert.deepEqual(applied.changes, {});
  assert.deepEqual(applied.addedCardsByDeck, {});
});
