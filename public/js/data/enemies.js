/** Compatibility exports for the arc-scoped Ember Crown enemy roster. */
import {
  EMBER_CROWN_ENEMIES,
  EMBER_CROWN_ENEMY_BY_ID,
} from "./ember-crown-enemies.js";

export const enemies = EMBER_CROWN_ENEMIES;
export const enemyById = EMBER_CROWN_ENEMY_BY_ID;
export const regularEnemies = Object.freeze(enemies.filter((enemy) => !enemy.isBoss));
export const bossEnemy = enemies.find((enemy) => enemy.isFinalBoss) ?? null;

export const ENEMIES = enemies;
export const ENEMY_BY_ID = enemyById;
