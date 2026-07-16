const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

/**
 * Enemy intent weights are relative, not percentages. Drop chance is evaluated
 * before weighted item selection, so empty victories remain possible.
 */
export const enemies = deepFreeze([
  {
    id: "dust-jackal",
    name: "Dust Jackal",
    artId: "enemy-dust-jackal",
    introCardId: "encounter-dust-jackal",
    minLevel: 1,
    minJourneyStep: 1,
    maxHp: 14,
    attack: 5,
    defense: 1,
    xpReward: 9,
    goldMin: 2,
    goldMax: 5,
    intentWeights: { attack: 5, opening: 3, charge: 1, hesitate: 2 },
    dropChance: 0.28,
    dropTable: [
      { itemId: "moonberry-poultice", weight: 6 },
      { itemId: "caravan-sabre", weight: 2 },
      { itemId: "stitchcloak", weight: 2 },
    ],
  },
  {
    id: "prism-wisp",
    name: "Prism Wisp",
    artId: "enemy-prism-wisp",
    introCardId: "encounter-prism-wisp",
    minLevel: 1,
    minJourneyStep: 2,
    maxHp: 12,
    attack: 6,
    defense: 0,
    xpReward: 11,
    goldMin: 2,
    goldMax: 6,
    intentWeights: { attack: 2, opening: 5, charge: 2, hesitate: 3 },
    dropChance: 0.32,
    dropTable: [
      { itemId: "bluewake-tonic", weight: 6 },
      { itemId: "wayglass-charm", weight: 3 },
      { itemId: "bellglass-wand", weight: 1 },
    ],
  },
  {
    id: "moss-knight",
    name: "Moss Knight",
    artId: "enemy-moss-knight",
    introCardId: "encounter-moss-knight",
    minLevel: 2,
    minJourneyStep: 5,
    maxHp: 22,
    attack: 7,
    defense: 3,
    xpReward: 16,
    goldMin: 4,
    goldMax: 8,
    intentWeights: { attack: 4, opening: 2, charge: 3, hesitate: 2 },
    dropChance: 0.36,
    dropTable: [
      { itemId: "mossbound-plate", weight: 2 },
      { itemId: "caravan-brigandine", weight: 4 },
      { itemId: "moonberry-poultice", weight: 4 },
    ],
  },
  {
    id: "bell-vulture",
    name: "Bell Vulture",
    artId: "enemy-bell-vulture",
    introCardId: "encounter-bell-vulture",
    minLevel: 2,
    minJourneyStep: 7,
    maxHp: 19,
    attack: 8,
    defense: 2,
    xpReward: 18,
    goldMin: 5,
    goldMax: 9,
    intentWeights: { attack: 4, opening: 4, charge: 2, hesitate: 1 },
    dropChance: 0.34,
    dropTable: [
      { itemId: "moonfork-spear", weight: 2 },
      { itemId: "glasswind-mantle", weight: 3 },
      { itemId: "bluewake-tonic", weight: 5 },
    ],
  },
  {
    id: "ruin-sentinel",
    name: "Ruin Sentinel",
    artId: "enemy-ruin-sentinel",
    introCardId: "encounter-ruin-sentinel",
    minLevel: 3,
    minJourneyStep: 10,
    maxHp: 28,
    attack: 9,
    defense: 4,
    xpReward: 24,
    goldMin: 7,
    goldMax: 12,
    intentWeights: { attack: 3, opening: 2, charge: 4, hesitate: 2 },
    dropChance: 0.42,
    dropTable: [
      { itemId: "mirror-mail", weight: 4 },
      { itemId: "dawn-compass", weight: 3 },
      { itemId: "prism-cleaver", weight: 1 },
      { itemId: "dusk-cordial", weight: 2 },
    ],
  },
  {
    id: "glass-serpent",
    name: "Glass Serpent",
    artId: "enemy-glass-serpent",
    introCardId: "encounter-glass-serpent",
    minLevel: 3,
    minJourneyStep: 12,
    maxHp: 25,
    attack: 10,
    defense: 2,
    xpReward: 27,
    goldMin: 8,
    goldMax: 14,
    intentWeights: { attack: 3, opening: 3, charge: 4, hesitate: 1 },
    dropChance: 0.46,
    dropTable: [
      { itemId: "routekeeper-bow", weight: 2 },
      { itemId: "twin-moon-knot", weight: 2 },
      { itemId: "dusk-cordial", weight: 4 },
      { itemId: "star-salt", weight: 2 },
    ],
  },
  {
    id: "ashen-wyrm",
    name: "Ashen Wyrm",
    artId: "enemy-ashen-wyrm",
    introCardId: "boss-intro",
    isBoss: true,
    minLevel: 1,
    minJourneyStep: 20,
    maxHp: 50,
    attack: 10,
    defense: 3,
    xpReward: 60,
    goldMin: 25,
    goldMax: 25,
    intentWeights: { attack: 4, opening: 2, charge: 4, hesitate: 2 },
    dropChance: 1,
    dropTable: [{ itemId: "prism-seed", weight: 1 }],
  },
]);

export const enemyById = Object.freeze(
  Object.fromEntries(enemies.map((enemy) => [enemy.id, enemy])),
);

export const regularEnemies = Object.freeze(
  enemies.filter((enemy) => !enemy.isBoss),
);

export const bossEnemy = enemies.find((enemy) => enemy.isBoss);

export const ENEMIES = enemies;
export const ENEMY_BY_ID = enemyById;
