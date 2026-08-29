import { randomInt } from 'node:crypto';

/**
 * Mélange de deck pour l'envoi au moteur ocgcore réel (voir
 * services/ocgcoreClient.ts, routes/duel.routes.ts) — le calcul de combat,
 * de tributs, de légalité de chaîne et de phases est désormais entièrement
 * délégué au vrai moteur EDOPro ; ce fichier ne garde que ce qui reste côté
 * app (l'ordre du deck avant de le transmettre carte par carte).
 */

/** Fisher-Yates avec randomInt (qualité crypto, cohérent avec utils/dice.ts). */
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
