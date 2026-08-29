import { randomInt } from 'node:crypto';

/** `randomInt` (crypto) plutôt que `Math.random` : jet non manipulable côté serveur. */
export function rollDie(sides: number): number {
  return randomInt(1, sides + 1);
}
