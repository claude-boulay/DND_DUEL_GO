import { AppError } from '../middleware/errorHandler';

export type StatName = 'history' | 'perception' | 'intelligence' | 'charisma' | 'luck';

export interface CharacterStats {
  history: number;
  perception: number;
  intelligence: number;
  charisma: number;
  luck: number;
}

export const STAT_NAMES: StatName[] = ['history', 'perception', 'intelligence', 'charisma', 'luck'];

export const STAT_MIN = 8;
// Pas d'objets pour booster ces stats en jeu : 20 est le plafond dur, pas une
// borne de coût dégressif.
export const STAT_MAX = 20;
export const POINT_BUY_BUDGET = 27;

/** Coût plat : chaque point au-dessus du plancher coûte 1 point de budget. */
export function totalPointBuyCost(stats: CharacterStats): number {
  return STAT_NAMES.reduce((sum, stat) => sum + (stats[stat] - STAT_MIN), 0);
}

export function validatePointBuy(stats: CharacterStats): void {
  for (const stat of STAT_NAMES) {
    const value = stats[stat];
    if (!Number.isInteger(value) || value < STAT_MIN || value > STAT_MAX) {
      throw new AppError(
        400,
        `${stat} doit être un entier entre ${STAT_MIN} et ${STAT_MAX}`,
        'invalid_point_buy',
      );
    }
  }

  const total = totalPointBuyCost(stats);
  if (total !== POINT_BUY_BUDGET) {
    throw new AppError(
      400,
      `Le point-buy doit utiliser exactement ${POINT_BUY_BUDGET} points (calculé : ${total})`,
      'invalid_point_buy',
    );
  }
}
