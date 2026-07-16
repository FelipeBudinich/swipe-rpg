/**
 * Compatibility exports for consumers of the original flat card module.
 * New story content lives in an arc-scoped module and carries explicit beat
 * weights, roles, completion tags, and counting behavior.
 */
import {
  EMBER_CROWN_CARDS,
  EMBER_CROWN_CARD_BY_ID,
} from "./cards/ember-crown-cards.js";

export const cards = EMBER_CROWN_CARDS;
export const cardById = EMBER_CROWN_CARD_BY_ID;
export const fallbackCard = EMBER_CROWN_CARD_BY_ID["opening-hearthvale-oath"];

export const explorationCards = Object.freeze(
  cards.filter(
    (card) =>
      !card.forcedOnly && !["anchor", "ending"].includes(card.story?.role),
  ),
);

export const forcedCards = Object.freeze(
  cards.filter(
    (card) => card.forcedOnly || ["anchor", "ending"].includes(card.story?.role),
  ),
);

export const CARDS = cards;
export const CARD_BY_ID = cardById;
